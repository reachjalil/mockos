import {
  type ApplicationRegistration,
  type AssertionResult,
  type AssertionSpec,
  type ClearScenarioResult,
  type CreateApplicationInput,
  type CreateEnvironmentToolInput,
  type DeleteEnvironmentResult,
  type EnvironmentConfig,
  type EnvironmentPatch,
  type IdentitySeed,
  type LifecycleAction,
  type LifecycleResult,
  type MintedToken,
  type MintTokenRequest,
  type MockMcpServerSummary,
  type MockMcpServerView,
  type MockMcpServerWrite,
  type MockosMcpToolName,
  type Problem,
  type ProvisioningRun,
  problemSchema,
  provisioningRunSchema,
  type RequestLogPage,
  type RequestLogQuery,
  type RunProvisioningCycleToolInput,
  type ScenarioSpec,
  type SeedIdentitiesResult,
  type WellKnownUrls,
} from "@mockos/contracts";
import { mockosManagementOperations } from "@mockos/contracts/operations";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type MockosToolRequestContext = {
  accountId: string;
  requestId: string;
  rpcRequestId: string | number;
  sessionId?: string;
  signal: AbortSignal;
};

/**
 * Adapter boundary implemented by worker-kit (or any other control plane).
 * Every operation must enforce account ownership using the supplied context.
 * Cursor methods are expected to persist state per MCP session.
 */
export type MockosToolDependencies = {
  accountId: string;
  createEnvironment(
    input: CreateEnvironmentToolInput,
    context: MockosToolRequestContext
  ): Promise<EnvironmentConfig>;
  listEnvironments(context: MockosToolRequestContext): Promise<EnvironmentConfig[]>;
  deleteEnvironment(
    environmentId: string,
    context: MockosToolRequestContext
  ): Promise<void>;
  configureEnvironment(
    environmentId: string,
    patch: EnvironmentPatch,
    context: MockosToolRequestContext
  ): Promise<EnvironmentConfig>;
  seedIdentities(
    environmentId: string,
    seed: IdentitySeed,
    context: MockosToolRequestContext
  ): Promise<SeedIdentitiesResult>;
  createApplication(
    environmentId: string,
    input: CreateApplicationInput,
    context: MockosToolRequestContext
  ): Promise<ApplicationRegistration>;
  runProvisioningCycle(
    environmentId: string,
    input: Omit<RunProvisioningCycleToolInput, "environmentId">,
    context: MockosToolRequestContext
  ): Promise<ProvisioningRun>;
  mintToken(
    environmentId: string,
    input: MintTokenRequest,
    context: MockosToolRequestContext
  ): Promise<MintedToken>;
  setScenario(
    environmentId: string,
    scenario: ScenarioSpec,
    context: MockosToolRequestContext
  ): Promise<ScenarioSpec>;
  clearScenario(
    environmentId: string,
    scenarioId: string | undefined,
    context: MockosToolRequestContext
  ): Promise<ClearScenarioResult>;
  getRequestLog(
    environmentId: string,
    query: RequestLogQuery,
    context: MockosToolRequestContext
  ): Promise<RequestLogPage>;
  assertRequests(
    environmentId: string,
    assertion: AssertionSpec,
    context: MockosToolRequestContext
  ): Promise<AssertionResult>;
  simulateLifecycle(
    environmentId: string,
    input: { userId: string; action: LifecycleAction },
    context: MockosToolRequestContext
  ): Promise<LifecycleResult>;
  getWellKnownUrls(
    environmentId: string,
    context: MockosToolRequestContext
  ): Promise<WellKnownUrls>;
  putMockMcpServer(
    environmentId: string,
    server: MockMcpServerWrite,
    context: MockosToolRequestContext
  ): Promise<MockMcpServerView>;
  listMockMcpServers(
    environmentId: string,
    context: MockosToolRequestContext
  ): Promise<MockMcpServerSummary[]>;
  getMockMcpServer(
    environmentId: string,
    slug: string,
    context: MockosToolRequestContext
  ): Promise<MockMcpServerView>;
  deleteMockMcpServer(
    environmentId: string,
    slug: string,
    context: MockosToolRequestContext
  ): Promise<boolean>;
  resetMockMcpState(
    environmentId: string,
    slug: string,
    context: MockosToolRequestContext
  ): Promise<number>;
  getCurrentEnvironmentId(context: MockosToolRequestContext): Promise<string | null>;
  setCurrentEnvironmentId(
    environmentId: string | null,
    context: MockosToolRequestContext
  ): Promise<void>;
};

export type MockosToolProblem = Omit<Problem, "requestId"> & {
  requestId?: string;
};

