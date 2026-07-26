import {
  mockosMcpToolNames,
  problemSchema,
  REQUEST_LOG_LLM_PENDING_DURATION_MS,
  REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
} from "@mockos/contracts";
import {
  type MockosHttpOperation,
  mockosHttpOperationIds,
  mockosHttpOperations,
  mockosManagementOperations,
} from "@mockos/contracts/operations";
import {
  MOCK_LLM_ANTHROPIC_MAX_CONTENT_BLOCKS,
  MOCK_LLM_ANTHROPIC_MAX_MESSAGES,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES,
  MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_DEPTH,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_NODES,
  MOCK_LLM_ANTHROPIC_MAX_TOOLS,
  MOCK_LLM_ANTHROPIC_VERSION,
  MOCK_LLM_OPENAI_MAX_MESSAGES,
  MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH,
  MOCK_LLM_OPENAI_MAX_REQUEST_NODES,
  MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_TEXT_BYTES,
  MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES,
  MOCK_LLM_OPENAI_MAX_TOOLS,
  mockLlmAnthropicProviderManifest,
  mockLlmOpenAiProviderManifest,
} from "@mockos/llm-mock";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z } from "zod";

type JsonObject = Record<string, unknown>;
type OpenApiSchemaComponents = Record<string, JsonObject>;

