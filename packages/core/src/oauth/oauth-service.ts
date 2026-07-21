import type { Clock, Rng } from "../determinism";
import type {
  ApplicationRepository,
  GroupRepository,
  UserRepository,
} from "../directory";
import type { SigningKeyService } from "../keys";
import type { ProviderProfile } from "../providers";
import { hashSecret, randomId } from "../security";
import type { SqlStore } from "../store";
import {
  AuthorizationCodeService,
  type CreateAuthorizationCodeInput,
  type CreatedAuthorizationCode,
  type RedeemAuthorizationCodeInput,
} from "./authorization-code";

export interface RedeemAuthorizationCodeForTokensInput
  extends RedeemAuthorizationCodeInput {
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
    const user = this.#users.requireById(grant.userId);
    const application = this.#applications.requireByClientId(grant.clientId);
    const scopes = grant.scope.split(/\s+/);
    const issuer = this.#profile.urls.issuer({
      issuerBase: input.issuerBase,
      tenantId: this.#tenantId,
    });
    const issuedAt = Math.floor(this.#clock.now().getTime() / 1_000);
    const expiresAt = issuedAt + this.#profile.tokenPolicy.accessTokenLifetimeSeconds;
    const groups = this.#groups.listForUser(user.id).map((group) => group.id);
    const baseClaims = this.#profile.claims({
      issuer,
      tenantId: this.#tenantId,
      clientId: application.clientId,
      user,
      issuedAt,
      expiresAt,
      ...(grant.nonce ? { nonce: grant.nonce } : {}),
      groups,
    });
    const accessToken = await this.#keys.sign({
      ...baseClaims,
      scp: grant.scope,
      token_use: "access",
    });
    const idToken = scopes.includes("openid")
      ? await this.#keys.sign({ ...baseClaims, token_use: "id" })
      : undefined;

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
        grant.scope,
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
      scope: grant.scope,
      tokenType: "Bearer",
    };
  }
}