/** An expected dependency failure that should be shown to the MCP caller. */
export class MockosToolError extends Error {
  readonly problem: MockosToolProblem;

  constructor(problem: MockosToolProblem) {
    super(problem.detail ?? problem.title);
    this.name = "MockosToolError";
    this.problem = problem;
  }
}

type ToolHandlerExtra = {
  requestId: string | number;
  sessionId?: string;
  signal: AbortSignal;
};

const requestContext = (
  dependencies: MockosToolDependencies,
  extra: ToolHandlerExtra
): MockosToolRequestContext => ({
  accountId: dependencies.accountId,
  requestId: `mcp_${String(extra.requestId)}`,
  rpcRequestId: extra.requestId,
  ...(extra.sessionId === undefined ? {} : { sessionId: extra.sessionId }),
  signal: extra.signal,
});

const successResult = <T>(
  data: T,
  context: MockosToolRequestContext
): CallToolResult => {
  const envelope = { data, meta: { requestId: context.requestId } };
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
};

const normalizedProblem = (
  error: unknown,
  context: MockosToolRequestContext
): Problem => {
  if (error instanceof MockosToolError) {
    const parsed = problemSchema.safeParse({
      ...error.problem,
      requestId: error.problem.requestId ?? context.requestId,
    });
    if (parsed.success) return parsed.data;
  }

  return {
    type: "https://mockos.live/problems/internal-error",
    title: "Tool operation failed",
    status: 500,
    detail: "The mockOS control plane could not complete the request.",
    requestId: context.requestId,
    code: "INTERNAL_ERROR",
  };
};

const errorResult = (problem: Problem): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(problem, null, 2) }],
  isError: true,
  _meta: { "mockos/problem": problem },
});

const redactProblem = (problem: Problem, secrets: readonly string[]): Problem => {
  const redact = (value: string): string => {
    return secrets.reduce(
      (result, secret) => result.replaceAll(secret, "[REDACTED]"),
      value
    );
  };
  return {
    ...problem,
    type: redact(problem.type),
    title: redact(problem.title),
    requestId: redact(problem.requestId),
    ...(problem.detail === undefined ? {} : { detail: redact(problem.detail) }),
    ...(problem.instance === undefined ? {} : { instance: redact(problem.instance) }),
    ...(problem.code === undefined ? {} : { code: redact(problem.code) }),
  };
};

const execute = async <T>(
  context: MockosToolRequestContext,
  operation: () => Promise<T>,
  secrets: readonly string[] = []
): Promise<CallToolResult> => {
  try {
    return successResult(await operation(), context);
  } catch (error) {
    return errorResult(redactProblem(normalizedProblem(error, context), secrets));
  }
};

const requireEnvironmentId = async (
  environmentId: string | undefined,
  dependencies: MockosToolDependencies,
  context: MockosToolRequestContext
) => {
  if (environmentId) return environmentId;
  const currentEnvironmentId = await dependencies.getCurrentEnvironmentId(context);
  if (currentEnvironmentId) return currentEnvironmentId;
  throw new MockosToolError({
    type: "https://mockos.live/problems/current-environment-required",
    title: "Current environment required",
    status: 400,
    detail: "Pass environmentId or select one with the set_current_environment tool.",
    code: "CURRENT_ENVIRONMENT_REQUIRED",
  });
};

export type RegisteredMockosTools = Record<MockosMcpToolName, RegisteredTool>;

