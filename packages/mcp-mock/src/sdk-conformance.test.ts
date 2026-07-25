import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createTestHarness, endpoint, serverRecord } from "./test-support";

describe("official MCP SDK client conformance", () => {
  it("negotiates 2025-11-25 and exercises the JSON Streamable HTTP surface", async () => {
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "hello",
            inputSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
              additionalProperties: false,
            },
            behavior: {
              version: 1,
              type: "template",
              template: "Hello {{arguments.name}}",
            },
          },
        ],
        resources: [
          {
            uri: "mockos://guide",
            name: "guide",
            behavior: {
              version: 1,
              type: "static",
              value: "Read the guide.",
            },
          },
        ],
        resourceTemplates: [
          {
            uriTemplate: "mockos://users/{id}",
            name: "user",
            behavior: {
              version: 1,
              type: "template",
              template: "User {{variables.id}}",
            },
          },
        ],
        prompts: [
          {
            name: "welcome",
            arguments: [{ name: "name", required: true }],
            behavior: {
              version: 1,
              type: "template",
              template: "Welcome {{arguments.name}}",
            },
          },
        ],
      })
    );
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        return harness.handler(request, { server: harness.server });
      },
    });
    const client = new Client({ name: "mockos-conformance", version: "1.0.0" });

    try {
      await client.connect(transport);
      expect(transport.protocolVersion).toBe("2025-11-25");
      expect(transport.sessionId).toMatch(/^session_/u);
      await expect(client.ping()).resolves.toEqual({});

      await expect(client.listTools()).resolves.toMatchObject({
        tools: [{ name: "hello" }],
      });
      await expect(
        client.callTool({ name: "hello", arguments: { name: "Ada" } })
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "Hello Ada" }],
      });

      await expect(client.listResources()).resolves.toMatchObject({
        resources: [{ uri: "mockos://guide", name: "guide" }],
      });
      await expect(
        client.readResource({ uri: "mockos://guide" })
      ).resolves.toMatchObject({
        contents: [{ uri: "mockos://guide", text: "Read the guide." }],
      });
      await expect(client.listResourceTemplates()).resolves.toMatchObject({
        resourceTemplates: [{ uriTemplate: "mockos://users/{id}", name: "user" }],
      });

      await expect(client.listPrompts()).resolves.toMatchObject({
        prompts: [{ name: "welcome" }],
      });
      await expect(
        client.getPrompt({ name: "welcome", arguments: { name: "Ada" } })
      ).resolves.toMatchObject({
        messages: [
          {
            role: "user",
            content: { type: "text", text: "Welcome Ada" },
          },
        ],
      });

      await transport.terminateSession();
      expect(transport.sessionId).toBeUndefined();
      expect(harness.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ transportMethod: "GET", httpStatus: 405 }),
          expect.objectContaining({
            transportMethod: "DELETE",
            httpStatus: 204,
          }),
        ])
      );
    } finally {
      await client.close();
    }
  });
});
