import { z } from "zod";

// Kept local to avoid a circular import through the package barrel. These mirror the
// locked provider/environment wire constraints exported from the root contract module.
const provisioningProviderIdSchema = z.enum(["entra", "okta"]);
const provisioningEnvironmentIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]+$/);

export const provisioningModeSchema = z.enum(["full", "incremental"]);
export type ProvisioningMode = z.infer<typeof provisioningModeSchema>;

export const provisioningTargetRefSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const MAX_PROVISIONING_TARGET_BASE_URL_LENGTH = 2_048;

const provisioningTargetBaseUrlSchema = z
  .url()
  .max(MAX_PROVISIONING_TARGET_BASE_URL_LENGTH)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Provisioning target URLs cannot contain credentials.",
      });
    }
    if (url.search || url.hash) {
      context.addIssue({
        code: "custom",
        message: "Provisioning target URLs cannot contain queries or fragments.",
      });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      context.addIssue({
        code: "custom",
        message: "Provisioning target URLs must use HTTP or HTTPS.",
      });
    }
  });

export const provisioningBehaviorSchema = z
  .object({
    entra: z
      .object({
        aadOptscim062020: z.boolean().default(true),
        deleteAfterDeactivation: z.boolean().default(true),
      })
      .strict()
      .optional(),
    okta: z
      .object({ groupPush: z.boolean().default(true) })
      .strict()
      .optional(),
  })
  .strict()
  .default({});
export type ProvisioningBehavior = z.infer<typeof provisioningBehaviorSchema>;

const noProvisioningTargetAuthSchema = z.object({ kind: z.literal("none") }).strict();

const containsWhitespaceOrControl = (value: string): boolean =>
  /\s/u.test(value) ||
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const rawProvisioningTargetAuthSchema = z
  .object({
    kind: z.literal("bearer"),
    token: z
      .string()
      .trim()
      .min(8)
      .max(4096)
      .refine((token) => !containsWhitespaceOrControl(token), {
        message: "Outbound bearer tokens cannot contain whitespace or controls.",
      })
      .refine((token) => !token.startsWith("mk_"), {
        message:
          "Platform API keys cannot be used as outbound SCIM target credentials.",
      }),
  })
  .strict();

const storedProvisioningTargetAuthSchema = z
  .object({
    kind: z.literal("bearer"),
    credentialRef: z.string().min(1).max(256),
  })
  .strict();

/** Ingress-only target input. The raw bearer token must never enter a run or plan. */
export const provisioningTargetInputSchema = z
  .object({
    ref: provisioningTargetRefSchema,
    baseUrl: provisioningTargetBaseUrlSchema,
    auth: z
      .discriminatedUnion("kind", [
        noProvisioningTargetAuthSchema,
        rawProvisioningTargetAuthSchema,
      ])
      .default({ kind: "none" }),
    behavior: provisioningBehaviorSchema,
  })
  .strict();
export type ProvisioningTargetInput = z.infer<typeof provisioningTargetInputSchema>;

/** Safe target metadata suitable for persistence and workflow parameters. */
export const provisioningTargetSchema = z
  .object({
    ref: provisioningTargetRefSchema,
    baseUrl: provisioningTargetBaseUrlSchema,
    auth: z.discriminatedUnion("kind", [
      noProvisioningTargetAuthSchema,
      storedProvisioningTargetAuthSchema,
    ]),
    behavior: provisioningBehaviorSchema,
  })
  .strict();
export type ProvisioningTarget = z.infer<typeof provisioningTargetSchema>;

export const provisioningWorkflowParamsSchema = z
  .object({
    envId: provisioningEnvironmentIdSchema,
    appId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    mode: provisioningModeSchema,
    targetRef: provisioningTargetRefSchema,
  })
  .strict();
export type ProvisioningWorkflowParams = z.infer<
  typeof provisioningWorkflowParamsSchema
>;

