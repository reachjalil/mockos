import { z } from "zod";
import {
  assertBehaviorSpecBounds,
  type BehaviorSpec,
  behaviorSpecSchema,
  type JsonValue,
  jsonValueSchema,
} from "./behavior";

export const MOCK_MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const MOCK_MCP_MAX_SERVERS = 64;
export const MOCK_MCP_MAX_CAPABILITIES_PER_KIND = 64;
export const MOCK_MCP_MAX_PAGE_SIZE = 50;
export const MOCK_MCP_DEFAULT_PAGE_SIZE = 25;
export const MOCK_MCP_MAX_SPEC_BYTES = 256 * 1024;
export const MOCK_MCP_MAX_SPEC_DEPTH = 24;
export const MOCK_MCP_MAX_SPEC_NODES = 10_000;
export const MOCK_MCP_MAX_SCHEMA_BYTES = 32 * 1024;
export const MOCK_MCP_MAX_SCHEMA_DEPTH = 12;
export const MOCK_MCP_MAX_SCHEMA_NODES = 1_000;
export const MOCK_MCP_MAX_RESULT_BYTES = 256 * 1024;
export const MOCK_MCP_MAX_RESULT_DEPTH = 16;
export const MOCK_MCP_MAX_RESULT_NODES = 5_000;
export const MOCK_MCP_MAX_DESCRIPTION_LENGTH = 2_048;
export const MOCK_MCP_MAX_URI_LENGTH = 1_024;
export const MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES = 20;
export const MOCK_MCP_MAX_ERROR_CODES = 64;
export const MOCK_MCP_STATE_CAPACITY = -32_050;

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

const jsonObjectSchema = z.record(z.string().min(1).max(128), jsonValueSchema);
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
const PROHIBITED_JSON_PROPERTY_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const PROHIBITED_MOCK_MCP_URI_SCHEMES = new Set(["data", "javascript", "vbscript"]);
const MOCK_MCP_MAX_SCHEMA_COLLECTION_SIZE = 128;
const MOCK_MCP_MAX_SCHEMA_BRANCHES = 8;
const MOCK_MCP_MAX_SCHEMA_EXAMPLES = 16;
const MOCK_MCP_MAX_SCHEMA_LENGTH_BOUND = 256_000;

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
    for (const keyword of ["title", "description"] as const) {
      const value = entry.schema[keyword];
      if (
        value !== undefined &&
        (typeof value !== "string" || value.length > MOCK_MCP_MAX_DESCRIPTION_LENGTH)
      ) {
        context.addIssue({
          code: "custom",
          message: `${keyword} must be a bounded string.`,
          path: [...entry.path, keyword],
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
          value > MOCK_MCP_MAX_SCHEMA_LENGTH_BOUND)
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
            name.length > 128 ||
            PROHIBITED_JSON_PROPERTY_NAMES.has(name) ||
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
        required.length <= MOCK_MCP_MAX_SCHEMA_COLLECTION_SIZE &&
        required.every(
          (name) =>
            typeof name === "string" &&
            name.length >= 1 &&
            name.length <= 128 &&
            !PROHIBITED_JSON_PROPERTY_NAMES.has(name)
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
          children.length > MOCK_MCP_MAX_SCHEMA_BRANCHES ||
          children.some((child) => !isJsonObject(child))
        ) {
          context.addIssue({
            code: "custom",
            message: `${keyword} must contain 1 to ${MOCK_MCP_MAX_SCHEMA_BRANCHES} supported object schemas.`,
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
        enumeration.length > MOCK_MCP_MAX_SCHEMA_COLLECTION_SIZE)
    ) {
      context.addIssue({
        code: "custom",
        message: `enum must contain 1 to ${MOCK_MCP_MAX_SCHEMA_COLLECTION_SIZE} JSON values.`,
        path: [...entry.path, "enum"],
      });
    }
    const examples = entry.schema.examples;
    if (
      examples !== undefined &&
      (!Array.isArray(examples) || examples.length > MOCK_MCP_MAX_SCHEMA_EXAMPLES)
    ) {
      context.addIssue({
        code: "custom",
        message: `examples must contain at most ${MOCK_MCP_MAX_SCHEMA_EXAMPLES} JSON values.`,
        path: [...entry.path, "examples"],
      });
    }
  }
};

const mockMcpJsonSchemaObjectSchema = z
  .intersection(jsonObjectSchema, z.object({ type: z.literal("object") }).passthrough())
  .superRefine((schema, context) => {
    validateSupportedJsonSchema(schema, context);
  });
export const mockMcpJsonSchemaSchema = z.preprocess((input) => {
  if (input !== undefined) {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_MCP_MAX_SCHEMA_BYTES,
      maximumDepth: MOCK_MCP_MAX_SCHEMA_DEPTH,
      maximumNodes: MOCK_MCP_MAX_SCHEMA_NODES,
    });
  }
  return input;
}, mockMcpJsonSchemaObjectSchema);
export type MockMcpJsonSchema = z.infer<typeof mockMcpJsonSchemaSchema>;

