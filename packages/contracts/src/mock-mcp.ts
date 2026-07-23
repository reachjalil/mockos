import { z } from "zod";
import {
  assertBehaviorSpecBounds,
  type BehaviorSpec,
  behaviorSpecSchema,
  type JsonValue,
  jsonValueSchema,
} from "./behavior";

export const MOCK_MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const MOCK_MCP_MAX_SERVERS = 100;
export const MOCK_MCP_MAX_CAPABILITIES_PER_KIND = 500;
export const MOCK_MCP_MAX_PAGE_SIZE = 100;
export const MOCK_MCP_DEFAULT_PAGE_SIZE = 50;
export const MOCK_MCP_MAX_SPEC_BYTES = 1024 * 1024;

export const mockMcpSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
export type MockMcpSlug = z.infer<typeof mockMcpSlugSchema>;

export const mockMcpCapabilityNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/);

const jsonObjectSchema = z.record(z.string().min(1).max(256), jsonValueSchema);
export type JsonObject = z.infer<typeof jsonObjectSchema>;

const SUPPORTED_JSON_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "type",
  "title",
  "description",
  "default",
  "examples",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "readOnly",
  "writeOnly",
  "deprecated",
]);
const SUPPORTED_JSON_SCHEMA_TYPES = new Set([
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);
const SUPPORTED_JSON_SCHEMA_DIALECTS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "http://json-schema.org/draft-07/schema#",
]);
const PROHIBITED_JSON_SCHEMA_PROPERTY_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validateSupportedJsonSchema = (
  root: JsonObject,
  context: z.core.$RefinementCtx
): void => {
  const pending: Array<{
    readonly schema: JsonObject;
    readonly path: Array<string | number>;
  }> = [{ schema: root, path: [] }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    for (const keyword of Object.keys(entry.schema)) {
      if (!SUPPORTED_JSON_SCHEMA_KEYWORDS.has(keyword)) {
        context.addIssue({
          code: "custom",
          message: `JSON Schema keyword ${keyword} is not supported.`,
          path: [...entry.path, keyword],
        });
      }
    }

    const dialect = entry.schema.$schema;
    if (
      dialect !== undefined &&
      (typeof dialect !== "string" || !SUPPORTED_JSON_SCHEMA_DIALECTS.has(dialect))
    ) {
      context.addIssue({
        code: "custom",
        message: "JSON Schema dialect is not supported.",
        path: [...entry.path, "$schema"],
      });
    }
    const type = entry.schema.type;
    if (
      type !== undefined &&
      (typeof type !== "string" || !SUPPORTED_JSON_SCHEMA_TYPES.has(type))
    ) {
      context.addIssue({
        code: "custom",
        message: "JSON Schema type must be one supported scalar type.",
        path: [...entry.path, "type"],
      });
    }
    for (const keyword of ["title", "description", "pattern", "format"] as const) {
      const value = entry.schema[keyword];
      if (value !== undefined && (typeof value !== "string" || value.length > 8_192)) {
        context.addIssue({
          code: "custom",
          message: `${keyword} must be a bounded string.`,
          path: [...entry.path, keyword],
        });
      }
    }
    const pattern = entry.schema.pattern;
    if (typeof pattern === "string") {
      try {
        new RegExp(pattern);
      } catch {
        context.addIssue({
          code: "custom",
          message: "JSON Schema pattern must be a valid regular expression.",
          path: [...entry.path, "pattern"],
        });
      }
    }
    for (const keyword of [
      "minItems",
      "maxItems",
      "minProperties",
      "maxProperties",
      "minLength",
      "maxLength",
    ] as const) {
      const value = entry.schema[keyword];
      if (
        value !== undefined &&
        (typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > 1_000_000)
      ) {
        context.addIssue({
          code: "custom",
          message: `${keyword} must be a bounded non-negative integer.`,
          path: [...entry.path, keyword],
        });
      }
    }
    for (const keyword of [
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
    ] as const) {
      const value = entry.schema[keyword];
      if (value !== undefined && typeof value !== "number") {
        context.addIssue({
          code: "custom",
          message: `${keyword} must be a finite number.`,
          path: [...entry.path, keyword],
        });
      }
    }
    const multipleOf = entry.schema.multipleOf;
    if (
      multipleOf !== undefined &&
      (typeof multipleOf !== "number" || multipleOf <= 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "multipleOf must be a positive number.",
        path: [...entry.path, "multipleOf"],
      });
    }
    for (const keyword of [
      "uniqueItems",
      "readOnly",
      "writeOnly",
      "deprecated",
    ] as const) {
      const value = entry.schema[keyword];
      if (value !== undefined && typeof value !== "boolean") {
        context.addIssue({
          code: "custom",
          message: `${keyword} must be a boolean.`,
          path: [...entry.path, keyword],
        });
      }
    }

    const properties = entry.schema.properties;
    if (properties !== undefined) {
      if (!isJsonObject(properties)) {
        context.addIssue({
          code: "custom",
          message: "properties must be an object of supported schemas.",
          path: [...entry.path, "properties"],
        });
      } else {
        for (const [name, child] of Object.entries(properties)) {
          if (
            name.length < 1 ||
            name.length > 256 ||
            PROHIBITED_JSON_SCHEMA_PROPERTY_NAMES.has(name) ||
            !isJsonObject(child)
          ) {
            context.addIssue({
              code: "custom",
              message: "Each property must have a bounded name and object schema.",
              path: [...entry.path, "properties", name],
            });
          } else {
            pending.push({
              schema: child,
              path: [...entry.path, "properties", name],
            });
          }
        }
      }
    }

    const required = entry.schema.required;
    if (required !== undefined) {
      const valid =
        Array.isArray(required) &&
        required.length <= 1_000 &&
        required.every(
          (name) =>
            typeof name === "string" &&
            name.length >= 1 &&
            name.length <= 256 &&
            !PROHIBITED_JSON_SCHEMA_PROPERTY_NAMES.has(name)
        ) &&
        new Set(required).size === required.length;
      if (!valid) {
        context.addIssue({
          code: "custom",
          message: "required must contain unique, bounded property names.",
          path: [...entry.path, "required"],
        });
      }
    }

    for (const keyword of ["items", "not"] as const) {
      const child = entry.schema[keyword];
      if (child !== undefined) {
        if (!isJsonObject(child)) {
          context.addIssue({
            code: "custom",
            message: `${keyword} must contain one supported object schema.`,
            path: [...entry.path, keyword],
          });
        } else {
          pending.push({
            schema: child,
            path: [...entry.path, keyword],
          });
        }
      }
    }
    const additionalProperties = entry.schema.additionalProperties;
    if (
      additionalProperties !== undefined &&
      typeof additionalProperties !== "boolean"
    ) {
      if (!isJsonObject(additionalProperties)) {
        context.addIssue({
          code: "custom",
          message: "additionalProperties must be a boolean or object schema.",
          path: [...entry.path, "additionalProperties"],
        });
      } else {
        pending.push({
          schema: additionalProperties,
          path: [...entry.path, "additionalProperties"],
        });
      }
    }
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      const children = entry.schema[keyword];
      if (children !== undefined) {
        if (
          !Array.isArray(children) ||
          children.length < 1 ||
          children.length > 20 ||
          children.some((child) => !isJsonObject(child))
        ) {
          context.addIssue({
            code: "custom",
            message: `${keyword} must contain 1 to 20 supported object schemas.`,
            path: [...entry.path, keyword],
          });
        } else {
          for (const [index, child] of children.entries()) {
            pending.push({
              schema: child as JsonObject,
              path: [...entry.path, keyword, index],
            });
          }
        }
      }
    }
    const enumeration = entry.schema.enum;
    if (
      enumeration !== undefined &&
      (!Array.isArray(enumeration) ||
        enumeration.length < 1 ||
        enumeration.length > 1_000)
    ) {
      context.addIssue({
        code: "custom",
        message: "enum must contain 1 to 1,000 JSON values.",
        path: [...entry.path, "enum"],
      });
    }
    const examples = entry.schema.examples;
    if (examples !== undefined && (!Array.isArray(examples) || examples.length > 100)) {
      context.addIssue({
        code: "custom",
        message: "examples must contain at most 100 JSON values.",
        path: [...entry.path, "examples"],
      });
    }
  }
};

