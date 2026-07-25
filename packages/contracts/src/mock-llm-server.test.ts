import { describe, expect, it } from "vitest";
import {
  deleteMockLlmServerToolInputSchema,
  mockLlmServerRefToolInputSchema,
  putMockLlmServerToolInputSchema,
} from "./index";
import { MOCK_LLM_MAX_TEXT_LENGTH } from "./mock-llm";
import {
  MOCK_LLM_MAX_MODELS,
  MOCK_LLM_MAX_SERVER_SPEC_BYTES,
  mockLlmServerListSchema,
  mockLlmServerSpecSchema,
  mockLlmServerSummarySchema,
  mockLlmServerWriteSchema,
  toMockLlmServerSummary,
  toMockLlmServerView,
} from "./mock-llm-server";

const CREATED_AT = "2026-07-25T12:00:00.000Z";
const OPENAI_CREDENTIAL = "synthetic-openai-credential";
const ANTHROPIC_CREDENTIAL = "synthetic-anthropic-credential";

const serverWrite = () => ({
  version: 1 as const,
  slug: "agent-tests",
  name: "Agent tests",
  dialects: {
    openai: {
      enabled: true as const,
      authentication: {
        mode: "strict" as const,
        apiKey: OPENAI_CREDENTIAL,
      },
    },
    anthropic: {
      enabled: true as const,
      authentication: {
        mode: "strict" as const,
        apiKey: ANTHROPIC_CREDENTIAL,
      },
    },
  },
  models: [
    {
      id: "mockos-text-1",
      displayName: "mockOS Text 1",
      createdAtEpochSeconds: 1_785_000_000,
      behavior: {
        version: 1 as const,
        type: "static" as const,
        value: "Hello from mockOS.",
      },
    },
  ],
});