const boundedBehaviorSpecSchema: z.ZodType<BehaviorSpec> = z.preprocess((input) => {
  assertBehaviorSpecBounds(input, {
    maximumBytes: MOCK_MCP_MAX_RESULT_BYTES,
    maximumDepth: MOCK_MCP_MAX_RESULT_DEPTH,
    maximumNodes: MOCK_MCP_MAX_RESULT_NODES,
  });
  return input;
}, behaviorSpecSchema);

const annotationsSchema = z
  .object({
    title: z.string().min(1).max(128).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();

export const mockMcpUriTemplateVariableSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .refine((name) => !PROHIBITED_JSON_PROPERTY_NAMES.has(name), {
    message: "Prototype-related URI-template variable names are not permitted.",
  });
export type MockMcpUriTemplateVariable = z.infer<
  typeof mockMcpUriTemplateVariableSchema
>;

type MockMcpUriTemplateInspection = {
  readonly expanded: string;
  readonly variables: readonly string[];
  readonly issues: readonly string[];
};

const inspectMockMcpUriTemplate = (template: string): MockMcpUriTemplateInspection => {
  const variables: string[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  let expanded = "";

  const scheme = template.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1];
  if (!scheme) {
    issues.push("Resource templates must use an absolute URI with a literal scheme.");
  } else if (PROHIBITED_MOCK_MCP_URI_SCHEMES.has(scheme.toLowerCase())) {
    issues.push("Resource templates cannot use an executable or inline-data scheme.");
  }
  if (
    [...template].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === "\\" || codePoint <= 0x20 || codePoint === 0x7f;
    })
  ) {
    issues.push(
      "Resource templates cannot contain controls, whitespace, or backslashes."
    );
  }

  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (character === "}") {
      issues.push("Resource templates cannot contain an unmatched closing brace.");
      expanded += character;
      continue;
    }
    if (character !== "{") {
      expanded += character;
      continue;
    }

    const end = template.indexOf("}", index + 1);
    if (end === -1) {
      issues.push("Resource templates cannot contain an unmatched opening brace.");
      expanded += template.slice(index);
      break;
    }
    const expression = template.slice(index + 1, end);
    const parsed = mockMcpUriTemplateVariableSchema.safeParse(expression);
    if (!parsed.success) {
      issues.push(
        "Resource templates support only Level-1 {variable} expressions with simple names."
      );
    } else {
      if (seen.has(parsed.data)) {
        issues.push("A resource-template variable may appear only once.");
      }
      seen.add(parsed.data);
      variables.push(parsed.data);
    }
    expanded += "mockos-value";
    index = end;
  }

  if (variables.length === 0) {
    issues.push("A resource template must contain at least one Level-1 variable.");
  } else if (variables.length > MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES) {
    issues.push(
      `A resource template can contain at most ${MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES} variables.`
    );
  }
  try {
    const url = new URL(expanded);
    if (url.username || url.password) {
      issues.push("Resource templates cannot contain URI user information.");
    }
  } catch {
    issues.push("Resource templates must expand to a valid absolute URI.");
  }

  return { expanded, variables, issues };
};

export const mockMcpUriTemplateSchema = z
  .string()
  .min(1)
  .max(MOCK_MCP_MAX_URI_LENGTH)
  .superRefine((template, context) => {
    for (const message of inspectMockMcpUriTemplate(template).issues) {
      context.addIssue({ code: "custom", message });
    }
  });
export type MockMcpUriTemplate = z.infer<typeof mockMcpUriTemplateSchema>;

export const mockMcpUriTemplateVariables = (
  template: string
): readonly MockMcpUriTemplateVariable[] => {
  const validated = mockMcpUriTemplateSchema.parse(template);
  return Object.freeze([
    ...inspectMockMcpUriTemplate(validated).variables,
  ] as MockMcpUriTemplateVariable[]);
};

