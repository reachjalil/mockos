import { DurableObject } from "cloudflare:workers";
import {
  type ApplicationListPage,
  applicationListPageSchema,
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
  type LifecycleAction,
  type LifecycleResult,
  type ManagementListQuery,
  managementListQuerySchema,
  type MintedToken,
  type MintTokenRequest,
  mintTokenRequestSchema,
  type ProvisioningHttpOperation,
  type ProvisioningHttpResponse,
  type ProvisioningRun,
  type ProvisioningSnapshot,
  type ProvisioningSummary,
  type ProvisioningTarget,
  type ProvisioningTargetInput,
  type ProvisioningWatermark,
  type ProvisioningWorkflowParams,
  provisioningHttpOperationSchema,
  provisioningTargetInputSchema,
  provisioningWorkflowParamsSchema,
  type RequestLogPage,
  type RequestLogQuery,
  type RunProvisioningCycleToolInput,
  runProvisioningCycleToolInputSchema,
  type ScenarioSpec,
  type ScenarioListPage,
  scenarioListPageSchema,
  type WellKnownUrls,
  wellKnownUrlsSchema,
} from "@mockos/contracts";
import {
  applyMigrations,
  brokenTokenClaimOverrides,
  corruptJwtSignature,
  DeviceAuthorizationError,
  decodeJwt,
  Engine,
  MAX_REQUEST_LOG_BODY_BYTES,
  OAuthError,
  type RenderedProviderError,
  ScimService,
  type UserRecord,
} from "@mockos/core";
import {
  createEntraHttpApp,
  createGraphHttpApp,
  createOktaAuthnApi,
  createOktaDirectoryApi,
  createOktaHttpApp,
  createScimHttpApp,
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
import {
  createGraphDirectoryEngine,
  createOktaDirectoryEngine,
} from "./directory-http";
import { DoSqlStore } from "./do-sql-store";
import { assertProvisioningPreparedOutputBounds } from "./provisioning-bounds";
import { performProvisioningHttpOperation } from "./provisioning-http";
import {
  ProvisioningPersistence,
  type StoredProvisioningExecution,
} from "./provisioning-persistence";
import type {
  ProvisioningCompensationResult,
  ProvisioningTerminalReconciliationResult,
  ProvisioningTerminalWorkflowStatus,
} from "./provisioning-start";
import {
  type OutboundTargetPolicy,
  parseOutboundBlockedHostnames,
  validateOutboundTarget,
} from "./secure-fetch";
import { trustedPublicUrl } from "./trusted-public-url";

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

type HttpApplication = {
  fetch(request: Request): Promise<Response> | Response;
};

export type SeedIdentitiesResult = {
  groups: Array<{ displayName: string; id: string }>;
  users: Array<{ id: string; userName: string }>;
};

export interface MintTokenPublicLocation {
  /** Trusted, request-derived final issuer. Never persisted. */
  readonly issuerBase: string;
  /** Trusted, request-derived Graph base. Required for Entra token minting. */
  readonly graphBaseUrl?: string;
}

export interface WellKnownPublicLocation extends MintTokenPublicLocation {
  /** Trusted environment host/path used by SCIM and directory APIs. */
  readonly directoryBaseUrl: string;
}

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
      if (input.grantType === "refresh_token") {
        return engine.oauth.redeemRefreshToken({
          refreshToken: input.refreshToken,
          clientId: input.clientId,
          issuerBase: input.issuerBase,
          graphBaseUrl: input.graphBaseUrl,
          ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
          ...(input.scope ? { scope: input.scope } : {}),
        });
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
        graphBaseUrl: input.graphBaseUrl,
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
    redeemRefreshToken: ({ grantType: _grantType, ...input }) =>
      engine.oauth.redeemRefreshToken(input),
    introspect: (input) => engine.oauth.introspectToken(input),
    revoke: (input) => engine.oauth.revokeToken(input),
    renderError,
  };
};

