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
  type MockLlmExpectedRevision,
  type MockLlmServerSummary,
  type MockLlmServerView,
  type MockLlmServerWrite,
  type MockMcpBlueprint,
  type MockMcpBlueprintCatalog,
  type MockMcpBlueprintId,
  type MockMcpBlueprintInstallResult,
  type MockMcpExpectedRevision,
  type MockMcpServerSummary,
  type MockMcpServerView,
  type MockMcpServerWrite,
  mockosMcpToolNames,
  type ProvisioningRun,
  type RequestLogPage,
  type RequestLogQuery,
  type RunProvisioningCycleToolInput,
  type ScenarioSpec,
  type SeedIdentitiesResult,
  type WellKnownUrls,
} from "@mockos/contracts";
import { generateMockosManagementDocumentationCatalog } from "@mockos/openapi";
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
const MOCK_MCP_CREDENTIAL = "synthetic-mock-mcp-credential";
const OPENAI_MOCK_CREDENTIAL = "synthetic-openai-mock-credential";
const ANTHROPIC_MOCK_CREDENTIAL = "synthetic-anthropic-mock-credential";
const MOCK_MCP_BLUEPRINT_ID =
  "salesforce/hosted-mcp/sobject-reads" as MockMcpBlueprintId;

const sha256Hex = async (value: string): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const mockMcpServerWrite = (): MockMcpServerWrite => ({
  version: 1,
  slug: "crm-sandbox",
  serverInfo: { name: "CRM sandbox", version: "1.0.0" },
  authentication: { mode: "bearer", token: MOCK_MCP_CREDENTIAL },
  transport: {
    stateful: true,
    enableGet: false,
    sessionTtlSeconds: 3_600,
  },
  pageSize: 25,
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  errorCodeMap: {},
});

const mockMcpBlueprint = (): MockMcpBlueprint => ({
  schemaVersion: 1,
  blueprintVersion: 1,
  id: MOCK_MCP_BLUEPRINT_ID,
  title: "Salesforce SObject Reads",
  description: "A deterministic synthetic Salesforce-shaped read fixture.",
  provider: "salesforce",
  provenance: {
    kind: "documentation-derived",
    upstream: {
      product: "Salesforce Hosted MCP Servers",
      server: "platform/sobject-reads",
    },
    sourceReviewedAt: "2026-07-25",
    officialDocumentationUrl:
      "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html",
  },
  fidelity: {
    behavior: "deterministic-synthetic",
    providerNetwork: false,
    outputWireParity: "unqualified",
  },
  defaultSlug: "salesforce-sobject-reads",
  toolNames: ["getUserInfo"],
  credentialMode: "none",
  server: {
    ...mockMcpServerWrite(),
    slug: "salesforce-sobject-reads",
    authentication: { mode: "none" },
    tools: [
      {
        name: "getUserInfo",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        behavior: {
          version: 1,
          type: "static",
          value: {
            content: [{ type: "text", text: "Synthetic Salesforce user" }],
          },
        },
      },
    ],
  },
});

const mockLlmServerWrite = (): MockLlmServerWrite => ({
  version: 1,
  slug: "agent-sandbox",
  name: "Agent sandbox",
  dialects: {
    openai: {
      enabled: true,
      authentication: {
        mode: "strict",
        apiKey: OPENAI_MOCK_CREDENTIAL,
      },
    },
    anthropic: {
      enabled: true,
      authentication: {
        mode: "strict",
        apiKey: ANTHROPIC_MOCK_CREDENTIAL,
      },
    },
  },
  models: [
    {
      id: "mockos-text-1",
      displayName: "mockOS Text 1",
      createdAtEpochSeconds: 1_785_000_000,
      behavior: {
        version: 1,
        type: "static",
        value: "Hello from mockOS.",
      },
    },
  ],
  defaultUsage: { inputTokens: 0, outputTokens: 0 },
  defaultCadence: {
    chunkDelayMilliseconds: 0,
    chunkSize: 256,
    maximumDurationMilliseconds: 60_000,
  },
});

