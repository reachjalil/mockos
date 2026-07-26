import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { createMockLlmAnthropicFetchHandler } from "./anthropic-http";
import { renderOpenAiPlan } from "./openai";
import { createMockLlmOpenAiFetchHandler } from "./openai-http";
import {
  errorPlan,
  requestFromFetchInput,
  TEST_CREATED_EPOCH_SECONDS,
  TEST_MODEL,
  textPlan,
  toolPlan,
  wireToResponse,
} from "./test-support";

const OPENAI_BASE_URL = "https://mockos.test/e/env_fixture/llm-mock/demo/openai/v1";
const ANTHROPIC_BASE_URL = "https://mockos.test/e/env_fixture/llm-mock/demo/anthropic";

const openAiModel = {
  id: TEST_MODEL,
  object: "model",
  created: TEST_CREATED_EPOCH_SECONDS,
  owned_by: "mockos",
} as const;

const anthropicModel = {
  id: TEST_MODEL,
  type: "model",
  display_name: "mockOS Text 1",
  created_at: new Date(TEST_CREATED_EPOCH_SECONDS * 1_000).toISOString(),
  capabilities: null,
  max_input_tokens: null,
  max_tokens: null,
} as const;

const createAnthropicSdkFixture = () => {
  const paths: string[] = [];
  const streamingContentTypes: (string | null)[] = [];
  let identitySequence = 0;
  let messageCalls = 0;
  const immediatePlan = (plan: ReturnType<typeof textPlan>) =>
    plan.kind === "response"
      ? {
          ...plan,
          cadence: {
            ...plan.cadence,
            initialDelayMilliseconds: 0,
            chunkDelayMilliseconds: 0,
          },
        }
      : plan;
  const providerFetch = createMockLlmAnthropicFetchHandler({
    runtime: {
      getCatalog: async () => ({
        ok: true as const,
        value: {
          models: [
            {
              id: TEST_MODEL,
              displayName: "mockOS Text 1",
              createdAtEpochSeconds: TEST_CREATED_EPOCH_SECONDS,
            },
          ],
        },
      }),
      planMessage: async ({ request }) => {
        messageCalls += 1;
        const serialized = JSON.stringify(request);
        const hasTools =
          request !== null &&
          typeof request === "object" &&
          !Array.isArray(request) &&
          Array.isArray(request.tools);
        return {
          ok: true as const,
          value: immediatePlan(
            serialized.includes("Rate limit")
              ? errorPlan("rate_limit")
              : hasTools
                ? toolPlan()
                : textPlan()
          ),
        };
      },
    },
    createIdentity: () => {
      identitySequence += 1;
      const suffix = identitySequence.toString(16).padStart(32, "0");
      return {
        requestId: `req_${suffix}`,
        responseId: `msg_${suffix}`,
      };
    },
  });
  const providerBasePath = new URL(ANTHROPIC_BASE_URL).pathname;
  const fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const request = requestFromFetchInput(input, init);
    const url = new URL(request.url);
    paths.push(url.pathname);
    expect(request.headers.get("x-api-key")).toBe("mock-anthropic-credential");
    expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
    const body =
      request.method === "POST" && url.pathname.endsWith("/v1/messages")
        ? ((await request.clone().json()) as Readonly<Record<string, unknown>>)
        : undefined;
    const response = await providerFetch(request, {
      slug: "demo",
      providerPath: url.pathname.slice(providerBasePath.length),
    });
    if (body?.stream === true) {
      streamingContentTypes.push(response.headers.get("content-type"));
    }
    return response;
  };
  const client = new Anthropic({
    apiKey: "mock-anthropic-credential",
    baseURL: ANTHROPIC_BASE_URL,
    maxRetries: 0,
    fetch,
  });
  return {
    client,
    messageCalls: () => messageCalls,
    paths,
    streamingContentTypes,
  };
};

