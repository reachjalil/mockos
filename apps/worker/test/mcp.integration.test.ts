import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const publicOrigin = new URL(Reflect.get(env, "PUBLIC_ORIGIN") as string).origin;
const worker = (exports as unknown as { default: Fetcher }).default;

type JsonRpcResponse = {
  id?: number | string;
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
};

type CatalogStub = {
  activateEnvironment(environmentId: string): Promise<unknown>;
  beginDeleteEnvironment(environmentId: string): Promise<unknown>;
  completeDeleteEnvironment(environmentId: string): Promise<void>;
  listEnvironments(): Promise<Array<{ id: string; name: string }>>;
  reserveEnvironment(environment: Record<string, unknown>): Promise<boolean>;
  restoreEnvironment(environment: Record<string, unknown>): Promise<unknown>;
};

const catalog = () => {
  const namespace = Reflect.get(env, "ENVIRONMENT_CATALOG") as {
    get(id: DurableObjectId): CatalogStub;
    idFromName(name: string): DurableObjectId;
  };
  return namespace.get(namespace.idFromName("self-hosted"));
};

const parseMessages = async (response: Response): Promise<JsonRpcResponse[]> => {
  const body = await response.text();
  if (!body) return [];
  if (response.headers.get("content-type")?.includes("application/json")) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
};

const mcpRequest = (
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<Response> => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return worker.fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
};

const initialize = async () => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mockos-integration", version: "1.0.0" },
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const [message] = await parseMessages(response);
  expect(message?.result).toMatchObject({
    protocolVersion: "2025-11-25",
    serverInfo: { name: "mockOS", version: "0.1.0" },
  });
  const initialized = await mcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId ?? undefined
  );
  expect([200, 202, 204]).toContain(initialized.status);
  await initialized.body?.cancel();
  return sessionId ?? "";
};

