import type { MockLlmPlan } from "@mockos/contracts/mock-llm";
import { canonicalMockLlmJson } from "./canonical-json";
import type {
  RenderedLlmSseFrame,
  RenderedLlmWire,
  RenderLlmPlanOptions,
} from "./wire";

type MockLlmResponsePlan = Extract<MockLlmPlan, { readonly kind: "response" }>;
type MockLlmErrorPlan = Extract<MockLlmPlan, { readonly kind: "error" }>;
type MockLlmErrorKind = MockLlmErrorPlan["error"]["kind"];
type MockLlmStopReason = MockLlmResponsePlan["stopReason"];

export type RenderOpenAiPlanOptions = RenderLlmPlanOptions & {
  /**
   * Provider invocation identity. Pure callers may omit both values and retain
   * the deterministic plan ID used by the source fixtures.
   */
  readonly requestId?: string;
  readonly responseId?: string;
  /**
   * Adds opaque, response-scoped compatibility padding to delta events. This
   * mirrors the current OpenAI event shape but does not claim to reproduce the
   * upstream service's undisclosed payload-size distribution.
   */
  readonly includeObfuscation?: boolean;
};

type OpenAiWireIdentity = {
  readonly requestId: string;
  readonly responseId: string;
};

const OPENAI_ERROR_STATUS = {
  invalid_request: 400,
  authentication: 401,
  permission_denied: 403,
  not_found: 404,
  request_too_large: 413,
  rate_limit: 429,
  timeout: 408,
  internal: 500,
  overloaded: 503,
} as const satisfies Record<MockLlmErrorKind, number>;

const OPENAI_ERROR_TYPE = {
  invalid_request: "invalid_request_error",
  authentication: "authentication_error",
  permission_denied: "permission_error",
  not_found: "invalid_request_error",
  request_too_large: "request_too_large_error",
  rate_limit: "rate_limit_error",
  timeout: "timeout_error",
  internal: "api_error",
  overloaded: "server_error",
} as const satisfies Record<MockLlmErrorKind, string>;

const OPENAI_FINISH_REASON = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
} as const satisfies Record<MockLlmStopReason, string>;

const jsonHeaders = (requestId: string): Readonly<Record<string, string>> => ({
  "content-type": "application/json",
  "x-request-id": requestId,
});

const eventStreamHeaders = (requestId: string): Readonly<Record<string, string>> => ({
  "content-type": "text/event-stream",
  "x-request-id": requestId,
});

const errorHeaders = (
  plan: MockLlmErrorPlan,
  requestId: string
): Readonly<Record<string, string>> => ({
  ...jsonHeaders(requestId),
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

const toolCalls = (plan: MockLlmResponsePlan) =>
  plan.segments
    .filter(
      (
        segment
      ): segment is Extract<
        MockLlmResponsePlan["segments"][number],
        { readonly type: "tool_call" }
      > => segment.type === "tool_call"
    )
    .map((segment) => ({
      id: segment.id,
      type: "function" as const,
      function: {
        arguments: canonicalMockLlmJson(segment.input),
        name: segment.name,
      },
    }));

const completionUsage = (plan: MockLlmResponsePlan) => ({
  completion_tokens: plan.usage.outputTokens,
  prompt_tokens: plan.usage.inputTokens,
  total_tokens: plan.usage.inputTokens + plan.usage.outputTokens,
});

const renderOpenAiJsonResponse = (
  plan: MockLlmResponsePlan,
  identity: OpenAiWireIdentity
): RenderedLlmWire => {
  const textSegments = plan.segments.filter(
    (
      segment
    ): segment is Extract<
      MockLlmResponsePlan["segments"][number],
      { readonly type: "text" }
    > => segment.type === "text"
  );
  const calls = toolCalls(plan);
  return {
    kind: "json",
    status: 200,
    headers: jsonHeaders(identity.requestId),
    body: {
      id: identity.responseId,
      object: "chat.completion",
      created: plan.createdAtEpochSeconds,
      model: plan.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              textSegments.length === 0
                ? null
                : textSegments.map((segment) => segment.text).join(""),
            refusal: null,
            ...(calls.length === 0 ? {} : { tool_calls: calls }),
          },
          logprobs: null,
          finish_reason: OPENAI_FINISH_REASON[plan.stopReason],
        },
      ],
      usage: completionUsage(plan),
    },
  };
};

const openAiSseFrame = (
  event: Readonly<Record<string, unknown>>,
  cadence: RenderedLlmSseFrame["cadence"] = "immediate"
): RenderedLlmSseFrame => ({
  data: `data: ${JSON.stringify(event)}\n\n`,
  cadence,
});