describe("official OpenAI SDK source conformance", () => {
  it("deserializes models, text, tools, usage, request IDs, and edge-owned SSE", async () => {
    const paths: string[] = [];
    const immediatePlan = (plan: ReturnType<typeof textPlan>) =>
      plan.kind === "response"
        ? {
            ...plan,
            cadence: {
              ...plan.cadence,
              initialDelayMilliseconds: 0,
              chunkDelayMilliseconds: 0,
            },
          }
        : plan;
    const providerFetch = createMockLlmOpenAiFetchHandler({
      runtime: {
        getCatalog: async () => ({
          ok: true as const,
          value: {
            models: [
              {
                id: TEST_MODEL,
                createdAtEpochSeconds: TEST_CREATED_EPOCH_SECONDS,
              },
            ],
          },
        }),
        planChatCompletion: async ({ request }) => ({
          ok: true as const,
          value: immediatePlan(
            typeof request === "object" &&
              request !== null &&
              !Array.isArray(request) &&
              Array.isArray(request.tools)
              ? toolPlan()
              : textPlan()
          ),
        }),
      },
      createIdentity: () => ({
        requestId: "req_sdk_conformance",
        responseId: "chatcmpl-sdk-conformance",
      }),
    });
    const providerBasePath = new URL(OPENAI_BASE_URL).pathname;
    const fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const request = requestFromFetchInput(input, init);
      const url = new URL(request.url);
      paths.push(url.pathname);
      expect(request.headers.get("authorization")).toBe(
        "Bearer mock-openai-credential"
      );
      return providerFetch(request, {
        slug: "demo",
        providerPath: url.pathname.slice(providerBasePath.length),
      });
    };
    const client = new OpenAI({
      apiKey: "mock-openai-credential",
      baseURL: OPENAI_BASE_URL,
      maxRetries: 0,
      fetch,
    });

    const models = await client.models.list();
    expect(models.data).toEqual([openAiModel]);
    const model = await client.models.retrieve(TEST_MODEL);
    expect(model).toEqual(expect.objectContaining(openAiModel));
    expect(model._request_id).toBe("req_sdk_conformance");

    const completion = await client.chat.completions.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(completion.choices[0]?.message.content).toBe("Hello from mockOS.");
    expect(completion.usage).toMatchObject({
      prompt_tokens: 11,
      completion_tokens: 5,
      total_tokens: 16,
    });
    expect(completion._request_id).toBe("req_sdk_conformance");

    const toolCompletion = await client.chat.completions.create({
      model: TEST_MODEL,
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
    const openAiToolCall = toolCompletion.choices[0]?.message.tool_calls?.[0];
    expect(openAiToolCall?.type).toBe("function");
    if (openAiToolCall?.type !== "function") {
      throw new Error("Expected an OpenAI function tool call.");
    }
    expect(openAiToolCall.function).toEqual({
      name: "get_weather",
      arguments: '{"location":"Berlin","units":"celsius"}',
    });

    const stream = await client.chat.completions.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Stream" }],
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
    ).toBe("Hello from mockOS.");
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

    const unpaddedStream = await client.chat.completions.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Stream without padding" }],
      stream: true,
      stream_options: { include_obfuscation: false },
    });
    const unpaddedChunks = [];
    for await (const chunk of unpaddedStream) unpaddedChunks.push(chunk);
    expect(
      unpaddedChunks.every(
        (chunk) =>
          !Object.hasOwn(
            chunk as unknown as Readonly<Record<string, unknown>>,
            "obfuscation"
          )
      )
    ).toBe(true);

    const accumulated = await client.chat.completions
      .stream({
        model: TEST_MODEL,
        messages: [{ role: "user", content: "Accumulate the stream" }],
      })
      .finalChatCompletion();
    expect(accumulated.choices[0]?.message).toMatchObject({
      role: "assistant",
      content: "Hello from mockOS.",
    });
    expect(accumulated.choices[0]?.finish_reason).toBe("stop");
    expect(paths).toContain("/e/env_fixture/llm-mock/demo/openai/v1/chat/completions");
    expect(paths).toEqual(
      expect.arrayContaining([
        "/e/env_fixture/llm-mock/demo/openai/v1/models",
        `/e/env_fixture/llm-mock/demo/openai/v1/models/${TEST_MODEL}`,
      ])
    );
  });

  it("preserves provider errors and disables implicit retries", async () => {
    let calls = 0;
    const client = new OpenAI({
      apiKey: "mock-openai-credential",
      baseURL: OPENAI_BASE_URL,
      maxRetries: 0,
      fetch: async () => {
        calls += 1;
        return wireToResponse(
          renderOpenAiPlan(errorPlan("rate_limit"), { stream: false })
        );
      },
    });

    let caught: unknown;
    try {
      await client.chat.completions.create({
        model: TEST_MODEL,
        messages: [{ role: "user", content: "Rate limit" }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OpenAI.APIError);
    expect(caught).toMatchObject({
      status: 429,
      requestID: `llmp_${"C".repeat(43)}`,
      error: {
        type: "rate_limit_error",
        code: "rate_limit",
      },
    });
    expect(calls).toBe(1);
  });
});

describe("official Anthropic SDK source conformance", () => {
  it("routes the pinned SDK through the handler for models, messages, raw named SSE, and accumulated tools", async () => {
    const { client, paths } = createAnthropicSdkFixture();

    const models = await client.models.list();
    expect(models.data).toEqual([anthropicModel]);
    const model = await client.models.retrieve(TEST_MODEL);
    expect(model).toEqual(expect.objectContaining(anthropicModel));
    expect(model._request_id).toMatch(/^req_[a-f0-9]{32}$/);

    const message = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(message.content).toEqual([
      {
        type: "text",
        text: "Hello from mockOS.",
        citations: null,
      },
    ]);
    expect(message.usage).toMatchObject({
      input_tokens: 11,
      output_tokens: 5,
      service_tier: "standard",
    });
    expect(message._request_id).toMatch(/^req_[a-f0-9]{32}$/);

    const toolMessage = await client.messages.create({
      model: TEST_MODEL,
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
    expect(toolMessage.content[1]).toMatchObject({
      type: "tool_use",
      id: "call_weather_1",
      name: "get_weather",
      input: { location: "Berlin", units: "celsius" },
    });

    const rawText = await client.messages
      .create({
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [{ role: "user", content: "Stream named events" }],
        stream: true,
      })
      .withResponse();
    const events = [];
    for await (const event of rawText.data) events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(
      events
        .filter((event) => event.type === "content_block_delta")
        .map((event) => (event.delta.type === "text_delta" ? event.delta.text : ""))
        .join("")
    ).toBe("Hello from mockOS.");
    const textStart = events.find((event) => event.type === "message_start");
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
    const textDelta = events.find((event) => event.type === "message_delta");
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

    const accumulatedToolStream = client.messages.stream({
      model: TEST_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Accumulate the Berlin tool stream" }],
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
    const accumulatedToolConnection = await accumulatedToolStream.withResponse();
    const accumulatedTool = await accumulatedToolStream.finalMessage();
    expect(accumulatedTool).toMatchObject({
      id: expect.stringMatching(/^msg_[a-f0-9]{32}$/),
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 17,
        output_tokens: 9,
      },
    });
    expect(accumulatedTool.content).toContainEqual(
      expect.objectContaining({
        type: "tool_use",
        id: "call_weather_1",
        name: "get_weather",
        input: { location: "Berlin", units: "celsius" },
      })
    );
    expect(accumulatedToolConnection.request_id).toMatch(/^req_[a-f0-9]{32}$/);
    expect(accumulatedToolConnection.request_id).not.toBe(rawText.request_id);
    expect(accumulatedTool.id).not.toBe(textStart.message.id);

    const cancellable = await client.messages.create({
      model: TEST_MODEL,
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
    await expect(cancellableIterator.next()).resolves.toMatchObject({ done: true });
    expect(observedCancellableTypes).not.toContain("message_stop");

    expect(paths).toContain("/e/env_fixture/llm-mock/demo/anthropic/v1/messages");
    expect(paths).toEqual(
      expect.arrayContaining([
        "/e/env_fixture/llm-mock/demo/anthropic/v1/models",
        `/e/env_fixture/llm-mock/demo/anthropic/v1/models/${TEST_MODEL}`,
      ])
    );
    expect(paths.some((path) => path.includes("/v1/v1/"))).toBe(false);
  });

  it("keeps a configured stream-request error as provider JSON without retrying", async () => {
    const { client, messageCalls, streamingContentTypes } = createAnthropicSdkFixture();

    let caught: unknown;
    try {
      await client.messages.create({
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [{ role: "user", content: "Rate limit" }],
        stream: true,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Anthropic.APIError);
    expect(caught).toMatchObject({
      status: 429,
      requestID: expect.stringMatching(/^req_[a-f0-9]{32}$/),
      error: {
        type: "error",
        error: {
          type: "rate_limit_error",
        },
      },
    });
    if (!(caught instanceof Anthropic.APIError)) {
      throw new Error("Expected an Anthropic APIError.");
    }
    expect(caught.headers?.get("content-type")).toContain("application/json");
    expect(streamingContentTypes).toEqual([
      expect.stringContaining("application/json"),
    ]);
    expect(messageCalls()).toBe(1);
  });
});
