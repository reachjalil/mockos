import type { MockLlmPlan } from "@mockos/contracts/mock-llm";
import { canonicalMockLlmJson } from "./canonical-json";
import type { RenderedLlmWire, RenderLlmPlanOptions } from "./wire";

type MockLlmResponsePlan = Extract<MockLlmPlan, { readonly kind: "response" }>;
type MockLlmErrorPlan = Extract<MockLlmPlan, { readonly kind: "error" }>;
type MockLlmErrorKind = MockLlmErrorPlan["error"]["kind"];
type MockLlmStopReason = MockLlmResponsePlan["stopReason"];

const ANTHROPIC_ERROR_STATUS = {
  invalid_request: 400,
  authentication: 401,
  permission_denied: 403,
  not_found: 404,
  request_too_large: 413,
  rate_limit: 429,
  timeout: 504,
  internal: 500,
  overloaded: 529,
} as const satisfies Record<MockLlmErrorKind, number>;

const ANTHROPIC_ERROR_TYPE = {
  invalid_request: "invalid_request_error",
  authentication: "authentication_error",
  permission_denied: "permission_error",
  not_found: "not_found_error",
  request_too_large: "request_too_large",
  rate_limit: "rate_limit_error",
  timeout: "timeout_error",
  internal: "api_error",
  overloaded: "overloaded_error",
} as const satisfies Record<MockLlmErrorKind, string>;

const ANTHROPIC_STOP_REASON = {
  end_turn: "end_turn",
  max_tokens: "max_tokens",
  stop_sequence: "stop_sequence",
  tool_use: "tool_use",
} as const satisfies Record<MockLlmStopReason, string>;

const jsonHeaders = (planId: string): Readonly<Record<string, string>> => ({
  "content-type": "application/json",
  "request-id": planId,
});

const eventStreamHeaders = (planId: string): Readonly<Record<string, string>> => ({
  "content-type": "text/event-stream",
  "request-id": planId,
});

const errorHeaders = (plan: MockLlmErrorPlan): Readonly<Record<string, string>> => ({
  ...jsonHeaders(plan.planId),
  ...(plan.error.retryAfterSeconds === undefined
    ? {}
    : { "retry-after": String(plan.error.retryAfterSeconds) }),
});

const splitCodePoints = (value: string, chunkSize: number): readonly string[] => {
  const codePoints = Array.from(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += chunkSize) {
    chunks.push(codePoints.slice(offset, offset + chunkSize).join(""));
  }
  return chunks;
};

const usage = (plan: MockLlmResponsePlan, outputTokens = plan.usage.outputTokens) => ({
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: null,
  input_tokens: plan.usage.inputTokens,
  output_tokens: outputTokens,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: "standard" as const,
});

const contentBlocks = (plan: MockLlmResponsePlan) =>
  plan.segments.map((segment) =>
    segment.type === "text"
      ? {
          type: "text" as const,
          text: segment.text,
          citations: null,
        }
      : {
          type: "tool_use" as const,
          id: segment.id,
          name: segment.name,
          input: segment.input,
          caller: { type: "direct" as const },
        }
  );

const renderAnthropicJsonResponse = (plan: MockLlmResponsePlan): RenderedLlmWire => ({
  kind: "json",
  status: 200,
  headers: jsonHeaders(plan.planId),
  body: {
    id: plan.planId,
    container: null,
    content: contentBlocks(plan),
    model: plan.model,
    role: "assistant",
    stop_details: null,
    stop_reason: ANTHROPIC_STOP_REASON[plan.stopReason],
    stop_sequence: plan.stopSequence ?? null,
    type: "message",
    usage: usage(plan),
  },
});

const anthropicSseFrame = (
  eventName: string,
  event: Readonly<Record<string, unknown>>
): string => `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;

const renderAnthropicSseResponse = (plan: MockLlmResponsePlan): RenderedLlmWire => {
  const frames: string[] = [
    anthropicSseFrame("message_start", {
      type: "message_start",
      message: {
        id: plan.planId,
        container: null,
        content: [],
        model: plan.model,
        role: "assistant",
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage: usage(plan, 0),
      },
    }),
  ];

  for (const [index, segment] of plan.segments.entries()) {
    if (segment.type === "text") {
      frames.push(
        anthropicSseFrame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "", citations: null },
        })
      );
      for (const text of splitCodePoints(segment.text, plan.cadence.chunkSize)) {
        frames.push(
          anthropicSseFrame("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text },
          })
        );
      }
    } else {
      frames.push(
        anthropicSseFrame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: segment.id,
            name: segment.name,
            input: {},
            caller: { type: "direct" },
          },
        })
      );
      for (const partialJson of splitCodePoints(
        canonicalMockLlmJson(segment.input),
        plan.cadence.chunkSize
      )) {
        frames.push(
          anthropicSseFrame("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: partialJson },
          })
        );
      }
    }
    frames.push(
      anthropicSseFrame("content_block_stop", {
        type: "content_block_stop",
        index,
      })
    );
  }

  frames.push(
    anthropicSseFrame("message_delta", {
      type: "message_delta",
      delta: {
        container: null,
        stop_details: null,
        stop_reason: ANTHROPIC_STOP_REASON[plan.stopReason],
        stop_sequence: plan.stopSequence ?? null,
      },
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        input_tokens: plan.usage.inputTokens,
        output_tokens: plan.usage.outputTokens,
        output_tokens_details: null,
        server_tool_use: null,
      },
    })
  );
  frames.push(
    anthropicSseFrame("message_stop", {
      type: "message_stop",
    })
  );
  return {
    kind: "sse",
    status: 200,
    headers: eventStreamHeaders(plan.planId),
    frames,
  };
};

const renderAnthropicError = (plan: MockLlmErrorPlan): RenderedLlmWire => ({
  kind: "json",
  status: ANTHROPIC_ERROR_STATUS[plan.error.kind],
  headers: errorHeaders(plan),
  body: {
    type: "error",
    error: {
      type: ANTHROPIC_ERROR_TYPE[plan.error.kind],
      message: plan.error.message,
    },
    request_id: plan.planId,
  },
});

/**
 * Projects one provider-neutral plan into the Anthropic Messages dialect.
 * Streaming returns immediate frames; the edge runtime remains responsible for
 * cadence.
 */
export const renderAnthropicPlan = (
  plan: MockLlmPlan,
  options: RenderLlmPlanOptions
): RenderedLlmWire => {
  if (plan.kind === "error") return renderAnthropicError(plan);
  return options.stream
    ? renderAnthropicSseResponse(plan)
    : renderAnthropicJsonResponse(plan);
};
