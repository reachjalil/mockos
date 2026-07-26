import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import { mockMcpSecretFreeServerWriteSchema } from "@mockos/contracts/mock-mcp";
import {
  mockMcpBlueprintCatalogSchema,
  mockMcpBlueprintSchema,
} from "@mockos/contracts/mock-mcp-blueprint";
import { describe, expect, it } from "vitest";
import {
  evaluateBehavior,
  getMockMcpBlueprint,
  instantiateMockMcpBlueprint,
  listMockMcpBlueprints,
  requireMockMcpBlueprint,
  SALESFORCE_SOBJECT_READS_BLUEPRINT_ID,
  SALESFORCE_SOBJECT_READS_DEFAULT_SLUG,
} from "../index";

const expectedToolNames = [
  "getObjectSchema",
  "soqlQuery",
  "find",
  "getUserInfo",
  "listRecentSobjectRecords",
  "getRelatedRecords",
] as const;

const successfulInputs = {
  getObjectSchema: { "object-name": "Account" },
  soqlQuery: {
    query:
      "SELECT Id, Name, Industry FROM Account WHERE Name = 'Acme Test Industries' LIMIT 1",
  },
  find: {
    search:
      "FIND {Acme Test} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)",
  },
  getUserInfo: {},
  listRecentSobjectRecords: { "sobject-name": "Account" },
  getRelatedRecords: {
    "sobject-name": "Account",
    id: "001MockOS0000001",
    "relationship-path": "Contacts",
  },
} satisfies Record<(typeof expectedToolNames)[number], Record<string, JsonValue>>;

const noState = {
  read: () => undefined,
  write: () => undefined,
  transaction: <Value>(callback: () => Value): Value => callback(),
};

const evaluateTool = async (
  behavior: BehaviorSpec,
  argumentsValue: Record<string, JsonValue>
): Promise<JsonValue> => {
  const plan = await evaluateBehavior(behavior, {
    input: { arguments: argumentsValue },
    stateKey: "blueprint-test",
    invocationKey: "deterministic",
    state: noState,
  });
  expect(plan.delayMilliseconds).toBe(0);
  expect(plan.stateWrites).toEqual({});
  expect(plan.outcome.kind).toBe("value");
  if (plan.outcome.kind !== "value") {
    throw new Error("Expected a blueprint behavior value.");
  }
  plan.commit();
  return plan.outcome.value;
};

const behaviorKinds = (root: BehaviorSpec): string[] => {
  const kinds: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const behavior = pending.pop();
    if (!behavior) continue;
    kinds.push(behavior.type);
    if (behavior.type === "match") {
      pending.push(...behavior.cases.map(({ behavior: branch }) => branch));
      if (behavior.fallback) pending.push(behavior.fallback);
    } else if (behavior.type === "sequence") {
      pending.push(...behavior.steps);
    } else if (behavior.type === "script" && behavior.fallback) {
      pending.push(behavior.fallback);
    }
  }
  return kinds;
};