const savedProvisioningTargetSelectorSchema = z
  .object({
    kind: z.literal("saved"),
    targetRef: provisioningTargetRefSchema,
  })
  .strict();

const inlineProvisioningTargetSelectorSchema = z
  .object({
    kind: z.literal("inline"),
    target: provisioningTargetInputSchema,
    save: z.boolean().default(false),
  })
  .strict();

export const runProvisioningCycleToolInputSchema = z
  .object({
    environmentId: provisioningEnvironmentIdSchema.optional(),
    appId: z.string().min(1).max(128),
    mode: provisioningModeSchema.default("incremental"),
    target: z.discriminatedUnion("kind", [
      savedProvisioningTargetSelectorSchema,
      inlineProvisioningTargetSelectorSchema,
    ]),
  })
  .strict();
export type RunProvisioningCycleToolInput = z.infer<
  typeof runProvisioningCycleToolInputSchema
>;

const sourceVersionSchema = z.number().int().min(1);

export const provisioningSourceUserSchema = z
  .object({
    resourceType: z.literal("User"),
    id: z.string().min(1).max(128),
    externalId: z.string().min(1).max(256).optional(),
    userName: z.string().trim().min(1).max(320),
    displayName: z.string().trim().min(1).max(256),
    givenName: z.string().trim().min(1).max(128).optional(),
    familyName: z.string().trim().min(1).max(128).optional(),
    active: z.boolean(),
    deleted: z.boolean().default(false),
    version: sourceVersionSchema,
  })
  .strict()
  .refine((user) => !(user.deleted && user.active), {
    message: "A deleted provisioning user cannot be active.",
  });
export type ProvisioningSourceUser = z.infer<typeof provisioningSourceUserSchema>;

export const provisioningSourceGroupSchema = z
  .object({
    resourceType: z.literal("Group"),
    id: z.string().min(1).max(128),
    externalId: z.string().min(1).max(256).optional(),
    displayName: z.string().trim().min(1).max(256),
    memberIds: z.array(z.string().min(1).max(128)).max(10_000).default([]),
    deleted: z.boolean().default(false),
    version: sourceVersionSchema,
  })
  .strict();
export type ProvisioningSourceGroup = z.infer<typeof provisioningSourceGroupSchema>;

export const provisioningSourceResourceSchema = z.discriminatedUnion("resourceType", [
  provisioningSourceUserSchema,
  provisioningSourceGroupSchema,
]);
export type ProvisioningSourceResource = z.infer<
  typeof provisioningSourceResourceSchema
>;

export const provisioningSnapshotSchema = z
  .object({
    cursor: z.string().min(1).max(256),
    users: z.array(provisioningSourceUserSchema).max(10_000),
    groups: z.array(provisioningSourceGroupSchema).max(10_000),
  })
  .strict();
export type ProvisioningSnapshot = z.infer<typeof provisioningSnapshotSchema>;

const provisioningWatermarkEntryBase = {
  sourceId: z.string().min(1).max(128),
  targetId: z.string().min(1).max(256),
  sourceVersion: sourceVersionSchema,
};

export const provisioningUserWatermarkEntrySchema = z
  .object({
    resourceType: z.literal("User"),
    ...provisioningWatermarkEntryBase,
    active: z.boolean(),
  })
  .strict();
export type ProvisioningUserWatermarkEntry = z.infer<
  typeof provisioningUserWatermarkEntrySchema
>;

export const provisioningGroupWatermarkEntrySchema = z
  .object({
    resourceType: z.literal("Group"),
    ...provisioningWatermarkEntryBase,
  })
  .strict();
export type ProvisioningGroupWatermarkEntry = z.infer<
  typeof provisioningGroupWatermarkEntrySchema
>;

export const provisioningWatermarkEntrySchema = z.discriminatedUnion("resourceType", [
  provisioningUserWatermarkEntrySchema,
  provisioningGroupWatermarkEntrySchema,
]);
export type ProvisioningWatermarkEntry = z.infer<
  typeof provisioningWatermarkEntrySchema
>;

