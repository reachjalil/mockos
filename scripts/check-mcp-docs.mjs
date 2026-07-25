#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedTools = [
  "create_environment",
  "list_environments",
  "delete_environment",
  "configure_environment",
  "seed_identities",
  "create_application",
  "mint_token",
  "run_provisioning_cycle",
  "set_scenario",
  "clear_scenario",
  "get_request_log",
  "assert_requests",
  "simulate_lifecycle",
  "get_wellknown_urls",
  "set_current_environment",
  "put_mock_mcp_server",
  "list_mock_mcp_servers",
  "get_mock_mcp_server",
  "delete_mock_mcp_server",
  "reset_mock_mcp_state",
  "put_mock_llm_server",
  "list_mock_llm_servers",
  "get_mock_llm_server",
  "delete_mock_llm_server",
];

const expectedHttpOperations = [
  "configure_environment",
  "create_application",
  "delete_environment",
  "get_environment_discovery",
  "seed_identities",
];

const read = (path) => readFile(resolve(process.cwd(), path), "utf8");
const catalogPath = "docs/reference/management-operations.v1.json";
const catalog = JSON.parse(await read(catalogPath));
const mockLlmOpenAiProviderPath = "docs/reference/mock-llm-openai.v1.json";
const mockLlmOpenAiProvider = JSON.parse(await read(mockLlmOpenAiProviderPath));
const mockLlmAnthropicProviderPath = "docs/reference/mock-llm-anthropic.v1.json";
const mockLlmAnthropicProvider = JSON.parse(await read(mockLlmAnthropicProviderPath));
const failures = [];

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

