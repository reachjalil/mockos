import { z } from "zod";
import {
  assertBehaviorSpecBounds,
  type BehaviorSpec,
  behaviorSpecSchema,
} from "./behavior";
import {
  MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS,
  mockLlmCadenceDefaultsSchema,
  mockLlmErrorKindSchema,
  mockLlmModelSchema,
  parseMockLlmPlan,
  mockLlmResponseDirectiveSchema,
  mockLlmUsageSchema,
} from "./mock-llm";

export const MOCK_LLM_MAX_SERVERS = 64;
export const MOCK_LLM_MAX_MODELS = 64;
export const MOCK_LLM_MAX_SERVER_SPEC_BYTES = 256 * 1024;
export const MOCK_LLM_MAX_SERVER_SPEC_DEPTH = 24;
export const MOCK_LLM_MAX_SERVER_SPEC_NODES = 10_000;

export const mockLlmSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
export type MockLlmSlug = z.infer<typeof mockLlmSlugSchema>;

export const mockLlmDialectSchema = z.enum(["openai", "anthropic"]);
export type MockLlmDialect = z.infer<typeof mockLlmDialectSchema>;

export const mockLlmMockCredentialSchema = z
  .string()
  .min(16)
  .max(1_024)
  .regex(/^[A-Za-z0-9\-._~+/]+=*$/);
export type MockLlmMockCredential = z.infer<typeof mockLlmMockCredentialSchema>;

export const mockLlmAuthenticationWriteSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("accept_any") }).strict(),
  z
    .object({
      mode: z.literal("strict"),
      apiKey: mockLlmMockCredentialSchema,
    })
    .strict(),
]);
export type MockLlmAuthenticationWrite = z.infer<
  typeof mockLlmAuthenticationWriteSchema
>;

export const mockLlmAuthenticationSpecSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("accept_any") }).strict(),
  z
    .object({
      mode: z.literal("strict"),
      apiKeySha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type MockLlmAuthenticationSpec = z.infer<typeof mockLlmAuthenticationSpecSchema>;

export const mockLlmAuthenticationViewSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("accept_any") }).strict(),
  z
    .object({
      mode: z.literal("strict"),
      configured: z.literal(true),
    })
    .strict(),
]);
export type MockLlmAuthenticationView = z.infer<typeof mockLlmAuthenticationViewSchema>;

const disabledDialectSchema = z.object({ enabled: z.literal(false) }).strict();

const enabledDialectSchema = <Authentication extends z.ZodType>(
  authentication: Authentication
) =>
  z
    .object({
      enabled: z.literal(true),
      authentication,
    })
    .strict();

export const mockLlmDialectWriteSchema = z.discriminatedUnion("enabled", [
  disabledDialectSchema,
  enabledDialectSchema(mockLlmAuthenticationWriteSchema),
]);
export type MockLlmDialectWrite = z.infer<typeof mockLlmDialectWriteSchema>;

export const mockLlmDialectSpecSchema = z.discriminatedUnion("enabled", [
  disabledDialectSchema,
  enabledDialectSchema(mockLlmAuthenticationSpecSchema),
]);
export type MockLlmDialectSpec = z.infer<typeof mockLlmDialectSpecSchema>;

export const mockLlmDialectViewSchema = z.discriminatedUnion("enabled", [
  disabledDialectSchema,
  enabledDialectSchema(mockLlmAuthenticationViewSchema),
]);
export type MockLlmDialectView = z.infer<typeof mockLlmDialectViewSchema>;

const mockLlmDialectsWriteSchema = z
  .object({
    openai: mockLlmDialectWriteSchema,
    anthropic: mockLlmDialectWriteSchema,
  })
  .strict();

const mockLlmDialectsSpecSchema = z
  .object({
    openai: mockLlmDialectSpecSchema,
    anthropic: mockLlmDialectSpecSchema,
  })
  .strict();

const mockLlmDialectsViewSchema = z
  .object({
    openai: mockLlmDialectViewSchema,
    anthropic: mockLlmDialectViewSchema,
  })
  .strict();

