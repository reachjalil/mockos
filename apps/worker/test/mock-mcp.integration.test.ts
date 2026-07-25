import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { EnvironmentDurableObject } from "@mockos/worker-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const mockBearer = "mockos-public-mcp-token-123456";
const worker = (exports as unknown as { default: Fetcher }).default;
const environments = Reflect.get(
  env,
  "ENVIRONMENTS"
) as DurableObjectNamespace<EnvironmentDurableObject>;

const routedFetch: typeof globalThis.fetch = async (input, init) =>
  worker.fetch(new Request(input, init));

type ConnectedClient = {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
};

const connectClient = async (
  endpoint: string,
  bearerToken: string
): Promise<ConnectedClient> => {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${bearerToken}`,
      },
    },
    fetch: routedFetch,
  });
  const client = new Client({
    name: "mockos-worker-integration",
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

const postMockRpc = (
  endpoint: string,
  token: string,
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<Response> => {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-11-25",
  });
  if (sessionId) headers.set("MCP-Session-Id", sessionId);
  return worker.fetch(
    new Request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })
  );
};

const mockServer = (version = "1.0.0") =>
  ({
    version: 1,
    slug: "support-agent",
    serverInfo: { name: "Support agent", version },
    instructions: "Use this server to exercise the public mock MCP data plane.",
    authentication: { mode: "bearer", token: mockBearer },
    pageSize: 1,
    tools: [
      {
        name: "greet",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2 },
          },
          required: ["name"],
          additionalProperties: false,
        },
        behavior: {
          version: 1,
          type: "template",
          template: "Hello {{arguments.name}}",
        },
      },
      {
        name: "next_status",
        behavior: {
          version: 1,
          type: "sequence",
          mode: "hold_last",
          steps: [
            {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: "queued" }],
              },
            },
            {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: "complete" }],
              },
            },
          ],
        },
      },
      {
        name: "observe_arguments",
        inputSchema: {
          type: "object",
        },
        behavior: {
          version: 1,
          type: "static",
          value: {
            content: [{ type: "text", text: "observed" }],
          },
        },
      },
      {
        name: "cancel_me",
        behavior: {
          version: 1,
          type: "static",
          latency: {
            minimumMilliseconds: 500,
            maximumMilliseconds: 500,
            seed: "worker-cancellation",
          },
          value: {
            content: [{ type: "text", text: "too late" }],
          },
        },
      },
    ],
    resources: [
      {
        uri: "mockos://support/handbook",
        name: "handbook",
        behavior: {
          version: 1,
          type: "static",
          value: "Be kind and verify the request log.",
        },
      },
    ],
    resourceTemplates: [
      {
        uriTemplate: "mockos://support/tickets/{ticketId}",
        name: "ticket",
        behavior: {
          version: 1,
          type: "template",
          template: "Ticket {{variables.ticketId}}",
        },
      },
    ],
    prompts: [
      {
        name: "triage",
        arguments: [{ name: "ticket", required: true }],
        behavior: {
          version: 1,
          type: "template",
          template: "Triage {{arguments.ticket}}",
        },
      },
    ],
  }) as const;

describe("public mock MCP Worker route", () => {
  it("configures through management MCP and serves an observed official-client session", {
    timeout: 30_000,
  }, async () => {
    let management: ConnectedClient | undefined;
    let dataPlane: ConnectedClient | undefined;
    let environmentId: string | undefined;

    try {
      management = await connectClient(`${origin}/mcp`, apiKey);
      const environment = await callData<{ id: string }>(
        management.client,
        "create_environment",
        {
          name: "Mock MCP Worker integration",
          provider: "entra",
          seed: "mock-mcp-worker-integration",
        }
      );
      environmentId = environment.id;

      const firstPut = await callData<{
        revision: number;
        updatedAt: string;
        spec: {
          authentication: { mode: "bearer"; configured: true };
        };
      }>(management.client, "put_mock_mcp_server", {
        server: mockServer(),
      });
      expect(firstPut).toMatchObject({
        revision: 1,
        spec: {
          authentication: { mode: "bearer", configured: true },
        },
      });
      expect(JSON.stringify(firstPut)).not.toContain(mockBearer);
      expect(JSON.stringify(firstPut)).not.toContain("tokenSha256");

      const replay = await callData<{
        revision: number;
        updatedAt: string;
      }>(management.client, "put_mock_mcp_server", {
        server: mockServer(),
      });
      expect(replay).toMatchObject({
        revision: firstPut.revision,
        updatedAt: firstPut.updatedAt,
      });

      const endpoint = `${origin}/e/${environmentId}/mcp-mock/support-agent`;
      const platformCredential = await postMockRpc(endpoint, apiKey, {
        jsonrpc: "2.0",
        id: "platform-key",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "rejected", version: "1" },
        },
      });
      expect(platformCredential.status).toBe(401);
      expect(await platformCredential.text()).not.toContain(apiKey);

      const wrongCredential = await postMockRpc(endpoint, "wrong-mock-credential", {
        jsonrpc: "2.0",
        id: "wrong-key",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "rejected", version: "1" },
        },
      });
      expect(wrongCredential.status).toBe(401);

      dataPlane = await connectClient(endpoint, mockBearer);
      expect(dataPlane.transport.protocolVersion).toBe("2025-11-25");
      expect(dataPlane.transport.sessionId).toBeTruthy();
      expect(dataPlane.client.getServerVersion()).toMatchObject({
        name: "Support agent",
        version: "1.0.0",
      });
      await expect(dataPlane.client.ping()).resolves.toEqual({});

      const firstTools = await dataPlane.client.listTools();
      expect(firstTools.tools).toEqual([expect.objectContaining({ name: "greet" })]);
      expect(firstTools.nextCursor).toEqual(expect.any(String));
      await expect(
        dataPlane.client.listTools({ cursor: firstTools.nextCursor })
      ).resolves.toMatchObject({
        tools: [expect.objectContaining({ name: "next_status" })],
      });

      await expect(
        dataPlane.client.callTool({
          name: "greet",
          arguments: { name: "Ada" },
        })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "Hello Ada" }],
      });
      await expect(
        dataPlane.client.callTool({
          name: "greet",
          arguments: { name: "A" },
        })
      ).resolves.toMatchObject({
        isError: true,
      });
      await expect(
        dataPlane.client.callTool({ name: "missing", arguments: {} })
      ).rejects.toMatchObject({ code: -32_602 });

      await expect(
        dataPlane.client.callTool({ name: "next_status", arguments: {} })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "queued" }],
      });
      await expect(
        dataPlane.client.callTool({ name: "next_status", arguments: {} })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "complete" }],
      });
      const oversizedArgumentKey = "k".repeat(257);
      await expect(
        dataPlane.client.callTool({
          name: "observe_arguments",
          arguments: { [oversizedArgumentKey]: "synthetic" },
        })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "observed" }],
      });

      const environmentObject = environments.get(
        environments.idFromName(environmentId)
      );
      const cancellationSessionId = dataPlane.transport.sessionId ?? "";
      const cancellationResponse = await runInDurableObject(
        environmentObject,
        async (instance) => {
          const cancellationController = new AbortController();
          const cancellationRequest = new Request(`${origin}/mcp-mock/support-agent`, {
            method: "POST",
            headers: {
              Accept: "application/json, text/event-stream",
              Authorization: `Bearer ${mockBearer}`,
              "Content-Type": "application/json",
              "MCP-Protocol-Version": "2025-11-25",
              "MCP-Session-Id": cancellationSessionId,
              "x-mockos-mcp-slug": "support-agent",
              "x-mockos-public-path": `/e/${environmentId}/mcp-mock/support-agent`,
              "x-mockos-route-kind": "mock-mcp",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "cancelled-call",
              method: "tools/call",
              params: { name: "cancel_me", arguments: {} },
            }),
            signal: cancellationController.signal,
          });
          const responsePromise = instance.fetch(cancellationRequest);
          setTimeout(() => cancellationController.abort(), 100);
          return responsePromise;
        }
      );
      expect(cancellationResponse.status).toBe(200);
      await expect(cancellationResponse.json()).resolves.toMatchObject({
        id: "cancelled-call",
        error: { code: -32_800 },
      });

      await expect(
        dataPlane.client.readResource({
          uri: "mockos://support/handbook",
        })
      ).resolves.toMatchObject({
        contents: [
          {
            uri: "mockos://support/handbook",
            text: "Be kind and verify the request log.",
          },
        ],
      });
      await expect(
        dataPlane.client.readResource({
          uri: "mockos://support/tickets/T-42",
        })
      ).resolves.toMatchObject({
        contents: [
          {
            uri: "mockos://support/tickets/T-42",
            text: "Ticket T-42",
          },
        ],
      });
      await expect(
        dataPlane.client.getPrompt({
          name: "triage",
          arguments: { ticket: "T-42" },
        })
      ).resolves.toMatchObject({
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Triage T-42" },
          },
        ],
      });

      const reset = await callData<{ slug: string; cleared: number }>(
        management.client,
        "reset_mock_mcp_state",
        { slug: "support-agent" }
      );
      expect(reset).toEqual({ slug: "support-agent", cleared: 1 });
      await expect(
        dataPlane.client.callTool({ name: "next_status", arguments: {} })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "queued" }],
      });

      const dataSessionId = dataPlane.transport.sessionId ?? "";
      await dataPlane.transport.terminateSession();
      const repeatedDelete = await worker.fetch(
        new Request(endpoint, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${mockBearer}`,
            "MCP-Protocol-Version": "2025-11-25",
            "MCP-Session-Id": dataSessionId,
          },
        })
      );
      expect(repeatedDelete.status).toBe(404);

      const rawInitialize = await postMockRpc(endpoint, mockBearer, {
        jsonrpc: "2.0",
        id: "revision-session",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "revision-check", version: "1" },
        },
      });
      expect(rawInitialize.status, await rawInitialize.clone().text()).toBe(200);
      const staleSessionId = rawInitialize.headers.get("MCP-Session-Id");
      expect(staleSessionId).toBeTruthy();

      const changed = await callData<{ revision: number }>(
        management.client,
        "put_mock_mcp_server",
        {
          server: mockServer("1.0.1"),
        }
      );
      expect(changed.revision).toBe(2);
      const stalePing = await postMockRpc(
        endpoint,
        mockBearer,
        { jsonrpc: "2.0", id: "stale", method: "ping" },
        staleSessionId ?? undefined
      );
      expect(stalePing.status).toBe(404);

      const requestLog = await callData<{
        entries: Array<{
          provider: string;
          protocol?: string;
          requestHeaders: Record<string, string>;
          mcpMethod?: string;
          mcpTool?: string;
          mcpArguments?: Record<string, unknown>;
          mcpErrorCode?: number;
        }>;
      }>(management.client, "get_request_log", {
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
            mcpTool: "greet",
            mcpArguments: { name: "Ada" },
          }),
          expect.objectContaining({
            provider: "mcp",
            protocol: "mcp",
            mcpMethod: "tools/call",
            mcpTool: "observe_arguments",
            mcpArguments: {
              _mockos: "[REDACTED:UNSUPPORTED_KEY]",
            },
          }),
          expect.objectContaining({
            provider: "mcp",
            protocol: "mcp",
            mcpMethod: "tools/call",
            mcpTool: "cancel_me",
            mcpErrorCode: -32_800,
          }),
        ])
      );
      const serializedLog = JSON.stringify(requestLog);
      expect(serializedLog).not.toContain(oversizedArgumentKey);
      expect(serializedLog).not.toContain(mockBearer);
      expect(serializedLog).not.toContain(dataSessionId);
      expect(serializedLog).toContain("[REDACTED]");

      const deletedServer = await callData<{
        slug: string;
        deleted: boolean;
      }>(management.client, "delete_mock_mcp_server", {
        slug: "support-agent",
      });
      expect(deletedServer).toEqual({
        slug: "support-agent",
        deleted: true,
      });
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
