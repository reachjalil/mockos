import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import type { BehaviorStateAccess } from "@mockos/core";
import { describe, expect, it, vi } from "vitest";
import {
  createStatelessTurnBehaviorState,
  type MockLlmPlanningInput,
  planMockLlmResponse,
} from "./planner";

const baseInput = (
  behavior: BehaviorSpec,
  overrides: Partial<MockLlmPlanningInput> = {}
): MockLlmPlanningInput => ({
  behavior,
  requestFingerprintInput: {
    dialect: "neutral",
    prompt: "Hello",
    messages: [{ role: "user", content: "Hello" }],
  },
  model: "mockos-text-1",
  createdAtEpochSeconds: 1_785_000_000,
  turnIndex: 0,
  seed: "fixture-seed",
  defaultUsage: { inputTokens: 7, outputTokens: 3 },
  defaultCadence: {
    chunkDelayMilliseconds: 25,
    chunkSize: 4,
    maximumDurationMilliseconds: 5_000,
  },
  ...overrides,
});

class MemoryBehaviorState implements BehaviorStateAccess {
  readonly values = new Map<string, JsonValue>();
  transactions = 0;
  writes = 0;

  read(key: string): JsonValue | undefined {
    return this.values.get(key);
  }

  write(key: string, value: JsonValue): void {
    this.writes += 1;
    this.values.set(key, value);
  }

  transaction<Value>(callback: () => Value): Value {
    this.transactions += 1;
    return callback();
  }
}

const responseText = (
  result: Awaited<ReturnType<typeof planMockLlmResponse>>
): string | undefined => {
  if (result.plan.kind !== "response") return undefined;
  const first = result.plan.segments[0];
  return first?.type === "text" ? first.text : undefined;
};

