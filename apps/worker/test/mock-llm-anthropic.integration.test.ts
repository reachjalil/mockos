import { exports } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

const PLATFORM_KEY = "mockos-integration-test-key";
const ANTHROPIC_MOCK_CREDENTIAL = "synthetic-anthropic-provider-key";
const ROTATED_ANTHROPIC_MOCK_CREDENTIAL = "rotated-anthropic-provider-key";
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
    name: "mockos-anthropic-worker-integration",
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

const serverDefinition = (apiKey: string, text = "Hello from the Anthropic mock.") => ({
  version: 1,
  slug: "agent-tests",
  name: "Anthropic agent SDK tests",
  dialects: {
    openai: { enabled: false },
    anthropic: {
      enabled: true,
      authentication: { mode: "strict", apiKey },
    },
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

const anthropicBaseUrl = (environmentId: string) =>
  `${origin}/e/${environmentId}/llm-mock/agent-tests/anthropic`;

const anthropicClient = (environmentId: string, apiKey = ANTHROPIC_MOCK_CREDENTIAL) =>
  new Anthropic({
    apiKey,
    baseURL: anthropicBaseUrl(environmentId),
    maxRetries: 0,
    fetch: routedFetch,
  });

describe("public mock Anthropic Worker route", () => {
  it("configures through MCP and serves the bounded official-SDK provider slice", {
    timeout: 30_000,
  }, async () => {
    const management = await connectManagement();
    let environmentId: string | undefined;
    try {
      const environment = await callData<{ id: string }>(
        management,
        "create_environment",
        {
          name: "Mock Anthropic Worker integration",
          provider: "entra",
          seed: "mock-anthropic-worker",
        }
      );
      environmentId = environment.id;

      const created = await callData<{
        revision: number;
        spec: {
          dialects: {
            anthropic: {
              enabled: true;
              authentication: { mode: "strict"; configured: true };
            };
          };
        };
      }>(management, "put_mock_llm_server", {
        environmentId,
        expectedRevision: null,
        server: serverDefinition(ANTHROPIC_MOCK_CREDENTIAL),
      });
      expect(created).toMatchObject({
        spec: {
          dialects: {
            anthropic: {
              enabled: true,
              authentication: { mode: "strict", configured: true },
            },
          },
        },
      });
      expect(JSON.stringify(created)).not.toContain(ANTHROPIC_MOCK_CREDENTIAL);
      expect(JSON.stringify(created)).not.toContain("apiKeySha256");

      const client = anthropicClient(environmentId);
      const models = await client.models.list();
      expect(models.data.map((model) => model.id)).toEqual([
        "mock-text-1",
        "mock-sequence-1",
        "mock-tool-1",
        "mock-rate-limit-1",
      ]);
      const retrieved = await client.models.retrieve("mock-text-1");
      expect(retrieved).toMatchObject({
        id: "mock-text-1",
        type: "model",
        display_name: "Mock text",
        created_at: new Date(1_785_000_000_000).toISOString(),
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      });

      const [firstMessage, repeatedMessage] = await Promise.all([
        client.messages.create({
          model: "mock-text-1",
          max_tokens: 64,
          messages: [{ role: "user", content: "Hello" }],
        }),
        client.messages.create({
          model: "mock-text-1",
          max_tokens: 64,
          messages: [{ role: "user", content: "Hello" }],
        }),
      ]);
      expect(firstMessage.content).toEqual([
        {
          type: "text",
          text: "Hello from the Anthropic mock.",
          citations: null,
        },
      ]);
      expect(firstMessage.id).toMatch(/^msg_[a-f0-9]{32}$/);
      expect(repeatedMessage.id).toMatch(/^msg_[a-f0-9]{32}$/);
      expect(repeatedMessage.id).not.toBe(firstMessage.id);
      expect(firstMessage._request_id).toMatch(/^req_[a-f0-9]{32}$/);
      expect(repeatedMessage._request_id).not.toBe(firstMessage._request_id);
      expect(firstMessage.usage).toMatchObject({
        input_tokens: 11,
        output_tokens: 5,
        service_tier: "standard",
      });

      const turnZero = await client.messages.create({
        model: "mock-sequence-1",
        max_tokens: 64,
        messages: [{ role: "user", content: "First" }],
      });
      const turnOne = await client.messages.create({
        model: "mock-sequence-1",
        max_tokens: 64,
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "turn zero" },
          { role: "user", content: "Second" },
        ],
      });
      expect(turnZero.content[0]).toMatchObject({
        type: "text",
        text: "turn zero",
      });
      expect(turnOne.content[0]).toMatchObject({
        type: "text",
        text: "turn one",
      });

      const toolMessage = await client.messages.create({
        model: "mock-tool-1",
        max_tokens: 64,
        messages: [{ role: "user", content: "Check Berlin" }],
        tools: [
          {
            name: "get_weather",
            description: "Return synthetic weather.",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      });
      expect(toolMessage.stop_reason).toBe("tool_use");
      expect(toolMessage.content).toContainEqual(
        expect.objectContaining({
          type: "tool_use",
          id: "call_weather_1",
          name: "get_weather",
          input: { location: "Berlin", units: "celsius" },
        })
      );

      const streamedTool = client.messages.stream({
        model: "mock-tool-1",
        max_tokens: 64,
        messages: [{ role: "user", content: "Stream the Berlin lookup" }],
        tools: [
          {
            name: "get_weather",
            description: "Return synthetic weather.",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      });
      const streamedToolConnection = await streamedTool.withResponse();
      const streamedToolMessage = await streamedTool.finalMessage();
      expect(streamedToolMessage).toMatchObject({
        id: expect.stringMatching(/^msg_[a-f0-9]{32}$/),
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: {
          input_tokens: 11,
          output_tokens: 5,
        },
      });
      expect(streamedToolMessage.content).toContainEqual(
        expect.objectContaining({
          type: "tool_use",
          id: "call_weather_1",
          name: "get_weather",
          input: { location: "Berlin", units: "celsius" },
        })
      );
      expect(streamedToolConnection.request_id).toMatch(/^req_[a-f0-9]{32}$/);
      expect(streamedToolConnection.request_id).not.toBe(firstMessage._request_id);
      expect(streamedToolMessage.id).not.toBe(firstMessage.id);

      const toolHistory = await client.messages.create({
        model: "mock-text-1",
        max_tokens: 64,
        messages: [
          { role: "user", content: "Check Berlin" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call_weather_1",
                name: "get_weather",
                input: { location: "Berlin" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_weather_1",
                content: "18 degrees",
              },
            ],
          },
        ],
        tools: [
          {
            name: "get_weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
            },
          },
        ],
      });
      expect(toolHistory.content[0]).toMatchObject({
        type: "text",
        text: "Hello from the Anthropic mock.",
      });

      const rawText = await client.messages
        .create({
          model: "mock-text-1",
          max_tokens: 64,
          messages: [{ role: "user", content: "Stream named text events" }],
          stream: true,
        })
        .withResponse();
      const textEvents = [];
      for await (const event of rawText.data) textEvents.push(event);
      expect(textEvents.map((event) => event.type)).toEqual([
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ]);
      expect(
        textEvents
          .filter((event) => event.type === "content_block_delta")
          .map((event) => (event.delta.type === "text_delta" ? event.delta.text : ""))
          .join("")
      ).toBe("Hello from the Anthropic mock.");
      const textStart = textEvents.find((event) => event.type === "message_start");
      if (textStart?.type !== "message_start") {
        throw new Error("Expected an Anthropic message_start event.");
      }
      expect(textStart.message).toMatchObject({
        id: expect.stringMatching(/^msg_[a-f0-9]{32}$/),
        stop_reason: null,
        usage: {
          input_tokens: 11,
          output_tokens: 0,
        },
      });
      const textDelta = textEvents.find((event) => event.type === "message_delta");
      if (textDelta?.type !== "message_delta") {
        throw new Error("Expected an Anthropic message_delta event.");
      }
      expect(textDelta).toMatchObject({
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: {
          input_tokens: 11,
          output_tokens: 5,
        },
      });
      expect(rawText.request_id).toMatch(/^req_[a-f0-9]{32}$/);
      expect(rawText.request_id).not.toBe(streamedToolConnection.request_id);
      expect(textStart.message.id).not.toBe(streamedToolMessage.id);

      const cancellable = await client.messages.create({
        model: "mock-text-1",
        max_tokens: 64,
        messages: [{ role: "user", content: "Cancel before terminal success" }],
        stream: true,
      });
      const cancellableIterator = cancellable[Symbol.asyncIterator]();
      const firstCancellableEvent = await cancellableIterator.next();
      expect(firstCancellableEvent).toMatchObject({
        done: false,
        value: { type: "message_start" },
      });
      const observedCancellableTypes = [firstCancellableEvent.value?.type];
      cancellable.controller.abort();
      await expect(cancellableIterator.next()).resolves.toMatchObject({
        done: true,
      });
      expect(observedCancellableTypes).not.toContain("message_stop");

      await expect(
        client.messages.create({
          model: "mock-rate-limit-1",
          max_tokens: 64,
          messages: [{ role: "user", content: "Rate limit" }],
        })
      ).rejects.toMatchObject({
        status: 429,
        error: {
          type: "error",
          error: { type: "rate_limit_error" },
        },
      });
      await expect(
        client.messages.create({
          model: "missing-model",
          max_tokens: 64,
          messages: [{ role: "user", content: "Missing" }],
        })
      ).rejects.toMatchObject({
        status: 404,
        error: {
          type: "error",
          error: { type: "not_found_error" },
        },
      });

      let streamingError: unknown;
      try {
        await client.messages.create({
          model: "mock-rate-limit-1",
          max_tokens: 64,
          messages: [{ role: "user", content: "Rate limit while streaming" }],
          stream: true,
        });
      } catch (error) {
        streamingError = error;
      }
      expect(streamingError).toBeInstanceOf(Anthropic.APIError);
      expect(streamingError).toMatchObject({
        status: 429,
        requestID: expect.stringMatching(/^req_[a-f0-9]{32}$/),
        error: {
          type: "error",
          error: { type: "rate_limit_error" },
        },
      });
      if (!(streamingError instanceof Anthropic.APIError)) {
        throw new Error("Expected an Anthropic APIError.");
      }
      expect(streamingError.headers?.get("content-type")).toContain("application/json");

      await expect(
        anthropicClient(environmentId, PLATFORM_KEY).models.list()
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        anthropicClient(environmentId, "wrong-anthropic-provider-key").models.list()
      ).rejects.toMatchObject({ status: 401 });

      const versionless = await routedFetch(
        `${anthropicBaseUrl(environmentId)}/v1/models`,
        {
          headers: { "x-api-key": ANTHROPIC_MOCK_CREDENTIAL },
        }
      );
      expect(versionless.status).toBe(400);
      const wrongVersion = await routedFetch(
        `${anthropicBaseUrl(environmentId)}/v1/models`,
        {
          headers: {
            "anthropic-version": "2023-01-01",
            "x-api-key": ANTHROPIC_MOCK_CREDENTIAL,
          },
        }
      );
      expect(wrongVersion.status).toBe(400);
      const betaHeader = await routedFetch(
        `${anthropicBaseUrl(environmentId)}/v1/models`,
        {
          headers: {
            "anthropic-beta": "tools-2024-04-04",
            "anthropic-version": "2023-06-01",
            "x-api-key": ANTHROPIC_MOCK_CREDENTIAL,
          },
        }
      );
      expect(betaHeader.status).toBe(400);
      const authorizationOnly = await routedFetch(
        `${anthropicBaseUrl(environmentId)}/v1/models`,
        {
          headers: {
            authorization: `Bearer ${ANTHROPIC_MOCK_CREDENTIAL}`,
            "anthropic-version": "2023-06-01",
          },
        }
      );
      expect(authorizationOnly.status).toBe(401);

      const current = await callData<{ revision: number }>(
        management,
        "get_mock_llm_server",
        {
          environmentId,
          slug: "agent-tests",
        }
      );
      await callData(management, "put_mock_llm_server", {
        environmentId,
        expectedRevision: current.revision,
        server: serverDefinition(ROTATED_ANTHROPIC_MOCK_CREDENTIAL),
      });
      await expect(client.models.list()).rejects.toMatchObject({
        status: 401,
      });
      expect(
        (
          await anthropicClient(
            environmentId,
            ROTATED_ANTHROPIC_MOCK_CREDENTIAL
          ).models.list()
        ).data
      ).toHaveLength(4);

      const requestLog = await callData<{ entries: unknown[] }>(
        management,
        "get_request_log",
        {
          environmentId,
          limit: 100,
        }
      );
      const serializedLog = JSON.stringify(requestLog);
      expect(requestLog.entries).toEqual([]);
      expect(serializedLog).not.toContain(ANTHROPIC_MOCK_CREDENTIAL);
      expect(serializedLog).not.toContain(ROTATED_ANTHROPIC_MOCK_CREDENTIAL);
      expect(serializedLog).not.toContain("apiKeySha256");

      const beforeDelete = await callData<{ revision: number }>(
        management,
        "get_mock_llm_server",
        {
          environmentId,
          slug: "agent-tests",
        }
      );
      await callData(management, "delete_mock_llm_server", {
        environmentId,
        slug: "agent-tests",
        expectedRevision: beforeDelete.revision,
      });
      await expect(
        anthropicClient(environmentId, ROTATED_ANTHROPIC_MOCK_CREDENTIAL).models.list()
      ).rejects.toMatchObject({
        status: 404,
        error: {
          type: "error",
          error: { type: "not_found_error" },
        },
      });
    } finally {
      if (environmentId) {
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
