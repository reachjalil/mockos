import { mockosMcpToolNames, problemSchema } from "@mockos/contracts";
import {
  type MockosHttpOperation,
  mockosHttpOperationIds,
  mockosHttpOperations,
  mockosManagementOperations,
} from "@mockos/contracts/operations";
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

export type MockosManagementDocumentationCatalog = {
  schemaVersion: 1;
  generatedFrom: "packages/contracts/src/operations/management.ts";
  placeholders: {
    managementAccessKey: "$MOCKOS_API_KEY";
    mcpEndpoint: "$MOCKOS_MCP_ENDPOINT";
    protocolMockCredential: "$MOCKOS_SYNTHETIC_CREDENTIAL";
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
      status: "unavailable";
      phase: "F2";
    };
    codeMode: {
      status: "unavailable";
      phase: "F6";
    };
  };
};

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
        mockLlmApis: { status: "unavailable", phase: "F2" },
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
