import type {
  BehaviorScriptReference,
  BehaviorSpec,
  ErrorBehavior,
  JsonValue,
  SeededLatency,
} from "@mockos/contracts/behavior";
import { SeededRng } from "../determinism";
import { canonicalJson, utf8Encode } from "../security";

const PROHIBITED_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const TEMPLATE_EXPRESSION = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

export const BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES = 256 * 1024;

export type BehaviorStateAccess = {
  read(key: string): JsonValue | undefined;
  write(key: string, value: JsonValue): void;
  transaction<Value>(callback: () => Value): Value;
};

export type ScriptBehaviorInvocation = {
  readonly reference: BehaviorScriptReference;
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly stateKey: string;
  readonly invocationKey: string;
};

export interface ScriptBehaviorExecutor {
  execute(invocation: ScriptBehaviorInvocation): Promise<JsonValue>;
}

export type BehaviorEvaluationContext = {
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly stateKey: string;
  readonly invocationKey?: string;
  readonly state: BehaviorStateAccess;
  readonly scripts?: ScriptBehaviorExecutor;
};

export type BehaviorErrorPlan = {
  readonly kind: "error";
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly details?: JsonValue;
};

export type BehaviorValuePlan = {
  readonly kind: "value";
  readonly value: JsonValue;
};

export type BehaviorOutcome = BehaviorErrorPlan | BehaviorValuePlan;

export type BehaviorEvaluationPlan = {
  readonly outcome: BehaviorOutcome;
  readonly delayMilliseconds: number;
  readonly stateWrites: Readonly<Record<string, JsonValue>>;
  /**
   * Applies staged sequence writes atomically. Call only after the protocol-specific
   * result has passed output validation and is ready to render.
   */
  commit(): void;
};

export class BehaviorStateConflictError extends Error {
  constructor(readonly stateKey: string) {
    super(`Behavior state ${stateKey} changed before the plan could commit.`);
    this.name = "BehaviorStateConflictError";
  }
}

export class BehaviorEvaluationError extends Error {
  constructor(
    readonly code:
      | "invalid_match"
      | "invalid_sequence_state"
      | "sequence_exhausted"
      | "template_output_limit"
      | "template_value_missing"
      | "script_unavailable"
      | "script_failed",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "BehaviorEvaluationError";
  }
}

type StagedEvaluation = {
  readonly outcome: BehaviorOutcome;
  readonly delayMilliseconds: number;
};

type BehaviorEvaluationCache = {
  readonly canonicalValues: Map<JsonValue, string>;
  readonly inputPathValues: Map<string, JsonValue | undefined>;
  readonly utf8Lengths: Map<string, number>;
};

const cloneJson = (value: JsonValue): JsonValue =>
  JSON.parse(canonicalJson(value)) as JsonValue;

const cachedCanonicalJson = (
  value: JsonValue,
  cache: BehaviorEvaluationCache
): string => {
  const cached = cache.canonicalValues.get(value);
  if (cached !== undefined) return cached;
  const canonical = canonicalJson(value);
  cache.canonicalValues.set(value, canonical);
  return canonical;
};

const exactMatchJsonEqual = (
  left: JsonValue | undefined,
  right: JsonValue,
  cache: BehaviorEvaluationCache
): boolean =>
  left !== undefined &&
  cachedCanonicalJson(left, cache) === cachedCanonicalJson(right, cache);

const exactStateEqual = (
  left: JsonValue | undefined,
  right: JsonValue | undefined
): boolean => {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
};

const readPath = (
  root: Readonly<Record<string, JsonValue>>,
  dottedPath: string
): JsonValue | undefined => {
  const segments = dottedPath.split(".");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length < 1 ||
        PROHIBITED_PATH_SEGMENTS.has(segment) ||
        !/^[A-Za-z0-9_-]+$/.test(segment)
    )
  ) {
    return undefined;
  }
  let current: JsonValue = root;
  for (const segment of segments) {
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = current[segment] as JsonValue;
  }
  return current;
};

const readMatchInputPath = (
  input: Readonly<Record<string, JsonValue>>,
  dottedPath: string,
  cache: BehaviorEvaluationCache
): JsonValue | undefined => {
  if (cache.inputPathValues.has(dottedPath)) {
    return cache.inputPathValues.get(dottedPath);
  }
  const value = readPath(input, dottedPath);
  cache.inputPathValues.set(dottedPath, value);
  return value;
};

const cachedUtf8Length = (value: string, cache: BehaviorEvaluationCache): number => {
  const cached = cache.utf8Lengths.get(value);
  if (cached !== undefined) return cached;
  const length = utf8Encode(value).byteLength;
  cache.utf8Lengths.set(value, length);
  return length;
};