export const mockLlmServerModelSchema = z
  .object({
    id: mockLlmModelSchema,
    displayName: z.string().trim().min(1).max(128),
    createdAtEpochSeconds: z.number().int().safe().min(0),
    behavior: behaviorSpecSchema,
  })
  .strict();
export type MockLlmServerModel = z.infer<typeof mockLlmServerModelSchema>;

const mockLlmServerCommonShape = {
  version: z.literal(1),
  slug: mockLlmSlugSchema,
  name: z.string().trim().min(1).max(128),
  models: z.array(mockLlmServerModelSchema).min(1).max(MOCK_LLM_MAX_MODELS),
  defaultUsage: mockLlmUsageSchema.default({
    inputTokens: 0,
    outputTokens: 0,
  }),
  defaultCadence: mockLlmCadenceDefaultsSchema.default({
    chunkDelayMilliseconds: 0,
    chunkSize: 256,
    maximumDurationMilliseconds: 60_000,
  }),
};

type MockLlmServerValidationInput = {
  readonly dialects: {
    readonly openai: { readonly enabled: boolean };
    readonly anthropic: { readonly enabled: boolean };
  };
  readonly models: readonly MockLlmServerModel[];
  readonly defaultUsage: z.infer<typeof mockLlmUsageSchema>;
  readonly defaultCadence: z.infer<typeof mockLlmCadenceDefaultsSchema>;
};

const addBehaviorIssue = (
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string
): void => {
  context.addIssue({
    code: "custom",
    path: [...path],
    message,
  });
};

const acceptsMockLlmPlan = (input: unknown): boolean => {
  try {
    parseMockLlmPlan(input);
    return true;
  } catch {
    return false;
  }
};

const validateMockLlmBehavior = (
  behavior: BehaviorSpec,
  model: MockLlmServerModel,
  server: Pick<MockLlmServerValidationInput, "defaultUsage" | "defaultCadence">,
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  parentDelayMilliseconds = 0
): void => {
  const maximumDelayMilliseconds = Math.min(
    MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS,
    parentDelayMilliseconds + (behavior.latency?.maximumMilliseconds ?? 0)
  );
  switch (behavior.type) {
    case "static": {
      if (typeof behavior.value === "string") {
        const accepted = acceptsMockLlmPlan({
          version: 1,
          kind: "response",
          planId: `llmp_${"A".repeat(43)}`,
          requestHash: "0".repeat(64),
          model: model.id,
          createdAtEpochSeconds: model.createdAtEpochSeconds,
          turnIndex: 0,
          seed: "mock-llm-server-contract",
          segments: [{ type: "text", text: behavior.value }],
          stopReason: "end_turn",
          usage: server.defaultUsage,
          cadence: {
            ...server.defaultCadence,
            initialDelayMilliseconds: maximumDelayMilliseconds,
          },
        });
        if (!accepted) {
          addBehaviorIssue(
            context,
            path,
            "Static LLM text must satisfy the neutral response-plan bounds."
          );
        }
        return;
      }

      const directive = mockLlmResponseDirectiveSchema.safeParse(behavior.value);
      if (!directive.success) {
        addBehaviorIssue(
          context,
          path,
          "A static LLM behavior must return text or a neutral response directive."
        );
        return;
      }
      const accepted = acceptsMockLlmPlan({
        version: 1,
        kind: "response",
        planId: `llmp_${"A".repeat(43)}`,
        requestHash: "0".repeat(64),
        model: model.id,
        createdAtEpochSeconds: model.createdAtEpochSeconds,
        turnIndex: 0,
        seed: "mock-llm-server-contract",
        ...directive.data,
        stopReason: directive.data.stopReason ?? "end_turn",
        usage: directive.data.usage ?? server.defaultUsage,
        cadence: {
          ...server.defaultCadence,
          ...directive.data.cadence,
          initialDelayMilliseconds: maximumDelayMilliseconds,
        },
      });
      if (!accepted) {
        addBehaviorIssue(
          context,
          path,
          "The static LLM response directive is not a valid neutral response plan."
        );
      }
      return;
    }
    case "error":
      if (!mockLlmErrorKindSchema.safeParse(behavior.code).success) {
        addBehaviorIssue(
          context,
          [...path, "code"],
          "An LLM behavior error must use a neutral mock LLM error kind."
        );
      }
      if (behavior.status !== undefined || behavior.details !== undefined) {
        addBehaviorIssue(
          context,
          path,
          "An LLM behavior error cannot contain provider HTTP status or detail fields."
        );
      }
      return;
    case "sequence":
      for (const [index, step] of behavior.steps.entries()) {
        validateMockLlmBehavior(
          step,
          model,
          server,
          context,
          [...path, "steps", index],
          maximumDelayMilliseconds
        );
      }
      return;
    case "match":
      for (const [index, branch] of behavior.cases.entries()) {
        validateMockLlmBehavior(
          branch.behavior,
          model,
          server,
          context,
          [...path, "cases", index, "behavior"],
          maximumDelayMilliseconds
        );
      }
      if (behavior.fallback) {
        validateMockLlmBehavior(
          behavior.fallback,
          model,
          server,
          context,
          [...path, "fallback"],
          maximumDelayMilliseconds
        );
      }
      return;
    case "script":
      if (behavior.onFailure !== "fallback" || !behavior.fallback) {
        addBehaviorIssue(
          context,
          path,
          "Until the F3 sandbox exists, an LLM script behavior requires an explicit declarative fallback."
        );
        return;
      }
      validateMockLlmBehavior(
        behavior.fallback,
        model,
        server,
        context,
        [...path, "fallback"],
        maximumDelayMilliseconds
      );
      return;
    case "template":
      if (
        maximumDelayMilliseconds > server.defaultCadence.maximumDurationMilliseconds
      ) {
        addBehaviorIssue(
          context,
          [...path, "latency"],
          "Cumulative LLM behavior latency cannot exceed the default maximum stream duration."
        );
      }
      return;
  }
};

