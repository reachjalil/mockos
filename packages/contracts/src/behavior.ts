import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const BEHAVIOR_SPEC_MAX_BYTES = 512 * 1024;
export const BEHAVIOR_SPEC_MAX_DEPTH = 32;
export const BEHAVIOR_SPEC_MAX_NODES = 20_000;
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type BehaviorSpecBounds = {
  readonly maximumBytes?: number;
  readonly maximumDepth?: number;
  readonly maximumNodes?: number;
};

export class BehaviorSpecBoundsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BehaviorSpecBoundsError";
  }
}

/**
 * Bounds an untrusted JSON-like tree before Zod's recursive behavior schema sees it.
 * The iterative walk prevents attacker-controlled nesting from overflowing the stack.
 */
export const assertBehaviorSpecBounds = (
  input: unknown,
  bounds: BehaviorSpecBounds = {}
): void => {
  const maximumBytes = bounds.maximumBytes ?? BEHAVIOR_SPEC_MAX_BYTES;
  const maximumDepth = bounds.maximumDepth ?? BEHAVIOR_SPEC_MAX_DEPTH;
  const maximumNodes = bounds.maximumNodes ?? BEHAVIOR_SPEC_MAX_NODES;
  const pending: Array<{
    readonly value: unknown;
    readonly depth: number;
    readonly exiting: boolean;
  }> = [{ value: input, depth: 0, exiting: false }];
  const activeAncestors = new WeakSet<object>();
  let nodes = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    if (entry.exiting) {
      if (entry.value && typeof entry.value === "object") {
        activeAncestors.delete(entry.value);
      }
      continue;
    }
    nodes += 1;
    if (nodes > maximumNodes) {
      throw new BehaviorSpecBoundsError(
        `Behavior document exceeds the ${maximumNodes} node limit.`
      );
    }
    if (entry.depth > maximumDepth) {
      throw new BehaviorSpecBoundsError(
        `Behavior document exceeds the ${maximumDepth} level depth limit.`
      );
    }
    if (!entry.value || typeof entry.value !== "object") continue;
    if (activeAncestors.has(entry.value)) {
      throw new BehaviorSpecBoundsError(
        "Behavior document must be an acyclic JSON tree."
      );
    }
    activeAncestors.add(entry.value);
    pending.push({
      value: entry.value,
      depth: entry.depth,
      exiting: true,
    });
    let children: unknown[];
    if (Array.isArray(entry.value)) {
      children = entry.value;
    } else {
      const fields = Object.entries(entry.value as Record<string, unknown>);
      const unsafe = fields.find(([key]) => PROHIBITED_JSON_KEYS.has(key));
      if (unsafe) {
        throw new BehaviorSpecBoundsError(
          `JSON key ${unsafe[0]} is not permitted at a trust boundary.`
        );
      }
      children = fields.map(([, value]) => value);
    }
    for (const child of children) {
      pending.push({
        value: child,
        depth: entry.depth + 1,
        exiting: false,
      });
    }
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch (cause) {
    throw new BehaviorSpecBoundsError("Behavior document must be valid JSON.", {
      cause,
    });
  }
  if (serialized === undefined) {
    throw new BehaviorSpecBoundsError("Behavior document must be valid JSON.");
  }
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maximumBytes) {
    throw new BehaviorSpecBoundsError(
      `Behavior document exceeds the ${maximumBytes} byte limit.`
    );
  }
};

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const seededLatencySchema = z
  .object({
    minimumMilliseconds: z.number().int().min(0).max(30_000).default(0),
    maximumMilliseconds: z.number().int().min(0).max(30_000),
    seed: z.string().min(1).max(256),
  })
  .strict()
  .refine(
    ({ minimumMilliseconds, maximumMilliseconds }) =>
      minimumMilliseconds <= maximumMilliseconds,
    {
      message: "minimumMilliseconds cannot exceed maximumMilliseconds.",
      path: ["minimumMilliseconds"],
    }
  );
export type SeededLatency = z.infer<typeof seededLatencySchema>;

