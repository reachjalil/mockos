import { MOCK_MCP_PROTOCOL_VERSION } from "@mockos/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createTestHarness,
  endpoint,
  initialize,
  post,
  rpc,
  send,
  serverRecord,
  textToolResult,
} from "./test-support";

const resultBody = async (response: Response) =>
  (await response.json()) as {
    id: string | number | null;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };

describe("mock MCP raw Streamable HTTP wire", () => {
  it("enforces same-origin, media negotiation, and bearer authentication", async () => {
    const authenticateBearer = vi.fn(({ token }) => token === "mock-token-123456");
    const harness = createTestHarness(
      serverRecord({
        authentication: {
          mode: "bearer",
          tokenSha256: "a".repeat(64),
        },
      }),
      { authenticateBearer }
    );
    const initializeBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "wire-test", version: "1" },
      },
    };

    const crossOrigin = await send(
      harness,
      post(initializeBody, {
        Authorization: "Bearer mock-token-123456",
        Origin: "https://attacker.test",
      })
    );
    expect(crossOrigin.status).toBe(403);
    expect(authenticateBearer).not.toHaveBeenCalled();

    const wrongContentType = await send(
      harness,
      new Request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer mock-token-123456",
          "Content-Type": "text/plain",
        },
        body: JSON.stringify(initializeBody),
      })
    );
    expect(wrongContentType.status).toBe(415);

    const wrongAccept = await send(
      harness,
      post(initializeBody, {
        Accept: "application/json",
        Authorization: "Bearer mock-token-123456",
      })
    );
    expect(wrongAccept.status).toBe(406);

    const missingCredential = await send(harness, post(initializeBody));
    expect(missingCredential.status).toBe(401);
    expect(missingCredential.headers.get("WWW-Authenticate")).toBe("Bearer");

    const accepted = await send(
      harness,
      post(initializeBody, {
        Authorization: "Bearer mock-token-123456",
        Origin: "https://mockos.test",
      })
    );
    expect(accepted.status).toBe(200);
    expect(authenticateBearer).toHaveBeenCalledTimes(3);
    expect(authenticateBearer.mock.calls.at(-1)?.[0]).toMatchObject({
      token: "mock-token-123456",
    });
    expect(harness.observations.at(-1)).toMatchObject({
      httpStatus: 200,
      sessionPresent: false,
      mcpMethod: "initialize",
    });
    expect(JSON.stringify(harness.observations)).not.toContain("mock-token");
  });

  it("does not initialize a stale stateless revision after asynchronous authentication", async () => {
    let authenticationStarted!: () => void;
    let releaseAuthentication!: () => void;
    const started = new Promise<void>((resolve) => {
      authenticationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthentication = resolve;
    });
    const harness = createTestHarness(
      serverRecord({
        transport: { stateful: false },
        authentication: {
          mode: "bearer",
          tokenSha256: "b".repeat(64),
        },
      }),
      {
        authenticateBearer: async () => {
          authenticationStarted();
          await gate;
          return true;
        },
      }
    );

    const pending = send(
      harness,
      post(
        {
          jsonrpc: "2.0",
          id: "stale-init",
          method: "initialize",
          params: {
            protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "wire-test", version: "1" },
          },
        },
        { Authorization: "Bearer mock-token-123456" }
      )
    );
    await started;
    harness.repository.serverRevisions.set(
      harness.server.spec.slug,
      harness.server.revision + 1
    );
    releaseAuthentication();

    const response = await pending;
    expect(response.status).toBe(409);
    expect((await resultBody(response)).error?.message).toBe(
      "The mock MCP server changed while the request was in progress."
    );
    expect(response.headers.get("MCP-Session-Id")).toBeNull();
  });

  it.each([
    {
      name: "initialize validation error",
      request: () =>
        post(
          {
            jsonrpc: "2.0",
            id: "stale-invalid-init",
            method: "initialize",
            params: {
              protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: {},
            },
          },
          { Authorization: "Bearer mock-token-123456" }
        ),
    },
    {
      name: "transport negotiation error",
      request: () =>
        post(
          {
            jsonrpc: "2.0",
            id: "stale-invalid-accept",
            method: "initialize",
            params: {
              protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "wire-test", version: "1" },
            },
          },
          {
            Accept: "application/json",
            Authorization: "Bearer mock-token-123456",
          }
        ),
    },
  ])(
    "replaces a stale $name after asynchronous authentication with 409",
    async ({ request }) => {
      let authenticationStarted!: () => void;
      let releaseAuthentication!: () => void;
      const started = new Promise<void>((resolve) => {
        authenticationStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseAuthentication = resolve;
      });
      const harness = createTestHarness(
        serverRecord({
          transport: { stateful: false },
          authentication: {
            mode: "bearer",
            tokenSha256: "c".repeat(64),
          },
        }),
        {
          authenticateBearer: async () => {
            authenticationStarted();
            await gate;
            return true;
          },
        }
      );

      const pending = send(harness, request());
      await started;
      harness.repository.serverRevisions.set(
        harness.server.spec.slug,
        harness.server.revision + 1
      );
      releaseAuthentication();

      const response = await pending;
      expect(response.status).toBe(409);
      expect((await resultBody(response)).error).toEqual({
        code: -32_001,
        message: "The mock MCP server changed while the request was in progress.",
      });
      expect(response.headers.get("MCP-Session-Id")).toBeNull();
    }
  );

  it("keeps asynchronous observation outside the response revision window", async () => {
    let observationStarted!: () => void;
    let releaseObservation!: () => void;
    const started = new Promise<void>((resolve) => {
      observationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    const observations: Array<{ readonly httpStatus: number }> = [];
    const scheduled: Promise<void>[] = [];
    const harness = createTestHarness(
      serverRecord({ transport: { stateful: false } }),
      {
        observe: async (observation) => {
          observations.push(observation);
          observationStarted();
          await gate;
        },
        waitUntil: (promise) => {
          scheduled.push(promise);
        },
      }
    );

    const pending = send(
      harness,
      post({
        jsonrpc: "2.0",
        id: "async-observation",
        method: "initialize",
        params: {
          protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "wire-test", version: "1" },
        },
      })
    );
    await started;
    expect(scheduled).toHaveLength(1);
    harness.repository.serverRevisions.set(
      harness.server.spec.slug,
      harness.server.revision + 1
    );

    const response = await pending;
    expect(response.status).toBe(200);
    expect((await resultBody(response)).result?.protocolVersion).toBe(
      MOCK_MCP_PROTOCOL_VERSION
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ httpStatus: 200 });

    releaseObservation();
    await Promise.all(scheduled);
  });

  it("implements initialize, request metadata, ping, GET fallback, and DELETE", async () => {
    const harness = createTestHarness();
    const initializeResponse = await send(
      harness,
      post({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
          protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "wire-test", version: "1" },
          _meta: { trace: "synthetic-initialize" },
        },
      })
    );
    expect(initializeResponse.status).toBe(200);
    const sessionId = initializeResponse.headers.get("MCP-Session-Id");
    expect(sessionId).toBeTruthy();
    expect(await resultBody(initializeResponse)).toMatchObject({
      id: "init",
      result: {
        protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
      },
    });

    const beforeInitialized = await rpc(
      harness,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      sessionId ?? undefined
    );
    expect(beforeInitialized.status).toBe(200);
    expect((await resultBody(beforeInitialized)).error?.code).toBe(-32_002);

    const initialized = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: { _meta: { trace: "synthetic-initialized" } },
      },
      sessionId ?? undefined
    );
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");

    const ping = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "ping",
        params: { _meta: { trace: "synthetic-ping" } },
      },
      sessionId ?? undefined
    );
    expect(await resultBody(ping)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {},
    });

    const missingVersion = await send(
      harness,
      post(
        { jsonrpc: "2.0", id: 4, method: "ping" },
        { "MCP-Session-Id": sessionId ?? "" }
      )
    );
    expect(missingVersion.status).toBe(400);

    const get = await send(harness, new Request(endpoint));
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST, DELETE");

    const statelessHarness = createTestHarness(
      serverRecord({ transport: { stateful: false } })
    );
    const statelessGet = await send(statelessHarness, new Request(endpoint));
    expect(statelessGet.status).toBe(405);
    expect(statelessGet.headers.get("Allow")).toBe("POST");
    expect((await resultBody(statelessGet)).error?.message).toBe(
      "This mock MCP endpoint supports POST."
    );

    const deleted = await send(
      harness,
      new Request(endpoint, {
        method: "DELETE",
        headers: {
          "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
          "MCP-Session-Id": sessionId ?? "",
        },
      })
    );
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    const repeatedDelete = await send(
      harness,
      new Request(endpoint, {
        method: "DELETE",
        headers: {
          "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
          "MCP-Session-Id": sessionId ?? "",
        },
      })
    );
    expect(repeatedDelete.status).toBe(404);

    const stale = await rpc(
      harness,
      { jsonrpc: "2.0", id: 5, method: "ping" },
      sessionId ?? undefined
    );
    expect(stale.status).toBe(404);
  });

  it("rejects batches and malformed messages without accepting extra frames", async () => {
    const evaluateBehavior = vi.fn(async () => {
      throw new Error("Behavior evaluation must not run for an invalid message.");
    });
    const harness = createTestHarness(serverRecord(), { evaluateBehavior });

    const batch = await send(
      harness,
      post([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }])
    );
    expect(batch.status).toBe(400);
    expect((await resultBody(batch)).error?.code).toBe(-32_600);

    const malformed = await send(
      harness,
      new Request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: "{",
      })
    );
    expect(malformed.status).toBe(400);
    expect((await resultBody(malformed)).error?.code).toBe(-32_700);

    const nonFiniteNumber = await send(
      harness,
      new Request(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"never","arguments":{"value":1e400}}}',
      })
    );
    expect(nonFiniteNumber.status).toBe(400);
    expect((await resultBody(nonFiniteNumber)).error?.code).toBe(-32_600);
    expect(evaluateBehavior).not.toHaveBeenCalled();
    expect(harness.observations.at(-1)).not.toHaveProperty("mcpMethod");
    expect(harness.observations.at(-1)).not.toHaveProperty("mcpArguments");

    const { sessionId } = await initialize(harness);
    const emptyStringId = await rpc(
      harness,
      { jsonrpc: "2.0", id: "", method: "ping" },
      sessionId
    );
    expect(await resultBody(emptyStringId)).toEqual({
      jsonrpc: "2.0",
      id: "",
      result: {},
    });

    const unknown = await rpc(
      harness,
      { jsonrpc: "2.0", id: 8, method: "unknown/method" },
      sessionId
    );
    expect(unknown.status).toBe(200);
    expect((await resultBody(unknown)).error?.code).toBe(-32_601);

    const ignoredNotification = await rpc(
      harness,
      { jsonrpc: "2.0", method: "notifications/cancelled", params: {} },
      sessionId
    );
    expect(ignoredNotification.status).toBe(202);
  });

  it("paginates every list with revision- and session-bound opaque cursors", async () => {
    const staticBehavior = {
      version: 1,
      type: "static",
      value: textToolResult("ok"),
    } as const;
    const harness = createTestHarness(
      serverRecord({
        pageSize: 1,
        tools: [
          { name: "first", behavior: staticBehavior },
          { name: "second", behavior: staticBehavior },
        ],
        resources: [
          {
            uri: "mockos://fixed/first",
            name: "first",
            behavior: {
              version: 1,
              type: "static",
              value: {
                contents: [{ uri: "mockos://fixed/first", text: "first" }],
              },
            },
          },
          {
            uri: "mockos://fixed/second",
            name: "second",
            behavior: {
              version: 1,
              type: "static",
              value: {
                contents: [{ uri: "mockos://fixed/second", text: "second" }],
              },
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
              template: "user {{variables.id}}",
            },
          },
          {
            uriTemplate: "mockos://groups/{id}",
            name: "group",
            behavior: {
              version: 1,
              type: "template",
              template: "group {{variables.id}}",
            },
          },
        ],
        prompts: [
          { name: "first", behavior: staticBehavior },
          { name: "second", behavior: staticBehavior },
        ],
      })
    );
    const firstSession = await initialize(harness);

    const firstPage = await rpc(
      harness,
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
      firstSession.sessionId
    );
    const firstPageBody = await resultBody(firstPage);
    expect(firstPageBody.result?.tools).toEqual([
      expect.objectContaining({ name: "first" }),
    ]);
    expect(JSON.stringify(firstPageBody)).not.toContain("behavior");
    const cursor = firstPageBody.result?.nextCursor;
    expect(cursor).toEqual(expect.any(String));

    const secondPage = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/list",
        params: { cursor },
      },
      firstSession.sessionId
    );
    expect((await resultBody(secondPage)).result?.tools).toEqual([
      expect.objectContaining({ name: "second" }),
    ]);

    const secondSession = await initialize(harness);
    const foreignCursor = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/list",
        params: { cursor },
      },
      secondSession.sessionId
    );
    expect((await resultBody(foreignCursor)).error?.code).toBe(-32_602);

    for (const [id, method, resultKey] of [
      [13, "resources/list", "resources"],
      [14, "resources/templates/list", "resourceTemplates"],
      [15, "prompts/list", "prompts"],
    ] as const) {
      const response = await rpc(
        harness,
        { jsonrpc: "2.0", id, method },
        firstSession.sessionId
      );
      const body = await resultBody(response);
      expect(body.result?.[resultKey]).toHaveLength(1);
      expect(body.result?.nextCursor).toEqual(expect.any(String));
    }
  });
});
