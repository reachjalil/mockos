import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import type { MockMcpSecretFreeServerWrite } from "@mockos/contracts/mock-mcp";
import {
  mockMcpSecretFreeServerWriteSchema,
  mockMcpSlugSchema,
} from "@mockos/contracts/mock-mcp";
import type {
  MockMcpBlueprint,
  MockMcpBlueprintCatalog,
  MockMcpBlueprintId,
  MockMcpBlueprintSummary,
} from "@mockos/contracts/mock-mcp-blueprint";
import {
  MOCK_MCP_BLUEPRINT_SCHEMA_VERSION,
  mockMcpBlueprintCatalogSchema,
  mockMcpBlueprintIdSchema,
  mockMcpBlueprintSchema,
  mockMcpBlueprintSummarySchema,
} from "@mockos/contracts/mock-mcp-blueprint";

export const SALESFORCE_SOBJECT_READS_BLUEPRINT_ID =
  "salesforce/hosted-mcp/sobject-reads" as const;
export const SALESFORCE_SOBJECT_READS_DEFAULT_SLUG =
  "salesforce-sobject-reads" as const;

const OFFICIAL_DOCUMENTATION_URL =
  "https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html";

const localReadAnnotations = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const successResult = (structuredContent: Record<string, JsonValue>): JsonValue => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(structuredContent),
    },
  ],
  structuredContent,
});

const unsupportedFixtureResult = (toolName: string): JsonValue => ({
  content: [
    {
      type: "text",
      text: `${toolName} has no deterministic synthetic fixture for this input.`,
    },
  ],
  isError: true,
});

const matchingFixture = (
  toolName: string,
  cases: Array<{ when: Record<string, JsonValue>; value: JsonValue }>
): BehaviorSpec => ({
  version: 1,
  type: "match",
  cases: cases.map(({ when, value }) => ({
    when,
    behavior: {
      version: 1,
      type: "static",
      value,
    },
  })),
  fallback: {
    version: 1,
    type: "static",
    value: unsupportedFixtureResult(toolName),
  },
});

const objectSchemaIndexResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/sobjects/schema-index",
  objects: [
    {
      apiName: "Account",
      label: "Account",
    },
  ],
});

const accountSchemaResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/sobjects/Account/schema",
  object: {
    apiName: "Account",
    label: "Account",
    fields: [
      {
        name: "Id",
        label: "Account ID",
        type: "id",
        nillable: false,
      },
      {
        name: "Name",
        label: "Account Name",
        type: "string",
        length: 255,
        nillable: false,
      },
      {
        name: "Industry",
        label: "Industry",
        type: "picklist",
        nillable: true,
      },
    ],
  },
});

const soqlResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/queries/acme-test-industries",
  totalSize: 1,
  done: true,
  records: [
    {
      attributes: {
        type: "Account",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Account/001MockOS0000001",
      },
      Id: "001MockOS0000001",
      Name: "Acme Test Industries",
      Industry: "Technology",
    },
  ],
});

const searchResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/search/acme-test-industries",
  searchRecords: [
    {
      attributes: {
        type: "Account",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Account/001MockOS0000001",
      },
      Id: "001MockOS0000001",
      Name: "Acme Test Industries",
    },
    {
      attributes: {
        type: "Contact",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Contact/003MockOS0000001",
      },
      Id: "003MockOS0000001",
      Name: "Ada Lovelace",
      Email: "ada.lovelace@salesforce.mockos.test",
    },
  ],
});

const userInfoResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/users/ada-lovelace",
  userId: "005MockOS0000001",
  organizationId: "00DMockOS0000001",
  userName: "ada.lovelace@salesforce.mockos.test",
  displayName: "Ada Lovelace",
  locale: "en_US",
});

const recentRecordsResult = successResult({
  fixtureSource: "https://salesforce.mockos.test/fixtures/sobjects/Account/recent",
  records: [
    {
      attributes: {
        type: "Account",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Account/001MockOS0000001",
      },
      Id: "001MockOS0000001",
      Name: "Acme Test Industries",
      LastModifiedDate: "2026-07-25T12:00:00.000Z",
    },
    {
      attributes: {
        type: "Account",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Account/001MockOS0000002",
      },
      Id: "001MockOS0000002",
      Name: "Example Test Labs",
      LastModifiedDate: "2026-07-24T12:00:00.000Z",
    },
  ],
});

