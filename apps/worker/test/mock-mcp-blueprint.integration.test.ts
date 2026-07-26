import { exports } from "cloudflare:workers";
import {
  type MockMcpBlueprint,
  type MockMcpBlueprintCatalog,
  type MockMcpBlueprintInstallResult,
  mockosMcpToolNames,
} from "@mockos/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const blueprintId = "salesforce/hosted-mcp/sobject-reads";
const defaultSlug = "salesforce-sobject-reads";
const alternateSlug = "salesforce-sobject-reads-copy";
const worker = (exports as unknown as { default: Fetcher }).default;
const routedRequests: Array<{
  readonly url: string;
  readonly hasAuthorization: boolean;
}> = [];

const routedFetch: typeof globalThis.fetch = async (input, init) => {
  const request =
    input instanceof Request && init === undefined ? input : new Request(input, init);
  if (new URL(request.url).origin !== origin) {
    throw new Error(`Unexpected provider-network request: ${request.url}`);
  }
  if (new URL(request.url).pathname.includes("/mcp-mock/")) {
    expect(request.headers.has("authorization")).toBe(false);
  }
  routedRequests.push({
    url: request.url,
    hasAuthorization: request.headers.has("authorization"),
  });
  return worker.fetch(request);
};

type ConnectedClient = {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
};

const connectClient = async (
  endpoint: string,
  bearerToken?: string
): Promise<ConnectedClient> => {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    ...(bearerToken
      ? { requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } } }
      : {}),
    fetch: routedFetch,
  });
  const client = new Client({
    name: "mockos-blueprint-integration",
    version: "1.0.0",
  });
  await client.connect(transport);
  return { client, transport };
};

const callData = async <Value>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<Value> => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const structured = result.structuredContent as { data?: Value } | undefined;
  expect(structured?.data, JSON.stringify(result)).toBeDefined();
  return structured?.data as Value;
};

const expectProblem = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
  expected: { code: string; status: number }
) => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  expect(result._meta?.["mockos/problem"]).toMatchObject(expected);
};

const customServer = (version: string) => ({
  version: 1,
  slug: defaultSlug,
  serverInfo: { name: "Custom pre-blueprint server", version },
  instructions: "A distinct local definition used to prove blueprint CAS.",
  authentication: { mode: "none" },
  tools: [
    {
      name: "customFixture",
      behavior: {
        version: 1,
        type: "static",
        value: {
          content: [{ type: "text", text: `custom-${version}` }],
        },
      },
    },
  ],
});

const expectedTools = [
  "getObjectSchema",
  "soqlQuery",
  "find",
  "getUserInfo",
  "listRecentSobjectRecords",
  "getRelatedRecords",
] as const;

const successfulCalls = [
  [
    "soqlQuery",
    {
      query:
        "SELECT Id, Name, Industry FROM Account WHERE Name = 'Acme Test Industries' LIMIT 1",
    },
  ],
  [
    "find",
    {
      search:
        "FIND {Acme Test} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)",
    },
  ],
  ["getUserInfo", {}],
  ["listRecentSobjectRecords", { "sobject-name": "Account" }],
  [
    "getRelatedRecords",
    {
      "sobject-name": "Account",
      id: "001MockOS0000001",
      "relationship-path": "Contacts",
    },
  ],
] as const;

