import type {
  EnvironmentConfig,
  MockLlmServerView,
  MockMcpServerView,
  ProviderId,
  ProvisioningWorkflowParams,
} from "@mockos/contracts";
import {
  mockLlmServerListSchema,
  mockLlmServerViewSchema,
  mockMcpServerListSchema,
  mockMcpServerViewSchema,
} from "@mockos/contracts";
import { createTenantId } from "@mockos/core";
import {
  type MockosToolDependencies,
  MockosToolError,
  registerMockosTools,
} from "@mockos/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { EnvironmentCatalogDurableObject } from "./environment-catalog";
import type { EnvironmentDurableObject } from "./environment-do";
import { queueAndCreateProvisioningWorkflowInstance } from "./provisioning-start";
import { publicLocationForEnvironment } from "./public-location";

export { publicLocationForEnvironment } from "./public-location";

export const SELF_HOSTED_ACCOUNT_ID = "self-hosted";

export type MockosMcpState = {
  currentEnvironmentId: string | null;
};

export type MockosMcpBindings = {
  BASE_DOMAIN?: string;
  ENTRA_HOST?: string;
  ENVIRONMENT_CATALOG: DurableObjectNamespace<EnvironmentCatalogDurableObject>;
  ENVIRONMENTS: DurableObjectNamespace<EnvironmentDurableObject>;
  HOSTING_MODE: string;
  PATH_PREFIX?: string;
  PROVISIONING_WORKFLOW: Workflow<ProvisioningWorkflowParams>;
  PUBLIC_ORIGIN: string;
  TID_INDEX?: KVNamespace;
};

type MockMcpEnvironmentRpc = {
  putMockMcpServer(input: unknown): Promise<unknown>;
  listMockMcpServers(): Promise<unknown>;
  getMockMcpServer(slug: string): Promise<unknown>;
  deleteMockMcpServer(slug: string): Promise<boolean>;
  resetMockMcpState(slug: string): Promise<number>;
};

type MockLlmEnvironmentRpc = {
  putMockLlmServer(input: unknown, expectedRevision: number | null): Promise<unknown>;
  listMockLlmServers(): Promise<unknown>;
  getMockLlmServer(slug: string): Promise<unknown>;
  deleteMockLlmServer(slug: string, expectedRevision: number): Promise<boolean>;
};

const newEnvironmentConfig = (
  input: { name: string; provider: ProviderId; seed: string },
  environmentId: string
): EnvironmentConfig => ({
  id: environmentId,
  name: input.name,
  provider: input.provider,
  seed: input.seed,
  tenantId: createTenantId(input.seed),
  createdAt: new Date().toISOString(),
  idleTtlHours: 24 * 7,
  requestLogLimit: 10_000,
});

