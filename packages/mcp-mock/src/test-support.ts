import {
  MOCK_MCP_PROTOCOL_VERSION,
  type MockMcpServerRecord,
  parseMockMcpServerSpec,
} from "@mockos/contracts";
import type { JsonValue } from "@mockos/contracts/behavior";
import type {
  CreatedMockMcpSession,
  CreateMockMcpSessionInput,
  LookupMockMcpSessionInput,
  MockMcpSession,
  MockMcpSessionLookupResult,
  MockMcpSessionTerminationResult,
} from "@mockos/core";
import {
  createMockMcpFetchHandler,
  type MockMcpFetchDependencies,
  type MockMcpFetchHandler,
  type MockMcpObservation,
  type MockMcpRepositoryDependencies,
} from "./index";

const CREATED_AT = "2026-07-24T10:00:00.000Z";

export const textToolResult = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

export const serverRecord = (
  input: Readonly<Record<string, unknown>> = {}
): MockMcpServerRecord => ({
  spec: parseMockMcpServerSpec({
    version: 1,
    slug: "test-server",
    serverInfo: { name: "Test server", version: "1.0.0" },
    ...input,
  }),
  revision: 7,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

type StoredSession = MockMcpSession & { terminated: boolean };

export class MemoryMockMcpRepository implements MockMcpRepositoryDependencies {
  readonly state = new Map<string, JsonValue>();
  readonly sessions = new Map<string, StoredSession>();
  readonly serverRevisions = new Map<string, number>();
  commits = 0;
  nextSession = 1;

  assertServerRevision(serverSlug: string, expectedRevision: number): void {
    if (this.serverRevisions.get(serverSlug) !== expectedRevision) {
      const error = new Error("Server revision mismatch.") as Error & {
        code: string;
      };
      error.code = "server_revision_mismatch";
      throw error;
    }
  }

  readState(
    serverSlug: string,
    serverRevision: number,
    key: string
  ): JsonValue | undefined {
    return this.state.get(`${serverSlug}:${serverRevision}:${key}`);
  }

  writeState(
    serverSlug: string,
    serverRevision: number,
    key: string,
    value: JsonValue
  ): void {
    this.assertServerRevision(serverSlug, serverRevision);
    this.commits += 1;
    this.state.set(`${serverSlug}:${serverRevision}:${key}`, value);
  }

  transaction<Value>(callback: () => Value): Value {
    return callback();
  }

  async createSession(
    input: CreateMockMcpSessionInput
  ): Promise<CreatedMockMcpSession> {
    this.assertServerRevision(input.serverSlug, input.serverRevision);
    const sessionId = `session_${String(this.nextSession).padStart(4, "0")}`;
    this.nextSession += 1;
    const session: StoredSession = {
      serverSlug: input.serverSlug,
      serverRevision: input.serverRevision,
      protocolVersion: input.protocolVersion,
      initialized: false,
      createdAt: CREATED_AT,
      expiresAt: "2026-07-24T11:00:00.000Z",
      terminated: false,
    };
    this.sessions.set(sessionId, session);
    return { sessionId, session };
  }

  async getSession(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionLookupResult> {
    return this.lookup(input);
  }

  async markInitialized(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionLookupResult> {
    const result = this.lookup(input);
    if (result.status !== "active") return result;
    const session = { ...result.session, initialized: true, terminated: false };
    this.sessions.set(input.sessionId, session);
    return { status: "active", session };
  }

  async terminateSession(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionTerminationResult> {
    const result = this.lookup(input);
    if (result.status === "terminated") return { status: "already_terminated" };
    if (result.status !== "active") return result;
    this.sessions.set(input.sessionId, {
      ...result.session,
      terminated: true,
    });
    return { status: "terminated" };
  }

  private lookup(input: LookupMockMcpSessionInput): MockMcpSessionLookupResult {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.serverSlug !== input.serverSlug) {
      return { status: "missing" };
    }
    if (session.protocolVersion !== input.protocolVersion) {
      return { status: "protocol_version_mismatch" };
    }
    if (session.terminated) return { status: "terminated" };
    return { status: "active", session };
  }
}

export type TestHarness = {
  readonly handler: MockMcpFetchHandler;
  readonly observations: MockMcpObservation[];
  readonly repository: MemoryMockMcpRepository;
  readonly server: MockMcpServerRecord;
};

export const createTestHarness = (
  server = serverRecord(),
  overrides: Partial<MockMcpFetchDependencies> = {}
): TestHarness => {
  const repository =
    overrides.repository instanceof MemoryMockMcpRepository
      ? overrides.repository
      : new MemoryMockMcpRepository();
  const observations: MockMcpObservation[] = [];
  repository.serverRevisions.set(server.spec.slug, server.revision);
  const handler = createMockMcpFetchHandler({
    repository,
    observe: (observation) => {
      observations.push(observation);
    },
    ...overrides,
  });
  return { handler, observations, repository, server };
};

export const endpoint = "https://mockos.test/mcp-mock/test-server";

export const post = (
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  signal?: AbortSignal
): Request =>
  new Request(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

export const send = (harness: TestHarness, request: Request): Promise<Response> =>
  harness.handler(request, { server: harness.server });

export const initialize = async (
  harness: TestHarness
): Promise<{ readonly sessionId?: string; readonly body: Record<string, unknown> }> => {
  const response = await send(
    harness,
    post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })
  );
  if (response.status !== 200) {
    throw new Error(`Initialize failed with HTTP ${response.status}.`);
  }
  const sessionId = response.headers.get("MCP-Session-Id") ?? undefined;
  const body = (await response.json()) as Record<string, unknown>;
  if (harness.server.spec.transport.stateful) {
    if (!sessionId) throw new Error("Initialize omitted its session id.");
    const initialized = await send(
      harness,
      post(
        {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        },
        {
          "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
          "MCP-Session-Id": sessionId,
        }
      )
    );
    if (initialized.status !== 202) {
      throw new Error(
        `Initialized notification failed with HTTP ${initialized.status}.`
      );
    }
  }
  return { sessionId, body };
};

export const rpc = (
  harness: TestHarness,
  body: unknown,
  sessionId?: string,
  signal?: AbortSignal
): Promise<Response> =>
  send(
    harness,
    post(
      body,
      {
        "MCP-Protocol-Version": MOCK_MCP_PROTOCOL_VERSION,
        ...(sessionId === undefined ? {} : { "MCP-Session-Id": sessionId }),
      },
      signal
    )
  );
