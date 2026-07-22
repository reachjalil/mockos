import type { Clock, Rng } from "../determinism";
import type { SqlRow, SqlStore } from "../store";
import {
  generateSigningKey,
  importSigningKey,
  type JsonWebKeySet,
  type JwtPayload,
  type RsaJwk,
  type SigningKeyPair,
  signJwt,
  toJwks,
  type VerifyJwtOptions,
  verifyJwt,
} from "./jwt";

type SigningKeyStatus = "active" | "next" | "retiring" | "retired";

type SigningKeyRow = SqlRow & {
  kid: string;
  status: SigningKeyStatus;
  public_jwk: string;
  private_jwk: string | null;
  created_at: string;
  retired_at: string | null;
};

export interface SigningKeyRotation {
  readonly activeKid: string;
  readonly overlapKid: string;
  readonly nextKid: string;
  readonly rotatedAt: string;
}

const selectSigningKeys = `SELECT kid, status, public_jwk, private_jwk,
  created_at, retired_at FROM signing_keys`;

const SCRUBBED_PRIVATE_JWK = "{}";

/**
 * A previous public key remains legacy-JWKS-visible for this window. The extra
 * hour covers verifier/cache drift beyond the 24-hour scenario skew plus the
 * one-hour access/ID-token lifetime used by both provider profiles.
 */
export const SIGNING_KEY_ROLLBACK_WINDOW_SECONDS = 26 * 60 * 60;

const importRow = (row: SigningKeyRow): Promise<SigningKeyPair> => {
  if (!row.private_jwk || row.private_jwk === SCRUBBED_PRIVATE_JWK) {
    throw new Error(`Signing key ${row.kid} does not contain private material.`);
  }
  return importSigningKey({
    publicJwk: JSON.parse(row.public_jwk) as RsaJwk,
    privateJwk: JSON.parse(row.private_jwk) as RsaJwk,
  });
};

/**
 * Persistent RS256 key ring with one pre-published successor and one-key
 * verification overlap. Private JWKs never leave this service.
 */
