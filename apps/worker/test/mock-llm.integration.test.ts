import { exports } from "cloudflare:workers";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";

const PLATFORM_KEY = "mockos-integration-test-key";
const OPENAI_MOCK_CREDENTIAL = "synthetic-openai-provider-key";
const ROTATED_OPENAI_MOCK_CREDENTIAL = "rotated-openai-provider-key";
const origin = "https://mockos.test";
const worker = (exports as unknown as { default: Fetcher }).default;

const routedFetch: typeof globalThis.fetch = async (input, init) =>
  worker.fetch(new Request(input, init));

const connectManagement = async (): Promise<Client> => {
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${PLATFORM_KEY}`,
      },
    },
    fetch: routedFetch,
  });
  const client = new Client({
    name: "mockos-llm-worker-integration",
    version: "1.0.0",
  });
  await client.connect(transport);
  return client;
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

type LlmRequestLogEntry = {
  readonly id: string;
  readonly provider: string;
  readonly protocol: string;
  readonly method: string;
  readonly path: string;
  readonly requestHeaders: Record<string, string>;
  readonly requestBody: string | null;
  readonly responseStatus: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: string | null;
  readonly durationMs: number;
  readonly llmDialect: string;
  readonly llmOperation: string;
  readonly llmServerSlug: string;
  readonly llmServerRevision: number;
  readonly llmModel: string;
  readonly llmStream: boolean;
  readonly llmTurnIndex: number;
  readonly llmOutcome: string;
  readonly llmResponseId?: string;
  readonly llmInputTokens?: number;
  readonly llmOutputTokens?: number;
  readonly llmStopReason?: string;
  readonly llmToolNames?: string[];
  readonly llmErrorKind?: string;
};

const eventuallyRequestLog = async (
  client: Client,
  query: Record<string, unknown>,
  accepted: (entries: readonly LlmRequestLogEntry[]) => boolean
): Promise<{ entries: LlmRequestLogEntry[] }> => {
  let latest: { entries: LlmRequestLogEntry[] } = { entries: [] };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    latest = await callData(client, "get_request_log", query);
    if (accepted(latest.entries)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for LLM observations: ${JSON.stringify(latest)}`);
};

const serverDefinition = (
  authentication:
    | { readonly mode: "accept_any" }
    | { readonly mode: "strict"; readonly apiKey: string },
  text = "Hello from environment one."
) => ({
  version: 1,
  slug: "agent-tests",
  name: "Agent SDK tests",
  dialects: {
    openai: { enabled: true, authentication },
    anthropic: { enabled: false },
  },
  models: [
    {
      id: "mock-text-1",
      displayName: "Mock text",
      createdAtEpochSeconds: 1_785_000_000,
      behavior: { version: 1, type: "static", value: text },
    },
    {
      id: "mock-sequence-1",
      displayName: "Mock sequence",
      createdAtEpochSeconds: 1_785_000_001,
      behavior: {
        version: 1,
        type: "sequence",
        mode: "hold_last",
        steps: [
          { version: 1, type: "static", value: "turn zero" },
          { version: 1, type: "static", value: "turn one" },
        ],
      },
    },
    {
      id: "mock-tool-1",
      displayName: "Mock tool",
      createdAtEpochSeconds: 1_785_000_002,
      behavior: {
        version: 1,
        type: "static",
        value: {
          segments: [
            {
              type: "tool_call",
              id: "call_weather_1",
              name: "get_weather",
              input: { location: "Berlin", units: "celsius" },
            },
          ],
          stopReason: "tool_use",
        },
      },
    },
    {
      id: "mock-rate-limit-1",
      displayName: "Mock rate limit",
      createdAtEpochSeconds: 1_785_000_003,
      behavior: {
        version: 1,
        type: "error",
        code: "rate_limit",
        message: "Synthetic rate limit.",
      },
    },
  ],
  defaultUsage: { inputTokens: 11, outputTokens: 5 },
  defaultCadence: {
    chunkDelayMilliseconds: 0,
    chunkSize: 256,
    maximumDurationMilliseconds: 60_000,
  },
});

