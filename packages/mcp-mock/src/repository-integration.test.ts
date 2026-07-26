import { MOCK_MCP_PROTOCOL_VERSION, type MockMcpServerRecord } from "@mockos/contracts";
import {
  applyMigrations,
  evaluateBehavior,
  MOCK_MCP_MAX_STATE_ROWS_PER_SERVER,
  MockMcpRepository,
} from "@mockos/core";
import { NodeSqlStore } from "@mockos/testkit";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMockMcpFetchHandler,
  MOCK_MCP_STATE_CAPACITY,
  type MockMcpBehaviorEvaluator,
  type MockMcpFetchHandler,
} from "./index";
import { endpoint, post, serverRecord, textToolResult } from "./test-support";

type RealRepositoryHarness = {
  readonly handler: MockMcpFetchHandler;
  readonly repository: MockMcpRepository;
  readonly server: MockMcpServerRecord;
};

type RpcBody = {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
};

const stores: NodeSqlStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const createRealRepositoryHarness = (
  serverInput: Readonly<Record<string, unknown>> = {},
  evaluator?: MockMcpBehaviorEvaluator
): RealRepositoryHarness => {
  const store = new NodeSqlStore();
  stores.push(store);
  applyMigrations(store);
  const repository = new MockMcpRepository(store);
  const server = repository.put(serverRecord(serverInput).spec, null);
  const handler = createMockMcpFetchHandler({
    repository,
    observe: () => {},
    ...(evaluator === undefined ? {} : { evaluateBehavior: evaluator }),
  });
  return { handler, repository, server };
};

const initializeRealRepositoryHarness = async (
  harness: RealRepositoryHarness
): Promise<string> => {
  const initialized = await harness.handler(
    post({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: {
        protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "repository-test", version: "1" },
      },
    }),
    { server: harness.server }
  );
  expect(initialized.status).toBe(200);
  const sessionId = initialized.headers.get("MCP-Session-Id");
  expect(sessionId).toEqual(expect.any(String));

  const notification = await harness.handler(
    post(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      {
        "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
        "MCP-Session-Id": sessionId ?? "",
      }
    ),
    { server: harness.server }
  );
  expect(notification.status).toBe(202);
  return sessionId ?? "";
};

const deleteSession = (
  harness: RealRepositoryHarness,
  sessionId: string
): Promise<Response> =>
  harness.handler(
    new Request(endpoint, {
      method: "DELETE",
      headers: {
        "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
        "MCP-Session-Id": sessionId,
      },
    }),
    { server: harness.server }
  );

const readTemplateResource = (
  harness: RealRepositoryHarness,
  sessionId: string,
  id: string,
  requestId: number
): Promise<Response> =>
  harness.handler(
    post(
      {
        jsonrpc: "2.0",
        id: requestId,
        method: "resources/read",
        params: { uri: `mockos://state/${id}` },
      },
      {
        "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
        "MCP-Session-Id": sessionId,
      }
    ),
    { server: harness.server }
  );

const statefulTemplateServer = {
  resourceTemplates: [
    {
      uriTemplate: "mockos://state/{id}",
      name: "state",
      behavior: {
        version: 1,
        type: "sequence",
        mode: "loop",
        steps: [
          {
            version: 1,
            type: "static",
            value: "bounded state",
          },
        ],
      },
    },
  ],
} as const;

