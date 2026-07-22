import {
  type ProvisioningHttpOperation,
  type ProvisioningHttpResponse,
  type ProvisioningInterpretation,
  type ProvisioningSourceResource,
  type ProvisioningWatermark,
  type ProvisioningWatermarkMutation,
  provisioningHttpOperationSchema,
  provisioningHttpResponseSchema,
  provisioningInterpretationSchema,
  provisioningWatermarkSchema,
} from "@mockos/contracts";
import {
  buildTerminalOperation,
  buildWriteOperation,
  UnresolvedProvisioningMemberError,
} from "./operations";

export interface InterpretProvisioningResponseInput {
  readonly operation: ProvisioningHttpOperation;
  readonly response: ProvisioningHttpResponse;
  /** The latest watermark, including outcomes from all earlier user operations. */
  readonly watermark: ProvisioningWatermark;
  readonly maxRateLimitAttempts?: number;
  /** Required only to interpret absolute Retry-After or Okta reset timestamps. */
  readonly receivedAtEpochMs?: number;
}

const objectBody = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Readonly<Record<string, unknown>>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Readonly<Record<string, unknown>>)
    : undefined;
};

const lowerCaseHeaders = (
  headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );

const targetIdFromResponse = (
  response: ProvisioningHttpResponse
): string | undefined => {
  const bodyId = objectBody(response.body)?.id;
  if (typeof bodyId === "string" && bodyId.length > 0 && bodyId.length <= 256) {
    return bodyId;
  }
  const location = lowerCaseHeaders(response.headers).location;
  if (!location) return undefined;
  try {
    const url = new URL(location, "https://target.invalid");
    const part = url.pathname.split("/").filter(Boolean).at(-1);
    if (!part) return undefined;
    const decoded = decodeURIComponent(part);
    return decoded.length <= 256 ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const mutationForSuccess = (
  operation: ProvisioningHttpOperation,
  targetId: string
): ProvisioningWatermarkMutation | undefined => {
  const source = operation.source;
  if (!source) return undefined;
  return {
    action: "upsert",
    entry:
      source.resourceType === "User"
        ? {
            resourceType: "User",
            sourceId: source.id,
            targetId,
            sourceVersion: source.version,
            active: source.active && !source.deleted,
          }
        : {
            resourceType: "Group",
            sourceId: source.id,
            targetId,
            sourceVersion: source.version,
          },
  };
};

const removeMutation = (
  operation: ProvisioningHttpOperation
): ProvisioningWatermarkMutation => ({
  action: "remove",
  resourceType: operation.resourceType,
  sourceId: operation.sourceId,
});

const followUpId = (operation: ProvisioningHttpOperation, suffix: string): string => {
  const boundedBase = operation.id.slice(0, Math.max(1, 255 - suffix.length));
  return `${boundedBase}:${suffix}`;
};

const retryDelayMs = (
  response: ProvisioningHttpResponse,
  receivedAtEpochMs: number | undefined
): number => {
  const headers = lowerCaseHeaders(response.headers);
  const retryAfter = headers["retry-after"];
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    return Math.min(30_000, Math.max(1, Number(retryAfter.trim()) * 1_000));
  }
  if (retryAfter && receivedAtEpochMs !== undefined) {
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(30_000, Math.max(1, date - receivedAtEpochMs));
    }
  }
  const reset = headers["x-rate-limit-reset"];
  if (reset && receivedAtEpochMs !== undefined && /^\d+$/.test(reset.trim())) {
    return Math.min(
      30_000,
      Math.max(1, Number(reset.trim()) * 1_000 - receivedAtEpochMs)
    );
  }
  return 1_000;
};

const interpretRateLimit = (
  input: InterpretProvisioningResponseInput
): ProvisioningInterpretation => {
  const maxAttempts = input.maxRateLimitAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError("Rate-limit attempts must be an integer between 1 and 10.");
  }
  const { operation } = input;
  if (operation.attempt >= maxAttempts) {
    return {
      outcome: "failed",
      message: `Target returned HTTP 429 after ${operation.attempt} attempts.`,
      followUpOperations: [],
    };
  }
  const nextAttempt = operation.attempt + 1;
  const retryId = followUpId(operation, `retry-${nextAttempt}`);
  return {
    outcome: "retry",
    message: `Target returned HTTP 429; retry attempt ${nextAttempt} is explicit.`,
    followUpOperations: [
      {
        type: "wait",
        id: followUpId(operation, `wait-${nextAttempt}`),
        sequence: operation.sequence,
        provider: operation.provider,
        resourceType: operation.resourceType,
        action: "rate_limit_wait",
        sourceId: operation.sourceId,
        attempt: nextAttempt,
        delayMs: retryDelayMs(input.response, input.receivedAtEpochMs),
        retryOperationId: retryId,
      },
      { ...operation, id: retryId, attempt: nextAttempt },
    ],
  };
};

