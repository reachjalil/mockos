import type { SemanticErrorCode } from "@mockos/contracts";
import type { Clock, Rng } from "../determinism";
import type { ApplicationRepository, UserRepository } from "../directory";
import { hashSecret, randomId, verifyPkceS256 } from "../security";
import type { SqlRow, SqlStore } from "../store";

export interface CreateAuthorizationCodeInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly userId: string;
  /** Space-delimited OAuth scope. */
  readonly scope: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
  readonly nonce?: string;
}

export interface CreatedAuthorizationCode {
  readonly code: string;
  readonly expiresAt: string;
}

export interface RedeemAuthorizationCodeInput {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export interface AuthorizationCodeGrant {
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly nonce?: string;
}

type AuthorizationCodeRow = SqlRow & {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  user_id: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  nonce: string | null;
  issued_at: string;
  expires_at: string;
  redeemed_at: string | null;
};

const selectCode = `SELECT code_hash, client_id, redirect_uri, user_id, scope,
  code_challenge, code_challenge_method, nonce, issued_at, expires_at, redeemed_at
  FROM oauth_codes WHERE code_hash = ?`;

const oauthErrorName: Record<SemanticErrorCode, string> = {
  BAD_CLIENT_SECRET: "invalid_client",
  BAD_REDIRECT_URI: "invalid_grant",
  CODE_ALREADY_REDEEMED: "invalid_grant",
  INVALID_AUTHORIZATION_CODE: "invalid_grant",
  INVALID_GRANT: "invalid_grant",
  INVALID_REQUEST: "invalid_request",
  INVALID_SCOPE: "invalid_scope",
  LOCKED_OUT: "access_denied",
  MFA_REQUIRED: "interaction_required",
  PASSWORD_EXPIRED: "invalid_grant",
  RATE_LIMITED: "temporarily_unavailable",
  UNSUPPORTED_GRANT: "unsupported_grant_type",
  USER_DISABLED: "invalid_grant",
};

export class OAuthError extends Error {
  readonly code: SemanticErrorCode;
  readonly oauthError: string;

  constructor(code: SemanticErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthError";
    this.code = code;
    this.oauthError = oauthErrorName[code];
  }
}

const normalizeScope = (scope: string): string =>
  [...new Set(scope.trim().split(/\s+/).filter(Boolean))].join(" ");

export class AuthorizationCodeService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;
  readonly #applications: ApplicationRepository;
  readonly #users: UserRepository;
  readonly #lifetimeSeconds: number;

  constructor(options: {
    readonly store: SqlStore;
    readonly clock: Clock;
    readonly rng: Rng;
    readonly applications: ApplicationRepository;
    readonly users: UserRepository;
    readonly lifetimeSeconds: number;
  }) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#rng = options.rng;
    this.#applications = options.applications;
    this.#users = options.users;
    this.#lifetimeSeconds = options.lifetimeSeconds;
  }

  async createAuthorizationCode(
    input: CreateAuthorizationCodeInput
  ): Promise<CreatedAuthorizationCode> {
    const application = this.#applications.findByClientId(input.clientId);
    if (!application)
      throw new OAuthError("INVALID_REQUEST", "OAuth client is unknown.");
    if (!application.grantTypes.includes("authorization_code")) {
      throw new OAuthError(
        "UNSUPPORTED_GRANT",
        "OAuth client is not registered for the authorization-code grant."
      );
    }
    if (!application.redirectUris.includes(input.redirectUri)) {
      throw new OAuthError("BAD_REDIRECT_URI", "Redirect URI is not registered.");
    }
    const user = this.#users.findById(input.userId);
    if (!user) throw new OAuthError("INVALID_REQUEST", "User is unknown.");
    if (!user.accountEnabled || user.softDeletedAt) {
      throw new OAuthError("USER_DISABLED", "User account is disabled.");
    }
    if (user.passwordState === "expired") {
      throw new OAuthError("PASSWORD_EXPIRED", "User password is expired.");
    }
    if (user.mfaState === "required") {
      throw new OAuthError("MFA_REQUIRED", "Multi-factor authentication is required.");
    }
    if (
      input.codeChallengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)
    ) {
      throw new OAuthError(
        "INVALID_REQUEST",
        "A valid PKCE S256 challenge is required."
      );
    }
    const scope = normalizeScope(input.scope);
    if (!scope)
      throw new OAuthError("INVALID_SCOPE", "At least one scope is required.");

    const code = randomId("code", this.#rng);
    const issuedAt = this.#clock.now();
    const expiresAt = new Date(issuedAt.getTime() + this.#lifetimeSeconds * 1_000);
    this.#store.run(
      `INSERT INTO oauth_codes (
        code_hash, client_id, redirect_uri, user_id, scope, code_challenge,
        code_challenge_method, nonce, issued_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'S256', ?, ?, ?)`,
      await hashSecret(code),
      input.clientId,
      input.redirectUri,
      input.userId,
      scope,
      input.codeChallenge,
      input.nonce ?? null,
      issuedAt.toISOString(),
      expiresAt.toISOString()
    );
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async redeemAuthorizationCode(
    input: RedeemAuthorizationCodeInput
  ): Promise<AuthorizationCodeGrant> {
    const codeHash = await hashSecret(input.code);
    const row = this.#store.get<AuthorizationCodeRow>(selectCode, codeHash);
    if (!row) {
      throw new OAuthError(
        "INVALID_AUTHORIZATION_CODE",
        "Authorization code is invalid or expired."
      );
    }
    if (row.redeemed_at) {
      throw new OAuthError(
        "CODE_ALREADY_REDEEMED",
        "Authorization code was already redeemed."
      );
    }
    if (new Date(row.expires_at).getTime() <= this.#clock.now().getTime()) {
      throw new OAuthError(
        "INVALID_AUTHORIZATION_CODE",
        "Authorization code is invalid or expired."
      );
    }
    if (row.client_id !== input.clientId) {
      throw new OAuthError(
        "INVALID_GRANT",
        "Authorization code belongs to another client."
      );
    }
    if (row.redirect_uri !== input.redirectUri) {
      throw new OAuthError(
        "BAD_REDIRECT_URI",
        "Redirect URI does not match the authorization request."
      );
    }
    if (
      input.clientSecret === undefined ||
      !(await this.#applications.verifyClientSecret(input.clientId, input.clientSecret))
    ) {
      throw new OAuthError("BAD_CLIENT_SECRET", "Client authentication failed.");
    }
    if (
      row.code_challenge_method !== "S256" ||
      !(await verifyPkceS256(input.codeVerifier, row.code_challenge))
    ) {
      throw new OAuthError("INVALID_GRANT", "PKCE code_verifier is invalid.");
    }

    const redeemedAt = this.#clock.now().toISOString();
    const consumed = this.#store.transaction(() =>
      this.#store.run(
        `UPDATE oauth_codes SET redeemed_at = ?
         WHERE code_hash = ? AND redeemed_at IS NULL`,
        redeemedAt,
        codeHash
      )
    );
    if (consumed.changes !== 1) {
      throw new OAuthError(
        "CODE_ALREADY_REDEEMED",
        "Authorization code was already redeemed."
      );
    }
    return {
      clientId: row.client_id,
      userId: row.user_id,
      redirectUri: row.redirect_uri,
      scope: row.scope,
      ...(typeof row.nonce === "string" ? { nonce: row.nonce } : {}),
    };
  }
}