describe("mock LLM server contract", () => {
  it("parses a bounded provider-neutral definition and applies planning defaults", () => {
    expect(mockLlmServerWriteSchema.parse(serverWrite())).toMatchObject({
      version: 1,
      slug: "agent-tests",
      models: [{ id: "mockos-text-1" }],
      defaultUsage: { inputTokens: 0, outputTokens: 0 },
      defaultCadence: {
        chunkDelayMilliseconds: 0,
        chunkSize: 256,
        maximumDurationMilliseconds: 60_000,
      },
    });

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        slug: "Not/Canonical",
      })
    ).toThrow();
    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        dialects: {
          openai: { enabled: false },
          anthropic: { enabled: false },
        },
      })
    ).toThrow(/At least one mock LLM dialect/);
    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [...serverWrite().models, ...serverWrite().models],
      })
    ).toThrow(/model IDs must be unique/);

    const acceptAny = mockLlmServerWriteSchema.parse({
      ...serverWrite(),
      dialects: {
        openai: {
          enabled: true,
          authentication: { mode: "accept_any" },
        },
        anthropic: { enabled: false },
      },
    });
    expect(acceptAny.dialects).toEqual({
      openai: {
        enabled: true,
        authentication: { mode: "accept_any" },
      },
      anthropic: { enabled: false },
    });
  });

  it("requires explicit compare-and-swap intent on writes", () => {
    expect(
      putMockLlmServerToolInputSchema.parse({
        expectedRevision: null,
        server: serverWrite(),
      }).expectedRevision
    ).toBeNull();
    expect(
      putMockLlmServerToolInputSchema.parse({
        environmentId: "env_test01",
        expectedRevision: 7,
        server: serverWrite(),
      }).expectedRevision
    ).toBe(7);
    expect(() =>
      putMockLlmServerToolInputSchema.parse({
        server: serverWrite(),
      })
    ).toThrow();
    expect(() =>
      putMockLlmServerToolInputSchema.parse({
        expectedRevision: 0,
        server: serverWrite(),
      })
    ).toThrow();
    expect(() =>
      putMockLlmServerToolInputSchema.parse({
        expectedRevision: null,
        server: serverWrite(),
        unexpectedTopLevel: true,
      })
    ).toThrow(/Unknown top-level mock LLM tool arguments/);
    expect(mockLlmServerRefToolInputSchema.parse({ slug: "agent-tests" })).toEqual({
      slug: "agent-tests",
    });
    expect(
      deleteMockLlmServerToolInputSchema.parse({
        slug: "agent-tests",
        expectedRevision: 7,
      })
    ).toEqual({ slug: "agent-tests", expectedRevision: 7 });
    expect(() =>
      deleteMockLlmServerToolInputSchema.parse({
        slug: "agent-tests",
      })
    ).toThrow();
  });

  it("keeps write credentials and persisted verifiers out of safe reads", () => {
    const write = mockLlmServerWriteSchema.parse(serverWrite());
    expect(JSON.stringify(write)).toContain(OPENAI_CREDENTIAL);
    expect(JSON.stringify(write)).not.toContain("apiKeySha256");

    const record = {
      spec: mockLlmServerSpecSchema.parse({
        ...write,
        dialects: {
          openai: {
            enabled: true,
            authentication: {
              mode: "strict",
              apiKeySha256: "a".repeat(64),
            },
          },
          anthropic: {
            enabled: true,
            authentication: {
              mode: "strict",
              apiKeySha256: "b".repeat(64),
            },
          },
        },
      }),
      revision: 7,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    const view = toMockLlmServerView(record);
    expect(view).toMatchObject({
      spec: {
        dialects: {
          openai: {
            enabled: true,
            authentication: { mode: "strict", configured: true },
          },
          anthropic: {
            enabled: true,
            authentication: { mode: "strict", configured: true },
          },
        },
      },
      revision: 7,
    });
    expect(JSON.stringify(view)).not.toContain("apiKey");
    expect(JSON.stringify(view)).not.toContain(OPENAI_CREDENTIAL);
    expect(JSON.stringify(view)).not.toContain("a".repeat(64));
    expect(toMockLlmServerSummary(record)).toEqual({
      slug: "agent-tests",
      name: "Agent tests",
      revision: 7,
      modelCount: 1,
      enabledDialects: ["openai", "anthropic"],
      updatedAt: CREATED_AT,
    });
    const summary = toMockLlmServerSummary(record);
    expect(() =>
      mockLlmServerSummarySchema.parse({
        ...summary,
        enabledDialects: ["openai", "openai"],
      })
    ).toThrow(/must be unique/);
    expect(() =>
      mockLlmServerListSchema.parse({ servers: [summary, summary] })
    ).toThrow(/slugs must be unique/);

    expect(() =>
      mockLlmServerSpecSchema.parse({
        ...write,
        dialects: {
          openai: {
            enabled: true,
            authentication: {
              mode: "strict",
              apiKey: OPENAI_CREDENTIAL,
            },
          },
          anthropic: { enabled: false },
        },
      })
    ).toThrow();

    expect(() =>
      mockLlmServerSpecSchema.parse({
        ...record.spec,
        name: "a".repeat(64),
      })
    ).toThrow(/verifier cannot be copied/);
  });

  it("rejects provider policy and invalid neutral results inside behaviors", () => {
    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "error",
              code: "provider_busy",
              message: "The provider is busy.",
              status: 503,
            },
          },
        ],
      })
    ).toThrow(/neutral mock LLM error kind|provider HTTP status/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "static",
              value: {
                segments: [
                  { type: "tool_call", id: "call_1", name: "lookup", input: {} },
                ],
                stopReason: "end_turn",
              },
            },
          },
        ],
      })
    ).toThrow(/valid neutral response plan/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "static",
              value: {
                segments: Array.from({ length: 3 }, (_, index) => ({
                  type: "tool_call",
                  id: `call_${index}`,
                  name: "lookup",
                  input: { values: Array.from({ length: 1_700 }, () => 0) },
                })),
                stopReason: "tool_use",
              },
            },
          },
        ],
      })
    ).toThrow(/valid neutral response plan/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "script",
              script: {
                scriptId: "future-script",
                version: 1,
                sha256: "c".repeat(64),
              },
              onFailure: "propagate",
            },
          },
        ],
      })
    ).toThrow(/requires an explicit declarative fallback/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "script",
              script: {
                scriptId: "future-script",
                version: 1,
                sha256: "c".repeat(64),
              },
              onFailure: "fallback",
              fallback: {
                version: 1,
                type: "static",
                value: "Safe declarative fallback.",
              },
            },
          },
        ],
      })
    ).not.toThrow();

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        defaultCadence: {
          chunkDelayMilliseconds: 0,
          chunkSize: 256,
          maximumDurationMilliseconds: 1_000,
        },
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              latency: {
                maximumMilliseconds: 600,
                seed: "outer-latency",
              },
              steps: [
                {
                  version: 1,
                  type: "static",
                  latency: {
                    maximumMilliseconds: 600,
                    seed: "inner-latency",
                  },
                  value: "Too slow in aggregate.",
                },
              ],
            },
          },
        ],
      })
    ).toThrow(/neutral response-plan bounds/);
  });

  it("rejects copied credentials and oversized definitions before persistence", () => {
    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        name: OPENAI_CREDENTIAL,
      })
    ).toThrow(/cannot be copied/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "static",
              value: {
                segments: [
                  {
                    type: "tool_call",
                    id: "call_1",
                    name: "lookup",
                    input: { [OPENAI_CREDENTIAL]: "copied into a key" },
                  },
                ],
                stopReason: "tool_use",
              },
            },
          },
        ],
      })
    ).toThrow(/cannot be copied/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "static",
              value: "x".repeat(MOCK_LLM_MAX_SERVER_SPEC_BYTES),
            },
          },
        ],
      })
    ).toThrow(/violates its .*byte/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: Array.from({ length: MOCK_LLM_MAX_MODELS + 1 }, (_, index) => ({
          ...serverWrite().models[0],
          id: `mockos-text-${index}`,
        })),
      })
    ).toThrow();

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        models: [
          {
            ...serverWrite().models[0],
            behavior: {
              version: 1,
              type: "static",
              value: "x".repeat(MOCK_LLM_MAX_TEXT_LENGTH + 1),
            },
          },
        ],
      })
    ).toThrow(/neutral response-plan bounds/);

    expect(() =>
      mockLlmServerWriteSchema.parse({
        ...serverWrite(),
        defaultCadence: {
          chunkDelayMilliseconds: 2_000,
          chunkSize: 256,
          maximumDurationMilliseconds: 1_000,
        },
      })
    ).toThrow(/Chunk delay cannot exceed/);
  });
});
