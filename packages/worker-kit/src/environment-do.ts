import { DurableObject } from "cloudflare:workers";
import {
  type ApplicationRegistration,
  type AssertionResult,
  type AssertionSpec,
  type ClearScenarioResult,
  type CreateApplicationInput,
  type EnvironmentConfig,
  type EnvironmentPatch,
  environmentConfigSchema,
  environmentPatchSchema,
  type IdentitySeed,
  identitySeedSchema,
  type MintedToken,
  type MintTokenRequest,
  mintTokenRequestSchema,
  type RequestLogPage,
  type RequestLogQuery,
  type ScenarioSpec,
  type WellKnownUrls,
  wellKnownUrlsSchema,
} from "@mockos/contracts";
import {
  applyMigrations,
  DeviceAuthorizationError,
  decodeJwt,
  Engine,
  MAX_REQUEST_LOG_BODY_BYTES,
  OAuthError,
  type RenderedProviderError,
  type UserRecord,
} from "@mockos/core";
import {
  createEntraHttpApp,
  createOktaHttpApp,
  type EntraAuthorizationLogin,
  type EntraAuthorizationRequest,
  type EntraHttpEngine,
  type EntraTokenRequest,
  OAuthProtocolError,
  type OktaAuthorizationLogin,
  type OktaAuthorizationRequest,
  type OktaHttpEngine,
  type OktaRenderedError,
} from "@mockos/engine-http";
import { DoSqlStore } from "./do-sql-store";

const CONFIG_KEY = "environment_config";
const LAST_ACTIVITY_KEY = "last_activity";
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const MAX_CAPTURE_HEADER_BYTES = 48 * 1_024;
const MAX_CAPTURE_BODY_BYTES = MAX_REQUEST_LOG_BODY_BYTES - 1_024;
const BODY_TRUNCATED_MARKER = "\n[mockOS capture truncated]";
const JSON_MUTATION_INJECTION_POINTS = new Set([
  "oidc.discovery",
  "oidc.jwks",
  "oauth.token",
  "oauth.device",
  "oauth.introspect",
]);

type MetaRow = { key: string; value: string };

export type SeedIdentitiesResult = {
  groups: Array<{ displayName: string; id: string }>;
  users: Array<{ id: string; userName: string }>;
};

const validatedUrl = (value: string) => {
  new URL(value);
  return value;
};

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
  if (!user.accountEnabled || user.softDeletedAt) {
    throw new OAuthProtocolError("USER_DISABLED");
  }
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

const createEntraHttpEngine = (engine: Engine): EntraHttpEngine => {
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
      redirectUri = validatedUrl(input.redirectUri);
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
    if (
      !input.codeChallenge ||
      input.codeChallengeMethod !== "S256" ||
      !PKCE_CHALLENGE.test(input.codeChallenge)
    ) {
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
        redirectUri: validatedUrl(input.redirectUri),
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
        redirectUri: validatedUrl(
          requireAuthorizationField(input.redirectUri, "redirect_uri")
        ),
        codeVerifier: requireAuthorizationField(input.codeVerifier, "code_verifier"),
        issuerBase: input.issuerBase,
      });
    },
  };
};

