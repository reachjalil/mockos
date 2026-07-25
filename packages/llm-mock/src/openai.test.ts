import { type MockLlmPlan, parseMockLlmPlan } from "@mockos/contracts/mock-llm";
import { describe, expect, it } from "vitest";
import expectedCompletion from "../fixtures/openai/chat-completion.json";
import expectedStream from "../fixtures/openai/chat-completion-stream.json";
import responsePlanFixture from "../fixtures/response-plan.json";
import { canonicalMockLlmJson } from "./canonical-json";
import { renderOpenAiPlan } from "./openai";

const responsePlan = () => parseMockLlmPlan(responsePlanFixture);

const errorPlan = (
  kind: Extract<MockLlmPlan, { readonly kind: "error" }>["error"]["kind"],
  retryAfterSeconds?: number
): MockLlmPlan =>
  parseMockLlmPlan({
    version: 1,
    kind: "error",
    planId: "llmp_0123456789abcdef0123456789abcdef0123456789a",
    requestHash: "b".repeat(64),
    model: "mockos-chat-1",
    createdAtEpochSeconds: 1784973600,
    turnIndex: 2,
    seed: "fixture-seed",
    initialDelayMilliseconds: 0,
    error: {
      kind,
      message: `Synthetic ${kind} failure.`,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  });

describe("OpenAI Chat Completions rendering", () => {
  it("renders current JSON shape with canonical function arguments", () => {
    const wire = renderOpenAiPlan(responsePlan(), { stream: false });

    expect(wire).toMatchObject({
      kind: "json",
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": responsePlanFixture.planId,
      },
    });
    expect(wire.kind).toBe("json");
    if (wire.kind !== "json") throw new Error("Expected JSON wire output.");
    expect(wire.body).toEqual(expectedCompletion);
    expect(canonicalMockLlmJson({ "2": "two", "10": "ten" })).toBe(
      '{"10":"ten","2":"two"}'
    );
  });

  it("renders immediate SSE frames including requested usage and DONE", () => {
    const wire = renderOpenAiPlan(responsePlan(), {
      stream: true,
      includeUsage: true,
    });

    expect(wire).toMatchObject({
      kind: "sse",
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": responsePlanFixture.planId,
      },
    });
    expect(wire.kind).toBe("sse");
    if (wire.kind !== "sse") throw new Error("Expected SSE wire output.");
    expect(wire.frames).toEqual(expectedStream);
  });

  it("chunks by Unicode code point without emitting an unrequested usage chunk", () => {
    const plan = parseMockLlmPlan({
      ...responsePlanFixture,
      cadence: { ...responsePlanFixture.cadence, chunkSize: 4 },
    });
    const wire = renderOpenAiPlan(plan, { stream: true });
    if (wire.kind !== "sse") throw new Error("Expected SSE wire output.");

    type Chunk = {
      readonly choices?: readonly {
        readonly delta?: { readonly content?: string };
      }[];
      readonly usage?: unknown;
    };
    const chunks = wire.frames
      .filter((frame) => frame !== "data: [DONE]\n\n")
      .map(
        (frame) => JSON.parse(frame.slice("data: ".length).trim()) as Readonly<Chunk>
      );
    expect(
      chunks
        .map((chunk) => chunk.choices?.[0]?.delta?.content)
        .filter((text): text is string => text !== undefined && text !== "")
    ).toEqual(["Hi 🧪", "!"]);
    expect(chunks.every((chunk) => !("usage" in chunk))).toBe(true);
    expect(chunks.some((chunk) => chunk.choices?.length === 0)).toBe(false);
  });

  it.each([
    ["invalid_request", 400, "invalid_request_error"],
    ["authentication", 401, "authentication_error"],
    ["permission_denied", 403, "permission_error"],
    ["not_found", 404, "invalid_request_error"],
    ["request_too_large", 413, "request_too_large_error"],
    ["rate_limit", 429, "rate_limit_error"],
    ["timeout", 408, "timeout_error"],
    ["internal", 500, "api_error"],
    ["overloaded", 503, "server_error"],
  ] as const)(
    "maps %s without leaking provider details into the neutral plan",
    (kind, status, type) => {
      const wire = renderOpenAiPlan(errorPlan(kind), { stream: true });
      expect(wire).toMatchObject({
        kind: "json",
        status,
        body: {
          error: {
            message: `Synthetic ${kind} failure.`,
            type,
            param: null,
            code: kind,
          },
        },
      });
    }
  );

  it("emits Retry-After only for an eligible neutral error", () => {
    const wire = renderOpenAiPlan(errorPlan("rate_limit", 17), {
      stream: false,
    });
    expect(wire.headers["retry-after"]).toBe("17");
  });
});