const headersRecord = (
  headers: Headers,
  options: { redactAuthorization?: boolean; redactSecrets?: boolean } = {}
): Record<string, string> => {
  const captured: Record<string, string> = {};
  for (const [name, rawValue] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (normalizedName.startsWith("x-mockos-")) continue;
    const sensitiveHeader =
      normalizedName === "authorization" ||
      normalizedName === "proxy-authorization" ||
      normalizedName === "cookie" ||
      normalizedName === "set-cookie" ||
      /(?:^|[-_])(?:api[-_]?key|credential|password|private[-_]?key|secret|token)(?:$|[-_])/i.test(
        normalizedName
      );
    const value =
      normalizedName === "x-api-key" ||
      (normalizedName === "authorization" && options.redactAuthorization) ||
      (options.redactSecrets && sensitiveHeader)
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
  if (pathname === "/scim/v2" || pathname.startsWith("/scim/v2/")) {
    return "scim.request";
  }
  if (pathname === "/graph/v1.0" || pathname.startsWith("/graph/v1.0/")) {
    return "graph.request";
  }
  if (pathname === "/api/v1/authn" || pathname.startsWith("/api/v1/authn/")) {
    return "okta.authn";
  }
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    return "okta.api";
  }
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

const isOktaAuthnPath = (pathname: string): boolean =>
  pathname === "/api/v1/authn" || pathname.startsWith("/api/v1/authn/");

const authenticationSecretKey = (key: string): boolean => {
  const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
  if (normalized === "errorcode" || normalized === "passwordchanged") return false;
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "credential" ||
    normalized === "credentials" ||
    normalized === "code" ||
    normalized === "apikey" ||
    normalized === "privatekey" ||
    normalized.startsWith("password") ||
    normalized.endsWith("passcode") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
};

const redactAuthenticationSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactAuthenticationSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      authenticationSecretKey(key) ? "[REDACTED]" : redactAuthenticationSecrets(entry),
    ])
  );
};

const authenticationBodyForLog = (
  pathname: string,
  body: string | null
): string | null => {
  if (!isOktaAuthnPath(pathname) || body === null) return body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "[REDACTED authentication body]";
    }
    return JSON.stringify(redactAuthenticationSecrets(parsed));
  } catch {
    return "[REDACTED authentication body]";
  }
};

const scenarioErrorResponse = (
  engine: Engine,
  config: EnvironmentConfig,
  path: string,
  code: Parameters<Engine["renderError"]>[0]
) => {
  if (path === "/api/v1" || path.startsWith("/api/v1/")) {
    return responseFromRenderedError(
      config.provider,
      engine.renderError(code, undefined, "api")
    );
  }
  if (path === "/scim/v2" || path.startsWith("/scim/v2/")) {
    const status = code === "RATE_LIMITED" ? 429 : 400;
    return Response.json(
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: String(status),
        detail:
          code === "RATE_LIMITED"
            ? "The mock SCIM service has exceeded its configured rate limit."
            : `The injected SCIM request failed with ${code}.`,
      },
      {
        status,
        headers: {
          "content-type": "application/scim+json; charset=utf-8",
          ...(status === 429 ? { "retry-after": "1" } : {}),
        },
      }
    );
  }
  if (path === "/graph/v1.0" || path.startsWith("/graph/v1.0/")) {
    const status = code === "RATE_LIMITED" ? 429 : 400;
    const requestId = crypto.randomUUID();
    return Response.json(
      {
        error: {
          code: code === "RATE_LIMITED" ? "TooManyRequests" : "BadRequest",
          message: `The injected Graph request failed with ${code}.`,
          innerError: {
            date: new Date().toISOString(),
            "request-id": requestId,
            "client-request-id": requestId,
          },
        },
      },
      {
        status,
        headers: {
          "request-id": requestId,
          ...(status === 429 ? { "retry-after": "1" } : {}),
        },
      }
    );
  }
  return responseFromRenderedError(
    config.provider,
    engine.renderError(code, undefined, "oauth")
  );
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

type ProvisioningEnvironmentVariables = {
  API_KEY?: string;
  ALLOW_INSECURE_TARGETS?: string;
  BASE_DOMAIN?: string;
  ENTRA_HOST?: string;
  OUTBOUND_BLOCKED_HOSTS?: string;
  PUBLIC_ORIGIN?: string;
  PROVISIONING_FETCHER?: Fetcher;
};

const asProvisioningEnvironment = (
  env: Cloudflare.Env
): ProvisioningEnvironmentVariables => env as ProvisioningEnvironmentVariables;

const sameProvisioningSecret = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const outboundTargetPolicy = (env: Cloudflare.Env): OutboundTargetPolicy => {
  const values = asProvisioningEnvironment(env);
  const allowInsecureTargets = values.ALLOW_INSECURE_TARGETS?.trim();
  if (
    allowInsecureTargets !== undefined &&
    allowInsecureTargets !== "true" &&
    allowInsecureTargets !== "false"
  ) {
    throw new Error("ALLOW_INSECURE_TARGETS must be 'true' or 'false'.");
  }
  const blockedHostnames = parseOutboundBlockedHostnames(values.OUTBOUND_BLOCKED_HOSTS);
  for (const value of [values.PUBLIC_ORIGIN, values.BASE_DOMAIN, values.ENTRA_HOST]) {
    if (!value) continue;
    const hostname = value.includes("://")
      ? (() => {
          const url = new URL(value);
          if (url.username || url.password) {
            throw new Error("Product origins cannot contain credentials.");
          }
          return url.hostname;
        })()
      : value;
    blockedHostnames.push(...parseOutboundBlockedHostnames(hostname));
  }
  return {
    allowInsecureTargets: allowInsecureTargets === "true",
    blockedHostnames: [...new Set(blockedHostnames)],
  };
};

