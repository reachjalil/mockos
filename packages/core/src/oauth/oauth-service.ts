import type { Clock, Rng } from "../determinism";
import type {
  ApplicationRecord,
  ApplicationRepository,
  GroupRepository,
  UserRecord,
  UserRepository,
} from "../directory";
import type { SigningKeyService } from "../keys";
import type { ProviderProfile } from "../providers";
import { hashSecret, oidcTokenHash, randomId } from "../security";
import type { SqlRow, SqlStore } from "../store";
import {
  AuthorizationCodeService,
  type CreateAuthorizationCodeInput,
  type CreatedAuthorizationCode,
  OAuthError,
  type RedeemAuthorizationCodeInput,
} from "./authorization-code";
import {
  type CreateDeviceAuthorizationInput,
  type CreatedDeviceAuthorization,
  DeviceAuthorizationService,
  type PollDeviceAuthorizationInput,
} from "./device-authorization";

export interface RedeemAuthorizationCodeForTokensInput
  extends RedeemAuthorizationCodeInput {
  /** Request-derived final OIDC issuer. It is used for this response only. */
  readonly issuerBase: string;
}

export interface RedeemRefreshTokenForTokensInput {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly issuerBase: string;
  readonly scope?: string;
}

export interface PollDeviceAuthorizationForTokensInput
  extends PollDeviceAuthorizationInput {
  /** Request-derived final OIDC issuer. It is used for this response only. */
  readonly issuerBase: string;
}

export interface OAuthTokenResponse {
  readonly accessToken: string;
  readonly idToken?: string;
  readonly refreshToken?: string;
  readonly expiresIn: number;
  readonly scope: string;
  readonly tokenType: "Bearer";
}

export interface IntrospectTokenInput {
  readonly token: string;
  readonly tokenTypeHint?: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  /** Request-derived final OIDC issuer. It is used for this response only. */
  readonly issuerBase: string;
}

export type OAuthIntrospectionResponse =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly scope: string;
      readonly username: string;
      readonly exp: number;
      readonly iat: number;
      readonly sub: string;
      readonly aud: string;
      readonly iss: string;
      readonly token_type: "Bearer" | "refresh_token";
      readonly client_id: string;
      readonly uid: string;
      readonly jti?: string;
    };

export interface RevokeTokenInput {
  readonly token: string;
  readonly tokenTypeHint?: string;
  readonly clientId: string;
  readonly clientSecret?: string;
}

type AccessTokenRow = SqlRow & {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  jti: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  family_id: string | null;
};

type RefreshTokenRow = SqlRow & {
  token_hash: string;
  family_id: string;
  client_id: string;
  user_id: string;
  scope: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  auth_time: number | null;
  generation: number;
  parent_token_hash: string | null;
  replaced_by_hash: string | null;
};

type PreparedRefreshToken = {
  readonly token: string;
  readonly tokenHash: string;
  readonly familyId: string;
  readonly authTime: number;
  readonly generation: number;
  readonly parentTokenHash?: string;
  readonly expiresAt: string;
};

type PreparedTokenGrant = OAuthTokenResponse & {
  readonly accessTokenHash: string;
  readonly accessTokenId: string;
  readonly clientId: string;
  readonly userId: string;
  readonly issuedAt: string;
  readonly accessExpiresAt: string;
  readonly familyId?: string;
  readonly preparedRefresh?: PreparedRefreshToken;
};

type RefreshCommitOutcome = "success" | "invalid" | "replayed" | "user_disabled";

const selectRefreshToken = `SELECT token_hash, family_id, client_id, user_id, scope,
  issued_at, expires_at, consumed_at, revoked_at, auth_time, generation,
  parent_token_hash, replaced_by_hash FROM refresh_tokens`;

const unixSeconds = (value: string): number =>
  Math.floor(new Date(value).getTime() / 1_000);

const normalizeScope = (scope: string): string =>
  [...new Set(scope.trim().split(/\s+/).filter(Boolean))].join(" ");

const tokenId = (prefix: string, rng: Rng): string => {
  const stem = prefix.replace(/[._-]+$/, "") || "token";
  return randomId(stem, rng).replace(`${stem}_`, prefix);
};

const hasExpired = (expiresAt: string, now: Date): boolean =>
  new Date(expiresAt).getTime() <= now.getTime();