export const mockMcpResourceUriSchema = z
  .string()
  .min(1)
  .max(MOCK_MCP_MAX_URI_LENGTH)
  .superRefine((uri, context) => {
    if (
      [...uri].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return character === "\\" || codePoint <= 0x20 || codePoint === 0x7f;
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Resource URIs cannot contain controls, whitespace, or backslashes.",
      });
      return;
    }
    const scheme = uri.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1];
    if (!scheme) {
      context.addIssue({
        code: "custom",
        message: "Resource URIs must be absolute and include a literal scheme.",
      });
      return;
    }
    if (PROHIBITED_MOCK_MCP_URI_SCHEMES.has(scheme.toLowerCase())) {
      context.addIssue({
        code: "custom",
        message: "Resource URIs cannot use an executable or inline-data scheme.",
      });
      return;
    }
    try {
      const parsed = new URL(uri);
      if (parsed.username || parsed.password) {
        context.addIssue({
          code: "custom",
          message: "Resource URIs cannot contain URI user information.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Resource URIs must be valid absolute URIs.",
      });
    }
  });
export type MockMcpResourceUri = z.infer<typeof mockMcpResourceUriSchema>;

const STANDARD_BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const isCanonicalStandardBase64 = (value: string): boolean => {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return false;
  }
  if (value.endsWith("==")) {
    return (STANDARD_BASE64_ALPHABET.indexOf(value.at(-3) ?? "") & 0b1111) === 0;
  }
  if (value.endsWith("=")) {
    return (STANDARD_BASE64_ALPHABET.indexOf(value.at(-2) ?? "") & 0b11) === 0;
  }
  return true;
};

export const mockMcpBase64Schema = z
  .string()
  .max(256_000)
  .refine(isCanonicalStandardBase64, {
    message: "Binary MCP content must use canonical standard base64 encoding.",
  });

const mockMcpToolResultObjectSchema = z
  .object({
    content: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("text"),
              text: z.string().max(64_000),
            })
            .strict(),
          z
            .object({
              type: z.literal("image"),
              data: mockMcpBase64Schema,
              mimeType: z.string().min(1).max(128),
            })
            .strict(),
          z
            .object({
              type: z.literal("audio"),
              data: mockMcpBase64Schema,
              mimeType: z.string().min(1).max(128),
            })
            .strict(),
        ])
      )
      .max(64)
      .default([]),
    structuredContent: jsonObjectSchema.optional(),
    isError: z.boolean().optional(),
  })
  .strict();
export const mockMcpToolResultSchema = z.preprocess((input) => {
  assertBehaviorSpecBounds(input, {
    maximumBytes: MOCK_MCP_MAX_RESULT_BYTES,
    maximumDepth: MOCK_MCP_MAX_RESULT_DEPTH,
    maximumNodes: MOCK_MCP_MAX_RESULT_NODES,
  });
  return input;
}, mockMcpToolResultObjectSchema);
export type MockMcpToolResult = z.infer<typeof mockMcpToolResultSchema>;

export const mockMcpResourceContentsSchema = z
  .object({
    uri: mockMcpResourceUriSchema,
    mimeType: z.string().min(1).max(128).optional(),
    text: z.string().max(256_000).optional(),
    blob: mockMcpBase64Schema.optional(),
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

const mockMcpReadResourceResultObjectSchema = z
  .object({
    contents: z.array(mockMcpResourceContentsSchema).min(1).max(64),
  })
  .strict();
export const mockMcpReadResourceResultSchema = z.preprocess((input) => {
  assertBehaviorSpecBounds(input, {
    maximumBytes: MOCK_MCP_MAX_RESULT_BYTES,
    maximumDepth: MOCK_MCP_MAX_RESULT_DEPTH,
    maximumNodes: MOCK_MCP_MAX_RESULT_NODES,
  });
  return input;
}, mockMcpReadResourceResultObjectSchema);
export type MockMcpReadResourceResult = z.infer<typeof mockMcpReadResourceResultSchema>;

export const mockMcpPromptMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string().max(64_000) }).strict(),
      z
        .object({
          type: z.literal("image"),
          data: mockMcpBase64Schema,
          mimeType: z.string().min(1).max(128),
        })
        .strict(),
      z
        .object({
          type: z.literal("audio"),
          data: mockMcpBase64Schema,
          mimeType: z.string().min(1).max(128),
        })
        .strict(),
    ]),
  })
  .strict();

const mockMcpGetPromptResultObjectSchema = z
  .object({
    description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
    messages: z.array(mockMcpPromptMessageSchema).max(64),
  })
  .strict();
