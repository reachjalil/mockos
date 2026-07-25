import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { renderAnthropicPlan } from "./anthropic";
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

const jsonResponse = (
  body: Readonly<Record<string, unknown>>,
  requestHeader: "x-request-id" | "request-id"
): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      [requestHeader]: `llmp_${"D".repeat(43)}`,
    },
  });

const readJsonBody = async (
  request: Request
): Promise<Readonly<Record<string, unknown>>> =>
  (await request.json()) as Readonly<Record<string, unknown>>;

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
  it("uses the dialect-root base URL and deserializes models, messages, tools, and SSE", async () => {
    const paths: string[] = [];
    const fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const request = requestFromFetchInput(input, init);
      const url = new URL(request.url);
      paths.push(url.pathname);
      expect(request.headers.get("x-api-key")).toBe("mock-anthropic-credential");
      expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

      if (request.method === "GET" && url.pathname.endsWith("/models")) {
        return jsonResponse(
          {
            data: [anthropicModel],
            first_id: TEST_MODEL,
            last_id: TEST_MODEL,
            has_more: false,
          },
          "request-id"
        );
      }
      if (request.method === "GET" && url.pathname.endsWith(`/models/${TEST_MODEL}`)) {
        return jsonResponse(anthropicModel, "request-id");
      }
      const body = await readJsonBody(request);
      const plan = Array.isArray(body.tools) ? toolPlan() : textPlan();
      return wireToResponse(
        renderAnthropicPlan(plan, {
          stream: body.stream === true,
        })
      );
    };
    const client = new Anthropic({
      apiKey: "mock-anthropic-credential",
      baseURL: ANTHROPIC_BASE_URL,
      maxRetries: 0,
      fetch,
    });

    const models = await client.models.list();
    expect(models.data).toEqual([anthropicModel]);
    const model = await client.models.retrieve(TEST_MODEL);
    expect(model).toEqual(expect.objectContaining(anthropicModel));
    expect(model._request_id).toBe(`llmp_${"D".repeat(43)}`);

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
    expect(message._request_id).toBe(`llmp_${"A".repeat(43)}`);

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

    const stream = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Stream" }],
      stream: true,
    });
    const events = [];
    for await (const event of stream) events.push(event);
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
    expect(paths).toContain("/e/env_fixture/llm-mock/demo/anthropic/v1/messages");
    expect(paths).toEqual(
      expect.arrayContaining([
        "/e/env_fixture/llm-mock/demo/anthropic/v1/models",
        `/e/env_fixture/llm-mock/demo/anthropic/v1/models/${TEST_MODEL}`,
      ])
    );
    expect(paths.some((path) => path.includes("/v1/v1/"))).toBe(false);
  });

  it("preserves provider errors and disables implicit retries", async () => {
    let calls = 0;
    const client = new Anthropic({
      apiKey: "mock-anthropic-credential",
      baseURL: ANTHROPIC_BASE_URL,
      maxRetries: 0,
      fetch: async () => {
        calls += 1;
        return wireToResponse(
          renderAnthropicPlan(errorPlan("rate_limit"), { stream: false })
        );
      },
    });

    let caught: unknown;
    try {
      await client.messages.create({
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [{ role: "user", content: "Rate limit" }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Anthropic.APIError);
    expect(caught).toMatchObject({
      status: 429,
      requestID: `llmp_${"C".repeat(43)}`,
      error: {
        type: "error",
        error: {
          type: "rate_limit_error",
        },
      },
    });
    expect(calls).toBe(1);
  });
});
