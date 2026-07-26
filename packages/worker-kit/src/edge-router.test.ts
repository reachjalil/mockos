import { parseMockLlmPlan } from "@mockos/contracts/mock-llm";
import type {
  MockLlmProviderObservationFinish,
  MockLlmProviderObservationStart,
} from "@mockos/llm-mock";
import { describe, expect, it, vi } from "vitest";
import { routeEnvironmentRequest } from "./edge-router";
import type { EnvironmentDurableObject } from "./environment-do";

const environmentId = "test-env_01";
const mockCredential = "synthetic-openai-provider-key";
const requestPath = `/e/${environmentId}/llm-mock/agent-tests/openai/v1/chat/completions`;

const plan = parseMockLlmPlan({
  version: 1,
  kind: "response",
  planId: `llmp_${"A".repeat(43)}`,
  requestHash: "b".repeat(64),
  model: "mockos-text-1",
  createdAtEpochSeconds: 1_785_000_000,
  turnIndex: 0,
  seed: "edge-router-observation-test",
  segments: [{ type: "text", text: "Hello from mockOS." }],
  stopReason: "end_turn",
  usage: { inputTokens: 11, outputTokens: 5 },
  cadence: {
    initialDelayMilliseconds: 0,
    chunkDelayMilliseconds: 0,
    chunkSize: 256,
    maximumDurationMilliseconds: 5_000,
  },
});