export const provisioningWatermarkSchema = z
  .object({
    cursor: z.string().min(1).max(256).optional(),
    users: z.array(provisioningUserWatermarkEntrySchema).max(10_000).default([]),
    groups: z.array(provisioningGroupWatermarkEntrySchema).max(10_000).default([]),
  })
  .strict();
export type ProvisioningWatermark = z.infer<typeof provisioningWatermarkSchema>;

export const provisioningHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
export type ProvisioningHttpMethod = z.infer<typeof provisioningHttpMethodSchema>;

export const provisioningHttpRequestSchema = z
  .object({
    method: provisioningHttpMethodSchema,
    path: z
      .string()
      .min(1)
      .max(8192)
      .startsWith("/")
      .refine((path) => !path.startsWith("//"), {
        message: "Provisioning operation paths must be origin-relative.",
      }),
    headers: z.record(z.string().min(1).max(256), z.string().max(8192)).default({}),
    body: z.unknown().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const headerNames = new Set(
      Object.keys(request.headers).map((name) => name.toLowerCase())
    );
    for (const name of ["authorization", "proxy-authorization"]) {
      if (headerNames.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["headers", name],
          message: `${name} credentials must be injected at execution, not persisted in a provisioning plan.`,
        });
      }
    }
  });
export type ProvisioningHttpRequest = z.infer<typeof provisioningHttpRequestSchema>;

export const provisioningHttpActionSchema = z.enum([
  "lookup",
  "create",
  "update",
  "deactivate",
  "delete",
]);
export type ProvisioningHttpAction = z.infer<typeof provisioningHttpActionSchema>;

export const provisioningHttpOperationSchema = z
  .object({
    type: z.literal("http"),
    id: z.string().min(1).max(256),
    sequence: z.number().int().min(1),
    provider: provisioningProviderIdSchema,
    resourceType: z.enum(["User", "Group"]),
    action: provisioningHttpActionSchema,
    sourceId: z.string().min(1).max(128),
    sourceVersion: sourceVersionSchema,
    targetId: z.string().min(1).max(256).optional(),
    source: provisioningSourceResourceSchema.optional(),
    behavior: provisioningBehaviorSchema,
    attempt: z.number().int().min(1).max(10).default(1),
    request: provisioningHttpRequestSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    const sourceRequired =
      operation.action === "lookup" ||
      operation.action === "create" ||
      operation.action === "update";
    const targetRequired =
      operation.action === "update" ||
      operation.action === "deactivate" ||
      operation.action === "delete";
    if (sourceRequired && operation.source === undefined) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: `${operation.action} operations require their source resource.`,
      });
    }
    if (targetRequired && operation.targetId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: `${operation.action} operations require a resolved target ID.`,
      });
    }
    if (
      (operation.action === "lookup" || operation.action === "create") &&
      operation.targetId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: `${operation.action} operations cannot carry a target ID.`,
      });
    }
    if (operation.action === "deactivate" && operation.resourceType !== "User") {
      context.addIssue({
        code: "custom",
        path: ["resourceType"],
        message: "Only User resources can be deactivated.",
      });
    }
    if (
      operation.action === "deactivate" &&
      operation.source?.resourceType === "User" &&
      operation.source.active
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "active"],
        message: "A deactivation operation cannot carry an active source user.",
      });
    }
    if (
      (operation.action === "create" || operation.action === "update") &&
      operation.source?.deleted
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "deleted"],
        message: `${operation.action} operations cannot write a deleted source resource.`,
      });
    }
    if (
      operation.action === "delete" &&
      operation.source !== undefined &&
      !operation.source.deleted
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "deleted"],
        message: "A delete operation cannot carry a live source resource.",
      });
    }
    const methodAllowed =
      (operation.action === "lookup" && operation.request.method === "GET") ||
      (operation.action === "create" && operation.request.method === "POST") ||
      (operation.action === "update" &&
        operation.request.method ===
          (operation.provider === "entra" ? "PATCH" : "PUT")) ||
      (operation.action === "deactivate" &&
        (operation.request.method === "PATCH" || operation.request.method === "PUT")) ||
      (operation.action === "delete" && operation.request.method === "DELETE");
    if (!methodAllowed) {
      context.addIssue({
        code: "custom",
        path: ["request", "method"],
        message: `HTTP ${operation.request.method} is not valid for a ${operation.provider} ${operation.action} operation.`,
      });
    }
    if (
      operation.source !== undefined &&
      (operation.source.resourceType !== operation.resourceType ||
        operation.source.id !== operation.sourceId ||
        operation.source.version !== operation.sourceVersion)
    ) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "Provisioning operation identity must match its source resource.",
      });
    }
  });
