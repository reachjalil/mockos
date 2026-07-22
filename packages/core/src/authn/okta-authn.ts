import type { Clock, Rng } from "../determinism";
import type { UserRecord, UserRepository } from "../directory";
import { hashSecret, randomId } from "../security";
import type { SqlRow, SqlStore } from "../store";

export const OKTA_AUTHN_STATE_TOKEN_TTL_MS = 5 * 60 * 1_000;
export const OKTA_AUTHN_SESSION_TOKEN_TTL_MS = 5 * 60 * 1_000;

export type OktaAuthnPendingStatus = "MFA_REQUIRED" | "PASSWORD_EXPIRED";
export type OktaAuthnStatus = OktaAuthnPendingStatus | "LOCKED_OUT" | "SUCCESS";

export type OktaAuthnResult =
  | {
      readonly expiresAt: string;
      readonly sessionToken: string;
      readonly status: "SUCCESS";
      readonly user: UserRecord;
    }
  | {
      readonly expiresAt: string;
      readonly stateToken: string;
      readonly status: OktaAuthnPendingStatus;
      readonly user: UserRecord;
    }
  | {
      readonly status: "LOCKED_OUT";
    };

export type OktaAuthnErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_SESSION_TOKEN"
  | "INVALID_STATE_TOKEN";

export class OktaAuthnError extends Error {
  readonly code: OktaAuthnErrorCode;

  constructor(code: OktaAuthnErrorCode) {
    super(
      code === "INVALID_CREDENTIALS"
        ? "Authentication failed."
        : "Invalid token provided."
    );
    this.name = "OktaAuthnError";
    this.code = code;
  }
}

export interface OktaAuthnServiceDependencies {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly store: SqlStore;
  readonly users: UserRepository;
  readonly sessionTokenTtlMs?: number;
  readonly stateTokenTtlMs?: number;
}

type AuthnTransactionRow = SqlRow & {
  id: string;
  state: string;
  user_id: string | null;
  created_at: string;
  expires_at: string;
};

type WebSessionRow = SqlRow & {
  id_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
};

type PreparedToken = {
  readonly hash: string;
  readonly value: string;
};

const isPendingStatus = (value: string): value is OktaAuthnPendingStatus =>
  value === "MFA_REQUIRED" || value === "PASSWORD_EXPIRED";

const positiveTtl = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
};

/**
 * Bounded Okta Classic primary-authentication state machine. Passwords and raw
 * bearer capabilities never enter persistence; only SHA-256 token hashes do.
 */
export class OktaAuthnService {
  readonly #clock: Clock;
  readonly #rng: Rng;
  readonly #store: SqlStore;
  readonly #users: UserRepository;
  readonly #sessionTokenTtlMs: number;
  readonly #stateTokenTtlMs: number;