export type MockosHttpOperationManifestEntry = {
  operationId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/${string}`;
  successStatus: number;
  requiredScopes: readonly string[];
  retry: "safe" | "idempotent" | "never";
};

export type MockosHttpOperationManifest = Record<
  string,
  MockosHttpOperationManifestEntry
>;

export type MockosManagementDocumentationTool = {
  operationId: string;
  title: string;
  description: string;
  requiredScopes: readonly string[];
  effect: "read" | "mutation" | "destructive" | "outbound";
  retry: "safe" | "idempotent" | "never";
  secrets: {
    request: "none" | "redact" | "display-once";
    response: "none" | "redact" | "display-once";
  };
  mcp: {
    status: "implemented";
    annotations: {
      readOnlyHint: boolean;
      destructiveHint: boolean;
      idempotentHint: boolean;
      openWorldHint: boolean;
    };
    inputSchema: JsonObject;
    outputSchema: JsonObject;
  };
  http: {
    status: "implemented";
    operationId: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: `/${string}`;
    successStatus: number;
  } | null;
};

export type MockLlmOpenAiProviderDocumentation = {
  schemaVersion: 1;
  generatedFrom: "packages/llm-mock/src/openai-http.ts";
  status: "source-qualified";
  compatibility: "bounded-openai-chat-completions-subset";
  dialect: "openai";
  routeBases: {
    pathMode: "/e/{environmentId}/llm-mock/{slug}/openai/v1";
    subdomainMode: "https://{environmentId}.{baseDomain}/llm-mock/{slug}/openai/v1";
  };
  capabilityProbe: "GET /models";
  authentication: {
    scheme: "bearer";
    credential: "provider-scoped-mock-credential";
    acceptAny: "valid-mock-credential-required-no-verifier-comparison";
    strict: "current-sha256-verifier-constant-time";
    platformManagementAccessKey: "rejected";
    alternateProviderHeaders: "rejected";
  };
  operations: Array<{
    id: "create_chat_completion" | "list_models" | "retrieve_model";
    method: "GET" | "POST";
    path: "/chat/completions" | "/models" | "/models/{model}";
    streaming: boolean;
  }>;
  request: {
    mediaType: "application/json";
    encoding: "utf-8";
    maxBodyBytes: number;
    maxDepth: number;
    maxNodes: number;
    maxMessages: number;
    maxTools: number;
    maxTextBytes: number;
    maxToolValueBytes: number;
    modelId: "1-256-visible-ascii-excluding-dot-segments";
    messageRoles: readonly ["developer", "system", "user", "assistant", "tool"];
    toolChoice: "absent-or-auto";
    choiceCount: "absent-or-one";
    streaming: "absent-or-false-json-true-sse";
    streamOptions: {
      availability: "stream-true-only";
      fields: readonly ["include_usage", "include_obfuscation"];
      values: "optional-booleans";
      unknownFields: "rejected";
      includeUsageDefault: false;
      includeObfuscationDefault: true;
    };
    multimodal: "unsupported";
    unknownTopLevelFields: "rejected";
  };
  response: {
    maxBodyBytes: number;
    requestIdHeader: "x-request-id";
    completionIdPrefix: "chatcmpl-";
    transportIds: "fresh-per-invocation";
    deterministicPlanIdExposure: "never";
    streaming: {
      format: "server-sent-events";
      order: "role-payload-terminal-optional-usage-done";
      initialDelay: "pre-header";
      pacedFrames: "payload-deltas-only";
      immediateFrames: "role-terminal-usage-done";
      maximumDuration: "absolute-includes-initial-pacing-backpressure";
      scheduleAdmissibility: "initial+max(payload-count-minus-one,zero)*delay<maximum";
      payloadFrameCount: "unicode-code-point-chunks-of-text-and-canonical-tool-arguments";
      deadlineEquality: "rejected";
      bodySizing: "entire-precomputed-sse-utf8";
      preflightFailure: "generic-json-before-200";
      cancellationOrDeadline: "truncate-without-fabricated-success";
      configuredMidstreamErrors: "unsupported";
      usageChunk: "optional-empty-choices-before-done";
      obfuscation: "default-on-fresh-opaque-regular-delta-padding";
      obfuscationParity: "upstream-size-normalization-and-security-not-qualified";
    };
  };
  planning: {
    conversationState: "stateless";
    turnIndex: "prior-assistant-message-count";
    stateKey: "server-slug+dialect+model";
    definitionRevision: "rechecked-before-plan-commit";
    stateCommit: "durable-object-before-edge-plan-return";
    initialDelay: "abort-aware-pre-header";
    chunkCadence: "payload-deltas-only";
  };
  security: {
    requestCredentialReflection: "rejected";
    responseCredentialReflection: "rejected-before-header";
  };
  evidence: {
    packageTests: "qualified";
    officialSdkVersion: "6.49.0";
    localWorkerOfficialOpenAiSdk: "qualified";
    cloudPin: "unqualified";
    hostedDeployment: "unqualified";
    liveProviderParity: "unqualified";
  };
};

export type MockLlmAnthropicProviderDocumentation = {
  schemaVersion: 1;
  generatedFrom: "packages/llm-mock/src/anthropic-http.ts";
  status: "source-qualified";
  compatibility: "bounded-anthropic-messages-subset";
  dialect: "anthropic";
  routeBases: {
    pathMode: "/e/{environmentId}/llm-mock/{slug}/anthropic";
    subdomainMode: "https://{environmentId}.{baseDomain}/llm-mock/{slug}/anthropic";
  };
  capabilityProbe: "GET /v1/models";
  authentication: {
    scheme: "x-api-key";
    credential: "provider-scoped-mock-credential";
    acceptAny: "valid-mock-credential-required-no-verifier-comparison";
    strict: "current-sha256-verifier-constant-time";
    platformManagementAccessKey: "rejected";
    alternateAuthenticationHeaders: "rejected";
  };
  providerHeaders: {
    anthropicVersion: "required-exact-2023-06-01";
    betaHeaders: "rejected";
  };
  operations: Array<{
    id: "create_message" | "list_models" | "retrieve_model";
    method: "GET" | "POST";
    path: "/v1/messages" | "/v1/models" | "/v1/models/{model}";
    streaming: boolean;
  }>;
  request: {
    mediaType: "application/json";
    encoding: "utf-8";
    maxBodyBytes: number;
    maxDepth: number;
    maxNodes: number;
    maxMessages: number;
    maxContentBlocksPerMessage: number;
    maxTools: number;
    maxTextBytes: number;
    maxToolValueBytes: number;
    maxToolValueDepth: number;
    maxToolValueNodes: number;
    modelId: "1-256-visible-ascii-excluding-dot-segments";
    maxTokens: "integer-1-through-1000000000";
    maxTokensEffect: "validated-fingerprint-input-not-response-truncation";
    messageRoles: readonly ["user", "assistant"];
    messageContent: "text-or-supported-content-block-array";
    turnAlternation: "not-validated";
    toolUseResultCorrelation: "not-validated";
    system: "optional-bounded-string";
    toolDefinitions: "unique-custom-tools-with-object-input-schema";
    toolChoice: "absent-or-auto";
    streaming: "absent-or-false-json-true-sse";
    multimodal: "unsupported";
    betaFeatures: "unsupported";
    unknownTopLevelFields: "rejected";
  };
  modelPagination: "query-parameters-ignored-single-page";
  response: {
    maxBodyBytes: number;
    requestIdHeader: "request-id";
    messageIdPrefix: "msg_";
    transportIds: "fresh-per-invocation";
    deterministicPlanIdExposure: "never";
    streaming: {
      format: "server-sent-events";
      framing: "named-event-and-json-data";
      order: "message-start-content-block-start-payload-content-block-stop-message-delta-message-stop";
      doneSentinel: "none";
      initialDelay: "pre-header";
      pacedFrames: "text-delta-and-input-json-delta-only";
      immediateFrames: "message-and-content-block-structural-events";
      payloadEventsPerContentBlock: "zero-or-more";
      maximumDuration: "absolute-includes-initial-pacing-backpressure";
      scheduleAdmissibility: "initial+max(payload-count-minus-one,zero)*delay<maximum";
      payloadFrameCount: "unicode-code-point-chunks-of-text-and-canonical-tool-input-json";
      deadlineEquality: "rejected";
      bodySizing: "entire-precomputed-sse-utf8";
      preflightFailure: "generic-json-before-200";
      cancellationOrDeadline: "truncate-without-fabricated-message-stop";
      messageDeltaUsage: "cumulative";
      mockEmittedPing: "none-clients-should-tolerate-upstream";
      configuredError: "provider-json-before-200-even-when-stream-requested";
      configuredMidstreamErrors: "unsupported";
    };
  };
  planning: {
    conversationState: "stateless";
    turnIndex: "prior-assistant-message-count";
    stateKey: "server-slug+dialect+model";
    definitionRevision: "rechecked-before-plan-commit";
    stateCommit: "durable-object-before-edge-plan-return";
    initialDelay: "abort-aware-pre-header";
    chunkCadence: "payload-deltas-only";
  };
  security: {
    requestCredentialReflection: "rejected";
    responseCredentialReflection: "rejected-before-header";
  };
  evidence: {
    packageTests: "qualified";
    officialSdkVersion: "0.115.0";
    localWorkerOfficialAnthropicSdk: "qualified";
    cloudPin: "unqualified";
    hostedDeployment: "unqualified";
    liveProviderParity: "unqualified";
  };
};

export type MockosProductCapabilityId =
  | "management.mcp"
  | "management.self-hosted-http"
  | "mock-mcp.data-plane"
  | "mock-llm.openai"
  | "mock-llm.anthropic"
  | "code-mode";

export type MockosProductCapabilitySupport = "supported" | "partial" | "unsupported";

export type MockosProductCapabilityRole =
  | "management-plane"
  | "companion-management"
  | "provider-data-plane"
  | "synthetic-agent-data-plane";

export type MockosProductCapabilityInterfaceKind =
  | "mcp-streamable-http"
  | "self-hosted-http"
  | "openai-http"
  | "anthropic-http"
  | "mcp-code-mode";

export type MockosProductCapabilityManagementRelationship =
  | "primary"
  | "companion"
  | "mcp-only"
  | "unavailable";

export type MockosProductCapabilityEvidenceQualification =
  | "qualified"
  | "unqualified"
  | "not-applicable";

export type MockosProductCapabilityEvidenceCoverage =
  | "full"
  | "partial"
  | "none"
  | "not-applicable";

export type MockosProductCapabilityEvidenceRevisionRelation =
  | "current"
  | "historical"
  | "not-applicable";

export type MockosProductCapabilityEvidenceClaim =
  | {
      qualification: "qualified";
      coverage: Exclude<
        MockosProductCapabilityEvidenceCoverage,
        "none" | "not-applicable"
      >;
      revisionRelation: Exclude<
        MockosProductCapabilityEvidenceRevisionRelation,
        "not-applicable"
      >;
      scope: string;
      proofRefs: readonly [string, ...string[]];
      contextRefs: readonly string[];
    }
  | {
      qualification: "unqualified";
      coverage: "none";
      revisionRelation: Exclude<
        MockosProductCapabilityEvidenceRevisionRelation,
        "not-applicable"
      >;
      scope: string;
      proofRefs: readonly [];
      contextRefs: readonly string[];
    }
  | {
      qualification: "not-applicable";
      coverage: "not-applicable";
      revisionRelation: "not-applicable";
      scope: string;
      proofRefs: readonly [];
      contextRefs: readonly [];
    };

export type MockosProductCapabilityEvidence = {
  source: MockosProductCapabilityEvidenceClaim;
  hostedCi: MockosProductCapabilityEvidenceClaim;
  cloudPin: MockosProductCapabilityEvidenceClaim;
  deployed: MockosProductCapabilityEvidenceClaim;
  verifiedLive: MockosProductCapabilityEvidenceClaim;
};

export type MockosProductCapabilitySpecificationRef =
  | "docs/reference/management-operations.v1.json#/managementMcp"
  | "packages/openapi/openapi/mockos-management.v1.json#"
  | "docs/reference/management-operations.v1.json#/future/mockMcpServers"
  | "docs/reference/mock-llm-openai.v1.json#"
  | "docs/reference/mock-llm-anthropic.v1.json#"
  | "docs/reference/management-operations.v1.json#/future/codeMode";

export type MockosProductCapabilityExecutableAuthority = {
  kind: "contract" | "registry" | "runtime" | "feature-flag";
  path: string;
  export: string;
};

export type MockosProductCapability = {
  id: MockosProductCapabilityId;
  title: string;
  support: MockosProductCapabilitySupport;
  scope: string;
  role: MockosProductCapabilityRole;
  interface: {
    kind: MockosProductCapabilityInterfaceKind;
    management: MockosProductCapabilityManagementRelationship;
  };
  specificationRef: MockosProductCapabilitySpecificationRef;
  provenance: {
    executableAuthorities: readonly [
      MockosProductCapabilityExecutableAuthority,
      ...MockosProductCapabilityExecutableAuthority[],
    ];
  };
  evidence: MockosProductCapabilityEvidence;
  documentation: {
    guide: string;
    quickstart: string | null;
    reference: string;
    limitations: "docs/known-limitations.md";
  };
  limitationRefs: readonly string[];
};

export type MockosProductCapabilityIndex = {
  schemaVersion: 1;
  provenance: {
    generator: {
      path: "packages/openapi/src/index.ts";
      export: "generateMockosProductCapabilityIndex";
    };
    relatedArtifacts: readonly [
      "docs/reference/management-operations.v1.json",
      "docs/reference/mock-mcp-blueprints.v1.json",
      "docs/reference/mock-llm-openai.v1.json",
      "docs/reference/mock-llm-anthropic.v1.json",
    ];
  };
  coverage: {
    status: "partial";
    scope: "f0-f2-agent-dependency-interface-slice";
    rule: "absence-means-unindexed-not-unsupported";
    includedDomains: readonly [
      {
        id: "management-mcp-and-self-hosted-http";
        authorityRefs: readonly [
          "packages/contracts/src/operations/management.ts",
          "packages/mcp/src/index.ts",
          "apps/worker/src/app.ts",
        ];
      },
      {
        id: "synthetic-agent-data-planes";
        authorityRefs: readonly [
          "packages/contracts/src/mock-mcp.ts",
          "packages/contracts/src/mock-mcp-blueprint.ts",
          "packages/core/src/mock-mcp/blueprints.ts",
          "packages/mcp-mock/src/index.ts",
          "packages/llm-mock/src/openai-http.ts",
          "packages/llm-mock/src/anthropic-http.ts",
          "packages/worker-kit/src/mock-llm-runtime.ts",
          "packages/worker-kit/src/edge-router.ts",
        ];
      },
      {
        id: "future-code-mode-boundary";
        authorityRefs: readonly [
          "packages/contracts/src/features.ts",
          "packages/codemode/src/index.ts",
        ];
      },
    ];
    unindexedDomains: readonly [
      {
        id: "identity-provider-data-planes";
        reason: "provider-contract-not-yet-joined";
        contextRefs: readonly ["docs/identity/entra.md", "docs/identity/okta.md"];
      },
      {
        id: "scim-and-provisioning-data-planes";
        reason: "provider-and-outcome-contracts-not-yet-joined";
        contextRefs: readonly [
          "docs/identity/scim.md",
          "docs/quickstarts/provisioning-cycle.md",
        ];
      },
      {
        id: "private-cloud-product-surfaces";
        reason: "private-overlay-required";
        contextRefs: readonly ["docs/IMPLEMENTATION_STATUS.md"];
      },
    ];
  };
  supportModel: {
    rule: "support-describes-bounded-contract-not-hosted-qualification";
  };
  evidenceModel: {
    tiers: readonly ["source", "hostedCi", "cloudPin", "deployed", "verifiedLive"];
    dimensions: {
      qualification: readonly ["qualified", "unqualified", "not-applicable"];
      coverage: readonly ["full", "partial", "none", "not-applicable"];
      revisionRelation: readonly ["current", "historical", "not-applicable"];
    };
    rule: "tiers-and-dimensions-are-independent-no-implicit-promotion";
  };
  capabilities: MockosProductCapability[];
};

export type MockosManagementDocumentationCatalog = {
  schemaVersion: 1;
  generatedFrom: "packages/contracts/src/operations/management.ts";
  placeholders: {
    managementAccessKey: "$MOCKOS_API_KEY";
    mcpEndpoint: "$MOCKOS_MCP_ENDPOINT";
    protocolMockCredential: "$MOCKOS_SYNTHETIC_CREDENTIAL";
    openAiMockCredential: "$MOCKOS_OPENAI_MOCK_CREDENTIAL";
    anthropicMockCredential: "$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL";
  };
  managementMcp: {
    status: "implemented";
    path: "/mcp";
    transport: "Streamable HTTP";
    testedProtocolVersion: "2025-11-25";
    standaloneGet: "unsupported";
    scopeEnforcement: "metadata-only";
    toolCount: number;
    tools: MockosManagementDocumentationTool[];
  };
  selfHostedHttp: {
    status: "implemented";
    basePath: "/__mockos/v1";
    routeCount: number;
    operations: Array<{
      managementOperationId: string;
      operationId: string;
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: `/${string}`;
      successStatus: number;
    }>;
  };
  future: {
    mockMcpServers: {
      status: "source-qualified";
      phase: "F1";
      managementDefinitions: {
        status: "source-implemented";
        interface: "MCP-only";
        toolIds: readonly [
          "put_mock_mcp_server",
          "list_mock_mcp_servers",
          "get_mock_mcp_server",
          "delete_mock_mcp_server",
          "reset_mock_mcp_state",
          "list_mock_mcp_blueprints",
          "get_mock_mcp_blueprint",
          "install_mock_mcp_blueprint",
        ];
        persistence: "environment-schema-v6";
        bearerCredentials: "write-only-server-scoped";
        putContract: {
          expectedRevision: "required-null-create-or-positive-replace";
          replay: "canonical-before-cas";
          identicalDeleteRecreate: "converges-to-current-generation-without-mutation";
          replacement: "full-definition";
          changedReplacementEffect: "deletes-state-and-terminates-revision-sessions";
          bearerCredentialReplacement: "resupply-or-rotate";
          safeViewWriteShape: "unsupported";
          revisionMismatch: "typed-409-for-changed-definition";
        };
        resetContract: {
          expectedRevision: "required-positive";
          behavior: "atomic-cas";
          preserves: "definition-revision-and-sessions";
          exactReplay: "cleared-zero";
          missing: "typed-404";
          revisionMismatch: "typed-409";
        };
        deleteContract: {
          expectedRevision: "required-positive";
          behavior: "atomic-cas";
          removes: "definition-state-and-sessions";
          success: "deleted-true";
          missingOrReplay: "typed-404";
          revisionMismatch: "typed-409";
        };
        validation: {
          topLevelArguments: "strict-secret-safe";
          definitionFailures: "credential-free-generic";
          bearerCredentialReuse: "rejected-from-all-other-definition-keys-and-string-values";
          dependencyResultCredentialReflection: "fail-closed";
          revision: "positive-safe-integer";
        };
        blueprintCatalog: {
          status: "source-qualified";
          interface: "MCP-only";
          schemaVersion: 1;
          catalogScope: "built-in-secret-free-server-definition-presets";
          artifact: "docs/reference/mock-mcp-blueprints.v1.json";
          canonicalSource: "packages/core/src/mock-mcp/blueprints.ts";
          blueprintIds: readonly ["salesforce/hosted-mcp/sobject-reads"];
          provenance: "documentation-derived-at-recorded-review-date";
          fidelity: "deterministic-synthetic-no-provider-network";
          outputWireParity: "unqualified";
          portableBlueprintSystem: "not-f5-export-import-apply-or-gallery";
          installContract: {
            expectedRevision: "required-null-create-or-positive-replace";
            slug: "default-or-validated-override";
            replay: "canonical-before-cas";
            changedReplacementEffect: "deletes-state-and-terminates-revision-sessions";
            dependencyResultValidation: "exact-full-public-spec-match";
            credentials: "none";
          };
        };
      };
      testedProtocolVersion: "2025-11-25";
      pathEndpoint: "/e/{environmentId}/mcp-mock/{slug}";
      subdomainEndpoint: "https://{environmentId}.{baseDomain}/mcp-mock/{slug}";
      deployedAcceptance: "unqualified";
    };
    mockLlmApis: {
      status: "partial-source-qualified";
      phase: "F2";
      managementDefinitions: {
        status: "source-implemented";
        interface: "MCP-only";
        toolIds: readonly [
          "put_mock_llm_server",
          "list_mock_llm_servers",
          "get_mock_llm_server",
          "delete_mock_llm_server",
        ];
        persistence: "environment-baseline-schema";
        strictCredentials: "write-only-provider-scoped";
        putContract: {
          expectedRevision: "required-null-create-or-positive-replace";
          replacement: "full-definition";
          strictCredentialReplacement: "resupply-or-rotate-every-enabled-provider";
          safeViewWriteShape: "unsupported";
        };
        deleteContract: {
          expectedRevision: "required-positive";
          behavior: "atomic-cas";
          missingOrReplay: "deleted-false";
          revisionMismatch: "typed-409";
        };
        validation: {
          staticBehavior: "bounded-neutral-plan";
          topLevelArguments: "strict-secret-safe";
          platformAccessKey: "reject-substring-in-definition-keys-and-string-values";
        };
        schemaCompatibility: {
          upgrade: "v7-to-v8";
          rollback: "v7-refuses-v8";
        };
      };
      guide: "docs/mock-llm.md";
      providerDataPlane: {
        status: "openai-and-anthropic-streaming-source-qualified";
        managementConfiguration: "MCP-only";
        manifests: readonly [
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ];
        openAi: MockLlmOpenAiProviderDocumentation;
        anthropic: MockLlmAnthropicProviderDocumentation;
        responsesApi: "unavailable";
        conversationState: "unavailable";
        observationsAndAssertions: {
          status: "bounded-metadata-only-source-qualified";
          managementTools: readonly ["get_request_log", "assert_requests"];
          scope: "successfully-parsed-and-planned-posts-after-response-preflight";
          dialects: readonly ["openai", "anthropic"];
          operations: readonly ["chat.completions.create", "messages.create"];
          lifecycle: {
            reservation: "pending-before-provider-delay-and-response-headers";
            reservationBudgetMilliseconds: 50;
            finalization: "append-once-terminal-overlay-one-logical-row";
            terminalOutcomes: readonly [
              "completed",
              "cancelled",
              "deadline_exceeded",
              "failed",
            ];
            replay: "exact-idempotent-conflicting-rejected-trimmed-no-op";
            failurePolicy: "fail-open-best-effort-no-provider-response-change";
          };
          metadata: {
            queryAndAssertionMatch: "exact";
            sequence: "greedy-earliest-non-overlapping-append-order";
            serverRevision: "exact-rechecked-plan-selection-revision";
            resultShape: "response-plan-metadata-or-configured-error-kind";
            responseId: "preallocated-response-plan-only-omitted-for-configured-errors";
            stream: "accepted-request-stream-intent-configured-errors-may-return-json";
            durationClock: "monotonic-elapsed-integer-milliseconds";
            persistedTerminal: readonly ["outcome", "responseStatus", "durationMs"];
            pendingCompatibilitySentinel: {
              responseStatus: 102;
              durationMs: 0;
              meaning: "legacy-non-null-columns-not-delivery-metadata";
            };
            streamFrameAndByteCounts: "internal-test-only-not-persisted-or-queryable";
          };
          privacy: {
            requestHeaders: "empty";
            requestBody: "null";
            responseHeaders: "empty";
            responseBody: "null";
            collisionPolicy: "skip-entire-observation-when-any-prospective-metadata-contains-request-credential";
            excluded: readonly [
              "prompts",
              "outputs",
              "credentials",
              "headers",
              "tool-inputs",
              "planId",
              "requestHash",
            ];
          };
          evidence: {
            designed: "qualified";
            implemented: "qualified";
            sourceTested: "qualified";
            integrationTested: "qualified-mounted-worker";
            sdkClientQualified: "provider-behavior-only-observation-management-via-mounted-mcp";
            actualNetwork: "unqualified";
            hostedSmoke: "unqualified";
            verifiedLive: "unqualified";
            productionReady: "unqualified";
          };
        };
      };
      deployedAcceptance: "unqualified";
    };
    codeMode: {
      status: "unavailable";
      phase: "F6";
    };
  };
};

export const generateMockLlmOpenAiProviderDocumentation =
  (): MockLlmOpenAiProviderDocumentation => ({
    schemaVersion: 1,
    generatedFrom: "packages/llm-mock/src/openai-http.ts",
    status: "source-qualified",
    compatibility: "bounded-openai-chat-completions-subset",
    dialect: mockLlmOpenAiProviderManifest.dialect,
    routeBases: {
      pathMode: "/e/{environmentId}/llm-mock/{slug}/openai/v1",
      subdomainMode: "https://{environmentId}.{baseDomain}/llm-mock/{slug}/openai/v1",
    },
    capabilityProbe: "GET /models",
    authentication: {
      scheme: "bearer",
      credential: "provider-scoped-mock-credential",
      acceptAny: "valid-mock-credential-required-no-verifier-comparison",
      strict: "current-sha256-verifier-constant-time",
      platformManagementAccessKey: "rejected",
      alternateProviderHeaders: "rejected",
    },
    operations: mockLlmOpenAiProviderManifest.operations.map((operation) => ({
      ...operation,
    })),
    request: {
      mediaType: "application/json",
      encoding: "utf-8",
      maxBodyBytes: MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES,
      maxDepth: MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH,
      maxNodes: MOCK_LLM_OPENAI_MAX_REQUEST_NODES,
      maxMessages: MOCK_LLM_OPENAI_MAX_MESSAGES,
      maxTools: MOCK_LLM_OPENAI_MAX_TOOLS,
      maxTextBytes: MOCK_LLM_OPENAI_MAX_TEXT_BYTES,
      maxToolValueBytes: MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES,
      modelId: "1-256-visible-ascii-excluding-dot-segments",
      messageRoles: ["developer", "system", "user", "assistant", "tool"],
      toolChoice: "absent-or-auto",
      choiceCount: "absent-or-one",
      streaming: "absent-or-false-json-true-sse",
      streamOptions: {
        availability: "stream-true-only",
        fields: ["include_usage", "include_obfuscation"],
        values: "optional-booleans",
        unknownFields: "rejected",
        includeUsageDefault: false,
        includeObfuscationDefault: true,
      },
      multimodal: "unsupported",
      unknownTopLevelFields: "rejected",
    },
    response: {
      maxBodyBytes: MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
      requestIdHeader: "x-request-id",
      completionIdPrefix: "chatcmpl-",
      transportIds: "fresh-per-invocation",
      deterministicPlanIdExposure: "never",
      streaming: {
        format: "server-sent-events",
        order: "role-payload-terminal-optional-usage-done",
        initialDelay: "pre-header",
        pacedFrames: "payload-deltas-only",
        immediateFrames: "role-terminal-usage-done",
        maximumDuration: "absolute-includes-initial-pacing-backpressure",
        scheduleAdmissibility:
          "initial+max(payload-count-minus-one,zero)*delay<maximum",
        payloadFrameCount:
          "unicode-code-point-chunks-of-text-and-canonical-tool-arguments",
        deadlineEquality: "rejected",
        bodySizing: "entire-precomputed-sse-utf8",
        preflightFailure: "generic-json-before-200",
        cancellationOrDeadline: "truncate-without-fabricated-success",
        configuredMidstreamErrors: "unsupported",
        usageChunk: "optional-empty-choices-before-done",
        obfuscation: "default-on-fresh-opaque-regular-delta-padding",
        obfuscationParity: "upstream-size-normalization-and-security-not-qualified",
      },
    },
    planning: {
      conversationState: "stateless",
      turnIndex: "prior-assistant-message-count",
      stateKey: "server-slug+dialect+model",
      definitionRevision: "rechecked-before-plan-commit",
      stateCommit: "durable-object-before-edge-plan-return",
      initialDelay: "abort-aware-pre-header",
      chunkCadence: "payload-deltas-only",
    },
    security: {
      requestCredentialReflection: "rejected",
      responseCredentialReflection: "rejected-before-header",
    },
    evidence: {
      packageTests: "qualified",
      officialSdkVersion: "6.49.0",
      localWorkerOfficialOpenAiSdk: "qualified",
      cloudPin: "unqualified",
      hostedDeployment: "unqualified",
      liveProviderParity: "unqualified",
    },
  });

export const generateMockLlmAnthropicProviderDocumentation =
  (): MockLlmAnthropicProviderDocumentation => ({
    schemaVersion: 1,
    generatedFrom: "packages/llm-mock/src/anthropic-http.ts",
    status: "source-qualified",
    compatibility: "bounded-anthropic-messages-subset",
    dialect: mockLlmAnthropicProviderManifest.dialect,
    routeBases: {
      pathMode: "/e/{environmentId}/llm-mock/{slug}/anthropic",
      subdomainMode: "https://{environmentId}.{baseDomain}/llm-mock/{slug}/anthropic",
    },
    capabilityProbe: "GET /v1/models",
    authentication: {
      scheme: "x-api-key",
      credential: "provider-scoped-mock-credential",
      acceptAny: "valid-mock-credential-required-no-verifier-comparison",
      strict: "current-sha256-verifier-constant-time",
      platformManagementAccessKey: "rejected",
      alternateAuthenticationHeaders: "rejected",
    },
    providerHeaders: {
      anthropicVersion: `required-exact-${MOCK_LLM_ANTHROPIC_VERSION}`,
      betaHeaders: "rejected",
    },
    operations: mockLlmAnthropicProviderManifest.operations.map((operation) => ({
      ...operation,
    })),
    request: {
      mediaType: "application/json",
      encoding: "utf-8",
      maxBodyBytes: MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES,
      maxDepth: MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH,
      maxNodes: MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES,
      maxMessages: MOCK_LLM_ANTHROPIC_MAX_MESSAGES,
      maxContentBlocksPerMessage: MOCK_LLM_ANTHROPIC_MAX_CONTENT_BLOCKS,
      maxTools: MOCK_LLM_ANTHROPIC_MAX_TOOLS,
      maxTextBytes: MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES,
      maxToolValueBytes: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_BYTES,
      maxToolValueDepth: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_DEPTH,
      maxToolValueNodes: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_NODES,
      modelId: "1-256-visible-ascii-excluding-dot-segments",
      maxTokens: "integer-1-through-1000000000",
      maxTokensEffect: "validated-fingerprint-input-not-response-truncation",
      messageRoles: ["user", "assistant"],
      messageContent: "text-or-supported-content-block-array",
      turnAlternation: "not-validated",
      toolUseResultCorrelation: "not-validated",
      system: "optional-bounded-string",
      toolDefinitions: "unique-custom-tools-with-object-input-schema",
      toolChoice: "absent-or-auto",
      streaming: "absent-or-false-json-true-sse",
      multimodal: "unsupported",
      betaFeatures: "unsupported",
      unknownTopLevelFields: "rejected",
    },
    modelPagination: "query-parameters-ignored-single-page",
    response: {
      maxBodyBytes: MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES,
      requestIdHeader: "request-id",
      messageIdPrefix: "msg_",
      transportIds: "fresh-per-invocation",
      deterministicPlanIdExposure: "never",
      streaming: {
        format: "server-sent-events",
        framing: "named-event-and-json-data",
        order:
          "message-start-content-block-start-payload-content-block-stop-message-delta-message-stop",
        doneSentinel: "none",
        initialDelay: "pre-header",
        pacedFrames: "text-delta-and-input-json-delta-only",
        immediateFrames: "message-and-content-block-structural-events",
        payloadEventsPerContentBlock: "zero-or-more",
        maximumDuration: "absolute-includes-initial-pacing-backpressure",
        scheduleAdmissibility:
          "initial+max(payload-count-minus-one,zero)*delay<maximum",
        payloadFrameCount:
          "unicode-code-point-chunks-of-text-and-canonical-tool-input-json",
        deadlineEquality: "rejected",
        bodySizing: "entire-precomputed-sse-utf8",
        preflightFailure: "generic-json-before-200",
        cancellationOrDeadline: "truncate-without-fabricated-message-stop",
        messageDeltaUsage: "cumulative",
        mockEmittedPing: "none-clients-should-tolerate-upstream",
        configuredError: "provider-json-before-200-even-when-stream-requested",
        configuredMidstreamErrors: "unsupported",
      },
    },
    planning: {
      conversationState: "stateless",
      turnIndex: "prior-assistant-message-count",
      stateKey: "server-slug+dialect+model",
      definitionRevision: "rechecked-before-plan-commit",
      stateCommit: "durable-object-before-edge-plan-return",
      initialDelay: "abort-aware-pre-header",
      chunkCadence: "payload-deltas-only",
    },
    security: {
      requestCredentialReflection: "rejected",
      responseCredentialReflection: "rejected-before-header",
    },
    evidence: {
      packageTests: "qualified",
      officialSdkVersion: "0.115.0",
      localWorkerOfficialAnthropicSdk: "qualified",
      cloudPin: "unqualified",
      hostedDeployment: "unqualified",
      liveProviderParity: "unqualified",
    },
  });

const openApiComponentStem = (namespace: string): string => {
  const stem = namespace
    .split(/[^A-Za-z0-9]+/u)
    .filter((segment) => segment.length > 0)
    .map(
      (segment) =>
        `${segment.slice(0, 1).toUpperCase()}${segment.slice(1).toLowerCase()}`
    )
    .join("");
  return stem.length > 0 ? stem : "Generated";
};

const decodeJsonPointerToken = (token: string): string =>
  token.replaceAll("~1", "/").replaceAll("~0", "~");

const encodeJsonPointerToken = (token: string): string =>
  token.replaceAll("~", "~0").replaceAll("/", "~1");

const containsNestedDefinitions = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(containsNestedDefinitions);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const object = value as JsonObject;
  return (
    Object.hasOwn(object, "$defs") ||
    Object.values(object).some(containsNestedDefinitions)
  );
};

const rebaseDefinitionRefs = (
  value: unknown,
  definitionComponents: ReadonlyMap<string, string>
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => rebaseDefinitionRefs(entry, definitionComponents));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const rebased: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "$ref" &&
      typeof entry === "string" &&
      (entry === "#/$defs" || entry.startsWith("#/$defs/"))
    ) {
      if (entry === "#/$defs") {
        throw new Error("Generated OpenAPI schemas cannot reference the $defs map.");
      }
      const definitionPointer = entry.slice("#/$defs/".length);
      const separator = definitionPointer.indexOf("/");
      const encodedDefinitionName =
        separator === -1 ? definitionPointer : definitionPointer.slice(0, separator);
      const suffix = separator === -1 ? "" : definitionPointer.slice(separator);
      const definitionName = decodeJsonPointerToken(encodedDefinitionName);
      const componentName = definitionComponents.get(definitionName);
      if (!componentName) {
        throw new Error(
          `Generated OpenAPI schema references unknown definition ${JSON.stringify(definitionName)}.`
        );
      }
      rebased[key] =
        `#/components/schemas/${encodeJsonPointerToken(componentName)}${suffix}`;
    } else {
      rebased[key] = rebaseDefinitionRefs(entry, definitionComponents);
    }
  }
  return rebased;
};

