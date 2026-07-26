import { describe, expect, it } from "vitest";
import {
  deleteMockMcpServerToolInputSchema,
  putMockMcpServerToolInputSchema,
  resetMockMcpStateToolInputSchema,
} from "./index";
import {
  MOCK_MCP_DEFAULT_PAGE_SIZE,
  MOCK_MCP_MAX_CAPABILITIES_PER_KIND,
  MOCK_MCP_MAX_SCHEMA_BYTES,
  MOCK_MCP_MAX_SPEC_BYTES,
  MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES,
  MOCK_MCP_PROTOCOL_VERSION,
  MOCK_MCP_STATE_CAPACITY,
  mockMcpBase64Schema,
  mockMcpPromptMessageSchema,
  mockMcpReadResourceResultSchema,
  mockMcpResourceContentsSchema,
  mockMcpResourceUriSchema,
  mockMcpServerPublicSpecSchema,
  mockMcpServerSpecSchema,
  mockMcpServerViewSchema,
  mockMcpServerWriteSchema,
  mockMcpToolResultSchema,
  mockMcpUriTemplateSchema,
  mockMcpUriTemplateVariables,
  parseMockMcpServerSpec,
  toMockMcpServerSummary,
  toMockMcpServerView,
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
    expect(spec.pageSize).toBe(MOCK_MCP_DEFAULT_PAGE_SIZE);
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
    ).toThrow(/expected \\"object\\"/);
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
    ).toThrow(/not used/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        errorCodeMap: { reserved: MOCK_MCP_STATE_CAPACITY },
        tools: [
          {
            name: "reserved_error",
            behavior: {
              version: 1,
              type: "error",
              code: "reserved",
              message: "Reserved.",
            },
          },
        ],
      })
    ).toThrow(/reserved/);
  });

  it("requires explicit capability schemas to declare an object root", () => {
    const base = {
      version: 1,
      slug: "schema-roots",
      serverInfo: { name: "Schema roots", version: "1" },
    };
    for (const field of ["inputSchema", "outputSchema"] as const) {
      expect(() =>
        mockMcpServerSpecSchema.parse({
          ...base,
          tools: [
            {
              name: `missing_${field}`,
              [field]: {},
              behavior: staticTextBehavior,
            },
          ],
        })
      ).toThrow();
    }
    expect(
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [{ name: "default_input", behavior: staticTextBehavior }],
      }).tools[0]?.inputSchema
    ).toEqual({ type: "object" });
  });

  it("accepts only canonical standard base64 for binary MCP content", () => {
    for (const valid of ["", "Zg==", "Zm8=", "Zm9v", "AP+/"]) {
      expect(mockMcpBase64Schema.parse(valid)).toBe(valid);
    }

    const binaryConsumers = (data: string) => [
      () =>
        mockMcpToolResultSchema.parse({
          content: [{ type: "image", data, mimeType: "image/png" }],
        }),
      () =>
        mockMcpToolResultSchema.parse({
          content: [{ type: "audio", data, mimeType: "audio/wav" }],
        }),
      () =>
        mockMcpResourceContentsSchema.parse({
          uri: "mockos://binary/content",
          blob: data,
        }),
      () =>
        mockMcpPromptMessageSchema.parse({
          role: "user",
          content: { type: "image", data, mimeType: "image/png" },
        }),
      () =>
        mockMcpPromptMessageSchema.parse({
          role: "assistant",
          content: { type: "audio", data, mimeType: "audio/wav" },
        }),
    ];

    for (const invalid of ["Zg", "Z===", "Zg===", "__8=", "Z g==", "Zh==", "Zm9="]) {
      expect(() => mockMcpBase64Schema.parse(invalid), invalid).toThrow(/base64/);
      for (const parse of binaryConsumers(invalid)) {
        expect(parse, invalid).toThrow(/base64/);
      }
    }
  });

  it("keeps bearer credentials write-only and verifier-free in every read view", () => {
    const write = mockMcpServerWriteSchema.parse({
      version: 1,
      slug: "credentialed-server",
      serverInfo: { name: "Credentialed server", version: "1" },
      authentication: {
        mode: "bearer",
        token: "mockos_test_token_12345",
      },
    });
    expect(write.authentication).toEqual({
      mode: "bearer",
      token: "mockos_test_token_12345",
    });
    expect(() =>
      mockMcpServerWriteSchema.parse({
        ...write,
        authentication: {
          mode: "bearer",
          tokenSha256: "a".repeat(64),
        },
      })
    ).toThrow();

    const record = {
      spec: parseMockMcpServerSpec({
        ...write,
        authentication: {
          mode: "bearer",
          tokenSha256: "a".repeat(64),
        },
      }),
      revision: 2,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:01:00.000Z",
    };
    const view = toMockMcpServerView(record);
    const summary = toMockMcpServerSummary(record);
    expect(view.spec.authentication).toEqual({
      mode: "bearer",
      configured: true,
    });
    for (const serialized of [JSON.stringify(view), JSON.stringify(summary)]) {
      expect(serialized).not.toContain("mockos_test_token_12345");
      expect(serialized).not.toContain("tokenSha256");
      expect(serialized).not.toContain("a".repeat(64));
    }
    expect(() =>
      mockMcpServerViewSchema.parse({
        ...view,
        spec: {
          ...view.spec,
          authentication: {
            mode: "bearer",
            configured: true,
            tokenSha256: "a".repeat(64),
          },
        },
      })
    ).toThrow();
    expect(() =>
      mockMcpServerPublicSpecSchema.parse({
        ...view.spec,
        authentication: {
          mode: "bearer",
          token: "mockos_test_token_12345",
        },
      })
    ).toThrow();
  });

  it("rejects a bearer credential reused anywhere outside its write-only leaf", () => {
    const token = "mockos_cross_field_token_12345";
    const base = {
      version: 1 as const,
      slug: "credential-containment",
      serverInfo: { name: "Credential containment", version: "1" },
      authentication: { mode: "bearer" as const, token },
    };
    expect(mockMcpServerWriteSchema.parse(base).authentication).toEqual({
      mode: "bearer",
      token,
    });

    const violations = [
      {
        ...base,
        instructions: `Never persist ${token} outside authentication.`,
      },
      {
        ...base,
        tools: [
          {
            name: "nested_value",
            behavior: {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: `reflected:${token}` }],
              },
            },
          },
        ],
      },
      {
        ...base,
        tools: [
          {
            name: "nested_key",
            behavior: {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: "safe" }],
                structuredContent: { [`prefix-${token}-suffix`]: true },
              },
            },
          },
        ],
      },
    ];

    for (const violation of violations) {
      const result = mockMcpServerWriteSchema.safeParse(violation);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Credential reuse must be rejected.");
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          message: "A bearer Mock Credential may appear only in authentication.token.",
          path: ["authentication"],
        }),
      ]);
      expect(JSON.stringify(result.error.issues)).not.toContain(token);
    }
  });

  it("rejects a bearer verifier reused anywhere outside its persisted leaf", () => {
    const verifier = "0123456789abcdef".repeat(4);
    const base = {
      version: 1 as const,
      slug: "verifier-containment",
      serverInfo: { name: "Verifier containment", version: "1" },
      authentication: { mode: "bearer" as const, tokenSha256: verifier },
    };
    expect(mockMcpServerSpecSchema.parse(base).authentication).toEqual({
      mode: "bearer",
      tokenSha256: verifier,
    });

    const violations = [
      {
        ...base,
        instructions: `Never persist ${verifier} outside authentication.`,
      },
      {
        ...base,
        tools: [
          {
            name: "nested_value",
            behavior: {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: `reflected:${verifier}` }],
              },
            },
          },
        ],
      },
      {
        ...base,
        tools: [
          {
            name: "nested_key",
            behavior: {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: "safe" }],
                structuredContent: { [`prefix-${verifier}-suffix`]: true },
              },
            },
          },
        ],
      },
    ];

    for (const violation of violations) {
      const result = mockMcpServerSpecSchema.safeParse(violation);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Verifier reuse must be rejected.");
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          message:
            "A bearer Mock Credential verifier may appear only in authentication.tokenSha256.",
          path: ["authentication"],
        }),
      ]);
      expect(JSON.stringify(result.error.issues)).not.toContain(verifier);
    }
  });

  it("requires explicit revision intent for every mock MCP mutation", () => {
    const server = {
      version: 1,
      slug: "revisioned-server",
      serverInfo: { name: "Revisioned server", version: "1" },
    };

    expect(
      putMockMcpServerToolInputSchema.parse({
        expectedRevision: null,
        server,
      })
    ).toMatchObject({ expectedRevision: null, server });
    expect(
      putMockMcpServerToolInputSchema.parse({
        expectedRevision: 7,
        server,
      })
    ).toMatchObject({ expectedRevision: 7, server });
    for (const expectedRevision of [undefined, 0, -1, 1.5, Number.MAX_VALUE]) {
      expect(() =>
        putMockMcpServerToolInputSchema.parse({
          expectedRevision,
          server,
        })
      ).toThrow();
    }
    expect(() =>
      putMockMcpServerToolInputSchema.parse({
        expectedRevision: null,
        server,
        unexpected: true,
      })
    ).toThrow(/Unknown top-level/);

    for (const schema of [
      deleteMockMcpServerToolInputSchema,
      resetMockMcpStateToolInputSchema,
    ]) {
      expect(schema.parse({ slug: server.slug, expectedRevision: 7 })).toEqual({
        slug: server.slug,
        expectedRevision: 7,
      });
      for (const expectedRevision of [undefined, null, 0, -1, 1.5]) {
        expect(() => schema.parse({ slug: server.slug, expectedRevision })).toThrow();
      }
      expect(() =>
        schema.parse({
          slug: server.slug,
          expectedRevision: 7,
          unexpected: true,
        })
      ).toThrow();
    }
  });

  it("accepts only safe absolute Level-1 URI templates", () => {
    const template = "mockos://support/tickets/{ticketId}/events/{eventId}?view=full";
    expect(mockMcpUriTemplateSchema.parse(template)).toBe(template);
    expect(mockMcpUriTemplateVariables(template)).toEqual(["ticketId", "eventId"]);

    for (const unsafe of [
      "/tickets/{ticketId}",
      "mockos://support/tickets",
      "mockos://support/{+path}",
      "mockos://support/{first,last}",
      "mockos://support/{ticketId*}",
      "mockos://support/{ticketId}/{ticketId}",
      "mockos://support/{ticketId",
      "mockos://support/ticketId}",
      "javascript:alert({ticketId})",
      "data:text/plain,{ticketId}",
      "https://user:secret@example.test/{ticketId}",
      "mockos://support/{ticket Id}",
      "mockos://support/{constructor}",
      "mockos://support/{prototype}",
      `mockos://support/${Array.from(
        { length: MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES + 1 },
        (_, index) => `{variable${index}}`
      ).join("/")}`,
    ]) {
      expect(() => mockMcpUriTemplateSchema.parse(unsafe), unsafe).toThrow();
    }
  });

  it("requires safe absolute identifiers for fixed and returned resources", () => {
    for (const valid of [
      "mockos://support/handbook",
      "urn:mockos:support:handbook",
      "https://resources.example.test/handbook",
    ]) {
      expect(mockMcpResourceUriSchema.parse(valid)).toBe(valid);
    }
    for (const invalid of [
      "relative/resource",
      "https://user:secret@resources.example.test/handbook",
      "javascript:alert(1)",
      "data:text/plain,handbook",
      "mockos://support/path with spaces",
      "https:\\resources.example.test\\handbook",
    ]) {
      expect(() => mockMcpResourceUriSchema.parse(invalid), invalid).toThrow();
      expect(() =>
        mockMcpReadResourceResultSchema.parse({
          contents: [{ uri: invalid, text: "invalid" }],
        })
      ).toThrow();
    }
  });

  it("rejects unimplemented schema vocabularies and enforces tight bounds", () => {
    const base = {
      version: 1,
      slug: "bounded-server",
      serverInfo: { name: "Bounded server", version: "1" },
    };
    for (const unsupported of [
      { type: "string", pattern: "^(a+)+$" },
      { type: "string", format: "email" },
    ]) {
      expect(() =>
        mockMcpServerSpecSchema.parse({
          ...base,
          tools: [
            {
              name: "bounded",
              inputSchema: {
                type: "object",
                properties: { value: unsupported },
              },
              behavior: staticTextBehavior,
            },
          ],
        })
      ).toThrow(/not supported/);
    }

    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        transport: { enableGet: true },
      })
    ).toThrow();
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: Array.from(
          { length: MOCK_MCP_MAX_CAPABILITIES_PER_KIND + 1 },
          (_, index) => ({
            name: `tool_${index}`,
            behavior: staticTextBehavior,
          })
        ),
      })
    ).toThrow();
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "oversized_schema",
            inputSchema: {
              type: "object",
              description: "x".repeat(MOCK_MCP_MAX_SCHEMA_BYTES),
            },
            behavior: staticTextBehavior,
          },
        ],
      })
    ).toThrow();
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...base,
        tools: [
          {
            name: "oversized_server",
            behavior: {
              version: 1,
              type: "static",
              value: "x".repeat(MOCK_MCP_MAX_SPEC_BYTES),
            },
          },
        ],
      })
    ).toThrow(/byte/);
  });

  it("requires an exact one-to-one JSON-RPC mapping for nested behavior errors", () => {
    const behavior = {
      version: 1,
      type: "match",
      cases: [
        {
          when: { mode: "limited" },
          behavior: {
            version: 1,
            type: "error",
            code: "rate_limited",
            message: "Try later.",
          },
        },
      ],
      fallback: {
        version: 1,
        type: "error",
        code: "unavailable",
        message: "Unavailable.",
      },
    } as const;
    const server = {
      version: 1,
      slug: "errors",
      serverInfo: { name: "Errors", version: "1" },
      tools: [{ name: "fail", behavior }],
    };

    expect(() => mockMcpServerSpecSchema.parse(server)).toThrow(
      /requires an errorCodeMap/
    );
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...server,
        tools: [
          {
            name: "prototype-name",
            behavior: {
              version: 1,
              type: "error",
              code: "toString",
              message: "Still requires an own mapping.",
            },
          },
        ],
      })
    ).toThrow(/requires an errorCodeMap/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...server,
        errorCodeMap: {
          rate_limited: -32_001,
          unavailable: -32_001,
        },
      })
    ).toThrow(/cannot share/);
    expect(() =>
      mockMcpServerSpecSchema.parse({
        ...server,
        errorCodeMap: {
          rate_limited: -32_001,
          unavailable: -32_002,
          unused: -32_003,
        },
      })
    ).toThrow(/not used/);
    expect(
      mockMcpServerSpecSchema.parse({
        ...server,
        errorCodeMap: {
          rate_limited: -32_001,
          unavailable: -32_002,
        },
      }).errorCodeMap
    ).toEqual({
      rate_limited: -32_001,
      unavailable: -32_002,
    });
  });
});
