import {
  type ApplicationRegistration,
  type AssertionResult,
  type AssertionSpec,
  type ClearScenarioResult,
  type CreateApplicationInput,
  type CreateEnvironmentToolInput,
  type EnvironmentConfig,
  type EnvironmentPatch,
  type IdentitySeed,
  type LifecycleAction,
  type LifecycleResult,
  type MintedToken,
  type MintTokenRequest,
  mockosMcpToolNames,
  type RequestLogPage,
  type RequestLogQuery,
  type ScenarioSpec,
  type SeedIdentitiesResult,
  type WellKnownUrls,
} from "@mockos/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  type MockosToolDependencies,
  MockosToolError,
  type MockosToolRequestContext,
  registerMockosTools,
} from "./index";

const ENVIRONMENT_ID = "env_test01";
const CREATED_AT = "2026-07-22T12:00:00.000Z";
const EXPIRES_AT = "2026-07-22T13:00:00.000Z";

class InMemoryMockosDependencies implements MockosToolDependencies {
  readonly accountId = "acct_test";
  readonly environments = new Map<string, EnvironmentConfig>();
  readonly calls: Array<{ environmentId: string; operation: string }> = [];
  currentEnvironmentId: string | null = null;
  lastLogQuery: RequestLogQuery | undefined;

  async createEnvironment(
    input: CreateEnvironmentToolInput,
    _context: MockosToolRequestContext
  ): Promise<EnvironmentConfig> {
    const environment: EnvironmentConfig = {
      ...input,
      id: ENVIRONMENT_ID,
      tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
      createdAt: CREATED_AT,
      idleTtlHours: 168,
      requestLogLimit: 10_000,
    };
    this.environments.set(environment.id, environment);
    return environment;
  }

  async listEnvironments(
    _context: MockosToolRequestContext
  ): Promise<EnvironmentConfig[]> {
    return [...this.environments.values()];
  }

  async deleteEnvironment(
    environmentId: string,
    _context: MockosToolRequestContext
  ): Promise<void> {
    this.requireEnvironment(environmentId);
    this.environments.delete(environmentId);
    this.calls.push({ environmentId, operation: "delete" });
  }

  async configureEnvironment(
    environmentId: string,
    patch: EnvironmentPatch,
    _context: MockosToolRequestContext
  ): Promise<EnvironmentConfig> {
    const environment = { ...this.requireEnvironment(environmentId), ...patch };
    this.environments.set(environmentId, environment);
    this.calls.push({ environmentId, operation: "configure" });
    return environment;
  }