const openApiJsonSchema = (
  schema: z.ZodType,
  io: "input" | "output",
  namespace: string,
  components: OpenApiSchemaComponents
): JsonObject => {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    cycles: "ref",
    reused: "inline",
    unrepresentable: "any",
  }) as JsonObject;
  delete converted.$schema;

  const rawDefinitions = converted.$defs;
  delete converted.$defs;
  if (containsNestedDefinitions(converted)) {
    throw new Error("Generated OpenAPI schemas cannot contain nested $defs.");
  }
  if (rawDefinitions === undefined) {
    return rebaseDefinitionRefs(converted, new Map()) as JsonObject;
  }
  if (
    rawDefinitions === null ||
    typeof rawDefinitions !== "object" ||
    Array.isArray(rawDefinitions)
  ) {
    throw new Error("Generated OpenAPI schema $defs must be an object.");
  }

  const definitions = rawDefinitions as JsonObject;
  if (containsNestedDefinitions(definitions)) {
    throw new Error("Generated OpenAPI definitions cannot contain nested $defs.");
  }
  const definitionComponents = new Map<string, string>();
  const componentStem = openApiComponentStem(namespace);
  const definitionEntries = Object.entries(definitions).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [index, [definitionName]] of definitionEntries.entries()) {
    const componentName = `${componentStem}Definition${index + 1}`;
    if (Object.hasOwn(components, componentName)) {
      throw new Error(
        `Generated OpenAPI component name ${JSON.stringify(componentName)} is not unique.`
      );
    }
    definitionComponents.set(definitionName, componentName);
  }
  for (const [definitionName, definition] of definitionEntries) {
    const componentName = definitionComponents.get(definitionName);
    if (!componentName) {
      throw new Error(
        `Generated OpenAPI definition ${JSON.stringify(definitionName)} has no component name.`
      );
    }
    components[componentName] = rebaseDefinitionRefs(
      definition,
      definitionComponents
    ) as JsonObject;
  }
  return rebaseDefinitionRefs(converted, definitionComponents) as JsonObject;
};

