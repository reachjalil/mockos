import { type MockLlmPlan, parseMockLlmPlan } from "@mockos/contracts/mock-llm";
import { describe, expect, it, vi } from "vitest";
import {
  createMockLlmOpenAiFetchHandler,
  MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH,
  MOCK_LLM_OPENAI_MAX_REQUEST_NODES,
  MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
  MOCK_LLM_OPENAI_MAX_TEXT_BYTES,
  MockLlmOpenAiRequestError,
  type MockLlmOpenAiRuntime,
  type MockLlmOpenAiRuntimeResult,
  mockLlmOpenAiProviderManifest,
  parseMockLlmOpenAiChatRequest,
} from "./openai-http";
import { errorPlan, TEST_MODEL, textPlan, toolPlan } from "./test-support";

const VALID_CREDENTIAL = "synthetic-openai-provider-key";
const ANTHROPIC_CREDENTIAL = "synthetic-anthropic-provider-key";
const PLATFORM_ACCESS_KEY = "synthetic-platform-access-key";
const FIXED_IDENTITY = {
  requestId: "req_0123456789abcdef",
  responseId: "chatcmpl-0123456789abcdef",
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
      authorization: `Bearer ${options.credential ?? VALID_CREDENTIAL}`,
      "content-type": "application/json; charset=utf-8",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });

const chatBody = (
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> => ({
  model: TEST_MODEL,
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

const success = <Value>(value: Value): MockLlmOpenAiRuntimeResult<Value> => ({
  ok: true,
  value,
});

const runtime = (
  overrides: Partial<MockLlmOpenAiRuntime> = {}
): MockLlmOpenAiRuntime => ({
  getCatalog: vi.fn(async () =>
    success({
      models: [
        {
          id: TEST_MODEL,
          createdAtEpochSeconds: 1_785_000_000,
        },
      ],
    })
  ),
  planChatCompletion: vi.fn(async () => success(textPlan())),
  ...overrides,
});

const handler = (
  providerRuntime: MockLlmOpenAiRuntime,
  overrides: Partial<Parameters<typeof createMockLlmOpenAiFetchHandler>[0]> = {}
) =>
  createMockLlmOpenAiFetchHandler({
    runtime: providerRuntime,
    createIdentity: () => FIXED_IDENTITY,
    delay: async () => {},
    ...overrides,
  });

const responseJson = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe("mock OpenAI provider manifest", () => {
  it("freezes the exact source operation table", () => {
    expect(mockLlmOpenAiProviderManifest).toEqual({
      version: 1,
      dialect: "openai",
      routePrefix: "/llm-mock/{slug}/openai/v1",
      authentication: {
        scheme: "bearer",
        modes: ["accept_any", "strict"],
      },
      operations: [
        {
          id: "create_chat_completion",
          method: "POST",
          path: "/chat/completions",
          streaming: true,
        },
        {
          id: "list_models",
          method: "GET",
          path: "/models",
          streaming: false,
        },
        {
          id: "retrieve_model",
          method: "GET",
          path: "/models/{model}",
          streaming: false,
        },
      ],
    });
  });
});

describe("bounded OpenAI Chat Completions parsing", () => {
  it("normalizes explicit defaults and derives the turn from assistant messages", () => {
    const omitted = parseMockLlmOpenAiChatRequest({
      model: TEST_MODEL,
      messages: [
        { role: "user", content: "First" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_weather_1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location":"Berlin"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_weather_1",
          content: '{"temperature":18}',
        },
        { role: "user", content: "Continue" },
      ],
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
    const explicit = parseMockLlmOpenAiChatRequest({
      ...omitted.request,
      n: 1,
      stream: false,
      tool_choice: "auto",
    });

    expect(omitted.turnIndex).toBe(1);
    expect(omitted.stream).toBe(false);
    expect(omitted.includeUsage).toBe(false);
    expect(omitted.includeObfuscation).toBe(false);
    expect(explicit.fingerprint).toEqual(omitted.fingerprint);
    expect(omitted.fingerprint.toolNames).toEqual(["get_weather"]);
  });

  it("accepts the bounded current streaming options without changing behavior selection", () => {
    const nonStreaming = parseMockLlmOpenAiChatRequest(chatBody());
    const defaults = parseMockLlmOpenAiChatRequest(
      chatBody({
        stream: true,
      })
    );
    const explicit = parseMockLlmOpenAiChatRequest(
      chatBody({
        stream: true,
        stream_options: {
          include_usage: true,
          include_obfuscation: false,
        },
      })
    );

    expect(defaults).toMatchObject({
      stream: true,
      includeUsage: false,
      includeObfuscation: true,
    });
    expect(explicit).toMatchObject({
      stream: true,
      includeUsage: true,
      includeObfuscation: false,
    });
    expect(defaults.fingerprint).toEqual(nonStreaming.fingerprint);
    expect(explicit.fingerprint).toEqual(nonStreaming.fingerprint);
  });

  it.each([
    [{ ...chatBody(), stream_options: {} }, "invalid_request", "stream_options"],
    [
      {
        ...chatBody(),
        stream: true,
        stream_options: { include_usage: "yes" },
      },
      "invalid_request",
      "stream_options",
    ],
    [
      {
        ...chatBody(),
        stream: true,
        stream_options: { unknown: false },
      },
      "invalid_request",
      "stream_options",
    ],
    [{ ...chatBody(), n: 2 }, "invalid_request", "n"],
    [{ ...chatBody(), tool_choice: "none" }, "invalid_request", "tool_choice"],
    [
      { ...chatBody(), response_format: { type: "json_object" } },
      "invalid_request",
      undefined,
    ],
    [
      {
        ...chatBody(),
        messages: [{ role: "function", name: "legacy", content: "{}" }],
      },
      "invalid_request",
      "messages.0.role",
    ],
    [
      {
        ...chatBody(),
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "multimodal is not in this slice" }],
          },
        ],
      },
      "invalid_request",
      "messages.0",
    ],
  ] as const)("rejects an unsupported first-slice request", (body, code, parameter) => {
    let caught: unknown;
    try {
      parseMockLlmOpenAiChatRequest(body);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: "MockLlmOpenAiRequestError",
      code,
      ...(parameter ? { parameter } : {}),
    });
  });

  it("rejects duplicate tools and oversized text", () => {
    expect(() =>
      parseMockLlmOpenAiChatRequest({
        ...chatBody(),
        tools: [
          { type: "function", function: { name: "lookup" } },
          { type: "function", function: { name: "lookup" } },
        ],
      })
    ).toThrow(MockLlmOpenAiRequestError);
    expect(() =>
      parseMockLlmOpenAiChatRequest({
        ...chatBody(),
        messages: [
          {
            role: "user",
            content: "x".repeat(MOCK_LLM_OPENAI_MAX_TEXT_BYTES + 1),
          },
        ],
      })
    ).toThrow(MockLlmOpenAiRequestError);
  });

  it("bounds depth, node count, and prohibited keys before recursive parsing", () => {
    const deeplyNested: Record<string, unknown> = {};
    let cursor = deeplyNested;
    for (let index = 0; index <= MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    const nodeHeavy = {
      ...chatBody(),
      extra: Array.from({ length: MOCK_LLM_OPENAI_MAX_REQUEST_NODES }, () => null),
    };
    const prohibitedKey = JSON.parse(
      `{"model":${JSON.stringify(TEST_MODEL)},"messages":[{"role":"user","content":"Hello"}],"__proto__":{"polluted":true}}`
    ) as unknown;

    for (const body of [
      { ...chatBody(), extra: deeplyNested },
      nodeHeavy,
      prohibitedKey,
    ]) {
      let caught: unknown;
      try {
        parseMockLlmOpenAiChatRequest(body);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        name: "MockLlmOpenAiRequestError",
        code: "request_too_large",
      });
    }
  });
});

