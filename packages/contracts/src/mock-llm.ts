import { z } from "zod";
import {
  assertBehaviorSpecBounds,
  BehaviorSpecBoundsError,
  type JsonValue,
  jsonValueSchema,
} from "./behavior";

export const MOCK_LLM_PLAN_MAX_BYTES = 256 * 1024;
export const MOCK_LLM_PLAN_MAX_DEPTH = 16;
export const MOCK_LLM_PLAN_MAX_NODES = 5_000;
export const MOCK_LLM_TOOL_INPUT_MAX_BYTES = 64 * 1024;
export const MOCK_LLM_TOOL_INPUT_MAX_DEPTH = 16;
export const MOCK_LLM_TOOL_INPUT_MAX_NODES = 2_000;
export const MOCK_LLM_MAX_SEGMENTS = 64;
export const MOCK_LLM_MAX_TEXT_LENGTH = 64_000;
export const MOCK_LLM_MAX_TOOL_INPUT_KEYS = 128;
export const MOCK_LLM_MAX_TOOL_NAME_LENGTH = 64;
export const MOCK_LLM_MAX_STOP_SEQUENCE_LENGTH = 1_024;
export const MOCK_LLM_MAX_TOKEN_COUNT = 1_000_000_000;
export const MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS = 30_000;
export const MOCK_LLM_MAX_CHUNK_DELAY_MILLISECONDS = 10_000;
export const MOCK_LLM_MAX_CHUNK_SIZE = 4_096;
export const MOCK_LLM_MAXIMUM_DURATION_MILLISECONDS = 60_000;
export const MOCK_LLM_MAX_STREAM_CHUNKS = 4_096;

export class MockLlmPlanBoundsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MockLlmPlanBoundsError";
  }
}

const assertJsonTreeBounds = (
  input: unknown,
  limits: {
    readonly maximumBytes: number;
    readonly maximumDepth: number;
    readonly maximumNodes: number;
  },
  label: string
): void => {
  try {
    assertBehaviorSpecBounds(input, limits);
  } catch (cause) {
    if (cause instanceof BehaviorSpecBoundsError) {
      throw new MockLlmPlanBoundsError(
        `${label} is outside the supported bounds: ${cause.message}`,
        { cause }
      );
    }
    throw cause;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Bounds an untrusted plan and each tool input before recursive Zod parsing.
 * Callers at a trust boundary must use {@link parseMockLlmPlan}.
 */
export const assertMockLlmPlanBounds = (input: unknown): void => {
  assertJsonTreeBounds(
    input,
    {
      maximumBytes: MOCK_LLM_PLAN_MAX_BYTES,
      maximumDepth: MOCK_LLM_PLAN_MAX_DEPTH,
      maximumNodes: MOCK_LLM_PLAN_MAX_NODES,
    },
    "Mock LLM plan"
  );

  if (!isRecord(input) || !Array.isArray(input.segments)) return;
  for (const [index, segment] of input.segments.entries()) {
    if (!isRecord(segment) || segment.type !== "tool_call" || !("input" in segment)) {
      continue;
    }
    assertJsonTreeBounds(
      segment.input,
      {
        maximumBytes: MOCK_LLM_TOOL_INPUT_MAX_BYTES,
        maximumDepth: MOCK_LLM_TOOL_INPUT_MAX_DEPTH,
        maximumNodes: MOCK_LLM_TOOL_INPUT_MAX_NODES,
      },
      `Mock LLM tool input at segment ${index}`
    );
  }
};

export const mockLlmPlanIdSchema = z.string().regex(/^llmp_[A-Za-z0-9_-]{43}$/);
export type MockLlmPlanId = z.infer<typeof mockLlmPlanIdSchema>;

export const mockLlmRequestHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type MockLlmRequestHash = z.infer<typeof mockLlmRequestHashSchema>;

export const mockLlmModelSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/, "Model must contain visible ASCII characters only.");
export type MockLlmModel = z.infer<typeof mockLlmModelSchema>;

export const mockLlmTextSegmentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(MOCK_LLM_MAX_TEXT_LENGTH),
  })
  .strict();
export type MockLlmTextSegment = z.infer<typeof mockLlmTextSegmentSchema>;

