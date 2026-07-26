import { z } from "zod";
import { assertBehaviorSpecBounds, jsonValueSchema } from "./behavior";
import {
  MOCK_LLM_MAX_SEGMENTS,
  MOCK_LLM_MAX_TOKEN_COUNT,
  MOCK_LLM_MAX_TOOL_NAME_LENGTH,
  mockLlmErrorKindSchema,
  mockLlmModelSchema,
  mockLlmStopReasonSchema,
} from "./mock-llm";
import {
  type MockLlmDeleteServerResult,
  type MockLlmServerList,
  type MockLlmServerView,
  mockLlmDialectSchema,
  mockLlmServerWriteSchema,
  mockLlmSlugSchema,
} from "./mock-llm-server";
import {
  type MockMcpDeleteServerResult,
  type MockMcpResetStateResult,
  type MockMcpServerList,
  type MockMcpServerView,
  mockMcpCapabilityNameSchema,
  mockMcpExpectedRevisionSchema,
  mockMcpRevisionSchema,
  mockMcpServerWriteSchema,
  mockMcpSlugSchema,
} from "./mock-mcp";
import {
  type getMockMcpBlueprintToolInputSchema,
  type listMockMcpBlueprintsToolInputSchema,
  type MockMcpBlueprint,
  type MockMcpBlueprintCatalog,
  type MockMcpBlueprintInstallResult,
  mockMcpBlueprintIdSchema,
} from "./mock-mcp-blueprint";
import type { ProvisioningRun, RunProvisioningCycleToolInput } from "./provisioning";

export * from "./mock-llm";
export * from "./mock-llm-server";
export * from "./mock-mcp";
export * from "./mock-mcp-blueprint";
export * from "./provisioning";
export * from "./scim";

export const providerIdSchema = z.enum(["entra", "okta"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const directoryUserStateSchema = z.enum([
  "staged",
  "active",
  "disabled",
  "suspended",
  "deprovisioned",
  "deleted",
]);
export type DirectoryUserState = z.infer<typeof directoryUserStateSchema>;

export const lifecycleActionSchema = z.enum([
  "activate",
  "disable",
  "reactivate",
  "suspend",
  "unsuspend",
  "deprovision",
  "delete",
]);
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;

export const environmentIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]+$/);

export const environmentConfigSchema = z
  .object({
    id: environmentIdSchema,
    name: z.string().trim().min(1).max(80),
    provider: providerIdSchema,
    seed: z.string().min(1).max(256),
    tenantId: z.uuid(),
    createdAt: z.iso.datetime(),
    idleTtlHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(24 * 7),
    requestLogLimit: z.number().int().min(100).max(100_000).default(10_000),
  })
  .strict();
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

export const seedUserSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    externalId: z.string().min(1).max(256).optional(),
    userName: z.string().trim().min(1).max(320),
    displayName: z.string().trim().min(1).max(256),
    givenName: z.string().trim().min(1).max(128).optional(),
    familyName: z.string().trim().min(1).max(128).optional(),
    password: z.string().min(1).max(1024).default("Passw0rd!"),
    passwordState: z.enum(["valid", "expired", "reset_required"]).default("valid"),
    active: z.boolean().default(true),
    mfaState: z.enum(["none", "enrolled", "required"]).default("none"),
    roles: z.array(z.string().min(1).max(128)).max(100).default([]),
  })
  .strict();
export type SeedUser = z.infer<typeof seedUserSchema>;

export const seedGroupSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    externalId: z.string().min(1).max(256).optional(),
    displayName: z.string().trim().min(1).max(256),
    members: z.array(z.string().min(1).max(320)).max(10_000).default([]),
  })
  .strict();
export type SeedGroup = z.infer<typeof seedGroupSchema>;

export const identitySeedSchema = z
  .object({
    users: z.array(seedUserSchema).max(10_000).default([]),
    groups: z.array(seedGroupSchema).max(10_000).default([]),
  })
  .strict();
export type IdentitySeed = z.infer<typeof identitySeedSchema>;

export const oauthClientTypeSchema = z.enum(["confidential", "public"]);
export type OAuthClientType = z.infer<typeof oauthClientTypeSchema>;

const oauthGrantTypeSchema = z.enum([
  "authorization_code",
  "refresh_token",
  "client_credentials",
  "urn:ietf:params:oauth:grant-type:device_code",
]);
const publicOAuthGrantTypeSchema = z.enum([
  "authorization_code",
  "refresh_token",
  "urn:ietf:params:oauth:grant-type:device_code",
]);
const defaultApplicationGrantTypes = ["authorization_code", "refresh_token"] as const;
const applicationNameSchema = z.string().trim().min(1).max(120);
const applicationRedirectUrisSchema = z.array(z.url()).min(1).max(50);
const applicationAppRolesSchema = z.array(z.string().min(1).max(128)).max(100);
const applicationGroupClaimsModeSchema = z.enum(["none", "security", "all"]);
const applicationInputShape = {
  name: applicationNameSchema,
  clientId: z.string().min(3).max(256).optional(),
  clientType: oauthClientTypeSchema.default("confidential"),
  clientSecret: z.string().min(8).max(1024).optional(),
  redirectUris: applicationRedirectUrisSchema,
  grantTypes: z
    .array(oauthGrantTypeSchema)
    .min(1)
    .default([...defaultApplicationGrantTypes]),
  appRoles: applicationAppRolesSchema.default([]),
  groupClaimsMode: applicationGroupClaimsModeSchema.default("none"),
} as const;
const applicationInputObjectSchema = z.object(applicationInputShape).strict();
type RawCreateApplicationInput = z.input<typeof applicationInputObjectSchema>;
type ApplicationInputCommon = Omit<
  RawCreateApplicationInput,
  "clientType" | "clientSecret" | "grantTypes"
