import { type MockLlmPlan, parseMockLlmPlan } from "@mockos/contracts/mock-llm";
import type { RenderedLlmWire } from "./wire";

export const TEST_CREATED_EPOCH_SECONDS = 1_785_000_000;
export const TEST_MODEL = "mockos-text-1";

const commonPlan = {
  version: 1,
  planId: `llmp_${"A".repeat(43)}`,
  requestHash: "b".repeat(64),
  model: TEST_MODEL,
  createdAtEpochSeconds: TEST_CREATED_EPOCH_SECONDS,
  turnIndex: 1,
  seed: "sdk-conformance-seed",
} as const;

const cadence = {
  initialDelayMilliseconds: 0,
  chunkDelayMilliseconds: 20,
  chunkSize: 3,
  maximumDurationMilliseconds: 5_000,
} as const;

export const textPlan = (): MockLlmPlan =>
  parseMockLlmPlan({
    ...commonPlan,
    kind: "response",
    segments: [{ type: "text", text: "Hello from mockOS." }],
    stopReason: "end_turn",
    usage: { inputTokens: 11, outputTokens: 5 },
    cadence,
  });

export const toolPlan = (): MockLlmPlan =>
  parseMockLlmPlan({
    ...commonPlan,
    planId: `llmp_${"B".repeat(43)}`,
    kind: "response",
    segments: [
      { type: "text", text: "Checking." },
      {
        type: "tool_call",
        id: "call_weather_1",
        name: "get_weather",
        input: { units: "celsius", location: "Berlin" },
      },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 17, outputTokens: 9 },
    cadence,
  });

export const errorPlan = (
  kind: "rate_limit" | "authentication" = "rate_limit"
): MockLlmPlan =>
  parseMockLlmPlan({
    ...commonPlan,
    planId: `llmp_${"C".repeat(43)}`,
    kind: "error",
    initialDelayMilliseconds: 0,
    error: {
      kind,
      message: `Synthetic ${kind.replaceAll("_", " ")}.`,
      ...(kind === "rate_limit" ? { retryAfterSeconds: 3 } : {}),
    },
  });

export const wireToResponse = (wire: RenderedLlmWire): Response =>
  new Response(
    wire.kind === "json"
      ? JSON.stringify(wire.body)
      : wire.frames.map((frame) => frame.data).join(""),
    {
      status: wire.status,
      headers: wire.headers,
    }
  );

export const requestFromFetchInput = (
  input: RequestInfo | URL,
  init?: RequestInit
): Request => new Request(input, init);
