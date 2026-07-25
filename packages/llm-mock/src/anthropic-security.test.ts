import type { MockLlmPlan } from "@mockos/contracts/mock-llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderedLlmWire } from "./wire";

type AnthropicRenderer = typeof import("./anthropic")["renderAnthropicPlan"];

const securityRenderState = vi.hoisted(() => ({
  override: undefined as AnthropicRenderer | undefined,
}));

vi.mock("./anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./anthropic")>();
  return {
    ...actual,
    renderAnthropicPlan: (...args: Parameters<AnthropicRenderer>) =>
      (securityRenderState.override ?? actual.renderAnthropicPlan)(...args),
  };
});

import {
  createMockLlmAnthropicFetchHandler,
  MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES,
  MOCK_LLM_ANTHROPIC_VERSION,
  type MockLlmAnthropicRuntime,
} from "./anthropic-http";
import { TEST_MODEL, textPlan } from "./test-support";

const CREDENTIAL = "synthetic-anthropic-provider-key";
const OTHER_CREDENTIAL = "synthetic-openai-provider-key";
const FIXED_IDENTITY = {
  requestId: "req_securityreview000000000000000",
  responseId: "msg_securityreview000000000000000",
};

const runtime = (
  models: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly createdAtEpochSeconds: number;
  }[] = [
    {
      id: TEST_MODEL,
      displayName: "Mock text",
      createdAtEpochSeconds: 1_785_000_000,
    },
  ]
): MockLlmAnthropicRuntime => ({
  getCatalog: vi.fn(async () => ({ ok: true as const, value: { models } })),
  planMessage: vi.fn(async () => ({
    ok: true as const,
    value: textPlan() as MockLlmPlan,
  })),
});

const handler = (providerRuntime: MockLlmAnthropicRuntime) =>
  createMockLlmAnthropicFetchHandler({
    runtime: providerRuntime,
    createIdentity: () => FIXED_IDENTITY,
  });

const providerHeaders = () => ({
  "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
  "x-api-key": CREDENTIAL,
});

const messageRequest = () =>
  new Request("https://mockos.test", {
    method: "POST",
    headers: {
      ...providerHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      model: TEST_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: "Hello" }],
    }),
  });

const responseJson = async (response: Response) =>
  (await response.json()) as {
    readonly type?: string;
    readonly error?: { readonly type?: string; readonly message?: string };
    readonly request_id?: string;
  };

afterEach(() => {
  securityRenderState.override = undefined;
  vi.clearAllMocks();
});

describe("mock Anthropic security boundary", () => {
  it("rejects combined credentials and version headers without dispatch", async () => {
    const duplicateCredentialHeaders = new Headers(providerHeaders());
    duplicateCredentialHeaders.append("x-api-key", OTHER_CREDENTIAL);
    const duplicateVersionHeaders = new Headers(providerHeaders());
    duplicateVersionHeaders.append("anthropic-version", MOCK_LLM_ANTHROPIC_VERSION);
    const cases = [
      {
        request: new Request("https://mockos.test", {
          headers: duplicateCredentialHeaders,
        }),
        status: 401,
      },
      {
        request: new Request("https://mockos.test", {
          headers: {
            ...providerHeaders(),
            "x-api-key": `${CREDENTIAL}, ${OTHER_CREDENTIAL}`,
          },
        }),
        status: 401,
      },
      {
        request: new Request("https://mockos.test", {
          headers: duplicateVersionHeaders,
        }),
        status: 400,
      },
      {
        request: new Request("https://mockos.test", {
          headers: {
            ...providerHeaders(),
            "anthropic-version": `${MOCK_LLM_ANTHROPIC_VERSION}, ${MOCK_LLM_ANTHROPIC_VERSION}`,
          },
        }),
        status: 400,
      },
      {
        request: new Request("https://mockos.test", {
          headers: {
            ...providerHeaders(),
            "anthropic-beta-preview": "true",
          },
        }),
        status: 400,
      },
    ] as const;
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);

    for (const testCase of cases) {
      const response = await fetch(testCase.request, {
        slug: "demo",
        providerPath: "/v1/models",
      });
      expect(response.status).toBe(testCase.status);
      const body = await responseJson(response);
      expect(body).toMatchObject({
        type: "error",
        request_id: FIXED_IDENTITY.requestId,
      });
      expect(JSON.stringify(body)).not.toContain(CREDENTIAL);
      expect(JSON.stringify(body)).not.toContain(OTHER_CREDENTIAL);
    }
    expect(providerRuntime.getCatalog).not.toHaveBeenCalled();
    expect(providerRuntime.planMessage).not.toHaveBeenCalled();
  });

  it("rejects traversal segments while resolving encoded model IDs exactly once", async () => {
    const providerRuntime = runtime();
    const fetch = handler(providerRuntime);
    for (const providerPath of [
      "/v1/models/%2E%2E",
      "/v1/models/%00",
      "/v1/models/%",
      "/v1/models/model/extra",
    ]) {
      const response = await fetch(
        new Request("https://mockos.test", { headers: providerHeaders() }),
        { slug: "demo", providerPath }
      );
      expect(response.status).toBe(404);
      expect(await responseJson(response)).toMatchObject({
        type: "error",
        error: { type: "not_found_error" },
      });
    }
    expect(providerRuntime.getCatalog).not.toHaveBeenCalled();

    const encodedModelRuntime = runtime([
      {
        id: "team/model",
        displayName: "Encoded model",
        createdAtEpochSeconds: 1_785_000_000,
      },
    ]);
    const exact = await handler(encodedModelRuntime)(
      new Request("https://mockos.test", { headers: providerHeaders() }),
      { slug: "demo", providerPath: "/v1/models/team%2Fmodel" }
    );
    expect(exact.status).toBe(200);
    expect(await exact.json()).toMatchObject({ id: "team/model", type: "model" });
    expect(encodedModelRuntime.getCatalog).toHaveBeenCalledTimes(1);
  });

  it("enforces the wire-size cap after rendering and returns a bounded safe error", async () => {
    securityRenderState.override = ((_plan, options) =>
      ({
        kind: "json",
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": options.requestId ?? FIXED_IDENTITY.requestId,
        },
        body: {
          type: "message",
          content: "x".repeat(MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES + 1),
        },
      }) satisfies RenderedLlmWire) as AnthropicRenderer;
    const providerRuntime = runtime();

    const response = await handler(providerRuntime)(messageRequest(), {
      slug: "demo",
      providerPath: "/v1/messages",
    });

    expect(response.status).toBe(500);
    const serialized = await response.text();
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(
      MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES
    );
    expect(JSON.parse(serialized)).toMatchObject({
      type: "error",
      error: {
        type: "api_error",
        message: "The mock Anthropic request could not be completed.",
      },
      request_id: FIXED_IDENTITY.requestId,
    });
    expect(serialized).not.toContain(CREDENTIAL);
    expect(providerRuntime.planMessage).toHaveBeenCalledTimes(1);
  });
});