const provisioningSnapshotCursor = async (
  snapshot: Omit<ProvisioningSnapshot, "cursor">
): Promise<string> => {
  const identity = {
    users: snapshot.users.map((user) => [user.id, user.version, user.deleted]),
    groups: snapshot.groups.map((group) => [
      group.id,
      group.version,
      group.deleted,
      group.memberIds,
    ]),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(identity))
  );
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `snapshot_${hex}`;
};

export type PreparedProvisioningRun = {
  readonly run: ProvisioningRun;
  readonly target: ProvisioningTarget;
  readonly snapshot: ProvisioningSnapshot;
  readonly watermark: ProvisioningWatermark;
};

export type ExecuteProvisioningOperationInput = {
  readonly runId: string;
  readonly targetRef: string;
  readonly stepSequence: number;
  readonly operation: ProvisioningHttpOperation;
};

export type ExecuteProvisioningOperationResult = {
  readonly response: ProvisioningHttpResponse;
  readonly receivedAtEpochMs: number;
};

export type CompleteProvisioningRunInput = {
  readonly runId: string;
  readonly summary: ProvisioningSummary;
  readonly watermark: ProvisioningWatermark;
};

export class UnknownProvisioningApplicationError extends Error {
  readonly code = "PROVISIONING_APPLICATION_NOT_FOUND";

  constructor() {
    super("The provisioning application was not found in this environment.");
    this.name = "UnknownProvisioningApplicationError";
  }
}