interface LookupResult {
  readonly kind: "none" | "one" | "invalid" | "multiple";
  readonly targetId?: string;
}

const lookupResult = (response: ProvisioningHttpResponse): LookupResult => {
  const body = objectBody(response.body);
  const resources = body?.Resources;
  const totalResults = body?.totalResults;
  if (
    !Array.isArray(resources) ||
    !Number.isSafeInteger(totalResults) ||
    (totalResults as number) < 0
  ) {
    return { kind: "invalid" };
  }
  if (totalResults === 0 && resources.length === 0) return { kind: "none" };
  if (totalResults !== 1 || resources.length !== 1) return { kind: "multiple" };
  const resource = resources[0];
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    return { kind: "invalid" };
  }
  const targetId = (resource as Readonly<Record<string, unknown>>).id;
  return typeof targetId === "string" && targetId.length > 0 && targetId.length <= 256
    ? { kind: "one", targetId }
    : { kind: "invalid" };
};

const writeFollowUp = (
  operation: ProvisioningHttpOperation,
  source: ProvisioningSourceResource,
  action: "create" | "update",
  watermark: ProvisioningWatermark,
  targetId?: string
): ProvisioningInterpretation => {
  try {
    const followUp = buildWriteOperation({
      id: followUpId(operation, action),
      sequence: operation.sequence,
      provider: operation.provider,
      action,
      source,
      ...(targetId ? { targetId } : {}),
      behavior: operation.behavior,
      watermark,
    });
    return {
      outcome: "follow_up",
      message: `Lookup resolved to a ${action} operation.`,
      ...(targetId ? { targetId } : {}),
      followUpOperations: [followUp],
    };
  } catch (error) {
    if (error instanceof UnresolvedProvisioningMemberError) {
      return {
        outcome: "failed",
        message: error.message,
        followUpOperations: [],
      };
    }
    throw error;
  }
};

const interpretLookup = (
  input: InterpretProvisioningResponseInput
): ProvisioningInterpretation => {
  const { operation } = input;
  const source = operation.source;
  if (!source) {
    return {
      outcome: "failed",
      message: "Lookup operation omitted its source resource.",
      followUpOperations: [],
    };
  }
  const result = lookupResult(input.response);
  if (result.kind === "invalid") {
    return {
      outcome: "failed",
      message: "Target returned an invalid SCIM ListResponse.",
      followUpOperations: [],
    };
  }
  if (result.kind === "multiple") {
    return {
      outcome: "failed",
      message: "Target lookup was not unique.",
      followUpOperations: [],
    };
  }
  if (result.kind === "none") {
    if (source.deleted) {
      return {
        outcome: "succeeded",
        message: "Deleted source resource was already absent from the target.",
        followUpOperations: [],
        watermarkMutation: removeMutation(operation),
      };
    }
    return writeFollowUp(operation, source, "create", input.watermark);
  }
  const targetId = result.targetId as string;
  if (source.deleted) {
    const action = source.resourceType === "User" ? "deactivate" : "delete";
    const followUp = buildTerminalOperation({
      id: followUpId(operation, action),
      sequence: operation.sequence,
      provider: operation.provider,
      action,
      resourceType: source.resourceType,
      sourceId: source.id,
      sourceVersion: source.version,
      targetId,
      source,
      behavior: operation.behavior,
    });
    return {
      outcome: "follow_up",
      message: `Lookup resolved deleted source resource '${source.id}'.`,
      targetId,
      followUpOperations: [followUp],
    };
  }
  return writeFollowUp(operation, source, "update", input.watermark, targetId);
};