if (catalog.managementMcp?.toolCount !== 24) {
  failures.push("the generated management catalog must report exactly 24 MCP tools");
}
const actualTools = catalog.managementMcp?.tools?.map(({ operationId }) => operationId);
if (!equal(actualTools, expectedTools)) {
  failures.push("the generated MCP tool IDs or their canonical order drifted");
}
if (catalog.selfHostedHttp?.routeCount !== 5) {
  failures.push(
    "the generated management catalog must report exactly five HTTP routes"
  );
}
const actualHttpOperations = catalog.selfHostedHttp?.operations?.map(
  ({ operationId }) => operationId
);
if (!equal(actualHttpOperations, expectedHttpOperations)) {
  failures.push("the generated HTTP operation IDs drifted");
}
if (catalog.managementMcp?.scopeEnforcement !== "metadata-only") {
  failures.push("scope metadata must remain explicitly non-enforced before F4");
}
if (
  catalog.future?.mockMcpServers?.status !== "source-qualified" ||
  catalog.future?.mockMcpServers?.phase !== "F1" ||
  catalog.future?.mockMcpServers?.testedProtocolVersion !== "2025-11-25" ||
  catalog.future?.mockMcpServers?.pathEndpoint !==
    "/e/{environmentId}/mcp-mock/{slug}" ||
  catalog.future?.mockMcpServers?.subdomainEndpoint !==
    "https://{environmentId}.{baseDomain}/mcp-mock/{slug}" ||
  catalog.future?.mockMcpServers?.deployedAcceptance !== "unqualified"
) {
  failures.push(
    "F1 mock MCP must remain source-qualified at its exact endpoints and unqualified for deployment"
  );
}
const expectedMockLlmManagementTools = [
  "put_mock_llm_server",
  "list_mock_llm_servers",
  "get_mock_llm_server",
  "delete_mock_llm_server",
];
if (
  catalog.future?.mockLlmApis?.status !== "partial-source-qualified" ||
  catalog.future?.mockLlmApis?.phase !== "F2" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.status !==
    "openai-and-anthropic-non-streaming-source-qualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.managementConfiguration !==
    "MCP-only" ||
  !equal(catalog.future?.mockLlmApis?.providerDataPlane?.manifests, [
    mockLlmOpenAiProviderPath,
    mockLlmAnthropicProviderPath,
  ]) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.responsesApi !== "unavailable" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.conversationState !== "unavailable" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions !==
    "unavailable" ||
  catalog.future?.mockLlmApis?.deployedAcceptance !== "unqualified" ||
  catalog.future?.mockLlmApis?.guide !== "docs/mock-llm.md" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.status !== "source-implemented" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.interface !== "MCP-only" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.persistence !==
    "environment-schema-v7" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.strictCredentials !==
    "write-only-provider-scoped" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.putContract?.expectedRevision !==
    "required-null-create-or-positive-replace" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.putContract?.replacement !==
    "full-definition" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.putContract
    ?.strictCredentialReplacement !== "resupply-or-rotate-every-enabled-provider" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.putContract
    ?.safeViewWriteShape !== "unsupported" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.deleteContract
    ?.expectedRevision !== "required-positive" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.deleteContract?.behavior !==
    "atomic-cas" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.deleteContract
    ?.missingOrReplay !== "deleted-false" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.deleteContract
    ?.revisionMismatch !== "typed-409" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.validation?.staticBehavior !==
    "bounded-neutral-plan" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.validation?.topLevelArguments !==
    "strict-secret-safe" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.validation?.platformAccessKey !==
    "reject-substring-in-definition-keys-and-string-values" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.schemaCompatibility?.upgrade !==
    "v6-to-v7" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.schemaCompatibility?.rollback !==
    "v6-refuses-v7" ||
  !equal(
    catalog.future?.mockLlmApis?.managementDefinitions?.toolIds,
    expectedMockLlmManagementTools
  ) ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.openAi,
    mockLlmOpenAiProvider
  ) ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.anthropic,
    mockLlmAnthropicProvider
  )
) {
  failures.push(
    "F2 must expose exactly four MCP-only definition tools plus generated bounded OpenAI and Anthropic non-streaming data-plane contracts while deployment remains unqualified"
  );
}
if (
  mockLlmOpenAiProvider?.schemaVersion !== 1 ||
  mockLlmOpenAiProvider?.generatedFrom !== "packages/llm-mock/src/openai-http.ts" ||
  mockLlmOpenAiProvider?.status !== "source-qualified" ||
  mockLlmOpenAiProvider?.compatibility !== "bounded-openai-chat-completions-subset" ||
  mockLlmOpenAiProvider?.routeBases?.pathMode !==
    "/e/{environmentId}/llm-mock/{slug}/openai/v1" ||
  mockLlmOpenAiProvider?.routeBases?.subdomainMode !==
    "https://{environmentId}.{baseDomain}/llm-mock/{slug}/openai/v1" ||
  mockLlmOpenAiProvider?.capabilityProbe !== "GET /models" ||
  mockLlmOpenAiProvider?.authentication?.scheme !== "bearer" ||
  mockLlmOpenAiProvider?.authentication?.acceptAny !==
    "valid-mock-credential-required-no-verifier-comparison" ||
  mockLlmOpenAiProvider?.authentication?.strict !==
    "current-sha256-verifier-constant-time" ||
  mockLlmOpenAiProvider?.authentication?.platformManagementAccessKey !== "rejected" ||
  mockLlmOpenAiProvider?.request?.maxBodyBytes !== 262144 ||
  mockLlmOpenAiProvider?.request?.maxDepth !== 24 ||
  mockLlmOpenAiProvider?.request?.maxNodes !== 10000 ||
  mockLlmOpenAiProvider?.request?.maxMessages !== 256 ||
  mockLlmOpenAiProvider?.request?.maxTools !== 64 ||
  mockLlmOpenAiProvider?.request?.modelId !==
    "1-256-visible-ascii-excluding-dot-segments" ||
  mockLlmOpenAiProvider?.request?.streaming !== "rejected" ||
  mockLlmOpenAiProvider?.request?.streamOptions !== "rejected" ||
  mockLlmOpenAiProvider?.request?.unknownTopLevelFields !== "rejected" ||
  mockLlmOpenAiProvider?.response?.maxBodyBytes !== 2097152 ||
  mockLlmOpenAiProvider?.response?.transportIds !== "fresh-per-invocation" ||
  mockLlmOpenAiProvider?.response?.deterministicPlanIdExposure !== "never" ||
  mockLlmOpenAiProvider?.planning?.conversationState !== "stateless" ||
  mockLlmOpenAiProvider?.planning?.turnIndex !== "prior-assistant-message-count" ||
  mockLlmOpenAiProvider?.planning?.initialDelay !== "abort-aware" ||
  mockLlmOpenAiProvider?.evidence?.localWorkerOfficialOpenAiSdk !== "qualified" ||
  mockLlmOpenAiProvider?.evidence?.cloudPin !== "unqualified" ||
  mockLlmOpenAiProvider?.evidence?.hostedDeployment !== "unqualified" ||
  !equal(
    mockLlmOpenAiProvider?.operations?.map(({ id, method, path, streaming }) => ({
      id,
      method,
      path,
      streaming,
    })),
    [
      {
        id: "create_chat_completion",
        method: "POST",
        path: "/chat/completions",
        streaming: false,
      },
      {
        id: "list_models",
        method: "GET",
        path: "/models",
        streaming: false,
      },
      {
        id: "retrieve_model",
        method: "GET",
        path: "/models/{model}",
        streaming: false,
      },
    ]
  )
) {
  failures.push(
    "the generated mock OpenAI provider manifest must preserve the exact bounded source-qualified contract"
  );
}
if (
  mockLlmAnthropicProvider?.schemaVersion !== 1 ||
  mockLlmAnthropicProvider?.generatedFrom !==
    "packages/llm-mock/src/anthropic-http.ts" ||
  mockLlmAnthropicProvider?.status !== "source-qualified" ||
  mockLlmAnthropicProvider?.compatibility !== "bounded-anthropic-messages-subset" ||
  mockLlmAnthropicProvider?.routeBases?.pathMode !==
    "/e/{environmentId}/llm-mock/{slug}/anthropic" ||
  mockLlmAnthropicProvider?.routeBases?.subdomainMode !==
    "https://{environmentId}.{baseDomain}/llm-mock/{slug}/anthropic" ||
  mockLlmAnthropicProvider?.capabilityProbe !== "GET /v1/models" ||
  mockLlmAnthropicProvider?.authentication?.scheme !== "x-api-key" ||
  mockLlmAnthropicProvider?.authentication?.acceptAny !==
    "valid-mock-credential-required-no-verifier-comparison" ||
  mockLlmAnthropicProvider?.authentication?.strict !==
    "current-sha256-verifier-constant-time" ||
  mockLlmAnthropicProvider?.authentication?.platformManagementAccessKey !==
    "rejected" ||
  mockLlmAnthropicProvider?.authentication?.alternateAuthenticationHeaders !==
    "rejected" ||
  mockLlmAnthropicProvider?.providerHeaders?.anthropicVersion !==
    "required-exact-2023-06-01" ||
  mockLlmAnthropicProvider?.providerHeaders?.betaHeaders !== "rejected" ||
  mockLlmAnthropicProvider?.request?.maxBodyBytes !== 262144 ||
  mockLlmAnthropicProvider?.request?.maxDepth !== 24 ||
  mockLlmAnthropicProvider?.request?.maxNodes !== 10000 ||
  mockLlmAnthropicProvider?.request?.maxMessages !== 256 ||
  mockLlmAnthropicProvider?.request?.maxContentBlocksPerMessage !== 256 ||
  mockLlmAnthropicProvider?.request?.maxTools !== 64 ||
  mockLlmAnthropicProvider?.request?.maxTextBytes !== 65536 ||
  mockLlmAnthropicProvider?.request?.maxToolValueBytes !== 65536 ||
  mockLlmAnthropicProvider?.request?.maxToolValueDepth !== 16 ||
  mockLlmAnthropicProvider?.request?.maxToolValueNodes !== 2000 ||
  mockLlmAnthropicProvider?.request?.maxTokens !== "integer-1-through-1000000000" ||
  mockLlmAnthropicProvider?.request?.maxTokensEffect !==
    "validated-fingerprint-input-not-response-truncation" ||
  mockLlmAnthropicProvider?.request?.turnAlternation !== "not-validated" ||
  mockLlmAnthropicProvider?.request?.toolUseResultCorrelation !== "not-validated" ||
  mockLlmAnthropicProvider?.request?.toolChoice !== "absent-or-auto" ||
  mockLlmAnthropicProvider?.request?.streaming !== "rejected" ||
  mockLlmAnthropicProvider?.request?.multimodal !== "unsupported" ||
  mockLlmAnthropicProvider?.request?.betaFeatures !== "unsupported" ||
  mockLlmAnthropicProvider?.request?.unknownTopLevelFields !== "rejected" ||
  mockLlmAnthropicProvider?.modelPagination !==
    "query-parameters-ignored-single-page" ||
  mockLlmAnthropicProvider?.response?.maxBodyBytes !== 2097152 ||
  mockLlmAnthropicProvider?.response?.requestIdHeader !== "request-id" ||
  mockLlmAnthropicProvider?.response?.messageIdPrefix !== "msg_" ||
  mockLlmAnthropicProvider?.response?.transportIds !== "fresh-per-invocation" ||
  mockLlmAnthropicProvider?.response?.deterministicPlanIdExposure !== "never" ||
  mockLlmAnthropicProvider?.planning?.conversationState !== "stateless" ||
  mockLlmAnthropicProvider?.planning?.turnIndex !== "prior-assistant-message-count" ||
  mockLlmAnthropicProvider?.planning?.initialDelay !== "abort-aware" ||
  mockLlmAnthropicProvider?.security?.requestCredentialReflection !== "rejected" ||
  mockLlmAnthropicProvider?.security?.responseCredentialReflection !== "rejected" ||
  mockLlmAnthropicProvider?.evidence?.officialSdkVersion !== "0.115.0" ||
  mockLlmAnthropicProvider?.evidence?.localWorkerOfficialAnthropicSdk !== "qualified" ||
  mockLlmAnthropicProvider?.evidence?.cloudPin !== "unqualified" ||
  mockLlmAnthropicProvider?.evidence?.hostedDeployment !== "unqualified" ||
  !equal(
    mockLlmAnthropicProvider?.operations?.map(({ id, method, path, streaming }) => ({
      id,
      method,
      path,
      streaming,
    })),
    [
      {
        id: "create_message",
        method: "POST",
        path: "/v1/messages",
        streaming: false,
      },
      {
        id: "list_models",
        method: "GET",
        path: "/v1/models",
        streaming: false,
      },
      {
        id: "retrieve_model",
        method: "GET",
        path: "/v1/models/{model}",
        streaming: false,
      },
    ]
  )
) {
  failures.push(
    "the generated mock Anthropic provider manifest must preserve the exact bounded source-qualified contract"
  );
}
const putMockLlmTool = catalog.managementMcp?.tools?.find(
  ({ operationId }) => operationId === "put_mock_llm_server"
);
if (
  putMockLlmTool?.mcp?.inputSchema?.additionalProperties !== false ||
  !putMockLlmTool.mcp.inputSchema.required?.includes("expectedRevision") ||
  !putMockLlmTool.mcp.inputSchema.required?.includes("server")
) {
  failures.push(
    "put_mock_llm_server must retain strict, mandatory top-level write arguments"
  );
}
const deleteMockLlmTool = catalog.managementMcp?.tools?.find(
  ({ operationId }) => operationId === "delete_mock_llm_server"
);
if (
  deleteMockLlmTool?.mcp?.inputSchema?.additionalProperties !== false ||
  !deleteMockLlmTool.mcp.inputSchema.required?.includes("expectedRevision") ||
  deleteMockLlmTool.mcp.inputSchema.properties?.expectedRevision?.minimum !== 1
) {
  failures.push(
    "delete_mock_llm_server must require a positive expectedRevision for atomic CAS"
  );
}

