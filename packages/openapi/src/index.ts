import { mockosMcpToolNames, problemSchema } from "@mockos/contracts";
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
  MOCK_LLM_ANTHROPIC_MAX_TOOLS,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_DEPTH,
  MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_NODES,
  MOCK_LLM_ANTHROPIC_VERSION,
  MOCK_LLM_OPENAI_MAX_MESSAGES,
  MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH,
  MOCK_LLM_OPENAI_MAX_REQUEST_NODES,
  MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_TEXT_BYTES,
  MOCK_LLM_OPENAI_MAX_TOOLS,
  MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES,
  mockLlmAnthropicProviderManifest,
  mockLlmOpenAiProviderManifest,
} from "@mockos/llm-mock";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z } from "zod";

type JsonObject = Record<string, unknown>;

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
    streaming: false;
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
    streaming: "rejected";
    streamOptions: "rejected";
    multimodal: "unsupported";
    unknownTopLevelFields: "rejected";
  };
  response: {
    maxBodyBytes: number;
    requestIdHeader: "x-request-id";
    completionIdPrefix: "chatcmpl-";
    transportIds: "fresh-per-invocation";
    deterministicPlanIdExposure: "never";
  };
  planning: {
    conversationState: "stateless";
    turnIndex: "prior-assistant-message-count";
    stateKey: "server-slug+dialect+model";
    definitionRevision: "rechecked-before-plan-commit";
    initialDelay: "abort-aware";
    chunkCadence: "inert-without-streaming";
  };
  evidence: {
    packageTests: "qualified";
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
    streaming: false;
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
    streaming: "rejected";
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
  };
  planning: {
    conversationState: "stateless";
    turnIndex: "prior-assistant-message-count";
    stateKey: "server-slug+dialect+model";
    definitionRevision: "rechecked-before-plan-commit";
    initialDelay: "abort-aware";
    chunkCadence: "inert-without-streaming";
  };
  security: {
    requestCredentialReflection: "rejected";
    responseCredentialReflection: "rejected";
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
        persistence: "environment-schema-v7";
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
          upgrade: "v6-to-v7";
          rollback: "v6-refuses-v7";
        };
      };
      guide: "docs/mock-llm.md";
      providerDataPlane: {
        status: "openai-and-anthropic-non-streaming-source-qualified";
        managementConfiguration: "MCP-only";
        manifests: readonly [
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ];
        openAi: MockLlmOpenAiProviderDocumentation;
        anthropic: MockLlmAnthropicProviderDocumentation;
        responsesApi: "unavailable";
        conversationState: "unavailable";
        observationsAndAssertions: "unavailable";
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
      streaming: "rejected",
      streamOptions: "rejected",
      multimodal: "unsupported",
      unknownTopLevelFields: "rejected",
    },
    response: {
      maxBodyBytes: MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
      requestIdHeader: "x-request-id",
      completionIdPrefix: "chatcmpl-",
      transportIds: "fresh-per-invocation",
      deterministicPlanIdExposure: "never",
    },
    planning: {
      conversationState: "stateless",
      turnIndex: "prior-assistant-message-count",
      stateKey: "server-slug+dialect+model",
      definitionRevision: "rechecked-before-plan-commit",
      initialDelay: "abort-aware",
      chunkCadence: "inert-without-streaming",
    },
    evidence: {
      packageTests: "qualified",
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
      streaming: "rejected",
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
    },
    planning: {
      conversationState: "stateless",
      turnIndex: "prior-assistant-message-count",
      stateKey: "server-slug+dialect+model",
      definitionRevision: "rechecked-before-plan-commit",
      initialDelay: "abort-aware",
      chunkCadence: "inert-without-streaming",
    },
    security: {
      requestCredentialReflection: "rejected",
      responseCredentialReflection: "rejected",
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

const openApiJsonSchema = (schema: z.ZodType, io: "input" | "output"): JsonObject =>
  JSON.parse(
    JSON.stringify(
      z.toJSONSchema(schema, {
        target: "openapi-3.0",
        io,
        cycles: "ref",
        reused: "inline",
        unrepresentable: "any",
      })
    )
  ) as JsonObject;

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
  location: "path" | "query"
): JsonObject[] => {
  if (!schema) return [];
  const converted = openApiJsonSchema(schema, "input");
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
            persistence: "environment-schema-v7",
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
              upgrade: "v6-to-v7",
              rollback: "v6-refuses-v7",
            },
          },
          guide: "docs/mock-llm.md",
          providerDataPlane: {
            status: "openai-and-anthropic-non-streaming-source-qualified",
            managementConfiguration: "MCP-only",
            manifests: [
              "docs/reference/mock-llm-openai.v1.json",
              "docs/reference/mock-llm-anthropic.v1.json",
            ],
            openAi: generateMockLlmOpenAiProviderDocumentation(),
            anthropic: generateMockLlmAnthropicProviderDocumentation(),
            responsesApi: "unavailable",
            conversationState: "unavailable",
            observationsAndAssertions: "unavailable",
          },
          deployedAcceptance: "unqualified",
        },
        codeMode: { status: "unavailable", phase: "F6" },
      },
    };
  };

export const generateMockosManagementOpenApi = (): JsonObject => {
  const paths: Record<string, Record<string, JsonObject>> = {};

  for (const operationId of [...mockosHttpOperationIds].sort()) {
    const operation = mockosHttpOperations[operationId];
    const http = operation.http as MockosHttpOperation;
    const parameters = [
      ...schemaParameters(http.pathSchema, "path"),
      ...schemaParameters(http.querySchema, "query"),
    ];
    const responses: Record<string, JsonObject> = {
      [String(http.successStatus)]:
        http.successStatus === 204
          ? { description: "The operation completed successfully." }
          : {
              description: "The operation completed successfully.",
              content: {
                "application/json": {
                  schema: openApiJsonSchema(http.responseSchema, "output"),
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
                  schema: openApiJsonSchema(http.bodySchema, "input"),
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

  return {
    openapi: "3.0.3",
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
      schemas: {
        Problem: openApiJsonSchema(problemSchema, "output"),
      },
    },
  };
};