const validateMockLlmServer = (
  server: MockLlmServerValidationInput,
  context: z.core.$RefinementCtx
): void => {
  if (!server.dialects.openai.enabled && !server.dialects.anthropic.enabled) {
    context.addIssue({
      code: "custom",
      path: ["dialects"],
      message: "At least one mock LLM dialect must be enabled.",
    });
  }

  const modelIds = new Set<string>();
  for (const [index, model] of server.models.entries()) {
    if (modelIds.has(model.id)) {
      context.addIssue({
        code: "custom",
        path: ["models", index, "id"],
        message: "Mock LLM model IDs must be unique.",
      });
    }
    modelIds.add(model.id);
    validateMockLlmBehavior(model.behavior, model, server, context, [
      "models",
      index,
      "behavior",
    ]);
  }
};

const unknownRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const valueAtPath = (root: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => unknownRecord(value)?.[key], root);

/**
 * Detects a raw strict Mock Credential copied outside its two write-only slots
 * before a nested validation issue can reflect it through MCP input errors.
 */
const containsMockLlmWriteCredentialCopy = (
  root: unknown,
  serverPath: readonly string[] = []
): boolean => {
  const server = valueAtPath(root, serverPath);
  const credentials = (["openai", "anthropic"] as const).flatMap((dialect) => {
    const authentication = unknownRecord(
      valueAtPath(server, ["dialects", dialect, "authentication"])
    );
    return typeof authentication?.apiKey === "string" &&
      authentication.apiKey.length > 0
      ? [authentication.apiKey]
      : [];
  });
  if (credentials.length === 0) return false;

  const allowedCredentialPaths = (["openai", "anthropic"] as const).flatMap(
    (dialect) => {
      const dialectValue = unknownRecord(valueAtPath(server, ["dialects", dialect]));
      const authentication = unknownRecord(dialectValue?.authentication);
      return dialectValue?.enabled === true && authentication?.mode === "strict"
        ? [[...serverPath, "dialects", dialect, "authentication", "apiKey"] as const]
        : [];
    }
  );
  const isCredentialSlot = (path: readonly string[]): boolean =>
    allowedCredentialPaths.some(
      (allowed) =>
        allowed.length === path.length &&
        allowed.every((segment, index) => segment === path[index])
    );

  const pending: Array<{ path: readonly string[]; value: unknown }> = [
    { path: [], value: root },
  ];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const { path, value } = current;
    if (typeof value === "string") {
      if (
        !isCredentialSlot(path) &&
        credentials.some((credential) => value.includes(credential))
      ) {
        return true;
      }
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (credentials.some((credential) => key.includes(credential))) return true;
      pending.push({ path: [...path, key], value: child });
    }
  }
  return false;
};

