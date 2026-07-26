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
  deleteMockLlmServerToolInputSchema,
  deleteMockMcpServerToolInputSchema,
  emptyToolInputSchema,
  envelopeSchema,
  environmentConfigSchema,
  environmentIdSchema,
  environmentListSchema,
  environmentRefToolInputSchema,
  getMockLlmServerToolInputSchema,
  getMockMcpBlueprintToolInputSchema,
  getMockMcpServerToolInputSchema,
  getRequestLogToolInputSchema,
  identitySeedSchema,
  installMockMcpBlueprintToolInputSchema,
  lifecycleResultSchema,
  listMockLlmServersToolInputSchema,
  listMockMcpBlueprintsToolInputSchema,
  listMockMcpServersToolInputSchema,
  type MockosMcpToolName,
  mintedTokenSchema,
  mintTokenToolInputSchema,
  mockLlmDeleteServerResultSchema,
  mockLlmServerListSchema,
  mockLlmServerViewSchema,
  mockMcpBlueprintCatalogSchema,
  mockMcpBlueprintInstallResultSchema,
  mockMcpBlueprintSchema,
  mockMcpDeleteServerResultSchema,
  mockMcpResetStateResultSchema,
  mockMcpServerListSchema,
  mockMcpServerViewSchema,
  problemSchema,
  provisioningRunSchema,
  putMockLlmServerToolInputSchema,
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

const idempotentOutboundMutationAnnotations = {
  ...outboundMutationAnnotations,
  idempotentHint: true,
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
    userinfo_endpoint: z.url().optional(),
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
      "Permanently deletes an environment. MCP may omit environmentId to target the session cursor; a successful cursor-targeted delete clears that cursor, so retry with the deleted environmentId explicitly. HTTP always requires environmentId.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: environmentRefToolInputSchema,
      outputSchema: envelopeSchema(deleteEnvironmentResultSchema),
      annotations: idempotentDestructiveAnnotations,
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
      "Starts or safely replays a deterministic Entra or Okta-shaped SCIM provisioning cycle against a validated test target. Supply idempotencyKey when a transport retry must return the same run.",
    requiredScopes: ["env:rw"],
    effect: "outbound",
    retry: "idempotent",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: runProvisioningCycleToolInputSchema,
      outputSchema: envelopeSchema(provisioningRunSchema),
      annotations: idempotentOutboundMutationAnnotations,
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
      "Returns a filtered page of inbound, outbound, or control traffic, including structured mock-LLM lifecycle observations without prompts, credentials, headers, or bodies.",
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
      "Evaluates deterministic count or ordered-sequence assertions against captured environment traffic and structured mock-LLM metadata.",
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
      "Creates with expectedRevision null or atomically replaces one environment-local mock MCP server at its current positive revision. Canonical replay succeeds before the revision check. A changed replacement deletes the prior revision's application state and terminates its revision-bound sessions. Replacement is a full definition write, so a bearer Mock Credential must be resupplied or rotated; credentials are accepted only in this write operation and are never returned.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: putMockMcpServerToolInputSchema,
      outputSchema: envelopeSchema(mockMcpServerViewSchema),
      annotations: idempotentDestructiveAnnotations,
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
      "Atomically deletes a mock MCP server, all of its sessions, and its application state only when expectedRevision matches the current positive revision. Success returns deleted true; a replay after success returns the typed not-found error.",
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
      "Deletes sequence cursors and other application state only when expectedRevision matches the current positive server revision, without changing its definition, revision, or sessions. An exact retry succeeds with cleared zero.",
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
  list_mock_mcp_blueprints: defineMockosManagementOperation({
    operationId: "list_mock_mcp_blueprints",
    title: "List mock MCP blueprints",
    description:
      "Lists the versioned built-in mock MCP server blueprints. Entries are documentation-derived, deterministic synthetic fixtures and do not contact provider networks or claim upstream output-wire parity.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: listMockMcpBlueprintsToolInputSchema,
      outputSchema: envelopeSchema(mockMcpBlueprintCatalogSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  get_mock_mcp_blueprint: defineMockosManagementOperation({
    operationId: "get_mock_mcp_blueprint",
    title: "Get mock MCP blueprint",
    description:
      "Returns one built-in blueprint with its source provenance, fidelity limits, and complete deterministic synthetic server definition.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: getMockMcpBlueprintToolInputSchema,
      outputSchema: envelopeSchema(mockMcpBlueprintSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  install_mock_mcp_blueprint: defineMockosManagementOperation({
    operationId: "install_mock_mcp_blueprint",
    title: "Install mock MCP blueprint",
    description:
      "Creates with expectedRevision null or compare-and-swap replaces an environment-local mock MCP server from a built-in deterministic synthetic blueprint, optionally under a caller-selected slug. Canonical replay is idempotent. A changed replacement deletes the prior revision's application state and terminates its revision-bound sessions.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: installMockMcpBlueprintToolInputSchema,
      outputSchema: envelopeSchema(mockMcpBlueprintInstallResultSchema),
      annotations: idempotentDestructiveAnnotations,
    },
  }),
  put_mock_llm_server: defineMockosManagementOperation({
    operationId: "put_mock_llm_server",
    title: "Create or replace a mock LLM server",
    description:
      "Creates or compare-and-swap replaces one environment-local mock LLM server. Strict provider Mock Credentials are accepted only in this write operation and are never returned.",
    requiredScopes: ["env:rw"],
    effect: "mutation",
    retry: "idempotent",
    requestSecrets: "redact",
    responseSecrets: "none",
    mcp: {
      inputSchema: putMockLlmServerToolInputSchema,
      outputSchema: envelopeSchema(mockLlmServerViewSchema),
      annotations: idempotentMutationAnnotations,
    },
  }),
  list_mock_llm_servers: defineMockosManagementOperation({
    operationId: "list_mock_llm_servers",
    title: "List mock LLM servers",
    description:
      "Lists safe summaries of the mock LLM server definitions in the current or named environment.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: listMockLlmServersToolInputSchema,
      outputSchema: envelopeSchema(mockLlmServerListSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  get_mock_llm_server: defineMockosManagementOperation({
    operationId: "get_mock_llm_server",
    title: "Get mock LLM server",
    description:
      "Returns a mock LLM server definition without provider Mock Credentials or their verifiers.",
    requiredScopes: ["env:ro"],
    effect: "read",
    retry: "safe",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: getMockLlmServerToolInputSchema,
      outputSchema: envelopeSchema(mockLlmServerViewSchema),
      annotations: readOnlyAnnotations,
    },
  }),
  delete_mock_llm_server: defineMockosManagementOperation({
    operationId: "delete_mock_llm_server",
    title: "Delete mock LLM server",
    description:
      "Deletes one mock LLM server definition only when expectedRevision still matches. This management-only slice has no conversation, response-plan, or evaluator-state rows.",
    requiredScopes: ["env:rw"],
    effect: "destructive",
    retry: "idempotent",
    requestSecrets: "none",
    responseSecrets: "none",
    mcp: {
      inputSchema: deleteMockLlmServerToolInputSchema,
      outputSchema: envelopeSchema(mockLlmDeleteServerResultSchema),
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