export class SigningKeyService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;
  #initialized: Promise<void> | undefined;
  #active: { readonly kid: string; readonly key: Promise<SigningKeyPair> } | undefined;
  #rotationTail: Promise<void> = Promise.resolve();

  constructor(store: SqlStore, clock: Clock, rng: Rng) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  initialize(): Promise<void> {
    this.#initialized ??= this.#loadOrCreate();
    return this.#initialized;
  }

  async #loadOrCreate(): Promise<void> {
    this.#normalizeLegacyRows();
    let active = this.#activeRow();
    if (!active) {
      const candidate = await this.#generateUniqueKey();
      const now = this.#clock.now().toISOString();
      this.#store.transaction(() => {
        if (this.#activeRow()) return;
        this.#insert(candidate, "active", now);
      });
      active = this.#activeRow();
    }
    if (!active) throw new Error("Signing key initialization did not create a key.");
    await this.#ensureNext();
    await this.#activeKey(active);
  }

  #normalizeLegacyRows(): void {
    const now = this.#clock.now().toISOString();
    this.#store.transaction(() => {
      // `next` is deliberately the legacy-visible verification status. A
      // non-null retired_at distinguishes the previous overlap key from the
      // pre-published successor while old code continues to publish both.
      this.#store.run(
        `UPDATE signing_keys
         SET status = 'next', private_jwk = ?, retired_at = COALESCE(retired_at, ?)
         WHERE status = 'retiring'`,
        SCRUBBED_PRIVATE_JWK,
        now
      );
      this.#boundRetiredRows();
    });
  }

  #activeRow(): SigningKeyRow | undefined {
    return this.#singleRingRow("active");
  }

  #nextRow(): SigningKeyRow | undefined {
    const rows = this.#store.all<SigningKeyRow>(
      `${selectSigningKeys}
       WHERE status = 'next' AND retired_at IS NULL
       ORDER BY created_at DESC, kid`
    );
    if (rows.length > 1) {
      throw new Error("Signing key ring has multiple successor keys.");
    }
    return rows[0];
  }

  #singleRingRow(status: "active"): SigningKeyRow | undefined {
    const rows = this.#store.all<SigningKeyRow>(
      `${selectSigningKeys} WHERE status = ? ORDER BY created_at DESC, kid`,
      status
    );
    if (rows.length > 1) {
      throw new Error(`Signing key ring has multiple ${status} keys.`);
    }
    return rows[0];
  }

  #overlapRows(): SigningKeyRow[] {
    return this.#store.all<SigningKeyRow>(
      `${selectSigningKeys}
       WHERE status = 'next' AND retired_at IS NOT NULL
       ORDER BY retired_at DESC, created_at DESC, kid`
    );
  }

  #boundRetiredRows(): void {
    this.#store.run(
      `DELETE FROM signing_keys
       WHERE status = 'retired' AND kid NOT IN (
         SELECT kid FROM signing_keys WHERE status = 'retired'
         ORDER BY retired_at DESC, created_at DESC, kid DESC LIMIT 1
       )`
    );
  }

  #activeKey(row: SigningKeyRow): Promise<SigningKeyPair> {
    if (this.#active?.kid !== row.kid) {
      this.#active = { kid: row.kid, key: importRow(row) };
    }
    return this.#active.key;
  }

  async #generateUniqueKey(): Promise<SigningKeyPair> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const key = await generateSigningKey({ rng: this.#rng });
      const existing = this.#store.get<{ kid: string } & SqlRow>(
        "SELECT kid FROM signing_keys WHERE kid = ?",
        key.kid
      );
      if (!existing) return key;
    }
    throw new Error("Could not generate a unique signing-key identifier.");
  }

  #insert(key: SigningKeyPair, status: "active" | "next", createdAt: string): void {
    this.#store.run(
      `INSERT INTO signing_keys (
        kid, status, algorithm, public_jwk, private_jwk, created_at
      ) VALUES (?, ?, 'RS256', ?, ?, ?)`,
      key.kid,
      status,
      JSON.stringify(key.publicJwk),
      JSON.stringify(key.privateJwk),
      createdAt
    );
  }

  async #ensureNext(): Promise<void> {
    if (this.#nextRow()) return;
    const candidate = await this.#generateUniqueKey();
    const now = this.#clock.now().toISOString();
    this.#store.transaction(() => {
      if (this.#nextRow()) return;
      this.#insert(candidate, "next", now);
    });
  }

  #assertRotationWindow(now: Date): void {
    const overlaps = this.#overlapRows();
    if (overlaps.length > 1) {
      throw new Error("Signing key ring has multiple overlap keys.");
    }
    const overlap = overlaps[0];
    if (!overlap?.retired_at) return;
    const availableAt =
      Date.parse(overlap.retired_at) + SIGNING_KEY_ROLLBACK_WINDOW_SECONDS * 1_000;
    if (!Number.isFinite(availableAt)) {
      throw new Error("Signing key overlap has an invalid rotation timestamp.");
    }
    if (now.getTime() < availableAt) {
      throw new Error(
        `Signing key rotation is gated until ${new Date(availableAt).toISOString()}.`
      );
    }
  }

  /**
   * Atomically promotes the unpublished successor, encodes the previous active
   * key as a legacy-JWKS-visible metadata-only overlap row, and creates a new
   * successor. The prior overlap becomes retired in the same transaction.
   */
  rotate(): Promise<SigningKeyRotation> {
    const operation = this.#rotationTail.then(() => this.#rotate());
    this.#rotationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async #rotate(): Promise<SigningKeyRotation> {
    await this.initialize();
    await this.#ensureNext();
    this.#assertRotationWindow(this.#clock.now());
    const replacement = await this.#generateUniqueKey();
    const rotatedAt = this.#clock.now().toISOString();
    const promoted = this.#store.transaction(() => {
      this.#assertRotationWindow(new Date(rotatedAt));
      const active = this.#activeRow();
      const next = this.#nextRow();
      if (!active || !next) {
        throw new Error("Signing key ring needs exactly one active and next key.");
      }
      this.#store.run("DELETE FROM signing_keys WHERE status = 'retired'");
      this.#store.run(
        `UPDATE signing_keys SET status = 'retired', private_jwk = ?
         WHERE status = 'next' AND retired_at IS NOT NULL`,
        SCRUBBED_PRIVATE_JWK
      );
      const overlapped = this.#store.run(
        `UPDATE signing_keys
         SET status = 'next', private_jwk = ?, retired_at = ?
         WHERE kid = ? AND status = 'active'`,
        SCRUBBED_PRIVATE_JWK,
        rotatedAt,
        active.kid
      );
      const activated = this.#store.run(
        `UPDATE signing_keys SET status = 'active', retired_at = NULL
         WHERE kid = ? AND status = 'next'`,
        next.kid
      );
      if (overlapped.changes !== 1 || activated.changes !== 1) {
        throw new Error("Signing key rotation was not serialized.");
      }
      this.#insert(replacement, "next", rotatedAt);
      this.#boundRetiredRows();
      return { previous: active, active: { ...next, status: "active" as const } };
    });
    this.#active = undefined;
    await this.#activeKey(promoted.active);
    return {
      activeKid: promoted.active.kid,
      overlapKid: promoted.previous.kid,
      nextKid: replacement.kid,
      rotatedAt,
    };
  }

  async sign(payload: JwtPayload): Promise<string> {
    await this.initialize();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const active = this.#activeRow();
      if (!active) throw new Error("Signing key ring does not have an active key.");
      const token = await signJwt(payload, await this.#activeKey(active));
      const published = this.#store.get<SigningKeyRow>(
        `${selectSigningKeys} WHERE kid = ?`,
        active.kid
      );
      if (published?.status === "active") return token;
      // If rotation won the race, discard this token and sign again with the
      // persisted active key. Returning a newly signed overlap token would let
      // its validity extend beyond the overlap's fixed removal deadline.
      this.#active = undefined;
    }
    throw new Error("Signing key changed repeatedly while a token was being signed.");
  }

  async verify(token: string, options: VerifyJwtOptions = {}): Promise<JwtPayload> {
    return verifyJwt(token, await this.getJwks(), options);
  }

  async getJwks(): Promise<JsonWebKeySet> {
    await this.initialize();
    const rows = this.#store.all<SigningKeyRow>(
      `${selectSigningKeys}
       WHERE status IN ('active', 'next')
       ORDER BY created_at, kid`
    );
    return toJwks(
      rows.map((row) => {
        const jwk = JSON.parse(row.public_jwk) as RsaJwk;
        return { ...jwk, kid: row.kid };
      })
    );
  }
}
