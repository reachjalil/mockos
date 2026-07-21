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

type SigningKeyRow = SqlRow & {
  kid: string;
  public_jwk: string;
  private_jwk: string;
};

export class SigningKeyService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;
  #active: Promise<SigningKeyPair> | undefined;

  constructor(store: SqlStore, clock: Clock, rng: Rng) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  initialize(): Promise<SigningKeyPair> {
    this.#active ??= this.#loadOrCreate();
    return this.#active;
  }

  async #loadOrCreate(): Promise<SigningKeyPair> {
    const existing = this.#store.get<SigningKeyRow>(
      `SELECT kid, public_jwk, private_jwk FROM signing_keys
       WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (existing) {
      return importSigningKey({
        publicJwk: JSON.parse(existing.public_jwk) as RsaJwk,
        privateJwk: JSON.parse(existing.private_jwk) as RsaJwk,
      });
    }

    const key = await generateSigningKey({ rng: this.#rng });
    this.#store.run(
      `INSERT INTO signing_keys (
        kid, status, algorithm, public_jwk, private_jwk, created_at
      ) VALUES (?, 'active', 'RS256', ?, ?, ?)`,
      key.kid,
      JSON.stringify(key.publicJwk),
      JSON.stringify(key.privateJwk),
      this.#clock.now().toISOString()
    );
    return key;
  }

  async sign(payload: JwtPayload): Promise<string> {
    return signJwt(payload, await this.initialize());
  }

  async verify(token: string, options: VerifyJwtOptions = {}): Promise<JwtPayload> {
    return verifyJwt(token, await this.initialize(), options);
  }

  async getJwks(): Promise<JsonWebKeySet> {
    await this.initialize();
    const rows = this.#store.all<SigningKeyRow>(
      `SELECT kid, public_jwk, private_jwk FROM signing_keys
       WHERE status IN ('active', 'next') ORDER BY created_at, kid`
    );
    return toJwks(
      rows.map((row) => {
        const jwk = JSON.parse(row.public_jwk) as RsaJwk;
        return { ...jwk, kid: row.kid };
      })
    );
  }
}