const strictWriteCredentials = (server: {
  readonly dialects: {
    readonly openai: MockLlmDialectWrite;
    readonly anthropic: MockLlmDialectWrite;
  };
}): string[] =>
  [server.dialects.openai, server.dialects.anthropic].flatMap((dialect) =>
    dialect.enabled && dialect.authentication.mode === "strict"
      ? [dialect.authentication.apiKey]
      : []
  );

const strictSpecVerifiers = (server: {
  readonly dialects: {
    readonly openai: MockLlmDialectSpec;
    readonly anthropic: MockLlmDialectSpec;
  };
}): string[] =>
  [server.dialects.openai, server.dialects.anthropic].flatMap((dialect) =>
    dialect.enabled && dialect.authentication.mode === "strict"
      ? [dialect.authentication.apiKeySha256]
      : []
  );

const containsCredential = (root: unknown, credentials: readonly string[]): boolean => {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (credentials.some((credential) => value.includes(credential))) return true;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (credentials.some((credential) => key.includes(credential))) return true;
      pending.push(child);
    }
  }
  return false;
};

const mockLlmServerWriteObjectSchema = z
  .object({
    ...mockLlmServerCommonShape,
    dialects: mockLlmDialectsWriteSchema,
  })
  .strict()
  .superRefine(validateMockLlmServer)
  .superRefine((server, context) => {
    const credentials = strictWriteCredentials(server);
    const { dialects: _dialects, ...safeMaterial } = server;
    if (credentials.length > 0 && containsCredential(safeMaterial, credentials)) {
      context.addIssue({
        code: "custom",
        path: ["dialects"],
        message:
          "A strict Mock Credential cannot be copied into returned server-definition material.",
      });
    }
  });

const mockLlmServerSpecObjectSchema = z
  .object({
    ...mockLlmServerCommonShape,
    dialects: mockLlmDialectsSpecSchema,
  })
  .strict()
  .superRefine(validateMockLlmServer)
  .superRefine((server, context) => {
    const verifiers = strictSpecVerifiers(server);
    const { dialects: _dialects, ...safeMaterial } = server;
    if (verifiers.length > 0 && containsCredential(safeMaterial, verifiers)) {
      context.addIssue({
        code: "custom",
        path: ["dialects"],
        message:
          "A strict Mock Credential verifier cannot be copied into returned server-definition material.",
      });
    }
  });

const mockLlmServerPublicSpecObjectSchema = z
  .object({
    ...mockLlmServerCommonShape,
    dialects: mockLlmDialectsViewSchema,
  })
  .strict()
  .superRefine(validateMockLlmServer);

export const assertMockLlmServerSpecBounds = (input: unknown): void => {
  try {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_LLM_MAX_SERVER_SPEC_BYTES,
      maximumDepth: MOCK_LLM_MAX_SERVER_SPEC_DEPTH,
      maximumNodes: MOCK_LLM_MAX_SERVER_SPEC_NODES,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    throw new Error(
      `Mock LLM server spec violates its ${MOCK_LLM_MAX_SERVER_SPEC_BYTES}-byte, depth, node, or key bound.${detail}`,
      { cause }
    );
  }
};

export const mockLlmServerWriteSchema = z.preprocess((input, context) => {
  assertMockLlmServerSpecBounds(input);
  if (containsMockLlmWriteCredentialCopy(input)) {
    context.addIssue({
      code: "custom",
      message:
        "A strict Mock Credential cannot be copied outside its write-only authentication field.",
    });
    return z.NEVER;
  }
  return input;
}, mockLlmServerWriteObjectSchema);
export type MockLlmServerWrite = z.infer<typeof mockLlmServerWriteSchema>;

export const mockLlmServerSpecSchema = z.preprocess((input) => {
  assertMockLlmServerSpecBounds(input);
  return input;
}, mockLlmServerSpecObjectSchema);
export type MockLlmServerSpec = z.infer<typeof mockLlmServerSpecSchema>;