const mcpJsonSchema = (schema: z.ZodType, io: "input" | "output"): JsonObject =>
  JSON.parse(
    JSON.stringify(
      toJsonSchemaCompat(schema, {
        strictUnions: true,
        pipeStrategy: io,
      })
    )
  ) as JsonObject;

const schemaParameters = (
  schema: z.ZodType | undefined,
  location: "path" | "query",
  namespace: string,
  components: OpenApiSchemaComponents
): JsonObject[] => {
  if (!schema) return [];
  const converted = openApiJsonSchema(schema, "input", namespace, components);
  const properties =
    converted.properties &&
    typeof converted.properties === "object" &&
    !Array.isArray(converted.properties)
      ? (converted.properties as JsonObject)
      : {};
  const required = new Set(
    Array.isArray(converted.required)
      ? converted.required.filter((value): value is string => typeof value === "string")
      : []
  );
  return Object.keys(properties)
    .sort()
    .map((name) => ({
      name,
      in: location,
      required: location === "path" || required.has(name),
      schema: properties[name],
    }));
};

export const generateMockosHttpOperationManifest = (): MockosHttpOperationManifest => {
  const manifest: MockosHttpOperationManifest = {};
  for (const operationId of [...mockosHttpOperationIds].sort()) {
    const operation = mockosHttpOperations[operationId];
    manifest[operationId] = {
      operationId: operation.http.operationId,
      method: operation.http.method,
      path: operation.http.path,
      successStatus: operation.http.successStatus,
      requiredScopes: [...operation.requiredScopes],
      retry: operation.retry,
    };
  }
  return manifest;
};