const expectedPlaceholders = {
  anthropicMockCredential: "$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL",
  managementAccessKey: "$MOCKOS_API_KEY",
  mcpEndpoint: "$MOCKOS_MCP_ENDPOINT",
  openAiMockCredential: "$MOCKOS_OPENAI_MOCK_CREDENTIAL",
  protocolMockCredential: "$MOCKOS_SYNTHETIC_CREDENTIAL",
};
if (!equal(catalog.placeholders, expectedPlaceholders)) {
  failures.push("machine-readable secret placeholders must remain inert variables");
}

const publicMcpFiles = [
  "README.md",
  "docs/README.md",
  "docs/getting-started/mcp-first.md",
  "docs/concepts/interface-model.md",
  "docs/mock-mcp.md",
  "docs/mock-llm.md",
  "docs/quickstarts/openai-sdk.md",
  "docs/quickstarts/anthropic-sdk.md",
  "docs/skill.md",
  "docs/f-series/f1-mcp-foundation.md",
  "docs/f-series/f2-llm-kernel.md",
  "docs/reference/management-tools.md",
  "docs/reference/self-hosted-http.md",
  "skills/mockos-testing/SKILL.md",
  catalogPath,
  mockLlmOpenAiProviderPath,
  mockLlmAnthropicProviderPath,
  "llms.txt",
  "llms-full.txt",
];
const contents = await Promise.all(
  publicMcpFiles.map(async (path) => [path, await read(path)])
);