  async seedIdentities(
    environmentId: string,
    seed: IdentitySeed,
    _context: MockosToolRequestContext
  ): Promise<SeedIdentitiesResult> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "seed" });
    return {
      users: seed.users.map((user, index) => ({
        id: `user_${index + 1}`,
        userName: user.userName,
      })),
      groups: seed.groups.map((group, index) => ({
        id: `group_${index + 1}`,
        displayName: group.displayName,
      })),
    };
  }

  async createApplication(
    environmentId: string,
    input: CreateApplicationInput,
    _context: MockosToolRequestContext
  ): Promise<ApplicationRegistration> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "create-application" });
    return {
      ...input,
      id: "application_1",
      clientId: input.clientId ?? "client_test",
      clientSecret: input.clientSecret ?? "secret_test_123",
      createdAt: CREATED_AT,
    };
  }

  async mintToken(
    environmentId: string,
    input: MintTokenRequest,
    _context: MockosToolRequestContext
  ): Promise<MintedToken> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `mint:${input.broken ?? "valid"}` });
    return {
      token: "header.payload.signature",
      tokenType: "Bearer",
      expiresAt: EXPIRES_AT,
      claims: { aud: input.audience ?? input.clientId, sub: input.subject },
      ...(input.broken === undefined ? {} : { broken: input.broken }),
    };
  }

  async setScenario(
    environmentId: string,
    scenario: ScenarioSpec,
    _context: MockosToolRequestContext
  ): Promise<ScenarioSpec> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `set-scenario:${scenario.id}` });
    return scenario;
  }

  async clearScenario(
    environmentId: string,
    scenarioId: string | undefined,
    _context: MockosToolRequestContext
  ): Promise<ClearScenarioResult> {
    this.requireEnvironment(environmentId);
    this.calls.push({
      environmentId,
      operation: `clear-scenario:${scenarioId ?? "all"}`,
    });
    return { cleared: scenarioId === undefined ? 2 : 1 };
  }

  async getRequestLog(
    environmentId: string,
    query: RequestLogQuery,
    _context: MockosToolRequestContext
  ): Promise<RequestLogPage> {
    const environment = this.requireEnvironment(environmentId);
    this.lastLogQuery = query;
    this.calls.push({ environmentId, operation: "get-request-log" });
    return {
      entries: [
        {
          id: "request_1",
          timestamp: CREATED_AT,
          source: "inbound",
          provider: environment.provider,
          method: "POST",
          path: "/oauth2/v2.0/token",
          requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
          requestBody: "grant_type=authorization_code",
          responseStatus: 200,
          responseHeaders: { "content-type": "application/json" },
          responseBody: "{}",
          durationMs: 3,
          correlationId: "correlation_1",
        },
      ],
    };
  }

  async assertRequests(
    environmentId: string,
    assertion: AssertionSpec,
    _context: MockosToolRequestContext
  ): Promise<AssertionResult> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "assert-requests" });
    return {
      pass: assertion.path === undefined || assertion.path === "/oauth2/v2.0/token",
      matched: 1,
      message: "Matched one captured request.",
      requestIds: ["request_1"],
    };
  }

  async simulateLifecycle(
    environmentId: string,
    input: { userId: string; action: LifecycleAction },
    _context: MockosToolRequestContext
  ): Promise<LifecycleResult> {
    const environment = this.requireEnvironment(environmentId);
    this.calls.push({
      environmentId,
      operation: `lifecycle:${input.action}:${input.userId}`,
    });
    return {
      userId: input.userId,
      provider: environment.provider,
      action: input.action,
      previousState: "active",
      currentState: input.action === "disable" ? "disabled" : "active",
      changed: input.action === "disable",
      version: input.action === "disable" ? 2 : 1,
      etag: input.action === "disable" ? 'W/"2"' : 'W/"1"',
      revoked: { accessTokens: 1, refreshTokens: 1 },
    };
  }

  async getWellKnownUrls(
    environmentId: string,
    _context: MockosToolRequestContext
  ): Promise<WellKnownUrls> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "get-well-known" });
    const issuer = `https://mockos.test/e/${environmentId}`;
    return {
      issuer,
      openidConfiguration: `${issuer}/.well-known/openid-configuration`,
      authorizationEndpoint: `${issuer}/oauth2/v2.0/authorize`,
      tokenEndpoint: `${issuer}/oauth2/v2.0/token`,
      jwksUri: `${issuer}/discovery/v2.0/keys`,
      scimBaseUrl: `${issuer}/scim/v2`,
    };
  }

  async getCurrentEnvironmentId(
    _context: MockosToolRequestContext
  ): Promise<string | null> {
    return this.currentEnvironmentId;
  }

  async setCurrentEnvironmentId(
    environmentId: string | null,
    _context: MockosToolRequestContext
  ): Promise<void> {
    if (environmentId !== null) this.requireEnvironment(environmentId);
    this.currentEnvironmentId = environmentId;
  }

  private requireEnvironment(environmentId: string): EnvironmentConfig {
    const environment = this.environments.get(environmentId);
    if (!environment) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/environment-not-found",
        title: "Environment not found",
        status: 404,
        detail: `Environment ${environmentId} does not exist.`,
        code: "ENVIRONMENT_NOT_FOUND",
      });
    }
    return environment;
  }
}

type Harness = {
  client: Client;
  dependencies: InMemoryMockosDependencies;
  server: McpServer;
};

const openHarnesses: Harness[] = [];

const createHarness = async (): Promise<Harness> => {
  const dependencies = new InMemoryMockosDependencies();
  const server = new McpServer({ name: "mockos-test", version: "0.0.0" });
  registerMockosTools(server, dependencies);
  const client = new Client({ name: "mockos-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const harness = { client, dependencies, server };
  openHarnesses.push(harness);
  return harness;
};

const callData = async <T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { data: T }).data;
};

afterEach(async () => {
  const harnesses = openHarnesses.splice(0);
  await Promise.allSettled(
    harnesses.flatMap(({ client, server }) => [client.close(), server.close()])
  );
});

