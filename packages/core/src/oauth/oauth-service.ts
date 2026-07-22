import type { Clock, Rng } from "../determinism";
import type {
  ApplicationRepository,
  GroupRepository,
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
};

type RefreshTokenRow = SqlRow & {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

const unixSeconds = (value: string): number =>
  Math.floor(new Date(value).getTime() / 1_000);

const tokenId = (prefix: string, rng: Rng): string => {
  const stem = prefix.replace(/[._-]+$/, "") || "token";
  return randomId(stem, rng).replace(`${stem}_`, prefix);
};

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
       revoked_at FROM oauth_access_tokens WHERE token_hash = ?`,
      tokenHash
    );
    if (access) {
      if (
        access.client_id !== input.clientId ||
        access.revoked_at ||
        new Date(access.expires_at).getTime() <= this.#clock.now().getTime()
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
      `SELECT token_hash, client_id, user_id, scope, issued_at, expires_at,
       consumed_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`,
      tokenHash
    );
    if (
      !refresh ||
      refresh.client_id !== input.clientId ||
      refresh.consumed_at ||
      refresh.revoked_at ||
      new Date(refresh.expires_at).getTime() <= this.#clock.now().getTime()
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
      this.#store.run(
        `UPDATE refresh_tokens SET revoked_at = ?
         WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
        now,
        tokenHash,
        input.clientId
      );
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
    if (!user.accountEnabled || user.softDeletedAt) {
      throw new OAuthError("USER_DISABLED", "User account is disabled.");
    }
    const application = this.#applications.requireByClientId(input.clientId);
    const scopes = input.scope.split(/\s+/).filter(Boolean);
    const issuer = this.#issuer(input.issuerBase);
    const issuedAt = Math.floor(this.#clock.now().getTime() / 1_000);
    const accessExpiresAt =
      issuedAt + this.#profile.tokenPolicy.accessTokenLifetimeSeconds;
    const memberships = this.#groups.listForUser(user.id);
    const groups = memberships.map((group) => group.id);
    const groupNames = memberships.map((group) => group.displayName);
    const accessTokenId = tokenId(
      this.#profile.tokenPolicy.accessTokenIdPrefix ?? "AT_",
      this.#rng
    );
    const accessClaims = this.#profile.claims({
      issuer,
      tenantId: this.#tenantId,
      clientId: application.clientId,
      user,
      issuedAt,
      expiresAt: accessExpiresAt,
      tokenKind: "access",
      tokenId: accessTokenId,
      authTime: issuedAt,
      scopes,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      groups,
      groupNames,
    });
    const accessToken = await this.#keys.sign({
      ...accessClaims,
      scp:
        this.#profile.tokenPolicy.scopeClaimFormat === "array" ? scopes : input.scope,
      ...(this.#profile.tokenPolicy.includeTokenUseClaim === false
        ? {}
        : { token_use: "access" }),
    });
    this.#store.run(
      `INSERT INTO oauth_access_tokens (
        token_hash, client_id, user_id, scope, jti, issued_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      await hashSecret(accessToken),
      application.clientId,
      user.id,
      input.scope,
      accessTokenId,
      new Date(issuedAt * 1_000).toISOString(),
      new Date(accessExpiresAt * 1_000).toISOString()
    );

    let idToken: string | undefined;
    if (scopes.includes("openid")) {
      const idExpiresAt = issuedAt + this.#profile.tokenPolicy.idTokenLifetimeSeconds;
      const idClaims = this.#profile.claims({
        issuer,
        tenantId: this.#tenantId,
        clientId: application.clientId,
        user,
        issuedAt,
        expiresAt: idExpiresAt,
        tokenKind: "id",
        tokenId: tokenId(this.#profile.tokenPolicy.idTokenIdPrefix ?? "ID_", this.#rng),
        authTime: issuedAt,
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

    let refreshToken: string | undefined;
    if (
      scopes.includes("offline_access") &&
      application.grantTypes.includes("refresh_token")
    ) {
      refreshToken = randomId("refresh", this.#rng);
      const now = this.#clock.now();
      this.#store.run(
        `INSERT INTO refresh_tokens (
          token_hash, family_id, client_id, user_id, scope, issued_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        await hashSecret(refreshToken),
        randomId("family", this.#rng),
        application.clientId,
        user.id,
        input.scope,
        now.toISOString(),
        new Date(
          now.getTime() + this.#profile.tokenPolicy.refreshTokenLifetimeSeconds * 1_000
        ).toISOString()
      );
    }
    return {
      accessToken,
      ...(idToken ? { idToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      expiresIn: this.#profile.tokenPolicy.accessTokenLifetimeSeconds,
      scope: input.scope,
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

  #activeUser(userId: string) {
    const user = this.#users.findById(userId);
    return user?.accountEnabled && !user.softDeletedAt ? user : undefined;
  }

  #issuer(issuerBase: string): string {
    return this.#profile.urls.issuer({ issuerBase, tenantId: this.#tenantId });
  }
}
