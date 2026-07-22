import { describe, expect, it } from "vitest";
import { McpToolClient } from "../src/mcp-client.js";

describe("McpToolClient", () => {
  it("uses the POST-only fallback and terminates its server session", async () => {
    const requests: Request[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());

      if (request.method === "GET") {
        return new Response(null, { status: 405 });
      }
      if (request.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      const message = (await request.json()) as {
        id?: number;
        method?: string;
        params?: { protocolVersion?: string };
      };
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method !== "initialize") {
        throw new Error(`Unexpected MCP method ${message.method}.`);
      }

      return new Response(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "mockOS", version: "test" },
          },
        })}\n\n`,
        {
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "test-session",
          },
        }
      );
    };
    const client = new McpToolClient({
      endpoint: "https://mockos.example/mcp",
      apiKey: "test-key",
      fetch,
    });

    await client.connect();
    await client.close();

    expect(requests.map(({ method }) => method)).toEqual([
      "POST",
      "POST",
      "GET",
      "DELETE",
    ]);
    const terminated = requests.at(-1);
    expect(terminated?.headers.get("mcp-session-id")).toBe("test-session");
    expect(terminated?.headers.get("authorization")).toBe("Bearer test-key");
  });
});