const appendTemplateFragment = (
  fragments: string[],
  fragment: string,
  renderedBytes: number,
  cache: BehaviorEvaluationCache
): number => {
  if (fragment.length === 0) return renderedBytes;
  const fragmentBytes = cachedUtf8Length(fragment, cache);
  if (fragmentBytes > BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES - renderedBytes) {
    throw new BehaviorEvaluationError(
      "template_output_limit",
      `Template output exceeds the ${BEHAVIOR_TEMPLATE_MAX_OUTPUT_BYTES}-byte UTF-8 limit.`
    );
  }
  fragments.push(fragment);
  return renderedBytes + fragmentBytes;
};

const renderTemplate = (
  template: string,
  values: Readonly<Record<string, JsonValue>>,
  cache: BehaviorEvaluationCache
): string => {
  const fragments: string[] = [];
  let renderedBytes = 0;
  let cursor = 0;
  for (const match of template.matchAll(TEMPLATE_EXPRESSION)) {
    const index = match.index;
    const path = match[1];
    if (path === undefined) continue;
    renderedBytes = appendTemplateFragment(
      fragments,
      template.slice(cursor, index),
      renderedBytes,
      cache
    );
    const value = readPath(values, path);
    if (value === undefined) {
      throw new BehaviorEvaluationError(
        "template_value_missing",
        `Template value ${path} is missing.`
      );
    }
    const renderedValue =
      typeof value === "string" ? value : cachedCanonicalJson(value, cache);
    renderedBytes = appendTemplateFragment(
      fragments,
      renderedValue,
      renderedBytes,
      cache
    );
    cursor = index + match[0].length;
  }
  appendTemplateFragment(fragments, template.slice(cursor), renderedBytes, cache);
  return fragments.join("");
};

const latencyFor = (
  latency: SeededLatency | undefined,
  stateKey: string,
  invocationKey: string,
  behaviorPath: string
): number => {
  if (!latency) return 0;
  if (latency.minimumMilliseconds === latency.maximumMilliseconds) {
    return latency.minimumMilliseconds;
  }
  const rng = new SeededRng(
    `mockos:behavior-latency:${latency.seed}:${stateKey}:${invocationKey}:${behaviorPath}`
  );
  return (
    latency.minimumMilliseconds +
    Math.floor(
      rng.next() * (latency.maximumMilliseconds - latency.minimumMilliseconds + 1)
    )
  );
};

const toErrorPlan = (behavior: ErrorBehavior): BehaviorErrorPlan => ({
  kind: "error",
  code: behavior.code,
  message: behavior.message,
  ...(behavior.status === undefined ? {} : { status: behavior.status }),
  ...(behavior.details === undefined ? {} : { details: cloneJson(behavior.details) }),
});

const sequenceIndex = (value: JsonValue | undefined, key: string): number => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BehaviorEvaluationError(
      "invalid_sequence_state",
      `Sequence state ${key} is invalid.`
    );
  }
  return value;
};

