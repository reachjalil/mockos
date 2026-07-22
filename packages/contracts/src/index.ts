import { z } from "zod";
import type { ProvisioningRun, RunProvisioningCycleToolInput } from "./provisioning";

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

export const createApplicationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    clientId: z.string().min(3).max(256).optional(),
    clientSecret: z.string().min(8).max(1024).optional(),
    redirectUris: z.array(z.url()).min(1).max(50),
    grantTypes: z
      .array(
        z.enum([
          "authorization_code",
          "refresh_token",
          "client_credentials",
          "urn:ietf:params:oauth:grant-type:device_code",
        ])
      )
      .min(1)
      .default(["authorization_code", "refresh_token"]),
    appRoles: z.array(z.string().min(1).max(128)).max(100).default([]),
    groupClaimsMode: z.enum(["none", "security", "all"]).default("none"),
  })
  .strict();
export type CreateApplicationInput = z.infer<typeof createApplicationInputSchema>;

export const applicationRegistrationSchema = createApplicationInputSchema
  .omit({ clientId: true, clientSecret: true })
  .extend({
    id: z.string().min(1),
    clientId: z.string().min(3),
    clientSecret: z.string().min(8),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ApplicationRegistration = z.infer<typeof applicationRegistrationSchema>;

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

export const requestLogSourceSchema = z.enum(["inbound", "outbound", "control"]);
export const requestLogEntrySchema = z
  .object({
    id: z.string().min(1),
    timestamp: z.iso.datetime(),
    source: requestLogSourceSchema,
    provider: providerIdSchema,
    method: z.string().min(1),
    path: z.string().min(1),
    requestHeaders: z.record(z.string(), z.string()),
    requestBody: z.string().nullable(),
    responseStatus: z.number().int().min(100).max(599),
    responseHeaders: z.record(z.string(), z.string()),
    responseBody: z.string().nullable(),
    durationMs: z.number().int().min(0),
    correlationId: z.string().min(1),
  })
  .strict();
export type RequestLogEntry = z.infer<typeof requestLogEntrySchema>;

const assertionMethodSchema = z.string().trim().min(1).max(32);
const assertionPathSchema = z.string().min(1).max(2048);
const assertionBodyIncludesSchema = z.string().min(1).max(8192);

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

export const createApplicationToolInputSchema = z
  .object({
    environmentId: environmentIdSchema.optional(),
    ...createApplicationInputSchema.shape,
  })
  .strict();
export type CreateApplicationToolInput = z.infer<
  typeof createApplicationToolInputSchema
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
    provider: providerIdSchema.optional(),
    method: z.string().trim().min(1).max(32).optional(),
    path: z.string().min(1).max(2048).optional(),
    status: z.number().int().min(100).max(599).optional(),
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
};

export type MockosMcpToolOutputs = {
  [Name in MockosMcpToolName]: Envelope<MockosMcpToolData[Name]>;
};

export type MockosMcpToolResult<Name extends MockosMcpToolName> =
  | MockosMcpToolOutputs[Name]
  | Problem;

export type McpToolInput = MockosMcpToolInputs[keyof MockosMcpToolInputs];