export const generateMockosManagementDocumentationCatalog =
  (): MockosManagementDocumentationCatalog => {
    const tools = mockosMcpToolNames.map((operationId) => {
      const operation = mockosManagementOperations[operationId];
      const http =
        "http" in operation
          ? {
              status: "implemented" as const,
              operationId: operation.http.operationId,
              method: operation.http.method,
              path: operation.http.path,
              successStatus: operation.http.successStatus,
            }
          : null;

      return {
        operationId,
        title: operation.title,
        description: operation.description,
        requiredScopes: [...operation.requiredScopes],
        effect: operation.effect,
        retry: operation.retry,
        secrets: {
          request: operation.requestSecrets,
          response: operation.responseSecrets,
        },
        mcp: {
          status: "implemented" as const,
          annotations: { ...operation.mcp.annotations },
          inputSchema: mcpJsonSchema(operation.mcp.inputSchema, "input"),
          outputSchema: mcpJsonSchema(operation.mcp.outputSchema, "output"),
        },
        http,
      } satisfies MockosManagementDocumentationTool;
    });

    const httpOperations = tools
      .flatMap((tool) => {
        const http = tool.http;
        return http
          ? [
              {
                managementOperationId: tool.operationId,
                operationId: http.operationId,
                method: http.method,
                path: http.path,
                successStatus: http.successStatus,
              },
            ]
          : [];
      })
      .sort((left, right) => left.operationId.localeCompare(right.operationId));

    return {
      schemaVersion: 1,
      generatedFrom: "packages/contracts/src/operations/management.ts",
      placeholders: {
        managementAccessKey: "$MOCKOS_API_KEY",
        mcpEndpoint: "$MOCKOS_MCP_ENDPOINT",
        protocolMockCredential: "$MOCKOS_SYNTHETIC_CREDENTIAL",
        openAiMockCredential: "$MOCKOS_OPENAI_MOCK_CREDENTIAL",
        anthropicMockCredential: "$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL",
      },
      managementMcp: {
        status: "implemented",
        path: "/mcp",
        transport: "Streamable HTTP",
        testedProtocolVersion: "2025-11-25",
        standaloneGet: "unsupported",
        scopeEnforcement: "metadata-only",
        toolCount: tools.length,
        tools,
      },
      selfHostedHttp: {
        status: "implemented",
        basePath: "/__mockos/v1",
        routeCount: httpOperations.length,
        operations: httpOperations,
      },
      future: {
        mockMcpServers: {
          status: "source-qualified",
          phase: "F1",
          managementDefinitions: {
            status: "source-implemented",
            interface: "MCP-only",
            toolIds: [
              "put_mock_mcp_server",
              "list_mock_mcp_servers",
              "get_mock_mcp_server",
              "delete_mock_mcp_server",
              "reset_mock_mcp_state",
              "list_mock_mcp_blueprints",
              "get_mock_mcp_blueprint",
              "install_mock_mcp_blueprint",
            ],
            persistence: "environment-schema-v6",
            bearerCredentials: "write-only-server-scoped",
            putContract: {
              expectedRevision: "required-null-create-or-positive-replace",
              replay: "canonical-before-cas",
              identicalDeleteRecreate:
                "converges-to-current-generation-without-mutation",
              replacement: "full-definition",
              changedReplacementEffect:
                "deletes-state-and-terminates-revision-sessions",
              bearerCredentialReplacement: "resupply-or-rotate",
              safeViewWriteShape: "unsupported",
              revisionMismatch: "typed-409-for-changed-definition",
            },
            resetContract: {
              expectedRevision: "required-positive",
              behavior: "atomic-cas",
              preserves: "definition-revision-and-sessions",
              exactReplay: "cleared-zero",
              missing: "typed-404",
              revisionMismatch: "typed-409",
            },
            deleteContract: {
              expectedRevision: "required-positive",
              behavior: "atomic-cas",
              removes: "definition-state-and-sessions",
              success: "deleted-true",
              missingOrReplay: "typed-404",
              revisionMismatch: "typed-409",
            },
            validation: {
              topLevelArguments: "strict-secret-safe",
              definitionFailures: "credential-free-generic",
              bearerCredentialReuse:
                "rejected-from-all-other-definition-keys-and-string-values",
              dependencyResultCredentialReflection: "fail-closed",
              revision: "positive-safe-integer",
            },
            blueprintCatalog: {
              status: "source-qualified",
              interface: "MCP-only",
              schemaVersion: 1,
              catalogScope: "built-in-secret-free-server-definition-presets",
              artifact: "docs/reference/mock-mcp-blueprints.v1.json",
              canonicalSource: "packages/core/src/mock-mcp/blueprints.ts",
              blueprintIds: ["salesforce/hosted-mcp/sobject-reads"],
              provenance: "documentation-derived-at-recorded-review-date",
              fidelity: "deterministic-synthetic-no-provider-network",
              outputWireParity: "unqualified",
              portableBlueprintSystem: "not-f5-export-import-apply-or-gallery",
              installContract: {
                expectedRevision: "required-null-create-or-positive-replace",
                slug: "default-or-validated-override",
                replay: "canonical-before-cas",
                changedReplacementEffect:
                  "deletes-state-and-terminates-revision-sessions",
                dependencyResultValidation: "exact-full-public-spec-match",
                credentials: "none",
              },
            },
          },
          testedProtocolVersion: "2025-11-25",
          pathEndpoint: "/e/{environmentId}/mcp-mock/{slug}",
          subdomainEndpoint: "https://{environmentId}.{baseDomain}/mcp-mock/{slug}",
          deployedAcceptance: "unqualified",
        },
        mockLlmApis: {
          status: "partial-source-qualified",
          phase: "F2",
          managementDefinitions: {
            status: "source-implemented",
            interface: "MCP-only",
            toolIds: [
              "put_mock_llm_server",
              "list_mock_llm_servers",
              "get_mock_llm_server",
              "delete_mock_llm_server",
            ],
            persistence: "environment-baseline-schema",
            strictCredentials: "write-only-provider-scoped",
            putContract: {
              expectedRevision: "required-null-create-or-positive-replace",
              replacement: "full-definition",
              strictCredentialReplacement: "resupply-or-rotate-every-enabled-provider",
              safeViewWriteShape: "unsupported",
            },
            deleteContract: {
              expectedRevision: "required-positive",
              behavior: "atomic-cas",
              missingOrReplay: "deleted-false",
              revisionMismatch: "typed-409",
            },
            validation: {
              staticBehavior: "bounded-neutral-plan",
              topLevelArguments: "strict-secret-safe",
              platformAccessKey:
                "reject-substring-in-definition-keys-and-string-values",
            },
            schemaCompatibility: {
              upgrade: "v7-to-v8",
              rollback: "v7-refuses-v8",
            },
          },
          guide: "docs/mock-llm.md",
          providerDataPlane: {
            status: "openai-and-anthropic-streaming-source-qualified",
            managementConfiguration: "MCP-only",
            manifests: [
              "docs/reference/mock-llm-openai.v1.json",
              "docs/reference/mock-llm-anthropic.v1.json",
            ],
            openAi: generateMockLlmOpenAiProviderDocumentation(),
            anthropic: generateMockLlmAnthropicProviderDocumentation(),
            responsesApi: "unavailable",
            conversationState: "unavailable",
            observationsAndAssertions: {
              status: "bounded-metadata-only-source-qualified",
              managementTools: ["get_request_log", "assert_requests"],
              scope: "successfully-parsed-and-planned-posts-after-response-preflight",
              dialects: ["openai", "anthropic"],
              operations: ["chat.completions.create", "messages.create"],
              lifecycle: {
                reservation: "pending-before-provider-delay-and-response-headers",
                reservationBudgetMilliseconds: 50,
                finalization: "append-once-terminal-overlay-one-logical-row",
                terminalOutcomes: [
                  "completed",
                  "cancelled",
                  "deadline_exceeded",
                  "failed",
                ],
                replay: "exact-idempotent-conflicting-rejected-trimmed-no-op",
                failurePolicy: "fail-open-best-effort-no-provider-response-change",
              },
              metadata: {
                queryAndAssertionMatch: "exact",
                sequence: "greedy-earliest-non-overlapping-append-order",
                serverRevision: "exact-rechecked-plan-selection-revision",
                resultShape: "response-plan-metadata-or-configured-error-kind",
                responseId:
                  "preallocated-response-plan-only-omitted-for-configured-errors",
                stream:
                  "accepted-request-stream-intent-configured-errors-may-return-json",
                durationClock: "monotonic-elapsed-integer-milliseconds",
                persistedTerminal: ["outcome", "responseStatus", "durationMs"],
                pendingCompatibilitySentinel: {
                  responseStatus: REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
                  durationMs: REQUEST_LOG_LLM_PENDING_DURATION_MS,
                  meaning: "legacy-non-null-columns-not-delivery-metadata",
                },
                streamFrameAndByteCounts:
                  "internal-test-only-not-persisted-or-queryable",
              },
              privacy: {
                requestHeaders: "empty",
                requestBody: "null",
                responseHeaders: "empty",
                responseBody: "null",
                collisionPolicy:
                  "skip-entire-observation-when-any-prospective-metadata-contains-request-credential",
                excluded: [
                  "prompts",
                  "outputs",
                  "credentials",
                  "headers",
                  "tool-inputs",
                  "planId",
                  "requestHash",
                ],
              },
              evidence: {
                designed: "qualified",
                implemented: "qualified",
                sourceTested: "qualified",
                integrationTested: "qualified-mounted-worker",
                sdkClientQualified:
                  "provider-behavior-only-observation-management-via-mounted-mcp",
                actualNetwork: "unqualified",
                hostedSmoke: "unqualified",
                verifiedLive: "unqualified",
                productionReady: "unqualified",
              },
            },
          },
          deployedAcceptance: "unqualified",
        },
        codeMode: { status: "unavailable", phase: "F6" },
      },
    };
  };