>;
type PublicGrantType = z.infer<typeof publicOAuthGrantTypeSchema>;
type OAuthGrantType = z.infer<typeof oauthGrantTypeSchema>;
type GroupClaimsMode = z.infer<typeof applicationGroupClaimsModeSchema>;

export type CreateApplicationInput =
  | (ApplicationInputCommon & {
      clientType: "public";
      grantTypes?: PublicGrantType[];
    })
  | (ApplicationInputCommon & {
      clientType?: "confidential";
      clientSecret?: string;
      grantTypes?: OAuthGrantType[];
    });

type NormalizedApplicationInputCommon = Omit<
  ApplicationInputCommon,
  "appRoles" | "groupClaimsMode"
> & {
  appRoles: string[];
  groupClaimsMode: GroupClaimsMode;
};
type NormalizedCreateApplicationInput =
  | (NormalizedApplicationInputCommon & {
      clientType: "public";
      grantTypes: PublicGrantType[];
    })
  | (NormalizedApplicationInputCommon & {
      clientType: "confidential";
      clientSecret?: string;
      grantTypes: OAuthGrantType[];
    });

const validateApplicationAuthentication = (
  input: RawCreateApplicationInput,
  context: z.RefinementCtx
) => {
  if (input.clientType !== "public") return;
  if (input.clientSecret !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["clientSecret"],
      message: "Public OAuth clients must not configure a client secret.",
    });
  }
  if (input.grantTypes?.includes("client_credentials")) {
    context.addIssue({
      code: "custom",
      path: ["grantTypes"],
      message: "Public OAuth clients cannot use client_credentials.",
    });
  }
};

const applicationInputConditionalJsonSchema = {
  allOf: [
    {
      if: {
        properties: { clientType: { const: "public" } },
        required: ["clientType"],
      },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the JSON Schema conditional keyword.
      then: {
        not: { required: ["clientSecret"] },
        properties: {
          grantTypes: {
            items: {
              enum: [...publicOAuthGrantTypeSchema.options],
            },
          },
        },
      },
    },
  ],
};

export const createApplicationInputSchema = applicationInputObjectSchema
  .superRefine(validateApplicationAuthentication)
  .meta(applicationInputConditionalJsonSchema) as z.ZodType<
  NormalizedCreateApplicationInput,
  CreateApplicationInput
>;

const applicationRegistrationCommonShape = {
  name: applicationNameSchema,
  id: z.string().min(1),
  clientId: z.string().min(3),
  redirectUris: applicationRedirectUrisSchema,
  appRoles: applicationAppRolesSchema,
  groupClaimsMode: applicationGroupClaimsModeSchema,
  createdAt: z.iso.datetime(),
} as const;
const confidentialApplicationRegistrationSchema = z
  .object({
    ...applicationRegistrationCommonShape,
    clientType: z.literal("confidential"),
    clientSecret: z.string().min(8),
    grantTypes: z.array(oauthGrantTypeSchema).min(1),
  })
  .strict();
const publicApplicationRegistrationSchema = z
  .object({
    ...applicationRegistrationCommonShape,
    clientType: z.literal("public"),
    grantTypes: z.array(publicOAuthGrantTypeSchema).min(1),
  })
  .strict();

export const applicationRegistrationSchema = z.discriminatedUnion("clientType", [
  confidentialApplicationRegistrationSchema,
  publicApplicationRegistrationSchema,
]);
export type ApplicationRegistration = z.infer<typeof applicationRegistrationSchema>;

/** Persisted application metadata. Client secrets are creation-only. */
export const applicationSummarySchema = z.discriminatedUnion("clientType", [
  z
    .object({
      ...applicationRegistrationCommonShape,
      clientType: z.literal("confidential"),
      grantTypes: z.array(oauthGrantTypeSchema).min(1),
    })
    .strict(),
  z
    .object({
      ...applicationRegistrationCommonShape,
      clientType: z.literal("public"),
      grantTypes: z.array(publicOAuthGrantTypeSchema).min(1),
    })
    .strict(),
]);
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

export const semanticErrorCodeSchema = z.enum([
  "BAD_CLIENT_SECRET",
  "BAD_REDIRECT_URI",
  "CODE_ALREADY_REDEEMED",
  "INVALID_AUTHORIZATION_CODE",
  "INVALID_GRANT",
  "INVALID_REQUEST",
  "INVALID_SCOPE",
  "LOCKED_OUT",
  "MFA_REQUIRED",
  "PASSWORD_EXPIRED",
  "RATE_LIMITED",
  "UNSUPPORTED_GRANT",
  "USER_DISABLED",
]);
export type SemanticErrorCode = z.infer<typeof semanticErrorCodeSchema>;

export const SCIM_BEFORE_COMMIT_INJECTION_POINT = "scim.before_commit" as const;
export const SCIM_PATCH_PARSE_INJECTION_POINT = "scim.patch_parse" as const;

export const scimPatchToleranceCaseSchema = z.enum([
  "missing_schemas",
  "singleton_operations",
]);
export type ScimPatchToleranceCase = z.infer<typeof scimPatchToleranceCaseSchema>;

export const scenarioActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delay"),
    milliseconds: z.number().int().min(1).max(30_000),
  }),
  z.object({ type: z.literal("error"), code: semanticErrorCodeSchema }),
  z.object({
    type: z.literal("mutate"),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("scim_conflict") }).strict(),
  z.object({ type: z.literal("scim_soft_delete_race") }).strict(),
  z
    .object({
      type: z.literal("scim_patch_tolerance"),
      malformedCase: scimPatchToleranceCaseSchema,
    })
    .strict(),
  z.object({ type: z.literal("rotate_signing_key") }).strict(),
  z
    .object({
      type: z.literal("token_clock_skew"),
      seconds: z.number().int().min(-86_400).max(86_400),
    })
    .strict(),
]);
export type ScenarioAction = z.infer<typeof scenarioActionSchema>;