const forbiddenPatterns = [
  {
    label: "a plausible plaintext mockOS account key",
    pattern: /mk_[A-Za-z0-9_-]{32,128}/,
  },
  {
    label: "a private-key PEM block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: "a JWT-shaped bearer value",
    pattern: /Bearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  {
    label: "a plausible plaintext provider API key",
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/,
  },
];

for (const [path, value] of contents) {
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(value)) failures.push(`${path} contains ${label}`);
  }
}

const quickstart = contents.find(([path]) =>
  path.endsWith("getting-started/mcp-first.md")
)?.[1];
const selfHosted = contents.find(([path]) =>
  path.endsWith("reference/self-hosted-http.md")
)?.[1];
if (
  !quickstart?.includes("$MOCKOS_API_KEY") ||
  !quickstart.includes("$MOCKOS_MCP_ENDPOINT") ||
  !selfHosted?.includes("$MOCKOS_API_KEY")
) {
  failures.push("connection examples must use inert environment-variable references");
}

const mockMcpGuide = contents.find(([path]) => path === "docs/mock-mcp.md")?.[1];
for (const required of [
  "put_mock_mcp_server",
  "list_mock_mcp_servers",
  "get_mock_mcp_server",
  "delete_mock_mcp_server",
  "reset_mock_mcp_state",
  "/e/{environmentId}/mcp-mock/{slug}",
  "{environmentId}.{baseDomain}/mcp-mock/{slug}",
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
  "notifications/initialized",
  "notifications/cancelled",
  "canonical standard base64",
  "Empty expansions are valid",
  "leftmost-minimal",
  "linear in the URI",
  "literal root",
  "Tool arguments do not match inputSchema.",
  "isError: true",
  "sticky internal work budget",
  "$ validation work budget exceeded",
  "request-local",
  "HTTP Fetch request's abort signal",
  "no in-flight",
  "one JSON object no larger than 256 KiB",
  "0 through 128 characters",
  "safe integer",
  "standard optional `_meta` member",
  "32 levels",
  "20,000 JSON nodes",
  "256 KiB of UTF-8 output",
  "template_output_limit",
  "server-revision application state",
  "checksum is public and unkeyed",
  "256 current-revision",
  "-32050",
  "Mock MCP application state capacity reached.",
  "raw JSON-RPC request bodies",
  "GET",
  "405",
  "listChanged",
  "script",
  "proxy",
]) {
  if (!mockMcpGuide?.includes(required)) {
    failures.push(`docs/mock-mcp.md must describe ${required}`);
  }
}
if (mockMcpGuide?.includes("POST /__mockos/v1") && mockMcpGuide.includes("mock MCP")) {
  failures.push(
    "docs/mock-mcp.md must not invent a self-hosted HTTP management route for F1"
  );
}