const qualifiedEvidenceClaim = (
  coverage: "full" | "partial",
  revisionRelation: "current" | "historical",
  scope: string,
  proofRefs: readonly [string, ...string[]],
  contextRefs: readonly string[] = []
): MockosProductCapabilityEvidenceClaim => ({
  qualification: "qualified",
  coverage,
  revisionRelation,
  scope,
  proofRefs: [...proofRefs],
  contextRefs: [...contextRefs],
});

const unqualifiedClaim = (
  revisionRelation: "current" | "historical",
  scope: string,
  contextRefs: readonly string[] = []
): MockosProductCapabilityEvidenceClaim => ({
  qualification: "unqualified",
  coverage: "none",
  revisionRelation,
  scope,
  proofRefs: [],
  contextRefs: [...contextRefs],
});

const unqualifiedCurrentClaim = (scope: string): MockosProductCapabilityEvidenceClaim =>
  unqualifiedClaim("current", scope);

const qualifiedSourceClaim = (
  qualified: boolean,
  scope: string,
  proofRefs: readonly [string, ...string[]]
): MockosProductCapabilityEvidenceClaim =>
  qualified
    ? qualifiedEvidenceClaim("full", "current", scope, proofRefs)
    : unqualifiedCurrentClaim(scope);

const manifestUnqualifiedCurrentClaim = (
  _qualification: "unqualified",
  scope: string
): MockosProductCapabilityEvidenceClaim => unqualifiedCurrentClaim(scope);

const notApplicableClaim = (scope: string): MockosProductCapabilityEvidenceClaim => ({
  qualification: "not-applicable",
  coverage: "not-applicable",
  revisionRelation: "not-applicable",
  scope,
  proofRefs: [],
  contextRefs: [],
});