const scenarioSpecObjectSchema = z
  .object({
    id: z.string().min(1).max(128),
    injectionPoint: z.string().min(1).max(128),
    action: scenarioActionSchema,
    probability: z.number().min(0).max(1).default(1),
    remaining: z.number().int().min(1).optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((scenario, context) => {
    const tokenAction =
      scenario.action.type === "rotate_signing_key" ||
      scenario.action.type === "token_clock_skew";
    if (tokenAction && scenario.injectionPoint !== "token.before_sign") {
      context.addIssue({
        code: "custom",
        path: ["injectionPoint"],
        message: `${scenario.action.type} is only valid at token.before_sign.`,
      });
    }
    if (scenario.injectionPoint === "token.before_sign" && !tokenAction) {
      context.addIssue({
        code: "custom",
        path: ["action", "type"],
        message: "token.before_sign requires rotate_signing_key or token_clock_skew.",
      });
    }
  });

type ScenarioInjectionLockInput = {
  readonly injectionPoint: string;
  readonly action: z.infer<typeof scenarioActionSchema>;
};

const enforceScenarioInjectionLock = (
  value: ScenarioInjectionLockInput,
  context: z.RefinementCtx
): void => {
  const internalAction = value.action.type;
  const expectedPoint =
    internalAction === "scim_conflict" || internalAction === "scim_soft_delete_race"
      ? SCIM_BEFORE_COMMIT_INJECTION_POINT
      : internalAction === "scim_patch_tolerance"
        ? SCIM_PATCH_PARSE_INJECTION_POINT
        : undefined;
  const internalPoint =
    value.injectionPoint === SCIM_BEFORE_COMMIT_INJECTION_POINT ||
    value.injectionPoint === SCIM_PATCH_PARSE_INJECTION_POINT;
  if (expectedPoint !== undefined && value.injectionPoint !== expectedPoint) {
    context.addIssue({
      code: "custom",
      path: ["injectionPoint"],
      message: `${internalAction} is locked to ${expectedPoint}.`,
    });
  } else if (expectedPoint === undefined && internalPoint) {
    context.addIssue({
      code: "custom",
      path: ["action"],
      message: `${value.injectionPoint} accepts only its typed SCIM action.`,
    });
  }
};

export const scenarioSpecSchema = scenarioSpecObjectSchema.superRefine(
  enforceScenarioInjectionLock
);
export type ScenarioSpec = z.infer<typeof scenarioSpecSchema>;

export const MAX_MANAGEMENT_LIST_PAGE_SIZE = 25;

export const managementListQuerySchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_MANAGEMENT_LIST_PAGE_SIZE)
      .default(MAX_MANAGEMENT_LIST_PAGE_SIZE),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ManagementListQuery = z.infer<typeof managementListQuerySchema>;

export const applicationListPageSchema = z
  .object({
    applications: z.array(applicationSummarySchema).max(MAX_MANAGEMENT_LIST_PAGE_SIZE),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ApplicationListPage = z.infer<typeof applicationListPageSchema>;

export const scenarioListPageSchema = z
  .object({
    scenarios: z.array(scenarioSpecSchema).max(MAX_MANAGEMENT_LIST_PAGE_SIZE),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type ScenarioListPage = z.infer<typeof scenarioListPageSchema>;

export const requestLogSourceSchema = z.enum(["inbound", "outbound", "control"]);
export const requestLogProviderSchema = z.union([
  providerIdSchema,
  z.literal("mcp"),
  mockLlmDialectSchema,
]);
export const requestLogProtocolSchema = z.enum(["http", "mcp"]);
export const requestLogLlmOperationSchema = z.enum([
  "chat.completions.create",
  "messages.create",
]);
export type RequestLogLlmOperation = z.infer<typeof requestLogLlmOperationSchema>;
export const requestLogLlmOutcomeSchema = z.enum([
  "pending",
  "completed",
  "cancelled",
  "deadline_exceeded",
  "failed",
]);
export type RequestLogLlmOutcome = z.infer<typeof requestLogLlmOutcomeSchema>;
/**
 * Legacy request_log columns are non-null. Pending LLM reservations use these
 * explicit compatibility sentinels; they are not delivered response metadata.
 */
export const REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS = 102;
export const REQUEST_LOG_LLM_PENDING_DURATION_MS = 0;
export const requestLogLlmTerminalOutcomeSchema = z.enum([
  "completed",
  "cancelled",
  "deadline_exceeded",
  "failed",
]);
export type RequestLogLlmTerminalOutcome = z.infer<
  typeof requestLogLlmTerminalOutcomeSchema
>;
export const requestLogLlmToolNamesSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(MOCK_LLM_MAX_TOOL_NAME_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/)
  )
  .max(MOCK_LLM_MAX_SEGMENTS);
export type RequestLogLlmToolNames = z.infer<typeof requestLogLlmToolNamesSchema>;
export const requestLogLlmFinalizationSchema = z
  .object({
    llmOutcome: requestLogLlmTerminalOutcomeSchema,
    responseStatus: z.number().int().min(100).max(599),
    durationMs: z.number().int().min(0),
  })
  .strict();
export type RequestLogLlmFinalization = z.infer<typeof requestLogLlmFinalizationSchema>;
export const REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH = 256;
const requestLogMcpArgumentsValueSchema = z.record(
  z.string().min(1).max(REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH),
  jsonValueSchema
);
export const requestLogMcpArgumentsSchema: z.ZodType<Record<string, unknown>> =
  z.preprocess((input) => {
    if (input !== undefined) {
      assertBehaviorSpecBounds(input, {
        maximumBytes: 256 * 1024,
        maximumDepth: 32,
        maximumNodes: 20_000,
      });
    }
    return input;
  }, requestLogMcpArgumentsValueSchema);
export const requestLogEntrySchema = z
  .object({
    id: z.string().min(1),
    timestamp: z.iso.datetime(),
    source: requestLogSourceSchema,
    provider: requestLogProviderSchema,
    protocol: requestLogProtocolSchema.optional(),
    method: z.string().min(1),
    path: z.string().min(1),
    requestHeaders: z.record(z.string(), z.string()),
    requestBody: z.string().nullable(),
    responseStatus: z.number().int().min(100).max(599),
    responseHeaders: z.record(z.string(), z.string()),
    responseBody: z.string().nullable(),
    durationMs: z.number().int().min(0),
    correlationId: z.string().min(1),
    mcpMethod: z.string().min(1).max(256).optional(),
    mcpTool: mockMcpCapabilityNameSchema.optional(),
    mcpArguments: requestLogMcpArgumentsSchema.optional(),
    mcpErrorCode: z.number().int().min(-32_800).max(32_767).optional(),
    mcpToolIsError: z.boolean().optional(),
    llmDialect: mockLlmDialectSchema.optional(),
    llmOperation: requestLogLlmOperationSchema.optional(),
    llmServerSlug: mockLlmSlugSchema.optional(),
    llmServerRevision: z.number().int().safe().min(1).optional(),
    llmModel: mockLlmModelSchema.optional(),
    llmStream: z.boolean().optional(),
    llmTurnIndex: z.number().int().safe().min(0).optional(),
    llmOutcome: requestLogLlmOutcomeSchema.optional(),
    llmResponseId: z.string().min(1).max(128).optional(),
    llmInputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT).optional(),
    llmOutputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT).optional(),
    llmStopReason: mockLlmStopReasonSchema.optional(),
    llmToolNames: requestLogLlmToolNamesSchema.optional(),
    llmErrorKind: mockLlmErrorKindSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    const hasMcpMetadata =
      entry.mcpMethod !== undefined ||
      entry.mcpTool !== undefined ||
      entry.mcpArguments !== undefined ||
      entry.mcpErrorCode !== undefined ||
      entry.mcpToolIsError !== undefined;
    if (hasMcpMetadata && entry.protocol !== "mcp") {
      context.addIssue({
        code: "custom",
        message: "MCP request metadata requires protocol mcp.",
        path: ["protocol"],
      });
    }
    if (
      (entry.mcpTool !== undefined ||
        entry.mcpArguments !== undefined ||
        entry.mcpToolIsError !== undefined) &&
      entry.mcpMethod !== "tools/call"
    ) {
      context.addIssue({
        code: "custom",
        message: "MCP tool metadata requires method tools/call.",
        path: ["mcpMethod"],
      });
    }

    const llmCoreFields = [
      "llmDialect",
      "llmOperation",
      "llmServerSlug",
      "llmServerRevision",
      "llmModel",
      "llmStream",
      "llmTurnIndex",
      "llmOutcome",
    ] as const;
    const llmResponseFields = [
      "llmInputTokens",
      "llmOutputTokens",
      "llmStopReason",
      "llmToolNames",
    ] as const;
    const hasAnyLlmMetadata =
      llmCoreFields.some((field) => entry[field] !== undefined) ||
      llmResponseFields.some((field) => entry[field] !== undefined) ||
      entry.llmResponseId !== undefined ||
      entry.llmErrorKind !== undefined;
    const hasAllLlmCoreMetadata = llmCoreFields.every(
      (field) => entry[field] !== undefined
    );
    const hasAnyLlmResponseMetadata = llmResponseFields.some(
      (field) => entry[field] !== undefined
    );
    const hasAllLlmResponseMetadata = llmResponseFields.every(
      (field) => entry[field] !== undefined
    );

    if (hasAnyLlmMetadata && !hasAllLlmCoreMetadata) {
      context.addIssue({
        code: "custom",
        message: "LLM request metadata requires every core LLM field.",
        path: ["llmDialect"],
      });
    }
    if (
      entry.llmOutcome === "pending" &&
      (entry.responseStatus !== REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS ||
        entry.durationMs !== REQUEST_LOG_LLM_PENDING_DURATION_MS)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pending LLM request metadata requires compatibility status and duration sentinels.",
        path: ["responseStatus"],
      });
    }
    if (
      hasAnyLlmMetadata &&
      !(
        (hasAllLlmResponseMetadata &&
          entry.llmResponseId !== undefined &&
          entry.llmErrorKind === undefined) ||
        (!hasAnyLlmResponseMetadata &&
          entry.llmResponseId === undefined &&
          entry.llmErrorKind !== undefined)
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "LLM request metadata requires either a complete response plan with response ID or one error kind without response ID.",
        path: ["llmInputTokens"],
      });
    }
    if (
      hasAnyLlmMetadata &&
      (entry.provider !== entry.llmDialect || entry.protocol !== "http")
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM request metadata requires matching provider and HTTP protocol.",
        path: ["provider"],
      });
    }
    if (
      hasAnyLlmMetadata &&
      ((entry.llmDialect === "openai" &&
        entry.llmOperation !== "chat.completions.create") ||
        (entry.llmDialect === "anthropic" && entry.llmOperation !== "messages.create"))
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM operation must match its provider dialect.",
        path: ["llmOperation"],
      });
    }
    if (
      hasAnyLlmMetadata &&
      (entry.source !== "inbound" ||
        entry.method.trim().toUpperCase() !== "POST" ||
        Object.keys(entry.requestHeaders).length !== 0 ||
        entry.requestBody !== null ||
        Object.keys(entry.responseHeaders).length !== 0 ||
        entry.responseBody !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Structured LLM observations require inbound POST metadata without headers or bodies.",
        path: ["requestBody"],
      });
    }
    if (
      hasAnyLlmMetadata &&
      (entry.mcpMethod !== undefined ||
        entry.mcpTool !== undefined ||
        entry.mcpArguments !== undefined ||
        entry.mcpErrorCode !== undefined ||
        entry.mcpToolIsError !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "LLM and MCP request metadata are mutually exclusive.",
        path: ["mcpMethod"],
      });
    }
    if (
      (entry.provider === "openai" || entry.provider === "anthropic") &&
      !hasAnyLlmMetadata
    ) {
      context.addIssue({
        code: "custom",
        message: "An LLM provider requires structured LLM request metadata.",
        path: ["llmDialect"],
      });
    }
  });