export const mockMcpJsonSchemaSchema = jsonObjectSchema.superRefine(
  (schema, context) => {
    if (schema.type !== undefined && schema.type !== "object") {
      context.addIssue({
        code: "custom",
        message: "A capability input or output schema must describe an object root.",
        path: ["type"],
      });
    }
    validateSupportedJsonSchema(schema, context);
  }
);
export type MockMcpJsonSchema = z.infer<typeof mockMcpJsonSchemaSchema>;

const boundedBehaviorSpecSchema: z.ZodType<BehaviorSpec> = z.preprocess((input) => {
  assertBehaviorSpecBounds(input);
  return input;
}, behaviorSpecSchema);

const annotationsSchema = z
  .object({
    title: z.string().min(1).max(256).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();

export const mockMcpToolResultSchema = z
  .object({
    content: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("text"),
              text: z.string().max(256_000),
            })
            .strict(),
          z
            .object({
              type: z.literal("image"),
              data: z.string().max(1_400_000),
              mimeType: z.string().min(1).max(256),
            })
            .strict(),
          z
            .object({
              type: z.literal("audio"),
              data: z.string().max(1_400_000),
              mimeType: z.string().min(1).max(256),
            })
            .strict(),
        ])
      )
      .max(1_000)
      .default([]),
    structuredContent: jsonObjectSchema.optional(),
    isError: z.boolean().optional(),
  })
  .strict();