export type ProvisioningHttpOperation = z.infer<typeof provisioningHttpOperationSchema>;

export const provisioningWaitOperationSchema = z
  .object({
    type: z.literal("wait"),
    id: z.string().min(1).max(256),
    sequence: z.number().int().min(1),
    provider: provisioningProviderIdSchema,
    resourceType: z.enum(["User", "Group"]),
    action: z.literal("rate_limit_wait"),
    sourceId: z.string().min(1).max(128),
    attempt: z.number().int().min(2).max(10),
    delayMs: z.number().int().min(1).max(30_000),
    retryOperationId: z.string().min(1).max(256),
  })
  .strict();
export type ProvisioningWaitOperation = z.infer<typeof provisioningWaitOperationSchema>;

export const provisioningOpSchema = z.discriminatedUnion("type", [
  provisioningHttpOperationSchema,
  provisioningWaitOperationSchema,
]);
export type ProvisioningOp = z.infer<typeof provisioningOpSchema>;

export const provisioningPlanSchema = z
  .object({
    version: z.literal(1),
    provider: provisioningProviderIdSchema,
    mode: provisioningModeSchema,
    snapshotCursor: z.string().min(1).max(256),
    behavior: provisioningBehaviorSchema,
    operations: z.array(provisioningOpSchema).max(100_000),
    counts: z
      .object({
        users: z.number().int().min(0),
        groups: z.number().int().min(0),
        total: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    let users = 0;
    let groups = 0;
    for (const [index, operation] of plan.operations.entries()) {
      if (ids.has(operation.id)) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "id"],
          message: `Provisioning operation ID '${operation.id}' is duplicated.`,
        });
      }
      ids.add(operation.id);
      if (operation.sequence !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "sequence"],
          message:
            "Initial provisioning plan operations must use contiguous execution order.",
        });
      }
      if (operation.provider !== plan.provider) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "provider"],
          message: "Provisioning operation provider must match its plan.",
        });
      }
      if (operation.resourceType === "User") users += 1;
      else groups += 1;
    }
    if (
      plan.counts.users !== users ||
      plan.counts.groups !== groups ||
      plan.counts.total !== plan.operations.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Provisioning plan counts must match its operations.",
      });
    }
  });
export type ProvisioningPlan = z.infer<typeof provisioningPlanSchema>;

export const provisioningHttpResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.unknown().optional(),
  })
  .strict();
export type ProvisioningHttpResponse = z.infer<typeof provisioningHttpResponseSchema>;

const upsertProvisioningWatermarkMutationSchema = z
  .object({
    action: z.literal("upsert"),
    entry: provisioningWatermarkEntrySchema,
  })
  .strict();

const removeProvisioningWatermarkMutationSchema = z
  .object({
    action: z.literal("remove"),
    resourceType: z.enum(["User", "Group"]),
    sourceId: z.string().min(1).max(128),
  })
  .strict();

export const provisioningWatermarkMutationSchema = z.discriminatedUnion("action", [
  upsertProvisioningWatermarkMutationSchema,
  removeProvisioningWatermarkMutationSchema,
]);
export type ProvisioningWatermarkMutation = z.infer<
  typeof provisioningWatermarkMutationSchema
>;