const successfulTerminalInterpretation = (
  operation: ProvisioningHttpOperation
): ProvisioningInterpretation => {
  if (operation.action === "delete") {
    return {
      outcome: "succeeded",
      message: "Target resource deletion completed.",
      followUpOperations: [],
      watermarkMutation: removeMutation(operation),
    };
  }
  const tombstone = operation.source === undefined || operation.source.deleted;
  const deleteAfterDeactivation =
    operation.provider === "entra" &&
    (operation.behavior.entra?.deleteAfterDeactivation ?? true);
  if (tombstone && deleteAfterDeactivation) {
    const followUp = buildTerminalOperation({
      id: followUpId(operation, "delete"),
      sequence: operation.sequence,
      provider: operation.provider,
      action: "delete",
      resourceType: "User",
      sourceId: operation.sourceId,
      sourceVersion: operation.sourceVersion,
      targetId: operation.targetId as string,
      ...(operation.source ? { source: operation.source } : {}),
      behavior: operation.behavior,
    });
    return {
      outcome: "follow_up",
      message: "Entra-style deactivation completed; delete is the next explicit op.",
      targetId: operation.targetId,
      followUpOperations: [followUp],
    };
  }
  if (tombstone) {
    return {
      outcome: "succeeded",
      message: "Target user deactivation completed.",
      targetId: operation.targetId,
      followUpOperations: [],
      watermarkMutation: removeMutation(operation),
    };
  }
  return {
    outcome: "succeeded",
    message: "Target user deactivation completed.",
    targetId: operation.targetId,
    followUpOperations: [],
    ...(operation.targetId
      ? { watermarkMutation: mutationForSuccess(operation, operation.targetId) }
      : {}),
  };
};

const interpretProvisioningResponseInternal = (
  input: InterpretProvisioningResponseInput
): ProvisioningInterpretation => {
  const operation = provisioningHttpOperationSchema.parse(input.operation);
  const response = provisioningHttpResponseSchema.parse(input.response);
  const watermark = provisioningWatermarkSchema.parse(input.watermark);
  if (
    input.receivedAtEpochMs !== undefined &&
    (!Number.isSafeInteger(input.receivedAtEpochMs) || input.receivedAtEpochMs < 0)
  ) {
    throw new RangeError("Response receipt time must be a non-negative finite epoch.");
  }
  const normalizedInput: InterpretProvisioningResponseInput = {
    operation,
    response,
    watermark,
    ...(input.maxRateLimitAttempts === undefined
      ? {}
      : { maxRateLimitAttempts: input.maxRateLimitAttempts }),
    ...(input.receivedAtEpochMs === undefined
      ? {}
      : { receivedAtEpochMs: input.receivedAtEpochMs }),
  };
  if (response.status === 429) return interpretRateLimit(normalizedInput);
  if (operation.action === "delete" && response.status === 404) {
    return {
      outcome: "succeeded",
      message: "Target resource was already absent.",
      followUpOperations: [],
      watermarkMutation: removeMutation(operation),
    };
  }
  if (operation.action === "deactivate" && response.status === 404) {
    return {
      outcome: "succeeded",
      message: "Target user was already absent.",
      followUpOperations: [],
      watermarkMutation: removeMutation(operation),
    };
  }
  if (operation.action === "update" && response.status === 404 && operation.source) {
    return writeFollowUp(operation, operation.source, "create", watermark);
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      outcome: "failed",
      message: `Target returned HTTP ${response.status}; no protocol retry was inferred.`,
      followUpOperations: [],
    };
  }
  if (operation.action === "lookup") return interpretLookup(normalizedInput);
  if (operation.action === "deactivate" || operation.action === "delete") {
    return successfulTerminalInterpretation(operation);
  }
  const targetId =
    operation.action === "create"
      ? targetIdFromResponse(response)
      : (operation.targetId ?? targetIdFromResponse(response));
  if (!targetId) {
    return {
      outcome: "failed",
      message: `Successful ${operation.action} response did not identify the target resource.`,
      followUpOperations: [],
    };
  }
  return {
    outcome: "succeeded",
    message: `Target resource ${operation.action} completed.`,
    targetId,
    followUpOperations: [],
    ...(mutationForSuccess(operation, targetId)
      ? { watermarkMutation: mutationForSuccess(operation, targetId) }
      : {}),
  };
};

export const interpretProvisioningResponse = (
  input: InterpretProvisioningResponseInput
): ProvisioningInterpretation =>
  provisioningInterpretationSchema.parse(interpretProvisioningResponseInternal(input));