export type RequestLogEntry = z.infer<typeof requestLogEntrySchema>;
export type RequestLogLlmReservation = Omit<
  RequestLogEntry,
  "durationMs" | "llmOutcome" | "responseStatus"
> & {
  readonly llmOutcome: "pending";
};

const assertionMethodSchema = z.string().trim().min(1).max(32);
const assertionPathSchema = z.string().min(1).max(2048);
const assertionBodyIncludesSchema = z.string().min(1).max(8192);
const assertionMcpMethodSchema = z.string().min(1).max(256);
const requestLogLlmMatcherShape = {
  llmDialect: mockLlmDialectSchema.optional(),
  llmOperation: requestLogLlmOperationSchema.optional(),
  llmServerSlug: mockLlmSlugSchema.optional(),
  llmServerRevision: z.number().int().safe().min(1).optional(),
  llmModel: mockLlmModelSchema.optional(),
  llmStream: z.boolean().optional(),
  llmTurnIndex: z.number().int().safe().min(0).optional(),
  llmOutcome: requestLogLlmOutcomeSchema.optional(),
  llmResponseId: z.string().min(1).max(128).optional(),
  llmInputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT).optional(),
  llmOutputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT).optional(),
  llmStopReason: mockLlmStopReasonSchema.optional(),
  llmToolNames: requestLogLlmToolNamesSchema.optional(),
  llmErrorKind: mockLlmErrorKindSchema.optional(),
} as const;

