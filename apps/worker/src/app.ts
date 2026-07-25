import {
  assertMockLlmServerSpecBounds,
  environmentIdSchema,
  type Problem,
  type ProvisioningWorkflowParams,
} from "@mockos/contracts";
import { mockosHttpOperations, mockosRouterPath } from "@mockos/contracts/operations";
import {
  type EnvironmentCatalogDurableObject,
  type EnvironmentDurableObject,
  type MockosMcpAgent,
  MockosMcpAgent as MockosMcpAgentClass,
  routeEnvironmentRequest,
  SELF_HOSTED_ACCOUNT_ID,
} from "@mockos/worker-kit";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const MANAGEMENT_API_PREFIX = "/__mockos/v1";

const managementRoute = (path: `/${string}`): string =>
  `${MANAGEMENT_API_PREFIX}${mockosRouterPath(path)}`;

const configureEnvironmentOperation = mockosHttpOperations.configure_environment.http;
const seedIdentitiesOperation = mockosHttpOperations.seed_identities.http;
const createApplicationOperation = mockosHttpOperations.create_application.http;
const getEnvironmentDiscoveryOperation =
  mockosHttpOperations.get_environment_discovery.http;
const deleteEnvironmentOperation = mockosHttpOperations.delete_environment.http;

export type CloudflareEnv = {
  ENVIRONMENT_CATALOG: DurableObjectNamespace<EnvironmentCatalogDurableObject>;
  ENVIRONMENTS: DurableObjectNamespace<EnvironmentDurableObject>;
  MOCKOS_MCP: DurableObjectNamespace<MockosMcpAgent>;
  PROVISIONING_WORKFLOW: Workflow<ProvisioningWorkflowParams>;
  TID_INDEX?: KVNamespace;
  API_KEY?: string;
  ALLOW_INSECURE_TARGETS?: string;
  BASE_DOMAIN?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  ENTRA_HOST?: string;
  E2E_INTROSPECTION_ENABLED?: string;
  E2E_OWNER_NONCE?: string;
  HOSTING_MODE: string;
  OUTBOUND_BLOCKED_HOSTS?: string;
  PATH_PREFIX?: string;
  PROVISIONING_FETCHER?: Fetcher;
  PUBLIC_ORIGIN: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
};

type WorkerHonoEnv = { Bindings: CloudflareEnv };

export const MAX_MCP_REQUEST_BODY_BYTES = 2 * 1_024 * 1_024;

const mcpHandler = MockosMcpAgentClass.serve("/mcp", {
  binding: "MOCKOS_MCP",
});

const problem = (
  status: number,
  title: string,
  detail: string,
  code: string,
  request: Request
): Problem => ({
  type: `https://mockos.live/problems/${code.toLowerCase()}`,
  title,
  status,
  detail,
  instance: new URL(request.url).pathname,
  requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
  code,
});

const sameSecret = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const presentedApiKey = (request: Request) => {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return request.headers.get("x-api-key") ?? "";
};

const apiKeyFailure = (request: Request, env: CloudflareEnv) => {
  const expected = env.API_KEY?.trim();
  if (!expected) {
    const body = problem(
      503,
      "Control API unavailable",
      "The API_KEY secret has not been configured.",
      "CONTROL_API_UNAVAILABLE",
      request
    );
    return Response.json(body, { status: body.status });
  }
  if (sameSecret(presentedApiKey(request), expected)) return undefined;
  const body = problem(
    401,
    "Unauthorized",
    "Supply the self-host API key as a Bearer token.",
    "UNAUTHORIZED",
    request
  );
  return Response.json(body, {
    status: body.status,
    headers: { "www-authenticate": "Bearer realm=mockos-control" },
  });
};

const withoutControlCredentials = (request: Request) => {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("x-api-key");
  return new Request(request, { headers });
};

type BoundedMcpRequest = {
  readonly request: Request;
  readonly body?: Uint8Array;
};

const boundedMcpRequest = async (
  request: Request
): Promise<BoundedMcpRequest | undefined> => {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength) {
    if (
      !/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_MCP_REQUEST_BODY_BYTES
    ) {
      void request.body
        ?.cancel("mockOS MCP request body limit reached")
        .catch(() => undefined);
      return undefined;
    }
  }
  if (!request.body) return { request };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MCP_REQUEST_BODY_BYTES) {
        void reader
          .cancel("mockOS MCP request body limit reached")
          .catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
      redirect: request.redirect,
      signal: request.signal,
    }),
    body,
  };
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const containsSecret = (root: unknown, secret: string): boolean => {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (key.includes(secret)) return true;
      if (typeof child === "string") {
        if (child.includes(secret)) return true;
      } else {
        pending.push(child);
      }
    }
  }
  return false;
};