describe("mock MCP adapter with the durable repository", () => {
  it("rejects delete-recreate during authentication without issuing a stale session", async () => {
    const store = new NodeSqlStore();
    stores.push(store);
    applyMigrations(store);
    const repository = new MockMcpRepository(store);
    const oldServer = repository.put(
      serverRecord({
        serverInfo: { name: "Old definition", version: "1.0.0" },
        authentication: {
          mode: "bearer",
          tokenSha256: "a".repeat(64),
        },
      }).spec,
      null
    );
    let authenticationStarted!: () => void;
    let releaseAuthentication!: () => void;
    const started = new Promise<void>((resolve) => {
      authenticationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthentication = resolve;
    });
    const handler = createMockMcpFetchHandler({
      repository,
      authenticateBearer: async () => {
        authenticationStarted();
        await gate;
        return true;
      },
      observe: () => {},
    });
    const pending = handler(
      post(
        {
          jsonrpc: "2.0",
          id: "delete-recreate",
          method: "initialize",
          params: {
            protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "repository-test", version: "1" },
          },
        },
        { Authorization: "Bearer old-mock-credential" }
      ),
      { server: oldServer }
    );

    await started;
    expect(repository.delete(oldServer.spec.slug, oldServer.revision)).toBe(true);
    const recreated = repository.put(
      serverRecord({
        serverInfo: { name: "New definition", version: "2.0.0" },
        authentication: {
          mode: "bearer",
          tokenSha256: "b".repeat(64),
        },
      }).spec,
      null
    );
    expect(recreated.revision).toBeGreaterThan(oldServer.revision);
    releaseAuthentication();

    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.headers.get("MCP-Session-Id")).toBeNull();
    expect((await response.json()) as RpcBody).toMatchObject({
      error: {
        code: -32_001,
        message: "The mock MCP server changed while the request was in progress.",
      },
    });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM mock_mcp_sessions")
        ?.count
    ).toBe(0);
  });

  it("does not commit old-generation behavior state into a recreated server", async () => {
    const store = new NodeSqlStore();
    stores.push(store);
    applyMigrations(store);
    const repository = new MockMcpRepository(store);
    const generationServer = (text: string) =>
      serverRecord({
        transport: { stateful: false },
        tools: [
          {
            name: "generation",
            behavior: {
              version: 1,
              type: "sequence",
              mode: "loop",
              steps: [
                {
                  version: 1,
                  type: "static",
                  value: textToolResult(text),
                },
              ],
            },
          },
        ],
      });
    const oldServer = repository.put(generationServer("old generation").spec, null);
    let evaluationStarted!: () => void;
    let releaseEvaluation!: () => void;
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    let blockNextEvaluation = true;
    const evaluator: MockMcpBehaviorEvaluator = async (behavior, context) => {
      const plan = await evaluateBehavior(behavior, context);
      if (blockNextEvaluation) {
        blockNextEvaluation = false;
        evaluationStarted();
        await gate;
      }
      return plan;
    };
    const handler = createMockMcpFetchHandler({
      repository,
      evaluateBehavior: evaluator,
      observe: () => {},
    });
    const call = (server: MockMcpServerRecord, id: string) =>
      handler(
        post(
          {
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name: "generation", arguments: {} },
          },
          { "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION }
        ),
        { server }
      );
    const pending = call(oldServer, "old-call");

    await started;
    expect(repository.delete(oldServer.spec.slug, oldServer.revision)).toBe(true);
    const recreated = repository.put(generationServer("new generation").spec, null);
    releaseEvaluation();

    const staleResponse = await pending;
    expect(staleResponse.status).toBe(409);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM mock_state")?.count
    ).toBe(0);

    const currentResponse = await call(recreated, "new-call");
    expect(currentResponse.status).toBe(200);
    expect((await currentResponse.json()) as RpcBody).toMatchObject({
      result: textToolResult("new generation"),
    });
    expect(
      store.all<{ server_revision: number }>(
        "SELECT DISTINCT server_revision FROM mock_state"
      )
    ).toEqual([{ server_revision: recreated.revision }]);
  });

  it("returns 404 when a real persisted session is deleted more than once", async () => {
    const harness = createRealRepositoryHarness();
    const sessionId = await initializeRealRepositoryHarness(harness);

    expect((await deleteSession(harness, sessionId)).status).toBe(204);
    const repeated = await deleteSession(harness, sessionId);
    expect(repeated.status).toBe(404);
    expect((await repeated.json()) as RpcBody).toMatchObject({
      error: {
        message: "The MCP session is missing, expired, stale, or terminated.",
      },
    });
  });

  it("returns the stable capacity error after sequential template expansion fills state", async () => {
    const harness = createRealRepositoryHarness(statefulTemplateServer);
    const sessionId = await initializeRealRepositoryHarness(harness);

    for (let index = 0; index < MOCK_MCP_MAX_STATE_ROWS_PER_SERVER; index += 1) {
      const response = await readTemplateResource(
        harness,
        sessionId,
        `sequential-${index}`,
        index + 1
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as RpcBody).error).toBeUndefined();
    }

    const overCapacity = await readTemplateResource(
      harness,
      sessionId,
      "sequential-over-capacity",
      MOCK_MCP_MAX_STATE_ROWS_PER_SERVER + 1
    );
    expect(overCapacity.status).toBe(200);
    expect((await overCapacity.json()) as RpcBody).toMatchObject({
      error: {
        code: MOCK_MCP_STATE_CAPACITY,
        message: "Mock MCP application state capacity reached.",
      },
    });
  });

  it("admits only one of two concurrent expansions at the final state slot", async () => {
    const candidates = new Set([
      "mockos://state/concurrent-a",
      "mockos://state/concurrent-b",
    ]);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const evaluator: MockMcpBehaviorEvaluator = async (behavior, context) => {
      const plan = await evaluateBehavior(behavior, context);
      const uri = context.input.uri;
      if (typeof uri === "string" && candidates.has(uri)) {
        arrivals += 1;
        if (arrivals === candidates.size) release();
        await barrier;
      }
      return plan;
    };
    const harness = createRealRepositoryHarness(statefulTemplateServer, evaluator);
    const sessionId = await initializeRealRepositoryHarness(harness);

    for (let index = 0; index < MOCK_MCP_MAX_STATE_ROWS_PER_SERVER - 1; index += 1) {
      const response = await readTemplateResource(
        harness,
        sessionId,
        `concurrent-prefill-${index}`,
        index + 1
      );
      expect(((await response.json()) as RpcBody).error).toBeUndefined();
    }

    const responses = await Promise.all([
      readTemplateResource(
        harness,
        sessionId,
        "concurrent-a",
        MOCK_MCP_MAX_STATE_ROWS_PER_SERVER
      ),
      readTemplateResource(
        harness,
        sessionId,
        "concurrent-b",
        MOCK_MCP_MAX_STATE_ROWS_PER_SERVER + 1
      ),
    ]);
    const bodies = await Promise.all(
      responses.map(async (response) => (await response.json()) as RpcBody)
    );
    expect(arrivals).toBe(2);
    expect(bodies.filter((body) => body.result !== undefined)).toHaveLength(1);
    expect(
      bodies.filter(
        (body) =>
          body.error?.code === MOCK_MCP_STATE_CAPACITY &&
          body.error.message === "Mock MCP application state capacity reached."
      )
    ).toHaveLength(1);
  });
});