const assertionCountSchema = z
  .object({
    atLeast: z.number().int().min(0).optional(),
    atMost: z.number().int().min(0).optional(),
    exactly: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((count, context) => {
    if (
      count.atLeast === undefined &&
      count.atMost === undefined &&
      count.exactly === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "An assertion count must contain atLeast, atMost, or exactly.",
      });
    }
    if (
      count.exactly !== undefined &&
      (count.atLeast !== undefined || count.atMost !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "exactly cannot be combined with atLeast or atMost.",
      });
    }
    if (
      count.atLeast !== undefined &&
      count.atMost !== undefined &&
      count.atLeast > count.atMost
    ) {
      context.addIssue({
        code: "custom",
        message: "atLeast cannot be greater than atMost.",
      });
    }
  });

export const assertionSequenceStepSchema = z
  .object({
    source: requestLogSourceSchema.optional(),
    method: assertionMethodSchema.optional(),
    path: assertionPathSchema.optional(),
    status: z.number().int().min(100).max(599).optional(),
    bodyIncludes: assertionBodyIncludesSchema.optional(),
    responseBodyIncludes: assertionBodyIncludesSchema.optional(),
    mcpMethod: assertionMcpMethodSchema.optional(),
    mcpTool: mockMcpCapabilityNameSchema.optional(),
    mcpArguments: requestLogMcpArgumentsSchema.optional(),
    ...requestLogLlmMatcherShape,
  })
  .strict()
  .refine((step) => Object.values(step).some((value) => value !== undefined), {
    message: "Each assertion sequence step must contain at least one matcher.",
  });
export type AssertionSequenceStep = z.infer<typeof assertionSequenceStepSchema>;

export const assertionSpecSchema = z
  .object({
    source: requestLogSourceSchema.optional(),
    method: assertionMethodSchema.optional(),
    path: assertionPathSchema.optional(),
    status: z.number().int().min(100).max(599).optional(),
    bodyIncludes: assertionBodyIncludesSchema.optional(),
    responseBodyIncludes: assertionBodyIncludesSchema.optional(),
    mcpMethod: assertionMcpMethodSchema.optional(),
    mcpTool: mockMcpCapabilityNameSchema.optional(),
    mcpArguments: requestLogMcpArgumentsSchema.optional(),
    ...requestLogLlmMatcherShape,
    sequence: z.array(assertionSequenceStepSchema).min(2).max(100).optional(),
    count: assertionCountSchema.default({ atLeast: 1 }),
  })
  .strict();
export type AssertionSpec = z.infer<typeof assertionSpecSchema>;

export const assertionResultSchema = z
  .object({
    pass: z.boolean(),
    matched: z.number().int().min(0),
    message: z.string(),
    requestIds: z.array(z.string()),
  })
  .strict();
export type AssertionResult = z.infer<typeof assertionResultSchema>;

export const responseMetaSchema = z.object({ requestId: z.string().min(1) }).strict();

export const envelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: responseMetaSchema }).strict();
export type Envelope<T> = { data: T; meta: z.infer<typeof responseMetaSchema> };

