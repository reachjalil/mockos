import { type MockLlmPlan, parseMockLlmPlan } from "@mockos/contracts/mock-llm";
import { describe, expect, it } from "vitest";
import expectedMessage from "../fixtures/anthropic/message.json";
import expectedStream from "../fixtures/anthropic/message-stream.json";
import responsePlanFixture from "../fixtures/response-plan.json";
import { renderAnthropicPlan } from "./anthropic";

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

describe("Anthropic Messages rendering", () => {
  it("renders current JSON shape with direct tool use and complete usage", () => {
    const wire = renderAnthropicPlan(responsePlan(), { stream: false });

    expect(wire).toMatchObject({
      kind: "json",
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": responsePlanFixture.planId,
      },
    });
    expect(wire.kind).toBe("json");
    if (wire.kind !== "json") throw new Error("Expected JSON wire output.");
    expect(wire.body).toEqual(expectedMessage);
  });

  it("renders the complete immediate named-event sequence", () => {
    const wire = renderAnthropicPlan(responsePlan(), { stream: true });

    expect(wire).toMatchObject({
      kind: "sse",
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "request-id": responsePlanFixture.planId,
      },
    });
    expect(wire.kind).toBe("sse");
    if (wire.kind !== "sse") throw new Error("Expected SSE wire output.");
    expect(wire.frames.map((frame) => frame.data)).toEqual(expectedStream);
    expect(
      wire.frames.map((frame) => frame.data.slice("event: ".length).split("\n")[0])
    ).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(
      wire.frames
        .filter((frame) => frame.cadence === "payload")
        .map((frame) => frame.data.slice("event: ".length).split("\n")[0])
    ).toEqual(["content_block_delta", "content_block_delta"]);
  });

  it("preserves the matched stop sequence in Messages JSON", () => {
    const plan = parseMockLlmPlan({
      ...responsePlanFixture,
      segments: [{ type: "text", text: "Complete." }],
      stopReason: "stop_sequence",
      stopSequence: "<END>",
    });
    const wire = renderAnthropicPlan(plan, { stream: false });
    if (wire.kind !== "json") throw new Error("Expected JSON wire output.");

    expect(wire.body).toMatchObject({
      stop_reason: "stop_sequence",
      stop_sequence: "<END>",
    });
  });

  it.each([
    ["invalid_request", 400, "invalid_request_error"],
    ["authentication", 401, "authentication_error"],
    ["permission_denied", 403, "permission_error"],
    ["not_found", 404, "not_found_error"],
    ["request_too_large", 413, "request_too_large"],
    ["rate_limit", 429, "rate_limit_error"],
    ["timeout", 504, "timeout_error"],
    ["internal", 500, "api_error"],
    ["overloaded", 529, "overloaded_error"],
  ] as const)(
    "maps %s into the documented Anthropic error envelope",
    (kind, status, type) => {
      const plan = errorPlan(kind);
      const wire = renderAnthropicPlan(plan, { stream: true });
      expect(wire).toMatchObject({
        kind: "json",
        status,
        headers: { "request-id": plan.planId },
        body: {
          type: "error",
          error: {
            type,
            message: `Synthetic ${kind} failure.`,
          },
          request_id: plan.planId,
        },
      });
    }
  );

  it("emits Retry-After only for an eligible neutral error", () => {
    const wire = renderAnthropicPlan(errorPlan("overloaded", 23), {
      stream: false,
    });
    expect(wire.headers["retry-after"]).toBe("23");
  });
});
