import Anthropic from "@anthropic-ai/sdk";
import type { MockLlmPlan } from "@mockos/contracts/mock-llm";
import { describe, expect, it, vi } from "vitest";
import {
  createMockLlmAnthropicFetchHandler,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH,
  MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES,
  MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES,
  MOCK_LLM_ANTHROPIC_VERSION,
  MockLlmAnthropicRequestError,
  type MockLlmAnthropicRuntime,
  type MockLlmAnthropicRuntimeResult,
  mockLlmAnthropicProviderManifest,
  parseMockLlmAnthropicMessageRequest,
} from "./anthropic-http";
import { errorPlan, TEST_MODEL, textPlan, toolPlan } from "./test-support";

const VALID_CREDENTIAL = "synthetic-anthropic-provider-key";
const OPENAI_CREDENTIAL = "synthetic-openai-provider-key";
const PLATFORM_ACCESS_KEY = "synthetic-platform-access-key";
const FIXED_IDENTITY = {
  requestId: "req_0123456789abcdef",
  responseId: "msg_0123456789abcdef",
};

const jsonRequest = (
  body: unknown,
  options: {
    readonly credential?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
  } = {}
) =>
  new Request("https://mockos.test/ignored", {
    method: options.method ?? "POST",
    headers: {
      "x-api-key": options.credential ?? VALID_CREDENTIAL,
      "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
      "content-type": "application/json; charset=utf-8",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });

const messageBody = (
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> => ({
  model: TEST_MODEL,
  max_tokens: 64,
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

const success = <Value>(value: Value): MockLlmAnthropicRuntimeResult<Value> => ({
  ok: true,
  value,
});

const runtime = (
  overrides: Partial<MockLlmAnthropicRuntime> = {}
): MockLlmAnthropicRuntime => ({
  getCatalog: vi.fn(async () =>
    success({
      models: [
        {
          id: TEST_MODEL,
          displayName: "mockOS Text 1",
          createdAtEpochSeconds: 1_785_000_000,
        },
      ],
    })
  ),
  planMessage: vi.fn(async () => success(textPlan())),
  ...overrides,
});

const handler = (
  providerRuntime: MockLlmAnthropicRuntime,
  overrides: Partial<Parameters<typeof createMockLlmAnthropicFetchHandler>[0]> = {}
) =>
  createMockLlmAnthropicFetchHandler({
    runtime: providerRuntime,
    createIdentity: () => FIXED_IDENTITY,
    delay: async () => {},
    ...overrides,
  });

const responseJson = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

const anthropicEvents = (wire: string) =>
  wire
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      if (!eventLine?.startsWith("event: ") || !dataLine?.startsWith("data: ")) {
        throw new Error("Expected one named Anthropic SSE event.");
      }
      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
      };
    });

describe("mock Anthropic provider manifest", () => {
  it("freezes the exact source operation table", () => {
    expect(mockLlmAnthropicProviderManifest).toEqual({
      version: 1,
      dialect: "anthropic",
      routePrefix: "/llm-mock/{slug}/anthropic",
      authentication: {
        scheme: "x-api-key",
        modes: ["accept_any", "strict"],
      },
      requiredHeaders: {
        "anthropic-version": "2023-06-01",
      },
      operations: [
        {
          id: "create_message",
          method: "POST",
          path: "/v1/messages",
          streaming: true,
        },
        {
          id: "list_models",
          method: "GET",
          path: "/v1/models",
          streaming: false,
        },
        {
          id: "retrieve_model",
          method: "GET",
          path: "/v1/models/{model}",
          streaming: false,
        },
      ],
    });
  });
});

describe("bounded Anthropic Messages parsing", () => {
  it("normalizes defaults and custom client tool history", () => {
    const omitted = parseMockLlmAnthropicMessageRequest({
      model: TEST_MODEL,
      max_tokens: 64,
      system: "Answer tersely.",
      messages: [
        { role: "user", content: "Check Berlin" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking." },
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
              content: [{ type: "text", text: "18 C" }],
              is_error: false,
            },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather.",
          input_schema: {
            type: "object",
            properties: { location: { type: "string" } },
          },
        },
      ],
    });
    const explicit = parseMockLlmAnthropicMessageRequest({
      ...omitted.request,
      stream: false,
      tool_choice: { type: "auto" },
    });
    const streamed = parseMockLlmAnthropicMessageRequest({
      ...omitted.request,
      stream: true,
    });

    expect(omitted.turnIndex).toBe(1);
    expect(omitted.stream).toBe(false);
    expect(explicit.stream).toBe(false);
    expect(streamed.stream).toBe(true);
    expect(explicit.fingerprint).toEqual(omitted.fingerprint);
    expect(streamed.fingerprint).toEqual(omitted.fingerprint);
    expect(omitted.fingerprint.toolNames).toEqual(["get_weather"]);
    expect(omitted.fingerprint).toMatchObject({
      dialect: "anthropic",
      operation: "messages.create",
      system: "Answer tersely.",
    });
  });

  it.each([
    [{ ...messageBody(), stream: "yes" }, "invalid_request", "stream"],
    [{ ...messageBody(), temperature: 0 }, "invalid_request", undefined],
    [
      { ...messageBody(), tool_choice: { type: "any" } },
      "invalid_request",
      "tool_choice",
    ],
    [
      { ...messageBody(), system: [{ type: "text", text: "No" }] },
      "invalid_request",
      "system",
    ],
    [{ ...messageBody(), max_tokens: 0 }, "invalid_request", "max_tokens"],
    [
      {
        ...messageBody(),
        messages: [{ role: "system", content: "Use top-level system." }],
      },
      "invalid_request",
      "messages.0",
    ],
    [
      {
        ...messageBody(),
        messages: [
          {
            role: "user",
            content: [{ type: "image", source: { type: "base64", data: "x" } }],
          },
        ],
      },
      "invalid_request",
      "messages.0.content.0",
    ],
  ] as const)("rejects an unsupported first-slice request", (body, code, parameter) => {
    let caught: unknown;
    try {
      parseMockLlmAnthropicMessageRequest(body);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: "MockLlmAnthropicRequestError",
      code,
      ...(parameter ? { parameter } : {}),
    });
  });

  it("rejects duplicate tools, server tools, and oversized text", () => {
    expect(() =>
      parseMockLlmAnthropicMessageRequest({
        ...messageBody(),
        tools: [
          { name: "lookup", input_schema: { type: "object" } },
          { name: "lookup", input_schema: { type: "object" } },
        ],
      })
    ).toThrow(MockLlmAnthropicRequestError);
    expect(() =>
      parseMockLlmAnthropicMessageRequest({
        ...messageBody(),
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            input_schema: { type: "object" },
          },
        ],
      })
    ).toThrow(MockLlmAnthropicRequestError);
    expect(() =>
      parseMockLlmAnthropicMessageRequest({
        ...messageBody(),
        messages: [
          {
            role: "user",
            content: "x".repeat(MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES + 1),
          },
        ],
      })
    ).toThrow(MockLlmAnthropicRequestError);
  });

  it("bounds depth, node count, and prohibited keys before recursive parsing", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index <= MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const nodeHeavy = {
      ...messageBody(),
      extra: Array.from({ length: MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES }, () => null),
    };
    const prohibitedKey = JSON.parse(
      `{"model":${JSON.stringify(TEST_MODEL)},"max_tokens":64,"messages":[{"role":"user","content":"Hello"}],"__proto__":{"polluted":true}}`
    ) as unknown;

    for (const body of [
      { ...messageBody(), extra: deeplyNested },
      nodeHeavy,
      prohibitedKey,
    ]) {
      let caught: unknown;
      try {
        parseMockLlmAnthropicMessageRequest(body);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        name: "MockLlmAnthropicRequestError",
        code: "request_too_large",
      });
    }
  });
});