const mockLlmToolInputSchema = z
  .record(z.string().min(1).max(128), jsonValueSchema)
  .superRefine((input, context) => {
    if (Object.keys(input).length > MOCK_LLM_MAX_TOOL_INPUT_KEYS) {
      context.addIssue({
        code: "custom",
        message: `Tool input cannot contain more than ${MOCK_LLM_MAX_TOOL_INPUT_KEYS} top-level keys.`,
      });
    }
    try {
      assertJsonTreeBounds(
        input,
        {
          maximumBytes: MOCK_LLM_TOOL_INPUT_MAX_BYTES,
          maximumDepth: MOCK_LLM_TOOL_INPUT_MAX_DEPTH,
          maximumNodes: MOCK_LLM_TOOL_INPUT_MAX_NODES,
        },
        "Mock LLM tool input"
      );
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message:
          cause instanceof Error ? cause.message : "Tool input is out of bounds.",
      });
    }
  });
export type MockLlmToolInput = Record<string, JsonValue>;

export const mockLlmToolCallSegmentSchema = z
  .object({
    type: z.literal("tool_call"),
    id: z.string().min(1).max(128),
    name: z
      .string()
      .min(1)
      .max(MOCK_LLM_MAX_TOOL_NAME_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
    input: mockLlmToolInputSchema,
  })
  .strict();
export type MockLlmToolCallSegment = z.infer<typeof mockLlmToolCallSegmentSchema>;

export const mockLlmSegmentSchema = z.discriminatedUnion("type", [
  mockLlmTextSegmentSchema,
  mockLlmToolCallSegmentSchema,
]);
export type MockLlmSegment = z.infer<typeof mockLlmSegmentSchema>;

export const mockLlmStopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
]);
export type MockLlmStopReason = z.infer<typeof mockLlmStopReasonSchema>;

export const mockLlmUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT),
    outputTokens: z.number().int().min(0).max(MOCK_LLM_MAX_TOKEN_COUNT),
  })
  .strict();
export type MockLlmUsage = z.infer<typeof mockLlmUsageSchema>;

/**
 * chunkSize is measured in Unicode code points, not UTF-16 code units or bytes.
 */
export const mockLlmCadenceSchema = z
  .object({
    initialDelayMilliseconds: z
      .number()
      .int()
      .min(0)
      .max(MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS),
    chunkDelayMilliseconds: z
      .number()
      .int()
      .min(0)
      .max(MOCK_LLM_MAX_CHUNK_DELAY_MILLISECONDS),
    chunkSize: z.number().int().min(1).max(MOCK_LLM_MAX_CHUNK_SIZE),
    maximumDurationMilliseconds: z
      .number()
      .int()
      .min(1)
      .max(MOCK_LLM_MAXIMUM_DURATION_MILLISECONDS),
  })
  .strict()
  .superRefine((cadence, context) => {
    if (cadence.initialDelayMilliseconds > cadence.maximumDurationMilliseconds) {
      context.addIssue({
        code: "custom",
        path: ["initialDelayMilliseconds"],
        message: "Initial delay cannot exceed maximum stream duration.",
      });
    }
    if (cadence.chunkDelayMilliseconds > cadence.maximumDurationMilliseconds) {
      context.addIssue({
        code: "custom",
        path: ["chunkDelayMilliseconds"],
        message: "Chunk delay cannot exceed maximum stream duration.",
      });
    }
  });
export type MockLlmCadence = z.infer<typeof mockLlmCadenceSchema>;

const mockLlmPlanBaseShape = {
  version: z.literal(1),
  planId: mockLlmPlanIdSchema,
  requestHash: mockLlmRequestHashSchema,
  model: mockLlmModelSchema,
  createdAtEpochSeconds: z.number().int().safe().min(0),
  turnIndex: z.number().int().safe().min(0),
  seed: z.string().min(1).max(256),
};