class InMemoryMockosDependencies implements MockosToolDependencies {
  readonly accountId = "acct_test";
  readonly environments = new Map<string, EnvironmentConfig>();
  readonly calls: Array<{ environmentId: string; operation: string }> = [];
  readonly mockLlmServers = new Map<string, MockLlmServerView>();
  readonly mockMcpServers = new Map<string, MockMcpServerView>();
  readonly mockMcpServerWrites = new Map<string, string>();
  readonly mockMcpBlueprintCalls: string[] = [];
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
    if (input.clientType === "public") {
      return {
        id: "application_1",
        name: input.name,
        clientId: input.clientId ?? "client_test",
        clientType: "public",
        redirectUris: input.redirectUris,
        grantTypes: input.grantTypes ?? ["authorization_code", "refresh_token"],
        appRoles: input.appRoles ?? [],
        groupClaimsMode: input.groupClaimsMode ?? "none",
        createdAt: CREATED_AT,
      };
    }
    return {
      id: "application_1",
      name: input.name,
      clientId: input.clientId ?? "client_test",
      clientType: "confidential",
      clientSecret: input.clientSecret ?? "secret_test_123",
      redirectUris: input.redirectUris,
      grantTypes: input.grantTypes ?? ["authorization_code", "refresh_token"],
      appRoles: input.appRoles ?? [],
      groupClaimsMode: input.groupClaimsMode ?? "none",
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

  async runProvisioningCycle(
    environmentId: string,
    input: Omit<RunProvisioningCycleToolInput, "environmentId">,
    _context: MockosToolRequestContext
  ): Promise<ProvisioningRun> {
    const environment = this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "run-provisioning" });
    const targetRef =
      input.target.kind === "saved" ? input.target.targetRef : input.target.target.ref;
    return {
      id: "run_mcp_test_01",
      envId: environmentId,
      appId: input.appId,
      provider: environment.provider,
      mode: input.mode,
      targetRef,
      status: "queued",
      createdAt: CREATED_AT,
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

  async putMockMcpServer(
    environmentId: string,
    server: MockMcpServerWrite,
    expectedRevision: MockMcpExpectedRevision,
    _context: MockosToolRequestContext
  ): Promise<MockMcpServerView> {
    this.requireEnvironment(environmentId);
    const existing = this.mockMcpServers.get(server.slug);
    const serialized = JSON.stringify(server);
    if (existing && this.mockMcpServerWrites.get(server.slug) === serialized) {
      this.calls.push({ environmentId, operation: `put-mock-mcp:${server.slug}` });
      return existing;
    }
    if (
      (existing === undefined && expectedRevision !== null) ||
      (existing !== undefined && expectedRevision !== existing.revision)
    ) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-revision-conflict",
        title: "Mock MCP server revision conflict",
        status: 409,
        detail: `Mock MCP server ${server.slug} did not match the expected revision.`,
        code: "MOCK_MCP_SERVER_REVISION_CONFLICT",
      });
    }
    const view: MockMcpServerView = {
      spec: {
        ...server,
        authentication:
          server.authentication.mode === "none"
            ? { mode: "none" }
            : { mode: "bearer", configured: true },
      },
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: CREATED_AT,
    };
    this.mockMcpServers.set(server.slug, view);
    this.mockMcpServerWrites.set(server.slug, serialized);
    this.calls.push({ environmentId, operation: `put-mock-mcp:${server.slug}` });
    return view;
  }

  async listMockMcpServers(
    environmentId: string,
    _context: MockosToolRequestContext
  ): Promise<MockMcpServerSummary[]> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "list-mock-mcp" });
    return [...this.mockMcpServers.values()].map(({ spec, revision, updatedAt }) => ({
      slug: spec.slug,
      name: spec.serverInfo.name,
      version: spec.serverInfo.version,
      revision,
      toolCount: spec.tools.length,
      resourceCount: spec.resources.length,
      resourceTemplateCount: spec.resourceTemplates.length,
      promptCount: spec.prompts.length,
      stateful: spec.transport.stateful,
      getEnabled: spec.transport.enableGet,
      updatedAt,
    }));
  }

  async getMockMcpServer(
    environmentId: string,
    slug: string,
    _context: MockosToolRequestContext
  ): Promise<MockMcpServerView> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `get-mock-mcp:${slug}` });
    const server = this.mockMcpServers.get(slug);
    if (!server) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-not-found",
        title: "Mock MCP server not found",
        status: 404,
        code: "MOCK_MCP_SERVER_NOT_FOUND",
      });
    }
    return server;
  }

  async deleteMockMcpServer(
    environmentId: string,
    slug: string,
    expectedRevision: number,
    _context: MockosToolRequestContext
  ): Promise<true> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `delete-mock-mcp:${slug}` });
    const current = this.mockMcpServers.get(slug);
    if (!current) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-not-found",
        title: "Mock MCP server not found",
        status: 404,
        code: "MOCK_MCP_SERVER_NOT_FOUND",
      });
    }
    if (current.revision !== expectedRevision) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-revision-conflict",
        title: "Mock MCP server revision conflict",
        status: 409,
        code: "MOCK_MCP_SERVER_REVISION_CONFLICT",
      });
    }
    this.mockMcpServers.delete(slug);
    this.mockMcpServerWrites.delete(slug);
    return true;
  }

  async resetMockMcpState(
    environmentId: string,
    slug: string,
    expectedRevision: number,
    _context: MockosToolRequestContext
  ): Promise<number> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `reset-mock-mcp:${slug}` });
    const current = this.mockMcpServers.get(slug);
    if (!current) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-not-found",
        title: "Mock MCP server not found",
        status: 404,
        code: "MOCK_MCP_SERVER_NOT_FOUND",
      });
    }
    if (current.revision !== expectedRevision) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-revision-conflict",
        title: "Mock MCP server revision conflict",
        status: 409,
        code: "MOCK_MCP_SERVER_REVISION_CONFLICT",
      });
    }
    return 0;
  }

  async listMockMcpBlueprints(
    _context: MockosToolRequestContext
  ): Promise<MockMcpBlueprintCatalog> {
    this.mockMcpBlueprintCalls.push("list");
    const { server: _server, ...summary } = mockMcpBlueprint();
    return { schemaVersion: 1, blueprints: [summary] };
  }

  async getMockMcpBlueprint(
    blueprintId: MockMcpBlueprintId,
    _context: MockosToolRequestContext
  ): Promise<MockMcpBlueprint> {
    this.mockMcpBlueprintCalls.push(`get:${blueprintId}`);
    if (blueprintId !== MOCK_MCP_BLUEPRINT_ID) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-blueprint-not-found",
        title: "Mock MCP blueprint not found",
        status: 404,
        code: "MOCK_MCP_BLUEPRINT_NOT_FOUND",
      });
    }
    return mockMcpBlueprint();
  }

  async putMockLlmServer(
    environmentId: string,
    server: MockLlmServerWrite,
    expectedRevision: MockLlmExpectedRevision,
    _context: MockosToolRequestContext
  ): Promise<MockLlmServerView> {
    this.requireEnvironment(environmentId);
    const existing = this.mockLlmServers.get(server.slug);
    if (
      (existing === undefined && expectedRevision !== null) ||
      (existing !== undefined && expectedRevision !== existing.revision)
    ) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-llm-revision-conflict",
        title: "Mock LLM server revision conflict",
        status: 409,
        detail: `Mock LLM server ${server.slug} did not match the expected revision.`,
        code: "MOCK_LLM_REVISION_CONFLICT",
      });
    }

    const dialectView = (
      dialect: MockLlmServerWrite["dialects"]["openai"]
    ):
      | { enabled: false }
      | {
          enabled: true;
          authentication: { mode: "accept_any" } | { mode: "strict"; configured: true };
        } =>
      dialect.enabled
        ? {
            enabled: true,
            authentication:
              dialect.authentication.mode === "accept_any"
                ? { mode: "accept_any" }
                : { mode: "strict", configured: true },
          }
        : { enabled: false };
    const view: MockLlmServerView = {
      spec: {
        ...server,
        dialects: {
          openai: dialectView(server.dialects.openai),
          anthropic: dialectView(server.dialects.anthropic),
        },
      },
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? CREATED_AT,
      updatedAt: CREATED_AT,
    };
    this.mockLlmServers.set(server.slug, view);
    this.calls.push({ environmentId, operation: `put-mock-llm:${server.slug}` });
    return view;
  }

  async listMockLlmServers(
    environmentId: string,
    _context: MockosToolRequestContext
  ): Promise<MockLlmServerSummary[]> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: "list-mock-llm" });
    return [...this.mockLlmServers.values()].map(({ spec, revision, updatedAt }) => ({
      slug: spec.slug,
      name: spec.name,
      revision,
      modelCount: spec.models.length,
      enabledDialects: (["openai", "anthropic"] as const).filter(
        (dialect) => spec.dialects[dialect].enabled
      ),
      updatedAt,
    }));
  }

  async getMockLlmServer(
    environmentId: string,
    slug: string,
    _context: MockosToolRequestContext
  ): Promise<MockLlmServerView> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `get-mock-llm:${slug}` });
    const server = this.mockLlmServers.get(slug);
    if (!server) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-llm-server-not-found",
        title: "Mock LLM server not found",
        status: 404,
        code: "MOCK_LLM_SERVER_NOT_FOUND",
      });
    }
    return server;
  }

  async deleteMockLlmServer(
    environmentId: string,
    slug: string,
    expectedRevision: number,
    _context: MockosToolRequestContext
  ): Promise<boolean> {
    this.requireEnvironment(environmentId);
    this.calls.push({ environmentId, operation: `delete-mock-llm:${slug}` });
    const current = this.mockLlmServers.get(slug);
    if (current && current.revision !== expectedRevision) {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-llm-server-revision-conflict",
        title: "Mock LLM server revision conflict",
        status: 409,
        code: "MOCK_LLM_SERVER_REVISION_CONFLICT",
      });
    }
    return this.mockLlmServers.delete(slug);
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