export const mockMcpGetPromptResultSchema = z.preprocess((input) => {
  assertBehaviorSpecBounds(input, {
    maximumBytes: MOCK_MCP_MAX_RESULT_BYTES,
    maximumDepth: MOCK_MCP_MAX_RESULT_DEPTH,
    maximumNodes: MOCK_MCP_MAX_RESULT_NODES,
  });
  return input;
}, mockMcpGetPromptResultObjectSchema);
export type MockMcpGetPromptResult = z.infer<typeof mockMcpGetPromptResultSchema>;

export const mockMcpToolSpecSchema = z
  .object({
    name: mockMcpCapabilityNameSchema,
    title: z.string().min(1).max(128).optional(),
    description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
    inputSchema: mockMcpJsonSchemaSchema.default({ type: "object" }),
    outputSchema: mockMcpJsonSchemaSchema.optional(),
    annotations: annotationsSchema.optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpToolSpec = z.infer<typeof mockMcpToolSpecSchema>;

export const mockMcpResourceSpecSchema = z
  .object({
    uri: mockMcpResourceUriSchema,
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(128).optional(),
    description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
    mimeType: z.string().min(1).max(128).optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpResourceSpec = z.infer<typeof mockMcpResourceSpecSchema>;

export const mockMcpResourceTemplateSpecSchema = z
  .object({
    uriTemplate: mockMcpUriTemplateSchema,
    name: z.string().min(1).max(128),
    title: z.string().min(1).max(128).optional(),
    description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
    mimeType: z.string().min(1).max(128).optional(),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpResourceTemplateSpec = z.infer<
  typeof mockMcpResourceTemplateSpecSchema
>;

export const mockMcpPromptSpecSchema = z
  .object({
    name: mockMcpCapabilityNameSchema,
    title: z.string().min(1).max(128).optional(),
    description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
    arguments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(128),
            description: z.string().max(MOCK_MCP_MAX_DESCRIPTION_LENGTH).optional(),
            required: z.boolean().optional(),
          })
          .strict()
      )
      .max(64)
      .default([]),
    behavior: boundedBehaviorSpecSchema,
  })
  .strict();
export type MockMcpPromptSpec = z.infer<typeof mockMcpPromptSpecSchema>;

const uniqueBy = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  label: string
) => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const identity = key(value);
    if (seen.has(identity)) {
      context.addIssue({
        code: "custom",
        message: `${label} entries must be unique; duplicate ${identity}.`,
        path: [...path, index],
      });
    }
    seen.add(identity);
  }
};

export const mockMcpBearerTokenSchema = z
  .string()
  .min(16)
  .max(1_024)
  .regex(/^[A-Za-z0-9\-._~+/]+=*$/);
export type MockMcpBearerToken = z.infer<typeof mockMcpBearerTokenSchema>;

export const mockMcpAuthenticationWriteSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }).strict(),
    z
      .object({
        mode: z.literal("bearer"),
        token: mockMcpBearerTokenSchema,
      })
      .strict(),
  ])
  .default({ mode: "none" });
export type MockMcpAuthenticationWrite = z.infer<
  typeof mockMcpAuthenticationWriteSchema
>;

export const mockMcpAuthenticationSpecSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }).strict(),
    z
      .object({
        mode: z.literal("bearer"),
        tokenSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  ])
  .default({ mode: "none" });
export type MockMcpAuthenticationSpec = z.infer<typeof mockMcpAuthenticationSpecSchema>;

export const mockMcpAuthenticationViewSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({
      mode: z.literal("bearer"),
      configured: z.literal(true),
    })
    .strict(),
]);
export type MockMcpAuthenticationView = z.infer<typeof mockMcpAuthenticationViewSchema>;

const mockMcpErrorCodeMapSchema = z
  .record(z.string().min(1).max(128), z.number().int().min(-32_099).max(-32_000))
  .superRefine((mapping, context) => {
    if (Object.keys(mapping).length > MOCK_MCP_MAX_ERROR_CODES) {
      context.addIssue({
        code: "custom",
        message: `A mock MCP server can map at most ${MOCK_MCP_MAX_ERROR_CODES} error codes.`,
      });
    }
    for (const [name, code] of Object.entries(mapping)) {
      if (code === MOCK_MCP_STATE_CAPACITY) {
        context.addIssue({
          code: "custom",
          message: `JSON-RPC code ${MOCK_MCP_STATE_CAPACITY} is reserved for mock MCP state capacity failures.`,
          path: [name],
        });
      }
    }
  })
  .default({});

