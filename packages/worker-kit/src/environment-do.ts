import { DurableObject } from "cloudflare:workers";
import {
  type ApplicationRegistration,
  type CreateApplicationInput,
  type EnvironmentConfig,
  environmentConfigSchema,
  type IdentitySeed,
  identitySeedSchema,
} from "@mockos/contracts";
import { applyMigrations, Engine, type UserRecord } from "@mockos/core";
import {
  createEntraHttpApp,
  type EntraAuthorizationLogin,
  type EntraAuthorizationRequest,
  type EntraHttpEngine,
  type EntraTokenRequest,
  OAuthProtocolError,
} from "@mockos/engine-http";
import { DoSqlStore } from "./do-sql-store";

const CONFIG_KEY = "environment_config";
const LAST_ACTIVITY_KEY = "last_activity";

type MetaRow = { key: string; value: string };

export type SeedIdentitiesResult = {
  groups: Array<{ displayName: string; id: string }>;
  users: Array<{ id: string; userName: string }>;
};

const normalizedUrl = (value: string) => new URL(value).toString();

const requireAuthorizationField = (value: string | undefined, name: string) => {
  if (!value) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      `The request body must contain the following parameter: '${name}'.`
    );
  }
  return value;
};

const validateUserState = (user: UserRecord | undefined) => {
  if (!user) throw new OAuthProtocolError("INVALID_GRANT");
  if (!user.accountEnabled) throw new OAuthProtocolError("USER_DISABLED");
  if (user.passwordState !== "valid") {
    throw new OAuthProtocolError("PASSWORD_EXPIRED");
  }
  if (user.mfaState === "required") {
    throw new OAuthProtocolError("MFA_REQUIRED");
  }
};

const applicationRegistration = (
  application: Awaited<ReturnType<Engine["applications"]["create"]>>
): ApplicationRegistration => ({
  id: application.id,
  name: application.name,
  clientId: application.clientId,
  clientSecret: application.clientSecret,
  redirectUris: [...application.redirectUris],
  grantTypes: [...application.grantTypes],
  appRoles: [...application.appRoles],
  groupClaimsMode: application.groupClaimsMode,
  createdAt: application.createdAt,
});

const createHttpEngine = (engine: Engine): EntraHttpEngine => {
  const validateAuthorizationRequest = (input: EntraAuthorizationRequest) => {
    const application = engine.applications.findByClientId(input.clientId);
    if (!application) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        `Application with identifier '${input.clientId}' was not found.`
      );
    }
    let redirectUri: string;
    try {
      redirectUri = normalizedUrl(input.redirectUri);
    } catch (cause) {
      throw new OAuthProtocolError("BAD_REDIRECT_URI", undefined, { cause });
    }
    if (!application.redirectUris.includes(redirectUri)) {
      throw new OAuthProtocolError("BAD_REDIRECT_URI");
    }
    if (!application.grantTypes.includes("authorization_code")) {
      throw new OAuthProtocolError("UNSUPPORTED_GRANT");
    }
    if (!input.scope.split(/\s+/).includes("openid")) {
      throw new OAuthProtocolError(
        "INVALID_SCOPE",
        "The openid scope is required for this OIDC endpoint."
      );
    }
    if (!input.codeChallenge || input.codeChallengeMethod !== "S256") {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        "PKCE with code_challenge_method=S256 is required."
      );
    }
  };

  return {
    tenantId: engine.tenantId,
    discovery: (issuerBase) => engine.discovery(issuerBase),
    jwks: () => engine.jwks(),
    validateAuthorizationRequest,
    async authorize(input: EntraAuthorizationLogin) {
      validateAuthorizationRequest(input);
      const candidate = engine.users.findByUserName(input.username);
      validateUserState(candidate);
      const user = await engine.users.authenticate(input.username, input.password);
      if (!user) throw new OAuthProtocolError("INVALID_GRANT");
      return engine.oauth.createAuthorizationCode({
        clientId: input.clientId,
        redirectUri: normalizedUrl(input.redirectUri),
        userId: user.id,
        scope: input.scope,
        codeChallenge: requireAuthorizationField(input.codeChallenge, "code_challenge"),
        codeChallengeMethod: "S256",
        nonce: input.nonce,
      });
    },
    async token(input: EntraTokenRequest) {
      if (input.grantType !== "authorization_code") {
        throw new OAuthProtocolError("UNSUPPORTED_GRANT");
      }
      return engine.oauth.redeemAuthorizationCode({
        code: requireAuthorizationField(input.code, "code"),
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        redirectUri: requireAuthorizationField(input.redirectUri, "redirect_uri"),
        codeVerifier: requireAuthorizationField(input.codeVerifier, "code_verifier"),
        issuerBase: input.issuerBase,
      });
    },
  };
};