export const problemSchema = z
  .object({
    type: z.url(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .strict();
export type Problem = z.infer<typeof problemSchema>;

export const createEnvironmentToolInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    provider: providerIdSchema,
    seed: z.string().min(1).max(256).default("mockos"),
  })
  .strict();
export type CreateEnvironmentToolInput = z.infer<
  typeof createEnvironmentToolInputSchema
>;

export const emptyToolInputSchema = z.object({}).strict();

export const environmentRefToolInputSchema = z
  .object({ environmentId: environmentIdSchema.optional() })
  .strict();
export type EnvironmentRefToolInput = z.infer<typeof environmentRefToolInputSchema>;

export const environmentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    idleTtlHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .optional(),
    requestLogLimit: z.number().int().min(100).max(100_000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.idleTtlHours !== undefined ||
      input.requestLogLimit !== undefined,
    { message: "At least one environment setting is required." }
  );
export type EnvironmentPatch = z.infer<typeof environmentPatchSchema>;

export const configureEnvironmentToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    idleTtlHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .optional(),
    requestLogLimit: z.number().int().min(100).max(100_000).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.idleTtlHours !== undefined ||
      input.requestLogLimit !== undefined,
    { message: "At least one environment setting is required." }
  );
export type ConfigureEnvironmentToolInput = z.infer<
  typeof configureEnvironmentToolInputSchema
>;

export const seedIdentitiesToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    users: identitySeedSchema.shape.users,
    groups: identitySeedSchema.shape.groups,
  })
  .strict();
export type SeedIdentitiesToolInput = z.infer<typeof seedIdentitiesToolInputSchema>;

export const seedIdentitiesResultSchema = z
  .object({
    users: z.array(
      z.object({ id: z.string().min(1), userName: z.string().min(1) }).strict()
    ),
    groups: z.array(
      z.object({ id: z.string().min(1), displayName: z.string().min(1) }).strict()
    ),
  })
  .strict();
export type SeedIdentitiesResult = z.infer<typeof seedIdentitiesResultSchema>;

const createApplicationToolInputObjectSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...applicationInputShape,
  })
  .strict();
export type CreateApplicationToolInput = CreateApplicationInput & {
  environmentId?: string;
};
type NormalizedCreateApplicationToolInput = NormalizedCreateApplicationInput & {
  environmentId?: string;
};
export const createApplicationToolInputSchema = createApplicationToolInputObjectSchema
  .superRefine(validateApplicationAuthentication)
  .meta(applicationInputConditionalJsonSchema) as z.ZodType<
  NormalizedCreateApplicationToolInput,
  CreateApplicationToolInput
>;

export const brokenTokenVariantSchema = z.enum([
  "expired",
  "wrong_audience",
  "not_yet_valid",
  "bad_signature",
  "wrong_issuer",
]);
export type BrokenTokenVariant = z.infer<typeof brokenTokenVariantSchema>;

export const mintTokenRequestSchema = z
  .object({
    clientId: z.string().min(1),
    subject: z.string().min(1),
    audience: z.string().min(1).optional(),
    broken: brokenTokenVariantSchema.optional(),
  })
  .strict();
export type MintTokenRequest = z.infer<typeof mintTokenRequestSchema>;

export const mintTokenToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...mintTokenRequestSchema.shape,
  })
  .strict();
export type MintTokenToolInput = z.infer<typeof mintTokenToolInputSchema>;

export const mintedTokenSchema = z
  .object({
    token: z.string().min(1),
    tokenType: z.literal("Bearer"),
    expiresAt: z.iso.datetime(),
    claims: z.record(z.string(), z.unknown()),
    broken: brokenTokenVariantSchema.optional(),
  })
  .strict();
export type MintedToken = z.infer<typeof mintedTokenSchema>;

export const setScenarioToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...scenarioSpecObjectSchema.shape,
  })
  .strict()
  .superRefine(enforceScenarioInjectionLock);
export type SetScenarioToolInput = z.infer<typeof setScenarioToolInputSchema>;

export const clearScenarioToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    scenarioId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type ClearScenarioToolInput = z.infer<typeof clearScenarioToolInputSchema>;

export const clearScenarioResultSchema = z
  .object({ cleared: z.number().int().min(0) })
  .strict();
export type ClearScenarioResult = z.infer<typeof clearScenarioResultSchema>;

export const requestLogQuerySchema = z
  .object({
    source: requestLogSourceSchema.optional(),
    provider: requestLogProviderSchema.optional(),
    protocol: requestLogProtocolSchema.optional(),
    method: z.string().trim().min(1).max(32).optional(),
    path: z.string().min(1).max(2048).optional(),
    status: z.number().int().min(100).max(599).optional(),
    mcpMethod: assertionMcpMethodSchema.optional(),
    mcpTool: mockMcpCapabilityNameSchema.optional(),
    ...requestLogLlmMatcherShape,
    limit: z.number().int().min(1).max(1_000).default(100),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type RequestLogQuery = z.infer<typeof requestLogQuerySchema>;

export const getRequestLogToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...requestLogQuerySchema.shape,
  })
  .strict();
export type GetRequestLogToolInput = z.infer<typeof getRequestLogToolInputSchema>;

export const requestLogPageSchema = z
  .object({
    entries: z.array(requestLogEntrySchema),
    nextCursor: z.string().min(1).optional(),
  })
  .strict();
export type RequestLogPage = z.infer<typeof requestLogPageSchema>;

export const assertRequestsToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...assertionSpecSchema.shape,
  })
  .strict();
export type AssertRequestsToolInput = z.infer<typeof assertRequestsToolInputSchema>;

export const simulateLifecycleToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    userId: z.string().min(1).max(128),
    action: lifecycleActionSchema,
  })
  .strict();
export type SimulateLifecycleToolInput = z.infer<
  typeof simulateLifecycleToolInputSchema
>;

export const lifecycleRevocationResultSchema = z
  .object({
    accessTokens: z.number().int().min(0),
    refreshTokens: z.number().int().min(0),
  })
  .strict();

