import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import { describe, expect, it } from "vitest";
import { utf8Encode } from "../security";
import {
  BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES,
  type BehaviorEvaluationContext,
  type BehaviorEvaluationError,
  type BehaviorStateAccess,
  evaluateBehavior,
} from "./evaluator";

const emptyState = (): BehaviorStateAccess => ({
  read: () => undefined,
  write: () => undefined,
  transaction: (callback) => callback(),
});

const evaluateTemplate = (
  template: string,
  input: Readonly<Record<string, JsonValue>>
) =>
  evaluateBehavior(
    {
      version: 1,
      type: "template",
      template,
    } satisfies BehaviorSpec,
    {
      input,
      stateKey: "template:test",
      state: emptyState(),
    } satisfies BehaviorEvaluationContext
  );

describe("behavior template rendering", () => {
  it("renders literals, strings, and canonical JSON values incrementally", async () => {
    const plan = await evaluateTemplate("Hello {{name}}: {{details}}.", {
      name: "Åda",
      details: { ready: true, count: 2 },
    });

    expect(plan.outcome).toEqual({
      kind: "value",
      value: 'Hello Åda: {"count":2,"ready":true}.',
    });
  });

  it("reuses canonical and UTF-8 work for repeated large placeholders", async () => {
    const payloadRecord: Record<string, JsonValue> = {};
    for (let index = 0; index < 12_000; index += 1) {
      payloadRecord[`p${index}`] = index;
    }
    let payloadEnumerations = 0;
    const payload = new Proxy(payloadRecord, {
      ownKeys: (target) => {
        payloadEnumerations += 1;
        return Reflect.ownKeys(target);
      },
    });
    const repeatedTemplate = Array.from({ length: 200 }, () => "{{payload}}").join("");

    await expect(evaluateTemplate(repeatedTemplate, { payload })).rejects.toMatchObject(
      {
        name: "BehaviorEvaluationError",
        code: "template_output_limit",
        message: `Template output exceeds the ${BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES}-byte UTF-8 limit.`,
      }
    );
    expect(payloadEnumerations).toBe(1);
  });

  it("applies the output ceiling in UTF-8 bytes, including Unicode boundaries", async () => {
    const exact = "😀".repeat(BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES / 4);
    const plan = await evaluateTemplate("{{value}}", { value: exact });

    expect(plan.outcome).toEqual({ kind: "value", value: exact });
    expect(utf8Encode(exact).byteLength).toBe(BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES);

    await expect(evaluateTemplate("{{value}}", { value: `${exact}a` })).rejects.toEqual(
      expect.objectContaining<Partial<BehaviorEvaluationError>>({
        code: "template_output_limit",
        message: `Template output exceeds the ${BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES}-byte UTF-8 limit.`,
      })
    );
  });
});
