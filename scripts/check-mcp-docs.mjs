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

if (catalog.managementMcp?.toolCount !== 20) {
  failures.push("the generated management catalog must report exactly 20 MCP tools");
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

const expectedPlaceholders = {
  managementAccessKey: "$MOCKOS_API_KEY",
  mcpEndpoint: "$MOCKOS_MCP_ENDPOINT",
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
  "docs/f-series/f1-mcp-foundation.md",
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

if (failures.length > 0) {
  throw new Error(
    `MCP-first documentation safety check failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}`
  );
}

process.stdout.write(
  "PASS  MCP-first docs preserve 20 tools, five HTTP routes, source-qualified F1, and inert secrets\n"
);