const evaluate = async (
  behavior: BehaviorSpec,
  context: BehaviorEvaluationContext,
  stagedWrites: Map<string, JsonValue>,
  expectedReads: Map<string, JsonValue | undefined>,
  evaluationCache: BehaviorEvaluationCache,
  behaviorPath: string
): Promise<StagedEvaluation> => {
  const ownDelay = latencyFor(
    behavior.latency,
    context.stateKey,
    context.invocationKey ?? "default",
    behaviorPath
  );
  switch (behavior.type) {
    case "static":
      return {
        outcome: { kind: "value", value: cloneJson(behavior.value) },
        delayMilliseconds: ownDelay,
      };
    case "template": {
      const values = {
        ...(behavior.data ?? {}),
        ...context.input,
      };
      return {
        outcome: {
          kind: "value",
          value: renderTemplate(behavior.template, values, evaluationCache),
        },
        delayMilliseconds: ownDelay,
      };
    }
    case "error":
      return {
        outcome: toErrorPlan(behavior),
        delayMilliseconds: ownDelay,
      };
    case "match": {
      const matchIndex = behavior.cases.findIndex(({ when }) =>
        Object.entries(when).every(([path, expected]) =>
          exactMatchJsonEqual(
            readMatchInputPath(context.input, path, evaluationCache),
            expected,
            evaluationCache
          )
        )
      );
      const selected =
        matchIndex >= 0 ? behavior.cases[matchIndex]?.behavior : behavior.fallback;
      if (!selected) {
        throw new BehaviorEvaluationError(
          "invalid_match",
          "No match case or fallback behavior was selected."
        );
      }
      const nested = await evaluate(
        selected,
        context,
        stagedWrites,
        expectedReads,
        evaluationCache,
        `${behaviorPath}.${matchIndex >= 0 ? `case-${matchIndex}` : "fallback"}`
      );
      return {
        ...nested,
        delayMilliseconds: Math.min(30_000, ownDelay + nested.delayMilliseconds),
      };
    }
    case "sequence": {
      const cursorKey = `sequence:${context.stateKey}:${behaviorPath}`;
      let stored = stagedWrites.get(cursorKey);
      if (stored === undefined) {
        stored = context.state.read(cursorKey);
        if (!expectedReads.has(cursorKey)) {
          expectedReads.set(cursorKey, stored);
        }
      }
      const index = sequenceIndex(stored, cursorKey);
      if (behavior.mode === "once" && index >= behavior.steps.length) {
        throw new BehaviorEvaluationError(
          "sequence_exhausted",
          `Sequence ${context.stateKey} is exhausted.`
        );
      }
      const selectedIndex =
        behavior.mode === "loop"
          ? index % behavior.steps.length
          : Math.min(index, behavior.steps.length - 1);
      const selected = behavior.steps[selectedIndex];
      if (!selected) {
        throw new BehaviorEvaluationError(
          "invalid_sequence_state",
          `Sequence ${context.stateKey} cannot select step ${selectedIndex}.`
        );
      }
      const nested = await evaluate(
        selected,
        context,
        stagedWrites,
        expectedReads,
        evaluationCache,
        `${behaviorPath}.step-${selectedIndex}`
      );
      if (behavior.mode !== "hold_last" || index < behavior.steps.length - 1) {
        stagedWrites.set(cursorKey, index + 1);
      }
      return {
        ...nested,
        delayMilliseconds: Math.min(30_000, ownDelay + nested.delayMilliseconds),
      };
    }
    case "script": {
      if (!context.scripts) {
        if (behavior.onFailure === "fallback" && behavior.fallback) {
          const nested = await evaluate(
            behavior.fallback,
            context,
            stagedWrites,
            expectedReads,
            evaluationCache,
            `${behaviorPath}.script-fallback`
          );
          return {
            ...nested,
            delayMilliseconds: Math.min(30_000, ownDelay + nested.delayMilliseconds),
          };
        }
        throw new BehaviorEvaluationError(
          "script_unavailable",
          "Script execution is unavailable and the behavior has no fallback."
        );
      }
      try {
        const value = await context.scripts.execute({
          reference: behavior.script,
          input: context.input,
          stateKey: context.stateKey,
          invocationKey: context.invocationKey ?? "default",
        });
        return {
          outcome: { kind: "value", value: cloneJson(value) },
          delayMilliseconds: ownDelay,
        };
      } catch (cause) {
        if (behavior.onFailure === "fallback" && behavior.fallback) {
          const nested = await evaluate(
            behavior.fallback,
            context,
            stagedWrites,
            expectedReads,
            evaluationCache,
            `${behaviorPath}.script-fallback`
          );
          return {
            ...nested,
            delayMilliseconds: Math.min(30_000, ownDelay + nested.delayMilliseconds),
          };
        }
        throw new BehaviorEvaluationError("script_failed", "Script behavior failed.", {
          cause,
        });
      }
    }
  }
};

export const evaluateBehavior = async (
  behavior: BehaviorSpec,
  context: BehaviorEvaluationContext
): Promise<BehaviorEvaluationPlan> => {
  const stagedWrites = new Map<string, JsonValue>();
  const expectedReads = new Map<string, JsonValue | undefined>();
  const evaluationCache: BehaviorEvaluationCache = {
    canonicalValues: new Map(),
    inputPathValues: new Map(),
    utf8Lengths: new Map(),
  };
  const evaluated = await evaluate(
    behavior,
    context,
    stagedWrites,
    expectedReads,
    evaluationCache,
    "root"
  );
  const stateWrites = Object.freeze(Object.fromEntries(stagedWrites));
  let committed = false;
  return {
    ...evaluated,
    stateWrites,
    commit: () => {
      if (committed || stagedWrites.size === 0) return;
      context.state.transaction(() => {
        for (const [key, expected] of expectedReads) {
          const current = context.state.read(key);
          if (!exactStateEqual(current, expected)) {
            throw new BehaviorStateConflictError(key);
          }
        }
        for (const [key, value] of stagedWrites) {
          context.state.write(key, value);
        }
      });
      committed = true;
    },
  };
};