const mockMcpServerCommonShape = {
  version: z.literal(1),
  slug: mockMcpSlugSchema,
  serverInfo: z
    .object({
      name: z.string().min(1).max(128),
      version: z.string().min(1).max(64),
    })
    .strict(),
  instructions: z.string().max(8_192).optional(),
  transport: z
    .object({
      stateful: z.boolean().default(true),
      enableGet: z.literal(false).default(false),
      sessionTtlSeconds: z.number().int().min(60).max(86_400).default(3_600),
    })
    .strict()
    .default({
      stateful: true,
      enableGet: false,
      sessionTtlSeconds: 3_600,
    }),
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
  errorCodeMap: mockMcpErrorCodeMapSchema,
};

type MockMcpServerValidationInput = {
  readonly tools: readonly MockMcpToolSpec[];
  readonly resources: readonly MockMcpResourceSpec[];
  readonly resourceTemplates: readonly MockMcpResourceTemplateSpec[];
  readonly prompts: readonly MockMcpPromptSpec[];
  readonly errorCodeMap: Readonly<Record<string, number>>;
};

const configuredBehaviorErrorCodes = (
  server: MockMcpServerValidationInput
): ReadonlySet<string> => {
  const codes = new Set<string>();
  const pending: BehaviorSpec[] = [
    ...server.tools.map(({ behavior }) => behavior),
    ...server.resources.map(({ behavior }) => behavior),
    ...server.resourceTemplates.map(({ behavior }) => behavior),
    ...server.prompts.map(({ behavior }) => behavior),
  ];

  while (pending.length > 0) {
    const behavior = pending.pop();
    if (!behavior) continue;
    switch (behavior.type) {
      case "error":
        codes.add(behavior.code);
        break;
      case "sequence":
        pending.push(...behavior.steps);
        break;
      case "match":
        pending.push(...behavior.cases.map(({ behavior: branch }) => branch));
        if (behavior.fallback) pending.push(behavior.fallback);
        break;
      case "script":
        if (behavior.fallback) pending.push(behavior.fallback);
        break;
      case "static":
      case "template":
        break;
    }
  }
  return codes;
};

const validateMockMcpServer = (
  server: MockMcpServerValidationInput,
  context: z.core.$RefinementCtx
): void => {
  uniqueBy(server.tools, (value) => value.name, context, ["tools"], "tools");
  uniqueBy(server.resources, (value) => value.uri, context, ["resources"], "resources");
  uniqueBy(
    server.resourceTemplates,
    (value) => value.uriTemplate,
    context,
    ["resourceTemplates"],
    "resourceTemplates"
  );
  uniqueBy(server.prompts, (value) => value.name, context, ["prompts"], "prompts");
  for (const [promptIndex, prompt] of server.prompts.entries()) {
    uniqueBy(
      prompt.arguments,
      (value) => value.name,
      context,
      ["prompts", promptIndex, "arguments"],
      `prompts.${promptIndex}.arguments`
    );
  }

  const configuredCodes = configuredBehaviorErrorCodes(server);
  const mappedCodes = Object.keys(server.errorCodeMap);
  for (const code of configuredCodes) {
    if (!Object.hasOwn(server.errorCodeMap, code)) {
      context.addIssue({
        code: "custom",
        message: `Behavior error ${code} requires an errorCodeMap entry.`,
        path: ["errorCodeMap", code],
      });
    }
  }
  for (const code of mappedCodes) {
    if (!configuredCodes.has(code)) {
      context.addIssue({
        code: "custom",
        message: `errorCodeMap entry ${code} is not used by a configured behavior.`,
        path: ["errorCodeMap", code],
      });
    }
  }

  const codeOwners = new Map<number, string>();
  for (const [name, code] of Object.entries(server.errorCodeMap)) {
    const owner = codeOwners.get(code);
    if (owner !== undefined) {
      context.addIssue({
        code: "custom",
        message: `Configured errors ${owner} and ${name} cannot share JSON-RPC code ${code}.`,
        path: ["errorCodeMap", name],
      });
    } else {
      codeOwners.set(code, name);
    }
  }
};

const mockMcpServerSpecObjectSchema = z
  .object({
    ...mockMcpServerCommonShape,
    authentication: mockMcpAuthenticationSpecSchema,
  })
  .strict()
  .superRefine(validateMockMcpServer);