export class OAuthService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;
  readonly #tenantId: string;
  readonly #profile: ProviderProfile;
  readonly #applications: ApplicationRepository;
  readonly #users: UserRepository;
  readonly #groups: GroupRepository;
  readonly #keys: SigningKeyService;
  readonly #authorizationCodes: AuthorizationCodeService;
  readonly #deviceAuthorizations: DeviceAuthorizationService;

  constructor(options: {
    readonly store: SqlStore;
    readonly clock: Clock;
    readonly rng: Rng;
    readonly tenantId: string;
    readonly profile: ProviderProfile;
    readonly applications: ApplicationRepository;
    readonly users: UserRepository;
    readonly groups: GroupRepository;
    readonly keys: SigningKeyService;
  }) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#rng = options.rng;
    this.#tenantId = options.tenantId;
    this.#profile = options.profile;
    this.#applications = options.applications;
    this.#users = options.users;
    this.#groups = options.groups;
    this.#keys = options.keys;
    this.#authorizationCodes = new AuthorizationCodeService({
      store: options.store,
      clock: options.clock,
      rng: options.rng,
      applications: options.applications,
      users: options.users,
      lifetimeSeconds: options.profile.tokenPolicy.authorizationCodeLifetimeSeconds,
    });
    this.#deviceAuthorizations = new DeviceAuthorizationService({
      store: options.store,
      clock: options.clock,
      rng: options.rng,
      tenantId: options.tenantId,
      profile: options.profile,
      applications: options.applications,
      users: options.users,
    });
  }

  createAuthorizationCode(
    input: CreateAuthorizationCodeInput
  ): Promise<CreatedAuthorizationCode> {
    return this.#authorizationCodes.createAuthorizationCode(input);
  }

  async redeemAuthorizationCode(
    input: RedeemAuthorizationCodeForTokensInput
  ): Promise<OAuthTokenResponse> {
    const grant = await this.#authorizationCodes.redeemAuthorizationCode(input);
    return this.#issueTokens({
      clientId: grant.clientId,
      userId: grant.userId,
      scope: grant.scope,
      issuerBase: input.issuerBase,
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
    });
  }

  async redeemRefreshToken(
    input: RedeemRefreshTokenForTokensInput
  ): Promise<OAuthTokenResponse> {
    await this.#authenticateClient(input.clientId, input.clientSecret);
    const application = this.#applications.requireByClientId(input.clientId);
    if (!application.grantTypes.includes("refresh_token")) {
      throw new OAuthError(
        "UNSUPPORTED_GRANT",
        "OAuth client is not registered for the refresh-token grant."
      );
    }
    const tokenHash = await hashSecret(input.refreshToken);
    const row = this.#store.get<RefreshTokenRow>(
      `${selectRefreshToken} WHERE token_hash = ?`,
      tokenHash
    );
    if (!row || row.client_id !== input.clientId) this.#invalidRefreshToken();
    const user = this.#users.findById(row.user_id);
    if (user?.lifecycleState !== "active") this.#disabledUser();
    if (row.consumed_at) {
      const now = this.#clock.now().toISOString();
      this.#store.transaction(() => {
        const current = this.#store.get<RefreshTokenRow>(
          `${selectRefreshToken} WHERE token_hash = ? AND client_id = ?`,
          tokenHash,
          input.clientId
        );
        if (current?.consumed_at) this.#revokeFamily(current.family_id, now);
      });
      this.#invalidRefreshToken();
    }
    if (row.revoked_at || hasExpired(row.expires_at, this.#clock.now())) {
      this.#invalidRefreshToken();
    }
    const scope = this.#refreshScope(row.scope, input.scope);
    const authTime =
      row.auth_time ?? Math.floor(new Date(row.issued_at).getTime() / 1_000);
    const prepared = await this.#prepareTokens({
      clientId: application.clientId,
      user,
      application,
      scope,
      issuerBase: input.issuerBase,
      authTime,
      refresh: {
        familyId: row.family_id,
        authTime,
        generation: Number(row.generation) + 1,
        parentTokenHash: tokenHash,
        expiresAt: row.expires_at,
      },
    });
    const outcome = this.#commitRefreshRotation(row, prepared);
    if (outcome === "user_disabled") this.#disabledUser();
    if (outcome !== "success") this.#invalidRefreshToken();
    return this.#tokenResponse(prepared);
  }

  createDeviceAuthorization(
    input: CreateDeviceAuthorizationInput
  ): Promise<CreatedDeviceAuthorization> {
    return this.#deviceAuthorizations.create(input);
  }

  activateDeviceAuthorization(userCode: string, userId: string): void {
    this.#deviceAuthorizations.activate(userCode, userId);
  }

  denyDeviceAuthorization(userCode: string): void {
    this.#deviceAuthorizations.deny(userCode);
  }

  async pollDeviceAuthorization(
    input: PollDeviceAuthorizationForTokensInput
  ): Promise<OAuthTokenResponse> {
    const grant = await this.#deviceAuthorizations.poll(input);
    return this.#issueTokens({ ...grant, issuerBase: input.issuerBase });
  }

  async introspectToken(
    input: IntrospectTokenInput
  ): Promise<OAuthIntrospectionResponse> {
    await this.#authenticateClient(input.clientId, input.clientSecret);
    const tokenHash = await hashSecret(input.token);
    const access = this.#store.get<AccessTokenRow>(
      `SELECT token_hash, client_id, user_id, scope, jti, issued_at, expires_at,
       revoked_at, family_id FROM oauth_access_tokens WHERE token_hash = ?`,
      tokenHash
    );
    if (access) {
      if (
        access.client_id !== input.clientId ||
        access.revoked_at ||
        hasExpired(access.expires_at, this.#clock.now())
      ) {
        return { active: false };
      }
      const user = this.#activeUser(access.user_id);
      if (!user) return { active: false };
      return {
        active: true,
        scope: access.scope,
        username: user.userName,
        exp: unixSeconds(access.expires_at),
        iat: unixSeconds(access.issued_at),
        sub: user.id,
        aud: access.client_id,
        iss: this.#issuer(input.issuerBase),
        jti: access.jti,
        token_type: "Bearer",
        client_id: access.client_id,
        uid: user.id,
      };
    }

    const refresh = this.#store.get<RefreshTokenRow>(
      `${selectRefreshToken} WHERE token_hash = ?`,
      tokenHash
    );
    if (
      !refresh ||
      refresh.client_id !== input.clientId ||
      refresh.consumed_at ||
      refresh.revoked_at ||
      hasExpired(refresh.expires_at, this.#clock.now())
    ) {
      return { active: false };
    }
    const user = this.#activeUser(refresh.user_id);
    if (!user) return { active: false };
    return {
      active: true,
      scope: refresh.scope,
      username: user.userName,
      exp: unixSeconds(refresh.expires_at),
      iat: unixSeconds(refresh.issued_at),
      sub: user.id,
      aud: refresh.client_id,
      iss: this.#issuer(input.issuerBase),
      token_type: "refresh_token",
      client_id: refresh.client_id,
      uid: user.id,
    };
  }

  /** RFC 7009 deliberately returns success for unknown and already-revoked tokens. */
  async revokeToken(input: RevokeTokenInput): Promise<void> {
    await this.#authenticateClient(input.clientId, input.clientSecret);
    const tokenHash = await hashSecret(input.token);
    const now = this.#clock.now().toISOString();
    this.#store.transaction(() => {
      this.#store.run(
        `UPDATE oauth_access_tokens SET revoked_at = ?
         WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
        now,
        tokenHash,
        input.clientId
      );
      const refresh = this.#store.get<RefreshTokenRow>(
        `${selectRefreshToken} WHERE token_hash = ? AND client_id = ?`,
        tokenHash,
        input.clientId
      );
      if (refresh) this.#revokeFamily(refresh.family_id, now);
    });
  }

  async #issueTokens(input: {
    readonly clientId: string;
    readonly userId: string;
    readonly scope: string;
    readonly issuerBase: string;
    readonly nonce?: string;
  }): Promise<OAuthTokenResponse> {
    const user = this.#users.requireById(input.userId);
    if (user.lifecycleState !== "active") this.#disabledUser();
    const application = this.#applications.requireByClientId(input.clientId);
    const prepared = await this.#prepareTokens({
      clientId: input.clientId,
      user,
      application,
      scope: input.scope,
      issuerBase: input.issuerBase,
      ...(input.nonce ? { nonce: input.nonce } : {}),
    });
    this.#store.transaction(() => {
      const currentUser = this.#users.findById(user.id);
      if (currentUser?.lifecycleState !== "active") {
        throw new OAuthError("USER_DISABLED", "User account is disabled.");
      }
      this.#insertPreparedGrant(prepared);
    });
    return this.#tokenResponse(prepared);
  }

  async #prepareTokens(input: {
    readonly clientId: string;
    readonly user: UserRecord;
    readonly application: ApplicationRecord;
    readonly scope: string;
    readonly issuerBase: string;
    readonly nonce?: string;
    readonly authTime?: number;
    readonly refresh?: {
      readonly familyId: string;
      readonly authTime: number;
      readonly generation: number;
      readonly parentTokenHash: string;
      readonly expiresAt: string;
    };
  }): Promise<PreparedTokenGrant> {
    const scope = normalizeScope(input.scope);
    const scopes = scope.split(/\s+/).filter(Boolean);
    const issuer = this.#issuer(input.issuerBase);
    const issuedAt = Math.floor(this.#clock.now().getTime() / 1_000);
    const authTime = input.authTime ?? issuedAt;
    const accessExpiresAt =
      issuedAt + this.#profile.tokenPolicy.accessTokenLifetimeSeconds;
    const memberships = this.#groups.listForUser(input.user.id);
    const groups = memberships.map((group) => group.id);
    const groupNames = memberships.map((group) => group.displayName);
    const accessTokenId = tokenId(
      this.#profile.tokenPolicy.accessTokenIdPrefix ?? "AT_",
      this.#rng
    );
    const accessClaims = this.#profile.claims({
      issuer,
      tenantId: this.#tenantId,
      clientId: input.application.clientId,
      user: input.user,
      issuedAt,
      expiresAt: accessExpiresAt,
      tokenKind: "access",
      tokenId: accessTokenId,
      authTime,
      scopes,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      groups,
      groupNames,
    });
    const accessToken = await this.#keys.sign({
      ...accessClaims,
      scp: this.#profile.tokenPolicy.scopeClaimFormat === "array" ? scopes : scope,
      ...(this.#profile.tokenPolicy.includeTokenUseClaim === false
        ? {}
        : { token_use: "access" }),
    });

    let idToken: string | undefined;
    if (scopes.includes("openid")) {
      const idExpiresAt = issuedAt + this.#profile.tokenPolicy.idTokenLifetimeSeconds;
      const idClaims = this.#profile.claims({
        issuer,
        tenantId: this.#tenantId,
        clientId: input.application.clientId,
        user: input.user,
        issuedAt,
        expiresAt: idExpiresAt,
        tokenKind: "id",
        tokenId: tokenId(this.#profile.tokenPolicy.idTokenIdPrefix ?? "ID_", this.#rng),
        authTime,
        accessTokenHash: await oidcTokenHash(accessToken),
        scopes,
        ...(input.nonce ? { nonce: input.nonce } : {}),
        groups,
        groupNames,
      });
      idToken = await this.#keys.sign({
        ...idClaims,
        ...(this.#profile.tokenPolicy.includeTokenUseClaim === false
          ? {}
          : { token_use: "id" }),
      });
    }

    let preparedRefresh: PreparedRefreshToken | undefined;
    if (input.refresh) {
      const token = randomId("refresh", this.#rng);
      preparedRefresh = {
        token,
        tokenHash: await hashSecret(token),
        familyId: input.refresh.familyId,
        authTime: input.refresh.authTime,
        generation: input.refresh.generation,
        parentTokenHash: input.refresh.parentTokenHash,
        expiresAt: input.refresh.expiresAt,
      };
    } else if (
      scopes.includes("offline_access") &&
      input.application.grantTypes.includes("refresh_token")
    ) {
      const token = randomId("refresh", this.#rng);
      preparedRefresh = {
        token,
        tokenHash: await hashSecret(token),
        familyId: randomId("family", this.#rng),
        authTime,
        generation: 0,
        expiresAt: new Date(
          this.#clock.now().getTime() +
            this.#profile.tokenPolicy.refreshTokenLifetimeSeconds * 1_000
        ).toISOString(),
      };
    }

    return {
      accessToken,
      ...(idToken ? { idToken } : {}),
      ...(preparedRefresh ? { refreshToken: preparedRefresh.token } : {}),
      expiresIn: this.#profile.tokenPolicy.accessTokenLifetimeSeconds,
      scope,
      tokenType: "Bearer",
      accessTokenHash: await hashSecret(accessToken),
      accessTokenId,
      clientId: input.clientId,
      userId: input.user.id,
      issuedAt: new Date(issuedAt * 1_000).toISOString(),
      accessExpiresAt: new Date(accessExpiresAt * 1_000).toISOString(),
      ...(preparedRefresh
        ? { preparedRefresh, familyId: preparedRefresh.familyId }
        : {}),
    };
  }

  #insertPreparedGrant(prepared: PreparedTokenGrant): void {
    this.#store.run(
      `INSERT INTO oauth_access_tokens (
        token_hash, client_id, user_id, scope, jti, issued_at, expires_at, family_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      prepared.accessTokenHash,
      prepared.clientId,
      prepared.userId,
      prepared.scope,
      prepared.accessTokenId,
      prepared.issuedAt,
      prepared.accessExpiresAt,
      prepared.familyId ?? null
    );
    if (prepared.preparedRefresh) {
      const refresh = prepared.preparedRefresh;
      this.#store.run(
        `INSERT INTO refresh_tokens (
          token_hash, family_id, client_id, user_id, scope, issued_at, expires_at,
          auth_time, generation, parent_token_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        refresh.tokenHash,
        refresh.familyId,
        prepared.clientId,
        prepared.userId,
        prepared.scope,
        prepared.issuedAt,
        refresh.expiresAt,
        refresh.authTime,
        refresh.generation,
        refresh.parentTokenHash ?? null
      );
    }
  }

  #commitRefreshRotation(
    original: RefreshTokenRow,
    prepared: PreparedTokenGrant
  ): RefreshCommitOutcome {
    const replacement = prepared.preparedRefresh;
    if (!replacement)
      throw new Error("Refresh rotation did not prepare a replacement.");
    return this.#store.transaction(() => {
      const current = this.#store.get<RefreshTokenRow>(
        `${selectRefreshToken} WHERE token_hash = ? AND client_id = ?`,
        original.token_hash,
        original.client_id
      );
      if (!current) return "invalid";
      const user = this.#users.findById(current.user_id);
      if (user?.lifecycleState !== "active") return "user_disabled";
      const now = this.#clock.now();
      if (current.consumed_at) {
        this.#revokeFamily(current.family_id, now.toISOString());
        return "replayed";
      }
      if (current.revoked_at || hasExpired(current.expires_at, now)) return "invalid";
      const consumed = this.#store.run(
        `UPDATE refresh_tokens SET consumed_at = ?, replaced_by_hash = ?
         WHERE token_hash = ? AND client_id = ? AND consumed_at IS NULL
           AND revoked_at IS NULL`,
        now.toISOString(),
        replacement.tokenHash,
        current.token_hash,
        current.client_id
      );
      if (consumed.changes !== 1) {
        const latest = this.#store.get<RefreshTokenRow>(
          `${selectRefreshToken} WHERE token_hash = ?`,
          current.token_hash
        );
        if (latest?.consumed_at) {
          this.#revokeFamily(current.family_id, now.toISOString());
          return "replayed";
        }
        return "invalid";
      }
      this.#insertPreparedGrant(prepared);
      return "success";
    });
  }

  #revokeFamily(familyId: string, revokedAt: string): void {
    this.#store.run(
      `UPDATE refresh_tokens SET revoked_at = ?
       WHERE family_id = ? AND revoked_at IS NULL`,
      revokedAt,
      familyId
    );
    this.#store.run(
      `UPDATE oauth_access_tokens SET revoked_at = ?
       WHERE family_id = ? AND revoked_at IS NULL`,
      revokedAt,
      familyId
    );
  }

  #refreshScope(originalScope: string, requestedScope: string | undefined): string {
    if (requestedScope === undefined) return originalScope;
    const normalized = normalizeScope(requestedScope);
    if (!normalized) throw new OAuthError("INVALID_SCOPE", "Scope cannot be empty.");
    const original = new Set(originalScope.split(/\s+/).filter(Boolean));
    if (normalized.split(/\s+/).some((scope) => !original.has(scope))) {
      throw new OAuthError(
        "INVALID_SCOPE",
        "Refresh-token scope cannot exceed the originally granted scope."
      );
    }
    return normalized;
  }

  #tokenResponse(prepared: PreparedTokenGrant): OAuthTokenResponse {
    return {
      accessToken: prepared.accessToken,
      ...(prepared.idToken ? { idToken: prepared.idToken } : {}),
      ...(prepared.refreshToken ? { refreshToken: prepared.refreshToken } : {}),
      expiresIn: prepared.expiresIn,
      scope: prepared.scope,
      tokenType: "Bearer",
    };
  }

  async #authenticateClient(
    clientId: string,
    clientSecret: string | undefined
  ): Promise<void> {
    if (
      clientSecret === undefined ||
      !(await this.#applications.verifyClientSecret(clientId, clientSecret))
    ) {
      throw new OAuthError("BAD_CLIENT_SECRET", "Client authentication failed.");
    }
  }

  #activeUser(userId: string): UserRecord | undefined {
    const user = this.#users.findById(userId);
    return user?.lifecycleState === "active" ? user : undefined;
  }

  #disabledUser(): never {
    throw new OAuthError("USER_DISABLED", "User account is disabled.");
  }

  #invalidRefreshToken(): never {
    throw new OAuthError("INVALID_GRANT", "Refresh token is invalid or expired.");
  }

  #issuer(issuerBase: string): string {
    return this.#profile.urls.issuer({ issuerBase, tenantId: this.#tenantId });
  }
}