export const mockLlmServerPublicSpecSchema = z.preprocess((input) => {
  assertMockLlmServerSpecBounds(input);
  return input;
}, mockLlmServerPublicSpecObjectSchema);
export type MockLlmServerPublicSpec = z.infer<typeof mockLlmServerPublicSpecSchema>;

export const mockLlmServerRecordSchema = z
  .object({
    spec: mockLlmServerSpecSchema,
    revision: z.number().int().safe().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockLlmServerRecord = z.infer<typeof mockLlmServerRecordSchema>;

export const mockLlmServerViewSchema = z
  .object({
    spec: mockLlmServerPublicSpecSchema,
    revision: z.number().int().safe().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockLlmServerView = z.infer<typeof mockLlmServerViewSchema>;

export const mockLlmServerSummarySchema = z
  .object({
    slug: mockLlmSlugSchema,
    name: z.string().trim().min(1).max(128),
    revision: z.number().int().safe().min(1),
    modelCount: z.number().int().min(1).max(MOCK_LLM_MAX_MODELS),
    enabledDialects: z
      .array(mockLlmDialectSchema)
      .min(1)
      .max(2)
      .refine((dialects) => new Set(dialects).size === dialects.length, {
        message: "Enabled mock LLM dialects must be unique.",
      }),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type MockLlmServerSummary = z.infer<typeof mockLlmServerSummarySchema>;

export const mockLlmServerListSchema = z
  .object({
    servers: z.array(mockLlmServerSummarySchema).max(MOCK_LLM_MAX_SERVERS),
  })
  .strict()
  .superRefine((list, context) => {
    const slugs = new Set<string>();
    for (const [index, server] of list.servers.entries()) {
      if (slugs.has(server.slug)) {
        context.addIssue({
          code: "custom",
          path: ["servers", index, "slug"],
          message: "Listed mock LLM server slugs must be unique.",
        });
      }
      slugs.add(server.slug);
    }
  });
export type MockLlmServerList = z.infer<typeof mockLlmServerListSchema>;

export const mockLlmDeleteServerResultSchema = z
  .object({
    slug: mockLlmSlugSchema,
    deleted: z.boolean(),
  })
  .strict();
export type MockLlmDeleteServerResult = z.infer<typeof mockLlmDeleteServerResultSchema>;

const authenticationView = (
  authentication: MockLlmAuthenticationSpec
): MockLlmAuthenticationView =>
  authentication.mode === "accept_any"
    ? { mode: "accept_any" }
    : { mode: "strict", configured: true };

const dialectView = (dialect: MockLlmDialectSpec): MockLlmDialectView =>
  dialect.enabled
    ? {
        enabled: true,
        authentication: authenticationView(dialect.authentication),
      }
    : { enabled: false };

export const toMockLlmServerView = (record: MockLlmServerRecord): MockLlmServerView =>
  mockLlmServerViewSchema.parse({
    spec: {
      version: record.spec.version,
      slug: record.spec.slug,
      name: record.spec.name,
      dialects: {
        openai: dialectView(record.spec.dialects.openai),
        anthropic: dialectView(record.spec.dialects.anthropic),
      },
      models: record.spec.models,
      defaultUsage: record.spec.defaultUsage,
      defaultCadence: record.spec.defaultCadence,
    },
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });

export const toMockLlmServerSummary = (
  record: MockLlmServerRecord
): MockLlmServerSummary =>
  mockLlmServerSummarySchema.parse({
    slug: record.spec.slug,
    name: record.spec.name,
    revision: record.revision,
    modelCount: record.spec.models.length,
    enabledDialects: (["openai", "anthropic"] as const).filter(
      (dialect) => record.spec.dialects[dialect].enabled
    ),
    updatedAt: record.updatedAt,
  });

export const parseMockLlmServerWrite = (input: unknown): MockLlmServerWrite =>
  mockLlmServerWriteSchema.parse(input);

export const parseMockLlmServerSpec = (input: unknown): MockLlmServerSpec =>
  mockLlmServerSpecSchema.parse(input);
