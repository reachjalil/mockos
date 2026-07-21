import { z } from "zod";

export const providerIdSchema = z.enum(["entra", "okta"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

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

export const scenarioActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delay"), milliseconds: z.number().int().min(1) }),
  z.object({ type: z.literal("error"), code: semanticErrorCodeSchema }),
  z.object({
    type: z.literal("mutate"),
    patch: z.record(z.string(), z.unknown()),
  }),
]);

export const scenarioSpecSchema = z
  .object({
    id: z.string().min(1).max(128),
    injectionPoint: z.string().min(1).max(128),
    action: scenarioActionSchema,
    probability: z.number().min(0).max(1).default(1),
    remaining: z.number().int().min(1).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();
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

export const assertionSpecSchema = z
  .object({
    source: requestLogSourceSchema.optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    status: z.number().int().min(100).max(599).optional(),
    bodyIncludes: z.string().optional(),
    count: z
      .object({
        atLeast: z.number().int().min(0).optional(),
        atMost: z.number().int().min(0).optional(),
        exactly: z.number().int().min(0).optional(),
      })
      .strict()
      .default({ atLeast: 1 }),
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
export const environmentRefToolInputSchema = z
  .object({ environmentId: environmentIdSchema.optional() })
  .strict();
export const mintTokenToolInputSchema = environmentRefToolInputSchema
  .extend({
    clientId: z.string().min(1),
    subject: z.string().min(1),
    audience: z.string().min(1).optional(),
    broken: z
      .enum([
        "expired",
        "wrong_audience",
        "not_yet_valid",
        "bad_signature",
        "wrong_issuer",
      ])
      .optional(),
  })
  .strict();

export type McpToolInput =
  | z.infer<typeof createEnvironmentToolInputSchema>
  | z.infer<typeof environmentRefToolInputSchema>
  | z.infer<typeof mintTokenToolInputSchema>;