const relatedRecordsResult = successResult({
  fixtureSource:
    "https://salesforce.mockos.test/fixtures/sobjects/Account/001MockOS0000001/Contacts",
  records: [
    {
      attributes: {
        type: "Contact",
        url: "https://salesforce.mockos.test/services/data/v64.0/sobjects/Contact/003MockOS0000001",
      },
      Id: "003MockOS0000001",
      Name: "Ada Lovelace",
      Email: "ada.lovelace@salesforce.mockos.test",
      AccountId: "001MockOS0000001",
    },
  ],
});

const salesforceSobjectReadsBlueprint = mockMcpBlueprintSchema.parse({
  schemaVersion: MOCK_MCP_BLUEPRINT_SCHEMA_VERSION,
  blueprintVersion: 1,
  id: SALESFORCE_SOBJECT_READS_BLUEPRINT_ID,
  title: "Salesforce Hosted MCP SObject Reads",
  description:
    "A deterministic synthetic model of the documented Salesforce Hosted MCP SObject Reads tool names and input semantics.",
  provider: "salesforce",
  provenance: {
    kind: "documentation-derived",
    upstream: {
      product: "Salesforce Hosted MCP Servers",
      server: "platform/sobject-reads",
    },
    sourceReviewedAt: "2026-07-25",
    officialDocumentationUrl: OFFICIAL_DOCUMENTATION_URL,
  },
  fidelity: {
    behavior: "deterministic-synthetic",
    providerNetwork: false,
    outputWireParity: "unqualified",
  },
  defaultSlug: SALESFORCE_SOBJECT_READS_DEFAULT_SLUG,
  toolNames: [
    "getObjectSchema",
    "soqlQuery",
    "find",
    "getUserInfo",
    "listRecentSobjectRecords",
    "getRelatedRecords",
  ],
  credentialMode: "none",
  server: {
    version: 1,
    slug: SALESFORCE_SOBJECT_READS_DEFAULT_SLUG,
    serverInfo: {
      name: "Salesforce Hosted MCP SObject Reads (MockOS)",
      version: "1.0.0",
    },
    instructions:
      "This documentation-derived blueprint serves deterministic synthetic mockos.test fixtures. It never connects to Salesforce and does not claim Salesforce output-wire parity.",
    transport: {
      stateful: false,
      enableGet: false,
      sessionTtlSeconds: 3_600,
    },
    authentication: { mode: "none" },
    pageSize: 25,
    tools: [
      {
        name: "getObjectSchema",
        title: "Get object schema",
        description:
          "Returns a deterministic synthetic schema for the optional Salesforce object-name input.",
        inputSchema: {
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
        annotations: localReadAnnotations("Get object schema"),
        behavior: matchingFixture("getObjectSchema", [
          {
            when: { arguments: {} },
            value: objectSchemaIndexResult,
          },
          {
            when: { "arguments.object-name": "Account" },
            value: accountSchemaResult,
          },
        ]),
      },
      {
        name: "soqlQuery",
        title: "Run SOQL query",
        description:
          "Returns a deterministic synthetic result for one documented-style SOQL fixture.",
        inputSchema: {
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
        annotations: localReadAnnotations("Run SOQL query"),
        behavior: matchingFixture("soqlQuery", [
          {
            when: {
              "arguments.query":
                "SELECT Id, Name, Industry FROM Account WHERE Name = 'Acme Test Industries' LIMIT 1",
            },
            value: soqlResult,
          },
        ]),
      },
      {
        name: "find",
        title: "Search Salesforce records",
        description:
          "Returns deterministic synthetic records for one documented-style search fixture.",
        inputSchema: {
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
        annotations: localReadAnnotations("Search Salesforce records"),
        behavior: matchingFixture("find", [
          {
            when: {
              "arguments.search":
                "FIND {Acme Test} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)",
            },
            value: searchResult,
          },
        ]),
      },
      {
        name: "getUserInfo",
        title: "Get user information",
        description:
          "Returns deterministic synthetic Salesforce user and organization information.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: localReadAnnotations("Get user information"),
        behavior: matchingFixture("getUserInfo", [
          {
            when: { arguments: {} },
            value: userInfoResult,
          },
        ]),
      },
      {
        name: "listRecentSobjectRecords",
        title: "List recent SObject records",
        description:
          "Returns deterministic synthetic recent records for one SObject fixture.",
        inputSchema: {
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
        annotations: localReadAnnotations("List recent SObject records"),
        behavior: matchingFixture("listRecentSobjectRecords", [
          {
            when: { "arguments.sobject-name": "Account" },
            value: recentRecordsResult,
          },
        ]),
      },
      {
        name: "getRelatedRecords",
        title: "Get related records",
        description:
          "Returns deterministic synthetic related records for one SObject relationship fixture.",
        inputSchema: {
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
        annotations: localReadAnnotations("Get related records"),
        behavior: matchingFixture("getRelatedRecords", [
          {
            when: {
              "arguments.sobject-name": "Account",
              "arguments.id": "001MockOS0000001",
              "arguments.relationship-path": "Contacts",
            },
            value: relatedRecordsResult,
          },
        ]),
      },
    ],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    errorCodeMap: {},
  },
});

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object") return value;
  const seen = new WeakSet<object>();
  const pending: object[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const child = Reflect.get(current, key);
      if (child !== null && typeof child === "object") {
        pending.push(child);
      }
    }
    Object.freeze(current);
  }
  return value;
};

const toSummary = (blueprint: MockMcpBlueprint): MockMcpBlueprintSummary =>
  mockMcpBlueprintSummarySchema.parse({
    schemaVersion: blueprint.schemaVersion,
    blueprintVersion: blueprint.blueprintVersion,
    id: blueprint.id,
    title: blueprint.title,
    description: blueprint.description,
    provider: blueprint.provider,
    provenance: blueprint.provenance,
    fidelity: blueprint.fidelity,
    defaultSlug: blueprint.defaultSlug,
    toolNames: blueprint.toolNames,
    credentialMode: blueprint.credentialMode,
  });

const canonicalBlueprints = deepFreeze(
  [salesforceSobjectReadsBlueprint].sort((left, right) =>
    compareAscii(left.id, right.id)
  )
);
const canonicalBlueprintById = new Map(
  canonicalBlueprints.map((blueprint) => [blueprint.id, blueprint] as const)
);
const canonicalCatalog = deepFreeze(
  mockMcpBlueprintCatalogSchema.parse({
    schemaVersion: MOCK_MCP_BLUEPRINT_SCHEMA_VERSION,
    blueprints: canonicalBlueprints.map(toSummary),
  })
);

const cloneBlueprint = (blueprint: MockMcpBlueprint): MockMcpBlueprint =>
  mockMcpBlueprintSchema.parse(structuredClone(blueprint));

export class MockMcpBlueprintCatalogError extends Error {
  constructor(
    readonly code: "blueprint_not_found",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockMcpBlueprintCatalogError";
  }
}

export const listMockMcpBlueprints = (): MockMcpBlueprintCatalog =>
  mockMcpBlueprintCatalogSchema.parse(structuredClone(canonicalCatalog));

export const getMockMcpBlueprint = (id: string): MockMcpBlueprint | undefined => {
  const parsedId = mockMcpBlueprintIdSchema.parse(id);
  const blueprint = canonicalBlueprintById.get(parsedId);
  return blueprint ? cloneBlueprint(blueprint) : undefined;
};

export const requireMockMcpBlueprint = (id: string): MockMcpBlueprint => {
  const parsedId: MockMcpBlueprintId = mockMcpBlueprintIdSchema.parse(id);
  const blueprint = canonicalBlueprintById.get(parsedId);
  if (!blueprint) {
    throw new MockMcpBlueprintCatalogError(
      "blueprint_not_found",
      `Mock MCP blueprint ${parsedId} does not exist.`
    );
  }
  return cloneBlueprint(blueprint);
};

export const instantiateMockMcpBlueprint = (
  id: string,
  slugOverride?: string
): MockMcpSecretFreeServerWrite => {
  const blueprint = requireMockMcpBlueprint(id);
  const slug =
    slugOverride === undefined
      ? blueprint.defaultSlug
      : mockMcpSlugSchema.parse(slugOverride);
  return mockMcpSecretFreeServerWriteSchema.parse({
    ...structuredClone(blueprint.server),
    slug,
  });
};
