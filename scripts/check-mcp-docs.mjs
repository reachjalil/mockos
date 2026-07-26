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
const productCapabilityIndexPath = "docs/reference/product-capabilities.v1.json";
const productCapabilityIndex = JSON.parse(await read(productCapabilityIndexPath));
const mockLlmOpenAiProviderPath = "docs/reference/mock-llm-openai.v1.json";
const mockLlmOpenAiProvider = JSON.parse(await read(mockLlmOpenAiProviderPath));
const mockLlmAnthropicProviderPath = "docs/reference/mock-llm-anthropic.v1.json";
const mockLlmAnthropicProvider = JSON.parse(await read(mockLlmAnthropicProviderPath));
const failures = [];

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const evidenceTiers = ["source", "hostedCi", "cloudPin", "deployed", "verifiedLive"];
const evidenceQualifications = ["qualified", "unqualified", "not-applicable"];
const evidenceCoverages = ["full", "partial", "none", "not-applicable"];
const evidenceRevisionRelations = ["current", "historical", "not-applicable"];
const capabilitySupports = ["supported", "partial", "unsupported"];
const capabilityRoles = [
  "management-plane",
  "companion-management",
  "provider-data-plane",
  "synthetic-agent-data-plane",
];
const interfaceKinds = [
  "mcp-streamable-http",
  "self-hosted-http",
  "openai-http",
  "anthropic-http",
  "mcp-code-mode",
];
const managementRelationships = ["primary", "companion", "mcp-only", "unavailable"];
const executableAuthorityKinds = ["contract", "registry", "runtime", "feature-flag"];

if (
  productCapabilityIndex.schemaVersion !== 1 ||
  productCapabilityIndex.provenance?.generator?.path !==
    "packages/openapi/src/index.ts" ||
  productCapabilityIndex.provenance?.generator?.export !==
    "generateMockosProductCapabilityIndex" ||
  !Array.isArray(productCapabilityIndex.provenance?.relatedArtifacts) ||
  !productCapabilityIndex.provenance.relatedArtifacts.includes(catalogPath) ||
  !productCapabilityIndex.provenance.relatedArtifacts.includes(
    mockLlmOpenAiProviderPath
  ) ||
  !productCapabilityIndex.provenance.relatedArtifacts.includes(
    mockLlmAnthropicProviderPath
  ) ||
  productCapabilityIndex.supportModel?.rule !==
    "support-describes-bounded-contract-not-hosted-qualification" ||
  !equal(productCapabilityIndex.evidenceModel?.tiers, evidenceTiers) ||
  !equal(
    productCapabilityIndex.evidenceModel?.dimensions?.qualification,
    evidenceQualifications
  ) ||
  !equal(
    productCapabilityIndex.evidenceModel?.dimensions?.coverage,
    evidenceCoverages
  ) ||
  !equal(
    productCapabilityIndex.evidenceModel?.dimensions?.revisionRelation,
    evidenceRevisionRelations
  ) ||
  productCapabilityIndex.evidenceModel?.rule !==
    "tiers-and-dimensions-are-independent-no-implicit-promotion"
) {
  failures.push(
    "the generated product capability index must identify executable provenance and keep evidence tiers and dimensions independent"
  );
}

const includedDomains = productCapabilityIndex.coverage?.includedDomains;
const unindexedDomains = productCapabilityIndex.coverage?.unindexedDomains;
const unindexedDomainIds = unindexedDomains?.map(({ id }) => id);
const includedDomainIds = includedDomains?.map(({ id }) => id);
if (
  productCapabilityIndex.coverage?.status !== "partial" ||
  productCapabilityIndex.coverage?.scope !== "f0-f2-agent-dependency-interface-slice" ||
  productCapabilityIndex.coverage?.rule !== "absence-means-unindexed-not-unsupported" ||
  !Array.isArray(includedDomainIds) ||
  includedDomainIds.length === 0 ||
  new Set(includedDomainIds).size !== includedDomainIds.length ||
  includedDomains.some(
    (domain) =>
      typeof domain?.id !== "string" ||
      domain.id.length === 0 ||
      !Array.isArray(domain.authorityRefs) ||
      domain.authorityRefs.length === 0 ||
      new Set(domain.authorityRefs).size !== domain.authorityRefs.length
  ) ||
  !Array.isArray(unindexedDomainIds) ||
  ![
    "identity-provider-data-planes",
    "scim-and-provisioning-data-planes",
    "private-cloud-product-surfaces",
  ].every((id) => unindexedDomainIds.includes(id)) ||
  new Set(unindexedDomainIds).size !== unindexedDomainIds.length ||
  unindexedDomains.some(
    (domain) =>
      typeof domain?.id !== "string" ||
      domain.id.length === 0 ||
      typeof domain?.reason !== "string" ||
      domain.reason.length === 0 ||
      !Array.isArray(domain.contextRefs) ||
      domain.contextRefs.length === 0 ||
      new Set(domain.contextRefs).size !== domain.contextRefs.length
  )
) {
  failures.push(
    "the product capability index must declare its non-exhaustive F0-F2 slice and named unindexed product domains"
  );
}

