import { z } from "zod";
import { jsonValueSchema } from "../behavior";
import {
  applicationRegistrationSchema,
  assertionResultSchema,
  assertRequestsToolInputSchema,
  clearScenarioResultSchema,
  clearScenarioToolInputSchema,
  configureEnvironmentToolInputSchema,
  createApplicationInputSchema,
  createApplicationToolInputSchema,
  createEnvironmentToolInputSchema,
  currentEnvironmentCursorSchema,
  deleteEnvironmentResultSchema,
  deleteMockMcpServerToolInputSchema,
  emptyToolInputSchema,
  envelopeSchema,
  environmentConfigSchema,
  environmentIdSchema,
  environmentListSchema,
  environmentRefToolInputSchema,
  getMockMcpServerToolInputSchema,
  getRequestLogToolInputSchema,
  identitySeedSchema,
  lifecycleResultSchema,
  listMockMcpServersToolInputSchema,
  type MockosMcpToolName,
  mintedTokenSchema,
  mintTokenToolInputSchema,
  mockMcpDeleteServerResultSchema,
  mockMcpResetStateResultSchema,
  mockMcpServerListSchema,
  mockMcpServerViewSchema,
  problemSchema,
  provisioningRunSchema,
  putMockMcpServerToolInputSchema,
  requestLogPageSchema,
  resetMockMcpStateToolInputSchema,
  runProvisioningCycleToolInputSchema,
  scenarioSpecSchema,
  seedIdentitiesResultSchema,
  seedIdentitiesToolInputSchema,
  setCurrentEnvironmentToolInputSchema,
  setScenarioToolInputSchema,
  simulateLifecycleToolInputSchema,
  wellKnownUrlsSchema,
} from "../index";
import {
  defineMockosManagementOperation,
  type MockosHttpOperation,
  type MockosManagementOperation,
  type MockosToolAnnotations,
} from "./types";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies MockosToolAnnotations;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies MockosToolAnnotations;

const outboundMutationAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
  openWorldHint: true,
} as const satisfies MockosToolAnnotations;

const idempotentMutationAnnotations = {
  ...mutationAnnotations,
  idempotentHint: true,
} as const satisfies MockosToolAnnotations;

const destructiveAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
} as const satisfies MockosToolAnnotations;

const idempotentDestructiveAnnotations = {
  ...destructiveAnnotations,
  idempotentHint: true,
} as const satisfies MockosToolAnnotations;

const environmentPathSchema = z.object({ environmentId: environmentIdSchema }).strict();

const wellKnownQuerySchema = z.object({ issuer_base: z.string().min(1) }).strict();

const noContentSchema = z.undefined();