type JsonSchema = {
  type?: string;
  const?: unknown;
  default?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema | boolean>;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;
  contains?: JsonSchema;
  else?: JsonSchema;
  if?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
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
  it("keeps the generated documentation schemas identical to tools/list", async () => {
    const { client } = await createHarness();
    const listed = await client.listTools();
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(listed.tools.map(({ name }) => name)).toEqual(
      catalog.managementMcp.tools.map(({ operationId }) => operationId)
    );
    for (const documented of catalog.managementMcp.tools) {
      const advertised = listed.tools.find(
        ({ name }) => name === documented.operationId
      );
      expect(advertised, documented.operationId).toBeDefined();
      expect(advertised?.inputSchema).toEqual(documented.mcp.inputSchema);
      expect(advertised?.outputSchema).toEqual(documented.mcp.outputSchema);
    }
    expect(
      listed.tools.find(({ name }) => name === "put_mock_llm_server")?.inputSchema
        .required
    ).toEqual(expect.arrayContaining(["expectedRevision", "server"]));
    expect(
      listed.tools.find(({ name }) => name === "delete_mock_llm_server")?.inputSchema
        .required
    ).toEqual(expect.arrayContaining(["expectedRevision", "slug"]));
    const putMockMcpInput = listed.tools.find(
      ({ name }) => name === "put_mock_mcp_server"
    )?.inputSchema as JsonSchema;
    expect(putMockMcpInput).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["expectedRevision", "server"],
      properties: {
        expectedRevision: {
          anyOf: [{ type: "null" }, { type: "integer", minimum: 1 }],
        },
      },
    });
    for (const name of ["put_mock_mcp_server", "install_mock_mcp_blueprint"] as const) {
      expect(
        listed.tools.find(({ name: toolName }) => toolName === name)?.annotations
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    for (const name of ["delete_mock_mcp_server", "reset_mock_mcp_state"] as const) {
      const inputSchema = listed.tools.find(({ name: toolName }) => toolName === name)
        ?.inputSchema as JsonSchema;
      expect(inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["slug", "expectedRevision"],
        properties: {
          expectedRevision: { type: "integer", minimum: 1 },
        },
      });
    }
  });

  it("reads the blueprint catalog without an environment and installs through CAS", async () => {
    const { client, dependencies } = await createHarness();
    dependencies.getCurrentEnvironmentId = async () => {
      throw new Error("Catalog reads must not resolve the environment cursor.");
    };

    const catalog = await callData<MockMcpBlueprintCatalog>(
      client,
      "list_mock_mcp_blueprints",
      {}
    );
    expect(catalog).toMatchObject({
      schemaVersion: 1,
      blueprints: [
        {
          id: MOCK_MCP_BLUEPRINT_ID,
          blueprintVersion: 1,
          fidelity: {
            behavior: "deterministic-synthetic",
            providerNetwork: false,
            outputWireParity: "unqualified",
          },
        },
      ],
    });
    const blueprint = await callData<MockMcpBlueprint>(
      client,
      "get_mock_mcp_blueprint",
      { blueprintId: MOCK_MCP_BLUEPRINT_ID }
    );
    expect(blueprint.server.slug).toBe(blueprint.defaultSlug);
    expect(dependencies.mockMcpBlueprintCalls).toEqual([
      "list",
      `get:${MOCK_MCP_BLUEPRINT_ID}`,
    ]);

    const missing = await client.callTool({
      name: "get_mock_mcp_blueprint",
      arguments: { blueprintId: "salesforce/hosted-mcp/unknown" },
    });
    expect(missing.isError).toBe(true);
    expect(missing._meta?.["mockos/problem"]).toMatchObject({
      status: 404,
      code: "MOCK_MCP_BLUEPRINT_NOT_FOUND",
    });

    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Blueprint install",
      provider: "entra",
    });
    const installed = await callData<MockMcpBlueprintInstallResult>(
      client,
      "install_mock_mcp_blueprint",
      {
        environmentId: ENVIRONMENT_ID,
        blueprintId: MOCK_MCP_BLUEPRINT_ID,
        slug: "salesforce-fixture",
        expectedRevision: null,
      }
    );
    expect(installed).toMatchObject({
      schemaVersion: 1,
      blueprintId: MOCK_MCP_BLUEPRINT_ID,
      blueprintVersion: 1,
      server: {
        revision: 1,
        spec: {
          slug: "salesforce-fixture",
          authentication: { mode: "none" },
        },
      },
    });
  });

  it("fails closed on mismatched, mutated, or credentialed blueprint install output", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Blueprint output validation",
      provider: "entra",
    });
    dependencies.getMockMcpBlueprint = async () =>
      ({
        ...mockMcpBlueprint(),
        id: "salesforce/hosted-mcp/other",
      }) as MockMcpBlueprint;
    for (const name of [
      "get_mock_mcp_blueprint",
      "install_mock_mcp_blueprint",
    ] as const) {
      const result = await client.callTool({
        name,
        arguments:
          name === "get_mock_mcp_blueprint"
            ? { blueprintId: MOCK_MCP_BLUEPRINT_ID }
            : {
                environmentId: ENVIRONMENT_ID,
                blueprintId: MOCK_MCP_BLUEPRINT_ID,
                slug: "validated-blueprint",
                expectedRevision: null,
              },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.["mockos/problem"]).toMatchObject({
        status: 500,
        code: "INTERNAL_ERROR",
      });
    }

    dependencies.getMockMcpBlueprint = async () => mockMcpBlueprint();
    const selectedServer = {
      ...mockMcpBlueprint().server,
      slug: "validated-blueprint",
    };
    const safeView: MockMcpServerView = {
      spec: selectedServer,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    const unexpectedTool = {
      name: "unexpectedTool",
      inputSchema: { type: "object" as const, additionalProperties: false },
      behavior: {
        version: 1 as const,
        type: "static" as const,
        value: {
          content: [{ type: "text" as const, text: "Unexpected dependency output" }],
        },
      },
    };
    for (const maliciousView of [
      {
        ...safeView,
        spec: { ...safeView.spec, slug: "wrong-slug" },
      },
      {
        ...safeView,
        spec: {
          ...safeView.spec,
          authentication: { mode: "bearer", configured: true },
        },
      },
      {
        ...safeView,
        spec: {
          ...safeView.spec,
          tools: [...safeView.spec.tools, unexpectedTool],
        },
      },
    ] as MockMcpServerView[]) {
      dependencies.putMockMcpServer = async () => maliciousView;
      const result = await client.callTool({
        name: "install_mock_mcp_blueprint",
        arguments: {
          environmentId: ENVIRONMENT_ID,
          blueprintId: MOCK_MCP_BLUEPRINT_ID,
          slug: "validated-blueprint",
          expectedRevision: null,
        },
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.["mockos/problem"]).toMatchObject({
        status: 500,
        code: "INTERNAL_ERROR",
      });
    }

    dependencies.putMockMcpServer = async (_environmentId, server) => {
      server.tools.push(unexpectedTool);
      return {
        ...safeView,
        spec: {
          ...safeView.spec,
          tools: server.tools,
        },
      } as MockMcpServerView;
    };
    const mutatedInput = await client.callTool({
      name: "install_mock_mcp_blueprint",
      arguments: {
        environmentId: ENVIRONMENT_ID,
        blueprintId: MOCK_MCP_BLUEPRINT_ID,
        slug: "validated-blueprint",
        expectedRevision: null,
      },
    });
    expect(mutatedInput.isError).toBe(true);
    expect(mutatedInput._meta?.["mockos/problem"]).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it("advertises conditional application inputs and exact registration outputs", async () => {
    const { client } = await createHarness();
    const listed = await client.listTools();
    const tool = listed.tools.find(({ name }) => name === "create_application");
    expect(tool).toBeDefined();

    const inputSchema = tool?.inputSchema as JsonSchema;
    expect(inputSchema).toMatchObject({
      type: "object",
      required: ["name", "redirectUris"],
      additionalProperties: false,
      properties: {
        clientType: {
          type: "string",
          enum: ["confidential", "public"],
          default: "confidential",
        },
        grantTypes: {
          type: "array",
          default: ["authorization_code", "refresh_token"],
        },
        appRoles: { type: "array", default: [] },
        groupClaimsMode: { type: "string", default: "none" },
        clientSecret: { type: "string" },
        redirectUris: {
          type: "array",
          maxItems: 50,
        },
      },
    });
    expect(inputSchema.properties?.redirectUris).not.toHaveProperty("minItems");
    expect(inputSchema.required).not.toContain("clientType");
    expect(inputSchema.required).not.toContain("grantTypes");
    expect(inputSchema.required).not.toContain("appRoles");
    expect(inputSchema.required).not.toContain("groupClaimsMode");

    const publicCondition = inputSchema.allOf?.[0];
    expect(publicCondition).toMatchObject({
      if: {
        properties: { clientType: { const: "public" } },
        required: ["clientType"],
      },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the JSON Schema conditional keyword under test.
      then: {
        not: { required: ["clientSecret"] },
        properties: {
          grantTypes: {
            items: {
              enum: [
                "authorization_code",
                "refresh_token",
                "urn:ietf:params:oauth:grant-type:device_code",
              ],
            },
          },
        },
      },
    });
    const redirectPolicy = inputSchema.allOf?.[1];
    expect(redirectPolicy).toMatchObject({
      if: {
        properties: {
          clientType: { const: "public" },
          grantTypes: {
            allOf: [
              {
                contains: {
                  const: "urn:ietf:params:oauth:grant-type:device_code",
                },
              },
              {
                not: {
                  contains: {
                    const: "authorization_code",
                  },
                },
              },
            ],
          },
        },
        required: ["clientType", "grantTypes"],
      },
      else: {
        properties: {
          redirectUris: { minItems: 1 },
        },
      },
    });
    if (!redirectPolicy) {
      throw new Error("Application redirect policy was missing from MCP discovery.");
    }

    const outputSchema = tool?.outputSchema as JsonSchema;
    const registrationSchema = outputSchema.properties?.data as JsonSchema;
    expect(registrationSchema.allOf?.[0]).toEqual(redirectPolicy);
    expect(registrationSchema.oneOf).toHaveLength(2);
    const confidentialRegistration = registrationSchema.oneOf?.find(
      (branch) =>
        (branch.properties?.clientType as JsonSchema | undefined)?.const ===
        "confidential"
    );
    const publicRegistration = registrationSchema.oneOf?.find(
      (branch) =>
        (branch.properties?.clientType as JsonSchema | undefined)?.const === "public"
    );
    expect(confidentialRegistration).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(confidentialRegistration?.required).toEqual(
      expect.arrayContaining([
        "clientType",
        "clientSecret",
        "grantTypes",
        "appRoles",
        "groupClaimsMode",
      ])
    );
    expect(publicRegistration).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(publicRegistration?.required).toEqual(
      expect.arrayContaining([
        "clientType",
        "grantTypes",
        "appRoles",
        "groupClaimsMode",
      ])
    );
    expect(publicRegistration?.properties).not.toHaveProperty("clientSecret");
  });

  it("keeps an omitted client type backward-compatible as confidential", async () => {
    const { client } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Legacy default",
      provider: "okta",
    });

    const application = await callData<ApplicationRegistration>(
      client,
      "create_application",
      {
        name: "Legacy confidential app",
        redirectUris: ["https://target.test/legacy-callback"],
      }
    );
    expect(application.clientType).toBe("confidential");
    if (application.clientType !== "confidential") {
      throw new Error("Omitted clientType must resolve to confidential.");
    }
    expect(application).toMatchObject({
      clientSecret: "secret_test_123",
      grantTypes: ["authorization_code", "refresh_token"],
      appRoles: [],
      groupClaimsMode: "none",
    });
  });

  it("registers and drives the complete management surface", async () => {
    const { client, dependencies } = await createHarness();
    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual(mockosMcpToolNames);
    expect(
      listed.tools.every(({ outputSchema }) => outputSchema?.type === "object")
    ).toBe(true);
    expect(
      listed.tools.find(({ name }) => name === "run_provisioning_cycle")?.annotations
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });

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
      clientType: "confidential",
      grantTypes: ["authorization_code", "refresh_token"],
    });
    if (application.clientType !== "confidential") {
      throw new Error("Legacy application must be confidential.");
    }
    expect(application.clientSecret).toBe("secret_test_123");

    const publicApplication = await callData<ApplicationRegistration>(
      client,
      "create_application",
      {
        name: "Public PKCE app",
        clientType: "public",
        redirectUris: ["https://target.test/public-callback"],
      }
    );
    expect(publicApplication).toMatchObject({
      clientId: "client_test",
      clientType: "public",
      grantTypes: ["authorization_code", "refresh_token"],
    });
    expect(publicApplication).not.toHaveProperty("clientSecret");
    const publicDeviceApplication = await callData<ApplicationRegistration>(
      client,
      "create_application",
      {
        name: "Redirectless public device app",
        clientType: "public",
        redirectUris: [],
        grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      }
    );
    expect(publicDeviceApplication).toMatchObject({
      clientId: "client_test",
      clientType: "public",
      redirectUris: [],
      grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    });
    expect(publicDeviceApplication).not.toHaveProperty("clientSecret");

    const applicationCallsBeforeInvalidRedirects = dependencies.calls.filter(
      ({ operation }) => operation === "create-application"
    ).length;
    for (const arguments_ of [
      {
        name: "Default confidential device app",
        redirectUris: [],
        grantTypes: ["urn:ietf:params:oauth:grant-type:device_code"],
      },
      {
        name: "Explicit confidential device app",
        clientType: "confidential",
        redirectUris: [],
        grantTypes: ["urn:ietf:params:oauth:grant-type:device_code"],
      },
      {
        name: "Public authorization-code app",
        clientType: "public",
        redirectUris: [],
        grantTypes: ["authorization_code"],
      },
      {
        name: "Public mixed code and device app",
        clientType: "public",
        redirectUris: [],
        grantTypes: [
          "authorization_code",
          "urn:ietf:params:oauth:grant-type:device_code",
        ],
      },
      {
        name: "Public refresh-only app",
        clientType: "public",
        redirectUris: [],
        grantTypes: ["refresh_token"],
      },
    ]) {
      const invalidRedirects = await client.callTool({
        name: "create_application",
        arguments: arguments_,
      });
      expect(invalidRedirects.isError).toBe(true);
    }
    expect(
      dependencies.calls.filter(({ operation }) => operation === "create-application")
    ).toHaveLength(applicationCallsBeforeInvalidRedirects);

    const rejectedPublicSecret = "must-not-be accepted!";
    const invalidPublicApplication = await client.callTool({
      name: "create_application",
      arguments: {
        name: "Invalid public app",
        clientType: "public",
        clientSecret: rejectedPublicSecret,
        redirectUris: ["https://target.test/invalid-callback"],
      },
    });
    expect(invalidPublicApplication.isError).toBe(true);
    expect(JSON.stringify(invalidPublicApplication)).not.toContain(
      rejectedPublicSecret
    );
    expect(JSON.stringify(invalidPublicApplication)).not.toContain(
      encodeURIComponent(rejectedPublicSecret)
    );
    expect(JSON.stringify(invalidPublicApplication)).not.toContain(
      new URLSearchParams({ value: rejectedPublicSecret })
        .toString()
        .slice("value=".length)
    );

    const provisioning = await callData<ProvisioningRun>(
      client,
      "run_provisioning_cycle",
      {
        appId: application.id,
        target: {
          kind: "inline",
          target: {
            ref: "target-app",
            baseUrl: "https://target.test/scim/v2",
          },
        },
      }
    );
    expect(provisioning).toMatchObject({
      id: "run_mcp_test_01",
      envId: ENVIRONMENT_ID,
      appId: application.id,
      provider: "entra",
      mode: "incremental",
      targetRef: "target-app",
      status: "queued",
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

    const mockServer = await callData<MockMcpServerView>(
      client,
      "put_mock_mcp_server",
      {
        expectedRevision: null,
        server: {
          version: 1,
          slug: "crm-sandbox",
          serverInfo: { name: "CRM sandbox", version: "1.0.0" },
          authentication: { mode: "bearer", token: MOCK_MCP_CREDENTIAL },
          tools: [
            {
              name: "lookup_contact",
              behavior: {
                version: 1,
                type: "static",
                value: {
                  content: [{ type: "text", text: "Synthetic contact" }],
                },
              },
            },
          ],
        },
      }
    );
    expect(mockServer).toMatchObject({
      spec: {
        slug: "crm-sandbox",
        authentication: { mode: "bearer", configured: true },
      },
      revision: 1,
    });
    expect(JSON.stringify(mockServer)).not.toContain(MOCK_MCP_CREDENTIAL);
    expect(JSON.stringify(mockServer)).not.toContain("tokenSha256");

    const mockServers = await callData<{ servers: MockMcpServerSummary[] }>(
      client,
      "list_mock_mcp_servers",
      {}
    );
    expect(mockServers.servers).toMatchObject([{ slug: "crm-sandbox", toolCount: 1 }]);
    expect(
      await callData<MockMcpServerView>(client, "get_mock_mcp_server", {
        slug: "crm-sandbox",
      })
    ).toEqual(mockServer);
    expect(
      await callData(client, "reset_mock_mcp_state", {
        slug: "crm-sandbox",
        expectedRevision: mockServer.revision,
      })
    ).toEqual({ slug: "crm-sandbox", cleared: 0 });
    expect(
      await callData(client, "delete_mock_mcp_server", {
        slug: "crm-sandbox",
        expectedRevision: mockServer.revision,
      })
    ).toEqual({ slug: "crm-sandbox", deleted: true });

    const mockLlmServer = await callData<MockLlmServerView>(
      client,
      "put_mock_llm_server",
      {
        expectedRevision: null,
        server: mockLlmServerWrite(),
      }
    );
    expect(mockLlmServer).toMatchObject({
      spec: {
        slug: "agent-sandbox",
        dialects: {
          openai: {
            enabled: true,
            authentication: { mode: "strict", configured: true },
          },
          anthropic: {
            enabled: true,
            authentication: { mode: "strict", configured: true },
          },
        },
      },
      revision: 1,
    });
    expect(JSON.stringify(mockLlmServer)).not.toContain(OPENAI_MOCK_CREDENTIAL);
    expect(JSON.stringify(mockLlmServer)).not.toContain(ANTHROPIC_MOCK_CREDENTIAL);
    expect(JSON.stringify(mockLlmServer)).not.toContain("apiKeySha256");
    const mockLlmServers = await callData<{ servers: MockLlmServerSummary[] }>(
      client,
      "list_mock_llm_servers",
      {}
    );
    expect(mockLlmServers.servers).toMatchObject([
      {
        slug: "agent-sandbox",
        modelCount: 1,
        enabledDialects: ["openai", "anthropic"],
      },
    ]);
    expect(
      await callData<MockLlmServerView>(client, "get_mock_llm_server", {
        slug: "agent-sandbox",
      })
    ).toEqual(mockLlmServer);
    expect(
      await callData(client, "delete_mock_llm_server", {
        slug: "agent-sandbox",
        expectedRevision: 1,
      })
    ).toEqual({ slug: "agent-sandbox", deleted: true });

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
      "create-application",
      "create-application",
      "run-provisioning",
      "mint:expired",
      "set-scenario:force_mfa",
      "get-request-log",
      "assert-requests",
      "lifecycle:disable:user_1",
      "get-well-known",
      "put-mock-mcp:crm-sandbox",
      "list-mock-mcp",
      "get-mock-mcp:crm-sandbox",
      "reset-mock-mcp:crm-sandbox",
      "delete-mock-mcp:crm-sandbox",
      "put-mock-llm:agent-sandbox",
      "list-mock-llm",
      "get-mock-llm:agent-sandbox",
      "delete-mock-llm:agent-sandbox",
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

    const platformKey = "mk_platform_secret_must_not_be_forwarded";
    const invalidTargetCredential = await client.callTool({
      name: "run_provisioning_cycle",
      arguments: {
        environmentId: ENVIRONMENT_ID,
        appId: "application_1",
        target: {
          kind: "inline",
          target: {
            ref: "target-app",
            baseUrl: "https://target.test/scim/v2",
            auth: { kind: "bearer", token: platformKey },
          },
        },
      },
    });
    expect(invalidTargetCredential.isError).toBe(true);
    expect(JSON.stringify(invalidTargetCredential)).not.toContain(platformKey);
    const targetSecret = "synthetic-target-secret-validation";
    const invalidTargetUrl = await client.callTool({
      name: "run_provisioning_cycle",
      arguments: {
        environmentId: ENVIRONMENT_ID,
        appId: "application_1",
        target: {
          kind: "inline",
          target: {
            ref: "target-app",
            baseUrl: "ftp://target.test/scim/v2",
            auth: { kind: "bearer", token: targetSecret },
          },
        },
      },
    });
    expect(invalidTargetUrl.isError).toBe(true);
    expect(JSON.stringify(invalidTargetUrl)).not.toContain(targetSecret);

    const invalidMockLlm = await client.callTool({
      name: "put_mock_llm_server",
      arguments: {
        expectedRevision: null,
        server: {
          ...mockLlmServerWrite(),
          slug: "INVALID/SLUG",
        },
      },
    });
    expect(invalidMockLlm.isError).toBe(true);
    expect(JSON.stringify(invalidMockLlm)).not.toContain(OPENAI_MOCK_CREDENTIAL);
    expect(JSON.stringify(invalidMockLlm)).not.toContain(ANTHROPIC_MOCK_CREDENTIAL);
    expect(dependencies.calls).not.toContainEqual({
      environmentId: ENVIRONMENT_ID,
      operation: "run-provisioning",
    });
    expect(dependencies.calls).not.toContainEqual(
      expect.objectContaining({ operation: "put-mock-llm:INVALID/SLUG" })
    );
    expect(dependencies.environments.size).toBe(0);
  });

  it("validates provisioning dependency output before serializing it", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Output validation",
      provider: "okta",
    });
    const leakedCredential = "synthetic-target-secret-never-return";
    dependencies.runProvisioningCycle = async (
      environmentId,
      input
    ): Promise<ProvisioningRun> =>
      ({
        id: "run_invalid_output",
        envId: environmentId,
        appId: input.appId,
        provider: "okta",
        mode: input.mode,
        targetRef:
          input.target.kind === "saved"
            ? input.target.targetRef
            : input.target.target.ref,
        status: "queued",
        createdAt: CREATED_AT,
        credential: leakedCredential,
      }) as ProvisioningRun;

    const result = await client.callTool({
      name: "run_provisioning_cycle",
      arguments: {
        appId: "application_1",
        target: { kind: "saved", targetRef: "target-app" },
      },
    });
    expect(result.isError).toBe(true);
    expect(result._meta?.["mockos/problem"]).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(result)).not.toContain(leakedCredential);

    dependencies.runProvisioningCycle = async () => {
      throw new MockosToolError({
        type: "https://mockos.live/problems/target-rejected",
        title: "Target rejected",
        status: 400,
        detail: `The target rejected ${leakedCredential}`,
        code: "TARGET_REJECTED",
      });
    };
    const redactedError = await client.callTool({
      name: "run_provisioning_cycle",
      arguments: {
        appId: "application_1",
        target: {
          kind: "inline",
          target: {
            ref: "target-app",
            baseUrl: "https://target.test/scim/v2",
            auth: { kind: "bearer", token: leakedCredential },
          },
        },
      },
    });
    expect(redactedError.isError).toBe(true);
    expect(redactedError._meta?.["mockos/problem"]).toMatchObject({
      status: 400,
      detail: "The target rejected [REDACTED]",
    });
    expect(JSON.stringify(redactedError)).not.toContain(leakedCredential);
  });

  it("forwards every mock-MCP revision precondition and redacts its bearer credential", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "MCP contract",
      provider: "entra",
    });

    let receivedPutRevision: MockMcpExpectedRevision | undefined;
    dependencies.putMockMcpServer = async (
      _environmentId,
      server,
      expectedRevision
    ) => {
      receivedPutRevision = expectedRevision;
      const credential =
        server.authentication.mode === "bearer" ? server.authentication.token : "";
      const verifier = await sha256Hex(credential);
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-mcp-server-revision-conflict",
        title: "Mock MCP server revision conflict",
        status: 409,
        detail: `Rejected ${credential} and ${verifier}.`,
        code: "MOCK_MCP_SERVER_REVISION_CONFLICT",
      });
    };

    const putResult = await client.callTool({
      name: "put_mock_mcp_server",
      arguments: {
        expectedRevision: 7,
        server: mockMcpServerWrite(),
      },
    });
    expect(receivedPutRevision).toBe(7);
    expect(putResult.isError).toBe(true);
    expect(putResult._meta?.["mockos/problem"]).toMatchObject({
      status: 409,
      code: "MOCK_MCP_SERVER_REVISION_CONFLICT",
      detail: "Rejected [REDACTED] and [REDACTED].",
    });
    expect(JSON.stringify(putResult)).not.toContain(MOCK_MCP_CREDENTIAL);
    expect(JSON.stringify(putResult)).not.toContain(
      await sha256Hex(MOCK_MCP_CREDENTIAL)
    );

    let receivedDeleteRevision: number | undefined;
    dependencies.deleteMockMcpServer = async (
      _environmentId,
      _slug,
      expectedRevision
    ) => {
      receivedDeleteRevision = expectedRevision;
      return true;
    };
    await expect(
      callData(client, "delete_mock_mcp_server", {
        slug: "crm-sandbox",
        expectedRevision: 11,
      })
    ).resolves.toEqual({ slug: "crm-sandbox", deleted: true });
    expect(receivedDeleteRevision).toBe(11);

    let receivedResetRevision: number | undefined;
    dependencies.resetMockMcpState = async (
      _environmentId,
      _slug,
      expectedRevision
    ) => {
      receivedResetRevision = expectedRevision;
      return 3;
    };
    await expect(
      callData(client, "reset_mock_mcp_state", {
        slug: "crm-sandbox",
        expectedRevision: 12,
      })
    ).resolves.toEqual({ slug: "crm-sandbox", cleared: 3 });
    expect(receivedResetRevision).toBe(12);
  });

  it("fails closed when a mock-MCP dependency reflects a write-only credential", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "Malicious MCP dependency",
      provider: "entra",
    });
    const server = mockMcpServerWrite();
    if (server.authentication.mode !== "bearer") {
      throw new Error("The test server must use bearer authentication.");
    }
    const credential = server.authentication.token;
    const verifier = await sha256Hex(credential);
    dependencies.putMockMcpServer = async () => ({
      spec: {
        ...server,
        instructions: `A malicious dependency reflected ${verifier}.`,
        authentication: { mode: "bearer", configured: true },
      },
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    const result = await client.callTool({
      name: "put_mock_mcp_server",
      arguments: {
        expectedRevision: null,
        server,
      },
    });

    expect(result.isError).toBe(true);
    expect(result._meta?.["mockos/problem"]).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).not.toContain(verifier);
  });

  it("forwards mock-LLM CAS inputs and redacts both provider credentials", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "LLM contract",
      provider: "entra",
    });

    let receivedExpectedRevision: MockLlmExpectedRevision | undefined;
    dependencies.putMockLlmServer = async (
      _environmentId,
      server,
      expectedRevision
    ) => {
      receivedExpectedRevision = expectedRevision;
      const openai = server.dialects.openai;
      const anthropic = server.dialects.anthropic;
      const openaiCredential =
        openai.enabled &&
        openai.authentication.mode === "strict" &&
        "apiKey" in openai.authentication
          ? openai.authentication.apiKey
          : "";
      const anthropicCredential =
        anthropic.enabled &&
        anthropic.authentication.mode === "strict" &&
        "apiKey" in anthropic.authentication
          ? anthropic.authentication.apiKey
          : "";
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-llm-revision-conflict",
        title: "Mock LLM server revision conflict",
        status: 409,
        detail: `Rejected ${openaiCredential} and ${anthropicCredential}.`,
        code: "MOCK_LLM_REVISION_CONFLICT",
      });
    };

    const result = await client.callTool({
      name: "put_mock_llm_server",
      arguments: {
        expectedRevision: 7,
        server: mockLlmServerWrite(),
      },
    });
    expect(receivedExpectedRevision).toBe(7);
    expect(result.isError).toBe(true);
    expect(result._meta?.["mockos/problem"]).toMatchObject({
      status: 409,
      code: "MOCK_LLM_REVISION_CONFLICT",
      detail: "Rejected [REDACTED] and [REDACTED].",
    });
    expect(JSON.stringify(result)).not.toContain(OPENAI_MOCK_CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(ANTHROPIC_MOCK_CREDENTIAL);

    const shorterCredential = "abcdefghijklmnop";
    const longerCredential = "abcdefghijklmnopSECRET_SUFFIX";
    dependencies.putMockLlmServer = async () => {
      throw new MockosToolError({
        type: "https://mockos.live/problems/mock-llm-revision-conflict",
        title: "Mock LLM server revision conflict",
        status: 409,
        detail: `Rejected ${shorterCredential} and ${longerCredential}.`,
        code: "MOCK_LLM_REVISION_CONFLICT",
      });
    };
    const overlappingCredentials = mockLlmServerWrite();
    const overlapResult = await client.callTool({
      name: "put_mock_llm_server",
      arguments: {
        expectedRevision: 7,
        server: {
          ...overlappingCredentials,
          dialects: {
            openai: {
              enabled: true,
              authentication: {
                mode: "strict",
                apiKey: shorterCredential,
              },
            },
            anthropic: {
              enabled: true,
              authentication: {
                mode: "strict",
                apiKey: longerCredential,
              },
            },
          },
        },
      },
    });
    expect(overlapResult._meta?.["mockos/problem"]).toMatchObject({
      detail: "Rejected [REDACTED] and [REDACTED].",
    });
    expect(JSON.stringify(overlapResult)).not.toContain(shorterCredential);
    expect(JSON.stringify(overlapResult)).not.toContain(longerCredential);
  });

  it("never reflects a strict Mock Credential from pre-handler validation", async () => {
    const { client } = await createHarness();
    const credential = "synthetic-validation-secret-123";
    const base = mockLlmServerWrite();
    const serializeFailure = async (arguments_: Record<string, unknown>) => {
      try {
        const result = await client.callTool({
          name: "put_mock_llm_server",
          arguments: arguments_,
        });
        return {
          rejected: result.isError === true,
          serialized: JSON.stringify(result),
        };
      } catch (error) {
        return {
          rejected: true,
          serialized:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : JSON.stringify(error),
        };
      }
    };

    const duplicateIdFailure = await serializeFailure({
      expectedRevision: null,
      server: {
        ...base,
        dialects: {
          ...base.dialects,
          openai: {
            enabled: true,
            authentication: { mode: "strict", apiKey: credential },
          },
        },
        models: [
          { ...base.models[0], id: credential },
          { ...base.models[0], id: credential },
        ],
      },
    });
    expect(duplicateIdFailure.rejected).toBe(true);
    expect(duplicateIdFailure.serialized).not.toContain(credential);

    const malformedModeAndUnknownKeyFailure = await serializeFailure({
      expectedRevision: null,
      server: {
        ...base,
        [credential]: "unknown server field",
        dialects: {
          ...base.dialects,
          openai: {
            enabled: true,
            authentication: {
              mode: "strcit",
              apiKey: credential,
            },
          },
        },
      },
    });
    expect(malformedModeAndUnknownKeyFailure.rejected).toBe(true);
    expect(malformedModeAndUnknownKeyFailure.serialized).not.toContain(credential);

    const topLevelUnknownKeyFailure = await serializeFailure({
      expectedRevision: null,
      server: {
        ...base,
        dialects: {
          ...base.dialects,
          openai: {
            enabled: true,
            authentication: { mode: "strict", apiKey: credential },
          },
        },
      },
      [credential]: "unknown top-level field",
    });
    expect(topLevelUnknownKeyFailure.rejected).toBe(true);
    expect(topLevelUnknownKeyFailure.serialized).not.toContain(credential);
  });

  it("never reflects a mock-MCP bearer credential from pre-handler validation", async () => {
    const { client, dependencies } = await createHarness();
    const credential = "synthetic-mcp-validation-secret";
    const server = {
      ...mockMcpServerWrite(),
      authentication: { mode: "bearer", token: credential },
    };
    const serializeFailure = async (arguments_: Record<string, unknown>) => {
      try {
        const result = await client.callTool({
          name: "put_mock_mcp_server",
          arguments: arguments_,
        });
        return {
          rejected: result.isError === true,
          serialized: JSON.stringify(result),
        };
      } catch (error) {
        return {
          rejected: true,
          serialized:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : JSON.stringify(error),
        };
      }
    };

    for (const arguments_ of [
      { server },
      { expectedRevision: 0, server },
      {
        expectedRevision: null,
        server: {
          ...server,
          [credential]: "unknown server field",
        },
      },
      {
        expectedRevision: null,
        server: {
          ...server,
          tools: [
            {
              name: credential,
              behavior: {
                version: 1,
                type: "static",
                value: { content: [{ type: "text", text: "one" }] },
              },
            },
            {
              name: credential,
              behavior: {
                version: 1,
                type: "static",
                value: { content: [{ type: "text", text: "two" }] },
              },
            },
          ],
        },
      },
      {
        expectedRevision: null,
        server,
        [credential]: "unknown top-level field",
      },
    ]) {
      const failure = await serializeFailure(arguments_);
      expect(failure.rejected).toBe(true);
      expect(failure.serialized).not.toContain(credential);
    }
    expect(dependencies.calls).not.toContainEqual(
      expect.objectContaining({ operation: "put-mock-mcp:crm-sandbox" })
    );
  });

  it("requires an environment cursor and preserves mock-LLM not-found errors", async () => {
    const { client, dependencies } = await createHarness();
    const missingCursor = await client.callTool({
      name: "list_mock_llm_servers",
      arguments: {},
    });
    expect(missingCursor.isError).toBe(true);
    expect(missingCursor._meta?.["mockos/problem"]).toMatchObject({
      status: 400,
      code: "CURRENT_ENVIRONMENT_REQUIRED",
    });

    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "LLM lookup",
      provider: "okta",
    });
    await callData(client, "set_current_environment", { environmentId: null });
    const missing = await client.callTool({
      name: "get_mock_llm_server",
      arguments: {
        environmentId: ENVIRONMENT_ID,
        slug: "missing-server",
      },
    });
    expect(missing.isError).toBe(true);
    expect(missing._meta?.["mockos/problem"]).toMatchObject({
      status: 404,
      code: "MOCK_LLM_SERVER_NOT_FOUND",
    });
    expect(dependencies.calls).toContainEqual({
      environmentId: ENVIRONMENT_ID,
      operation: "get-mock-llm:missing-server",
    });
  });

  it("rejects unsafe mock-LLM dependency output before serialization", async () => {
    const { client, dependencies } = await createHarness();
    await callData<EnvironmentConfig>(client, "create_environment", {
      name: "LLM output safety",
      provider: "entra",
    });
    const leakedVerifier = "a".repeat(64);
    dependencies.getMockLlmServer = async () =>
      ({
        spec: {
          ...mockLlmServerWrite(),
          dialects: {
            openai: {
              enabled: true,
              authentication: {
                mode: "strict",
                configured: true,
                apiKeySha256: leakedVerifier,
              },
            },
            anthropic: { enabled: false },
          },
        },
        revision: 1,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }) as MockLlmServerView;

    const result = await client.callTool({
      name: "get_mock_llm_server",
      arguments: { slug: "agent-sandbox" },
    });
    expect(result.isError).toBe(true);
    expect(result._meta?.["mockos/problem"]).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(result)).not.toContain(leakedVerifier);
    expect(result.structuredContent).toBeUndefined();

    dependencies.putMockLlmServer = async () =>
      ({
        spec: {
          ...mockLlmServerWrite(),
          dialects: {
            openai: {
              enabled: true,
              authentication: { mode: "strict", configured: true },
            },
            anthropic: { enabled: false },
          },
          models: [
            {
              ...mockLlmServerWrite().models[0],
              behavior: {
                version: 1,
                type: "static",
                value: OPENAI_MOCK_CREDENTIAL,
              },
            },
          ],
        },
        revision: 1,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }) as MockLlmServerView;
    const copiedCredential = await client.callTool({
      name: "put_mock_llm_server",
      arguments: {
        expectedRevision: null,
        server: mockLlmServerWrite(),
      },
    });
    expect(copiedCredential.isError).toBe(true);
    expect(copiedCredential._meta?.["mockos/problem"]).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(copiedCredential)).not.toContain(OPENAI_MOCK_CREDENTIAL);
    expect(copiedCredential.structuredContent).toBeUndefined();
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