const capabilities = productCapabilityIndex.capabilities;
if (!Array.isArray(capabilities) || capabilities.length === 0) {
  failures.push(
    "the generated product capability index must contain interface entries"
  );
}

const capabilityIds = (capabilities ?? []).map(({ id }) => id);
const specificationRefs = (capabilities ?? []).map(
  ({ specificationRef }) => specificationRef
);
if (
  capabilityIds.some((id) => typeof id !== "string" || id.length === 0) ||
  new Set(capabilityIds).size !== capabilityIds.length ||
  new Set(specificationRefs).size !== specificationRefs.length
) {
  failures.push("product capability IDs and specification references must be unique");
}

const openAiCapability = (capabilities ?? []).find(
  ({ id }) => id === "mock-llm.openai"
);
const anthropicCapability = (capabilities ?? []).find(
  ({ id }) => id === "mock-llm.anthropic"
);
if (
  !openAiCapability?.provenance?.executableAuthorities?.some(
    ({ path, export: exportedName }) =>
      path === "packages/llm-mock/src/edge-stream.ts" &&
      exportedName === "prepareEdgeSseStream"
  ) ||
  !openAiCapability?.evidence?.source?.proofRefs?.includes(
    "packages/llm-mock/src/edge-stream.test.ts"
  ) ||
  !openAiCapability?.limitationRefs?.includes(
    "docs/reference/mock-llm-openai.v1.json#/response/streaming/configuredMidstreamErrors"
  )
) {
  failures.push(
    "the OpenAI capability must trace streaming policy to the edge-stream authority/test and its configured-midstream limitation"
  );
}
if (
  !anthropicCapability?.provenance?.executableAuthorities?.some(
    ({ path, export: exportedName }) =>
      path === "packages/llm-mock/src/edge-stream.ts" &&
      exportedName === "prepareEdgeSseStream"
  ) ||
  !anthropicCapability?.evidence?.source?.proofRefs?.includes(
    "packages/llm-mock/src/edge-stream.test.ts"
  ) ||
  !anthropicCapability?.limitationRefs?.includes(
    "docs/reference/mock-llm-anthropic.v1.json#/response/streaming/configuredMidstreamErrors"
  )
) {
  failures.push(
    "the Anthropic capability must trace streaming policy to the edge-stream authority/test and its configured-midstream limitation"
  );
}