describe("Salesforce mock MCP blueprint", () => {
  it("installs through CAS and completes the local exercise-observe-assert loop", {
    timeout: 30_000,
  }, async () => {
    routedRequests.splice(0);
    let management: ConnectedClient | undefined;
    let dataPlane: ConnectedClient | undefined;
    let environmentId: string | undefined;

    try {
      management = await connectClient(`${origin}/mcp`, apiKey);
      const advertised = await management.client.listTools();
      expect(advertised.tools.map(({ name }) => name)).toEqual(mockosMcpToolNames);
      expect(advertised.tools).toHaveLength(27);

      const catalog = await callData<MockMcpBlueprintCatalog>(
        management.client,
        "list_mock_mcp_blueprints",
        {}
      );
      expect(catalog).toMatchObject({
        schemaVersion: 1,
        blueprints: [
          {
            id: blueprintId,
            blueprintVersion: 1,
            defaultSlug,
            provider: "salesforce",
            toolNames: expectedTools,
            provenance: {
              kind: "documentation-derived",
              upstream: {
                product: "Salesforce Hosted MCP Servers",
                server: "platform/sobject-reads",
              },
              sourceReviewedAt: "2026-07-25",
            },
            fidelity: {
              behavior: "deterministic-synthetic",
              providerNetwork: false,
              outputWireParity: "unqualified",
            },
          },
        ],
      });
      const blueprint = await callData<MockMcpBlueprint>(
        management.client,
        "get_mock_mcp_blueprint",
        { blueprintId }
      );
      expect(blueprint.server.tools.map(({ name }) => name)).toEqual(expectedTools);
      expect(blueprint.server.authentication).toEqual({ mode: "none" });
      await expectProblem(
        management.client,
        "get_mock_mcp_blueprint",
        { blueprintId: "salesforce/hosted-mcp/unknown" },
        { code: "MOCK_MCP_BLUEPRINT_NOT_FOUND", status: 404 }
      );

      const environment = await callData<{ id: string }>(
        management.client,
        "create_environment",
        {
          name: "Salesforce blueprint integration",
          provider: "entra",
          seed: "salesforce-blueprint-integration",
        }
      );
      environmentId = environment.id;
      await expectProblem(
        management.client,
        "install_mock_mcp_blueprint",
        {
          environmentId,
          blueprintId: "salesforce/hosted-mcp/unknown",
          expectedRevision: null,
        },
        { code: "MOCK_MCP_BLUEPRINT_NOT_FOUND", status: 404 }
      );

      const seeded = await callData<{ revision: number }>(
        management.client,
        "put_mock_mcp_server",
        {
          environmentId,
          expectedRevision: null,
          server: customServer("preseed"),
        }
      );
      expect(seeded.revision).toBe(1);
      await expectProblem(
        management.client,
        "install_mock_mcp_blueprint",
        { environmentId, blueprintId, expectedRevision: null },
        { code: "MOCK_MCP_SERVER_REVISION_CONFLICT", status: 409 }
      );

      const installed = await callData<MockMcpBlueprintInstallResult>(
        management.client,
        "install_mock_mcp_blueprint",
        { environmentId, blueprintId, expectedRevision: seeded.revision }
      );
      expect(installed).toMatchObject({
        schemaVersion: 1,
        blueprintId,
        blueprintVersion: 1,
        server: {
          revision: 2,
          spec: {
            slug: defaultSlug,
            authentication: { mode: "none" },
          },
        },
      });
      const replay = await callData<MockMcpBlueprintInstallResult>(
        management.client,
        "install_mock_mcp_blueprint",
        { environmentId, blueprintId, expectedRevision: seeded.revision }
      );
      expect(replay).toEqual(installed);

      const mutated = await callData<{ revision: number }>(
        management.client,
        "put_mock_mcp_server",
        {
          environmentId,
          expectedRevision: installed.server.revision,
          server: customServer("mutated"),
        }
      );
      expect(mutated.revision).toBe(3);
      await expectProblem(
        management.client,
        "install_mock_mcp_blueprint",
        {
          environmentId,
          blueprintId,
          expectedRevision: installed.server.revision,
        },
        { code: "MOCK_MCP_SERVER_REVISION_CONFLICT", status: 409 }
      );
      const currentInstall = await callData<MockMcpBlueprintInstallResult>(
        management.client,
        "install_mock_mcp_blueprint",
        {
          environmentId,
          blueprintId,
          expectedRevision: mutated.revision,
        }
      );
      expect(currentInstall.server.revision).toBe(4);
      const alternate = await callData<MockMcpBlueprintInstallResult>(
        management.client,
        "install_mock_mcp_blueprint",
        {
          environmentId,
          blueprintId,
          slug: alternateSlug,
          expectedRevision: null,
        }
      );
      expect(alternate).toMatchObject({
        blueprintVersion: 1,
        server: {
          revision: 5,
          spec: { slug: alternateSlug, authentication: { mode: "none" } },
        },
      });

      dataPlane = await connectClient(
        `${origin}/e/${environmentId}/mcp-mock/${defaultSlug}`
      );
      const dataTools = await dataPlane.client.listTools();
      expect(dataTools.tools.map(({ name }) => name)).toEqual(expectedTools);
      const requiredByName = new Map(
        dataTools.tools.map(({ name, inputSchema, annotations }) => [
          name,
          {
            required: inputSchema.required ?? [],
            additionalProperties: inputSchema.additionalProperties,
            annotations,
          },
        ])
      );
      expect(requiredByName).toEqual(
        new Map([
          [
            "getObjectSchema",
            {
              required: [],
              additionalProperties: false,
              annotations: {
                title: "Get object schema",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          [
            "soqlQuery",
            {
              required: ["query"],
              additionalProperties: false,
              annotations: {
                title: "Run SOQL query",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          [
            "find",
            {
              required: ["search"],
              additionalProperties: false,
              annotations: {
                title: "Search Salesforce records",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          [
            "getUserInfo",
            {
              required: [],
              additionalProperties: false,
              annotations: {
                title: "Get user information",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          [
            "listRecentSobjectRecords",
            {
              required: ["sobject-name"],
              additionalProperties: false,
              annotations: {
                title: "List recent SObject records",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
          [
            "getRelatedRecords",
            {
              required: ["sobject-name", "id", "relationship-path"],
              additionalProperties: false,
              annotations: {
                title: "Get related records",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ],
        ])
      );

      const schemaIndex = await dataPlane.client.callTool({
        name: "getObjectSchema",
        arguments: {},
      });
      expect(schemaIndex.isError, JSON.stringify(schemaIndex)).not.toBe(true);
      expect(schemaIndex.structuredContent).toEqual({
        fixtureSource: "https://salesforce.mockos.test/fixtures/sobjects/schema-index",
        objects: [{ apiName: "Account", label: "Account" }],
      });
      const accountSchema = await dataPlane.client.callTool({
        name: "getObjectSchema",
        arguments: { "object-name": "Account" },
      });
      expect(accountSchema.isError, JSON.stringify(accountSchema)).not.toBe(true);
      expect(accountSchema.structuredContent).toMatchObject({
        fixtureSource:
          "https://salesforce.mockos.test/fixtures/sobjects/Account/schema",
        object: {
          apiName: "Account",
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "Id", type: "id" }),
          ]),
        },
      });
      expect(accountSchema.structuredContent).not.toEqual(
        schemaIndex.structuredContent
      );

      for (const [name, arguments_] of successfulCalls) {
        const result = await dataPlane.client.callTool({
          name,
          arguments: arguments_,
        });
        expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          fixtureSource: expect.stringMatching(/^https:\/\/salesforce\.mockos\.test\//),
        });
      }
      const repeatedUser = await dataPlane.client.callTool({
        name: "getUserInfo",
        arguments: {},
      });
      expect(repeatedUser.structuredContent).toEqual(
        (
          await dataPlane.client.callTool({
            name: "getUserInfo",
            arguments: {},
          })
        ).structuredContent
      );
      await expect(
        dataPlane.client.callTool({
          name: "soqlQuery",
          arguments: { query: "SELECT Id FROM Opportunity" },
        })
      ).resolves.toMatchObject({ isError: true });

      const requestLog = await callData<{
        entries: Array<{
          provider: string;
          protocol?: string;
          mcpMethod?: string;
          mcpTool?: string;
        }>;
      }>(management.client, "get_request_log", {
        environmentId,
        provider: "mcp",
        protocol: "mcp",
        limit: 100,
      });
      expect(requestLog.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: "mcp",
            protocol: "mcp",
            mcpMethod: "tools/call",
            mcpTool: "getUserInfo",
          }),
          expect.objectContaining({
            provider: "mcp",
            protocol: "mcp",
            mcpMethod: "tools/call",
            mcpTool: "soqlQuery",
          }),
        ])
      );
      await expect(
        callData<{ pass: boolean; matched: number }>(
          management.client,
          "assert_requests",
          {
            environmentId,
            source: "inbound",
            method: "POST",
            mcpMethod: "tools/call",
            mcpTool: "getUserInfo",
            count: { exactly: 3 },
          }
        )
      ).resolves.toMatchObject({ pass: true, matched: 3 });

      await expect(
        callData<{ slug: string; cleared: number }>(
          management.client,
          "reset_mock_mcp_state",
          {
            environmentId,
            slug: defaultSlug,
            expectedRevision: currentInstall.server.revision,
          }
        )
      ).resolves.toEqual({ slug: defaultSlug, cleared: 0 });
      for (const installedServer of [currentInstall.server, alternate.server]) {
        await expect(
          callData<{ slug: string; deleted: true }>(
            management.client,
            "delete_mock_mcp_server",
            {
              environmentId,
              slug: installedServer.spec.slug,
              expectedRevision: installedServer.revision,
            }
          )
        ).resolves.toEqual({
          slug: installedServer.spec.slug,
          deleted: true,
        });
      }

      expect(
        routedRequests
          .filter(({ url }) => new URL(url).pathname.includes("/mcp-mock/"))
          .every(({ hasAuthorization }) => !hasAuthorization)
      ).toBe(true);
      expect(JSON.stringify(routedRequests.map(({ url }) => url))).not.toContain(
        "salesforce.com"
      );
    } finally {
      await dataPlane?.client.close().catch(() => undefined);
      if (management && environmentId) {
        await management.client
          .callTool({
            name: "delete_environment",
            arguments: { environmentId },
          })
          .catch(() => undefined);
      }
      await management?.client.close().catch(() => undefined);
    }
  });
});
