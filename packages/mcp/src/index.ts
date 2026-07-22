import {
  type ApplicationRegistration,
  type AssertionResult,
  type AssertionSpec,
  applicationRegistrationSchema,
  assertionResultSchema,
  assertRequestsToolInputSchema,
  type ClearScenarioResult,
  type CreateApplicationInput,
  type CreateEnvironmentToolInput,
  clearScenarioResultSchema,
  clearScenarioToolInputSchema,
  configureEnvironmentToolInputSchema,
  createApplicationToolInputSchema,
  createEnvironmentToolInputSchema,
  currentEnvironmentCursorSchema,
  type DeleteEnvironmentResult,
  deleteEnvironmentResultSchema,
  type EnvironmentConfig,
  type EnvironmentPatch,
  emptyToolInputSchema,
  envelopeSchema,
  environmentConfigSchema,
  environmentListSchema,
  environmentRefToolInputSchema,
  getRequestLogToolInputSchema,
  type IdentitySeed,
  type MintedToken,
  type MintTokenRequest,
  type MockosMcpToolName,
  mintedTokenSchema,
  mintTokenToolInputSchema,
  type Problem,
  problemSchema,
  type RequestLogPage,
  type RequestLogQuery,
  requestLogPageSchema,
  type ScenarioSpec,
  type SeedIdentitiesResult,
  scenarioSpecSchema,
  seedIdentitiesResultSchema,
  seedIdentitiesToolInputSchema,
  setCurrentEnvironmentToolInputSchema,
  setScenarioToolInputSchema,
  type WellKnownUrls,
  wellKnownUrlsSchema,
} from "@mockos/contracts";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";

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
  getWellKnownUrls(
    environmentId: string,
    context: MockosToolRequestContext
  ): Promise<WellKnownUrls>;
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

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} satisfies ToolAnnotations;

const idempotentMutationAnnotations = {
  ...mutationAnnotations,
  idempotentHint: true,
} satisfies ToolAnnotations;

const destructiveAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
} satisfies ToolAnnotations;

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

const execute = async <T>(
  context: MockosToolRequestContext,
  operation: () => Promise<T>
): Promise<CallToolResult> => {
  try {
    return successResult(await operation(), context);
  } catch (error) {
    return errorResult(normalizedProblem(error, context));
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
      title: "Create mock identity environment",
      description:
        "Creates an Entra ID or Okta environment and selects it as this session's current environment.",
      inputSchema: createEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(environmentConfigSchema),
      annotations: mutationAnnotations,
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
      title: "List mock identity environments",
      description:
        "Lists environments available to the account and identifies this session's current environment.",
      inputSchema: emptyToolInputSchema,
      outputSchema: envelopeSchema(environmentListSchema),
      annotations: readOnlyAnnotations,
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
      title: "Delete mock identity environment",
      description:
        "Permanently deletes an environment. Omitting environmentId targets the current environment.",
      inputSchema: environmentRefToolInputSchema,
      outputSchema: envelopeSchema(deleteEnvironmentResultSchema),
      annotations: destructiveAnnotations,
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
      title: "Configure mock identity environment",
      description:
        "Updates mutable environment settings. Omitting environmentId targets the current environment.",
      inputSchema: configureEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(environmentConfigSchema),
      annotations: idempotentMutationAnnotations,
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
      title: "Seed users and groups",
      description:
        "Creates users and groups in an environment. Omitting environmentId targets the current environment.",
      inputSchema: seedIdentitiesToolInputSchema,
      outputSchema: envelopeSchema(seedIdentitiesResultSchema),
      annotations: mutationAnnotations,
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
      title: "Create application registration",
      description:
        "Registers an OAuth/OIDC client in an environment. Omitting environmentId targets the current environment.",
      inputSchema: createApplicationToolInputSchema,
      outputSchema: envelopeSchema(applicationRegistrationSchema),
      annotations: mutationAnnotations,
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
      title: "Mint identity token",
      description:
        "Mints a token, optionally with a deterministic broken-token variant, in the current or named environment.",
      inputSchema: mintTokenToolInputSchema,
      outputSchema: envelopeSchema(mintedTokenSchema),
      annotations: mutationAnnotations,
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

  const setScenario = server.registerTool(
    "set_scenario",
    {
      title: "Set deterministic failure scenario",
      description:
        "Creates or replaces an injected behavior at an environment injection point.",
      inputSchema: setScenarioToolInputSchema,
      outputSchema: envelopeSchema(scenarioSpecSchema),
      annotations: idempotentMutationAnnotations,
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
      title: "Clear deterministic failure scenarios",
      description:
        "Clears one scenario by id, or all scenarios when scenarioId is omitted.",
      inputSchema: clearScenarioToolInputSchema,
      outputSchema: envelopeSchema(clearScenarioResultSchema),
      annotations: idempotentMutationAnnotations,
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
      title: "Get request log",
      description:
        "Returns a filtered page of inbound, outbound, or control traffic for an environment.",
      inputSchema: getRequestLogToolInputSchema,
      outputSchema: envelopeSchema(requestLogPageSchema),
      annotations: readOnlyAnnotations,
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
      title: "Assert captured requests",
      description:
        "Evaluates a deterministic assertion against captured environment traffic.",
      inputSchema: assertRequestsToolInputSchema,
      outputSchema: envelopeSchema(assertionResultSchema),
      annotations: readOnlyAnnotations,
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

  const getWellKnownUrls = server.registerTool(
    "get_wellknown_urls",
    {
      title: "Get provider endpoint URLs",
      description:
        "Returns issuer, discovery, OAuth/OIDC, JWKS, and SCIM URLs for an environment.",
      inputSchema: environmentRefToolInputSchema,
      outputSchema: envelopeSchema(wellKnownUrlsSchema),
      annotations: readOnlyAnnotations,
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
      title: "Select current environment",
      description:
        "Selects the environment used when other tools omit environmentId; pass null to clear the cursor.",
      inputSchema: setCurrentEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(currentEnvironmentCursorSchema),
      annotations: idempotentMutationAnnotations,
    },
    async ({ environmentId }, extra) => {
      const context = requestContext(dependencies, extra);
      return execute(context, async () => {
        await dependencies.setCurrentEnvironmentId(environmentId, context);
        return { environmentId };
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
    mint_token: mintToken,
    set_scenario: setScenario,
    clear_scenario: clearScenario,
    get_request_log: getRequestLog,
    assert_requests: assertRequests,
    get_wellknown_urls: getWellKnownUrls,
    set_current_environment: setCurrentEnvironment,
  };
};

export const MCP_IMPLEMENTATION_MILESTONE = "M2" as const;
