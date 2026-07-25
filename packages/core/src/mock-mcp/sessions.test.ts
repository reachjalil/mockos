import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  base64UrlDecode,
  FixedClock,
  MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER,
  MOCK_MCP_MAX_SESSION_PRUNE_BATCH_SIZE,
  MockMcpRepository,
  MockMcpRepositoryError,
  SeededRng,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
  sha256,
} from "../index";

class MemorySqlStore implements SqlStore {
  readonly database = new DatabaseSync(":memory:");
  #transactionDepth = 0;

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const result = this.database.prepare(sql).run(...(bindings as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[] {
    return this.database
      .prepare(sql)
      .all(...(bindings as SQLInputValue[])) as unknown as T[];
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined {
    return this.database.prepare(sql).get(...(bindings as SQLInputValue[])) as
      | T
      | undefined;
  }

  transaction<T>(callback: () => T): T {
    if (this.#transactionDepth > 0) return callback();
    this.database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth += 1;
    try {
      const value = callback();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  close(): void {
    this.database.close();
  }
}

const stores: MemorySqlStore[] = [];

const memoryStore = () => {
  const store = new MemorySqlStore();
  stores.push(store);
  applyMigrations(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const serverSpec = (
  text: string,
  slug = "agent",
  options: { readonly stateful?: boolean; readonly sessionTtlSeconds?: number } = {}
) => ({
  version: 1 as const,
  slug,
  serverInfo: { name: `Agent ${text}`, version: "1.0.0" },
  transport: {
    stateful: options.stateful ?? true,
    enableGet: false,
    sessionTtlSeconds: options.sessionTtlSeconds ?? 60,
  },
  tools: [],
});

const protocolVersion = "2025-11-25";

describe("mock MCP transport sessions", () => {
  it("returns a 32-byte base64url ID once and persists only its SHA-256 hash", async () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-24T08:00:00.000Z");
    const repository = new MockMcpRepository(
      store,
      clock,
      new SeededRng("mock-mcp-hash-only")
    );
    const server = repository.put(serverSpec("one"));

    const created = await repository.createSession({
      serverSlug: "agent",
      serverRevision: server.revision,
      protocolVersion,
    });

    expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(base64UrlDecode(created.sessionId)).toHaveLength(32);
    expect(created.session).toEqual({
      serverSlug: "agent",
      serverRevision: 1,
      protocolVersion,
      initialized: false,
      createdAt: "2026-07-24T08:00:00.000Z",
      expiresAt: "2026-07-24T08:01:00.000Z",
    });
    const persisted = store.get<{
      session_hash: string;
      server_slug: string;
      server_revision: number;
      protocol_version: string;
      initialized: number;
      created_at: string;
      expires_at: string;
      terminated_at: string | null;
    }>("SELECT * FROM mock_mcp_sessions");
    expect(persisted?.session_hash).toBe(await sha256(created.sessionId));
    expect(persisted?.session_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(persisted ?? {})).not.toContain(created.sessionId);

    const active = await repository.getSession({
      serverSlug: "agent",
      sessionId: created.sessionId,
      protocolVersion,
    });
    expect(active).toEqual({ status: "active", session: created.session });
    expect(JSON.stringify(active)).not.toContain(created.sessionId);
    expect(JSON.stringify(active)).not.toContain(persisted?.session_hash);

    const initialized = await repository.markInitialized({
      serverSlug: "agent",
      sessionId: created.sessionId,
      protocolVersion,
    });
    expect(initialized).toMatchObject({
      status: "active",
      session: { initialized: true },
    });
    expect(
      await repository.markInitialized({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual(initialized);
  });

  it("classifies foreign, malformed, version-mismatched, terminated, and expired IDs", async () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-24T09:00:00.000Z");
    const repository = new MockMcpRepository(
      store,
      clock,
      new SeededRng("mock-mcp-outcomes")
    );
    const server = repository.put(serverSpec("one"));
    repository.put(serverSpec("other", "other"));
    const created = await repository.createSession({
      serverSlug: "agent",
      serverRevision: server.revision,
      protocolVersion,
    });

    expect(
      await repository.getSession({
        serverSlug: "other",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "missing" });
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: "not-a-session",
        protocolVersion,
      })
    ).toEqual({ status: "missing" });
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion: "2026-01-01",
      })
    ).toEqual({ status: "protocol_version_mismatch" });
    expect(
      await repository.markInitialized({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion: "2026-01-01",
      })
    ).toEqual({ status: "protocol_version_mismatch" });
    expect(
      await repository.terminateSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion: "2026-01-01",
      })
    ).toEqual({ status: "protocol_version_mismatch" });
    expect(
      store.get<{ initialized: number; terminated_at: string | null }>(
        `SELECT initialized, terminated_at
         FROM mock_mcp_sessions
         WHERE server_slug = 'agent'`
      )
    ).toEqual({ initialized: 0, terminated_at: null });

    expect(
      await repository.terminateSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "terminated" });
    expect(
      await repository.terminateSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "already_terminated" });
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "terminated" });
    expect(repository.pruneSessions(1)).toBe(1);

    const expiring = await repository.createSession({
      serverSlug: "agent",
      serverRevision: server.revision,
      protocolVersion,
    });
    clock.advance(60_000);
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: expiring.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "expired" });
    expect(repository.pruneSessions(1)).toBe(1);
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: expiring.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "missing" });
  });

  it("keeps reset state-only and reports replaced-revision sessions as stale", async () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-24T10:00:00.000Z");
    const repository = new MockMcpRepository(
      store,
      clock,
      new SeededRng("mock-mcp-replacement")
    );
    const first = repository.put(serverSpec("one"));
    repository.writeState("agent", first.revision, "cursor", 1);
    const created = await repository.createSession({
      serverSlug: "agent",
      serverRevision: first.revision,
      protocolVersion,
    });

    expect(repository.resetState("agent")).toBe(1);
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toMatchObject({ status: "active" });

    clock.advance(1_000);
    repository.put(serverSpec("two"));
    expect(
      await repository.getSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "stale" });
    expect(
      await repository.terminateSession({
        serverSlug: "agent",
        sessionId: created.sessionId,
        protocolVersion,
      })
    ).toEqual({ status: "stale" });
  });

  it("rejects issuance atomically when the rendered server revision was replaced", async () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(
      store,
      new FixedClock("2026-07-24T11:00:00.000Z"),
      new SeededRng("mock-mcp-issuance-race")
    );
    const first = repository.put(serverSpec("one"));
    const pending = repository.createSession({
      serverSlug: "agent",
      serverRevision: first.revision,
      protocolVersion,
    });
    repository.put(serverSpec("two"));

    await expect(pending).rejects.toMatchObject({
      code: "server_revision_mismatch",
    });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM mock_mcp_sessions")
        ?.count
    ).toBe(0);
  });

  it("enforces the active-session cap under concurrent issuance and reuses terminated capacity", async () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(
      store,
      new FixedClock("2026-07-24T12:00:00.000Z"),
      new SeededRng("mock-mcp-concurrent-cap")
    );
    const server = repository.put(serverSpec("one"));
    const results = await Promise.allSettled(
      Array.from({ length: MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER + 1 }, async () =>
        repository.createSession({
          serverSlug: "agent",
          serverRevision: server.revision,
          protocolVersion,
        })
      )
    );
    const created = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const rejected = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    expect(created).toHaveLength(MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(MockMcpRepositoryError);
    expect(rejected[0]).toMatchObject({ code: "session_limit" });
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM mock_mcp_sessions
         WHERE terminated_at IS NULL`
      )?.count
    ).toBe(MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER);

    const firstCreated = created[0];
    if (!firstCreated) throw new Error("Expected at least one created session.");
    await repository.terminateSession({
      serverSlug: "agent",
      sessionId: firstCreated.sessionId,
      protocolVersion,
    });
    await expect(
      repository.createSession({
        serverSlug: "agent",
        serverRevision: server.revision,
        protocolVersion,
      })
    ).resolves.toMatchObject({ session: { serverRevision: server.revision } });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM mock_mcp_sessions")
        ?.count
    ).toBe(MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER);
  });

  it("bounds every explicit prune pass", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-24T13:00:00.000Z");
    const repository = new MockMcpRepository(store, clock);
    repository.put(serverSpec("one"));
    for (let index = 0; index < 7; index += 1) {
      store.run(
        `INSERT INTO mock_mcp_sessions (
          session_hash, server_slug, server_revision, protocol_version,
          initialized, created_at, expires_at, terminated_at
        ) VALUES (?, 'agent', 1, ?, 0, ?, ?, ?)`,
        index.toString(16).padStart(64, "0"),
        protocolVersion,
        "2026-07-24T11:00:00.000Z",
        index < 4 ? "2026-07-24T12:00:00.000Z" : "2026-07-24T14:00:00.000Z",
        index < 4 ? null : "2026-07-24T12:30:00.000Z"
      );
    }

    expect(repository.pruneSessions(3)).toBe(3);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM mock_mcp_sessions")
        ?.count
    ).toBe(4);
    expect(() => repository.pruneSessions(0)).toThrow(MockMcpRepositoryError);
    expect(() =>
      repository.pruneSessions(MOCK_MCP_MAX_SESSION_PRUNE_BATCH_SIZE + 1)
    ).toThrow(MockMcpRepositoryError);
  });

  it("refuses to issue stateful sessions for stateless server specs", async () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const server = repository.put(
      serverSpec("stateless", "stateless", { stateful: false })
    );
    await expect(
      repository.createSession({
        serverSlug: "stateless",
        serverRevision: server.revision,
        protocolVersion,
      })
    ).rejects.toMatchObject({ code: "sessions_disabled" });
  });
});