export const behaviorScriptReferenceSchema = z
  .object({
    scriptId: z.string().min(1).max(128),
    version: z.number().int().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BehaviorScriptReference = z.infer<typeof behaviorScriptReferenceSchema>;

export const behaviorMatchInputSchema = z
  .record(z.string().min(1).max(256), jsonValueSchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: "A match case must contain at least one field.",
  });
export type BehaviorMatchInput = z.infer<typeof behaviorMatchInputSchema>;

type BehaviorBase = {
  version: 1;
  latency?: SeededLatency;
};

export type StaticBehavior = BehaviorBase & {
  type: "static";
  value: JsonValue;
};

export type TemplateBehavior = BehaviorBase & {
  type: "template";
  template: string;
  data?: Record<string, JsonValue>;
};

export type SequenceBehavior = BehaviorBase & {
  type: "sequence";
  steps: BehaviorSpec[];
  mode: "once" | "hold_last" | "loop";
};

export type MatchBehavior = BehaviorBase & {
  type: "match";
  cases: Array<{ when: BehaviorMatchInput; behavior: BehaviorSpec }>;
  fallback?: BehaviorSpec;
};

export type ErrorBehavior = BehaviorBase & {
  type: "error";
  code: string;
  message: string;
  status?: number;
  details?: JsonValue;
};

export type ScriptBehavior = BehaviorBase & {
  type: "script";
  script: BehaviorScriptReference;
  onFailure: "propagate" | "fallback";
  fallback?: BehaviorSpec;
};

export type BehaviorSpec =
  | StaticBehavior
  | TemplateBehavior
  | SequenceBehavior
  | MatchBehavior
  | ErrorBehavior
  | ScriptBehavior;

const behaviorBaseShape = {
  version: z.literal(1),
  latency: seededLatencySchema.optional(),
};

export const behaviorSpecSchema: z.ZodType<BehaviorSpec> = z.lazy(() =>
  z
    .discriminatedUnion("type", [
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("static"),
          value: jsonValueSchema,
        })
        .strict(),
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("template"),
          template: z.string().min(1).max(64_000),
          data: z.record(z.string(), jsonValueSchema).optional(),
        })
        .strict(),
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("sequence"),
          steps: z.array(behaviorSpecSchema).min(1).max(1_000),
          mode: z.enum(["once", "hold_last", "loop"]).default("hold_last"),
        })
        .strict(),
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("match"),
          cases: z
            .array(
              z
                .object({
                  when: behaviorMatchInputSchema,
                  behavior: behaviorSpecSchema,
                })
                .strict()
            )
            .min(1)
            .max(100),
          fallback: behaviorSpecSchema.optional(),
        })
        .strict(),
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("error"),
          code: z.string().min(1).max(128),
          message: z.string().min(1).max(8_192),
          status: z.number().int().min(400).max(599).optional(),
          details: jsonValueSchema.optional(),
        })
        .strict(),
      z
        .object({
          ...behaviorBaseShape,
          type: z.literal("script"),
          script: behaviorScriptReferenceSchema,
          onFailure: z.enum(["propagate", "fallback"]).default("propagate"),
          fallback: behaviorSpecSchema.optional(),
        })
        .strict()
        .superRefine((behavior, context) => {
          if (behavior.onFailure === "fallback" && behavior.fallback === undefined) {
            context.addIssue({
              code: "custom",
              message: "A script fallback policy requires a fallback behavior.",
              path: ["fallback"],
            });
          }
          if (behavior.onFailure === "propagate" && behavior.fallback !== undefined) {
            context.addIssue({
              code: "custom",
              message: "A propagating script behavior cannot define a fallback.",
              path: ["fallback"],
            });
          }
        }),
    ])
    .superRefine((behavior, context) => {
      if (behavior.type === "sequence") {
        for (const [index, step] of behavior.steps.entries()) {
          if (step.type === "sequence") {
            context.addIssue({
              code: "custom",
              message: "Nested sequence behaviors are not supported in version 1.",
              path: ["steps", index],
            });
          }
        }
      }
    })
);

/** The required entry point for parsing behavior documents at trust boundaries. */
export const parseBehaviorSpec = (
  input: unknown,
  bounds?: BehaviorSpecBounds
): BehaviorSpec => {
  assertBehaviorSpecBounds(input, bounds);
  return behaviorSpecSchema.parse(input);
};