export const generateMockosProductCapabilityIndex =
  (): MockosProductCapabilityIndex => {
    const catalog = generateMockosManagementDocumentationCatalog();
    const openAi = catalog.future.mockLlmApis.providerDataPlane.openAi;
    const anthropic = catalog.future.mockLlmApis.providerDataPlane.anthropic;

    return {
      schemaVersion: 1,
      provenance: {
        generator: {
          path: "packages/openapi/src/index.ts",
          export: "generateMockosProductCapabilityIndex",
        },
        relatedArtifacts: [
          "docs/reference/management-operations.v1.json",
          "docs/reference/mock-mcp-blueprints.v1.json",
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ],
      },
      coverage: {
        status: "partial",
        scope: "f0-f2-agent-dependency-interface-slice",
        rule: "absence-means-unindexed-not-unsupported",
        includedDomains: [
          {
            id: "management-mcp-and-self-hosted-http",
            authorityRefs: [
              "packages/contracts/src/operations/management.ts",
              "packages/mcp/src/index.ts",
              "apps/worker/src/app.ts",
            ],
          },
          {
            id: "synthetic-agent-data-planes",
            authorityRefs: [
              "packages/contracts/src/mock-mcp.ts",
              "packages/contracts/src/mock-mcp-blueprint.ts",
              "packages/core/src/mock-mcp/blueprints.ts",
              "packages/mcp-mock/src/index.ts",
              "packages/llm-mock/src/openai-http.ts",
              "packages/llm-mock/src/anthropic-http.ts",
              "packages/worker-kit/src/mock-llm-runtime.ts",
              "packages/worker-kit/src/edge-router.ts",
            ],
          },
          {
            id: "future-code-mode-boundary",
            authorityRefs: [
              "packages/contracts/src/features.ts",
              "packages/codemode/src/index.ts",
            ],
          },
        ],
        unindexedDomains: [
          {
            id: "identity-provider-data-planes",
            reason: "provider-contract-not-yet-joined",
            contextRefs: ["docs/identity/entra.md", "docs/identity/okta.md"],
          },
          {
            id: "scim-and-provisioning-data-planes",
            reason: "provider-and-outcome-contracts-not-yet-joined",
            contextRefs: [
              "docs/identity/scim.md",
              "docs/quickstarts/provisioning-cycle.md",
            ],
          },
          {
            id: "private-cloud-product-surfaces",
            reason: "private-overlay-required",
            contextRefs: ["docs/IMPLEMENTATION_STATUS.md"],
          },
        ],
      },
      supportModel: {
        rule: "support-describes-bounded-contract-not-hosted-qualification",
      },
      evidenceModel: {
        tiers: ["source", "hostedCi", "cloudPin", "deployed", "verifiedLive"],
        dimensions: {
          qualification: ["qualified", "unqualified", "not-applicable"],
          coverage: ["full", "partial", "none", "not-applicable"],
          revisionRelation: ["current", "historical", "not-applicable"],
        },
        rule: "tiers-and-dimensions-are-independent-no-implicit-promotion",
      },
      capabilities: [
        {
          id: "management.mcp",
          title: "Management MCP",
          support:
            catalog.managementMcp.status === "implemented"
              ? "supported"
              : "unsupported",
          scope: "current-27-tool-registry",
          role: "management-plane",
          interface: {
            kind: "mcp-streamable-http",
            management: "primary",
          },
          specificationRef:
            "docs/reference/management-operations.v1.json#/managementMcp",
          provenance: {
            executableAuthorities: [
              {
                kind: "registry",
                path: "packages/contracts/src/operations/management.ts",
                export: "mockosManagementOperations",
              },
              {
                kind: "runtime",
                path: "packages/mcp/src/index.ts",
                export: "registerMockosTools",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              catalog.managementMcp.status === "implemented",
              "current-27-tool-source-registry",
              [
                "packages/contracts/src/operations/management.test.ts",
                "packages/mcp/src/index.test.ts",
                "apps/worker/test/mcp.integration.test.ts",
              ]
            ),
            hostedCi: qualifiedEvidenceClaim(
              "partial",
              "historical",
              "historical-15-tool-m5-hosted-ci-slice",
              ["docs/evidence/m5-workers-dev-smoke.md"]
            ),
            cloudPin: unqualifiedCurrentClaim(
              "current-27-tool-registry-not-cloud-qualified"
            ),
            deployed: qualifiedEvidenceClaim(
              "partial",
              "historical",
              "historical-15-tool-m5-deployed-slice",
              ["docs/evidence/m5-workers-dev-smoke.md"]
            ),
            verifiedLive: notApplicableClaim("management-interface"),
          },
          documentation: {
            guide: "docs/mcp.md",
            quickstart: "docs/getting-started/mcp-first.md",
            reference: "docs/reference/management-tools.md",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: [
            "docs/reference/management-operations.v1.json#/managementMcp/standaloneGet",
            "docs/reference/management-operations.v1.json#/managementMcp/scopeEnforcement",
          ],
        },
        {
          id: "management.self-hosted-http",
          title: "Self-hosted management HTTP",
          support:
            catalog.selfHostedHttp.status === "implemented"
              ? "supported"
              : "unsupported",
          scope: "current-five-route-companion",
          role: "companion-management",
          interface: {
            kind: "self-hosted-http",
            management: "companion",
          },
          specificationRef: "packages/openapi/openapi/mockos-management.v1.json#",
          provenance: {
            executableAuthorities: [
              {
                kind: "registry",
                path: "packages/contracts/src/operations/management.ts",
                export: "mockosHttpOperations",
              },
              {
                kind: "runtime",
                path: "apps/worker/src/app.ts",
                export: "createWorkerApp",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              catalog.selfHostedHttp.status === "implemented",
              "current-five-route-source-contract",
              [
                "packages/openapi/test/drift.test.ts",
                "apps/worker/test/oidc.integration.test.ts",
                "apps/worker/test/directory.integration.test.ts",
              ]
            ),
            hostedCi: qualifiedEvidenceClaim(
              "full",
              "historical",
              "exact-five-route-m6-ancestor",
              ["docs/evidence/m6-workers-dev-smoke.md"]
            ),
            cloudPin: unqualifiedCurrentClaim("current-public-revision-cloud-pin"),
            deployed: unqualifiedClaim(
              "historical",
              "exact-five-route-m6-bundle-not-remotely-exercised",
              ["docs/evidence/m6-workers-dev-smoke.md"]
            ),
            verifiedLive: notApplicableClaim("management-interface"),
          },
          documentation: {
            guide: "docs/reference/self-hosted-http.md",
            quickstart: "docs/quickstarts/curl.md",
            reference: "packages/openapi/openapi/mockos-management.v1.json",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: ["docs/reference/self-hosted-http.md#deliberate-limits"],
        },
        {
          id: "mock-mcp.data-plane",
          title: "Environment-hosted mock MCP",
          support:
            catalog.future.mockMcpServers.status === "source-qualified"
              ? "supported"
              : "partial",
          scope: "bounded-mcp-2025-11-25-subset",
          role: "synthetic-agent-data-plane",
          interface: {
            kind: "mcp-streamable-http",
            management: "mcp-only",
          },
          specificationRef:
            "docs/reference/management-operations.v1.json#/future/mockMcpServers",
          provenance: {
            executableAuthorities: [
              {
                kind: "contract",
                path: "packages/contracts/src/mock-mcp.ts",
                export: "MOCK_MCP_PROTOCOL_VERSION",
              },
              {
                kind: "contract",
                path: "packages/contracts/src/mock-mcp-blueprint.ts",
                export: "mockMcpBlueprintSchema",
              },
              {
                kind: "runtime",
                path: "packages/core/src/mock-mcp/blueprints.ts",
                export: "listMockMcpBlueprints",
              },
              {
                kind: "runtime",
                path: "packages/mcp-mock/src/index.ts",
                export: "createMockMcpFetchHandler",
              },
              {
                kind: "runtime",
                path: "packages/worker-kit/src/edge-router.ts",
                export: "routeEnvironmentRequest",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              catalog.future.mockMcpServers.status === "source-qualified",
              "bounded-f1-current-source-with-management-cas",
              [
                "packages/contracts/src/operations/management.test.ts",
                "packages/core/src/mock-mcp/foundation.test.ts",
                "packages/core/src/mock-mcp/blueprints.test.ts",
                "packages/mcp/src/index.test.ts",
                "packages/mcp-mock/src/sdk-conformance.test.ts",
                "packages/mcp-mock/src/repository-integration.test.ts",
                "apps/worker/test/mock-mcp.integration.test.ts",
                "apps/worker/test/mock-mcp-blueprint.integration.test.ts",
              ]
            ),
            hostedCi: unqualifiedCurrentClaim("f1-current-source"),
            cloudPin: unqualifiedCurrentClaim("f1-current-public-revision"),
            deployed: unqualifiedCurrentClaim("f1-current-source"),
            verifiedLive: notApplicableClaim("synthetic-mcp-data-plane"),
          },
          documentation: {
            guide: "docs/mock-mcp.md",
            quickstart: "docs/blueprints/salesforce-sobject-reads.md",
            reference: "docs/reference/management-tools.md",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: ["docs/mock-mcp.md#current-limitations"],
        },
        {
          id: "mock-llm.openai",
          title: "Mock OpenAI data plane",
          support: openAi.status === "source-qualified" ? "supported" : "partial",
          scope: openAi.compatibility,
          role: "provider-data-plane",
          interface: {
            kind: "openai-http",
            management: "mcp-only",
          },
          specificationRef: "docs/reference/mock-llm-openai.v1.json#",
          provenance: {
            executableAuthorities: [
              {
                kind: "contract",
                path: "packages/llm-mock/src/openai-http.ts",
                export: "mockLlmOpenAiProviderManifest",
              },
              {
                kind: "contract",
                path: "packages/contracts/src/index.ts",
                export: "requestLogEntrySchema",
              },
              {
                kind: "runtime",
                path: "packages/llm-mock/src/openai-http.ts",
                export: "createMockLlmOpenAiFetchHandler",
              },
              {
                kind: "runtime",
                path: "packages/llm-mock/src/edge-stream.ts",
                export: "prepareEdgeSseStream",
              },
              {
                kind: "runtime",
                path: "packages/worker-kit/src/mock-llm-runtime.ts",
                export: "EnvironmentMockLlmOpenAiRuntime",
              },
              {
                kind: "runtime",
                path: "packages/worker-kit/src/edge-router.ts",
                export: "routeEnvironmentRequest",
              },
              {
                kind: "runtime",
                path: "packages/core/src/log/request-log.ts",
                export: "RequestLogService",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              openAi.status === "source-qualified" &&
                openAi.evidence.packageTests === "qualified" &&
                openAi.evidence.localWorkerOfficialOpenAiSdk === "qualified",
              "bounded-openai-current-source",
              [
                "packages/llm-mock/src/openai-http.test.ts",
                "packages/llm-mock/src/edge-stream.test.ts",
                "packages/llm-mock/src/sdk-conformance.test.ts",
                "packages/core/src/scenario-log.test.ts",
                "packages/worker-kit/src/edge-router.test.ts",
                "apps/worker/test/mock-llm.integration.test.ts",
              ]
            ),
            hostedCi: unqualifiedCurrentClaim("f2-openai-current-source"),
            cloudPin: manifestUnqualifiedCurrentClaim(
              openAi.evidence.cloudPin,
              "f2-openai-current-public-revision"
            ),
            deployed: manifestUnqualifiedCurrentClaim(
              openAi.evidence.hostedDeployment,
              "f2-openai-current-source"
            ),
            verifiedLive: manifestUnqualifiedCurrentClaim(
              openAi.evidence.liveProviderParity,
              "bounded-openai-provider-parity"
            ),
          },
          documentation: {
            guide: "docs/mock-llm.md",
            quickstart: "docs/quickstarts/openai-sdk.md",
            reference: "docs/reference/mock-llm-openai.v1.json",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: [
            "docs/reference/mock-llm-openai.v1.json#/response/streaming/configuredMidstreamErrors",
            "docs/reference/mock-llm-openai.v1.json#/request/multimodal",
            "docs/mock-llm.md#observation-evidence-boundary",
          ],
        },
        {
          id: "mock-llm.anthropic",
          title: "Mock Anthropic data plane",
          support: anthropic.status === "source-qualified" ? "supported" : "partial",
          scope: anthropic.compatibility,
          role: "provider-data-plane",
          interface: {
            kind: "anthropic-http",
            management: "mcp-only",
          },
          specificationRef: "docs/reference/mock-llm-anthropic.v1.json#",
          provenance: {
            executableAuthorities: [
              {
                kind: "contract",
                path: "packages/llm-mock/src/anthropic-http.ts",
                export: "mockLlmAnthropicProviderManifest",
              },
              {
                kind: "contract",
                path: "packages/contracts/src/index.ts",
                export: "requestLogEntrySchema",
              },
              {
                kind: "runtime",
                path: "packages/llm-mock/src/anthropic-http.ts",
                export: "createMockLlmAnthropicFetchHandler",
              },
              {
                kind: "runtime",
                path: "packages/llm-mock/src/edge-stream.ts",
                export: "prepareEdgeSseStream",
              },
              {
                kind: "runtime",
                path: "packages/worker-kit/src/mock-llm-runtime.ts",
                export: "EnvironmentMockLlmAnthropicRuntime",
              },
              {
                kind: "runtime",
                path: "packages/worker-kit/src/edge-router.ts",
                export: "routeEnvironmentRequest",
              },
              {
                kind: "runtime",
                path: "packages/core/src/log/request-log.ts",
                export: "RequestLogService",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              anthropic.status === "source-qualified" &&
                anthropic.evidence.packageTests === "qualified" &&
                anthropic.evidence.localWorkerOfficialAnthropicSdk === "qualified",
              "bounded-anthropic-current-source",
              [
                "packages/llm-mock/src/anthropic-http.test.ts",
                "packages/llm-mock/src/anthropic-security.test.ts",
                "packages/llm-mock/src/edge-stream.test.ts",
                "packages/llm-mock/src/sdk-conformance.test.ts",
                "packages/core/src/scenario-log.test.ts",
                "packages/worker-kit/src/edge-router.test.ts",
                "apps/worker/test/mock-llm-anthropic.integration.test.ts",
              ]
            ),
            hostedCi: unqualifiedCurrentClaim("f2-anthropic-current-source"),
            cloudPin: manifestUnqualifiedCurrentClaim(
              anthropic.evidence.cloudPin,
              "f2-anthropic-current-public-revision"
            ),
            deployed: manifestUnqualifiedCurrentClaim(
              anthropic.evidence.hostedDeployment,
              "f2-anthropic-current-source"
            ),
            verifiedLive: manifestUnqualifiedCurrentClaim(
              anthropic.evidence.liveProviderParity,
              "bounded-anthropic-provider-parity"
            ),
          },
          documentation: {
            guide: "docs/mock-llm.md",
            quickstart: "docs/quickstarts/anthropic-sdk.md",
            reference: "docs/reference/mock-llm-anthropic.v1.json",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: [
            "docs/reference/mock-llm-anthropic.v1.json#/response/streaming/configuredMidstreamErrors",
            "docs/reference/mock-llm-anthropic.v1.json#/request/multimodal",
            "docs/reference/mock-llm-anthropic.v1.json#/request/betaFeatures",
            "docs/mock-llm.md#observation-evidence-boundary",
          ],
        },
        {
          id: "code-mode",
          title: "MCP Code Mode",
          support:
            catalog.future.codeMode.status === "unavailable"
              ? "unsupported"
              : "partial",
          scope: "disabled-fail-closed-boundary",
          role: "management-plane",
          interface: {
            kind: "mcp-code-mode",
            management: "unavailable",
          },
          specificationRef:
            "docs/reference/management-operations.v1.json#/future/codeMode",
          provenance: {
            executableAuthorities: [
              {
                kind: "feature-flag",
                path: "packages/contracts/src/features.ts",
                export: "DEFAULT_F_SERIES_FEATURE_FLAGS",
              },
              {
                kind: "runtime",
                path: "packages/codemode/src/index.ts",
                export: "requireMockosCodeModeEnabled",
              },
            ],
          },
          evidence: {
            source: qualifiedSourceClaim(
              catalog.future.codeMode.status === "unavailable",
              "disabled-fail-closed-boundary",
              ["packages/codemode/test/disabled.test.ts"]
            ),
            hostedCi: unqualifiedCurrentClaim("disabled-boundary-hosted-ci"),
            cloudPin: unqualifiedCurrentClaim("disabled-boundary-cloud-pin"),
            deployed: unqualifiedCurrentClaim("disabled-boundary-deployment"),
            verifiedLive: notApplicableClaim("management-interface"),
          },
          documentation: {
            guide: "packages/codemode/README.md",
            quickstart: null,
            reference: "docs/f-series/f0-foundation.md",
            limitations: "docs/known-limitations.md",
          },
          limitationRefs: [
            "docs/reference/management-operations.v1.json#/future/codeMode/status",
          ],
        },
      ],
    };
  };

export const generateMockosManagementOpenApi = (): JsonObject => {
  const paths: Record<string, Record<string, JsonObject>> = {};
  const schemaComponents: OpenApiSchemaComponents = {};

  for (const operationId of [...mockosHttpOperationIds].sort()) {
    const operation = mockosHttpOperations[operationId];
    const http = operation.http as MockosHttpOperation;
    const parameters = [
      ...schemaParameters(
        http.pathSchema,
        "path",
        `${http.operationId}_path`,
        schemaComponents
      ),
      ...schemaParameters(
        http.querySchema,
        "query",
        `${http.operationId}_query`,
        schemaComponents
      ),
    ];
    const responses: Record<string, JsonObject> = {
      [String(http.successStatus)]:
        http.successStatus === 204
          ? { description: "The operation completed successfully." }
          : {
              description: "The operation completed successfully.",
              content: {
                "application/json": {
                  schema: openApiJsonSchema(
                    http.responseSchema,
                    "output",
                    `${http.operationId}_response_${http.successStatus}`,
                    schemaComponents
                  ),
                },
              },
            },
      default: {
        description: "A mockOS RFC 7807 problem response.",
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
          "application/json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
      },
    };

    const openApiOperation: JsonObject = {
      operationId: http.operationId,
      summary: http.title ?? operation.title,
      description: http.description ?? operation.description,
      tags: ["Management"],
      security: [{ accessKey: [] }],
      "x-mockos-scopes": [...operation.requiredScopes],
      "x-mockos-effect": operation.effect,
      "x-mockos-retry": operation.retry,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(http.bodySchema
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: openApiJsonSchema(
                    http.bodySchema,
                    "input",
                    `${http.operationId}_request`,
                    schemaComponents
                  ),
                },
              },
            },
          }
        : {}),
      responses,
    };

    const pathItem = paths[http.path] ?? {};
    pathItem[http.method.toLowerCase()] = openApiOperation;
    paths[http.path] = pathItem;
  }

  const problemComponent = openApiJsonSchema(
    problemSchema,
    "output",
    "problem",
    schemaComponents
  );
  const schemas = Object.fromEntries(
    Object.entries({
      ...schemaComponents,
      Problem: problemComponent,
    }).sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    info: {
      title: "mockOS management API",
      version: "0.1.0",
      description:
        "Authenticated self-hosted management operations currently implemented by the mockOS Worker.",
    },
    servers: [{ url: "/__mockos/v1" }],
    tags: [{ name: "Management" }],
    paths,
    components: {
      securitySchemes: {
        accessKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "mockOS Access Key",
        },
      },
      schemas,
    },
  };
};