const createOktaHttpEngine = (engine: Engine): OktaHttpEngine => {
  const validateAuthorizationRequest = (input: OktaAuthorizationRequest) => {
    const application = engine.applications.findByClientId(input.clientId);
    if (!application) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        `Application with identifier '${input.clientId}' was not found.`
      );
    }
    try {
      validatedUrl(input.redirectUri);
    } catch (cause) {
      throw new OAuthProtocolError("BAD_REDIRECT_URI", undefined, { cause });
    }
    if (!application.redirectUris.includes(input.redirectUri)) {
      throw new OAuthProtocolError("BAD_REDIRECT_URI");
    }
    if (!application.grantTypes.includes("authorization_code")) {
      throw new OAuthProtocolError("UNSUPPORTED_GRANT");
    }
    if (!input.scope.trim()) {
      throw new OAuthProtocolError("INVALID_SCOPE");
    }
    if (
      input.codeChallengeMethod !== "S256" ||
      !PKCE_CHALLENGE.test(input.codeChallenge)
    ) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        "PKCE with a valid S256 code challenge is required."
      );
    }
  };

  const authenticate = async (input: { username: string; password: string }) => {
    const candidate = engine.users.findByUserName(input.username);
    validateUserState(candidate);
    const user = await engine.users.authenticate(input.username, input.password);
    if (!user) throw new OAuthProtocolError("INVALID_GRANT");
    return user;
  };

  const renderError = (error: unknown): OktaRenderedError => {
    if (error instanceof DeviceAuthorizationError) {
      const shell = engine.renderError("INVALID_REQUEST", undefined, "oauth");
      return { ...shell, status: error.status, body: error.toBody() };
    }
    if (error instanceof OAuthProtocolError) {
      const rendered = engine.renderError(error.semanticCode, error.message, "oauth");
      return {
        ...rendered,
        status: error.status ?? rendered.status,
        body: error.oauthError
          ? { ...rendered.body, error: error.oauthError }
          : rendered.body,
      };
    }
    if (error instanceof OAuthError) {
      return engine.renderError(error.code, error.message, "oauth");
    }
    const shell = engine.renderError("INVALID_REQUEST", undefined, "oauth");
    return {
      ...shell,
      status: 500,
      body: {
        error: "server_error",
        error_description:
          "The authorization server encountered an unexpected condition.",
      },
    };
  };

  return {
    discovery: (issuerBase) => engine.discovery(issuerBase),
    jwks: () => engine.jwks(),
    validateAuthorizationRequest,
    async authorize(input: OktaAuthorizationLogin) {
      validateAuthorizationRequest(input);
      const user = await authenticate(input);
      return engine.oauth.createAuthorizationCode({
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        userId: user.id,
        scope: input.scope,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: "S256",
        ...(input.nonce ? { nonce: input.nonce } : {}),
      });
    },
    async activateDeviceAuthorization(input) {
      const user = await authenticate(input);
      engine.oauth.activateDeviceAuthorization(input.userCode, user.id);
    },
    createDeviceAuthorization: (input) => engine.oauth.createDeviceAuthorization(input),
    pollDeviceAuthorization: ({ grantType: _grantType, ...input }) =>
      engine.oauth.pollDeviceAuthorization(input),
    redeemAuthorizationCode: ({ grantType: _grantType, ...input }) =>
      engine.oauth.redeemAuthorizationCode(input),
    introspect: (input) => engine.oauth.introspectToken(input),
    revoke: (input) => engine.oauth.revokeToken(input),
    renderError,
  };
};

const headersRecord = (
  headers: Headers,
  options: { redactAuthorization?: boolean } = {}
): Record<string, string> => {
  const captured: Record<string, string> = {};
  for (const [name, rawValue] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (normalizedName.startsWith("x-mockos-")) continue;
    const value =
      normalizedName === "x-api-key" ||
      (normalizedName === "authorization" && options.redactAuthorization)
        ? "[REDACTED]"
        : rawValue;
    const candidate = { ...captured, [normalizedName]: value };
    if (
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
      MAX_CAPTURE_HEADER_BYTES
    ) {
      captured["x-mockos-log-truncated"] = "true";
      break;
    }
    captured[normalizedName] = value;
  }
  return captured;
};

