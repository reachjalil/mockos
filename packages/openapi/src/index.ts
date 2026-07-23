import { problemSchema } from "@mockos/contracts";
import {
  type MockosHttpOperation,
  mockosHttpOperationIds,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
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

const jsonSchema = (schema: z.ZodType, io: "input" | "output"): JsonObject =>
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

const schemaParameters = (
  schema: z.ZodType | undefined,
  location: "path" | "query"
): JsonObject[] => {
  if (!schema) return [];
  const converted = jsonSchema(schema, "input");
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
                  schema: jsonSchema(http.responseSchema, "output"),
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
                  schema: jsonSchema(http.bodySchema, "input"),
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
        Problem: jsonSchema(problemSchema, "output"),
      },
    },
  };
};