/** One isolated identity engine and SQLite database per mock environment. */
export class EnvironmentDurableObject extends DurableObject {
  readonly #store: DoSqlStore;
  readonly #provisioning: ProvisioningPersistence;
  readonly #provisioningEnvironment: ProvisioningEnvironmentVariables;
  readonly #outboundTargetPolicy: OutboundTargetPolicy;
  readonly #provisioningFetcher?: (request: Request) => Promise<Response>;
  readonly #provisioningExecutions = new Map<
    string,
    Promise<ExecuteProvisioningOperationResult>
  >();
  #enginePromise: Promise<Engine> | undefined;
  #httpApp:
    | {
        app: HttpApplication;
        generation: number;
      }
    | undefined;
  #configGeneration = 0;
  #schemaReady = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#store = new DoSqlStore(ctx.storage);
    this.#ensureSchema();
    this.#provisioning = new ProvisioningPersistence(this.#store);
    this.#provisioningEnvironment = asProvisioningEnvironment(env);
    this.#outboundTargetPolicy = outboundTargetPolicy(env);
    const provisioningFetcher = this.#provisioningEnvironment.PROVISIONING_FETCHER;
    if (provisioningFetcher) {
      this.#provisioningFetcher = (request) => provisioningFetcher.fetch(request);
    }
  }

  #assertNotPlatformCredential(bearerToken: string | undefined): void {
    const platformApiKey = this.#provisioningEnvironment.API_KEY?.trim();
    if (
      bearerToken &&
      platformApiKey &&
      sameProvisioningSecret(bearerToken, platformApiKey)
    ) {
      throw new Error(
        "The platform Access Key cannot be used as an outbound target credential."
      );
    }
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
      const { members, ...groupInput } = group;
      const memberIds = members.map((member) => {
        const user = engine.users.findByUserName(member);
        if (!user) throw new Error(`Unknown group member: ${member}`);
        return user.id;
      });
      const created = engine.groups.create({
        ...groupInput,
        memberIds,
      });
      groups.push({ id: created.id, displayName: created.displayName });
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

  async listApplications(input: ManagementListQuery): Promise<ApplicationListPage> {
    const query = managementListQuerySchema.parse(input);
    const engine = await this.#engine();
    const result = applicationListPageSchema.parse(engine.applications.listPage(query));
    await this.#touch();
    return result;
  }

  async queueProvisioningRun(
    rawParams: ProvisioningWorkflowParams,
    rawTarget: RunProvisioningCycleToolInput["target"]
  ): Promise<ProvisioningRun> {
    const params = provisioningWorkflowParamsSchema.parse(rawParams);
    const config = this.#readConfig();
    if (!config || config.id !== params.envId) {
      throw new Error("Provisioning run environment does not match this object.");
    }
    const engine = await this.#engine();
    if (!engine.applications.findById(params.appId)) {
      throw new UnknownProvisioningApplicationError();
    }
    const target = runProvisioningCycleToolInputSchema.parse({
      environmentId: params.envId,
      appId: params.appId,
      mode: params.mode,
      target: rawTarget,
    }).target;
    if (target.kind === "saved") {
      this.#assertNotPlatformCredential(
        this.#provisioning.resolveTarget(target.targetRef).bearerToken
      );
    } else if (target.target.auth.kind === "bearer") {
      this.#assertNotPlatformCredential(target.target.auth.token);
    }
    // Alarm scheduling is fallible. Do it before staging credentials or taking
    // the active-run lock so a rejected queue RPC cannot orphan either one.
    await this.#touch(config);
    const now = new Date().toISOString();
    const targetSelector =
      target.kind === "saved"
        ? ({ kind: "saved" } as const)
        : ({ kind: "inline", save: target.save } as const);
    const run = this.#store.transaction(() => {
      const existing = this.#provisioning.getRun(params.runId);
      if (
        existing &&
        (existing.status === "succeeded" ||
          existing.status === "partial" ||
          existing.status === "failed")
      ) {
        // A queued retry can race terminal Workflow cleanup between the active
        // lookup and this RPC. Validate only immutable run/selector metadata;
        // never re-stage a credential for a run which cannot consume it.
        const terminal = this.#provisioning.queueRun(
          params,
          config.provider,
          now,
          targetSelector
        );
        this.#provisioning.deleteExecutions(terminal.id);
        this.#provisioning.deleteStagedTarget(terminal.id);
        return terminal;
      }
      let staged: ProvisioningTarget;
      if (target.kind === "saved") {
        staged = this.#provisioning.stageSavedTarget(
          params.runId,
          target.targetRef,
          now
        );
      } else {
        const input = provisioningTargetInputSchema.parse(target.target);
        staged = this.#provisioning.stageTarget(params.runId, input, now);
        if (target.save && !this.#provisioning.getRun(params.runId)) {
          this.#provisioning.saveTarget(input, now);
        }
      }
      if (staged.ref !== params.targetRef) {
        throw new Error("Provisioning target and Workflow parameters do not match.");
      }
      validateOutboundTarget(staged.baseUrl, this.#outboundTargetPolicy);
      return this.#provisioning.queueRun(params, config.provider, now, targetSelector);
    });
    return run;
  }

  async saveProvisioningTarget(
    rawInput: ProvisioningTargetInput
  ): Promise<ProvisioningTarget> {
    const input = provisioningTargetInputSchema.parse(rawInput);
    if (input.auth.kind === "bearer") {
      this.#assertNotPlatformCredential(input.auth.token);
    }
    validateOutboundTarget(input.baseUrl, this.#outboundTargetPolicy);
    const target = this.#provisioning.saveTarget(input, new Date().toISOString());
    await this.#touch();
    return target;
  }

  getProvisioningRun(runId: string): ProvisioningRun | undefined {
    return this.#provisioning.getRun(runId);
  }

  getActiveProvisioningRun(
    applicationId: string,
    targetRef: string
  ): ProvisioningRun | undefined {
    return this.#provisioning.getActiveRun(applicationId, targetRef);
  }

  revalidateActiveProvisioningRun(
    rawParams: ProvisioningWorkflowParams,
    rawTarget: RunProvisioningCycleToolInput["target"]
  ): ProvisioningRun {
    const params = provisioningWorkflowParamsSchema.parse(rawParams);
    const run = this.#provisioning.getRun(params.runId);
    const config = this.#readConfig();
    if (
      !run ||
      !config ||
      (run.status !== "queued" && run.status !== "running") ||
      run.envId !== params.envId ||
      run.appId !== params.appId ||
      run.provider !== config.provider ||
      run.mode !== params.mode ||
      run.targetRef !== params.targetRef
    ) {
      throw new Error("Provisioning retry does not match an active run.");
    }
    const target = runProvisioningCycleToolInputSchema.parse({
      environmentId: params.envId,
      appId: params.appId,
      mode: params.mode,
      target: rawTarget,
    }).target;
    const storedSelector = this.#provisioning.getRunTargetSelector(run.id);
    const retrySelector =
      target.kind === "saved"
        ? { kind: "saved" as const }
        : { kind: "inline" as const, save: target.save };
    if (JSON.stringify(storedSelector) !== JSON.stringify(retrySelector)) {
      throw new Error("Provisioning retry does not match an active run.");
    }
    if (target.kind === "saved") {
      this.#provisioning.revalidateSavedTarget(run.id, target.targetRef);
    } else {
      this.#provisioning.revalidateInlineTarget(run.id, target.target);
    }
    return run;
  }

  async prepareProvisioningRun(
    rawParams: ProvisioningWorkflowParams
  ): Promise<PreparedProvisioningRun> {
    const params = provisioningWorkflowParamsSchema.parse(rawParams);
    const config = this.#readConfig();
    if (!config || config.id !== params.envId) {
      throw new Error("Provisioning run environment does not match this object.");
    }
    const queued = this.#provisioning.getRun(params.runId);
    if (
      !queued ||
      queued.envId !== params.envId ||
      queued.appId !== params.appId ||
      queued.provider !== config.provider ||
      queued.mode !== params.mode ||
      queued.targetRef !== params.targetRef
    ) {
      throw new Error("Provisioning run parameters do not match queued state.");
    }
    const engine = await this.#engine();
    if (!engine.applications.findById(params.appId)) {
      throw new UnknownProvisioningApplicationError();
    }
    const resolvedTarget = this.#provisioning.resolveTarget(
      params.targetRef,
      params.runId
    );
    this.#assertNotPlatformCredential(resolvedTarget.bearerToken);
    validateOutboundTarget(resolvedTarget.target.baseUrl, this.#outboundTargetPolicy);

    const users = engine.users
      .list({ includeDeleted: true })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((user) => {
        const deleted =
          user.lifecycleState === "deleted" || Boolean(user.softDeletedAt);
        return {
          resourceType: "User" as const,
          id: user.id,
          ...(user.externalId ? { externalId: user.externalId } : {}),
          userName: user.userName,
          displayName: user.displayName,
          ...(user.givenName ? { givenName: user.givenName } : {}),
          ...(user.familyName ? { familyName: user.familyName } : {}),
          active: !deleted && user.lifecycleState === "active",
          deleted,
          version: user.resourceVersion,
        };
      });
    const groups = engine.groups
      .list({ includeDeleted: true })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((group) => {
        const deleted = Boolean(group.softDeletedAt);
        return {
          resourceType: "Group" as const,
          id: group.id,
          ...(group.externalId ? { externalId: group.externalId } : {}),
          displayName: group.displayName,
          memberIds: deleted
            ? []
            : engine.groups
                .listMembers(group.id)
                .map((member) => member.id)
                .sort((left, right) => left.localeCompare(right)),
          deleted,
          version: group.resourceVersion,
        };
      });
    const snapshotBody = { users, groups };
    const snapshot = {
      ...snapshotBody,
      cursor: await provisioningSnapshotCursor(snapshotBody),
    } satisfies ProvisioningSnapshot;
    const watermark = this.#provisioning.getWatermark(params.appId, params.targetRef);
    const startedAt = new Date().toISOString();
    const projectedRun: ProvisioningRun =
      queued.status === "running"
        ? queued
        : { ...queued, status: "running", startedAt };
    assertProvisioningPreparedOutputBounds({
      run: projectedRun,
      target: resolvedTarget.target,
      snapshot,
      watermark,
    });
    const run = this.#provisioning.startRun(params.runId, startedAt);
    await this.#touch(config);
    return {
      run,
      target: resolvedTarget.target,
      snapshot,
      watermark,
    };
  }

  async #appendProvisioningLog(
    execution: StoredProvisioningExecution,
    provider: EnvironmentConfig["provider"]
  ): Promise<void> {
    const existing = this.#store.get<{ id: string }>(
      "SELECT id FROM request_log WHERE id = ?",
      execution.log.id
    );
    if (existing) return;
    const engine = await this.#engine();
    engine.requestLog.append({
      ...execution.log,
      source: "outbound",
      provider,
    });
  }

  async executeProvisioningOperation(
    input: ExecuteProvisioningOperationInput
  ): Promise<ExecuteProvisioningOperationResult> {
    if (!Number.isSafeInteger(input.stepSequence) || input.stepSequence < 1) {
      throw new Error("Provisioning execution ordinal must be a positive integer.");
    }
    const operation = provisioningHttpOperationSchema.parse(input.operation);
    const run = this.#provisioning.getRun(input.runId);
    const config = this.#readConfig();
    if (
      !run ||
      !config ||
      run.status !== "running" ||
      run.targetRef !== input.targetRef ||
      run.provider !== config.provider ||
      operation.provider !== config.provider
    ) {
      throw new Error("Provisioning execution does not match a running run.");
    }
    const existing = this.#provisioning.readExecution(
      run.id,
      input.stepSequence,
      operation
    );
    if (existing) {
      await this.#appendProvisioningLog(existing, config.provider);
      return {
        response: existing.response,
        receivedAtEpochMs: Date.parse(existing.log.timestamp) + existing.log.durationMs,
      };
    }

    const key = `${run.id}:${input.stepSequence}`;
    const inFlight = this.#provisioningExecutions.get(key);
    if (inFlight) return inFlight;
    const execution = (async () => {
      const resolvedTarget = this.#provisioning.resolveTarget(input.targetRef, run.id);
      this.#assertNotPlatformCredential(resolvedTarget.bearerToken);
      this.#provisioning.beginExecution(
        run.id,
        input.stepSequence,
        operation,
        new Date().toISOString()
      );
      validateOutboundTarget(resolvedTarget.target.baseUrl, this.#outboundTargetPolicy);
      const performed = await performProvisioningHttpOperation({
        target: resolvedTarget.target,
        ...(resolvedTarget.bearerToken
          ? { bearerToken: resolvedTarget.bearerToken }
          : {}),
        operation,
        policy: this.#outboundTargetPolicy,
        ...(this.#provisioningFetcher ? { fetch: this.#provisioningFetcher } : {}),
      });
      const stored = this.#provisioning.finishExecution(
        run.id,
        input.stepSequence,
        operation,
        performed
      );
      await this.#appendProvisioningLog(stored, config.provider);
      await this.#touch(config);
      return {
        response: stored.response,
        receivedAtEpochMs: Date.parse(stored.log.timestamp) + stored.log.durationMs,
      };
    })();
    this.#provisioningExecutions.set(key, execution);
    try {
      return await execution;
    } finally {
      if (this.#provisioningExecutions.get(key) === execution) {
        this.#provisioningExecutions.delete(key);
      }
    }
  }

  async completeProvisioningRun(
    input: CompleteProvisioningRunInput
  ): Promise<ProvisioningRun> {
    const current = this.#provisioning.getRun(input.runId);
    if (!current) throw new Error(`Unknown provisioning run '${input.runId}'.`);
    if (
      current.status === "succeeded" ||
      current.status === "partial" ||
      current.status === "failed"
    ) {
      // completeRun compares the persisted summary. Never accept a different
      // watermark on replay after the active-run lock has been released.
      return this.#store.transaction(() => {
        const run = this.#provisioning.completeRun(input.runId, input.summary);
        this.#provisioning.deleteExecutions(run.id);
        this.#provisioning.deleteStagedTarget(run.id);
        return run;
      });
    }
    const completed = this.#store.transaction(() => {
      const run = this.#provisioning.completeRun(input.runId, input.summary);
      this.#provisioning.saveWatermark(
        run.appId,
        run.targetRef,
        input.watermark,
        input.summary.completedAt
      );
      this.#provisioning.deleteExecutions(run.id);
      this.#provisioning.deleteStagedTarget(run.id);
      return run;
    });
    await this.#touch();
    return completed;
  }

  async failProvisioningRun(
    runId: string,
    message: string
  ): Promise<ProvisioningRun | undefined> {
    const current = this.#provisioning.getRun(runId);
    if (!current) return undefined;
    let safeMessage = message;
    try {
      const secret = this.#provisioning.resolveTarget(
        current.targetRef,
        current.id
      ).bearerToken;
      if (secret) safeMessage = safeMessage.replaceAll(secret, "[REDACTED]");
    } catch {
      // A missing staged target must not prevent failure-state persistence.
    }
    const failed = this.#store.transaction(() => {
      const run = this.#provisioning.failRun(
        runId,
        safeMessage,
        new Date().toISOString()
      );
      this.#provisioning.deleteExecutions(runId);
      this.#provisioning.deleteStagedTarget(runId);
      return run;
    });
    await this.#touch();
    return failed;
  }

  async reconcileTerminalProvisioningWorkflow(
    runId: string,
    workflowStatus: ProvisioningTerminalWorkflowStatus
  ): Promise<ProvisioningTerminalReconciliationResult> {
    if (
      workflowStatus !== "complete" &&
      workflowStatus !== "errored" &&
      workflowStatus !== "terminated"
    ) {
      throw new Error("Invalid terminal Provisioning Workflow status.");
    }
    const result = this.#store.transaction(
      (): ProvisioningTerminalReconciliationResult => {
        const current = this.#provisioning.getRun(runId);
        if (!current) {
          this.#provisioning.deleteExecutions(runId);
          this.#provisioning.deleteStagedTarget(runId);
          return { outcome: "missing" };
        }
        if (
          current.status === "succeeded" ||
          current.status === "partial" ||
          current.status === "failed"
        ) {
          this.#provisioning.deleteExecutions(runId);
          this.#provisioning.deleteStagedTarget(runId);
          return { outcome: "preserved", run: current };
        }
        const run = this.#provisioning.failRun(
          runId,
          `Provisioning Workflow reached terminal platform status '${workflowStatus}' before run completion.`,
          new Date().toISOString()
        );
        this.#provisioning.deleteExecutions(runId);
        this.#provisioning.deleteStagedTarget(runId);
        return { outcome: "failed", run };
      }
    );
    if (result.outcome === "failed") await this.#touch();
    return result;
  }

  async compensateProvisioningRun(
    runId: string,
    message: string
  ): Promise<ProvisioningCompensationResult> {
    const result = this.#store.transaction((): ProvisioningCompensationResult => {
      const current = this.#provisioning.getRun(runId);
      if (!current) {
        this.#provisioning.deleteExecutions(runId);
        this.#provisioning.deleteStagedTarget(runId);
        return { outcome: "missing" };
      }
      if (current.status !== "queued") {
        if (
          current.status === "succeeded" ||
          current.status === "partial" ||
          current.status === "failed"
        ) {
          this.#provisioning.deleteExecutions(runId);
          this.#provisioning.deleteStagedTarget(runId);
        }
        return { outcome: "preserved", run: current };
      }
      const run = this.#provisioning.failRun(runId, message, new Date().toISOString());
      this.#provisioning.deleteExecutions(runId);
      this.#provisioning.deleteStagedTarget(runId);
      return { outcome: "compensated", run };
    });
    if (result.outcome === "compensated") await this.#touch();
    return result;
  }

  async getWellKnown(issuerBase: string): Promise<Record<string, unknown>> {
    const issuer = new URL(issuerBase).toString().replace(/\/$/, "");
    const engine = await this.#engine();
    await this.#touch();
    return engine.discovery(issuer);
  }

  async mintToken(
    input: MintTokenRequest,
    location: MintTokenPublicLocation
  ): Promise<MintedToken> {
    const request = mintTokenRequestSchema.parse(input);
    const validatedIssuerBase = trustedPublicUrl(
      location.issuerBase,
      "Token issuer base"
    );
    const issuer = new URL(validatedIssuerBase);
    const engine = await this.#engine();
    let validatedGraphBaseUrl: string | undefined;
    if (engine.providerId === "entra") {
      if (!location.graphBaseUrl) {
        throw new Error("Entra token minting requires a trusted Graph base URL.");
      }
      validatedGraphBaseUrl = trustedPublicUrl(
        location.graphBaseUrl,
        "Token Graph base",
        {
          pathSuffix: "/graph/v1.0",
          protocol: issuer.protocol,
        }
      );
    }
    const user =
      engine.users.findById(request.subject) ??
      engine.users.findByUserName(request.subject);
    if (!user) throw new Error(`Unknown token subject: ${request.subject}`);
    const now = Math.floor(engine.clock.now().getTime() / 1_000);
    const defaultExpiresAt = now + engine.provider.tokenPolicy.idTokenLifetimeSeconds;
    const additionalClaims: Record<string, unknown> = {
      ...(request.audience ? { aud: request.audience } : {}),
      ...brokenTokenClaimOverrides(request.broken, {
        clientId: request.clientId,
        nowEpochSeconds: now,
      }),
    };
    let token = await engine.issueIdToken({
      issuerBase: validatedIssuerBase,
      ...(validatedGraphBaseUrl ? { graphBaseUrl: validatedGraphBaseUrl } : {}),
      clientId: request.clientId,
      userId: user.id,
      additionalClaims,
    });
    const claims = decodeJwt(token).payload;
    if (request.broken === "bad_signature") token = corruptJwtSignature(token);
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

  async listScenarios(input: ManagementListQuery): Promise<ScenarioListPage> {
    const query = managementListQuerySchema.parse(input);
    const engine = await this.#engine();
    const result = scenarioListPageSchema.parse(engine.scenarios.listPage(query));
    await this.#touch();
    return result;
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

  async simulateLifecycle(
    userId: string,
    action: LifecycleAction
  ): Promise<LifecycleResult> {
    const engine = await this.#engine();
    const result = engine.lifecycle.simulate(userId, action);
    await this.#touch();
    return result;
  }

  async getWellKnownUrls(location: WellKnownPublicLocation): Promise<WellKnownUrls> {
    const engine = await this.#engine();
    const issuerBase = trustedPublicUrl(location.issuerBase, "Well-known issuer base");
    const directoryBaseUrl = trustedPublicUrl(
      location.directoryBaseUrl,
      "Well-known directory base",
      { protocol: new URL(issuerBase).protocol }
    );
    const context = { issuerBase, tenantId: engine.tenantId };
    const urls = engine.provider.urls;
    const graphBaseUrl =
      engine.providerId === "entra"
        ? trustedPublicUrl(location.graphBaseUrl ?? "", "Well-known Graph base", {
            pathSuffix: "/graph/v1.0",
            protocol: new URL(issuerBase).protocol,
          })
        : undefined;
    if (
      graphBaseUrl &&
      graphBaseUrl !== `${directoryBaseUrl.replace(/\/+$/, "")}/graph/v1.0`
    ) {
      throw new Error("Well-known Graph base must belong to the directory base.");
    }
    const result = wellKnownUrlsSchema.parse({
      issuer: urls.issuer(context),
      openidConfiguration: urls.discovery(context),
      authorizationEndpoint: urls.authorization(context),
      tokenEndpoint: urls.token(context),
      jwksUri: urls.jwks(context),
      scimBaseUrl: `${directoryBaseUrl.replace(/\/+$/, "")}/scim/v2`,
      ...(engine.providerId === "entra"
        ? { graphBaseUrl }
        : {
            oktaApiBaseUrl: `${directoryBaseUrl.replace(/\/+$/, "")}/api/v1`,
            oktaAuthnEndpoint: `${directoryBaseUrl.replace(/\/+$/, "")}/api/v1/authn`,
          }),
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
      const oidcApp =
        config.provider === "entra"
          ? createEntraHttpApp({ engine: createEntraHttpEngine(engine) })
          : createOktaHttpApp({ engine: createOktaHttpEngine(engine) });
      const directoryApp =
        config.provider === "entra"
          ? createGraphHttpApp({
              engine: createGraphDirectoryEngine(engine),
              now: () => engine.clock.now(),
            })
          : createOktaDirectoryApi({ engine: createOktaDirectoryEngine(engine) });
      const authnApp =
        config.provider === "okta"
          ? createOktaAuthnApi({ engine: engine.authn })
          : undefined;
      const scimApp = createScimHttpApp(
        new ScimService({
          users: engine.users,
          groups: engine.groups,
          lifecycle: engine.lifecycle,
          provider: engine.provider,
          scenarios: engine.scenarios,
        })
      );
      httpApp = {
        fetch: (candidate) => {
          const candidatePath = new URL(candidate.url).pathname;
          const isScimPath =
            candidatePath === "/scim/v2" || candidatePath.startsWith("/scim/v2/");
          const isDirectoryPath =
            config.provider === "entra"
              ? candidatePath === "/graph/v1.0" ||
                candidatePath.startsWith("/graph/v1.0/")
              : candidatePath === "/api/v1" || candidatePath.startsWith("/api/v1/");
          return (
            isScimPath
              ? scimApp
              : authnApp && isOktaAuthnPath(candidatePath)
                ? authnApp
                : isDirectoryPath
                  ? directoryApp
                  : oidcApp
          ).fetch(candidate);
        },
      };
      if (generation === this.#configGeneration) {
        this.#httpApp = { app: httpApp, generation };
      }
    }

    const startedAt = Date.now();
    const path = protocolPath(request);
    const routedPath = new URL(request.url).pathname;
    const requestBodyPromise = readBoundedBody(request.clone().body);
    const decision = engine.scenarios.decide(injectionPointFor(routedPath), {
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
      response = scenarioErrorResponse(engine, config, routedPath, decision.code);
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
    const authnPath = isOktaAuthnPath(routedPath);
    const responseHeaders = headersRecord(response.headers, {
      redactSecrets: authnPath,
    });
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
      response.headers.get("request-id") ??
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
            authnPath ||
            request.headers.get("x-mockos-redact-authorization") === "true",
          redactSecrets: authnPath,
        }),
        requestBody: authenticationBodyForLog(routedPath, requestBody),
        responseStatus: response.status,
        responseHeaders,
        responseBody: authenticationBodyForLog(routedPath, responseBody),
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