const readBoundedBody = async (body: ReadableStream<Uint8Array> | null) => {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_CAPTURE_BODY_BYTES - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        total += Math.max(remaining, 0);
        truncated = true;
        // A cloned body is a tee branch. Awaiting cancellation can deadlock
        // until the branch returned to the caller is consumed.
        void reader
          .cancel("mockOS request-log capture limit reached")
          .catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    return "[mockOS capture unavailable]";
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded = new TextDecoder().decode(combined);
  const encoder = new TextEncoder();
  const markerBytes = encoder.encode(BODY_TRUNCATED_MARKER).byteLength;
  const needsUtf8Trim = encoder.encode(decoded).byteLength > MAX_CAPTURE_BODY_BYTES;
  if (!truncated && !needsUtf8Trim) return decoded;
  const available = MAX_CAPTURE_BODY_BYTES - markerBytes;
  let low = 0;
  let high = decoded.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(decoded.slice(0, middle)).byteLength <= available) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${decoded.slice(0, low)}${BODY_TRUNCATED_MARKER}`;
};

const protocolPath = (request: Request) => {
  const routed = request.headers.get("x-mockos-public-path");
  if (routed?.startsWith("/") && !routed.startsWith("//")) {
    const parsed = new URL(routed, "https://mockos.invalid");
    if (parsed.origin === "https://mockos.invalid" && !parsed.search && !parsed.hash) {
      return parsed.pathname;
    }
  }
  return new URL(request.url).pathname;
};

const injectionPointFor = (pathname: string): string => {
  if (pathname.endsWith("/.well-known/openid-configuration")) {
    return "oidc.discovery";
  }
  if (pathname.endsWith("/discovery/v2.0/keys") || pathname.endsWith("/v1/keys")) {
    return "oidc.jwks";
  }
  if (pathname.endsWith("/oauth2/v2.0/token") || pathname.endsWith("/v1/token")) {
    return "oauth.token";
  }
  if (
    pathname.endsWith("/oauth2/v2.0/authorize") ||
    pathname.endsWith("/v1/authorize")
  ) {
    return "oauth.authorize";
  }
  if (pathname.endsWith("/v1/device/authorize")) return "oauth.device";
  if (pathname.endsWith("/v1/introspect")) return "oauth.introspect";
  if (pathname.endsWith("/v1/revoke")) return "oauth.revoke";
  if (pathname.endsWith("/activate")) return "oauth.device.activate";
  return "http.request";
};

const responseFromRenderedError = (
  provider: EnvironmentConfig["provider"],
  rendered: RenderedProviderError
) => {
  const headers = new Headers(rendered.headers);
  if (provider === "entra" && !headers.has("x-ms-request-id")) {
    const traceId = rendered.body.trace_id;
    if (typeof traceId === "string") headers.set("x-ms-request-id", traceId);
  }
  return new Response(JSON.stringify(rendered.body), {
    status: rendered.status,
    headers,
  });
};

const mutateResponse = async (
  response: Response,
  patch: Readonly<Record<string, unknown>>
) => {
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new Error("Mutation scenarios require a JSON response.");
  }
  const body = await response.clone().json<unknown>();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Mutation scenarios require a JSON object response.");
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ...body, ...patch }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const corruptSignature = (token: string) => {
  const parts = token.split(".");
  const signature = parts[2];
  if (parts.length !== 3 || !signature) throw new Error("Expected a compact JWT.");
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  return parts.join(".");
};

/** One isolated identity engine and SQLite database per mock environment. */
export class EnvironmentDurableObject extends DurableObject {
  readonly #store: DoSqlStore;
  #enginePromise: Promise<Engine> | undefined;
  #httpApp:
    | {
        app:
          | ReturnType<typeof createEntraHttpApp>
          | ReturnType<typeof createOktaHttpApp>;
        generation: number;
      }
    | undefined;
  #configGeneration = 0;
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
    const promise = (async () => {
      const engine = Engine.create(config, { store: this.#store });
      await engine.initialize();
      return engine;
    })();
    this.#enginePromise = promise;
    try {
      return await promise;
    } catch (error) {
      if (this.#enginePromise === promise) this.#enginePromise = undefined;
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
    this.#configGeneration += 1;
    this.#enginePromise = undefined;
    this.#httpApp = undefined;
    await this.#engine();
    await this.#touch(config);
    return config;
  }

  getConfig(): EnvironmentConfig | undefined {
    return this.#readConfig();
  }

  async updateConfiguration(input: EnvironmentPatch): Promise<EnvironmentConfig> {
    const patch = environmentPatchSchema.parse(input);
    const existing = this.#readConfig();
    if (!existing) throw new Error("Environment has not been configured.");
    const config = environmentConfigSchema.parse({ ...existing, ...patch });
    this.#store.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      CONFIG_KEY,
      JSON.stringify(config)
    );
    this.#configGeneration += 1;
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

  async mintToken(input: MintTokenRequest, issuerBase: string): Promise<MintedToken> {
    const request = mintTokenRequestSchema.parse(input);
    const issuer = new URL(issuerBase);
    const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (
      (issuer.protocol !== "https:" && !loopback.has(issuer.hostname)) ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    ) {
      throw new Error("Token issuer base must be a trusted HTTPS or loopback URL.");
    }
    const validatedIssuerBase = issuer.toString().replace(/\/$/, "");
    const engine = await this.#engine();
    const user =
      engine.users.findById(request.subject) ??
      engine.users.findByUserName(request.subject);
    if (!user) throw new Error(`Unknown token subject: ${request.subject}`);
    const now = Math.floor(engine.clock.now().getTime() / 1_000);
    const defaultExpiresAt = now + engine.provider.tokenPolicy.idTokenLifetimeSeconds;
    const additionalClaims: Record<string, unknown> = {
      ...(request.audience ? { aud: request.audience } : {}),
    };
    switch (request.broken) {
      case "expired":
        additionalClaims.iat = now - 3_600;
        additionalClaims.nbf = now - 3_600;
        additionalClaims.exp = now - 60;
        break;
      case "wrong_audience":
        additionalClaims.aud = `https://wrong-audience.mockos.invalid/${encodeURIComponent(
          request.clientId
        )}`;
        break;
      case "not_yet_valid":
        additionalClaims.nbf = now + 3_600;
        additionalClaims.exp = now + 7_200;
        break;
      case "wrong_issuer":
        additionalClaims.iss = "https://wrong-issuer.mockos.invalid";
        break;
      case "bad_signature":
      case undefined:
        break;
    }
    let token = await engine.issueIdToken({
      issuerBase: validatedIssuerBase,
      clientId: request.clientId,
      userId: user.id,
      additionalClaims,
    });
    const claims = decodeJwt(token).payload;
    if (request.broken === "bad_signature") token = corruptSignature(token);
    const expiresAtSeconds =
      typeof claims.exp === "number" ? claims.exp : defaultExpiresAt;
    await this.#touch();
    return {
      token,
      tokenType: "Bearer",
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      claims,
      ...(request.broken ? { broken: request.broken } : {}),
    };
  }

  async setScenario(input: ScenarioSpec): Promise<ScenarioSpec> {
    if (
      input.action.type === "mutate" &&
      !JSON_MUTATION_INJECTION_POINTS.has(input.injectionPoint)
    ) {
      throw new Error(
        "Identity-protocol mutation scenarios require a JSON injection point."
      );
    }
    const engine = await this.#engine();
    const scenario = engine.setScenario(input);
    await this.#touch();
    return scenario;
  }

  async clearScenario(scenarioId?: string): Promise<ClearScenarioResult> {
    const engine = await this.#engine();
    const result = engine.clearScenario(scenarioId);
    await this.#touch();
    return result;
  }

  async getRequestLog(query: RequestLogQuery): Promise<RequestLogPage> {
    const engine = await this.#engine();
    const result = engine.getRequestLog(query);
    await this.#touch();
    return result;
  }

  async assertRequests(assertion: AssertionSpec): Promise<AssertionResult> {
    const engine = await this.#engine();
    const result = engine.assertRequests(assertion);
    await this.#touch();
    return result;
  }

  async getWellKnownUrls(
    publicBase: string,
    issuerBase: string
  ): Promise<WellKnownUrls> {
    const engine = await this.#engine();
    const context = { issuerBase, tenantId: engine.tenantId };
    const urls = engine.provider.urls;
    const result = wellKnownUrlsSchema.parse({
      issuer: urls.issuer(context),
      openidConfiguration: urls.discovery(context),
      authorizationEndpoint: urls.authorization(context),
      tokenEndpoint: urls.token(context),
      jwksUri: urls.jwks(context),
      scimBaseUrl: `${publicBase.replace(/\/+$/, "")}/scim/v2`,
      userinfoEndpoint: urls.userInfo(context),
      ...(urls.introspection
        ? { introspectionEndpoint: urls.introspection(context) }
        : {}),
      ...(urls.revocation ? { revocationEndpoint: urls.revocation(context) } : {}),
      ...(urls.deviceAuthorization
        ? { deviceAuthorizationEndpoint: urls.deviceAuthorization(context) }
        : {}),
    });
    await this.#touch();
    return result;
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#schemaReady = false;
    this.#configGeneration += 1;
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
    const generation = this.#configGeneration;
    const config = this.#readConfig();
    if (!config) {
      return Response.json({ error: "environment_not_configured" }, { status: 409 });
    }
    const engine = await this.#engine();
    if (generation !== this.#configGeneration) return this.fetch(request);
    let httpApp =
      this.#httpApp?.generation === generation ? this.#httpApp.app : undefined;
    if (!httpApp) {
      httpApp =
        config.provider === "entra"
          ? createEntraHttpApp({ engine: createEntraHttpEngine(engine) })
          : createOktaHttpApp({ engine: createOktaHttpEngine(engine) });
      if (generation === this.#configGeneration) {
        this.#httpApp = { app: httpApp, generation };
      }
    }

    const startedAt = Date.now();
    const path = protocolPath(request);
    const requestBodyPromise = readBoundedBody(request.clone().body);
    const decision = engine.scenarios.decide(injectionPointFor(path), {
      method: request.method,
      path,
      provider: config.provider,
    });
    let response: Response;
    if (decision.type === "delay") {
      await new Promise((resolve) => setTimeout(resolve, decision.milliseconds));
      response = await httpApp.fetch(request);
    } else if (decision.type === "error") {
      if (request.body) void request.body.cancel().catch(() => undefined);
      response = responseFromRenderedError(
        config.provider,
        engine.renderError(decision.code, undefined, "oauth")
      );
    } else {
      response = await httpApp.fetch(request);
      if (decision.type === "mutate") {
        response = await mutateResponse(response, decision.patch);
      }
    }

    const [requestBody, responseBody] = await Promise.all([
      requestBodyPromise,
      readBoundedBody(response.clone().body),
    ]);
    const responseHeaders = headersRecord(response.headers);
    const responseJson = (() => {
      if (!responseBody) return undefined;
      try {
        const value = JSON.parse(responseBody) as unknown;
        return value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    })();
    const correlationId =
      response.headers.get("x-ms-request-id") ??
      response.headers.get("x-okta-request-id") ??
      (typeof responseJson?.correlation_id === "string"
        ? responseJson.correlation_id
        : undefined) ??
      (typeof responseJson?.errorId === "string" ? responseJson.errorId : undefined) ??
      crypto.randomUUID();
    try {
      engine.requestLog.append({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        source: "inbound",
        provider: config.provider,
        method: request.method,
        path,
        requestHeaders: headersRecord(request.headers, {
          redactAuthorization:
            request.headers.get("x-mockos-redact-authorization") === "true",
        }),
        requestBody,
        responseStatus: response.status,
        responseHeaders,
        responseBody,
        durationMs: Math.max(0, Date.now() - startedAt),
        correlationId,
      });
    } catch (error) {
      // Protocol availability wins over diagnostic retention. The bounded ring
      // trims proactively, but an external storage failure must not replace a
      // provider response that was already computed successfully.
      console.error(
        "mockOS request-log append failed",
        error instanceof Error ? error.name : "UnknownError"
      );
    }
    await this.#touch();
    return response;
  }
}