export const mockLlmResponsePlanSchema = z
  .object({
    ...mockLlmPlanBaseShape,
    kind: z.literal("response"),
    segments: z.array(mockLlmSegmentSchema).min(1).max(MOCK_LLM_MAX_SEGMENTS),
    stopReason: mockLlmStopReasonSchema,
    stopSequence: z.string().min(1).max(MOCK_LLM_MAX_STOP_SEQUENCE_LENGTH).optional(),
    usage: mockLlmUsageSchema,
    cadence: mockLlmCadenceSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    const toolCallIds = new Set<string>();
    let sawToolCall = false;
    let toolCallCount = 0;
    for (const [index, segment] of plan.segments.entries()) {
      if (segment.type === "text") {
        if (sawToolCall) {
          context.addIssue({
            code: "custom",
            path: ["segments", index],
            message: "Text segments must precede every tool-call segment.",
          });
        }
        continue;
      }

      sawToolCall = true;
      toolCallCount += 1;
      if (toolCallIds.has(segment.id)) {
        context.addIssue({
          code: "custom",
          path: ["segments", index, "id"],
          message: `Tool-call ID ${segment.id} is duplicated.`,
        });
      }
      toolCallIds.add(segment.id);
    }

    if (plan.stopReason === "tool_use" && toolCallCount === 0) {
      context.addIssue({
        code: "custom",
        path: ["stopReason"],
        message: "tool_use requires at least one tool-call segment.",
      });
    }
    if (plan.stopReason !== "tool_use" && toolCallCount > 0) {
      context.addIssue({
        code: "custom",
        path: ["stopReason"],
        message: "A response containing tool calls must stop with tool_use.",
      });
    }
    if (plan.stopReason === "stop_sequence" && plan.stopSequence === undefined) {
      context.addIssue({
        code: "custom",
        path: ["stopSequence"],
        message: "stop_sequence requires the matched stopSequence.",
      });
    }
    if (plan.stopReason !== "stop_sequence" && plan.stopSequence !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["stopSequence"],
        message: "stopSequence is only valid with stop_sequence.",
      });
    }

    let streamChunks = 0;
    for (const segment of plan.segments) {
      const payload =
        segment.type === "text" ? segment.text : JSON.stringify(segment.input);
      streamChunks += Math.ceil(Array.from(payload).length / plan.cadence.chunkSize);
      if (streamChunks > MOCK_LLM_MAX_STREAM_CHUNKS) {
        context.addIssue({
          code: "custom",
          path: ["cadence", "chunkSize"],
          message: `A response plan cannot expand to more than ${MOCK_LLM_MAX_STREAM_CHUNKS} payload chunks.`,
        });
        break;
      }
    }
  });
export type MockLlmResponsePlan = z.infer<typeof mockLlmResponsePlanSchema>;

export const mockLlmErrorKindSchema = z.enum([
  "invalid_request",
  "authentication",
  "permission_denied",
  "not_found",
  "request_too_large",
  "rate_limit",
  "timeout",
  "internal",
  "overloaded",
]);
export type MockLlmErrorKind = z.infer<typeof mockLlmErrorKindSchema>;

export const mockLlmErrorSchema = z
  .object({
    kind: mockLlmErrorKindSchema,
    message: z.string().min(1).max(8_192),
    retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
  })
  .strict()
  .superRefine((error, context) => {
    if (
      error.retryAfterSeconds !== undefined &&
      error.kind !== "rate_limit" &&
      error.kind !== "overloaded"
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryAfterSeconds"],
        message: "Retry-After is only valid for rate-limit or overloaded errors.",
      });
    }
  });
export type MockLlmError = z.infer<typeof mockLlmErrorSchema>;

export const mockLlmErrorPlanSchema = z
  .object({
    ...mockLlmPlanBaseShape,
    kind: z.literal("error"),
    initialDelayMilliseconds: z
      .number()
      .int()
      .min(0)
      .max(MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS),
    error: mockLlmErrorSchema,
  })
  .strict();
export type MockLlmErrorPlan = z.infer<typeof mockLlmErrorPlanSchema>;

export const mockLlmPlanSchema = z.discriminatedUnion("kind", [
  mockLlmResponsePlanSchema,
  mockLlmErrorPlanSchema,
]);
export type MockLlmPlan = z.infer<typeof mockLlmPlanSchema>;

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object") return value;
  const pending: object[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") {
        pending.push(child);
      }
    }
    Object.freeze(current);
  }
  return value;
};

/**
 * Parses an untrusted neutral plan, detaches it from the caller's input, and freezes
 * the complete result so provider renderers cannot mutate committed plan state.
 */
export const parseMockLlmPlan = (input: unknown): MockLlmPlan => {
  assertMockLlmPlanBounds(input);
  return deepFreeze(mockLlmPlanSchema.parse(input));
};
