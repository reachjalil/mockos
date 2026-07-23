import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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
