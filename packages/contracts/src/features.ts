import { z } from "zod";

export const fSeriesFeatureFlagsSchema = z
  .object({
    mockMcp: z.boolean().default(false),
    mockLlm: z.boolean().default(false),
    scriptBehaviors: z.boolean().default(false),
    codeMode: z.boolean().default(false),
  })
  .strict();

export type FSeriesFeatureFlags = z.infer<typeof fSeriesFeatureFlagsSchema>;

export const DEFAULT_F_SERIES_FEATURE_FLAGS = Object.freeze(
  fSeriesFeatureFlagsSchema.parse({})
);
