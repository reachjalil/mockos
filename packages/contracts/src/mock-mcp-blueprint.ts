import { z } from "zod";
import {
  MOCK_MCP_MAX_CAPABILITIES_PER_KIND,
  mockMcpCapabilityNameSchema,
  mockMcpSecretFreeServerWriteSchema,
  mockMcpServerViewSchema,
  mockMcpSlugSchema,
} from "./mock-mcp";

export const MOCK_MCP_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const MOCK_MCP_BLUEPRINT_CATALOG_LIMIT = 64;

export const mockMcpBlueprintIdSchema = z
  .string()
  .min(5)
  .max(128)
  .regex(
    /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){2,4}$/,
    "A mock MCP blueprint id must contain three to five lowercase slash-separated segments."
  );
export type MockMcpBlueprintId = z.infer<typeof mockMcpBlueprintIdSchema>;

export const mockMcpBlueprintProviderSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    "A mock MCP blueprint provider must be a lowercase identifier."
  );
export type MockMcpBlueprintProvider = z.infer<typeof mockMcpBlueprintProviderSchema>;

export const mockMcpBlueprintVersionSchema = z.number().int().safe().min(1);
export type MockMcpBlueprintVersion = z.infer<typeof mockMcpBlueprintVersionSchema>;

const mockMcpBlueprintToolNamesSchema = z
  .array(mockMcpCapabilityNameSchema)
  .min(1)
  .max(MOCK_MCP_MAX_CAPABILITIES_PER_KIND)
  .refine((names) => new Set(names).size === names.length, {
    message: "Mock MCP blueprint tool names must be unique.",
  });

export const mockMcpBlueprintProvenanceSchema = z
  .object({
    kind: z.literal("documentation-derived"),
    upstream: z
      .object({
        product: z.string().min(1).max(128),
        server: z.string().min(1).max(128),
      })
      .strict(),
    sourceReviewedAt: z.iso.date(),
    officialDocumentationUrl: z.url(),
  })
  .strict();
export type MockMcpBlueprintProvenance = z.infer<
  typeof mockMcpBlueprintProvenanceSchema
>;

export const mockMcpBlueprintFidelitySchema = z
  .object({
    behavior: z.literal("deterministic-synthetic"),
    providerNetwork: z.literal(false),
    outputWireParity: z.literal("unqualified"),
  })
  .strict();
export type MockMcpBlueprintFidelity = z.infer<typeof mockMcpBlueprintFidelitySchema>;

const mockMcpBlueprintSummaryShape = {
  schemaVersion: z.literal(MOCK_MCP_BLUEPRINT_SCHEMA_VERSION),
  blueprintVersion: mockMcpBlueprintVersionSchema,
  id: mockMcpBlueprintIdSchema,
  title: z.string().min(1).max(128),
  description: z.string().min(1).max(1_024),
  provider: mockMcpBlueprintProviderSchema,
  provenance: mockMcpBlueprintProvenanceSchema,
  fidelity: mockMcpBlueprintFidelitySchema,
  defaultSlug: mockMcpSlugSchema,
  toolNames: mockMcpBlueprintToolNamesSchema,
  credentialMode: z.literal("none"),
};

export const mockMcpBlueprintSummarySchema = z
  .object(mockMcpBlueprintSummaryShape)
  .strict();
export type MockMcpBlueprintSummary = z.infer<typeof mockMcpBlueprintSummarySchema>;

export const mockMcpBlueprintSchema = z
  .object({
    ...mockMcpBlueprintSummaryShape,
    server: mockMcpSecretFreeServerWriteSchema,
  })
  .strict()
  .superRefine((blueprint, context) => {
    if (blueprint.defaultSlug !== blueprint.server.slug) {
      context.addIssue({
        code: "custom",
        message: "A blueprint default slug must equal its server definition slug.",
        path: ["defaultSlug"],
      });
    }
    const serverToolNames = blueprint.server.tools.map(({ name }) => name);
    if (
      serverToolNames.length !== blueprint.toolNames.length ||
      serverToolNames.some((name, index) => name !== blueprint.toolNames[index])
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Blueprint provenance tool names must exactly match the ordered server tools.",
        path: ["toolNames"],
      });
    }
  });
export type MockMcpBlueprint = z.infer<typeof mockMcpBlueprintSchema>;

export const mockMcpBlueprintCatalogSchema = z
  .object({
    schemaVersion: z.literal(MOCK_MCP_BLUEPRINT_SCHEMA_VERSION),
    blueprints: z
      .array(mockMcpBlueprintSummarySchema)
      .max(MOCK_MCP_BLUEPRINT_CATALOG_LIMIT),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    for (const [index, blueprint] of catalog.blueprints.entries()) {
      if (ids.has(blueprint.id)) {
        context.addIssue({
          code: "custom",
          message: "Mock MCP blueprint ids must be unique.",
          path: ["blueprints", index, "id"],
        });
      }
      ids.add(blueprint.id);
      if (slugs.has(blueprint.defaultSlug)) {
        context.addIssue({
          code: "custom",
          message: "Mock MCP blueprint default slugs must be unique.",
          path: ["blueprints", index, "defaultSlug"],
        });
      }
      slugs.add(blueprint.defaultSlug);
      const previous = catalog.blueprints[index - 1];
      if (previous && previous.id >= blueprint.id) {
        context.addIssue({
          code: "custom",
          message: "Mock MCP blueprints must be sorted by ascending id.",
          path: ["blueprints", index, "id"],
        });
      }
    }
  });
export type MockMcpBlueprintCatalog = z.infer<typeof mockMcpBlueprintCatalogSchema>;

export const listMockMcpBlueprintsToolInputSchema = z.object({}).strict();
export type ListMockMcpBlueprintsToolInput = z.infer<
  typeof listMockMcpBlueprintsToolInputSchema
>;

export const getMockMcpBlueprintToolInputSchema = z
  .object({ blueprintId: mockMcpBlueprintIdSchema })
  .strict();
export type GetMockMcpBlueprintToolInput = z.infer<
  typeof getMockMcpBlueprintToolInputSchema
>;

export const mockMcpBlueprintInstallResultSchema = z
  .object({
    schemaVersion: z.literal(MOCK_MCP_BLUEPRINT_SCHEMA_VERSION),
    blueprintId: mockMcpBlueprintIdSchema,
    blueprintVersion: mockMcpBlueprintVersionSchema,
    server: mockMcpServerViewSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.server.spec.authentication.mode !== "none") {
      context.addIssue({
        code: "custom",
        message: "A blueprint install result must remain credential-free.",
        path: ["server", "spec", "authentication"],
      });
    }
  });
export type MockMcpBlueprintInstallResult = z.infer<
  typeof mockMcpBlueprintInstallResultSchema
>;
