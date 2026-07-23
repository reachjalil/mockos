import { describe, expect, it } from "vitest";
import {
  MOCK_MCP_PROTOCOL_VERSION,
  mockMcpServerSpecSchema,
  parseMockMcpServerSpec,
  toMockMcpServerSummary,
} from "./mock-mcp";

const staticTextBehavior = {
  version: 1,
  type: "static",
  value: { content: [{ type: "text", text: "pong" }] },
} as const;

describe("mock MCP contracts", () => {
  it("accepts a strict, bounded server with tools, resources, and prompts", () => {
    const spec = parseMockMcpServerSpec({
      version: 1,
      slug: "support-agent",
      serverInfo: { name: "Support agent", version: "1.0.0" },
      tools: [
        {
          name: "lookup_ticket",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string" } },
          },
          behavior: staticTextBehavior,
        },
      ],
      resources: [
        {
          uri: "mockos://support/handbook",
          name: "handbook",
          behavior: {
            version: 1,
            type: "static",
            value: {
              contents: [
                {
                  uri: "mockos://support/handbook",
                  text: "Be kind.",
                },
              ],
            },
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
    });

    expect(MOCK_MCP_PROTOCOL_VERSION).toBe("2025-11-25");
    expect(spec.transport).toEqual({
      stateful: true,
      enableGet: false,
      sessionTtlSeconds: 3_600,
    });
    expect(spec.pageSize).toBe(50);
    expect(spec.authentication).toEqual({ mode: "none" });
    expect(
      toMockMcpServerSummary({
        spec,
        revision: 3,
        createdAt: "2026-07-23T12:00:00.000Z",
        updatedAt: "2026-07-23T12:30:00.000Z",
      })
    ).toMatchObject({
      slug: "support-agent",
      revision: 3,
      toolCount: 1,
      resourceCount: 1,
      promptCount: 1,
    });
  });

  it("rejects ambiguous slugs, duplicates, non-object schemas, and bad error codes", () => {
    const base = {
      version: 1,
      slug: "server",
      serverInfo: { name: "Server", version: "1" },
    };
    expect(() =>
      mockMcpServerSpecSchema.parse({ ...base, slug: "Not/Canonical" })
    ).toThrow();
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          { name: "same", behavior: staticTextBehavior },
          { name: "same", behavior: staticTextBehavior },
        ],
      })
    ).toThrow(/duplicate same/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "bad",
            inputSchema: { type: "string" },
            behavior: staticTextBehavior,
          },
        ],
      })
    ).toThrow(/object root/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "remote_schema",
            inputSchema: {
              type: "object",
              properties: {
                value: { $ref: "https://untrusted.example/schema.json" },
              },
            },
            behavior: staticTextBehavior,
          },
        ],
      })
    ).toThrow(/\$ref/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "malformed_schema",
            inputSchema: {
              type: "object",
              properties: { value: "not-a-schema" },
            },
            behavior: staticTextBehavior,
          },
        ],
      })
    ).toThrow(/property/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "unsafe_schema",
            inputSchema: JSON.parse(
              '{"type":"object","properties":{"__proto__":{"type":"string"}}}'
            ),
            behavior: staticTextBehavior,
          },
        ],
      })
    ).toThrow(/not permitted/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        errorCodeMap: { rate_limited: -32_700 },
      })
    ).toThrow();
  });
});