export const provisioningInterpretationSchema = z
  .object({
    outcome: z.enum(["succeeded", "follow_up", "retry", "failed"]),
    message: z.string().min(1).max(2048),
    targetId: z.string().min(1).max(256).optional(),
    followUpOperations: z.array(provisioningOpSchema).max(10).default([]),
    watermarkMutation: provisioningWatermarkMutationSchema.optional(),
  })
  .strict();
export type ProvisioningInterpretation = z.infer<
  typeof provisioningInterpretationSchema
>;

export const provisioningRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const provisioningRunSchema = z
  .object({
    id: z.string().min(1).max(128),
    envId: provisioningEnvironmentIdSchema,
    appId: z.string().min(1).max(128),
    provider: provisioningProviderIdSchema,
    mode: provisioningModeSchema,
    targetRef: provisioningTargetRefSchema,
    status: provisioningRunStatusSchema,
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((run, context) => {
    const terminal =
      run.status === "succeeded" || run.status === "partial" || run.status === "failed";
    if (run.status === "queued" && (run.startedAt || run.completedAt)) {
      context.addIssue({
        code: "custom",
        message: "A queued provisioning run cannot have execution timestamps.",
      });
    }
    if (run.status === "running" && (!run.startedAt || run.completedAt)) {
      context.addIssue({
        code: "custom",
        message:
          "A running provisioning run requires startedAt and cannot have completedAt.",
      });
    }
    if (terminal && (!run.startedAt || !run.completedAt)) {
      context.addIssue({
        code: "custom",
        message: "A terminal provisioning run requires startedAt and completedAt.",
      });
    }
    if (run.startedAt && Date.parse(run.startedAt) < Date.parse(run.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Provisioning run timestamps cannot move backwards.",
      });
    }
    if (
      run.completedAt &&
      Date.parse(run.completedAt) < Date.parse(run.startedAt ?? run.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Provisioning run timestamps cannot move backwards.",
      });
    }
  });
export type ProvisioningRun = z.infer<typeof provisioningRunSchema>;

export const provisioningStepSchema = z
  .object({
    id: z.string().min(1).max(256),
    runId: z.string().min(1).max(128),
    sequence: z.number().int().min(1),
    kind: z.enum(["resolve_target", "plan", "execute", "summarize"]),
    operationId: z.string().min(1).max(256).optional(),
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    attempt: z.number().int().min(1).max(10).default(1),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    message: z.string().min(1).max(2048).optional(),
  })
  .strict();
export type ProvisioningStep = z.infer<typeof provisioningStepSchema>;

export const provisioningSummarySchema = z
  .object({
    runId: z.string().min(1).max(128),
    status: z.enum(["succeeded", "partial", "failed"]),
    operations: z
      .object({
        total: z.number().int().min(0),
        succeeded: z.number().int().min(0),
        failed: z.number().int().min(0),
        retried: z.number().int().min(0),
      })
      .strict(),
    resources: z
      .object({
        users: z.number().int().min(0),
        groups: z.number().int().min(0),
      })
      .strict(),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((summary, context) => {
    const { total, succeeded, failed, retried } = summary.operations;
    if (total !== succeeded + failed + retried) {
      context.addIssue({
        code: "custom",
        path: ["operations", "total"],
        message:
          "Provisioning operation totals must equal succeeded + failed + retried.",
      });
    }
    if (summary.status === "succeeded" && failed !== 0) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A succeeded provisioning summary cannot contain failures.",
      });
    }
    if (summary.status === "failed" && (failed === 0 || succeeded !== 0)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A failed provisioning summary requires failures and no successes.",
      });
    }
    if (summary.status === "partial" && (failed === 0 || succeeded === 0)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A partial provisioning summary requires both successes and failures.",
      });
    }
    if (Date.parse(summary.completedAt) < Date.parse(summary.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Provisioning summary timestamps cannot move backwards.",
      });
    }
  });
export type ProvisioningSummary = z.infer<typeof provisioningSummarySchema>;