export type MockMcpToolResult = z.infer<typeof mockMcpToolResultSchema>;

export const mockMcpResourceContentsSchema = z
  .object({
    uri: z.string().min(1).max(2_048),
    mimeType: z.string().min(1).max(256).optional(),
    text: z.string().max(1_000_000).optional(),
    blob: z.string().max(1_400_000).optional(),
  })
  .strict()
  .superRefine((contents, context) => {
    if ((contents.text === undefined) === (contents.blob === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Resource contents require exactly one of text or blob.",
      });
    }
  });
export type MockMcpResourceContents = z.infer<typeof mockMcpResourceContentsSchema>;

export const mockMcpReadResourceResultSchema = z
  .object({
    contents: z.array(mockMcpResourceContentsSchema).min(1).max(1_000),
  })
  .strict();
export type MockMcpReadResourceResult = z.infer<typeof mockMcpReadResourceResultSchema>;

export const mockMcpPromptMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string().max(256_000) }).strict(),
      z
        .object({
          type: z.literal("image"),
          data: z.string().max(1_400_000),
          mimeType: z.string().min(1).max(256),
        })
        .strict(),
      z
        .object({
          type: z.literal("audio"),
          data: z.string().max(1_400_000),
          mimeType: z.string().min(1).max(256),
        })
        .strict(),
    ]),
  })
  .strict();

export const mockMcpGetPromptResultSchema = z
  .object({
    description: z.string().max(8_192).optional(),
    messages: z.array(mockMcpPromptMessageSchema).max(1_000),
  })
  .strict();
export type MockMcpGetPromptResult = z.infer<typeof mockMcpGetPromptResultSchema>;