describe("registerMockosTools", () => {
  it("registers and drives the complete management surface", async () => {
    const { client, dependencies } = await createHarness();
    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(mockosMcpToolNames);
    expect(
      listed.tools.every(({ outputSchema }) => outputSchema?.type === "object")
    ).toBe(true);

    const created = await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Entra integration",
      provider: "entra",
    });
    expect(created).toMatchObject({
      id: ENVIRONMENT_ID,
      seed: "mockos",
      idleTtlHours: 168,
    });

    const listedData = await callData<{
      currentEnvironmentId: string | null;
      environments: EnvironmentConfig[];
    }>(client, "list_environments", {});
    expect(listedData.currentEnvironmentId).toBe(ENVIRONMENT_ID);
    expect(listedData.environments).toHaveLength(1);

    await callData(client, "set_current_environment", { environmentId: null });
    const missingCursor = await client.callTool({
      name: "get_wellknown_urls",
      arguments: {},
    });
    expect(missingCursor.isError).toBe(true);
    expect(missingCursor.structuredContent).toBeUndefined();
    expect(missingCursor._meta?.["mockos/problem"]).toMatchObject({
      status: 400,
      code: "CURRENT_ENVIRONMENT_REQUIRED",
    });

    await callData(client, "set_current_environment", {
      environmentId: ENVIRONMENT_ID,
    });
    const configured = await callData<EnvironmentConfig>(
      client,
      "configure_environment",
      { name: "Renamed environment", requestLogLimit: 2_000 }
    );
    expect(configured).toMatchObject({
      id: ENVIRONMENT_ID,
      name: "Renamed environment",
      requestLogLimit: 2_000,
    });

    const seeded = await callData<SeedIdentitiesResult>(client, "seed_identities", {
      users: [{ userName: "ada@example.com", displayName: "Ada Lovelace" }],
    });
    expect(seeded.users).toEqual([{ id: "user_1", userName: "ada@example.com" }]);

    const application = await callData<ApplicationRegistration>(
      client,
      "create_application",
      { name: "Target app", redirectUris: ["https://target.test/callback"] }
    );
    expect(application).toMatchObject({
      clientId: "client_test",
      grantTypes: ["authorization_code", "refresh_token"],
    });

    const token = await callData<MintedToken>(client, "mint_token", {
      clientId: application.clientId,
      subject: "ada@example.com",
      broken: "expired",
    });
    expect(token).toMatchObject({
      token: "header.payload.signature",
      broken: "expired",
    });

    const scenario = await callData<ScenarioSpec>(client, "set_scenario", {
      id: "force_mfa",
      injectionPoint: "oauth.token",
      action: { type: "error", code: "MFA_REQUIRED" },
    });
    expect(scenario).toMatchObject({
      probability: 1,
      enabled: true,
      action: { code: "MFA_REQUIRED" },
    });

    const log = await callData<RequestLogPage>(client, "get_request_log", {});
    expect(log.entries[0]?.correlationId).toBe("correlation_1");
    expect(dependencies.lastLogQuery?.limit).toBe(100);

    const assertion = await callData<AssertionResult>(client, "assert_requests", {
      method: "POST",
      path: "/oauth2/v2.0/token",
    });
    expect(assertion).toMatchObject({ pass: true, matched: 1 });

    const lifecycle = await callData<LifecycleResult>(client, "simulate_lifecycle", {
      userId: "user_1",
      action: "disable",
    });
    expect(lifecycle).toMatchObject({
      previousState: "active",
      currentState: "disabled",
      version: 2,
    });

    const urls = await callData<WellKnownUrls>(client, "get_wellknown_urls", {});
    expect(urls.issuer).toContain(ENVIRONMENT_ID);

    expect(
      await callData<ClearScenarioResult>(client, "clear_scenario", {
        scenarioId: "force_mfa",
      })
    ).toEqual({ cleared: 1 });

    expect(
      await callData<{
        deleted: true;
        environmentId: string;
      }>(client, "delete_environment", {})
    ).toEqual({ deleted: true, environmentId: ENVIRONMENT_ID });
    expect(dependencies.currentEnvironmentId).toBeNull();
    expect(dependencies.calls.map(({ operation }) => operation)).toEqual([
      "configure",
      "seed",
      "create-application",
      "mint:expired",
      "set-scenario:force_mfa",
      "get-request-log",
      "assert-requests",
      "lifecycle:disable:user_1",
      "get-well-known",
      "clear-scenario:force_mfa",
      "delete",
    ]);
  });

  it("lets the SDK reject invalid tool arguments before dependencies run", async () => {
    const { client, dependencies } = await createHarness();
    const invalidProvider = await client.callTool({
      name: "create_environment",
      arguments: { name: "Invalid", provider: "github" },
    });
    expect(invalidProvider.isError).toBe(true);
    expect(invalidProvider).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining("Input validation error"),
        },
      ],
    });

    const emptyPatch = await client.callTool({
      name: "configure_environment",
      arguments: {},
    });
    expect(emptyPatch.isError).toBe(true);
    expect(emptyPatch).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining("At least one environment setting is required"),
        },
      ],
    });
    expect(dependencies.environments.size).toBe(0);
  });

  it("preserves expected dependency problems as RFC 7807 tool errors", async () => {
    const { client } = await createHarness();
    await client.listTools();
    const result = await client.callTool({
      name: "set_current_environment",
      arguments: { environmentId: "env_missing" },
    });
    expect(result.isError).toBe(true);
    expect(result._meta?.["mockos/problem"]).toMatchObject({
      type: "https://mockos.live/problems/environment-not-found",
      title: "Environment not found",
      status: 404,
      code: "ENVIRONMENT_NOT_FOUND",
    });
    expect(result._meta?.["mockos/problem"]).toHaveProperty("requestId");
  });
});