export const lifecycleResultSchema = z
  .object({
    userId: z.string().min(1).max(128),
    provider: providerIdSchema,
    action: lifecycleActionSchema,
    previousState: directoryUserStateSchema,
    currentState: directoryUserStateSchema,
    changed: z.boolean(),
    version: z.number().int().min(1),
    etag: z.string().regex(/^W\/"[1-9][0-9]*"$/),
    revoked: lifecycleRevocationResultSchema,
  })
  .strict();
export type LifecycleResult = z.infer<typeof lifecycleResultSchema>;

export const wellKnownUrlsSchema = z
  .object({
    issuer: z.url(),
    openidConfiguration: z.url(),
    authorizationEndpoint: z.url(),
    tokenEndpoint: z.url(),
    jwksUri: z.url(),
    scimBaseUrl: z.url(),
    graphBaseUrl: z.url().optional(),
    oktaApiBaseUrl: z.url().optional(),
    oktaAuthnEndpoint: z.url().optional(),
    userinfoEndpoint: z.url().optional(),
    introspectionEndpoint: z.url().optional(),
    revocationEndpoint: z.url().optional(),
    deviceAuthorizationEndpoint: z.url().optional(),
  })
  .strict();
export type WellKnownUrls = z.infer<typeof wellKnownUrlsSchema>;

// MCP validates tool input before the handler can register the bearer credential
// with its response redactor. Collapse every nested definition failure to one
// credential-free issue while retaining the complete public schema for discovery
// and forwarding the already-normalized value to the handler.
const secretSafeMockMcpServerWriteSchema = z.preprocess((input, context) => {
  try {
    const result = mockMcpServerWriteSchema.safeParse(input);
    if (result.success) return result.data;
  } catch {
    // Size/depth guards can throw before Zod constructs a regular issue.
  }
  context.addIssue({
    code: "custom",
    message: "The mock MCP server definition is invalid.",
  });
  return z.NEVER;
}, mockMcpServerWriteSchema);

const putMockMcpServerToolInputShape = {
  environmentId: environmentIdSchema.optional(),
  expectedRevision: mockMcpExpectedRevisionSchema,
  server: secretSafeMockMcpServerWriteSchema.nonoptional(),
};
const putMockMcpServerToolInputKeys = new Set(
  Object.keys(putMockMcpServerToolInputShape)
);
export const putMockMcpServerToolInputSchema = z
  .looseObject(putMockMcpServerToolInputShape)
  .superRefine((input, context) => {
    if (Object.keys(input).some((key) => !putMockMcpServerToolInputKeys.has(key))) {
      context.addIssue({
        code: "custom",
        message: "Unknown top-level mock MCP tool arguments are not allowed.",
      });
    }
  })
  .meta({ additionalProperties: false });
export type PutMockMcpServerToolInput = z.infer<typeof putMockMcpServerToolInputSchema>;

export const listMockMcpServersToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
  })
  .strict();
export type ListMockMcpServersToolInput = z.infer<
  typeof listMockMcpServersToolInputSchema
>;

export const mockMcpServerRefToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    slug: mockMcpSlugSchema,
  })
  .strict();
export type MockMcpServerRefToolInput = z.infer<typeof mockMcpServerRefToolInputSchema>;

export const getMockMcpServerToolInputSchema = mockMcpServerRefToolInputSchema;
export type GetMockMcpServerToolInput = MockMcpServerRefToolInput;

const mockMcpMutationRefToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    slug: mockMcpSlugSchema,
    expectedRevision: mockMcpRevisionSchema,
  })
  .strict();

export const deleteMockMcpServerToolInputSchema = mockMcpMutationRefToolInputSchema;
export type DeleteMockMcpServerToolInput = z.infer<
  typeof deleteMockMcpServerToolInputSchema
>;

export const resetMockMcpStateToolInputSchema = mockMcpMutationRefToolInputSchema;
export type ResetMockMcpStateToolInput = z.infer<
  typeof resetMockMcpStateToolInputSchema
>;

export const installMockMcpBlueprintToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    blueprintId: mockMcpBlueprintIdSchema,
    slug: mockMcpSlugSchema.optional(),
    expectedRevision: mockMcpExpectedRevisionSchema,
  })
  .strict();
export type InstallMockMcpBlueprintToolInput = z.infer<
  typeof installMockMcpBlueprintToolInputSchema
>;

export const mockLlmRevisionSchema = z.number().int().safe().min(1);
export type MockLlmRevision = z.infer<typeof mockLlmRevisionSchema>;

export const mockLlmExpectedRevisionSchema = z.union([z.null(), mockLlmRevisionSchema]);
export type MockLlmExpectedRevision = z.infer<typeof mockLlmExpectedRevisionSchema>;

const putMockLlmServerToolInputShape = {
  environmentId: environmentIdSchema.optional(),
  expectedRevision: mockLlmExpectedRevisionSchema,
  server: mockLlmServerWriteSchema.nonoptional(),
};
const putMockLlmServerToolInputKeys = new Set(
  Object.keys(putMockLlmServerToolInputShape)
);
export const putMockLlmServerToolInputSchema = z
  .looseObject(putMockLlmServerToolInputShape)
  .superRefine((input, context) => {
    if (Object.keys(input).some((key) => !putMockLlmServerToolInputKeys.has(key))) {
      context.addIssue({
        code: "custom",
        message: "Unknown top-level mock LLM tool arguments are not allowed.",
      });
    }
  })
  .meta({ additionalProperties: false });
export type PutMockLlmServerToolInput = z.infer<typeof putMockLlmServerToolInputSchema>;

export const listMockLlmServersToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
  })
  .strict();
export type ListMockLlmServersToolInput = z.infer<
  typeof listMockLlmServersToolInputSchema