export const mockMcpToolSpecSchema = z
  .object({
    name: mockMcpCapabilityNameSchema,
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(8_192).optional(),
    inputSchema: mockMcpJsonSchemaSchema.default({ type: "object" }),
    outputSchema: mockMcpJsonSchemaSchema.optional(),
    annotations: annotationsSchema.optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpToolSpec = z.infer<typeof mockMcpToolSpecSchema>;

export const mockMcpResourceSpecSchema = z
  .object({
    uri: z.string().min(1).max(2_048),
    name: z.string().min(1).max(256),
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(8_192).optional(),
    mimeType: z.string().min(1).max(256).optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpResourceSpec = z.infer<typeof mockMcpResourceSpecSchema>;

export const mockMcpResourceTemplateSpecSchema = z
  .object({
    uriTemplate: z.string().min(1).max(2_048),
    name: z.string().min(1).max(256),
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(8_192).optional(),
    mimeType: z.string().min(1).max(256).optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpResourceTemplateSpec = z.infer<
  typeof mockMcpResourceTemplateSpecSchema
>;

export const mockMcpPromptSpecSchema = z
  .object({
    name: mockMcpCapabilityNameSchema,
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(8_192).optional(),
    arguments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(128),
            description: z.string().max(8_192).optional(),
            required: z.boolean().optional(),
          })
          .strict()
      )
      .max(100)
      .default([]),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpPromptSpec = z.infer<typeof mockMcpPromptSpecSchema>;

const uniqueBy = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
  context: z.core.$RefinementCtx,
  path: string
) => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const identity = key(value);
    if (seen.has(identity)) {
      context.addIssue({
        code: "custom",
        message: `${path} entries must be unique; duplicate ${identity}.`,
        path: [path, index],
      });
    }
    seen.add(identity);
  }
};

const mockMcpServerSpecObjectSchema = z
  .object({
    version: z.literal(1),
    slug: mockMcpSlugSchema,
    serverInfo: z
      .object({
        name: z.string().min(1).max(256),
        version: z.string().min(1).max(128),
      })
      .strict(),
    instructions: z.string().max(32_000).optional(),
    transport: z
      .object({
        stateful: z.boolean().default(true),
        enableGet: z.boolean().default(false),
        sessionTtlSeconds: z.number().int().min(60).max(86_400).default(3_600),
      })
      .strict()
      .default({
        stateful: true,
        enableGet: false,
        sessionTtlSeconds: 3_600,
      }),
    authentication: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("none") }).strict(),
        z
          .object({
            mode: z.literal("bearer"),
            tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      ])
      .default({ mode: "none" }),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MOCK_MCP_MAX_PAGE_SIZE)
      .default(MOCK_MCP_DEFAULT_PAGE_SIZE),
    tools: z
      .array(mockMcpToolSpecSchema)
      .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND)
      .default([]),
    resources: z
      .array(mockMcpResourceSpecSchema)
      .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND)
      .default([]),
    resourceTemplates: z
      .array(mockMcpResourceTemplateSpecSchema)
      .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND)
      .default([]),
    prompts: z
      .array(mockMcpPromptSpecSchema)
      .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND)
      .default([]),
    errorCodeMap: z
      .record(z.string().min(1).max(128), z.number().int().min(-32_099).max(-32_000))
      .default({}),
  })
  .strict()
  .superRefine((server, context) => {
    uniqueBy(server.tools, (value) => value.name, context, "tools");
    uniqueBy(server.resources, (value) => value.uri, context, "resources");
    uniqueBy(
      server.resourceTemplates,
      (value) => value.uriTemplate,
      context,
      "resourceTemplates"
    );
    uniqueBy(server.prompts, (value) => value.name, context, "prompts");
    for (const [promptIndex, prompt] of server.prompts.entries()) {
      uniqueBy(
        prompt.arguments,
        (value) => value.name,
        context,
        `prompts.${promptIndex}.arguments`
      );
    }
  });
export const mockMcpServerSpecSchema = z.preprocess((input) => {
  assertMockMcpSpecSize(input);
  return input;
}, mockMcpServerSpecObjectSchema);
export type MockMcpServerSpec = z.infer<typeof mockMcpServerSpecSchema>;

export const mockMcpServerRecordSchema = z
  .object({
    spec: mockMcpServerSpecSchema,
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockMcpServerRecord = z.infer<typeof mockMcpServerRecordSchema>;

export const mockMcpServerSummarySchema = z
  .object({
    slug: mockMcpSlugSchema,
    name: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    revision: z.number().int().min(1),
    toolCount: z.number().int().min(0),
    resourceCount: z.number().int().min(0),
    resourceTemplateCount: z.number().int().min(0),
    promptCount: z.number().int().min(0),
    stateful: z.boolean(),
    getEnabled: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockMcpServerSummary = z.infer<typeof mockMcpServerSummarySchema>;

export const toMockMcpServerSummary = (
  record: MockMcpServerRecord
): MockMcpServerSummary => ({
  slug: record.spec.slug,
  name: record.spec.serverInfo.name,
  version: record.spec.serverInfo.version,
  revision: record.revision,
  toolCount: record.spec.tools.length,
  resourceCount: record.spec.resources.length,
  resourceTemplateCount: record.spec.resourceTemplates.length,
  promptCount: record.spec.prompts.length,
  stateful: record.spec.transport.stateful,
  getEnabled: record.spec.transport.enableGet,
  updatedAt: record.updatedAt,
});

export const assertMockMcpSpecSize = (input: unknown): void => {
  try {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_MCP_MAX_SPEC_BYTES,
      maximumDepth: 64,
      maximumNodes: 100_000,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    throw new Error(
      `Mock MCP server spec violates its ${MOCK_MCP_MAX_SPEC_BYTES}-byte, depth, node, or key bound.${detail}`,
      { cause }
    );
  }
};

export const parseMockMcpServerSpec = (input: unknown): MockMcpServerSpec => {
  return mockMcpServerSpecSchema.parse(input);
};

export type MockMcpBehaviorValue =
  | MockMcpToolResult
  | MockMcpReadResourceResult
  | MockMcpGetPromptResult
  | JsonValue;

export type MockMcpCapabilityBehavior = BehaviorSpec;