const callTool = async (
  sessionId: string,
  id: number,
  name: string,
  args: Record<string, unknown>
) => {
  const response = await mcpRequest(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const [message] = await parseMessages(response);
  expect(message?.error).toBeUndefined();
  return message?.result as
    | {
        isError?: boolean;
        structuredContent?: {
          data?: Record<string, unknown>;
          meta?: { requestId?: string };
        };
      }
    | undefined;
};

describe("management MCP", () => {
  it("rejects unauthenticated requests before creating a session", async () => {
    const response = await worker.fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "unauthorized", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBe(
      "Bearer realm=mockos-control"
    );
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("declines the optional standalone SSE stream after authentication", async () => {
    const response = await worker.fetch(`${origin}/mcp`, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`,
        "mcp-session-id": "unused-session-id",
      },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
  });

  it("keeps reserved and deleting catalog entries out of active listings", async () => {
    const environment = {
      id: "catalog-state-01",
      name: "Catalog state test",
      provider: "entra",
      seed: "catalog-state",
      tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
      createdAt: "2026-07-22T00:00:00.000Z",
      idleTtlHours: 168,
      requestLogLimit: 10_000,
    };
    const environmentCatalog = catalog();

    expect(await environmentCatalog.reserveEnvironment(environment)).toBe(true);
    expect(await environmentCatalog.reserveEnvironment(environment)).toBe(false);
    expect(await environmentCatalog.listEnvironments()).not.toContainEqual(
      expect.objectContaining({ id: environment.id })
    );

    await environmentCatalog.activateEnvironment(environment.id);
    expect(await environmentCatalog.listEnvironments()).toContainEqual(
      expect.objectContaining({ id: environment.id })
    );

    await environmentCatalog.beginDeleteEnvironment(environment.id);
    expect(await environmentCatalog.listEnvironments()).not.toContainEqual(
      expect.objectContaining({ id: environment.id })
    );

    await environmentCatalog.restoreEnvironment(environment);
    expect(await environmentCatalog.listEnvironments()).toContainEqual(
      expect.objectContaining({ id: environment.id })
    );
    await environmentCatalog.beginDeleteEnvironment(environment.id);
    await environmentCatalog.completeDeleteEnvironment(environment.id);
  });

  it("mounts all tools and keeps the selected environment session-local", async () => {
    const sessionId = await initialize();
    const listResponse = await mcpRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      sessionId
    );
    const [listMessage] = await parseMessages(listResponse);
    const tools = (listMessage?.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "assert_requests",
        "clear_scenario",
        "configure_environment",
        "create_application",
        "create_environment",
        "delete_environment",
        "get_request_log",
        "get_wellknown_urls",
        "list_environments",
        "mint_token",
        "seed_identities",
        "set_current_environment",
        "set_scenario",
      ].sort()
    );

    const created = await callTool(sessionId, 3, "create_environment", {
      name: "MCP integration environment",
      provider: "entra",
      seed: "mcp-integration",
    });
    expect(created?.isError).not.toBe(true);
    const environment = created?.structuredContent?.data as
      | { id?: string; name?: string; tenantId?: string }
      | undefined;
    expect(environment).toMatchObject({ name: "MCP integration environment" });
    expect(environment?.id).toMatch(/^env_[a-f0-9]{20}$/);
    expect(environment?.tenantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    const listed = await callTool(sessionId, 4, "list_environments", {});
    expect(listed?.structuredContent?.data).toMatchObject({
      currentEnvironmentId: environment?.id,
      environments: [{ id: environment?.id }],
    });

    const secondSessionId = await initialize();
    const secondSessionList = await callTool(
      secondSessionId,
      5,
      "list_environments",
      {}
    );
    expect(secondSessionList?.structuredContent?.data).toMatchObject({
      currentEnvironmentId: null,
      environments: [{ id: environment?.id }],
    });

    const environmentCatalog = catalog();
    expect(await environmentCatalog.listEnvironments()).toEqual([
      expect.objectContaining({ id: environment?.id }),
    ]);

    const configured = await callTool(sessionId, 6, "configure_environment", {
      name: "Configured MCP environment",
      idleTtlHours: 48,
      requestLogLimit: 250,
    });
    expect(configured?.isError).not.toBe(true);
    expect(configured?.structuredContent?.data).toMatchObject({
      id: environment?.id,
      name: "Configured MCP environment",
      idleTtlHours: 48,
      requestLogLimit: 250,
    });

    const userName = "grace@example.test";
    const seeded = await callTool(sessionId, 7, "seed_identities", {
      users: [
        {
          userName,
          displayName: "Grace Hopper",
          givenName: "Grace",
          familyName: "Hopper",
          password: "Passw0rd!",
          active: true,
          mfaState: "none",
          roles: [],
        },
      ],
      groups: [{ displayName: "MCP operators", members: [userName] }],
    });
    expect(seeded?.isError).not.toBe(true);
    const seedResult = seeded?.structuredContent?.data as
      | {
          groups?: Array<{ displayName?: string; id?: string }>;
          users?: Array<{ id?: string; userName?: string }>;
        }
      | undefined;
    expect(seedResult).toMatchObject({
      users: [{ userName }],
      groups: [{ displayName: "MCP operators" }],
    });
    const userId = seedResult?.users?.[0]?.id;
    expect(userId).toBeTruthy();

    const clientId = "mcp-integration-client";
    const application = await callTool(sessionId, 8, "create_application", {
      name: "MCP integration client",
      clientId,
      clientSecret: "mcp-integration-secret",
      redirectUris: ["https://client.example/callback"],
      grantTypes: ["authorization_code"],
      appRoles: [],
      groupClaimsMode: "none",
    });
    expect(application?.isError).not.toBe(true);
    expect(application?.structuredContent?.data).toMatchObject({
      name: "MCP integration client",
      clientId,
    });

    const normalToken = await callTool(sessionId, 9, "mint_token", {
      clientId,
      subject: userId,
      audience: "mcp-integration-audience",
    });
    expect(normalToken?.isError).not.toBe(true);
    const normalTokenData = normalToken?.structuredContent?.data as
      | {
          broken?: string;
          claims?: Record<string, unknown>;
          token?: string;
          tokenType?: string;
        }
      | undefined;
    expect(normalTokenData?.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(normalTokenData).toMatchObject({
      tokenType: "Bearer",
      claims: { aud: "mcp-integration-audience", oid: userId, upn: userName },
    });
    expect(normalTokenData?.broken).toBeUndefined();

    const expiredToken = await callTool(sessionId, 10, "mint_token", {
      clientId,
      subject: userId,
      broken: "expired",
    });
    expect(expiredToken?.isError).not.toBe(true);
    const expiredTokenData = expiredToken?.structuredContent?.data as
      | { broken?: string; claims?: Record<string, unknown>; token?: string }
      | undefined;
    expect(expiredTokenData).toMatchObject({ broken: "expired" });
    expect(expiredTokenData?.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(Number(expiredTokenData?.claims?.exp)).toBeLessThan(
      Math.floor(Date.now() / 1_000)
    );

    const wellKnown = await callTool(sessionId, 11, "get_wellknown_urls", {});
    expect(wellKnown?.isError).not.toBe(true);
    const wellKnownData = wellKnown?.structuredContent?.data as
      | {
          authorizationEndpoint?: string;
          issuer?: string;
          jwksUri?: string;
          openidConfiguration?: string;
          scimBaseUrl?: string;
          tokenEndpoint?: string;
        }
      | undefined;
    const managementBase = `${publicOrigin}/e/${environment?.id}`;
    const managementIssuer = `${managementBase}/${environment?.tenantId}/v2.0`;
    expect(wellKnownData).toMatchObject({
      issuer: managementIssuer,
      openidConfiguration: `${managementIssuer}/.well-known/openid-configuration`,
      authorizationEndpoint: `${managementBase}/${environment?.tenantId}/oauth2/v2.0/authorize`,
      tokenEndpoint: `${managementBase}/${environment?.tenantId}/oauth2/v2.0/token`,
      jwksUri: `${managementBase}/${environment?.tenantId}/discovery/v2.0/keys`,
      scimBaseUrl: `${managementBase}/scim/v2`,
    });
    expect(normalTokenData?.claims?.iss).toBe(managementIssuer);

    const scenarioId = "mcp-discovery-mfa";
    const scenario = await callTool(sessionId, 12, "set_scenario", {
      id: scenarioId,
      injectionPoint: "oidc.discovery",
      action: { type: "error", code: "MFA_REQUIRED" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    expect(scenario?.isError).not.toBe(true);
    expect(scenario?.structuredContent?.data).toMatchObject({
      id: scenarioId,
      injectionPoint: "oidc.discovery",
      action: { type: "error", code: "MFA_REQUIRED" },
    });

    const discoveryPath = `/e/${environment?.id}/${environment?.tenantId}/v2.0/.well-known/openid-configuration`;
    const injectedDiscovery = await worker.fetch(`${origin}${discoveryPath}`);
    expect(injectedDiscovery.status).toBe(400);
    expect(await injectedDiscovery.json()).toMatchObject({
      error: "interaction_required",
      error_codes: [50076],
    });

    const requestLog = await callTool(sessionId, 13, "get_request_log", {
      source: "inbound",
      provider: "entra",
      method: "GET",
      path: discoveryPath,
      status: 400,
      limit: 10,
    });
    expect(requestLog?.isError).not.toBe(true);
    const requestLogData = requestLog?.structuredContent?.data as
      | {
          entries?: Array<{
            method?: string;
            path?: string;
            responseBody?: string;
            responseStatus?: number;
            source?: string;
          }>;
        }
      | undefined;
    expect(requestLogData?.entries).toHaveLength(1);
    expect(requestLogData?.entries?.[0]).toMatchObject({
      source: "inbound",
      method: "GET",
      path: discoveryPath,
      responseStatus: 400,
    });
    expect(requestLogData?.entries?.[0]?.responseBody).toContain("AADSTS50076");

    const assertion = await callTool(sessionId, 14, "assert_requests", {
      source: "inbound",
      method: "GET",
      path: discoveryPath,
      status: 400,
      count: { exactly: 1 },
    });
    expect(assertion?.isError).not.toBe(true);
    expect(assertion?.structuredContent?.data).toMatchObject({
      pass: true,
      matched: 1,
    });

    const cleared = await callTool(sessionId, 15, "clear_scenario", {
      scenarioId,
    });
    expect(cleared?.isError).not.toBe(true);
    expect(cleared?.structuredContent?.data).toEqual({ cleared: 1 });

    const restoredDiscovery = await worker.fetch(`${origin}${discoveryPath}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(restoredDiscovery.status).toBe(200);
    expect(await restoredDiscovery.json()).toMatchObject({
      issuer: `${origin}/e/${environment?.id}/${environment?.tenantId}/v2.0`,
    });

    const redactedLog = await callTool(sessionId, 16, "get_request_log", {
      method: "GET",
      path: discoveryPath,
      status: 200,
      limit: 10,
    });
    expect(redactedLog?.structuredContent?.data).toMatchObject({
      entries: [
        {
          requestHeaders: { authorization: "[REDACTED]" },
          responseStatus: 200,
        },
      ],
    });

    const largeBodyScenario = await callTool(sessionId, 17, "set_scenario", {
      id: "large-body-rate-limit",
      injectionPoint: "oauth.token",
      action: { type: "error", code: "RATE_LIMITED" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    expect(largeBodyScenario?.isError).not.toBe(true);
    const largeBodyResponse = await worker.fetch(
      `${origin}${new URL(wellKnownData?.tokenEndpoint ?? "").pathname}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `padding=${"x".repeat(1_100_000)}`,
      }
    );
    expect(largeBodyResponse.status).toBe(429);
    expect(largeBodyResponse.headers.get("retry-after")).toBe("1");

    const deleted = await callTool(sessionId, 18, "delete_environment", {});
    expect(deleted?.structuredContent?.data).toMatchObject({
      deleted: true,
      environmentId: environment?.id,
    });
    expect(await environmentCatalog.listEnvironments()).toEqual([]);

    const repeatedDelete = await callTool(sessionId, 19, "delete_environment", {
      environmentId: environment?.id,
    });
    expect(repeatedDelete?.structuredContent?.data).toMatchObject({
      deleted: true,
      environmentId: environment?.id,
    });
    expect(await environmentCatalog.listEnvironments()).toEqual([]);
  });
});