export const registerMockosTools = (
  server: McpServer,
  dependencies: MockosToolDependencies
): RegisteredMockosTools => {
  const createEnvironment = server.registerTool(
    "create_environment",
    {
      title: mockosManagementOperations.create_environment.title,
      description: mockosManagementOperations.create_environment.description,
      ...mockosManagementOperations.create_environment.mcp,
    },
    async (input, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const environment = await dependencies.createEnvironment(input, context);
        await dependencies.setCurrentEnvironmentId(environment.id, context);
        return environment;
      });
    }
  );

  const listEnvironments = server.registerTool(
    "list_environments",
    {
      title: mockosManagementOperations.list_environments.title,
      description: mockosManagementOperations.list_environments.description,
      ...mockosManagementOperations.list_environments.mcp,
    },
    async (_input, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => ({
        environments: await dependencies.listEnvironments(context),
        currentEnvironmentId: await dependencies.getCurrentEnvironmentId(context),
      }));
    }
  );

  const deleteEnvironment = server.registerTool(
    "delete_environment",
    {
      title: mockosManagementOperations.delete_environment.title,
      description: mockosManagementOperations.delete_environment.description,
      ...mockosManagementOperations.delete_environment.mcp,
    },
    async ({ environmentId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async (): Promise<DeleteEnvironmentResult> => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        const currentEnvironmentId =
          await dependencies.getCurrentEnvironmentId(context);
        await dependencies.deleteEnvironment(resolvedId, context);
        if (currentEnvironmentId === resolvedId) {
          await dependencies.setCurrentEnvironmentId(null, context);
        }
        return { environmentId: resolvedId, deleted: true };
      });
    }
  );

  const configureEnvironment = server.registerTool(
    "configure_environment",
    {
      title: mockosManagementOperations.configure_environment.title,
      description: mockosManagementOperations.configure_environment.description,
      ...mockosManagementOperations.configure_environment.mcp,
    },
    async ({ environmentId, ...patch }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.configureEnvironment(resolvedId, patch, context);
      });
    }
  );

  const seedIdentities = server.registerTool(
    "seed_identities",
    {
      title: mockosManagementOperations.seed_identities.title,
      description: mockosManagementOperations.seed_identities.description,
      ...mockosManagementOperations.seed_identities.mcp,
    },
    async ({ environmentId, users, groups }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.seedIdentities(resolvedId, { users, groups }, context);
      });
    }
  );

  const createApplication = server.registerTool(
    "create_application",
    {
      title: mockosManagementOperations.create_application.title,
      description: mockosManagementOperations.create_application.description,
      ...mockosManagementOperations.create_application.mcp,
    },
    async ({ environmentId, ...input }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.createApplication(resolvedId, input, context);
      });
    }
  );

  const mintToken = server.registerTool(
    "mint_token",
    {
      title: mockosManagementOperations.mint_token.title,
      description: mockosManagementOperations.mint_token.description,
      ...mockosManagementOperations.mint_token.mcp,
    },
    async ({ environmentId, ...input }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.mintToken(resolvedId, input, context);
      });
    }
  );

  const runProvisioningCycle = server.registerTool(
    "run_provisioning_cycle",
    {
      title: mockosManagementOperations.run_provisioning_cycle.title,
      description: mockosManagementOperations.run_provisioning_cycle.description,
      ...mockosManagementOperations.run_provisioning_cycle.mcp,
    },
    async ({ environmentId, ...input }, extra) => {
      const context = requestContext(dependencies, extra);
      const secrets =
        input.target.kind === "inline" && input.target.target.auth.kind === "bearer"
          ? [input.target.target.auth.token]
          : [];
      return execute(
        context,
        async () => {
          const resolvedId = await requireEnvironmentId(
            environmentId,
            dependencies,
            context
          );
          return provisioningRunSchema.parse(
            await dependencies.runProvisioningCycle(resolvedId, input, context)
          );
        },
        secrets
      );
    }
  );

  const setScenario = server.registerTool(
    "set_scenario",
    {
      title: mockosManagementOperations.set_scenario.title,
      description: mockosManagementOperations.set_scenario.description,
      ...mockosManagementOperations.set_scenario.mcp,
    },
    async ({ environmentId, ...scenario }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.setScenario(resolvedId, scenario, context);
      });
    }
  );

  const clearScenario = server.registerTool(
    "clear_scenario",
    {
      title: mockosManagementOperations.clear_scenario.title,
      description: mockosManagementOperations.clear_scenario.description,
      ...mockosManagementOperations.clear_scenario.mcp,
    },
    async ({ environmentId, scenarioId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.clearScenario(resolvedId, scenarioId, context);
      });
    }
  );

  const getRequestLog = server.registerTool(
    "get_request_log",
    {
      title: mockosManagementOperations.get_request_log.title,
      description: mockosManagementOperations.get_request_log.description,
      ...mockosManagementOperations.get_request_log.mcp,
    },
    async ({ environmentId, ...query }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.getRequestLog(resolvedId, query, context);
      });
    }
  );

  const assertRequests = server.registerTool(
    "assert_requests",
    {
      title: mockosManagementOperations.assert_requests.title,
      description: mockosManagementOperations.assert_requests.description,
      ...mockosManagementOperations.assert_requests.mcp,
    },
    async ({ environmentId, ...assertion }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.assertRequests(resolvedId, assertion, context);
      });
    }
  );

  const simulateLifecycle = server.registerTool(
    "simulate_lifecycle",
    {
      title: mockosManagementOperations.simulate_lifecycle.title,
      description: mockosManagementOperations.simulate_lifecycle.description,
      ...mockosManagementOperations.simulate_lifecycle.mcp,
    },
    async ({ environmentId, userId, action }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.simulateLifecycle(resolvedId, { userId, action }, context);
      });
    }
  );

  const getWellKnownUrls = server.registerTool(
    "get_wellknown_urls",
    {
      title: mockosManagementOperations.get_wellknown_urls.title,
      description: mockosManagementOperations.get_wellknown_urls.description,
      ...mockosManagementOperations.get_wellknown_urls.mcp,
    },
    async ({ environmentId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.getWellKnownUrls(resolvedId, context);
      });
    }
  );

  const setCurrentEnvironment = server.registerTool(
    "set_current_environment",
    {
      title: mockosManagementOperations.set_current_environment.title,
      description: mockosManagementOperations.set_current_environment.description,
      ...mockosManagementOperations.set_current_environment.mcp,
    },
    async ({ environmentId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        await dependencies.setCurrentEnvironmentId(environmentId, context);
        return { environmentId };
      });
    }
  );

  const putMockMcpServer = server.registerTool(
    "put_mock_mcp_server",
    {
      title: mockosManagementOperations.put_mock_mcp_server.title,
      description: mockosManagementOperations.put_mock_mcp_server.description,
      ...mockosManagementOperations.put_mock_mcp_server.mcp,
    },
    async ({ environmentId, server: mockServer }, extra) => {
      const context = requestContext(dependencies, extra);
      const secrets =
        mockServer.authentication.mode === "bearer"
          ? [mockServer.authentication.token]
          : [];
      return execute(
        context,
        async () => {
          const resolvedId = await requireEnvironmentId(
            environmentId,
            dependencies,
            context
          );
          return dependencies.putMockMcpServer(resolvedId, mockServer, context);
        },
        secrets
      );
    }
  );

  const listMockMcpServers = server.registerTool(
    "list_mock_mcp_servers",
    {
      title: mockosManagementOperations.list_mock_mcp_servers.title,
      description: mockosManagementOperations.list_mock_mcp_servers.description,
      ...mockosManagementOperations.list_mock_mcp_servers.mcp,
    },
    async ({ environmentId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return {
          servers: await dependencies.listMockMcpServers(resolvedId, context),
        };
      });
    }
  );

  const getMockMcpServer = server.registerTool(
    "get_mock_mcp_server",
    {
      title: mockosManagementOperations.get_mock_mcp_server.title,
      description: mockosManagementOperations.get_mock_mcp_server.description,
      ...mockosManagementOperations.get_mock_mcp_server.mcp,
    },
    async ({ environmentId, slug }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return dependencies.getMockMcpServer(resolvedId, slug, context);
      });
    }
  );

  const deleteMockMcpServer = server.registerTool(
    "delete_mock_mcp_server",
    {
      title: mockosManagementOperations.delete_mock_mcp_server.title,
      description: mockosManagementOperations.delete_mock_mcp_server.description,
      ...mockosManagementOperations.delete_mock_mcp_server.mcp,
    },
    async ({ environmentId, slug }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return {
          slug,
          deleted: await dependencies.deleteMockMcpServer(resolvedId, slug, context),
        };
      });
    }
  );

  const resetMockMcpState = server.registerTool(
    "reset_mock_mcp_state",
    {
      title: mockosManagementOperations.reset_mock_mcp_state.title,
      description: mockosManagementOperations.reset_mock_mcp_state.description,
      ...mockosManagementOperations.reset_mock_mcp_state.mcp,
    },
    async ({ environmentId, slug }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        const resolvedId = await requireEnvironmentId(
          environmentId,
          dependencies,
          context
        );
        return {
          slug,
          cleared: await dependencies.resetMockMcpState(resolvedId, slug, context),
        };
      });
    }
  );

  return {
    create_environment: createEnvironment,
    list_environments: listEnvironments,
    delete_environment: deleteEnvironment,
    configure_environment: configureEnvironment,
    seed_identities: seedIdentities,
    create_application: createApplication,
    run_provisioning_cycle: runProvisioningCycle,
    mint_token: mintToken,
    set_scenario: setScenario,
    clear_scenario: clearScenario,
    get_request_log: getRequestLog,
    assert_requests: assertRequests,
    simulate_lifecycle: simulateLifecycle,
    get_wellknown_urls: getWellKnownUrls,
    set_current_environment: setCurrentEnvironment,
    put_mock_mcp_server: putMockMcpServer,
    list_mock_mcp_servers: listMockMcpServers,
    get_mock_mcp_server: getMockMcpServer,
    delete_mock_mcp_server: deleteMockMcpServer,
    reset_mock_mcp_state: resetMockMcpState,
  };
};

export const MCP_IMPLEMENTATION_MILESTONE = "M5" as const;