const mockLlmGuide = contents.find(([path]) => path === "docs/mock-llm.md")?.[1];
for (const required of [
  "MCP-first",
  "24 management MCP tools",
  "five routes",
  "put_mock_llm_server",
  "list_mock_llm_servers",
  "get_mock_llm_server",
  "delete_mock_llm_server",
  "expectedRevision",
  "canonical replay",
  "complete write",
  "resupply or rotate",
  "configured: true",
  "atomic compare-and-swap",
  "deleted: false",
  "MOCK_LLM_SERVER_REVISION_CONFLICT",
  "secret-safe",
  "active platform management Access Key, including as a substring",
  "JSON keys or string values",
  "schema v7",
  "older v6 bundle",
  "roll forward",
  "MCP-only",
  "OpenAI and Anthropic",
  "not a general OpenAI or Anthropic API",
  "GET /models",
  "/models/{model}",
  "POST /chat/completions",
  "GET /v1/models",
  "/v1/models/{model}",
  "POST /v1/messages",
  "anthropic-version: 2023-06-01",
  "x-api-key",
  "beta headers",
  "turn alternation",
  "tool_use`↔`tool_result",
  "`max_tokens` does not truncate",
  "accept_any",
  "visible-ASCII strings",
  "streaming_not_supported",
  "turnIndex",
  "abort-aware",
  "empty `499`",
  "fresh `x-request-id`",
  "`planId` values are never exposed",
  "2,097,152",
  "no mock-LLM reset operation",
  "LLM-specific observations or assertions",
  "Cloud pinning",
  "source-qualified locally",
]) {
  if (!mockLlmGuide?.includes(required)) {
    failures.push(`docs/mock-llm.md must describe ${required}`);
  }
}
if (mockLlmGuide?.includes("POST /__mockos/v1")) {
  failures.push(
    "docs/mock-llm.md must not invent a self-hosted HTTP management route for F2"
  );
}