const isPlatformCredentialToolCall = (
  value: unknown,
  platformApiKey: string
): boolean => {
  const message = record(value);
  if (message?.method !== "tools/call") return false;
  const params = record(message.params);
  const arguments_ = record(params?.arguments);
  if (params?.name === "put_mock_mcp_server") {
    const server = record(arguments_?.server);
    const authentication = record(server?.authentication);
    const token = authentication?.mode === "bearer" ? authentication.token : undefined;
    return typeof token === "string" && token.includes(platformApiKey);
  }
  if (params?.name === "put_mock_llm_server") {
    const server = record(arguments_?.server);
    if (!server) return false;
    try {
      assertMockLlmServerSpecBounds(server);
    } catch {
      return false;
    }
    return containsSecret(server, platformApiKey);
  }
  if (params?.name !== "run_provisioning_cycle") return false;
  const target = record(arguments_?.target);
  if (target?.kind !== "inline") return false;
  const inlineTarget = record(target.target);
  const auth = record(inlineTarget?.auth);
  const token = auth?.kind === "bearer" ? auth.token : undefined;
  return typeof token === "string" && token.trim().includes(platformApiKey);
};

const mcpBodyUsesPlatformCredential = (
  body: Uint8Array | undefined,
  platformApiKey: string
): boolean => {
  if (!body || body.byteLength === 0) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return false;
  }
  return Array.isArray(payload)
    ? payload.some((message) => isPlatformCredentialToolCall(message, platformApiKey))
    : isPlatformCredentialToolCall(payload, platformApiKey);
};

const environmentStub = (env: CloudflareEnv, environmentId: string) => {
  const parsed = environmentIdSchema.safeParse(environmentId);
  if (!parsed.success) throw new Error("Invalid environment id.");
  return env.ENVIRONMENTS.get(env.ENVIRONMENTS.idFromName(parsed.data));
};

const environmentCatalog = (env: CloudflareEnv) =>
  env.ENVIRONMENT_CATALOG.get(
    env.ENVIRONMENT_CATALOG.idFromName(SELF_HOSTED_ACCOUNT_ID)
  );

const serveMcp = async (context: Context<WorkerHonoEnv>) => {
  const failure = apiKeyFailure(context.req.raw, context.env);
  if (failure) return failure;
  const bounded = await boundedMcpRequest(context.req.raw);
  if (!bounded) {
    const body = problem(
      413,
      "Request body too large",
      "MCP request bodies cannot exceed 2 MiB.",
      "REQUEST_BODY_TOO_LARGE",
      context.req.raw
    );
    return Response.json(body, {
      status: body.status,
      headers: { "content-type": "application/problem+json" },
    });
  }
  const platformApiKey = context.env.API_KEY?.trim();
  if (platformApiKey && mcpBodyUsesPlatformCredential(bounded.body, platformApiKey)) {
    const body = problem(
      400,
      "Platform credential rejected",
      "The platform Access Key cannot be used as a Mock Credential or outbound target credential.",
      "PLATFORM_CREDENTIAL_NOT_ALLOWED",
      context.req.raw
    );
    return Response.json(body, {
      status: body.status,
      headers: { "content-type": "application/problem+json" },
    });
  }
  // The standalone SSE stream is optional in Streamable HTTP. The current
  // Agents SDK can route a later POST response onto that idle stream in a
  // deployed Worker, leaving standards-compliant clients waiting forever on
  // the originating POST. Decline the optional stream so every response stays
  // attached to its request. Clients treat 405 as the specified fallback.
  if (context.req.method === "GET") {
    return context.body(null, 405, { allow: "POST, DELETE, OPTIONS" });
  }
  return mcpHandler.fetch(
    withoutControlCredentials(bounded.request),
    context.env,
    context.executionCtx as unknown as Parameters<typeof mcpHandler.fetch>[2]
  );
};