const openAiClient = (environmentId: string, apiKey = OPENAI_MOCK_CREDENTIAL) =>
  new OpenAI({
    apiKey,
    baseURL: `${origin}/e/${environmentId}/llm-mock/agent-tests/openai/v1`,
    maxRetries: 0,
    fetch: routedFetch,
  });

describe("public mock OpenAI Worker route", () => {
  it("configures through MCP and serves the bounded official-SDK provider slice", {
    timeout: 30_000,
  }, async () => {
    const management = await connectManagement();
    const environmentIds: string[] = [];
    try {
      const firstEnvironment = await callData<{ id: string }>(
        management,
        "create_environment",
        {
          name: "Mock OpenAI Worker integration one",
          provider: "entra",
          seed: "mock-openai-worker-one",
        }
      );
      const secondEnvironment = await callData<{ id: string }>(
        management,
        "create_environment",
        {
          name: "Mock OpenAI Worker integration two",
          provider: "entra",
          seed: "mock-openai-worker-two",
        }
      );
      const strictCollisionEnvironment = await callData<{ id: string }>(
        management,
        "create_environment",
        {
          name: "Mock OpenAI observation collision",
          provider: "entra",
          seed: "mock-openai-observation-collision",
        }
      );
      environmentIds.push(
        firstEnvironment.id,
        secondEnvironment.id,
        strictCollisionEnvironment.id
      );

      const firstPut = await callData<{
        revision: number;
        spec: {
          dialects: {
            openai: {
              enabled: true;
              authentication: { mode: "strict"; configured: true };
            };
          };
        };
      }>(management, "put_mock_llm_server", {
        environmentId: firstEnvironment.id,
        expectedRevision: null,
        server: serverDefinition({
          mode: "strict",
          apiKey: OPENAI_MOCK_CREDENTIAL,
        }),
      });
      expect(firstPut).toMatchObject({
        spec: {
          dialects: {
            openai: {
              enabled: true,
              authentication: { mode: "strict", configured: true },
            },
          },
        },
      });
      expect(JSON.stringify(firstPut)).not.toContain(OPENAI_MOCK_CREDENTIAL);
      expect(JSON.stringify(firstPut)).not.toContain("apiKeySha256");

      await callData(management, "put_mock_llm_server", {
        environmentId: secondEnvironment.id,
        expectedRevision: null,
        server: serverDefinition({ mode: "accept_any" }, "Hello from environment two."),
      });
      const strictOperationCredential = "chat.completions.create";
      await callData(management, "put_mock_llm_server", {
        environmentId: strictCollisionEnvironment.id,
        expectedRevision: null,
        server: serverDefinition({
          mode: "strict",
          apiKey: strictOperationCredential,
        }),
      });

      const first = openAiClient(firstEnvironment.id);
      const second = openAiClient(secondEnvironment.id, "any-synthetic-provider-key");
      const models = await first.models.list();
      expect(models.data.map((model) => model.id)).toEqual([
        "mock-text-1",
        "mock-sequence-1",
        "mock-tool-1",
        "mock-rate-limit-1",
      ]);
      const retrieved = await first.models.retrieve("mock-text-1");
      expect(retrieved).toMatchObject({
        id: "mock-text-1",
        object: "model",
        created: 1_785_000_000,
        owned_by: "mockos",
      });

      const [firstCompletion, repeatedCompletion, isolatedCompletion] =
        await Promise.all([
          first.chat.completions.create({
            model: "mock-text-1",
            messages: [{ role: "user", content: "Hello" }],
          }),
          first.chat.completions.create({
            model: "mock-text-1",
            messages: [{ role: "user", content: "Hello" }],
          }),
          second.chat.completions.create({
            model: "mock-text-1",
            messages: [{ role: "user", content: "Hello" }],
          }),
        ]);
      expect(firstCompletion.choices[0]?.message.content).toBe(
        "Hello from environment one."
      );
      expect(isolatedCompletion.choices[0]?.message.content).toBe(
        "Hello from environment two."
      );
      const strictCollisionCompletion = await openAiClient(
        strictCollisionEnvironment.id,
        strictOperationCredential
      ).chat.completions.create({
        model: "mock-text-1",
        messages: [{ role: "user", content: "Observe without disclosing the key" }],
      });
      expect(strictCollisionCompletion.choices[0]?.message.content).toBe(
        "Hello from environment one."
      );
      const acceptAnyPathCollisionCompletion = await openAiClient(
        secondEnvironment.id,
        secondEnvironment.id
      ).chat.completions.create({
        model: "mock-text-1",
        messages: [{ role: "user", content: "Path collision" }],
      });
      expect(acceptAnyPathCollisionCompletion.choices[0]?.message.content).toBe(
        "Hello from environment two."
      );
      const strictCollisionLog = await callData<{
        entries: LlmRequestLogEntry[];
      }>(management, "get_request_log", {
        environmentId: strictCollisionEnvironment.id,
        llmDialect: "openai",
        limit: 100,
      });
      expect(strictCollisionLog.entries).toEqual([]);
      const acceptAnyCollisionLog = await callData<{
        entries: LlmRequestLogEntry[];
      }>(management, "get_request_log", {
        environmentId: secondEnvironment.id,
        llmResponseId: acceptAnyPathCollisionCompletion.id,
        limit: 100,
      });
      expect(acceptAnyCollisionLog.entries).toEqual([]);
      expect(firstCompletion.id).toMatch(/^chatcmpl-[a-f0-9]{32}$/);
      expect(repeatedCompletion.id).toMatch(/^chatcmpl-[a-f0-9]{32}$/);
      expect(repeatedCompletion.id).not.toBe(firstCompletion.id);
      expect(firstCompletion._request_id).toMatch(/^req_[a-f0-9]{32}$/);
      expect(repeatedCompletion._request_id).not.toBe(firstCompletion._request_id);
      expect(firstCompletion.usage).toMatchObject({
        prompt_tokens: 11,
        completion_tokens: 5,
        total_tokens: 16,
      });

      const turnZero = await first.chat.completions.create({
        model: "mock-sequence-1",
        messages: [{ role: "user", content: "First" }],
      });
      const turnOne = await first.chat.completions.create({
        model: "mock-sequence-1",
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "turn zero" },
          { role: "user", content: "Second" },
        ],
      });
      expect(turnZero.choices[0]?.message.content).toBe("turn zero");
      expect(turnOne.choices[0]?.message.content).toBe("turn one");

      const toolCompletion = await first.chat.completions.create({
        model: "mock-tool-1",
        messages: [{ role: "user", content: "Check Berlin" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: {
                type: "object",
                properties: { location: { type: "string" } },
              },
            },
          },
        ],
      });
      expect(toolCompletion.choices[0]?.finish_reason).toBe("tool_calls");
      const toolCall = toolCompletion.choices[0]?.message.tool_calls?.[0];
      expect(toolCall).toMatchObject({
        id: "call_weather_1",
        type: "function",
        function: {
          name: "get_weather",
          arguments: '{"location":"Berlin","units":"celsius"}',
        },
      });
      const toolStream = await first.chat.completions.create({
        model: "mock-tool-1",
        messages: [{ role: "user", content: "Stream the Berlin lookup" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: {
                type: "object",
                properties: { location: { type: "string" } },
              },
            },
          },
        ],
        stream: true,
        stream_options: { include_obfuscation: false },
      });
      const toolChunks = [];
      for await (const chunk of toolStream) toolChunks.push(chunk);
      const toolDeltas = toolChunks
        .flatMap((chunk) => chunk.choices)
        .flatMap(
          (choice) =>
            (
              choice.delta as unknown as {
                tool_calls?: readonly {
                  index: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              }
            ).tool_calls ?? []
        );
      expect(toolDeltas.at(0)).toMatchObject({
        index: 0,
        id: "call_weather_1",
        type: "function",
        function: { name: "get_weather" },
      });
      expect(toolDeltas.map((delta) => delta.function?.arguments ?? "").join("")).toBe(
        '{"location":"Berlin","units":"celsius"}'
      );
      expect(
        toolChunks
          .flatMap((chunk) => chunk.choices)
          .find((choice) => choice.finish_reason !== null)?.finish_reason
      ).toBe("tool_calls");

      await expect(
        first.chat.completions.create({
          model: "mock-rate-limit-1",
          messages: [{ role: "user", content: "Rate limit" }],
        })
      ).rejects.toMatchObject({
        status: 429,
        error: {
          type: "rate_limit_error",
          code: "rate_limit",
        },
      });
      await expect(
        first.chat.completions.create({
          model: "missing-model",
          messages: [{ role: "user", content: "Missing" }],
        })
      ).rejects.toMatchObject({
        status: 404,
        error: { code: "model_not_found" },
      });
      const stream = await first.chat.completions.create({
        model: "mock-text-1",
        messages: [{ role: "user", content: "Stream this" }],
        stream: true,
        stream_options: { include_usage: true },
      });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(
        chunks
          .flatMap((chunk) => chunk.choices)
          .map((choice) => choice.delta.content ?? "")
          .join("")
      ).toBe("Hello from environment one.");
      expect(chunks.at(-1)).toMatchObject({
        choices: [],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 5,
          total_tokens: 16,
        },
      });
      expect(
        chunks
          .filter((chunk) => chunk.choices.length > 0)
          .every(
            (chunk) =>
              typeof (chunk as unknown as { obfuscation?: unknown }).obfuscation ===
              "string"
          )
      ).toBe(true);
      const streamedResponseId = chunks.at(0)?.id;
      expect(streamedResponseId).toMatch(/^chatcmpl-[a-f0-9]{32}$/);

      const cancellable = await first.chat.completions.create({
        model: "mock-text-1",
        messages: [{ role: "user", content: "Cancel after one frame" }],
        stream: true,
      });
      const iterator = cancellable[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
      cancellable.controller.abort();
      await expect(iterator.next()).resolves.toMatchObject({ done: true });

      await expect(
        openAiClient(firstEnvironment.id, PLATFORM_KEY).models.list()
      ).rejects.toMatchObject({ status: 401 });

      const current = await callData<{ revision: number }>(
        management,
        "get_mock_llm_server",
        {
          environmentId: firstEnvironment.id,
          slug: "agent-tests",
        }
      );
      await callData(management, "put_mock_llm_server", {
        environmentId: firstEnvironment.id,
        expectedRevision: current.revision,
        server: serverDefinition({
          mode: "strict",
          apiKey: ROTATED_OPENAI_MOCK_CREDENTIAL,
        }),
      });
      await expect(
        openAiClient(firstEnvironment.id).models.list()
      ).rejects.toMatchObject({ status: 401 });
      expect(
        (
          await openAiClient(
            firstEnvironment.id,
            ROTATED_OPENAI_MOCK_CREDENTIAL
          ).models.list()
        ).data
      ).toHaveLength(4);

      const requestLog = await eventuallyRequestLog(
        management,
        {
          environmentId: firstEnvironment.id,
          llmDialect: "openai",
          llmOperation: "chat.completions.create",
          limit: 100,
        },
        (entries) =>
          entries.some(
            (entry) =>
              entry.llmResponseId === firstCompletion.id &&
              entry.llmOutcome === "completed"
          ) &&
          entries.some(
            (entry) =>
              entry.llmResponseId === streamedResponseId &&
              entry.llmOutcome === "completed"
          )
      );
      const serializedLog = JSON.stringify(requestLog);
      expect(
        requestLog.entries.filter((entry) => entry.llmResponseId === firstCompletion.id)
      ).toEqual([
        expect.objectContaining({
          id: firstCompletion._request_id,
          provider: "openai",
          protocol: "http",
          method: "POST",
          path: `/e/${firstEnvironment.id}/llm-mock/agent-tests/openai/v1/chat/completions`,
          requestHeaders: {},
          requestBody: null,
          responseStatus: 200,
          responseHeaders: {},
          responseBody: null,
          durationMs: expect.any(Number),
          llmDialect: "openai",
          llmOperation: "chat.completions.create",
          llmServerSlug: "agent-tests",
          llmServerRevision: firstPut.revision,
          llmModel: "mock-text-1",
          llmStream: false,
          llmTurnIndex: 0,
          llmOutcome: "completed",
          llmResponseId: firstCompletion.id,
          llmInputTokens: 11,
          llmOutputTokens: 5,
          llmStopReason: "end_turn",
          llmToolNames: [],
        }),
      ]);
      expect(requestLog.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            llmErrorKind: "rate_limit",
            llmModel: "mock-rate-limit-1",
            llmOutcome: "completed",
            llmStream: false,
            responseStatus: 429,
          }),
          expect.objectContaining({
            llmModel: "mock-tool-1",
            llmStopReason: "tool_use",
            llmToolNames: ["get_weather"],
          }),
          expect.objectContaining({
            llmModel: "mock-text-1",
            llmOutcome: "completed",
            llmResponseId: streamedResponseId,
            llmStream: true,
            responseStatus: 200,
          }),
        ])
      );
      expect(
        requestLog.entries.find(
          (entry) =>
            entry.llmErrorKind === "rate_limit" &&
            entry.llmModel === "mock-rate-limit-1"
        )
      ).not.toHaveProperty("llmResponseId");
      expect(
        requestLog.entries.every(
          (entry) =>
            Object.keys(entry.requestHeaders).length === 0 &&
            entry.requestBody === null &&
            Object.keys(entry.responseHeaders).length === 0 &&
            entry.responseBody === null &&
            entry.llmServerRevision === firstPut.revision
        )
      ).toBe(true);
      const exactObservation = await callData<{
        matched: number;
        pass: boolean;
      }>(management, "assert_requests", {
        environmentId: firstEnvironment.id,
        llmDialect: "openai",
        llmOperation: "chat.completions.create",
        llmResponseId: firstCompletion.id,
        llmOutcome: "completed",
        status: 200,
        count: { exactly: 1 },
      });
      expect(exactObservation).toMatchObject({ matched: 1, pass: true });
      const configuredErrorObservation = await callData<{
        matched: number;
        pass: boolean;
      }>(management, "assert_requests", {
        environmentId: firstEnvironment.id,
        llmDialect: "openai",
        llmErrorKind: "rate_limit",
        llmStream: false,
        llmOutcome: "completed",
        status: 429,
        count: { exactly: 1 },
      });
      expect(configuredErrorObservation).toMatchObject({
        matched: 1,
        pass: true,
      });
      expect(serializedLog).not.toContain(OPENAI_MOCK_CREDENTIAL);
      expect(serializedLog).not.toContain(ROTATED_OPENAI_MOCK_CREDENTIAL);
      expect(serializedLog).not.toContain("apiKeySha256");
      expect(serializedLog).not.toContain("Hello from environment one.");
      expect(serializedLog).not.toContain("Berlin");

      await callData(management, "delete_environment", {
        environmentId: secondEnvironment.id,
      });
      await expect(second.models.list()).rejects.toMatchObject({
        status: 404,
        error: { code: "mock_llm_server_not_found" },
      });
    } finally {
      for (const environmentId of environmentIds) {
        await management
          .callTool({
            name: "delete_environment",
            arguments: { environmentId },
          })
          .catch(() => undefined);
      }
      await management.close().catch(() => undefined);
    }
  });
});
