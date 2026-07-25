import { describe, expect, it } from "vitest";
import {
  MOCK_LLM_MAX_CHUNK_SIZE,
  MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS,
  MOCK_LLM_MAX_SEGMENTS,
  MOCK_LLM_MAX_STREAM_CHUNKS,
  MOCK_LLM_MAX_TEXT_LENGTH,
  MOCK_LLM_MAX_TOKEN_COUNT,
  MOCK_LLM_MAX_TOOL_NAME_LENGTH,
  MockLlmPlanBoundsError,
  mockLlmErrorKindSchema,
  mockLlmPlanSchema,
  parseMockLlmPlan,
} from "./mock-llm";

const basePlan = {
  version: 1,
  planId: `llmp_${"A".repeat(43)}`,
  requestHash: "a".repeat(64),
  model: "mockos-test-1",
  createdAtEpochSeconds: 1_784_915_200,
  turnIndex: 0,
  seed: "deterministic-seed",
} as const;

const cadence = {
  initialDelayMilliseconds: 0,
  chunkDelayMilliseconds: 10,
  chunkSize: 16,
  maximumDurationMilliseconds: 60_000,
} as const;

const responsePlan = {
  ...basePlan,
  kind: "response",
  segments: [{ type: "text", text: "Hello." }],
  stopReason: "end_turn",
  usage: { inputTokens: 4, outputTokens: 2 },
  cadence,
} as const;