export const createWorkerApp = () => {
  const app = new Hono<WorkerHonoEnv>();

  app.onError((error, context) => {
    const body = problem(
      400,
      "Request failed",
      error instanceof Error ? error.message : "The request could not be processed.",
      "INVALID_REQUEST",
      context.req.raw
    );
    return context.json(body, body.status as ContentfulStatusCode);
  });

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "mockos",
      hostingMode: context.env.HOSTING_MODE,
      ...(context.env.CF_VERSION_METADATA?.id
        ? { workerVersionId: context.env.CF_VERSION_METADATA.id }
        : {}),
      ...(context.env.E2E_INTROSPECTION_ENABLED === "true" &&
      context.env.E2E_OWNER_NONCE
        ? { e2eOwnerNonce: context.env.E2E_OWNER_NONCE }
        : {}),
    })
  );

  app.all("/mcp", serveMcp);
  app.all("/mcp/*", serveMcp);

  app.get(
    "/__mockos/e2e/environments/:environmentId/provisioning-runs/:runId",
    async (context) => {
      if (context.env.E2E_INTROSPECTION_ENABLED !== "true") {
        return context.notFound();
      }
      const failure = apiKeyFailure(context.req.raw, context.env);
      if (failure) return failure;
      const environmentId = environmentIdSchema.parse(
        context.req.param("environmentId")
      );
      const runId = context.req.param("runId");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) return context.notFound();
      const run = await environmentStub(context.env, environmentId).getProvisioningRun(
        runId
      );
      return run ? context.json({ data: run }) : context.notFound();
    }
  );

  app.use(`${MANAGEMENT_API_PREFIX}/*`, async (context, next) => {
    const failure = apiKeyFailure(context.req.raw, context.env);
    if (failure) return failure;
    await next();
  });

  app.put(managementRoute(configureEnvironmentOperation.path), async (context) => {
    const { environmentId } = configureEnvironmentOperation.pathSchema.parse({
      environmentId: context.req.param("environmentId"),
    });
    const config = configureEnvironmentOperation.bodySchema.parse(
      await context.req.json()
    );
    if (config.id !== environmentId) {
      throw new Error("Environment id in the URL and body must match.");
    }
    const configured = await environmentStub(context.env, environmentId).configure(
      config
    );
    await environmentCatalog(context.env).registerEnvironment(configured);
    if (context.env.TID_INDEX) {
      await context.env.TID_INDEX.put(`tid:${configured.tenantId}`, environmentId);
    }
    return context.json({
      data: configured,
      meta: { requestId: crypto.randomUUID() },
    });
  });

  app.post(managementRoute(seedIdentitiesOperation.path), async (context) => {
    const { environmentId } = seedIdentitiesOperation.pathSchema.parse({
      environmentId: context.req.param("environmentId"),
    });
    const seed = seedIdentitiesOperation.bodySchema.parse(await context.req.json());
    const result = await environmentStub(context.env, environmentId).seed(seed);
    return context.json({
      data: result,
      meta: { requestId: crypto.randomUUID() },
    });
  });

  app.post(managementRoute(createApplicationOperation.path), async (context) => {
    const { environmentId } = createApplicationOperation.pathSchema.parse({
      environmentId: context.req.param("environmentId"),
    });
    const input = createApplicationOperation.bodySchema.parse(await context.req.json());
    const result = await environmentStub(context.env, environmentId).createApplication(
      input
    );
    return context.json(
      { data: result, meta: { requestId: crypto.randomUUID() } },
      createApplicationOperation.successStatus
    );
  });

  app.get(managementRoute(getEnvironmentDiscoveryOperation.path), async (context) => {
    const { environmentId } = getEnvironmentDiscoveryOperation.pathSchema.parse({
      environmentId: context.req.param("environmentId"),
    });
    const query = getEnvironmentDiscoveryOperation.querySchema.parse({
      issuer_base: context.req.query("issuer_base"),
    });
    const result = await environmentStub(context.env, environmentId).getWellKnown(
      query.issuer_base
    );
    return context.json({
      data: result,
      meta: { requestId: crypto.randomUUID() },
    });
  });

  app.delete(managementRoute(deleteEnvironmentOperation.path), async (context) => {
    const { environmentId } = deleteEnvironmentOperation.pathSchema.parse({
      environmentId: context.req.param("environmentId"),
    });
    const stub = environmentStub(context.env, environmentId);
    const catalog = environmentCatalog(context.env);
    let config = await catalog.beginDeleteEnvironment(environmentId);
    if (!config) {
      const legacyConfig = await stub.getConfig();
      if (!legacyConfig) return context.body(null, 204);
      await catalog.registerEnvironment(legacyConfig);
      config = await catalog.beginDeleteEnvironment(environmentId);
    }
    if (!config) throw new Error("Environment catalog deletion could not begin.");
    let purged = false;
    try {
      await stub.purge();
      purged = true;
      if (context.env.TID_INDEX) {
        await context.env.TID_INDEX.delete(`tid:${config.tenantId}`);
      }
      await catalog.completeDeleteEnvironment(environmentId);
      return context.body(null, 204);
    } catch (error) {
      if (!purged) await catalog.restoreEnvironment(config);
      throw error;
    }
  });

  app.all("*", async (context) => {
    const hostingMode = context.env.HOSTING_MODE;
    if (hostingMode !== "path" && hostingMode !== "subdomain") {
      const body = problem(
        500,
        "Invalid hosting configuration",
        "HOSTING_MODE must be path or subdomain.",
        "INVALID_HOSTING_MODE",
        context.req.raw
      );
      return context.json(body, body.status as ContentfulStatusCode);
    }
    const response = await routeEnvironmentRequest(context.req.raw, context.env, {
      hostingMode,
      pathPrefix: context.env.PATH_PREFIX,
      baseDomain: context.env.BASE_DOMAIN,
      entraHost: context.env.ENTRA_HOST,
    });
    return response ?? context.notFound();
  });

  return app;
};
