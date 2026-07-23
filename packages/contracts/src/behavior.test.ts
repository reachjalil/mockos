import { describe, expect, it } from "vitest";
import {
  assertBehaviorSpecBounds,
  BehaviorSpecBoundsError,
  behaviorSpecSchema,
  parseBehaviorSpec,
} from "./behavior";
import { DEFAULT_F_SERIES_FEATURE_FLAGS, fSeriesFeatureFlagsSchema } from "./features";

describe("F-series behavior contract", () => {
  it("accepts all six locked version-one behavior variants", () => {
    const staticBehavior = behaviorSpecSchema.parse({
      version: 1,
      type: "static",
      value: { text: "hello", toolCalls: [] },
      latency: {
        minimumMilliseconds: 5,
        maximumMilliseconds: 25,
        seed: "stable-latency",
      },
    });
    const errorBehavior = behaviorSpecSchema.parse({
      version: 1,
      type: "error",
      code: "rate_limited",
      message: "Try again later.",
      status: 429,
    });

    expect(
      [
        staticBehavior,
        behaviorSpecSchema.parse({
          version: 1,
          type: "template",
          template: "Hello, {{name}}",
          data: { name: "Ada" },
        }),
        behaviorSpecSchema.parse({
          version: 1,
          type: "sequence",
          steps: [staticBehavior, errorBehavior],
        }),
        behaviorSpecSchema.parse({
          version: 1,
          type: "match",
          cases: [
            {
              when: { "request.model": "mockos-test" },
              behavior: staticBehavior,
            },
          ],
          fallback: errorBehavior,
        }),
        errorBehavior,
        behaviorSpecSchema.parse({
          version: 1,
          type: "script",
          script: {
            scriptId: "script_response",
            version: 3,
            sha256: "a".repeat(64),
          },
          onFailure: "fallback",
          fallback: errorBehavior,
        }),
      ].map(({ type }) => type)
    ).toEqual(["static", "template", "sequence", "match", "error", "script"]);
  });

  it("rejects proxy, unseeded latency, nested sequences, and ambiguous script fallback", () => {
    expect(() =>
      behaviorSpecSchema.parse({
        version: 1,
        type: "proxy",
        target: "https://example.test",
      })
    ).toThrow();
    expect(() =>
      behaviorSpecSchema.parse({
        version: 1,
        type: "static",
        value: "hello",
        latency: { maximumMilliseconds: 5 },
      })
    ).toThrow();
    expect(() =>
      behaviorSpecSchema.parse({
        version: 1,
        type: "sequence",
        steps: [
          {
            version: 1,
            type: "sequence",
            steps: [{ version: 1, type: "static", value: "nested" }],
          },
        ],
      })
    ).toThrow(/Nested sequence/);
    expect(() =>
      behaviorSpecSchema.parse({
        version: 1,
        type: "script",
        script: {
          scriptId: "script_response",
          version: 1,
          sha256: "b".repeat(64),
        },
        onFailure: "fallback",
      })
    ).toThrow(/requires a fallback/);
  });

  it("bounds bytes, tree depth, nodes, and cycles before recursive parsing", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index < 40; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => parseBehaviorSpec(deeplyNested)).toThrow(BehaviorSpecBoundsError);
    expect(() =>
      assertBehaviorSpecBounds(
        { values: Array.from({ length: 10 }, () => 1) },
        {
          maximumNodes: 5,
        }
      )
    ).toThrow(/node limit/);
    expect(() =>
      assertBehaviorSpecBounds({ text: "large" }, { maximumBytes: 4 })
    ).toThrow(/byte limit/);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => assertBehaviorSpecBounds(cycle)).toThrow(/acyclic/);
  });
});
describe("F-series feature defaults", () => {
  it("fails closed unless each experimental capability is explicitly enabled", () => {
    expect(DEFAULT_F_SERIES_FEATURE_FLAGS).toEqual({
      mockMcp: false,
      mockLlm: false,
      scriptBehaviors: false,
      codeMode: false,
    });
    expect(
      fSeriesFeatureFlagsSchema.parse({
        codeMode: true,
      })
    ).toEqual({
      mockMcp: false,
      mockLlm: false,
      scriptBehaviors: false,
      codeMode: true,
    });
  });
});