describe("neutral mock LLM planner", () => {
  it("snapshots caller input, adapts without waiting, and freezes the plan", async () => {
    const timer = vi.spyOn(globalThis, "setTimeout");
    const result = await planMockLlmResponse(
      baseInput({
        version: 1,
        type: "template",
        template: "Hello {{prompt}}",
        latency: {
          minimumMilliseconds: 275,
          maximumMilliseconds: 275,
          seed: "latency",
        },
      })
    );

    expect(responseText(result)).toBe("Hello Hello");
    expect(result.plan).toMatchObject({
      version: 1,
      kind: "response",
      model: "mockos-text-1",
      turnIndex: 0,
      usage: { inputTokens: 7, outputTokens: 3 },
      cadence: {
        initialDelayMilliseconds: 275,
        chunkDelayMilliseconds: 25,
      },
    });
    expect(result.plan.planId).toMatch(/^llmp_[A-Za-z0-9_-]{43}$/u);
    expect(result.plan.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(result.plan)).toBe(true);
    if (result.plan.kind === "response") {
      expect(Object.isFrozen(result.plan.segments)).toBe(true);
      expect(Object.isFrozen(result.plan.segments[0])).toBe(true);
      expect(Object.isFrozen(result.plan.cadence)).toBe(true);
    }
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();

    const mutableBehavior = {
      version: 1,
      type: "template",
      template: "Before {{prompt}}",
    } satisfies BehaviorSpec;
    const mutableRequest: Record<string, JsonValue> = { prompt: "before" };
    const mutableUsage = { inputTokens: 2, outputTokens: 1 };
    const mutableCadence = {
      chunkDelayMilliseconds: 10,
      chunkSize: 2,
      maximumDurationMilliseconds: 1_000,
    };
    const mutableInput = baseInput(mutableBehavior, {
      requestFingerprintInput: mutableRequest,
      defaultUsage: mutableUsage,
      defaultCadence: mutableCadence,
    });
    const pending = planMockLlmResponse(mutableInput);
    mutableBehavior.template = "After {{prompt}}";
    mutableRequest.prompt = "after";
    mutableUsage.inputTokens = 999;
    mutableCadence.chunkSize = 999;
    (mutableInput as { model: string }).model = "mutated-model";
    const snapshotted = await pending;

    expect(responseText(snapshotted)).toBe("Before before");
    expect(snapshotted.plan).toMatchObject({
      model: "mockos-text-1",
      usage: { inputTokens: 2, outputTokens: 1 },
      cadence: { chunkSize: 2 },
    });
  });

  it("uses canonical credential-free request material for stable fingerprints", async () => {
    const behavior = {
      version: 1,
      type: "static",
      value: "same",
    } satisfies BehaviorSpec;
    const left = await planMockLlmResponse(
      baseInput(behavior, {
        requestFingerprintInput: {
          model: "mock",
          max_tokens: 64,
          options: { alpha: 1, beta: 2 },
        },
      })
    );
    const right = await planMockLlmResponse(
      baseInput(behavior, {
        requestFingerprintInput: {
          options: { beta: 2, alpha: 1 },
          max_tokens: 64,
          model: "mock",
        },
      })
    );
    const changedUsage = await planMockLlmResponse(
      baseInput(behavior, {
        requestFingerprintInput: {
          model: "mock",
          max_tokens: 64,
          options: { alpha: 1, beta: 2 },
        },
        defaultUsage: { inputTokens: 8, outputTokens: 3 },
      })
    );

    expect(left.plan.requestHash).toBe(right.plan.requestHash);
    expect(left.plan.planId).toBe(right.plan.planId);
    expect(changedUsage.plan.requestHash).toBe(left.plan.requestHash);
    expect(changedUsage.plan.planId).not.toBe(left.plan.planId);

    const composed = "\u00e9";
    const decomposed = "e\u0301";
    const collidingLeft = await planMockLlmResponse(
      baseInput(behavior, {
        requestFingerprintInput: {
          [composed]: 1,
          [decomposed]: 2,
        },
      })
    );
    const collidingRight = await planMockLlmResponse(
      baseInput(behavior, {
        requestFingerprintInput: {
          [decomposed]: 2,
          [composed]: 1,
        },
      })
    );
    expect(collidingLeft.plan.requestHash).toBe(collidingRight.plan.requestHash);
    expect(collidingLeft.plan.planId).toBe(collidingRight.plan.planId);
  });

  it("selects stateless sequence steps from turnIndex without implicit persistence", async () => {
    const behavior = {
      version: 1,
      type: "sequence",
      mode: "hold_last",
      steps: [
        { version: 1, type: "static", value: "turn zero" },
        { version: 1, type: "static", value: "turn one" },
      ],
    } satisfies BehaviorSpec;
    const result = await planMockLlmResponse(
      baseInput(behavior, {
        turnIndex: 1,
        state: createStatelessTurnBehaviorState(1),
      })
    );

    expect(responseText(result)).toBe("turn one");
    expect(result.stateWrites).toEqual({});
    expect(() => result.commit()).not.toThrow();
  });

  it("does not advance injected state until a valid plan is explicitly committed", async () => {
    const state = new MemoryBehaviorState();
    const behavior = {
      version: 1,
      type: "sequence",
      mode: "hold_last",
      steps: [
        { version: 1, type: "static", value: "first" },
        { version: 1, type: "static", value: "second" },
      ],
    } satisfies BehaviorSpec;
    const first = await planMockLlmResponse(baseInput(behavior, { state }));

    expect(responseText(first)).toBe("first");
    expect(state.values.size).toBe(0);
    expect(state.transactions).toBe(0);
    first.commit();
    first.commit();
    expect(state.transactions).toBe(1);
    expect(state.writes).toBe(1);

    const second = await planMockLlmResponse(baseInput(behavior, { state }));
    expect(responseText(second)).toBe("second");
  });

  it("maps only neutral configured errors and rejects provider leakage", async () => {
    const result = await planMockLlmResponse(
      baseInput({
        version: 1,
        type: "error",
        code: "rate_limit",
        message: "Synthetic rate limit.",
        latency: {
          minimumMilliseconds: 275,
          maximumMilliseconds: 275,
          seed: "error-latency",
        },
      })
    );
    expect(result.plan).toMatchObject({
      kind: "error",
      initialDelayMilliseconds: 275,
      error: {
        kind: "rate_limit",
        message: "Synthetic rate limit.",
      },
    });
    const immediate = await planMockLlmResponse(
      baseInput({
        version: 1,
        type: "error",
        code: "rate_limit",
        message: "Synthetic rate limit.",
      })
    );
    expect(immediate.plan).toMatchObject({
      kind: "error",
      initialDelayMilliseconds: 0,
    });
    expect(immediate.plan.planId).not.toBe(result.plan.planId);

    await expect(
      planMockLlmResponse(
        baseInput({
          version: 1,
          type: "error",
          code: "rate_limit",
          message: "Do not leak HTTP policy.",
          status: 429,
        })
      )
    ).rejects.toMatchObject({
      code: "provider_error_leak",
    });
  });

  it("rejects invalid directives before exposing a commit and blocks secrets", async () => {
    const state = new MemoryBehaviorState();
    await expect(
      planMockLlmResponse(
        baseInput(
          {
            version: 1,
            type: "sequence",
            mode: "hold_last",
            steps: [{ version: 1, type: "static", value: { object: "provider" } }],
          },
          { state }
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_response_directive",
    });
    expect(state.values.size).toBe(0);
    expect(state.transactions).toBe(0);

    await expect(
      planMockLlmResponse(
        baseInput({
          version: 1,
          type: "static",
          value: {
            segments: [{ type: "text", text: "invalid cadence" }],
            cadence: "not-an-object",
          },
        })
      )
    ).rejects.toMatchObject({
      code: "invalid_response_directive",
    });

    for (const field of [
      "apiKey",
      "id_token",
      "api-token",
      "oauthToken",
      "token",
      "clientToken",
      "jwt",
      "assertion",
      "x_api_token",
    ]) {
      await expect(
        planMockLlmResponse(
          baseInput(
            { version: 1, type: "static", value: "never planned" },
            {
              requestFingerprintInput: {
                messages: [],
                [field]: "synthetic-but-still-sensitive",
              },
            }
          )
        )
      ).rejects.toMatchObject({
        code: "sensitive_request_field",
      });
    }

    for (const invalidValue of [Number.NaN, undefined]) {
      await expect(
        planMockLlmResponse(
          baseInput(
            { version: 1, type: "static", value: "never planned" },
            {
              requestFingerprintInput: {
                prompt: invalidValue as unknown as JsonValue,
              },
            }
          )
        )
      ).rejects.toMatchObject({
        code: "invalid_fingerprint_input",
      });
    }

    const execute = vi.fn(async () => "must not execute");
    await expect(
      planMockLlmResponse(
        baseInput(
          {
            version: 1,
            type: "script",
            script: {
              scriptId: "unreached",
              version: 1,
              sha256: "a".repeat(64),
            },
            onFailure: "propagate",
          },
          {
            defaultUsage: {
              inputTokens: Number.NaN,
              outputTokens: 0,
            },
            scripts: { execute },
          }
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_planning_metadata",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("supports match selection and explicit script fallback through the shared evaluator", async () => {
    const match = await planMockLlmResponse(
      baseInput({
        version: 1,
        type: "match",
        cases: [
          {
            when: { prompt: "Hello" },
            behavior: { version: 1, type: "static", value: "matched" },
          },
        ],
        fallback: { version: 1, type: "static", value: "fallback" },
      })
    );
    expect(responseText(match)).toBe("matched");

    const composed = "\u00e9";
    const decomposed = "e\u0301";
    const canonicalMatch = await planMockLlmResponse(
      baseInput(
        {
          version: 1,
          type: "match",
          cases: [
            {
              when: {
                payload: {
                  [composed]: 1,
                  [decomposed]: 2,
                },
              },
              behavior: { version: 1, type: "static", value: "matched" },
            },
          ],
          fallback: { version: 1, type: "static", value: "fallback" },
        },
        {
          requestFingerprintInput: {
            payload: {
              [decomposed]: 2,
              [composed]: 1,
            },
          },
        }
      )
    );
    expect(responseText(canonicalMatch)).toBe("matched");

    const scriptFallback = await planMockLlmResponse(
      baseInput({
        version: 1,
        type: "script",
        script: {
          scriptId: "future-script",
          version: 1,
          sha256: "a".repeat(64),
        },
        onFailure: "fallback",
        fallback: { version: 1, type: "static", value: "declarative fallback" },
      })
    );
    expect(responseText(scriptFallback)).toBe("declarative fallback");
  });
});