>;

export const mockLlmServerRefToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    slug: mockLlmSlugSchema,
  })
  .strict();
export type MockLlmServerRefToolInput = z.infer<typeof mockLlmServerRefToolInputSchema>;

export const getMockLlmServerToolInputSchema = mockLlmServerRefToolInputSchema;
export type GetMockLlmServerToolInput = MockLlmServerRefToolInput;

export const deleteMockLlmServerToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    slug: mockLlmSlugSchema,
    expectedRevision: mockLlmRevisionSchema,
  })
  .strict();
export type DeleteMockLlmServerToolInput = z.infer<
  typeof deleteMockLlmServerToolInputSchema
>;

export const setCurrentEnvironmentToolInputSchema = z
  .object({ environmentId: environmentIdSchema.nullable() })
  .strict();
export type SetCurrentEnvironmentToolInput = z.infer<
  typeof setCurrentEnvironmentToolInputSchema
>;

export const currentEnvironmentCursorSchema = z
  .object({ environmentId: environmentIdSchema.nullable() })
  .strict();
export type CurrentEnvironmentCursor = z.infer<typeof currentEnvironmentCursorSchema>;

export const environmentListSchema = z
  .object({
    environments: z.array(environmentConfigSchema),
    currentEnvironmentId: environmentIdSchema.nullable(),
  })
  .strict();
export type EnvironmentList = z.infer<typeof environmentListSchema>;

export const deleteEnvironmentResultSchema = z
  .object({
    environmentId: environmentIdSchema,
    deleted: z.literal(true),
  })
  .strict();
export type DeleteEnvironmentResult = z.infer<typeof deleteEnvironmentResultSchema>;

export const mockosMcpToolNames = [
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
  "list_mock_mcp_blueprints",
  "get_mock_mcp_blueprint",
  "install_mock_mcp_blueprint",
  "put_mock_llm_server",
  "list_mock_llm_servers",
  "get_mock_llm_server",
  "delete_mock_llm_server",
] as const;
export type MockosMcpToolName = (typeof mockosMcpToolNames)[number];

export type MockosMcpToolInputs = {
  create_environment: CreateEnvironmentToolInput;
  list_environments: z.infer<typeof emptyToolInputSchema>;
  delete_environment: EnvironmentRefToolInput;
  configure_environment: ConfigureEnvironmentToolInput;
  seed_identities: SeedIdentitiesToolInput;
  create_application: CreateApplicationToolInput;
  run_provisioning_cycle: RunProvisioningCycleToolInput;
  mint_token: MintTokenToolInput;
  set_scenario: SetScenarioToolInput;
  clear_scenario: ClearScenarioToolInput;
  get_request_log: GetRequestLogToolInput;
  assert_requests: AssertRequestsToolInput;
  simulate_lifecycle: SimulateLifecycleToolInput;
  get_wellknown_urls: EnvironmentRefToolInput;
  set_current_environment: SetCurrentEnvironmentToolInput;
  put_mock_mcp_server: PutMockMcpServerToolInput;
  list_mock_mcp_servers: ListMockMcpServersToolInput;
  get_mock_mcp_server: GetMockMcpServerToolInput;
  delete_mock_mcp_server: DeleteMockMcpServerToolInput;
  reset_mock_mcp_state: ResetMockMcpStateToolInput;
  list_mock_mcp_blueprints: z.infer<typeof listMockMcpBlueprintsToolInputSchema>;
  get_mock_mcp_blueprint: z.infer<typeof getMockMcpBlueprintToolInputSchema>;
  install_mock_mcp_blueprint: InstallMockMcpBlueprintToolInput;
  put_mock_llm_server: PutMockLlmServerToolInput;
  list_mock_llm_servers: ListMockLlmServersToolInput;
  get_mock_llm_server: GetMockLlmServerToolInput;
  delete_mock_llm_server: DeleteMockLlmServerToolInput;
};

export type MockosMcpToolData = {
  create_environment: EnvironmentConfig;
  list_environments: EnvironmentList;
  delete_environment: DeleteEnvironmentResult;
  configure_environment: EnvironmentConfig;
  seed_identities: SeedIdentitiesResult;
  create_application: ApplicationRegistration;
  run_provisioning_cycle: ProvisioningRun;
  mint_token: MintedToken;
  set_scenario: ScenarioSpec;
  clear_scenario: ClearScenarioResult;
  get_request_log: RequestLogPage;
  assert_requests: AssertionResult;
  simulate_lifecycle: LifecycleResult;
  get_wellknown_urls: WellKnownUrls;
  set_current_environment: CurrentEnvironmentCursor;
  put_mock_mcp_server: MockMcpServerView;
  list_mock_mcp_servers: MockMcpServerList;
  get_mock_mcp_server: MockMcpServerView;
  delete_mock_mcp_server: MockMcpDeleteServerResult;
  reset_mock_mcp_state: MockMcpResetStateResult;
  list_mock_mcp_blueprints: MockMcpBlueprintCatalog;
  get_mock_mcp_blueprint: MockMcpBlueprint;
  install_mock_mcp_blueprint: MockMcpBlueprintInstallResult;
  put_mock_llm_server: MockLlmServerView;
  list_mock_llm_servers: MockLlmServerList;
  get_mock_llm_server: MockLlmServerView;
  delete_mock_llm_server: MockLlmDeleteServerResult;
};

export type MockosMcpToolOutputs = {
  [Name in MockosMcpToolName]: Envelope<MockosMcpToolData[Name]>;
};

export type MockosMcpToolResult<Name extends MockosMcpToolName> =
  | MockosMcpToolOutputs[Name]
  | Problem;

export type McpToolInput = MockosMcpToolInputs[keyof MockosMcpToolInputs];