describe("mock Anthropic HTTP adapter", () => {
  it("works through the official SDK for models and non-streaming Messages", async () => {
    const providerRuntime = runtime();
    const fetchAdapter = handler(providerRuntime);
    const basePath = "/llm-mock/demo/anthropic";
    const paths: string[] = [];
    const client = new Anthropic({
      apiKey: VALID_CREDENTIAL,
      baseURL: `https://mockos.test${basePath}`,
      maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        paths.push(url.pathname);
        return fetchAdapter(request, {
          slug: "demo",
          providerPath: url.pathname.slice(basePath.length),
        });
      },
    });

    const models = await client.models.list();
    expect(models.data).toEqual([
      {
        id: TEST_MODEL,
        type: "model",
        display_name: "mockOS Text 1",
        created_at: new Date(1_785_000_000 * 1_000).toISOString(),
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      },
    ]);
    const model = await client.models.retrieve(TEST_MODEL);
    expect(model.id).toBe(TEST_MODEL);
    expect(model._request_id).toBe(FIXED_IDENTITY.requestId);

    const message = await client.messages.create({
      model: TEST_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(message.id).toBe(FIXED_IDENTITY.responseId);
    expect(message._request_id).toBe(FIXED_IDENTITY.requestId);
    expect(message.content).toEqual([
      {
        type: "text",
        text: "Hello from mockOS.",
        citations: null,
      },
    ]);
    expect(paths).toEqual([
      `${basePath}/v1/models`,
      `${basePath}/v1/models/${TEST_MODEL}`,
      `${basePath}/v1/messages`,
    ]);
  });

  it("renders fresh message identity without exposing the deterministic plan ID", async () => {
    const response = await handler(runtime())(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("request-id")).toBe(FIXED_IDENTITY.requestId);
    const body = await responseJson(response);
    expect(body.id).toBe(FIXED_IDENTITY.responseId);
    expect(JSON.stringify(body)).not.toContain(textPlan().planId);
    expect(body).toMatchObject({
      type: "message",
      model: TEST_MODEL,
      role: "assistant",
      content: [{ type: "text", text: "Hello from mockOS." }],
    });
  });

  it("streams exact named text events with fresh transport identity", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const streamingPlan: MockLlmPlan = {
      ...basePlan,
      cadence: {
        ...basePlan.cadence,
        initialDelayMilliseconds: 0,
        chunkDelayMilliseconds: 0,
      },
    };
    const response = await handler(
      runtime({
        planMessage: vi.fn(async () => success(streamingPlan)),
      })
    )(jsonRequest(messageBody({ stream: true })), {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("request-id")).toBe(FIXED_IDENTITY.requestId);
    const raw = await response.text();
    expect(raw).not.toContain(basePlan.planId);
    const events = anthropicEvents(raw);
    expect(events.map((event) => event.event)).toEqual([
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
    expect(events[0]?.data).toMatchObject({
      type: "message_start",
      message: {
        id: FIXED_IDENTITY.responseId,
        model: TEST_MODEL,
        usage: { input_tokens: 11, output_tokens: 0 },
      },
    });
    expect(
      events
        .filter((event) => event.event === "content_block_delta")
        .map((event) => {
          const delta = event.data.delta as { readonly text?: string };
          return delta.text ?? "";
        })
        .join("")
    ).toBe("Hello from mockOS.");
    expect(events.at(-2)?.data).toMatchObject({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 11, output_tokens: 5 },
    });
    expect(events.at(-1)?.data).toEqual({ type: "message_stop" });
  });

  it("streams reconstructable custom-tool input through named Anthropic events", async () => {
    const basePlan = toolPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const streamingPlan: MockLlmPlan = {
      ...basePlan,
      cadence: {
        ...basePlan.cadence,
        initialDelayMilliseconds: 0,
        chunkDelayMilliseconds: 0,
      },
    };
    const response = await handler(
      runtime({
        planMessage: vi.fn(async () => success(streamingPlan)),
      })
    )(
      jsonRequest(
        messageBody({
          stream: true,
          tools: [
            {
              name: "get_weather",
              input_schema: { type: "object" },
            },
          ],
        })
      ),
      { slug: "demo", providerPath: "/v1/messages" }
    );

    expect(response.status).toBe(200);
    const events = anthropicEvents(await response.text());
    const toolStart = events.find(
      (event) =>
        event.event === "content_block_start" &&
        (event.data.content_block as { readonly type?: string } | undefined)?.type ===
          "tool_use"
    );
    expect(toolStart?.data).toMatchObject({
      index: 1,
      content_block: {
        type: "tool_use",
        id: "call_weather_1",
        name: "get_weather",
        input: {},
      },
    });
    const partialJson = events
      .filter(
        (event) =>
          event.event === "content_block_delta" &&
          (event.data.delta as { readonly type?: string } | undefined)?.type ===
            "input_json_delta"
      )
      .map(
        (event) => (event.data.delta as { readonly partial_json: string }).partial_json
      )
      .join("");
    expect(JSON.parse(partialJson)).toEqual({
      location: "Berlin",
      units: "celsius",
    });
    expect(events.at(-2)?.data).toMatchObject({
      delta: { stop_reason: "tool_use" },
    });
    expect(events.at(-1)?.data).toEqual({ type: "message_stop" });
  });

  it("requires a declared custom tool before returning tool_use", async () => {
    const fetch = handler(
      runtime({
        planMessage: vi.fn(async () => success(toolPlan())),
      })
    );
    const undeclared = await fetch(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(undeclared.status).toBe(500);

    const declared = await fetch(
      jsonRequest(
        messageBody({
          tools: [
            {
              name: "get_weather",
              input_schema: { type: "object" },
            },
          ],
        })
      ),
      { slug: "demo", providerPath: "/v1/messages" }
    );
    expect(declared.status).toBe(200);
    expect(await responseJson(declared)).toMatchObject({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Checking." },
        {
          type: "tool_use",
          id: "call_weather_1",
          name: "get_weather",
          input: { location: "Berlin", units: "celsius" },
        },
      ],
    });
  });

  it("maps configured provider errors while overriding transport identity", async () => {
    const fetch = handler(
      runtime({
        planMessage: vi.fn(async () => success(errorPlan("rate_limit"))),
      })
    );
    const response = await fetch(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("request-id")).toBe(FIXED_IDENTITY.requestId);
    expect(await responseJson(response)).toEqual({
      type: "error",
      error: {
        type: "rate_limit_error",
        message: "Synthetic rate limit.",
      },
      request_id: FIXED_IDENTITY.requestId,
    });

    const streamingRequestError = await fetch(
      jsonRequest(messageBody({ stream: true })),
      {
        slug: "demo",
        providerPath: "/v1/messages",
      }
    );
    expect(streamingRequestError.status).toBe(429);
    expect(streamingRequestError.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(await responseJson(streamingRequestError)).toMatchObject({
      error: { type: "rate_limit_error" },
    });
  });

  it("rejects malformed, cross-provider, and platform authentication before dispatch", async () => {
    const duplicateApiKey = new Headers({
      "x-api-key": VALID_CREDENTIAL,
      "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
    });
    duplicateApiKey.append("x-api-key", OPENAI_CREDENTIAL);
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime, {
      platformApiKey: PLATFORM_ACCESS_KEY,
    });
    const requests = [
      new Request("https://mockos.test", {
        headers: { "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": "short",
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
      new Request("https://mockos.test", { headers: duplicateApiKey }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          authorization: `Bearer ${OPENAI_CREDENTIAL}`,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "x-anthropic-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": PLATFORM_ACCESS_KEY,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
    ];

    for (const request of requests) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/v1/models",
      });
      expect(response.status).toBe(401);
      const serialized = JSON.stringify(await responseJson(response));
      expect(serialized).not.toContain(VALID_CREDENTIAL);
      expect(serialized).not.toContain(OPENAI_CREDENTIAL);
      expect(serialized).not.toContain(PLATFORM_ACCESS_KEY);
    }
    expect(providerRuntime.getCatalog).not.toHaveBeenCalled();
    expect(providerRuntime.planMessage).not.toHaveBeenCalled();
  });

  it("requires the exact stable version and rejects every beta header", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);
    const cases = [
      new Request("https://mockos.test", {
        headers: { "x-api-key": VALID_CREDENTIAL },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": "2024-01-01",
        },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
          "anthropic-beta": "tools-2024-04-04",
        },
      }),
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
          "anthropic-beta-experimental": "true",
        },
      }),
    ];

    for (const request of cases) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/v1/models",
      });
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({
        type: "error",
        error: { type: "invalid_request_error" },
      });
    }
    expect(providerRuntime.getCatalog).not.toHaveBeenCalled();
  });

  it("enforces the body limit across streamed chunks without Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES));
        controller.enqueue(new Uint8Array([0x7b]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://mockos.test", {
      method: "POST",
      headers: {
        "x-api-key": VALID_CREDENTIAL,
        "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        "content-type": "application/json; charset=utf-8",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const providerRuntime = runtime();
    const response = await handler(providerRuntime)(request, {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(request.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    expect(await responseJson(response)).toMatchObject({
      error: { type: "request_too_large" },
    });
    expect(cancelled).toBe(true);
    expect(providerRuntime.planMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, invalid UTF-8, charset, and content encoding", async () => {
    const requestWithBody = (
      body: BodyInit,
      headers: Readonly<Record<string, string>> = {}
    ) =>
      new Request("https://mockos.test", {
        method: "POST",
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
          "content-type": "application/json; charset=utf-8",
          ...headers,
        },
        body,
      });
    const cases = [
      requestWithBody("{"),
      requestWithBody(new Uint8Array([0xff])),
      requestWithBody(JSON.stringify(messageBody()), {
        "content-type": "application/json; charset=iso-8859-1",
      }),
      requestWithBody(JSON.stringify(messageBody()), {
        "content-encoding": "gzip",
      }),
    ];
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);

    for (const request of cases) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/v1/messages",
      });
      expect(response.status).toBe(400);
      const serialized = JSON.stringify(await responseJson(response));
      expect(serialized).not.toContain(VALID_CREDENTIAL);
    }
    expect(providerRuntime.planMessage).not.toHaveBeenCalled();
  });

  it("rejects request and response credential reflection", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);
    const reflectedRequest = await fetch(
      jsonRequest(
        messageBody({
          messages: [
            {
              role: "user",
              content: `Please echo ${VALID_CREDENTIAL}`,
            },
          ],
        })
      ),
      { slug: "demo", providerPath: "/v1/messages" }
    );
    expect(reflectedRequest.status).toBe(400);
    expect(providerRuntime.planMessage).not.toHaveBeenCalled();

    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const reflectedPlan: MockLlmPlan = {
      ...basePlan,
      segments: [{ type: "text", text: VALID_CREDENTIAL }],
    };
    const reflectedResponse = await handler(
      runtime({
        planMessage: vi.fn(async () => success(reflectedPlan)),
      })
    )(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    const serialized = JSON.stringify(await responseJson(reflectedResponse));
    expect(reflectedResponse.status).toBe(500);
    expect(serialized).not.toContain(VALID_CREDENTIAL);
  });

  it("fails closed when the runtime returns a plan for another model", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const response = await handler(
      runtime({
        planMessage: vi.fn(async () =>
          success({ ...basePlan, model: "different-model" })
        ),
      })
    )(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(response.status).toBe(500);
    expect(await responseJson(response)).toMatchObject({
      error: { type: "api_error" },
    });
  });

  it("fails closed on invalid or secret-bearing runtime catalog output", async () => {
    const invalid = await handler(
      runtime({
        getCatalog: vi.fn(async () =>
          success({
            models: [
              {
                id: TEST_MODEL,
                displayName: " ",
                createdAtEpochSeconds: 1_785_000_000,
              },
            ],
          })
        ),
      })
    )(
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
      { slug: "demo", providerPath: "/v1/models" }
    );
    expect(invalid.status).toBe(500);

    const secret = await handler(
      runtime({
        getCatalog: vi.fn(async () =>
          success({
            models: [
              {
                id: TEST_MODEL,
                displayName: `Model ${VALID_CREDENTIAL}`,
                createdAtEpochSeconds: 1_785_000_000,
              },
            ],
          })
        ),
      })
    )(
      new Request("https://mockos.test", {
        headers: {
          "x-api-key": VALID_CREDENTIAL,
          "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
        },
      }),
      { slug: "demo", providerPath: "/v1/models" }
    );
    const serialized = JSON.stringify(await responseJson(secret));
    expect(secret.status).toBe(500);
    expect(serialized).not.toContain(VALID_CREDENTIAL);
  });

  it("maps runtime failures and exact method/route metadata", async () => {
    const providerRuntime = runtime({
      getCatalog: vi.fn(async () => ({
        ok: false as const,
        code: "authentication" as const,
      })),
      planMessage: vi.fn(async () => ({
        ok: false as const,
        code: "model_not_found" as const,
      })),
    });
    const fetch = handler(providerRuntime);
    const headers = {
      "x-api-key": VALID_CREDENTIAL,
      "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
    };
    const auth = await fetch(new Request("https://mockos.test", { headers }), {
      slug: "demo",
      providerPath: "/v1/models",
    });
    expect(auth.status).toBe(401);

    const model = await fetch(jsonRequest(messageBody()), {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(model.status).toBe(404);
    expect(await responseJson(model)).toMatchObject({
      error: { type: "not_found_error" },
    });

    const missingRoute = await fetch(new Request("https://mockos.test", { headers }), {
      slug: "demo",
      providerPath: "/v1/complete",
    });
    expect(missingRoute.status).toBe(404);

    const wrongMethod = await handler(runtime())(
      new Request("https://mockos.test", {
        method: "POST",
        headers,
      }),
      { slug: "demo", providerPath: "/v1/models" }
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
  });

  it("truncates an accepted stream when the provider request is aborted", async () => {
    const controller = new AbortController();
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const streamingPlan: MockLlmPlan = {
      ...basePlan,
      cadence: {
        ...basePlan.cadence,
        initialDelayMilliseconds: 0,
        chunkDelayMilliseconds: 0,
      },
    };
    const request = new Request(jsonRequest(messageBody({ stream: true })), {
      signal: controller.signal,
    });
    const response = await handler(
      runtime({
        planMessage: vi.fn(async () => success(streamingPlan)),
      })
    )(request, {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected a streaming response body.");
    const first = await reader.read();
    expect(first.done).toBe(false);
    const emitted = new TextDecoder().decode(first.value);
    expect(emitted).toContain("event: message_start");
    expect(emitted).not.toContain("event: message_stop");

    controller.abort("client disconnected");
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps a stream deadline failure on the generic pre-header error side", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const response = await handler(runtime(), {
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValue(6_000),
    })(jsonRequest(messageBody({ stream: true })), {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(basePlan.cadence.maximumDurationMilliseconds).toBe(5_000);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await responseJson(response)).toMatchObject({
      type: "error",
      error: {
        type: "api_error",
        message: "The mock Anthropic request could not be completed.",
      },
      request_id: FIXED_IDENTITY.requestId,
    });
  });

  it("handles aborted and already-aborted initial delay locally", async () => {
    const controller = new AbortController();
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const delayedPlan = {
      ...basePlan,
      cadence: { ...basePlan.cadence, initialDelayMilliseconds: 5 },
    };
    const fetch = handler(
      runtime({
        planMessage: vi.fn(async () => success(delayedPlan)),
      }),
      {
        delay: vi.fn(async (_milliseconds, signal) => {
          controller.abort("client disconnected");
          throw signal.reason;
        }),
      }
    );
    const request = new Request(jsonRequest(messageBody()), {
      signal: controller.signal,
    });
    const aborted = await fetch(request, {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(aborted.status).toBe(499);

    const streamingController = new AbortController();
    const streamingFetch = handler(
      runtime({
        planMessage: vi.fn(async () => {
          streamingController.abort("client disconnected");
          return success(delayedPlan);
        }),
      })
    );
    const streamingRequest = new Request(jsonRequest(messageBody({ stream: true })), {
      signal: streamingController.signal,
    });
    const abortedStream = await streamingFetch(streamingRequest, {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(abortedStream.status).toBe(499);
    expect(await abortedStream.text()).toBe("");

    const alreadyAborted = new AbortController();
    alreadyAborted.abort("client disconnected");
    const zeroDelayRequest = new Request(jsonRequest(messageBody()), {
      signal: alreadyAborted.signal,
    });
    const zeroDelay = await createMockLlmAnthropicFetchHandler({
      runtime: runtime(),
      createIdentity: () => FIXED_IDENTITY,
    })(zeroDelayRequest, {
      slug: "demo",
      providerPath: "/v1/messages",
    });
    expect(zeroDelay.status).toBe(499);
    expect(await zeroDelay.text()).toBe("");
  });
});