describe("mock MCP blueprint catalog", () => {
  it("publishes one schema-valid, unique, ASCII-sorted Salesforce blueprint", () => {
    const catalog = listMockMcpBlueprints();

    expect(() => mockMcpBlueprintCatalogSchema.parse(catalog)).not.toThrow();
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.blueprints).toHaveLength(1);
    expect(catalog.blueprints[0]).toMatchObject({
      schemaVersion: 1,
      blueprintVersion: 1,
      id: SALESFORCE_SOBJECT_READS_BLUEPRINT_ID,
      provider: "salesforce",
      defaultSlug: SALESFORCE_SOBJECT_READS_DEFAULT_SLUG,
      credentialMode: "none",
      toolNames: expectedToolNames,
      provenance: {
        kind: "documentation-derived",
        upstream: {
          product: "Salesforce Hosted MCP Servers",
          server: "platform/sobject-reads",
        },
        sourceReviewedAt: "2026-07-25",
        officialDocumentationUrl:
          "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html",
      },
      fidelity: {
        behavior: "deterministic-synthetic",
        providerNetwork: false,
        outputWireParity: "unqualified",
      },
    });

    const ids = catalog.blueprints.map(({ id }) => id);
    const slugs = catalog.blueprints.map(({ defaultSlug }) => defaultSlug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(ids).toEqual(
      [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    );
  });

  it("returns detached catalog, blueprint, and installation values", () => {
    const firstCatalog = listMockMcpBlueprints();
    const firstSummary = firstCatalog.blueprints[0];
    if (!firstSummary) throw new Error("The catalog fixture must exist.");
    firstSummary.title = "mutated";
    firstCatalog.blueprints.splice(0);
    expect(listMockMcpBlueprints().blueprints[0]?.title).toBe(
      "Salesforce Hosted MCP SObject Reads"
    );

    const firstBlueprint = requireMockMcpBlueprint(
      SALESFORCE_SOBJECT_READS_BLUEPRINT_ID
    );
    const firstTool = firstBlueprint.server.tools[0];
    if (!firstTool) throw new Error("The blueprint tool fixture must exist.");
    firstTool.name = "mutated";
    firstBlueprint.server.instructions = "mutated";
    expect(
      requireMockMcpBlueprint(SALESFORCE_SOBJECT_READS_BLUEPRINT_ID).server.tools[0]
        ?.name
    ).toBe("getObjectSchema");

    const firstInstall = instantiateMockMcpBlueprint(
      SALESFORCE_SOBJECT_READS_BLUEPRINT_ID,
      "salesforce-sobject-reads-copy"
    );
    firstInstall.tools.splice(0);
    const secondInstall = instantiateMockMcpBlueprint(
      SALESFORCE_SOBJECT_READS_BLUEPRINT_ID
    );
    expect(secondInstall.slug).toBe(SALESFORCE_SOBJECT_READS_DEFAULT_SLUG);
    expect(secondInstall.tools.map(({ name }) => name)).toEqual(expectedToolNames);
    expect(() => mockMcpSecretFreeServerWriteSchema.parse(secondInstall)).not.toThrow();
  });

  it("returns undefined for an unknown blueprint and throws one typed require error", () => {
    const unknownId = "salesforce/hosted-mcp/unknown";
    expect(getMockMcpBlueprint(unknownId)).toBeUndefined();
    expect(() => requireMockMcpBlueprint(unknownId)).toThrow(
      expect.objectContaining({
        name: "MockMcpBlueprintCatalogError",
        code: "blueprint_not_found",
        message: `Mock MCP blueprint ${unknownId} does not exist.`,
      })
    );
  });

  it("defines exactly six local, read-only tools with strict official inputs", () => {
    const blueprint = requireMockMcpBlueprint(SALESFORCE_SOBJECT_READS_BLUEPRINT_ID);

    expect(() => mockMcpBlueprintSchema.parse(blueprint)).not.toThrow();
    expect(blueprint.server.version).toBe(1);
    expect(blueprint.server.authentication).toEqual({ mode: "none" });
    expect(blueprint.server.resources).toEqual([]);
    expect(blueprint.server.resourceTemplates).toEqual([]);
    expect(blueprint.server.prompts).toEqual([]);
    expect(blueprint.server.tools.map(({ name }) => name)).toEqual(expectedToolNames);
    for (const tool of blueprint.server.tools) {
      expect(tool.annotations).toEqual({
        title: tool.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(
        behaviorKinds(tool.behavior).every(
          (kind) => kind === "match" || kind === "static"
        )
      ).toBe(true);
      expect(tool.behavior).toMatchObject({
        type: "match",
        fallback: {
          type: "static",
          value: { isError: true },
        },
      });
    }

    expect(blueprint.server.tools.map(({ inputSchema }) => inputSchema)).toEqual([
      {
        type: "object",
        properties: {
          "object-name": {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 4_096,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          search: {
            type: "string",
            minLength: 1,
            maxLength: 4_096,
          },
        },
        required: ["search"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          "sobject-name": {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
        },
        required: ["sobject-name"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          "sobject-name": {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
          id: {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
          "relationship-path": {
            type: "string",
            minLength: 1,
            maxLength: 256,
          },
        },
        required: ["sobject-name", "id", "relationship-path"],
        additionalProperties: false,
      },
    ]);
  });

  it("serves deterministic synthetic .test fixtures and secret-free error fallbacks", async () => {
    const blueprint = requireMockMcpBlueprint(SALESFORCE_SOBJECT_READS_BLUEPRINT_ID);

    for (const tool of blueprint.server.tools) {
      const input = successfulInputs[tool.name as keyof typeof successfulInputs];
      expect(input).toBeDefined();
      const first = await evaluateTool(tool.behavior, input ?? {});
      const second = await evaluateTool(tool.behavior, input ?? {});
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        content: [{ type: "text" }],
        structuredContent: {
          fixtureSource: expect.stringMatching(/^https:\/\/salesforce\.mockos\.test\//),
        },
      });
      expect(JSON.stringify(first)).toContain(".test");

      const fallback = await evaluateTool(tool.behavior, {
        unsupported: "fixture",
      });
      expect(fallback).toEqual({
        content: [
          {
            type: "text",
            text: `${tool.name} has no deterministic synthetic fixture for this input.`,
          },
        ],
        isError: true,
      });
    }
  });

  it("returns a compact schema index when object-name is omitted and Account detail when selected", async () => {
    const tool = requireMockMcpBlueprint(SALESFORCE_SOBJECT_READS_BLUEPRINT_ID).server
      .tools[0];
    if (!tool) throw new Error("The getObjectSchema fixture must exist.");

    const index = await evaluateTool(tool.behavior, {});
    const account = await evaluateTool(tool.behavior, {
      "object-name": "Account",
    });

    expect(index).toMatchObject({
      structuredContent: {
        fixtureSource: "https://salesforce.mockos.test/fixtures/sobjects/schema-index",
        objects: [{ apiName: "Account", label: "Account" }],
      },
    });
    expect(JSON.stringify(index)).not.toContain('"fields"');
    expect(account).toMatchObject({
      structuredContent: {
        fixtureSource:
          "https://salesforce.mockos.test/fixtures/sobjects/Account/schema",
        object: {
          apiName: "Account",
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "Id", type: "id" }),
          ]),
        },
      },
    });
    expect(JSON.stringify(account)).toContain('"fields"');
    expect(index).not.toEqual(account);
  });
});