describe("neutral mock LLM plan contracts", () => {
  it("accepts bounded text and tool-call response plans", () => {
    expect(parseMockLlmPlan(responsePlan)).toEqual(responsePlan);

    const toolPlan = parseMockLlmPlan({
      ...responsePlan,
      segments: [
        { type: "text", text: "I will look that up." },
        {
          type: "tool_call",
          id: "call_weather_1",
          name: "get_weather",
          input: { location: "Berlin", units: "celsius" },
        },
      ],
      stopReason: "tool_use",
    });

    expect(toolPlan.kind).toBe("response");
    if (toolPlan.kind !== "response") throw new Error("Expected response plan.");
    expect(toolPlan.segments).toHaveLength(2);
  });

  it("accepts every provider-neutral error kind and scopes Retry-After", () => {
    const kinds = mockLlmErrorKindSchema.options;
    expect(kinds).toEqual([
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
    for (const kind of kinds) {
      expect(
        parseMockLlmPlan({
          ...basePlan,
          kind: "error",
          initialDelayMilliseconds: 0,
          error: {
            kind,
            message: `Synthetic ${kind}.`,
            ...(kind === "rate_limit" || kind === "overloaded"
              ? { retryAfterSeconds: 5 }
              : {}),
          },
        })
      ).toMatchObject({ kind: "error", error: { kind } });
    }

    expect(() =>
      mockLlmPlanSchema.parse({
        ...basePlan,
        kind: "error",
        initialDelayMilliseconds: 0,
        error: {
          kind: "authentication",
          message: "No.",
          retryAfterSeconds: 5,
        },
      })
    ).toThrow(/only valid/);
  });

  it("locks segment ordering, unique tool IDs, and tool stop semantics", () => {
    const tool = {
      type: "tool_call",
      id: "call_1",
      name: "lookup",
      input: {},
    } as const;
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: [tool, { type: "text", text: "late" }],
        stopReason: "tool_use",
      })
    ).toThrow(/precede/);
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: [tool, tool],
        stopReason: "tool_use",
      })
    ).toThrow(/duplicated/);
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: [{ type: "text", text: "No tool." }],
        stopReason: "tool_use",
      })
    ).toThrow(/requires/);
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: [tool],
        stopReason: "end_turn",
      })
    ).toThrow(/must stop/);
    for (const name of [
      "not allowed",
      "unicode_é",
      "x".repeat(MOCK_LLM_MAX_TOOL_NAME_LENGTH + 1),
    ]) {
      expect(() =>
        mockLlmPlanSchema.parse({
          ...responsePlan,
          segments: [{ ...tool, name }],
          stopReason: "tool_use",
        })
      ).toThrow();
    }
  });

  it("requires a stop sequence exactly when it caused the stop", () => {
    expect(
      parseMockLlmPlan({
        ...responsePlan,
        stopReason: "stop_sequence",
        stopSequence: "DONE",
      })
    ).toMatchObject({ stopReason: "stop_sequence", stopSequence: "DONE" });
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        stopReason: "stop_sequence",
      })
    ).toThrow(/requires/);
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        stopSequence: "DONE",
      })
    ).toThrow(/only valid/);
  });

  it("rejects provider wire fields and unsafe scalar boundaries", () => {
    for (const extra of [
      { choices: [] },
      { content: [] },
      { finish_reason: "stop" },
      { provider: "openai" },
    ]) {
      expect(() => mockLlmPlanSchema.parse({ ...responsePlan, ...extra })).toThrow();
    }
    for (const invalid of [
      { planId: `llmp_${"A".repeat(42)}` },
      { requestHash: "A".repeat(64) },
      { model: "model with spaces" },
      { model: "model\nname" },
      { model: "." },
      { model: ".." },
      { createdAtEpochSeconds: Number.MAX_SAFE_INTEGER + 1 },
      { turnIndex: -1 },
      { seed: "" },
    ]) {
      expect(() => mockLlmPlanSchema.parse({ ...responsePlan, ...invalid })).toThrow();
    }
    expect(() =>
      mockLlmPlanSchema.parse({
        ...basePlan,
        kind: "error",
        initialDelayMilliseconds: MOCK_LLM_MAX_INITIAL_DELAY_MILLISECONDS + 1,
        error: {
          kind: "internal",
          message: "Too late.",
        },
      })
    ).toThrow();
  });

  it("enforces collection, usage, cadence, and finite-number bounds", () => {
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: Array.from({ length: MOCK_LLM_MAX_SEGMENTS + 1 }, () => ({
          type: "text",
          text: "",
        })),
      })
    ).toThrow();
    expect(() =>
      mockLlmPlanSchema.parse({
        ...responsePlan,
        segments: [{ type: "text", text: "x".repeat(MOCK_LLM_MAX_TEXT_LENGTH + 1) }],
      })
    ).toThrow();
    for (const usage of [
      { inputTokens: -1, outputTokens: 0 },
      { inputTokens: 0.5, outputTokens: 0 },
      { inputTokens: 0, outputTokens: MOCK_LLM_MAX_TOKEN_COUNT + 1 },
      { inputTokens: Number.NaN, outputTokens: 0 },
    ]) {
      expect(() => mockLlmPlanSchema.parse({ ...responsePlan, usage })).toThrow();
    }
    for (const invalidCadence of [
      { ...cadence, initialDelayMilliseconds: 30_001 },
      { ...cadence, chunkDelayMilliseconds: 10_001 },
      { ...cadence, chunkSize: 0 },
      { ...cadence, chunkSize: MOCK_LLM_MAX_CHUNK_SIZE + 1 },
      { ...cadence, maximumDurationMilliseconds: 0 },
      {
        ...cadence,
        initialDelayMilliseconds: 101,
        maximumDurationMilliseconds: 100,
      },
      {
        ...cadence,
        chunkDelayMilliseconds: 101,
        maximumDurationMilliseconds: 100,
      },
    ]) {
      expect(() =>
        mockLlmPlanSchema.parse({
          ...responsePlan,
          cadence: invalidCadence,
        })
      ).toThrow();
    }
    expect(() =>
      parseMockLlmPlan({
        ...responsePlan,
        segments: [
          {
            type: "text",
            text: "x".repeat(MOCK_LLM_MAX_STREAM_CHUNKS),
          },
        ],
        cadence: { ...cadence, chunkSize: 1 },
      })
    ).not.toThrow();
    expect(() =>
      parseMockLlmPlan({
        ...responsePlan,
        segments: [
          {
            type: "text",
            text: "x".repeat(MOCK_LLM_MAX_STREAM_CHUNKS + 1),
          },
        ],
        cadence: { ...cadence, chunkSize: 1 },
      })
    ).toThrow(/payload chunks/);
    expect(() =>
      parseMockLlmPlan({
        ...responsePlan,
        segments: [{ type: "text", text: "four" }],
        cadence: {
          initialDelayMilliseconds: 10,
          chunkDelayMilliseconds: 10,
          chunkSize: 1,
          maximumDurationMilliseconds: 41,
        },
      })
    ).not.toThrow();
    expect(() =>
      parseMockLlmPlan({
        ...responsePlan,
        segments: [{ type: "text", text: "four" }],
        cadence: {
          initialDelayMilliseconds: 10,
          chunkDelayMilliseconds: 10,
          chunkSize: 1,
          maximumDurationMilliseconds: 40,
        },
      })
    ).toThrow(/payload cadence/);
  });

  it("bounds UTF-8 bytes, depth, nodes, cycles, unsafe keys, and each tool input", () => {
    const asciiPlan = {
      ...responsePlan,
      cadence: { ...cadence, chunkSize: 64 },
      segments: Array.from({ length: 3 }, () => ({
        type: "text",
        text: "x".repeat(MOCK_LLM_MAX_TEXT_LENGTH),
      })),
    };
    expect(parseMockLlmPlan(asciiPlan)).toMatchObject({ kind: "response" });
    expect(() =>
      parseMockLlmPlan({
        ...asciiPlan,
        segments: Array.from({ length: 3 }, () => ({
          type: "text",
          text: "é".repeat(MOCK_LLM_MAX_TEXT_LENGTH),
        })),
      })
    ).toThrow(MockLlmPlanBoundsError);

    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index < 20; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    const toolPlan = (input: unknown) => ({
      ...responsePlan,
      segments: [
        {
          type: "tool_call",
          id: "call_1",
          name: "lookup",
          input,
        },
      ],
      stopReason: "tool_use",
    });
    expect(() => parseMockLlmPlan(toolPlan(deeplyNested))).toThrow(
      MockLlmPlanBoundsError
    );
    expect(() =>
      parseMockLlmPlan(toolPlan({ values: Array.from({ length: 2_001 }, () => 1) }))
    ).toThrow(MockLlmPlanBoundsError);
    expect(() => parseMockLlmPlan(toolPlan({ blob: "x".repeat(70 * 1024) }))).toThrow(
      MockLlmPlanBoundsError
    );
    expect(() =>
      parseMockLlmPlan(
        toolPlan(JSON.parse('{"__proto__":{"polluted":true}}') as unknown)
      )
    ).toThrow(MockLlmPlanBoundsError);
    expect(() => parseMockLlmPlan(toolPlan({ value: Number.NaN }))).toThrow();

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => parseMockLlmPlan(toolPlan(cycle))).toThrow(MockLlmPlanBoundsError);

    const manyNodes = {
      ...responsePlan,
      segments: Array.from({ length: 4 }, (_, index) => ({
        type: "tool_call",
        id: `call_${index}`,
        name: "lookup",
        input: { values: Array.from({ length: 1_500 }, () => 1) },
      })),
      stopReason: "tool_use",
    };
    expect(() => parseMockLlmPlan(manyNodes)).toThrow(MockLlmPlanBoundsError);
  });

  it("detaches and deep-freezes the parsed plan", () => {
    const input = {
      ...responsePlan,
      segments: [{ type: "text", text: "original" }],
    };
    const parsed = parseMockLlmPlan(input);

    const mutableSegment = input.segments[0];
    if (!mutableSegment) throw new Error("Expected input segment.");
    mutableSegment.text = "mutated";
    expect(parsed.kind).toBe("response");
    if (parsed.kind !== "response") throw new Error("Expected response plan.");
    expect(parsed.segments[0]).toEqual({ type: "text", text: "original" });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.segments)).toBe(true);
    expect(Object.isFrozen(parsed.segments[0])).toBe(true);
    expect(Object.isFrozen(parsed.usage)).toBe(true);
    expect(Object.isFrozen(parsed.cadence)).toBe(true);
    expect(() => {
      (parsed.segments as unknown as Array<unknown>).push({
        type: "text",
        text: "late mutation",
      });
    }).toThrow();
  });
});