const chatRequest = (
  stream: boolean,
  options: { readonly credential?: string; readonly path?: string } = {}
) =>
  new Request(`https://mockos.example${options.path ?? requestPath}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.credential ?? mockCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mockos-text-1",
      messages: [{ role: "user", content: "Private prompt text" }],
      stream,
    }),
  });

const routingBindings = (rpc: object) => ({
  ENVIRONMENTS: {
    get: vi.fn(() => rpc),
    idFromName: vi.fn(() => ({ name: environmentId })),
  } as unknown as DurableObjectNamespace<EnvironmentDurableObject>,
});

describe("mock LLM edge observation integration", () => {
  it("reserves the exact selected revision and finalizes a cancelled stream", async () => {
    const reservations: Array<{
      observation: MockLlmProviderObservationStart;
      requestPath: string;
      serverRevision: number;
    }> = [];
    const finalizations: MockLlmProviderObservationFinish[] = [];
    const rpc = {
      getMockLlmOpenAiCatalog: vi.fn(),
      planMockLlmOpenAiChatCompletion: vi.fn(async () => ({
        ok: true as const,
        value: { plan, serverRevision: 7 },
      })),
      reserveMockLlmObservation: vi.fn(
        async (
          serverRevision: number,
          selectedRequestPath: string,
          observation: MockLlmProviderObservationStart
        ) => {
          reservations.push({
            observation,
            requestPath: selectedRequestPath,
            serverRevision,
          });
        }
      ),
      finalizeMockLlmObservation: vi.fn(
        async (observation: MockLlmProviderObservationFinish) => {
          finalizations.push(observation);
        }
      ),
    };
    const pending: Promise<void>[] = [];

    const response = await routeEnvironmentRequest(
      chatRequest(true),
      routingBindings(rpc),
      { hostingMode: "path" },
      { waitUntil: (promise) => pending.push(promise) }
    );
    expect(response?.status).toBe(200);
    const reader = response?.body?.getReader();
    if (!reader) throw new Error("Expected a mock LLM response stream.");
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel("consumer stopped");
    await Promise.all(pending);

    expect(reservations).toEqual([
      {
        serverRevision: 7,
        requestPath,
        observation: expect.objectContaining({
          dialect: "openai",
          operation: "chat.completions.create",
          slug: "agent-tests",
          method: "POST",
          path: "/chat/completions",
          model: "mockos-text-1",
          stream: true,
          turnIndex: 0,
          response: {
            inputTokens: 11,
            outputTokens: 5,
            stopReason: "end_turn",
            toolNames: [],
          },
        }),
      },
    ]);
    expect(reservations[0]?.observation).not.toHaveProperty("responseStatus");
    expect(reservations[0]?.observation).not.toHaveProperty("durationMilliseconds");
    expect(finalizations).toEqual([
      expect.objectContaining({
        observationId: reservations[0]?.observation.observationId,
        outcome: "cancelled",
        responseStatus: 200,
        durationMilliseconds: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(reservations)).not.toContain(mockCredential);
    expect(JSON.stringify(reservations)).not.toContain("Private prompt text");
    expect(JSON.stringify(reservations)).not.toContain("Hello from mockOS.");
  });

  it("keeps a valid provider response fail-open when reservation storage fails", async () => {
    const rpc = {
      getMockLlmOpenAiCatalog: vi.fn(),
      planMockLlmOpenAiChatCompletion: vi.fn(async () => ({
        ok: true as const,
        value: { plan, serverRevision: 9 },
      })),
      reserveMockLlmObservation: vi.fn(async () => {
        throw new Error("observation storage unavailable");
      }),
      finalizeMockLlmObservation: vi.fn(),
    };
    const waitUntil = vi.fn();

    const response = await routeEnvironmentRequest(
      chatRequest(false),
      routingBindings(rpc),
      { hostingMode: "path" },
      { waitUntil }
    );

    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      model: "mockos-text-1",
      choices: [{ message: { content: "Hello from mockOS." } }],
    });
    expect(rpc.reserveMockLlmObservation).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeMockLlmObservation).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("serves authenticated strict or accept-any calls without persisting colliding routed metadata", async () => {
    const collisionCases = [
      {
        credential: "chat.completions.create",
        path: requestPath,
        serverRevision: 10,
      },
      {
        credential: "credential-path-01",
        path: requestPath.replace(environmentId, "credential-path-01"),
        serverRevision: 11,
      },
      {
        credential: "9007199254740991",
        path: requestPath,
        serverRevision: 9_007_199_254_740_991,
      },
    ] as const;

    for (const collision of collisionCases) {
      const rpc = {
        getMockLlmOpenAiCatalog: vi.fn(),
        planMockLlmOpenAiChatCompletion: vi.fn(async () => ({
          ok: true as const,
          value: { plan, serverRevision: collision.serverRevision },
        })),
        reserveMockLlmObservation: vi.fn(),
        finalizeMockLlmObservation: vi.fn(),
      };

      const response = await routeEnvironmentRequest(
        chatRequest(false, collision),
        routingBindings(rpc),
        { hostingMode: "path" }
      );

      expect(response?.status, collision.credential).toBe(200);
      expect(await response?.json(), collision.credential).toMatchObject({
        choices: [{ message: { content: "Hello from mockOS." } }],
      });
      expect(
        rpc.reserveMockLlmObservation,
        collision.credential
      ).not.toHaveBeenCalled();
      expect(
        rpc.finalizeMockLlmObservation,
        collision.credential
      ).not.toHaveBeenCalled();
    }
  });
});

describe("mock MCP platform-credential containment", () => {
  it("marks a repeated-space platform Bearer before forwarding into the environment", async () => {
    const platformApiKey = `mk_${"p".repeat(32)}`;
    let forwardedRequest: Request | undefined;
    const rpc = {
      fetch: vi.fn(async (request: Request) => {
        forwardedRequest = request;
        return Response.json({ contained: true }, { status: 401 });
      }),
    };
    const request = new Request(
      `https://mockos.example/e/${environmentId}/mcp-mock/agent-tools`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer   ${platformApiKey}`,
        },
      }
    );

    const response = await routeEnvironmentRequest(
      request,
      {
        ...routingBindings(rpc),
        API_KEY: platformApiKey,
      },
      { hostingMode: "path" }
    );

    expect(response?.status).toBe(401);
    expect(rpc.fetch).toHaveBeenCalledTimes(1);
    expect(forwardedRequest?.headers.get("authorization")).toBe(
      `Bearer   ${platformApiKey}`
    );
    expect(forwardedRequest?.headers.get("x-mockos-redact-authorization")).toBe("true");
  });
});