export const mockMcpServerSpecSchema = z.preprocess((input) => {
  assertMockMcpSpecSize(input);
  return input;
}, mockMcpServerSpecObjectSchema);
export type MockMcpServerSpec = z.infer<typeof mockMcpServerSpecSchema>;

const mockMcpServerWriteObjectSchema = z
  .object({
    ...mockMcpServerCommonShape,
    authentication: mockMcpAuthenticationWriteSchema,
  })
  .strict()
  .superRefine(validateMockMcpServer);
export const mockMcpServerWriteSchema = z.preprocess((input) => {
  assertMockMcpSpecSize(input);
  return input;
}, mockMcpServerWriteObjectSchema);
export type MockMcpServerWrite = z.infer<typeof mockMcpServerWriteSchema>;

const mockMcpServerPublicSpecObjectSchema = z
  .object({
    ...mockMcpServerCommonShape,
    authentication: mockMcpAuthenticationViewSchema,
  })
  .strict()
  .superRefine(validateMockMcpServer);
export const mockMcpServerPublicSpecSchema = z.preprocess((input) => {
  assertMockMcpSpecSize(input);
  return input;
}, mockMcpServerPublicSpecObjectSchema);
export type MockMcpServerPublicSpec = z.infer<typeof mockMcpServerPublicSpecSchema>;

export const mockMcpServerRecordSchema = z
  .object({
    spec: mockMcpServerSpecSchema,
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockMcpServerRecord = z.infer<typeof mockMcpServerRecordSchema>;

export const mockMcpServerViewSchema = z
  .object({
    spec: mockMcpServerPublicSpecSchema,
    revision: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockMcpServerView = z.infer<typeof mockMcpServerViewSchema>;

export const mockMcpServerSummarySchema = z
  .object({
    slug: mockMcpSlugSchema,
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    revision: z.number().int().min(1),
    toolCount: z.number().int().min(0).max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND),
    resourceCount: z.number().int().min(0).max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND),
    resourceTemplateCount: z
      .number()
      .int()
      .min(0)
      .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND),
    promptCount: z.number().int().min(0).max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND),
    stateful: z.boolean(),
    getEnabled: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockMcpServerSummary = z.infer<typeof mockMcpServerSummarySchema>;

export const mockMcpServerListSchema = z
  .object({
    servers: z.array(mockMcpServerSummarySchema).max(MOCK_MCP_MAX_SERVERS),
  })
  .strict();
export type MockMcpServerList = z.infer<typeof mockMcpServerListSchema>;

export const mockMcpDeleteServerResultSchema = z
  .object({
    slug: mockMcpSlugSchema,
    deleted: z.boolean(),
  })
  .strict();
export type MockMcpDeleteServerResult = z.infer<typeof mockMcpDeleteServerResultSchema>;

export const mockMcpResetStateResultSchema = z
  .object({
    slug: mockMcpSlugSchema,
    cleared: z.number().int().min(0),
  })
  .strict();
export type MockMcpResetStateResult = z.infer<typeof mockMcpResetStateResultSchema>;

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

export const toMockMcpServerView = (record: MockMcpServerRecord): MockMcpServerView =>
  mockMcpServerViewSchema.parse({
    spec: {
      version: record.spec.version,
      slug: record.spec.slug,
      serverInfo: record.spec.serverInfo,
      instructions: record.spec.instructions,
      transport: record.spec.transport,
      authentication:
        record.spec.authentication.mode === "none"
          ? { mode: "none" }
          : { mode: "bearer", configured: true },
      pageSize: record.spec.pageSize,
      tools: record.spec.tools,
      resources: record.spec.resources,
      resourceTemplates: record.spec.resourceTemplates,
      prompts: record.spec.prompts,
      errorCodeMap: record.spec.errorCodeMap,
    },
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });

export const assertMockMcpSpecSize = (input: unknown): void => {
  try {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_MCP_MAX_SPEC_BYTES,
      maximumDepth: MOCK_MCP_MAX_SPEC_DEPTH,
      maximumNodes: MOCK_MCP_MAX_SPEC_NODES,
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

export const parseMockMcpServerWrite = (input: unknown): MockMcpServerWrite => {
  return mockMcpServerWriteSchema.parse(input);
};

export type MockMcpBehaviorValue =
  | MockMcpToolResult
  | MockMcpReadResourceResult
  | MockMcpGetPromptResult
  | JsonValue;

export type MockMcpCapabilityBehavior = BehaviorSpec;