/** One isolated identity engine and SQLite database per mock environment. */
export class EnvironmentDurableObject extends DurableObject {
  readonly #store: DoSqlStore;
  #enginePromise: Promise<Engine> | undefined;
  #httpApp: ReturnType<typeof createEntraHttpApp> | undefined;
  #schemaReady = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#store = new DoSqlStore(ctx.storage);
    this.#ensureSchema();
  }

  #ensureSchema() {
    if (this.#schemaReady) return;
    applyMigrations(this.#store);
    this.#schemaReady = true;
  }

  #readConfig(): EnvironmentConfig | undefined {
    this.#ensureSchema();
    const row = this.#store.get<MetaRow & Record<string, string>>(
      "SELECT key, value FROM meta WHERE key = ?",
      CONFIG_KEY
    );
    return row ? environmentConfigSchema.parse(JSON.parse(row.value)) : undefined;
  }

  async #engine(): Promise<Engine> {
    if (this.#enginePromise) return this.#enginePromise;
    const config = this.#readConfig();
    if (!config) throw new Error("Environment has not been configured.");
    this.#enginePromise = (async () => {
      const engine = Engine.create(config, { store: this.#store });
      await engine.initialize();
      return engine;
    })();
    try {
      return await this.#enginePromise;
    } catch (error) {
      this.#enginePromise = undefined;
      throw error;
    }
  }

  async #touch(config = this.#readConfig()) {
    if (!config) return;
    const now = Date.now();
    this.#store.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      LAST_ACTIVITY_KEY,
      new Date(now).toISOString()
    );
    await this.ctx.storage.setAlarm(now + config.idleTtlHours * 60 * 60 * 1_000);
  }

  async configure(input: EnvironmentConfig): Promise<EnvironmentConfig> {
    this.#ensureSchema();
    const config = environmentConfigSchema.parse(input);
    const existing = this.#readConfig();
    if (
      existing &&
      (existing.id !== config.id ||
        existing.provider !== config.provider ||
        existing.tenantId !== config.tenantId ||
        existing.seed !== config.seed)
    ) {
      throw new Error(
        "Environment id, provider, tenant id, and seed are immutable after configuration."
      );
    }
    this.#store.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      CONFIG_KEY,
      JSON.stringify(config)
    );
    this.#enginePromise = undefined;
    this.#httpApp = undefined;
    await this.#engine();
    await this.#touch(config);
    return config;
  }

  async seedIdentities(input: IdentitySeed): Promise<SeedIdentitiesResult> {
    const seed = identitySeedSchema.parse(input);
    const engine = await this.#engine();
    const users: SeedIdentitiesResult["users"] = [];
    for (const user of seed.users) {
      const created = await engine.users.create({
        ...user,
        accountEnabled: user.active,
      });
      users.push({ id: created.id, userName: created.userName });
    }
    const groups: SeedIdentitiesResult["groups"] = [];
    for (const group of seed.groups) {
      const created = engine.groups.create(group);
      groups.push({ id: created.id, displayName: created.displayName });
      for (const member of group.members) {
        const user = engine.users.findByUserName(member);
        if (!user) throw new Error(`Unknown group member: ${member}`);
        engine.groups.addMember(created.id, user.id);
      }
    }
    await this.#touch();
    return { users, groups };
  }

  seed(input: IdentitySeed): Promise<SeedIdentitiesResult> {
    return this.seedIdentities(input);
  }

  async createApplication(
    input: CreateApplicationInput
  ): Promise<ApplicationRegistration> {
    const engine = await this.#engine();
    const created = await engine.applications.create(input);
    await this.#touch();
    return applicationRegistration(created);
  }

  async getWellKnown(issuerBase: string): Promise<Record<string, unknown>> {
    const issuer = new URL(issuerBase).toString().replace(/\/$/, "");
    const engine = await this.#engine();
    await this.#touch();
    return engine.discovery(issuer);
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#schemaReady = false;
    this.#enginePromise = undefined;
    this.#httpApp = undefined;
  }

  override async alarm(): Promise<void> {
    const config = this.#readConfig();
    if (!config) return;
    const row = this.#store.get<MetaRow & Record<string, string>>(
      "SELECT key, value FROM meta WHERE key = ?",
      LAST_ACTIVITY_KEY
    );
    const lastActivity = Date.parse(row?.value ?? config.createdAt);
    const expiresAt = lastActivity + config.idleTtlHours * 60 * 60 * 1_000;
    if (expiresAt <= Date.now()) {
      await this.purge();
      return;
    }
    await this.ctx.storage.setAlarm(expiresAt);
  }

  override async fetch(request: Request): Promise<Response> {
    const config = this.#readConfig();
    if (!config) {
      return Response.json({ error: "environment_not_configured" }, { status: 409 });
    }
    if (config.provider !== "entra") {
      return Response.json({ error: "provider_not_implemented" }, { status: 501 });
    }
    const engine = await this.#engine();
    this.#httpApp ??= createEntraHttpApp({ engine: createHttpEngine(engine) });
    this.ctx.waitUntil(this.#touch(config));
    return this.#httpApp.fetch(request);
  }
}