for (const capability of capabilities ?? []) {
  const actualEvidenceTiers = Object.keys(capability.evidence ?? {});
  const executableAuthorities = capability.provenance?.executableAuthorities;
  const executableAuthorityKeys = (executableAuthorities ?? []).map(
    ({ path, export: exportedName }) => `${path}#${exportedName}`
  );
  if (
    typeof capability.title !== "string" ||
    capability.title.length === 0 ||
    typeof capability.scope !== "string" ||
    capability.scope.length === 0 ||
    !capabilitySupports.includes(capability.support) ||
    !capabilityRoles.includes(capability.role) ||
    !interfaceKinds.includes(capability.interface?.kind) ||
    !managementRelationships.includes(capability.interface?.management) ||
    !equal([...actualEvidenceTiers].sort(), [...evidenceTiers].sort()) ||
    !Array.isArray(executableAuthorities) ||
    executableAuthorities.length === 0 ||
    executableAuthorities.some(
      (authority) =>
        !executableAuthorityKinds.includes(authority?.kind) ||
        typeof authority?.path !== "string" ||
        authority.path.length === 0 ||
        typeof authority?.export !== "string" ||
        authority.export.length === 0
    ) ||
    new Set(executableAuthorityKeys).size !== executableAuthorityKeys.length ||
    !Array.isArray(capability.limitationRefs) ||
    capability.limitationRefs.length === 0 ||
    new Set(capability.limitationRefs).size !== capability.limitationRefs.length
  ) {
    failures.push(
      `product capability ${capability.id ?? "<missing-id>"} has an invalid bounded interface shape`
    );
  }

  for (const [tier, claim] of Object.entries(capability.evidence ?? {})) {
    const proofRefs = claim?.proofRefs;
    const contextRefs = claim?.contextRefs;
    const qualified = claim?.qualification === "qualified";
    const notApplicable = claim?.qualification === "not-applicable";
    if (
      !evidenceQualifications.includes(claim?.qualification) ||
      !evidenceCoverages.includes(claim?.coverage) ||
      !evidenceRevisionRelations.includes(claim?.revisionRelation) ||
      typeof claim?.scope !== "string" ||
      claim.scope.length === 0 ||
      !Array.isArray(proofRefs) ||
      !Array.isArray(contextRefs) ||
      new Set(proofRefs).size !== proofRefs.length ||
      new Set(contextRefs).size !== contextRefs.length ||
      (qualified && proofRefs.length === 0) ||
      (!qualified && proofRefs.length !== 0) ||
      (qualified && !["full", "partial"].includes(claim.coverage)) ||
      (qualified && !["current", "historical"].includes(claim.revisionRelation)) ||
      (claim.qualification === "unqualified" &&
        (claim.coverage !== "none" ||
          !["current", "historical"].includes(claim.revisionRelation))) ||
      (notApplicable &&
        (claim.coverage !== "not-applicable" ||
          claim.revisionRelation !== "not-applicable" ||
          contextRefs.length !== 0))
    ) {
      failures.push(
        `product capability ${capability.id} evidence tier ${tier} has inconsistent qualification, coverage, revision, or proof references`
      );
    }
  }
}

const parseRepositoryRef = (reference) => {
  const hashIndex = reference.indexOf("#");
  return {
    path: hashIndex === -1 ? reference : reference.slice(0, hashIndex),
    fragment: hashIndex === -1 ? null : reference.slice(hashIndex + 1),
  };
};

const isSafeRepositoryPath = (path) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..");

const resolveJsonPointer = (document, pointer) => {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new Error("fragment is not an absolute JSON Pointer");
  }
  let current = document;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodeURIComponent(rawToken)
      .replaceAll("~1", "/")
      .replaceAll("~0", "~");
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, token)
    ) {
      throw new Error(`missing JSON Pointer token ${JSON.stringify(token)}`);
    }
    current = current[token];
  }
  return current;
};

const markdownAnchor = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll(/[`*_~]/g, "")
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s+/g, "-");

const hasMarkdownAnchor = (document, fragment) => {
  const decoded = decodeURIComponent(fragment);
  if (
    document.includes(`<a id="${decoded}"></a>`) ||
    document.includes(`<a name="${decoded}"></a>`)
  ) {
    return true;
  }
  return document
    .split(/\r?\n/u)
    .filter((line) => /^#{1,6}\s+/u.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, ""))
    .some((heading) => markdownAnchor(heading) === decoded);
};

const hasTypeScriptExport = (document, exportedName) => {
  const escaped = exportedName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:const|let|var|function|class|type|interface|enum)\\s+${escaped}\\b`,
    "u"
  ).test(document);
};

