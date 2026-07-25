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
  catalog.future?.mockLlmApis?.status !== "unavailable" ||
  catalog.future?.mockLlmApis?.phase !== "F2" ||
  catalog.future?.mockLlmApis?.providerDataPlane !== "unavailable" ||
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
  )
) {
  failures.push(
    "F2 must expose exactly four source-implemented MCP-only definition tools while its provider data plane and deployed acceptance remain unavailable"
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
  "docs/f-series/f1-mcp-foundation.md",
  "docs/f-series/f2-llm-kernel.md",
  "docs/reference/management-tools.md",
  "docs/reference/self-hosted-http.md",
  catalogPath,
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
  "management-only",
  "put_mock_llm_server",
  "list_mock_llm_servers",
  "get_mock_llm_server",
  "delete_mock_llm_server",
  "expectedRevision",
  "canonical replay",
  "full desired definition",
  "resupply or rotate",
  "`configured: true` is not a write shape",
  "atomic compare-and-swap",
  "missing or retried delete",
  "MOCK_LLM_SERVER_REVISION_CONFLICT",
  "write-only",
  "configured: true",
  "secret-safe",
  "bounded neutral-plan validation",
  "platform Access Key as a substring",
  "JSON keys or string values",
  "schema v7",
  "older v6 bundle",
  "newer schema v7",
  "forward-recovery",
  "mockLlmApis",
  "data plane remains unavailable",
  "no reset operation",
  "no provider route",
  "no model renderer",
  "no conversation",
  "no observation",
  "no paced stream",
  "no Wrangler",
  "no deployment",
  "no Cloud pin",
  "$MOCKOS_OPENAI_MOCK_CREDENTIAL",
  "$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL",
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

if (failures.length > 0) {
  throw new Error(
    `MCP-first documentation safety check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`
  );
}

process.stdout.write(
  "PASS  MCP-first docs preserve 24 tools, five HTTP routes, source-qualified F1, management-only F2, and inert secrets\n"
);