const openAiChunk = (
  plan: MockLlmResponsePlan,
  responseId: string,
  choice: Readonly<Record<string, unknown>>,
  includeUsage: boolean,
  obfuscation?: string
): Readonly<Record<string, unknown>> => ({
  id: responseId,
  object: "chat.completion.chunk",
  created: plan.createdAtEpochSeconds,
  model: plan.model,
  choices: [choice],
  ...(includeUsage ? { usage: null } : {}),
  ...(obfuscation === undefined ? {} : { obfuscation }),
});

const renderOpenAiSseResponse = (
  plan: MockLlmResponsePlan,
  identity: OpenAiWireIdentity,
  includeUsage: boolean,
  includeObfuscation: boolean
): RenderedLlmWire => {
  let eventIndex = 0;
  const chunk = (
    choice: Readonly<Record<string, unknown>>
  ): Readonly<Record<string, unknown>> =>
    openAiChunk(
      plan,
      identity.responseId,
      choice,
      includeUsage,
      includeObfuscation
        ? `mockos_${identity.responseId.slice(-16)}_${eventIndex++}`
        : undefined
    );
  const frames: RenderedLlmSseFrame[] = [
    openAiSseFrame(
      chunk({
        index: 0,
        delta: { role: "assistant", content: "", refusal: null },
        logprobs: null,
        finish_reason: null,
      })
    ),
  ];

  let toolIndex = 0;
  for (const segment of plan.segments) {
    if (segment.type === "text") {
      for (const text of splitCodePoints(segment.text, plan.cadence.chunkSize)) {
        frames.push(
          openAiSseFrame(
            chunk({
              index: 0,
              delta: { content: text },
              logprobs: null,
              finish_reason: null,
            }),
            "payload"
          )
        );
      }
      continue;
    }

    const argumentChunks = splitCodePoints(
      canonicalMockLlmJson(segment.input),
      plan.cadence.chunkSize
    );
    const firstArguments = argumentChunks[0] ?? "";
    frames.push(
      openAiSseFrame(
        chunk({
          index: 0,
          delta: {
            tool_calls: [
              {
                index: toolIndex,
                id: segment.id,
                type: "function",
                function: {
                  name: segment.name,
                  arguments: firstArguments,
                },
              },
            ],
          },
          logprobs: null,
          finish_reason: null,
        }),
        "payload"
      )
    );
    for (const argumentChunk of argumentChunks.slice(1)) {
      frames.push(
        openAiSseFrame(
          chunk({
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: toolIndex,
                  function: { arguments: argumentChunk },
                },
              ],
            },
            logprobs: null,
            finish_reason: null,
          }),
          "payload"
        )
      );
    }
    toolIndex += 1;
  }

  frames.push(
    openAiSseFrame(
      chunk({
        index: 0,
        delta: {},
        logprobs: null,
        finish_reason: OPENAI_FINISH_REASON[plan.stopReason],
      })
    )
  );
  if (includeUsage) {
    frames.push(
      openAiSseFrame({
        id: identity.responseId,
        object: "chat.completion.chunk",
        created: plan.createdAtEpochSeconds,
        model: plan.model,
        choices: [],
        usage: completionUsage(plan),
      })
    );
  }
  frames.push({ data: "data: [DONE]\n\n", cadence: "immediate" });
  return {
    kind: "sse",
    status: 200,
    headers: eventStreamHeaders(identity.requestId),
    frames,
  };
};

const renderOpenAiError = (
  plan: MockLlmErrorPlan,
  requestId: string
): RenderedLlmWire => ({
  kind: "json",
  status: OPENAI_ERROR_STATUS[plan.error.kind],
  headers: errorHeaders(plan, requestId),
  body: {
    error: {
      message: plan.error.message,
      type: OPENAI_ERROR_TYPE[plan.error.kind],
      param: null,
      code: plan.error.kind,
    },
  },
});

/**
 * Projects one provider-neutral plan into the Chat Completions dialect. Streaming
 * returns immediate SSE frames; the edge runtime remains responsible for cadence.
 */
export const renderOpenAiPlan = (
  plan: MockLlmPlan,
  options: RenderOpenAiPlanOptions
): RenderedLlmWire => {
  const identity = {
    requestId: options.requestId ?? plan.planId,
    responseId: options.responseId ?? plan.planId,
  };
  if (plan.kind === "error") return renderOpenAiError(plan, identity.requestId);
  return options.stream
    ? renderOpenAiSseResponse(
        plan,
        identity,
        options.includeUsage === true,
        options.includeObfuscation === true
      )
    : renderOpenAiJsonResponse(plan, identity);
};
