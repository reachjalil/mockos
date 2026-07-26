import {
  mockMcpJsonSchemaSchema,
  REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH,
  requestLogMcpArgumentsSchema,
} from "@mockos/contracts";
import { evaluateBehavior } from "@mockos/core";
import { describe, expect, it } from "vitest";
import { validateMockMcpJsonSchema } from "./json-schema";
import {
  createTestHarness,
  initialize,
  rpc,
  serverRecord,
  textToolResult,
} from "./test-support";

const responseBody = async (response: Response) =>
  (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };

describe("mock MCP behavior dispatch", () => {
  it("validates tool input and shapes string output before exact result validation", async () => {
    const harness = createTestHarness(
      serverRecord({
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
            name: "structured",
            outputSchema: {
              type: "object",
              properties: { answer: { type: "integer", minimum: 1 } },
              required: ["answer"],
              additionalProperties: false,
            },
            behavior: {
              version: 1,
              type: "static",
              value: {
                content: [{ type: "text", text: '{"answer":42}' }],
                structuredContent: { answer: 42 },
              },
            },
          },
          {
            name: "recoverable_error",
            outputSchema: {
              type: "object",
              properties: { answer: { type: "integer" } },
              required: ["answer"],
              additionalProperties: false,
            },
            behavior: {
              version: 1,
              type: "static",
              value: textToolResult("Fix the input and retry.", true),
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);

    const invalid = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "A", extra: true } },
      },
      sessionId
    );
    const invalidResult = (await responseBody(invalid)).result;
    expect(invalidResult?.isError).toBe(true);
    expect(invalidResult?.content).toEqual([
      {
        type: "text",
        text: "Tool arguments do not match inputSchema.",
      },
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("$.name"),
      }),
    ]);

    const attackerControlledKey = "x".repeat(60_000);
    const longAdditionalProperty = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "greet",
          arguments: { name: "Ada", [attackerControlledKey]: true },
        },
      },
      sessionId
    );
    const longAdditionalPropertyBody = await responseBody(longAdditionalProperty);
    const boundedContent = longAdditionalPropertyBody.result?.content as
      | Array<{ readonly type: string; readonly text?: string }>
      | undefined;
    expect(longAdditionalPropertyBody.result?.isError).toBe(true);
    expect(boundedContent?.[0]?.text).toBe("Tool arguments do not match inputSchema.");
    expect(boundedContent?.[1]?.text?.length).toBeLessThanOrEqual(8_192);
    expect(JSON.stringify(longAdditionalPropertyBody).length).toBeLessThan(9_000);

    const unknownTool = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: { name: "missing", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(unknownTool)).error?.code).toBe(-32_602);

    const invalidLongToolName = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 25,
        method: "tools/call",
        params: { name: "x".repeat(60_000), arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(invalidLongToolName)).error).toEqual({
      code: -32_602,
      message: "Tool name is invalid.",
    });

    const malformedCall = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 17,
        method: "tools/call",
        params: { name: "greet", arguments: "not-an-object" },
      },
      sessionId
    );
    expect((await responseBody(malformedCall)).error?.code).toBe(-32_602);

    const greeting = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "Ada" } },
      },
      sessionId
    );
    expect((await responseBody(greeting)).result).toEqual({
      content: [{ type: "text", text: "Hello Ada" }],
    });

    const structured = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "structured", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(structured)).result).toMatchObject({
      structuredContent: { answer: 42 },
    });

    const recoverableError = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "recoverable_error", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(recoverableError)).result).toEqual(
      textToolResult("Fix the input and retry.", true)
    );
  });

  it("keeps configured JSON-RPC errors distinct from tool isError results", async () => {
    const harness = createTestHarness(
      serverRecord({
        errorCodeMap: { rate_limited: -32_042 },
        tools: [
          {
            name: "protocol_failure",
            behavior: {
              version: 1,
              type: "error",
              code: "rate_limited",
              message: "Try later.",
              details: { retryAfter: 5 },
            },
          },
          {
            name: "tool_failure",
            behavior: {
              version: 1,
              type: "static",
              value: textToolResult("Choose another input.", true),
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);

    const protocolFailure = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "protocol_failure", arguments: {} },
      },
      sessionId
    );
    expect(await responseBody(protocolFailure)).toMatchObject({
      error: { code: -32_042, message: "Try later." },
    });

    const toolFailure = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "tool_failure", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(toolFailure)).result).toEqual({
      content: [{ type: "text", text: "Choose another input." }],
      isError: true,
    });
    expect(harness.observations.at(-1)).toMatchObject({
      mcpMethod: "tools/call",
      mcpTool: "tool_failure",
      mcpToolIsError: true,
    });
  });

  it("shapes fixed resources, Level-1 template resources, and prompts", async () => {
    const harness = createTestHarness(
      serverRecord({
        resources: [
          {
            uri: "mockos://handbook",
            name: "handbook",
            behavior: {
              version: 1,
              type: "static",
              value: "Be kind.",
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
            name: "triage",
            arguments: [{ name: "ticket", required: true }],
            behavior: {
              version: 1,
              type: "template",
              template: "Triage {{arguments.ticket}}",
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);

    const fixed = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: "mockos://handbook" },
      },
      sessionId
    );
    expect((await responseBody(fixed)).result).toEqual({
      contents: [{ uri: "mockos://handbook", text: "Be kind." }],
    });

    const templated = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 7,
        method: "resources/read",
        params: { uri: "mockos://users/ada%2Flovelace" },
      },
      sessionId
    );
    expect((await responseBody(templated)).result).toEqual({
      contents: [
        {
          uri: "mockos://users/ada%2Flovelace",
          text: "User ada/lovelace",
        },
      ],
    });

    const prompt = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "prompts/get",
        params: { name: "triage", arguments: { ticket: "T-42" } },
      },
      sessionId
    );
    expect((await responseBody(prompt)).result).toEqual({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Triage T-42" },
        },
      ],
    });

    const missingArgument = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 9,
        method: "prompts/get",
        params: { name: "triage", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(missingArgument)).error?.code).toBe(-32_602);

    const invalidLongPromptName = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 26,
        method: "prompts/get",
        params: { name: "x".repeat(60_000), arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(invalidLongPromptName)).error).toEqual({
      code: -32_602,
      message: "Prompt name is invalid.",
    });

    const missingResource = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 10,
        method: "resources/read",
        params: { uri: "mockos://missing" },
      },
      sessionId
    );
    expect((await responseBody(missingResource)).error?.code).toBe(-32_002);
  });

  it("does not commit a sequence until latency completes and output validates", async () => {
    const invalidHarness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "invalid_sequence",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              steps: [
                {
                  version: 1,
                  type: "static",
                  value: { notAResult: true },
                },
                {
                  version: 1,
                  type: "static",
                  value: textToolResult("second"),
                },
              ],
            },
          },
        ],
      })
    );
    const invalidSession = await initialize(invalidHarness);
    for (const id of [11, 12]) {
      const response = await rpc(
        invalidHarness,
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "invalid_sequence", arguments: {} },
        },
        invalidSession.sessionId
      );
      expect((await responseBody(response)).error?.code).toBe(-32_603);
    }
    expect(invalidHarness.repository.commits).toBe(0);

    const abortHarness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "slow_sequence",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              steps: [
                {
                  version: 1,
                  type: "static",
                  latency: {
                    minimumMilliseconds: 100,
                    maximumMilliseconds: 100,
                    seed: "slow",
                  },
                  value: textToolResult("first"),
                },
                {
                  version: 1,
                  type: "static",
                  value: textToolResult("second"),
                },
              ],
            },
          },
        ],
      })
    );
    const abortSession = await initialize(abortHarness);
    const controller = new AbortController();
    const pending = rpc(
      abortHarness,
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "slow_sequence", arguments: {} },
      },
      abortSession.sessionId,
      controller.signal
    );
    setTimeout(() => controller.abort(), 5);
    expect((await responseBody(await pending)).error?.code).toBe(-32_800);
    expect(abortHarness.repository.commits).toBe(0);

    const retry = await rpc(
      abortHarness,
      {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "slow_sequence", arguments: {} },
      },
      abortSession.sessionId
    );
    expect((await responseBody(retry)).result).toEqual(textToolResult("first"));
    expect(abortHarness.repository.commits).toBe(1);
  });

  it("applies configured-error latency and advances an error sequence only after commit", async () => {
    const harness = createTestHarness(
      serverRecord({
        errorCodeMap: { temporarily_unavailable: -32_043 },
        tools: [
          {
            name: "error_sequence",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              steps: [
                {
                  version: 1,
                  type: "error",
                  code: "temporarily_unavailable",
                  message: "Try again.",
                  latency: {
                    minimumMilliseconds: 30,
                    maximumMilliseconds: 30,
                    seed: "error-latency",
                  },
                },
                {
                  version: 1,
                  type: "static",
                  value: textToolResult("recovered"),
                },
              ],
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);
    const controller = new AbortController();
    const aborted = rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 18,
        method: "tools/call",
        params: { name: "error_sequence", arguments: {} },
      },
      sessionId,
      controller.signal
    );
    setTimeout(() => controller.abort(), 5);
    expect((await responseBody(await aborted)).error?.code).toBe(-32_800);
    expect(harness.repository.commits).toBe(0);

    const configuredError = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 19,
        method: "tools/call",
        params: { name: "error_sequence", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(configuredError)).error?.code).toBe(-32_043);
    expect(harness.repository.commits).toBe(1);

    const recovered = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "error_sequence", arguments: {} },
      },
      sessionId
    );
    expect((await responseBody(recovered)).result).toEqual(textToolResult("recovered"));
  });

  it("does not commit or return an old sequence value after replacement during latency", async () => {
    let evaluationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve;
    });
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "revision_sequence",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              steps: [
                {
                  version: 1,
                  type: "static",
                  latency: {
                    minimumMilliseconds: 30,
                    maximumMilliseconds: 30,
                    seed: "revision-value",
                  },
                  value: textToolResult("old revision"),
                },
              ],
            },
          },
        ],
      }),
      {
        evaluateBehavior: async (behavior, context) => {
          const plan = await evaluateBehavior(behavior, context);
          evaluationStarted();
          return plan;
        },
      }
    );
    const { sessionId } = await initialize(harness);
    const pending = rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: { name: "revision_sequence", arguments: {} },
      },
      sessionId
    );
    await started;
    harness.repository.serverRevisions.set(
      harness.server.spec.slug,
      harness.server.revision + 1
    );

    const response = await pending;
    expect(response.status).toBe(409);
    expect((await responseBody(response)).error?.message).toBe(
      "The mock MCP server changed while the request was in progress."
    );
    expect(harness.repository.commits).toBe(0);
  });

  it("does not commit or emit an old configured error after replacement during latency", async () => {
    let evaluationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve;
    });
    const harness = createTestHarness(
      serverRecord({
        errorCodeMap: { obsolete_failure: -32_044 },
        tools: [
          {
            name: "revision_error",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "hold_last",
              steps: [
                {
                  version: 1,
                  type: "error",
                  code: "obsolete_failure",
                  message: "Old configured error.",
                  latency: {
                    minimumMilliseconds: 30,
                    maximumMilliseconds: 30,
                    seed: "revision-error",
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        evaluateBehavior: async (behavior, context) => {
          const plan = await evaluateBehavior(behavior, context);
          evaluationStarted();
          return plan;
        },
      }
    );
    const { sessionId } = await initialize(harness);
    const pending = rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: { name: "revision_error", arguments: {} },
      },
      sessionId
    );
    await started;
    harness.repository.serverRevisions.set(
      harness.server.spec.slug,
      harness.server.revision + 1
    );

    const response = await pending;
    expect(response.status).toBe(409);
    expect((await responseBody(response)).error).toEqual({
      code: -32_001,
      message: "The mock MCP server changed while the request was in progress.",
    });
    expect(harness.repository.commits).toBe(0);
  });

  it("does not return a stale internal error after replacement during result validation", async () => {
    let evaluationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve;
    });
    let releaseEvaluation!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "invalid_result",
            behavior: {
              version: 1,
              type: "static",
              value: { invalid: true },
            },
          },
        ],
      }),
      {
        evaluateBehavior: async (behavior, context) => {
          const plan = await evaluateBehavior(behavior, context);
          evaluationStarted();
          await released;
          return plan;
        },
      }
    );
    const { sessionId } = await initialize(harness);
    const pending = rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 26,
        method: "tools/call",
        params: { name: "invalid_result", arguments: {} },
      },
      sessionId
    );
    await started;
    harness.repository.serverRevisions.set(
      harness.server.spec.slug,
      harness.server.revision + 1
    );
    releaseEvaluation();

    const response = await pending;
    expect(response.status).toBe(409);
    expect((await responseBody(response)).error).toEqual({
      code: -32_001,
      message: "The mock MCP server changed while the request was in progress.",
    });
    expect(harness.repository.commits).toBe(0);
  });

  it("emits bounded observations with recursively sensitive arguments redacted", async () => {
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "observe",
            behavior: {
              version: 1,
              type: "static",
              value: textToolResult("observed"),
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);
    await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "observe",
          arguments: {
            safe: "visible",
            apiKey: "key-secret",
            nested: { password: "pass-secret" },
          },
        },
      },
      sessionId
    );

    expect(harness.observations.at(-1)).toMatchObject({
      mcpArguments: {
        safe: "visible",
        apiKey: "[REDACTED]",
        nested: { password: "[REDACTED]" },
      },
      mcpMethod: "tools/call",
      mcpTool: "observe",
      sessionPresent: true,
    });
    expect(JSON.stringify(harness.observations)).not.toContain("key-secret");
    expect(JSON.stringify(harness.observations)).not.toContain(sessionId);
  });

  it("replaces request-log-incompatible argument keys with a schema-valid observation", async () => {
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "observe",
            behavior: {
              version: 1,
              type: "static",
              value: textToolResult("observed"),
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);
    const unsupportedKey = "x".repeat(REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH + 1);
    const incompatibleArguments = { [unsupportedKey]: "not logged" };
    expect(requestLogMcpArgumentsSchema.safeParse(incompatibleArguments).success).toBe(
      false
    );

    const response = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: {
          name: "observe",
          arguments: incompatibleArguments,
        },
      },
      sessionId
    );

    expect((await responseBody(response)).result).toEqual(textToolResult("observed"));
    const observedArguments = harness.observations.at(-1)?.mcpArguments;
    expect(observedArguments).toEqual({
      _mockos: "[REDACTED:UNSUPPORTED_KEY]",
    });
    expect(requestLogMcpArgumentsSchema.safeParse(observedArguments).success).toBe(
      true
    );
    expect(JSON.stringify(harness.observations)).not.toContain(unsupportedKey);
    expect(JSON.stringify(harness.observations)).not.toContain("not logged");
  });
});

describe("mock MCP JSON Schema assertions", () => {
  it("executes the accepted structural and composition subset", () => {
    const schema = mockMcpJsonSchemaSchema.parse({
      type: "object",
      properties: {
        kind: { enum: ["user", "group"] },
        count: { type: "integer", minimum: 1, maximum: 3 },
        tags: {
          type: "array",
          items: { type: "string", minLength: 2 },
          uniqueItems: true,
        },
      },
      required: ["kind", "count"],
      additionalProperties: false,
      allOf: [{ not: { properties: { kind: { const: "blocked" } } } }],
    });

    expect(
      validateMockMcpJsonSchema(schema, {
        kind: "user",
        count: 2,
        tags: ["aa", "bb"],
      })
    ).toEqual({ valid: true, issues: [] });
    expect(
      validateMockMcpJsonSchema(schema, {
        kind: "other",
        count: 4,
        tags: ["x", "x"],
        extra: true,
      })
    ).toMatchObject({ valid: false });
  });
});