const openAiQuickstart = contents.find(
  ([path]) => path === "docs/quickstarts/openai-sdk.md"
)?.[1];
for (const required of [
  "put_mock_llm_server",
  "GET /models",
  "openai@6.49.0",
  "maxRetries: 0",
  "invalid_api_key",
  "streaming_not_supported",
  "delete_mock_llm_server",
  "MOCK_LLM_SERVER_REVISION_CONFLICT",
  "source-qualified",
  "no hosted or deployed qualification",
]) {
  if (!openAiQuickstart?.includes(required)) {
    failures.push(`docs/quickstarts/openai-sdk.md must describe ${required}`);
  }
}

const anthropicQuickstart = contents.find(
  ([path]) => path === "docs/quickstarts/anthropic-sdk.md"
)?.[1];
for (const required of [
  "put_mock_llm_server",
  "GET /v1/models",
  "@anthropic-ai/sdk@0.115.0",
  "maxRetries: 0",
  "anthropic-version: 2023-06-01",
  "x-api-key",
  "authentication_error",
  "invalid_request_error",
  "beta headers",
  "stream: true",
  "delete_mock_llm_server",
  "MOCK_LLM_SERVER_REVISION_CONFLICT",
  "source-qualified",
  "no hosted or deployed qualification",
]) {
  if (!anthropicQuickstart?.includes(required)) {
    failures.push(`docs/quickstarts/anthropic-sdk.md must describe ${required}`);
  }
}

const skillGuide = contents.find(([path]) => path === "docs/skill.md")?.[1];
const testingSkill = contents.find(
  ([path]) => path === "skills/mockos-testing/SKILL.md"
)?.[1];
for (const [path, body] of [
  ["docs/skill.md", skillGuide],
  ["skills/mockos-testing/SKILL.md", testingSkill],
]) {
  for (const required of [
    "put_mock_llm_server",
    "expectedRevision: null",
    "GET /models",
    "6.49.0",
    "0.115.0",
    "maxRetries: 0",
    "streaming_not_supported",
    "anthropic-version: 2023-06-01",
    "GET /v1/models",
    "delete_mock_llm_server",
    "source",
    "deployment",
  ]) {
    if (!body?.includes(required)) {
      failures.push(`${path} must describe ${required}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `MCP-first documentation safety check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`
  );
}

process.stdout.write(
  "PASS  MCP-first docs preserve 24 tools, five management HTTP routes, source-qualified F1, bounded OpenAI/Anthropic F2, and inert secrets\n"
);