const repositoryReferences = [];
repositoryReferences.push({
  owner: "product capability generator",
  reference: productCapabilityIndex.provenance?.generator?.path,
  fragmentRequired: false,
  exportedName: productCapabilityIndex.provenance?.generator?.export,
});
for (const reference of productCapabilityIndex.provenance?.relatedArtifacts ?? []) {
  repositoryReferences.push({
    owner: "product capability related artifact",
    reference,
    fragmentRequired: false,
  });
}
for (const domain of productCapabilityIndex.coverage?.includedDomains ?? []) {
  for (const reference of domain.authorityRefs ?? []) {
    repositoryReferences.push({
      owner: `product domain ${domain.id}`,
      reference,
      fragmentRequired: false,
    });
  }
}
for (const domain of productCapabilityIndex.coverage?.unindexedDomains ?? []) {
  for (const reference of domain.contextRefs ?? []) {
    repositoryReferences.push({
      owner: `unindexed product domain ${domain.id}`,
      reference,
      fragmentRequired: false,
    });
  }
}
for (const capability of productCapabilityIndex.capabilities ?? []) {
  repositoryReferences.push({
    owner: `${capability.id} specification`,
    reference: capability.specificationRef,
    fragmentRequired: true,
  });
  for (const authority of capability.provenance?.executableAuthorities ?? []) {
    repositoryReferences.push({
      owner: `${capability.id} executable authority`,
      reference: authority.path,
      fragmentRequired: false,
      exportedName: authority.export,
    });
  }
  for (const [kind, reference] of Object.entries(capability.documentation ?? {})) {
    if (reference !== null) {
      repositoryReferences.push({
        owner: `${capability.id} documentation.${kind}`,
        reference,
        fragmentRequired: false,
      });
    }
  }
  for (const reference of capability.limitationRefs ?? []) {
    repositoryReferences.push({
      owner: `${capability.id} limitation`,
      reference,
      fragmentRequired: true,
    });
  }
  for (const [tier, claim] of Object.entries(capability.evidence ?? {})) {
    for (const reference of [
      ...(claim?.proofRefs ?? []),
      ...(claim?.contextRefs ?? []),
    ]) {
      repositoryReferences.push({
        owner: `${capability.id} evidence.${tier}`,
        reference,
        fragmentRequired: false,
      });
    }
  }
}