describe("mock OpenAI HTTP adapter", () => {
  it("lists and retrieves models with provider-shaped fresh identity", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);
    const list = await fetch(
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer   ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: "/models" }
    );
    expect(list.status).toBe(200);
    expect(list.headers.get("x-request-id")).toBe(FIXED_IDENTITY.requestId);
    expect(await responseJson(list)).toEqual({
      object: "list",
      data: [
        {
          id: TEST_MODEL,
          object: "model",
          created: 1_785_000_000,
          owned_by: "mockos",
        },
      ],
    });

    const retrieve = await fetch(
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: `/models/${encodeURIComponent(TEST_MODEL)}` }
    );
    expect(retrieve.status).toBe(200);
    expect(await responseJson(retrieve)).toEqual({
      id: TEST_MODEL,
      object: "model",
      created: 1_785_000_000,
      owned_by: "mockos",
    });
  });

  it("renders a non-streaming completion without exposing the deterministic plan ID", async () => {
    const fetch = handler(runtime());
    const response = await fetch(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(FIXED_IDENTITY.requestId);
    const body = await responseJson(response);
    expect(body.id).toBe(FIXED_IDENTITY.responseId);
    expect(JSON.stringify(body)).not.toContain(textPlan().planId);
    expect(body).toMatchObject({
      object: "chat.completion",
      model: TEST_MODEL,
      choices: [{ message: { content: "Hello from mockOS." } }],
    });
  });

  it("streams exact text, usage, DONE, and bounded compatibility padding", async () => {
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
    const fetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(streamingPlan)),
      })
    );
    const response = await fetch(
      jsonRequest(
        chatBody({
          stream: true,
          stream_options: { include_usage: true },
        })
      ),
      { slug: "demo", providerPath: "/chat/completions" }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe(FIXED_IDENTITY.requestId);
    const raw = await response.text();
    expect(raw).not.toContain(basePlan.planId);
    const events = raw
      .split("\n\n")
      .filter(Boolean)
      .map((event) => event.slice("data: ".length));
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1).map(
      (event) =>
        JSON.parse(event) as Readonly<{
          id: string;
          choices: readonly {
            delta: { role?: string; content?: string };
            finish_reason: string | null;
          }[];
          usage?: unknown;
          obfuscation?: unknown;
        }>
    );
    expect(new Set(chunks.map((chunk) => chunk.id))).toEqual(
      new Set([FIXED_IDENTITY.responseId])
    );
    expect(
      chunks
        .flatMap((chunk) => chunk.choices)
        .map((choice) => choice.delta.content ?? "")
        .join("")
    ).toBe("Hello from mockOS.");
    const regularChunks = chunks.filter((chunk) => chunk.choices.length > 0);
    expect(regularChunks.every((chunk) => chunk.usage === null)).toBe(true);
    expect(regularChunks.every((chunk) => typeof chunk.obfuscation === "string")).toBe(
      true
    );
    expect(new Set(regularChunks.map((chunk) => chunk.obfuscation)).size).toBe(
      regularChunks.length
    );
    expect(chunks.at(-1)).toMatchObject({
      choices: [],
      usage: {
        completion_tokens: 5,
        prompt_tokens: 11,
        total_tokens: 16,
      },
    });
    expect(chunks.at(-1)).not.toHaveProperty("obfuscation");

    const withoutPadding = await fetch(
      jsonRequest(
        chatBody({
          stream: true,
          stream_options: { include_obfuscation: false },
        })
      ),
      { slug: "demo", providerPath: "/chat/completions" }
    );
    expect(await withoutPadding.text()).not.toContain('"obfuscation"');
  });

  it("requires declared tools before returning a behavior-selected tool call", async () => {
    const fetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(toolPlan())),
      })
    );
    const undeclared = await fetch(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(undeclared.status).toBe(500);

    const declared = await fetch(
      jsonRequest(
        chatBody({
          tools: [{ type: "function", function: { name: "get_weather" } }],
        })
      ),
      { slug: "demo", providerPath: "/chat/completions" }
    );
    expect(declared.status).toBe(200);
    expect(await responseJson(declared)).toMatchObject({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                type: "function",
                function: { name: "get_weather" },
              },
            ],
          },
        },
      ],
    });
  });

  it("maps configured provider errors while overriding only transport identity", async () => {
    const fetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(errorPlan("rate_limit"))),
      })
    );
    const response = await fetch(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.get("x-request-id")).toBe(FIXED_IDENTITY.requestId);
    expect(await responseJson(response)).toMatchObject({
      error: { type: "rate_limit_error", code: "rate_limit" },
    });

    const streamingRequestError = await fetch(jsonRequest(chatBody({ stream: true })), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(streamingRequestError.status).toBe(429);
    expect(streamingRequestError.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(await responseJson(streamingRequestError)).toMatchObject({
      error: { type: "rate_limit_error", code: "rate_limit" },
    });
  });

  it("rejects malformed, cross-provider, and platform authentication before dispatch", async () => {
    const duplicateAuthorization = new Headers({
      authorization: `Bearer ${VALID_CREDENTIAL}`,
    });
    duplicateAuthorization.append("authorization", `Bearer ${ANTHROPIC_CREDENTIAL}`);
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime, {
      platformApiKey: PLATFORM_ACCESS_KEY,
    });
    const requests = [
      new Request("https://mockos.test"),
      new Request("https://mockos.test", {
        headers: { authorization: `Basic ${VALID_CREDENTIAL}` },
      }),
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${VALID_CREDENTIAL} trailing` },
      }),
      new Request("https://mockos.test", {
        headers: duplicateAuthorization,
      }),
      new Request("https://mockos.test", {
        headers: {
          authorization: `Bearer ${VALID_CREDENTIAL}`,
          "x-api-key": VALID_CREDENTIAL,
        },
      }),
      new Request("https://mockos.test", {
        headers: {
          authorization: `Bearer ${VALID_CREDENTIAL}`,
          "x-anthropic-api-key": ANTHROPIC_CREDENTIAL,
        },
      }),
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${PLATFORM_ACCESS_KEY}` },
      }),
    ];

    for (const request of requests) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/models",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      const serialized = JSON.stringify(await responseJson(response));
      expect(serialized).not.toContain(VALID_CREDENTIAL);
      expect(serialized).not.toContain(ANTHROPIC_CREDENTIAL);
      expect(serialized).not.toContain(PLATFORM_ACCESS_KEY);
    }
    expect(providerRuntime.getCatalog).not.toHaveBeenCalled();
    expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
  });

  it("enforces the body limit across streamed chunks without Content-Length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES));
        controller.enqueue(new Uint8Array([0x7b]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://mockos.test", {
      method: "POST",
      headers: {
        authorization: `Bearer ${VALID_CREDENTIAL}`,
        "content-type": "application/json; charset=utf-8",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const providerRuntime = runtime();
    const response = await handler(providerRuntime)(request, {
      slug: "demo",
      providerPath: "/chat/completions",
    });

    expect(request.headers.get("content-length")).toBeNull();
    expect(response.status).toBe(413);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "request_too_large" },
    });
    expect(cancelled).toBe(true);
    expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, invalid UTF-8, charset, and content encoding before dispatch", async () => {
    const requestWithBody = (
      body: BodyInit,
      headers: Readonly<Record<string, string>> = {}
    ) =>
      new Request("https://mockos.test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${VALID_CREDENTIAL}`,
          "content-type": "application/json; charset=utf-8",
          ...headers,
        },
        body,
      });
    const cases: readonly [Request, string][] = [
      [requestWithBody("{"), "invalid_json"],
      [requestWithBody(new Uint8Array([0xff])), "invalid_json"],
      [
        requestWithBody(JSON.stringify(chatBody()), {
          "content-type": "application/json; charset=iso-8859-1",
        }),
        "invalid_content_type",
      ],
      [
        requestWithBody(JSON.stringify(chatBody()), {
          "content-encoding": "gzip",
        }),
        "unsupported_content_encoding",
      ],
    ];
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);

    for (const [request, errorCode] of cases) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/chat/completions",
      });
      expect(response.status).toBe(400);
      const responseBody = await responseJson(response);
      expect(responseBody).toMatchObject({ error: { code: errorCode } });
      expect(JSON.stringify(responseBody)).not.toContain(VALID_CREDENTIAL);
    }
    expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    [chatBody({ response_format: { type: "json_object" } }), "invalid_request", null],
    [chatBody({ tool_choice: "required" }), "invalid_request", "tool_choice"],
    [chatBody({ n: 0 }), "invalid_request", "n"],
    [
      chatBody({ stream_options: { include_usage: true } }),
      "invalid_request",
      "stream_options",
    ],
  ] as const)(
    "rejects unsupported top-level OpenAI request fields before dispatch",
    async (body, errorCode, parameter) => {
      const providerRuntime = runtime();
      const response = await handler(providerRuntime)(jsonRequest(body), {
        slug: "demo",
        providerPath: "/chat/completions",
      });

      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({
        error: { code: errorCode, param: parameter },
      });
      expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
    }
  );

  it("fails closed on an invalid oversized runtime plan", async () => {
    const oversizedPlan = {
      ...textPlan(),
      segments: [
        {
          type: "text",
          text: "x".repeat(MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES + 1),
        },
      ],
    } as unknown as MockLlmPlan;
    const fetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(oversizedPlan)),
      })
    );
    const response = await fetch(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    const serialized = await response.text();

    expect(response.status).toBe(500);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(
      MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES
    );
    expect(JSON.parse(serialized)).toMatchObject({
      error: { code: "internal_error" },
    });
  });

  it("rejects a valid complete SSE body over 2 MiB before returning 200", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const model = "m".repeat(256);
    const oversizedSsePlan = parseMockLlmPlan({
      ...basePlan,
      model,
      segments: [
        {
          type: "tool_call",
          id: "call_large_1",
          name: "lookup",
          input: { value: "x".repeat(4_084) },
        },
      ],
      stopReason: "tool_use",
      cadence: {
        initialDelayMilliseconds: 0,
        chunkDelayMilliseconds: 0,
        chunkSize: 1,
        maximumDurationMilliseconds: 60_000,
      },
    });
    const response = await handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(oversizedSsePlan)),
      })
    )(
      jsonRequest(
        chatBody({
          model,
          stream: true,
          tools: [{ type: "function", function: { name: "lookup" } }],
        })
      ),
      { slug: "demo", providerPath: "/chat/completions" }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await responseJson(response)).toMatchObject({
      error: { code: "internal_error" },
    });
  });

  it("returns generic local errors without invoking the runtime", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime, { platformApiKey: "platform-access-key" });
    const cases: readonly [Request, number][] = [
      [
        new Request("https://mockos.test", {
          headers: { authorization: "Bearer short" },
        }),
        401,
      ],
      [
        new Request("https://mockos.test", {
          headers: {
            authorization: `Bearer ${VALID_CREDENTIAL}`,
            "x-api-key": VALID_CREDENTIAL,
          },
        }),
        401,
      ],
      [
        new Request("https://mockos.test", {
          headers: {
            authorization: "Bearer prefix-platform-access-key-suffix",
          },
        }),
        401,
      ],
      [
        jsonRequest(chatBody(), {
          headers: { "content-encoding": "gzip" },
        }),
        400,
      ],
      [
        new Request("https://mockos.test", {
          method: "POST",
          headers: {
            authorization: `Bearer ${VALID_CREDENTIAL}`,
            "content-type": "application/json",
          },
          body: new Uint8Array([0xff]),
        }),
        400,
      ],
      [
        new Request("https://mockos.test", {
          method: "POST",
          headers: {
            authorization: `Bearer ${VALID_CREDENTIAL}`,
            "content-type": "application/json",
            "content-length": String(MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES + 1),
          },
          body: "{}",
        }),
        413,
      ],
    ];

    for (const [request, expectedStatus] of cases) {
      const response = await fetch(request, {
        slug: "demo",
        providerPath: "/chat/completions",
      });
      expect(response.status).toBe(expectedStatus);
      expect(JSON.stringify(await responseJson(response))).not.toContain(
        VALID_CREDENTIAL
      );
    }
    expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects credential reflection before planning", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);
    const response = await fetch(
      jsonRequest(
        chatBody({
          messages: [
            {
              role: "user",
              content: `Please echo ${VALID_CREDENTIAL}`,
            },
          ],
        })
      ),
      { slug: "demo", providerPath: "/chat/completions" }
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await responseJson(response))).not.toContain(
      VALID_CREDENTIAL
    );
    expect(providerRuntime.planChatCompletion).not.toHaveBeenCalled();
  });

  it("fails closed on secret-bearing runtime plans and catalogs", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const reflectedPlan: MockLlmPlan = {
      ...basePlan,
      segments: [{ type: "text", text: VALID_CREDENTIAL }],
    };
    const reflectedResponse = await handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(reflectedPlan)),
      })
    )(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(reflectedResponse.status).toBe(500);
    expect(JSON.stringify(await responseJson(reflectedResponse))).not.toContain(
      VALID_CREDENTIAL
    );

    const splitReflectedPlan: MockLlmPlan = {
      ...basePlan,
      segments: [
        { type: "text", text: VALID_CREDENTIAL.slice(0, 12) },
        { type: "text", text: VALID_CREDENTIAL.slice(12) },
      ],
    };
    const splitReflectedResponse = await handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(splitReflectedPlan)),
      })
    )(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(splitReflectedResponse.status).toBe(500);
    expect(JSON.stringify(await responseJson(splitReflectedResponse))).not.toContain(
      VALID_CREDENTIAL
    );

    const secretCatalog = await handler(
      runtime({
        getCatalog: vi.fn(async () =>
          success({
            models: [
              {
                id: `model-${VALID_CREDENTIAL}`,
                createdAtEpochSeconds: 1_785_000_000,
              },
            ],
          })
        ),
      })
    )(
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: "/models" }
    );
    expect(secretCatalog.status).toBe(500);
    expect(JSON.stringify(await responseJson(secretCatalog))).not.toContain(
      VALID_CREDENTIAL
    );
  });

  it("fails closed when the runtime returns a plan for another model", async () => {
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const response = await handler(
      runtime({
        planChatCompletion: vi.fn(async () =>
          success({ ...basePlan, model: "different-model" })
        ),
      })
    )(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });

    expect(response.status).toBe(500);
    expect(await responseJson(response)).toMatchObject({
      error: { code: "internal_error" },
    });
  });

  it("maps runtime auth, model, and route failures without reflecting details", async () => {
    const providerRuntime = runtime({
      getCatalog: vi.fn(async () => ({
        ok: false as const,
        code: "authentication" as const,
      })),
      planChatCompletion: vi.fn(async () => ({
        ok: false as const,
        code: "model_not_found" as const,
      })),
    });
    const fetch = handler(providerRuntime);
    const auth = await fetch(
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: "/models" }
    );
    expect(auth.status).toBe(401);
    expect(auth.headers.get("www-authenticate")).toBe("Bearer");

    const model = await fetch(jsonRequest(chatBody()), {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(model.status).toBe(404);
    expect(await responseJson(model)).toMatchObject({
      error: { code: "model_not_found", param: "model" },
    });

    const missingRoute = await fetch(
      new Request("https://mockos.test", {
        headers: { authorization: `Bearer ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: "/responses" }
    );
    expect(missingRoute.status).toBe(404);
  });

  it("returns exact Allow metadata and handles aborted initial delay locally", async () => {
    const controller = new AbortController();
    const basePlan = textPlan();
    if (basePlan.kind !== "response") throw new Error("Expected response plan.");
    const delayedPlan = {
      ...basePlan,
      cadence: { ...basePlan.cadence, initialDelayMilliseconds: 5 },
    };
    const fetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => success(delayedPlan)),
      }),
      {
        delay: vi.fn(async (_milliseconds, signal) => {
          controller.abort("client disconnected");
          throw signal.reason;
        }),
      }
    );
    const request = jsonRequest(chatBody());
    const abortedRequest = new Request(request, { signal: controller.signal });
    const aborted = await fetch(abortedRequest, {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(aborted.status).toBe(499);

    const streamingController = new AbortController();
    const streamingFetch = handler(
      runtime({
        planChatCompletion: vi.fn(async () => {
          streamingController.abort("client disconnected");
          return success(delayedPlan);
        }),
      })
    );
    const streamingRequest = new Request(jsonRequest(chatBody({ stream: true })), {
      signal: streamingController.signal,
    });
    const abortedStream = await streamingFetch(streamingRequest, {
      slug: "demo",
      providerPath: "/chat/completions",
    });
    expect(abortedStream.status).toBe(499);
    expect(await abortedStream.text()).toBe("");

    const wrongMethod = await handler(runtime())(
      new Request("https://mockos.test", {
        method: "POST",
        headers: { authorization: `Bearer ${VALID_CREDENTIAL}` },
      }),
      { slug: "demo", providerPath: "/models" }
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
  });

  it("does not render an already-aborted zero-delay completion", async () => {
    const controller = new AbortController();
    controller.abort("client disconnected");
    const request = new Request(jsonRequest(chatBody()), {
      signal: controller.signal,
    });
    const fetch = createMockLlmOpenAiFetchHandler({
      runtime: runtime(),
      createIdentity: () => FIXED_IDENTITY,
    });

    const response = await fetch(request, {
      slug: "demo",
      providerPath: "/chat/completions",
    });

    expect(response.status).toBe(499);
    expect(await response.text()).toBe("");
  });
});