  constructor(dependencies: OktaAuthnServiceDependencies) {
    this.#clock = dependencies.clock;
    this.#rng = dependencies.rng;
    this.#store = dependencies.store;
    this.#users = dependencies.users;
    this.#sessionTokenTtlMs = positiveTtl(
      dependencies.sessionTokenTtlMs ?? OKTA_AUTHN_SESSION_TOKEN_TTL_MS,
      "Session-token TTL"
    );
    this.#stateTokenTtlMs = positiveTtl(
      dependencies.stateTokenTtlMs ?? OKTA_AUTHN_STATE_TOKEN_TTL_MS,
      "State-token TTL"
    );
  }

  async authenticate(input: {
    readonly password: string;
    readonly userName: string;
  }): Promise<OktaAuthnResult> {
    // Prepare both possible bearer capabilities before credential verification.
    // Once the password verifier returns its final, current User snapshot, the
    // status decision and persistence write contain no async interleaving point.
    const [stateToken, sessionToken] = await Promise.all([
      this.#prepareToken("state"),
      this.#prepareToken("session"),
    ]);
    const user = await this.#users.verifyPrimaryCredentials(
      input.userName,
      input.password
    );
    if (!user) throw new OktaAuthnError("INVALID_CREDENTIALS");

    if (user.lifecycleState === "suspended") {
      return { status: "LOCKED_OUT" };
    }
    if (user.lifecycleState !== "active" || user.softDeletedAt) {
      throw new OktaAuthnError("INVALID_CREDENTIALS");
    }

    // Okta challenges an enrolled, policy-required factor before reporting an
    // expired password. `required` is mockOS's explicit policy-required state.
    if (user.mfaState === "required") {
      return this.#createPending("MFA_REQUIRED", user, stateToken);
    }
    if (user.passwordState !== "valid") {
      return this.#createPending("PASSWORD_EXPIRED", user, stateToken);
    }
    return this.#createSuccess(user, sessionToken);
  }

  async getTransaction(stateToken: string): Promise<OktaAuthnResult> {
    const tokenHash = await hashSecret(stateToken);
    const result = this.#store.transaction<OktaAuthnResult | undefined>(() => {
      const row = this.#store.get<AuthnTransactionRow>(
        `SELECT id, state, user_id, created_at, expires_at
         FROM authn_transactions WHERE id = ?`,
        tokenHash
      );
      if (!row || !isPendingStatus(row.state) || !row.user_id) {
        return undefined;
      }
      if (Date.parse(row.expires_at) <= this.#clock.now().getTime()) {
        this.#store.run("DELETE FROM authn_transactions WHERE id = ?", tokenHash);
        return undefined;
      }
      const user = this.#users.findById(row.user_id);
      if (user?.lifecycleState !== "active" || user.softDeletedAt) {
        this.#store.run("DELETE FROM authn_transactions WHERE id = ?", tokenHash);
        return undefined;
      }
      return {
        expiresAt: row.expires_at,
        stateToken,
        status: row.state,
        user,
      };
    });
    if (!result) throw new OktaAuthnError("INVALID_STATE_TOKEN");
    return result;
  }

  async cancel(stateToken: string): Promise<void> {
    const tokenHash = await hashSecret(stateToken);
    const cancelled = this.#store.transaction(() => {
      const row = this.#store.get<AuthnTransactionRow>(
        `SELECT id, state, user_id, created_at, expires_at
         FROM authn_transactions WHERE id = ?`,
        tokenHash
      );
      if (
        !row ||
        !isPendingStatus(row.state) ||
        Date.parse(row.expires_at) <= this.#clock.now().getTime()
      ) {
        if (row) {
          this.#store.run("DELETE FROM authn_transactions WHERE id = ?", tokenHash);
        }
        return false;
      }
      const deleted = this.#store.run(
        "DELETE FROM authn_transactions WHERE id = ?",
        tokenHash
      );
      return deleted.changes === 1;
    });
    if (!cancelled) throw new OktaAuthnError("INVALID_STATE_TOKEN");
  }

  async consumeSessionToken(sessionToken: string): Promise<UserRecord> {
    const tokenHash = await hashSecret(sessionToken);
    const user = this.#store.transaction<UserRecord | undefined>(() => {
      const row = this.#store.get<WebSessionRow>(
        `SELECT id_hash, user_id, created_at, expires_at
         FROM web_sessions WHERE id_hash = ?`,
        tokenHash
      );
      if (!row || Date.parse(row.expires_at) <= this.#clock.now().getTime()) {
        if (row)
          this.#store.run("DELETE FROM web_sessions WHERE id_hash = ?", tokenHash);
        return undefined;
      }
      const user = this.#users.findById(row.user_id);
      if (user?.lifecycleState !== "active" || user.softDeletedAt) {
        this.#store.run("DELETE FROM web_sessions WHERE id_hash = ?", tokenHash);
        return undefined;
      }
      const deleted = this.#store.run(
        "DELETE FROM web_sessions WHERE id_hash = ?",
        tokenHash
      );
      return deleted.changes === 1 ? user : undefined;
    });
    if (!user) throw new OktaAuthnError("INVALID_SESSION_TOKEN");
    return user;
  }

  async #prepareToken(prefix: "session" | "state"): Promise<PreparedToken> {
    const value = randomId(prefix, this.#rng);
    return { value, hash: await hashSecret(value) };
  }

  #createPending(
    status: OktaAuthnPendingStatus,
    user: UserRecord,
    token: PreparedToken
  ): OktaAuthnResult {
    const createdAt = this.#clock.now();
    const expiresAt = new Date(createdAt.getTime() + this.#stateTokenTtlMs);
    this.#store.run(
      `INSERT INTO authn_transactions (
        id, state, user_id, payload_json, created_at, expires_at
      ) VALUES (?, ?, ?, '{}', ?, ?)`,
      token.hash,
      status,
      user.id,
      createdAt.toISOString(),
      expiresAt.toISOString()
    );
    return {
      expiresAt: expiresAt.toISOString(),
      stateToken: token.value,
      status,
      user,
    };
  }

  #createSuccess(user: UserRecord, token: PreparedToken): OktaAuthnResult {
    const createdAt = this.#clock.now();
    const expiresAt = new Date(createdAt.getTime() + this.#sessionTokenTtlMs);
    this.#store.run(
      `INSERT INTO web_sessions (id_hash, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      token.hash,
      user.id,
      createdAt.toISOString(),
      expiresAt.toISOString()
    );
    return {
      expiresAt: expiresAt.toISOString(),
      sessionToken: token.value,
      status: "SUCCESS",
      user,
    };
  }
}