const repositoryContents = new Map();
for (const {
  owner,
  reference,
  fragmentRequired,
  exportedName,
} of repositoryReferences) {
  if (typeof reference !== "string") {
    failures.push(`${owner} is missing a repository reference`);
    continue;
  }
  const { path, fragment } = parseRepositoryRef(reference);
  if (!isSafeRepositoryPath(path)) {
    failures.push(`${owner} has unsafe repository reference ${reference}`);
    continue;
  }
  let value = repositoryContents.get(path);
  if (value === undefined) {
    value = await read(path).catch(() => null);
    if (value !== null) repositoryContents.set(path, value);
  }
  if (value === null) {
    failures.push(`${owner} references missing repository path ${path}`);
    continue;
  }
  if (
    exportedName !== undefined &&
    (typeof exportedName !== "string" ||
      exportedName.length === 0 ||
      !hasTypeScriptExport(value, exportedName))
  ) {
    failures.push(
      `${owner} references missing TypeScript export ${String(exportedName)} in ${path}`
    );
  }
  if (fragmentRequired && fragment === null) {
    failures.push(`${owner} must include an explicit JSON Pointer or Markdown anchor`);
    continue;
  }
  if (fragment !== null) {
    try {
      if (path.endsWith(".json")) {
        resolveJsonPointer(JSON.parse(value), fragment);
      } else if (path.endsWith(".md")) {
        if (fragment.length === 0 || !hasMarkdownAnchor(value, fragment)) {
          throw new Error(`missing Markdown anchor ${JSON.stringify(fragment)}`);
        }
      } else {
        throw new Error(
          "fragments are supported only for JSON and Markdown references"
        );
      }
    } catch (error) {
      failures.push(
        `${owner} has invalid repository fragment ${reference}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

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
const expectedMockMcpManagementTools = [
  "put_mock_mcp_server",
  "list_mock_mcp_servers",
  "get_mock_mcp_server",
  "delete_mock_mcp_server",
  "reset_mock_mcp_state",
];
const mockMcpManagement = catalog.future?.mockMcpServers?.managementDefinitions;
if (
  mockMcpManagement?.status !== "source-implemented" ||
  mockMcpManagement?.interface !== "MCP-only" ||
  !equal(mockMcpManagement?.toolIds, expectedMockMcpManagementTools) ||
  mockMcpManagement?.persistence !== "environment-schema-v6" ||
  mockMcpManagement?.bearerCredentials !== "write-only-server-scoped" ||
  mockMcpManagement?.putContract?.expectedRevision !==
    "required-null-create-or-positive-replace" ||
  mockMcpManagement?.putContract?.replay !== "canonical-before-cas" ||
  mockMcpManagement?.putContract?.replacement !== "full-definition" ||
  mockMcpManagement?.putContract?.bearerCredentialReplacement !==
    "resupply-or-rotate" ||
  mockMcpManagement?.putContract?.safeViewWriteShape !== "unsupported" ||
  mockMcpManagement?.putContract?.revisionMismatch !== "typed-409" ||
  mockMcpManagement?.resetContract?.expectedRevision !== "required-positive" ||
  mockMcpManagement?.resetContract?.behavior !== "atomic-cas" ||
  mockMcpManagement?.resetContract?.preserves !== "definition-revision-and-sessions" ||
  mockMcpManagement?.resetContract?.exactReplay !== "cleared-zero" ||
  mockMcpManagement?.resetContract?.missing !== "typed-404" ||
  mockMcpManagement?.resetContract?.revisionMismatch !== "typed-409" ||
  mockMcpManagement?.deleteContract?.expectedRevision !== "required-positive" ||
  mockMcpManagement?.deleteContract?.behavior !== "atomic-cas" ||
  mockMcpManagement?.deleteContract?.removes !== "definition-state-and-sessions" ||
  mockMcpManagement?.deleteContract?.success !== "deleted-true" ||
  mockMcpManagement?.deleteContract?.missingOrReplay !== "typed-404" ||
  mockMcpManagement?.deleteContract?.revisionMismatch !== "typed-409" ||
  mockMcpManagement?.validation?.topLevelArguments !== "strict-secret-safe" ||
  mockMcpManagement?.validation?.definitionFailures !== "credential-free-generic" ||
  mockMcpManagement?.validation?.revision !== "positive-safe-integer"
) {
  failures.push(
    "F1 mock MCP management must retain its exact MCP-only revision-safe contract"
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
    "openai-and-anthropic-streaming-source-qualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.managementConfiguration !==
    "MCP-only" ||
  !equal(catalog.future?.mockLlmApis?.providerDataPlane?.manifests, [
    mockLlmOpenAiProviderPath,
    mockLlmAnthropicProviderPath,
  ]) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.responsesApi !== "unavailable" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.conversationState !== "unavailable" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.status !==
    "bounded-metadata-only-source-qualified" ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions
      ?.managementTools,
    ["get_request_log", "assert_requests"]
  ) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.scope !==
    "successfully-parsed-and-planned-posts-after-response-preflight" ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.dialects,
    ["openai", "anthropic"]
  ) ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions
      ?.operations,
    ["chat.completions.create", "messages.create"]
  ) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
    ?.reservation !== "pending-before-provider-delay-and-response-headers" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
    ?.reservationBudgetMilliseconds !== 50 ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
    ?.finalization !== "append-once-terminal-overlay-one-logical-row" ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
      ?.terminalOutcomes,
    ["completed", "cancelled", "deadline_exceeded", "failed"]
  ) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
    ?.replay !== "exact-idempotent-conflicting-rejected-trimmed-no-op" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.lifecycle
    ?.failurePolicy !== "fail-open-best-effort-no-provider-response-change" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.queryAndAssertionMatch !== "exact" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.sequence !== "greedy-earliest-non-overlapping-append-order" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.serverRevision !== "exact-rechecked-plan-selection-revision" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.resultShape !== "response-plan-metadata-or-configured-error-kind" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.responseId !== "preallocated-response-plan-only-omitted-for-configured-errors" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.stream !== "accepted-request-stream-intent-configured-errors-may-return-json" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.durationClock !== "monotonic-elapsed-integer-milliseconds" ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
      ?.persistedTerminal,
    ["outcome", "responseStatus", "durationMs"]
  ) ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
      ?.pendingCompatibilitySentinel,
    {
      durationMs: 0,
      meaning: "legacy-non-null-columns-not-delivery-metadata",
      responseStatus: 102,
    }
  ) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.metadata
    ?.streamFrameAndByteCounts !== "internal-test-only-not-persisted-or-queryable" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
    ?.requestHeaders !== "empty" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
    ?.requestBody !== "null" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
    ?.responseHeaders !== "empty" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
    ?.responseBody !== "null" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
    ?.collisionPolicy !==
    "skip-entire-observation-when-any-prospective-metadata-contains-request-credential" ||
  !equal(
    catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.privacy
      ?.excluded,
    [
      "prompts",
      "outputs",
      "credentials",
      "headers",
      "tool-inputs",
      "planId",
      "requestHash",
    ]
  ) ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.designed !== "qualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.implemented !== "qualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.sourceTested !== "qualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.integrationTested !== "qualified-mounted-worker" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.sdkClientQualified !==
    "provider-behavior-only-observation-management-via-mounted-mcp" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.actualNetwork !== "unqualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.hostedSmoke !== "unqualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.verifiedLive !== "unqualified" ||
  catalog.future?.mockLlmApis?.providerDataPlane?.observationsAndAssertions?.evidence
    ?.productionReady !== "unqualified" ||
  catalog.future?.mockLlmApis?.deployedAcceptance !== "unqualified" ||
  catalog.future?.mockLlmApis?.guide !== "docs/mock-llm.md" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.status !== "source-implemented" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.interface !== "MCP-only" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.persistence !==
    "environment-schema-v8" ||
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
    "v7-to-v8" ||
  catalog.future?.mockLlmApis?.managementDefinitions?.schemaCompatibility?.rollback !==
    "v7-refuses-v8" ||
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
    "F2 must expose exactly four MCP-only definition tools plus generated bounded streaming OpenAI and Anthropic data-plane contracts while deployment remains unqualified"
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
  mockLlmOpenAiProvider?.request?.streaming !== "absent-or-false-json-true-sse" ||
  mockLlmOpenAiProvider?.request?.streamOptions?.availability !== "stream-true-only" ||
  !equal(mockLlmOpenAiProvider?.request?.streamOptions?.fields, [
    "include_usage",
    "include_obfuscation",
  ]) ||
  mockLlmOpenAiProvider?.request?.streamOptions?.values !== "optional-booleans" ||
  mockLlmOpenAiProvider?.request?.streamOptions?.unknownFields !== "rejected" ||
  mockLlmOpenAiProvider?.request?.streamOptions?.includeUsageDefault !== false ||
  mockLlmOpenAiProvider?.request?.streamOptions?.includeObfuscationDefault !== true ||
  mockLlmOpenAiProvider?.request?.unknownTopLevelFields !== "rejected" ||
  mockLlmOpenAiProvider?.response?.maxBodyBytes !== 2097152 ||
  mockLlmOpenAiProvider?.response?.transportIds !== "fresh-per-invocation" ||
  mockLlmOpenAiProvider?.response?.deterministicPlanIdExposure !== "never" ||
  mockLlmOpenAiProvider?.response?.streaming?.format !== "server-sent-events" ||
  mockLlmOpenAiProvider?.response?.streaming?.order !==
    "role-payload-terminal-optional-usage-done" ||
  mockLlmOpenAiProvider?.response?.streaming?.initialDelay !== "pre-header" ||
  mockLlmOpenAiProvider?.response?.streaming?.pacedFrames !== "payload-deltas-only" ||
  mockLlmOpenAiProvider?.response?.streaming?.immediateFrames !==
    "role-terminal-usage-done" ||
  mockLlmOpenAiProvider?.response?.streaming?.maximumDuration !==
    "absolute-includes-initial-pacing-backpressure" ||
  mockLlmOpenAiProvider?.response?.streaming?.scheduleAdmissibility !==
    "initial+max(payload-count-minus-one,zero)*delay<maximum" ||
  mockLlmOpenAiProvider?.response?.streaming?.payloadFrameCount !==
    "unicode-code-point-chunks-of-text-and-canonical-tool-arguments" ||
  mockLlmOpenAiProvider?.response?.streaming?.deadlineEquality !== "rejected" ||
  mockLlmOpenAiProvider?.response?.streaming?.bodySizing !==
    "entire-precomputed-sse-utf8" ||
  mockLlmOpenAiProvider?.response?.streaming?.preflightFailure !==
    "generic-json-before-200" ||
  mockLlmOpenAiProvider?.response?.streaming?.cancellationOrDeadline !==
    "truncate-without-fabricated-success" ||
  mockLlmOpenAiProvider?.response?.streaming?.configuredMidstreamErrors !==
    "unsupported" ||
  mockLlmOpenAiProvider?.response?.streaming?.usageChunk !==
    "optional-empty-choices-before-done" ||
  mockLlmOpenAiProvider?.response?.streaming?.obfuscation !==
    "default-on-fresh-opaque-regular-delta-padding" ||
  mockLlmOpenAiProvider?.response?.streaming?.obfuscationParity !==
    "upstream-size-normalization-and-security-not-qualified" ||
  mockLlmOpenAiProvider?.planning?.conversationState !== "stateless" ||
  mockLlmOpenAiProvider?.planning?.turnIndex !== "prior-assistant-message-count" ||
  mockLlmOpenAiProvider?.planning?.definitionRevision !==
    "rechecked-before-plan-commit" ||
  mockLlmOpenAiProvider?.planning?.stateCommit !==
    "durable-object-before-edge-plan-return" ||
  mockLlmOpenAiProvider?.planning?.initialDelay !== "abort-aware-pre-header" ||
  mockLlmOpenAiProvider?.planning?.chunkCadence !== "payload-deltas-only" ||
  mockLlmOpenAiProvider?.security?.requestCredentialReflection !== "rejected" ||
  mockLlmOpenAiProvider?.security?.responseCredentialReflection !==
    "rejected-before-header" ||
  mockLlmOpenAiProvider?.evidence?.officialSdkVersion !== "6.49.0" ||
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
        streaming: true,
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
  mockLlmAnthropicProvider?.request?.streaming !== "absent-or-false-json-true-sse" ||
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
  mockLlmAnthropicProvider?.response?.streaming?.format !== "server-sent-events" ||
  mockLlmAnthropicProvider?.response?.streaming?.framing !==
    "named-event-and-json-data" ||
  mockLlmAnthropicProvider?.response?.streaming?.order !==
    "message-start-content-block-start-payload-content-block-stop-message-delta-message-stop" ||
  mockLlmAnthropicProvider?.response?.streaming?.doneSentinel !== "none" ||
  mockLlmAnthropicProvider?.response?.streaming?.initialDelay !== "pre-header" ||
  mockLlmAnthropicProvider?.response?.streaming?.pacedFrames !==
    "text-delta-and-input-json-delta-only" ||
  mockLlmAnthropicProvider?.response?.streaming?.immediateFrames !==
    "message-and-content-block-structural-events" ||
  mockLlmAnthropicProvider?.response?.streaming?.payloadEventsPerContentBlock !==
    "zero-or-more" ||
  mockLlmAnthropicProvider?.response?.streaming?.maximumDuration !==
    "absolute-includes-initial-pacing-backpressure" ||
  mockLlmAnthropicProvider?.response?.streaming?.scheduleAdmissibility !==
    "initial+max(payload-count-minus-one,zero)*delay<maximum" ||
  mockLlmAnthropicProvider?.response?.streaming?.payloadFrameCount !==
    "unicode-code-point-chunks-of-text-and-canonical-tool-input-json" ||
  mockLlmAnthropicProvider?.response?.streaming?.deadlineEquality !== "rejected" ||
  mockLlmAnthropicProvider?.response?.streaming?.bodySizing !==
    "entire-precomputed-sse-utf8" ||
  mockLlmAnthropicProvider?.response?.streaming?.preflightFailure !==
    "generic-json-before-200" ||
  mockLlmAnthropicProvider?.response?.streaming?.cancellationOrDeadline !==
    "truncate-without-fabricated-message-stop" ||
  mockLlmAnthropicProvider?.response?.streaming?.messageDeltaUsage !== "cumulative" ||
  mockLlmAnthropicProvider?.response?.streaming?.mockEmittedPing !==
    "none-clients-should-tolerate-upstream" ||
  mockLlmAnthropicProvider?.response?.streaming?.configuredError !==
    "provider-json-before-200-even-when-stream-requested" ||
  mockLlmAnthropicProvider?.response?.streaming?.configuredMidstreamErrors !==
    "unsupported" ||
  mockLlmAnthropicProvider?.planning?.conversationState !== "stateless" ||
  mockLlmAnthropicProvider?.planning?.turnIndex !== "prior-assistant-message-count" ||
  mockLlmAnthropicProvider?.planning?.definitionRevision !==
    "rechecked-before-plan-commit" ||
  mockLlmAnthropicProvider?.planning?.stateCommit !==
    "durable-object-before-edge-plan-return" ||
  mockLlmAnthropicProvider?.planning?.initialDelay !== "abort-aware-pre-header" ||
  mockLlmAnthropicProvider?.planning?.chunkCadence !== "payload-deltas-only" ||
  mockLlmAnthropicProvider?.security?.requestCredentialReflection !== "rejected" ||
  mockLlmAnthropicProvider?.security?.responseCredentialReflection !==
    "rejected-before-header" ||
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
        streaming: true,
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
const putMockMcpTool = catalog.managementMcp?.tools?.find(
  ({ operationId }) => operationId === "put_mock_mcp_server"
);
const putMockMcpExpectedRevision =
  putMockMcpTool?.mcp?.inputSchema?.properties?.expectedRevision;
if (
  putMockMcpTool?.mcp?.inputSchema?.additionalProperties !== false ||
  !putMockMcpTool.mcp.inputSchema.required?.includes("expectedRevision") ||
  !putMockMcpTool.mcp.inputSchema.required?.includes("server") ||
  !putMockMcpExpectedRevision?.anyOf?.some((candidate) => candidate.type === "null") ||
  !putMockMcpExpectedRevision?.anyOf?.some(
    (candidate) => candidate.type === "integer" && candidate.minimum === 1
  )
) {
  failures.push(
    "put_mock_mcp_server must require strict null-create-or-positive-replace intent"
  );
}
for (const operationId of ["delete_mock_mcp_server", "reset_mock_mcp_state"]) {
  const tool = catalog.managementMcp?.tools?.find(
    (candidate) => candidate.operationId === operationId
  );
  if (
    tool?.mcp?.inputSchema?.additionalProperties !== false ||
    !tool.mcp.inputSchema.required?.includes("expectedRevision") ||
    !tool.mcp.inputSchema.required?.includes("slug") ||
    tool.mcp.inputSchema.properties?.expectedRevision?.type !== "integer" ||
    tool.mcp.inputSchema.properties?.expectedRevision?.minimum !== 1
  ) {
    failures.push(
      `${operationId} must require a strict positive expectedRevision for atomic CAS`
    );
  }
}
const deleteMockMcpTool = catalog.managementMcp?.tools?.find(
  ({ operationId }) => operationId === "delete_mock_mcp_server"
);
if (
  deleteMockMcpTool?.mcp?.outputSchema?.properties?.data?.properties?.deleted?.const !==
  true
) {
  failures.push("delete_mock_mcp_server success must be the literal deleted: true");
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
  productCapabilityIndexPath,
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
  "expectedRevision: null",
  "canonical replay",
  "complete definition write",
  "resupply",
  "configured",
  "cleared: 0",
  "deleted: true",
  "MOCK_MCP_SERVER_NOT_FOUND",
  "MOCK_MCP_SERVER_REVISION_CONFLICT",
  "not an actual-network",
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
  "schema v8",
  "older v7 bundle",
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
  "stream: true",
  "include_usage",
  "include_obfuscation",
  "payload deltas",
  "absolute maximum duration",
  "strictly less than",
  "payload frame count",
  "backpressure",
  "pre-header",
  "2,097,152",
  "[DONE]",
  "message_start",
  "message_stop",
  "input_json_delta",
  "mockOS emits no `ping`",
  "Configured neutral errors always remain provider-shaped JSON",
  "turnIndex",
  "abort-aware",
  "empty `499`",
  "fresh `x-request-id`",
  "`planId` values are never exposed",
  "no mock-LLM reset operation",
  "one logical request-log row",
  "successfully parsed and planned",
  "`pending`",
  "`deadline_exceeded`",
  "`get_request_log`",
  "`assert_requests`",
  "fail-open",
  "Frame and byte counts",
  "not persisted or queryable",
  "`planId`",
  "`requestHash`",
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
  "stream: true",
  "include_usage",
  "include_obfuscation",
  "for await",
  "strictly less than",
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
  "for await",
  "message_start",
  "message_stop",
  "input_json_delta",
  "cumulative usage",
  "[DONE]",
  "no `ping`",
  "2,097,152",
  "backpressure",
  "Configured error plans",
  "Environment Durable Object",
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
    "put_mock_mcp_server",
    "reset_mock_mcp_state",
    "delete_mock_mcp_server",
    "expectedRevision: null",
    "canonical replay",
    "complete definition",
    "resupply or rotate",
    "configured: true",
    "cleared: 0",
    "deleted: true",
    "MOCK_MCP_SERVER_NOT_FOUND",
    "MOCK_MCP_SERVER_REVISION_CONFLICT",
    "not actual-network",
  ]) {
    if (!body?.includes(required)) {
      failures.push(
        `${path} must describe the F1 mutation contract phrase ${required}`
      );
    }
  }
}
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
    "stream: true",
    "include_usage",
    "include_obfuscation",
    "strictly less than",
    "anthropic-version: 2023-06-01",
    "GET /v1/models",
    "message_start",
    "message_stop",
    "input_json_delta",
    "cumulative-usage",
    "[DONE]",
    "ping",
    "2,097,152",
    "configured midstream errors",
    "Environment Durable Object",
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
  "PASS  MCP-first docs preserve 24 tools, five management HTTP routes, source-qualified F1, bounded streaming OpenAI/Anthropic F2, and inert secrets\n"
);