const environmentId = () =>
  `env_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

const missingEnvironment = (environmentId: string) =>
  new MockosToolError({
    type: "https://mockos.live/problems/environment-not-found",
    title: "Environment not found",
    status: 404,
    detail: `Environment '${environmentId}' is not available to this account.`,
    code: "ENVIRONMENT_NOT_FOUND",
  });

const provisioningToolError = (error: unknown): MockosToolError | undefined => {
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code === "ACTIVE_PROVISIONING_RUN") {
    return new MockosToolError({
      type: "https://mockos.live/problems/active-provisioning-run",
      title: "Provisioning run already active",
      status: 409,
      detail:
        "Wait for the active run for this application and target to finish before starting another.",
      code,
    });
  }
  if (code === "PROVISIONING_APPLICATION_NOT_FOUND") {
    return new MockosToolError({
      type: "https://mockos.live/problems/provisioning-application-not-found",
      title: "Provisioning application not found",
      status: 404,
      detail: "The application is not available in the selected environment.",
      code,
    });
  }
  if (
    code === "PROVISIONING_WORKFLOW_START_FAILED" ||
    code === "PROVISIONING_WORKFLOW_RECONCILIATION_FAILED"
  ) {
    return new MockosToolError({
      type: "https://mockos.live/problems/provisioning-workflow-unavailable",
      title: "Provisioning Workflow unavailable",
      status: 503,
      detail:
        "The provisioning run could not be started safely. Retry after Workflow service recovery.",
      code,
    });
  }
  return undefined;
};

const missingMockMcpServer = (slug: string): MockosToolError =>
  new MockosToolError({
    type: "https://mockos.live/problems/mock-mcp-server-not-found",
    title: "Mock MCP server not found",
    status: 404,
    detail: `Mock MCP server '${slug}' is not available in the selected environment.`,
    code: "MOCK_MCP_SERVER_NOT_FOUND",
  });

const mockMcpToolError = (
  error: unknown,
  slug: string
): MockosToolError | undefined => {
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code === "server_not_found") return missingMockMcpServer(slug);
  if (code === "server_limit") {
    return new MockosToolError({
      type: "https://mockos.live/problems/mock-mcp-server-limit",
      title: "Mock MCP server limit reached",
      status: 409,
      detail:
        "Delete an existing mock MCP server before creating another in this environment.",
      code: "MOCK_MCP_SERVER_LIMIT",
    });
  }
  return undefined;
};

const missingMockLlmServer = (slug: string): MockosToolError =>
  new MockosToolError({
    type: "https://mockos.live/problems/mock-llm-server-not-found",
    title: "Mock LLM server not found",
    status: 404,
    detail: `Mock LLM server '${slug}' is not available in the selected environment.`,
    code: "MOCK_LLM_SERVER_NOT_FOUND",
  });

const mockLlmToolError = (
  error: unknown,
  slug: string
): MockosToolError | undefined => {
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code === "server_not_found") return missingMockLlmServer(slug);
  if (code === "server_revision_mismatch") {
    return new MockosToolError({
      type: "https://mockos.live/problems/mock-llm-server-revision-conflict",
      title: "Mock LLM server revision conflict",
      status: 409,
      detail:
        "Read the current mock LLM server revision and retry the mutation against that revision.",
      code: "MOCK_LLM_SERVER_REVISION_CONFLICT",
    });
  }
  if (code === "server_limit") {
    return new MockosToolError({
      type: "https://mockos.live/problems/mock-llm-server-limit",
      title: "Mock LLM server limit reached",
      status: 409,
      detail:
        "Delete an existing mock LLM server before creating another in this environment.",
      code: "MOCK_LLM_SERVER_LIMIT",
    });
  }
  if (code === "server_revision_limit") {
    return new MockosToolError({
      type: "https://mockos.live/problems/mock-llm-server-revision-limit",
      title: "Mock LLM server revision capacity reached",
      status: 409,
      detail:
        "This environment cannot safely allocate another mock LLM server revision.",
      code: "MOCK_LLM_SERVER_REVISION_LIMIT",
    });
  }
  return undefined;
};

/** Stateful, authenticated management MCP. Each transport session owns its cursor. */
export class MockosMcpAgent extends McpAgent<MockosMcpBindings, MockosMcpState> {
  server = new McpServer({ name: "mockOS", version: "0.1.0" });
  override initialState: MockosMcpState = { currentEnvironmentId: null };

  async init(): Promise<void> {
    registerMockosTools(this.server, this.#dependencies());
  }

  #catalog() {
    const id = this.env.ENVIRONMENT_CATALOG.idFromName(SELF_HOSTED_ACCOUNT_ID);
    return this.env.ENVIRONMENT_CATALOG.get(id);
  }

  #environment(environmentId: string) {
    return this.env.ENVIRONMENTS.get(this.env.ENVIRONMENTS.idFromName(environmentId));
  }

  #mockMcpEnvironment(environmentId: string): MockMcpEnvironmentRpc {
    // Cloudflare's RPC serializer type recurses through the complete mock server
    // schema. Keep that framework boundary structural and validate every complex
    // result immediately after it crosses back into the management agent.
    return this.#environment(environmentId) as unknown as MockMcpEnvironmentRpc;
  }

  #mockLlmEnvironment(environmentId: string): MockLlmEnvironmentRpc {
    // Keep the Cloudflare RPC boundary structural and validate every complex
    // safe-read result before returning it through management MCP.
    return this.#environment(environmentId) as unknown as MockLlmEnvironmentRpc;
  }

  async #requireEnvironment(environmentId: string) {
    const environment = await this.#catalog().getEnvironment(environmentId);
    if (!environment) throw missingEnvironment(environmentId);
    return environment;
  }

  #dependencies(): MockosToolDependencies {
    return {
      accountId: SELF_HOSTED_ACCOUNT_ID,
      createEnvironment: async (input) => {
        const catalog = this.#catalog();
        let config: EnvironmentConfig | undefined;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const candidate = newEnvironmentConfig(input, environmentId());
          if (await catalog.reserveEnvironment(candidate)) {
            config = candidate;
            break;
          }
        }
        if (!config) throw new Error("Could not allocate a unique environment id.");

        const environment = this.#environment(config.id);
        try {
          const configured = await environment.configure(config);
          if (this.env.TID_INDEX) {
            await this.env.TID_INDEX.put(`tid:${configured.tenantId}`, configured.id);
          }
          await catalog.activateEnvironment(config.id);
          return configured;
        } catch (error) {
          try {
            await environment.purge();
            if (this.env.TID_INDEX) {
              await this.env.TID_INDEX.delete(`tid:${config.tenantId}`);
            }
            await catalog.cancelEnvironmentReservation(config.id);
          } catch {
            // Preserve the original provisioning error.
          }
          throw error;
        }
      },
      listEnvironments: () => this.#catalog().listEnvironments(),
      deleteEnvironment: async (environmentId) => {
        const catalog = this.#catalog();
        const environment = await catalog.beginDeleteEnvironment(environmentId);
        if (!environment) return;
        let purged = false;
        try {
          await this.#environment(environmentId).purge();
          purged = true;
          if (this.env.TID_INDEX) {
            await this.env.TID_INDEX.delete(`tid:${environment.tenantId}`);
          }
          await catalog.completeDeleteEnvironment(environmentId);
        } catch (error) {
          if (!purged) await catalog.restoreEnvironment(environment);
          throw error;
        }
      },
      configureEnvironment: async (environmentId, patch) => {
        await this.#requireEnvironment(environmentId);
        const configured =
          await this.#environment(environmentId).updateConfiguration(patch);
        await this.#catalog().registerEnvironment(configured);
        return configured;
      },
      seedIdentities: async (environmentId, seed) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).seed(seed);
      },
      createApplication: async (environmentId, input) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).createApplication(input);
      },
      runProvisioningCycle: async (environmentId, input) => {
        await this.#requireEnvironment(environmentId);
        const runId = `run_${crypto.randomUUID().replaceAll("-", "")}`;
        const targetRef =
          input.target.kind === "saved"
            ? input.target.targetRef
            : input.target.target.ref;
        const params: ProvisioningWorkflowParams = {
          envId: environmentId,
          appId: input.appId,
          runId,
          mode: input.mode,
          targetRef,
        };
        const environment = this.#environment(environmentId);
        try {
          return await queueAndCreateProvisioningWorkflowInstance({
            workflow: this.env.PROVISIONING_WORKFLOW,
            environment,
            params,
            target: input.target,
          });
        } catch (error) {
          throw provisioningToolError(error) ?? error;
        }
      },
      mintToken: async (environmentId, input) => {
        const config = await this.#requireEnvironment(environmentId);
        const location = publicLocationForEnvironment(config, this.env);
        return this.#environment(environmentId).mintToken(input, {
          issuerBase: location.issuerBase,
          ...(location.graphBaseUrl ? { graphBaseUrl: location.graphBaseUrl } : {}),
        });
      },
      setScenario: async (environmentId, scenario) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).setScenario(scenario);
      },
      clearScenario: async (environmentId, scenarioId) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).clearScenario(scenarioId);
      },
      getRequestLog: async (environmentId, query) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).getRequestLog(query);
      },
      assertRequests: async (environmentId, assertion) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).assertRequests(assertion);
      },
      simulateLifecycle: async (environmentId, input) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).simulateLifecycle(
          input.userId,
          input.action
        );
      },
      getWellKnownUrls: async (environmentId) => {
        const config = await this.#requireEnvironment(environmentId);
        const location = publicLocationForEnvironment(config, this.env);
        return this.#environment(environmentId).getWellKnownUrls({
          directoryBaseUrl: location.directoryBaseUrl,
          issuerBase: location.issuerBase,
          ...(location.graphBaseUrl ? { graphBaseUrl: location.graphBaseUrl } : {}),
        });
      },
      putMockMcpServer: async (environmentId, server) => {
        await this.#requireEnvironment(environmentId);
        try {
          return mockMcpServerViewSchema.parse(
            await this.#mockMcpEnvironment(environmentId).putMockMcpServer(server)
          );
        } catch (error) {
          throw mockMcpToolError(error, server.slug) ?? error;
        }
      },
      listMockMcpServers: async (environmentId) => {
        await this.#requireEnvironment(environmentId);
        return mockMcpServerListSchema.parse({
          servers: await this.#mockMcpEnvironment(environmentId).listMockMcpServers(),
        }).servers;
      },
      getMockMcpServer: async (environmentId, slug) => {
        await this.#requireEnvironment(environmentId);
        const raw =
          await this.#mockMcpEnvironment(environmentId).getMockMcpServer(slug);
        if (!raw) throw missingMockMcpServer(slug);
        return mockMcpServerViewSchema.parse(raw) as MockMcpServerView;
      },
      deleteMockMcpServer: async (environmentId, slug) => {
        await this.#requireEnvironment(environmentId);
        return this.#mockMcpEnvironment(environmentId).deleteMockMcpServer(slug);
      },
      resetMockMcpState: async (environmentId, slug) => {
        await this.#requireEnvironment(environmentId);
        try {
          return await this.#mockMcpEnvironment(environmentId).resetMockMcpState(slug);
        } catch (error) {
          throw mockMcpToolError(error, slug) ?? error;
        }
      },
      putMockLlmServer: async (environmentId, server, expectedRevision) => {
        await this.#requireEnvironment(environmentId);
        try {
          return mockLlmServerViewSchema.parse(
            await this.#mockLlmEnvironment(environmentId).putMockLlmServer(
              server,
              expectedRevision
            )
          );
        } catch (error) {
          throw mockLlmToolError(error, server.slug) ?? error;
        }
      },
      listMockLlmServers: async (environmentId) => {
        await this.#requireEnvironment(environmentId);
        return mockLlmServerListSchema.parse({
          servers: await this.#mockLlmEnvironment(environmentId).listMockLlmServers(),
        }).servers;
      },
      getMockLlmServer: async (environmentId, slug) => {
        await this.#requireEnvironment(environmentId);
        const raw =
          await this.#mockLlmEnvironment(environmentId).getMockLlmServer(slug);
        if (!raw) throw missingMockLlmServer(slug);
        return mockLlmServerViewSchema.parse(raw) as MockLlmServerView;
      },
      deleteMockLlmServer: async (environmentId, slug, expectedRevision) => {
        await this.#requireEnvironment(environmentId);
        try {
          return await this.#mockLlmEnvironment(environmentId).deleteMockLlmServer(
            slug,
            expectedRevision
          );
        } catch (error) {
          throw mockLlmToolError(error, slug) ?? error;
        }
      },
      getCurrentEnvironmentId: async () => {
        const currentEnvironmentId = this.state.currentEnvironmentId;
        if (!currentEnvironmentId) return null;
        if (await this.#catalog().getEnvironment(currentEnvironmentId)) {
          return currentEnvironmentId;
        }
        this.setState({ currentEnvironmentId: null });
        return null;
      },
      setCurrentEnvironmentId: async (environmentId) => {
        if (environmentId) await this.#requireEnvironment(environmentId);
        this.setState({ currentEnvironmentId: environmentId });
      },
    };
  }
}