export const oidcDiscoveryDocumentSchema = z
  .object({
    issuer: z.url(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    jwks_uri: z.url(),
    userinfo_endpoint: z.url(),
    response_types_supported: z.array(z.string()),
    response_modes_supported: z.array(z.string()),
    subject_types_supported: z.array(z.string()),
    id_token_signing_alg_values_supported: z.array(z.string()),
    scopes_supported: z.array(z.string()),
    token_endpoint_auth_methods_supported: z.array(z.string()),
    claims_supported: z.array(z.string()),
    grant_types_supported: z.array(z.string()),
    code_challenge_methods_supported: z.array(z.string()),
  })
  .catchall(jsonValueSchema);
export type OidcDiscoveryDocument = z.infer<typeof oidcDiscoveryDocumentSchema>;

export const mockosManagementOperations = {
  create_environment: defineMockosManagementOperation({
    operationId: "create_environment",
    title: "Create mock identity environment",
    description:
      "Creates an Entra ID or Okta environment and selects it as this session's current environment.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "never",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: createEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(environmentConfigSchema),
      annotations: mutationAnnotations,
    },
  }),
  list_environments: defineMockosManagementOperation({
    operationId: "list_environments",
    title: "List mock identity environments",
    description:
      "Lists environments available to the account and identifies this session's current environment.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: emptyToolInputSchema,
      outputSchema: envelopeSchema(environmentListSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  delete_environment: defineMockosManagementOperation({
    operationId: "delete_environment",
    title: "Delete mock identity environment",
    description:
      "Permanently deletes an environment. MCP may omit environmentId to target the session cursor; HTTP always requires it.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: environmentRefToolInputSchema,
      outputSchema: envelopeSchema(deleteEnvironmentResultSchema),
      annotations: destructiveAnnotations,
    },
    http: {
      operationId: "delete_environment",
      method: "DELETE",
      path: "/environments/{environmentId}",
      successStatus: 204,
      pathSchema: environmentPathSchema,
      responseSchema: noContentSchema,
    },
  }),
  configure_environment: defineMockosManagementOperation({
    operationId: "configure_environment",
    title: "Configure mock identity environment",
    description:
      "Updates mutable environment settings through MCP or configures the complete environment document through the self-hosted HTTP control route.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: configureEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(environmentConfigSchema),
      annotations: idempotentMutationAnnotations,
    },
    http: {
      operationId: "configure_environment",
      method: "PUT",
      path: "/environments/{environmentId}",
      successStatus: 200,
      pathSchema: environmentPathSchema,
      bodySchema: environmentConfigSchema,
      responseSchema: envelopeSchema(environmentConfigSchema),
    },
  }),
  seed_identities: defineMockosManagementOperation({
    operationId: "seed_identities",
    title: "Seed users and groups",
    description:
      "Creates users and groups in an environment. MCP may use the session cursor; HTTP always requires an explicit environment.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "never",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: seedIdentitiesToolInputSchema,
      outputSchema: envelopeSchema(seedIdentitiesResultSchema),
      annotations: mutationAnnotations,
    },
    http: {
      operationId: "seed_identities",
      method: "POST",
      path: "/environments/{environmentId}/identities:seed",
      successStatus: 200,
      pathSchema: environmentPathSchema,
      bodySchema: identitySeedSchema,
      responseSchema: envelopeSchema(seedIdentitiesResultSchema),
    },
  }),
  create_application: defineMockosManagementOperation({
    operationId: "create_application",
    title: "Create application registration",
    description:
      "Registers an OAuth/OIDC client in an explicit or session-selected environment.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "never",
    requestSecrets: "redact",
    responseSecrets: "display-once",
    mcp: {
      inputSchema: createApplicationToolInputSchema,
      outputSchema: envelopeSchema(applicationRegistrationSchema),
      annotations: mutationAnnotations,
    },
    http: {
      operationId: "create_application",
      method: "POST",
      path: "/environments/{environmentId}/applications",
      successStatus: 201,
      pathSchema: environmentPathSchema,
      bodySchema: createApplicationInputSchema,
      responseSchema: envelopeSchema(applicationRegistrationSchema),
    },
  }),
  mint_token: defineMockosManagementOperation({
    operationId: "mint_token",
    title: "Mint identity token",
    description:
      "Mints a token, optionally with a deterministic broken-token variant, in the current or named environment.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "never",
    requestSecrets: "none",
    responseSecrets: "redact",
    mcp: {
      inputSchema: mintTokenToolInputSchema,
      outputSchema: envelopeSchema(mintedTokenSchema),
      annotations: mutationAnnotations,
    },
  }),
  run_provisioning_cycle: defineMockosManagementOperation({
    operationId: "run_provisioning_cycle",
    title: "Run outbound provisioning cycle",
    description:
      "Starts a deterministic Entra or Okta-shaped SCIM provisioning cycle against a validated test target.",
    requiredScopes: ["env:rw"],
    effect: "outbound",
    retry: "never",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: runProvisioningCycleToolInputSchema,
      outputSchema: envelopeSchema(provisioningRunSchema),
      annotations: outboundMutationAnnotations,
    },
  }),
  set_scenario: defineMockosManagementOperation({
    operationId: "set_scenario",
    title: "Set deterministic failure scenario",
    description:
      "Creates or replaces an injected behavior at an environment injection point.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: setScenarioToolInputSchema,
      outputSchema: envelopeSchema(scenarioSpecSchema),
      annotations: idempotentMutationAnnotations,
    },
  }),
  clear_scenario: defineMockosManagementOperation({
    operationId: "clear_scenario",
    title: "Clear deterministic failure scenarios",
    description:
      "Clears one scenario by id, or all scenarios when scenarioId is omitted.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: clearScenarioToolInputSchema,
      outputSchema: envelopeSchema(clearScenarioResultSchema),
      annotations: idempotentMutationAnnotations,
    },
  }),
  get_request_log: defineMockosManagementOperation({
    operationId: "get_request_log",
    title: "Get request log",
    description:
      "Returns a filtered page of inbound, outbound, or control traffic for an environment.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "redact",
    mcp: {
      inputSchema: getRequestLogToolInputSchema,
      outputSchema: envelopeSchema(requestLogPageSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  assert_requests: defineMockosManagementOperation({
    operationId: "assert_requests",
    title: "Assert captured requests",
    description:
      "Evaluates a deterministic assertion against captured environment traffic.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: assertRequestsToolInputSchema,
      outputSchema: envelopeSchema(assertionResultSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  simulate_lifecycle: defineMockosManagementOperation({
    operationId: "simulate_lifecycle",
    title: "Simulate provider lifecycle transition",
    description:
      "Applies an Entra or Okta user lifecycle action, including token revocation, in the current or named environment.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "never",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: simulateLifecycleToolInputSchema,
      outputSchema: envelopeSchema(lifecycleResultSchema),
      annotations: destructiveAnnotations,
    },
  }),
  get_wellknown_urls: defineMockosManagementOperation({
    operationId: "get_wellknown_urls",
    title: "Get provider endpoint URLs",
    description:
      "Returns issuer, discovery, OAuth/OIDC, JWKS, and SCIM URLs for an environment.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: environmentRefToolInputSchema,
      outputSchema: envelopeSchema(wellKnownUrlsSchema),
      annotations: readOnlyAnnotations,
    },
    http: {
      operationId: "get_environment_discovery",
      title: "Get environment OIDC discovery document",
      description:
        "Returns the provider-shaped OIDC discovery document produced for an explicit issuer base.",
      method: "GET",
      path: "/environments/{environmentId}/well-known",
      successStatus: 200,
      pathSchema: environmentPathSchema,
      querySchema: wellKnownQuerySchema,
      responseSchema: envelopeSchema(oidcDiscoveryDocumentSchema),
    },
  }),
  set_current_environment: defineMockosManagementOperation({
    operationId: "set_current_environment",
    title: "Select current environment",
    description:
      "Selects the environment used when other MCP tools omit environmentId; pass null to clear the session cursor.",
    requiredScopes: ["env:ro"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: setCurrentEnvironmentToolInputSchema,
      outputSchema: envelopeSchema(currentEnvironmentCursorSchema),
      annotations: idempotentMutationAnnotations,
    },
  }),
  put_mock_mcp_server: defineMockosManagementOperation({
    operationId: "put_mock_mcp_server",
    title: "Create or replace a mock MCP server",
    description:
      "Creates or atomically replaces one environment-local mock MCP server. Bearer Mock Credentials are accepted only in this write operation and are never returned.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: putMockMcpServerToolInputSchema,
      outputSchema: envelopeSchema(mockMcpServerViewSchema),
      annotations: idempotentMutationAnnotations,
    },
  }),
  list_mock_mcp_servers: defineMockosManagementOperation({
    operationId: "list_mock_mcp_servers",
    title: "List mock MCP servers",
    description:
      "Lists safe summaries of the mock MCP servers in the current or named environment.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: listMockMcpServersToolInputSchema,
      outputSchema: envelopeSchema(mockMcpServerListSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  get_mock_mcp_server: defineMockosManagementOperation({
    operationId: "get_mock_mcp_server",
    title: "Get mock MCP server",
    description:
      "Returns a mock MCP server definition without bearer credential material or its verifier.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: getMockMcpServerToolInputSchema,
      outputSchema: envelopeSchema(mockMcpServerViewSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  delete_mock_mcp_server: defineMockosManagementOperation({
    operationId: "delete_mock_mcp_server",
    title: "Delete mock MCP server",
    description:
      "Deletes a mock MCP server and its revision-bound sessions and application state.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: deleteMockMcpServerToolInputSchema,
      outputSchema: envelopeSchema(mockMcpDeleteServerResultSchema),
      annotations: idempotentDestructiveAnnotations,
    },
  }),
  reset_mock_mcp_state: defineMockosManagementOperation({
    operationId: "reset_mock_mcp_state",
    title: "Reset mock MCP application state",
    description:
      "Deletes sequence cursors and other application state for one mock MCP server without changing its definition.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: resetMockMcpStateToolInputSchema,
      outputSchema: envelopeSchema(mockMcpResetStateResultSchema),
      annotations: idempotentDestructiveAnnotations,
    },
  }),
} as const satisfies Record<MockosMcpToolName, MockosManagementOperation>;

export type MockosManagementOperationId = keyof typeof mockosManagementOperations;

type MockosHttpOperations<
  Operations extends Record<string, MockosManagementOperation>,
> = {
  [OperationId in keyof Operations as Operations[OperationId] extends {
    http: { operationId: infer HttpOperationId extends string };
  }
    ? HttpOperationId
    : never]: Operations[OperationId];
};

export const mockosHttpOperations = Object.freeze(
  Object.fromEntries(
    Object.values(mockosManagementOperations)
      .filter(
        (
          operation
        ): operation is (typeof mockosManagementOperations)[MockosManagementOperationId] & {
          http: MockosHttpOperation;
        } => "http" in operation
      )
      .map((operation) => [operation.http.operationId, operation])
  )
) as MockosHttpOperations<typeof mockosManagementOperations>;

export type MockosHttpOperationId = keyof typeof mockosHttpOperations;

export const mockosHttpOperationIds = Object.freeze(
  Object.keys(mockosHttpOperations) as MockosHttpOperationId[]
);

export const mockosManagementProblemSchema = problemSchema;
