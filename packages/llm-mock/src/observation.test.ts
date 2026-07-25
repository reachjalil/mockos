import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockLlmProviderObservationPrivacyGuard,
  MOCK_LLM_OBSERVATION_RESERVATION_BUDGET_MILLISECONDS,
  type MockLlmProviderObservationHook,
  type MockLlmProviderObservationStart,
  reserveMockLlmProviderObservation,
} from "./observation";

type MockLlmProviderResponseObservationStart = Extract<
  MockLlmProviderObservationStart,
  { readonly dialect: "openai"; readonly response: unknown }
>;

const responseObservation = (
  overrides: Partial<MockLlmProviderResponseObservationStart> = {}
): MockLlmProviderResponseObservationStart => ({
  observationId: "req_safe_observation_0123456789",
  responseId: "chatcmpl-safe-response-0123456789",
  dialect: "openai",
  operation: "chat.completions.create",
  slug: "safe-server",
  method: "POST",
  path: "/chat/completions",
  model: "safe-model",
  stream: false,
  turnIndex: 0,
  response: {
    inputTokens: 11,
    outputTokens: 5,
    stopReason: "end_turn",
    toolNames: [],
  },
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mock LLM provider observation privacy", () => {
  it("rejects strict and accept-any credential collisions across every prospective metadata class", async () => {
    const cases: readonly {
      readonly credential: string;
      readonly event?: MockLlmProviderObservationStart;
      readonly metadata?: unknown;
    }[] = [
      {
        credential: "chat.completions.create",
        event: responseObservation({ operation: "chat.completions.create" }),
      },
      {
        credential: "credential-slug-01",
        event: responseObservation({ slug: "credential-slug-01" }),
      },
      {
        credential: "credential-model-01",
        event: responseObservation({ model: "credential-model-01" }),
      },
      {
        credential: "chatcmpl-secret-response-01",
        event: responseObservation({ responseId: "chatcmpl-secret-response-01" }),
      },
      {
        credential: "req_secret_observation_01",
        event: responseObservation({ observationId: "req_secret_observation_01" }),
      },
      {
        credential: "credential-tool-name-01",
        event: responseObservation({
          response: {
            inputTokens: 11,
            outputTokens: 5,
            stopReason: "tool_use",
            toolNames: ["credential-tool-name-01"],
          },
        }),
      },
      {
        credential: "credential-path-01",
        metadata: {
          requestPath:
            "/e/credential-path-01/llm-mock/safe-server/openai/v1/chat/completions",
        },
      },
      {
        credential: "9007199254740991",
        metadata: { serverRevision: 9_007_199_254_740_991 },
      },
      {
        credential: "deadline_exceeded",
      },
    ];

    for (const testCase of cases) {
      const hook: MockLlmProviderObservationHook = {
        reserve: vi.fn(),
        finish: vi.fn(),
      };
      const reserved = await reserveMockLlmProviderObservation(
        hook,
        testCase.event ?? responseObservation(),
        createMockLlmProviderObservationPrivacyGuard([testCase.credential]),
        testCase.metadata ?? { requestPath: "/safe/provider/path", serverRevision: 1 }
      );
      expect(reserved, testCase.credential).toBe(false);
      expect(hook.reserve, testCase.credential).not.toHaveBeenCalled();
    }
  });

  it("preserves complete legitimate metadata", async () => {
    const hook: MockLlmProviderObservationHook = {
      reserve: vi.fn(),
      finish: vi.fn(),
    };
    const event = responseObservation();
    const guard = createMockLlmProviderObservationPrivacyGuard([
      "synthetic-provider-credential",
    ]);

    await expect(
      reserveMockLlmProviderObservation(hook, event, guard, {
        requestPath: "/e/env_safe/llm-mock/safe-server/openai/v1/chat/completions",
        serverRevision: 7,
      })
    ).resolves.toBe(true);
    expect(hook.reserve).toHaveBeenCalledWith(event, guard);
  });

  it("bounds a never-settling reservation without treating it as reserved later", async () => {
    vi.useFakeTimers();
    const hook: MockLlmProviderObservationHook = {
      reserve: vi.fn(() => new Promise<void>(() => {})),
      finish: vi.fn(),
    };
    let settled = false;
    const result = reserveMockLlmProviderObservation(
      hook,
      responseObservation(),
      createMockLlmProviderObservationPrivacyGuard(["synthetic-provider-credential"]),
      { requestPath: "/safe/provider/path", serverRevision: 1 }
    ).then((reserved) => {
      settled = true;
      return reserved;
    });

    await vi.advanceTimersByTimeAsync(
      MOCK_LLM_OBSERVATION_RESERVATION_BUDGET_MILLISECONDS - 1
    );
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(hook.reserve).toHaveBeenCalledTimes(1);
  });
});
