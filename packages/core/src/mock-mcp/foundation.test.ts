import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MOCK_MCP_MAX_SERVERS } from "@mockos/contracts";
import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  type BehaviorStateAccess,
  BehaviorStateConflictError,
  evaluateBehavior,
  FixedClock,
  MOCK_MCP_MAX_STATE_BYTES_PER_SERVER,
  MOCK_MCP_MAX_STATE_ROWS_PER_SERVER,
  MockMcpRepository,
  MockMcpRepositoryError,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
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

const serverSpec = (text: string) => ({
  version: 1 as const,
  slug: "agent",
  serverInfo: { name: "Agent", version: "1.0.0" },
  tools: [
    {
      name: "ping_agent",
      behavior: {
        version: 1 as const,
        type: "static" as const,
        value: { content: [{ type: "text", text }] },
      },
    },
  ],
});

describe("mock MCP persistence", () => {
  it("revisions replacements atomically and invalidates old state and sessions", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-23T12:00:00.000Z");
    const repository = new MockMcpRepository(store, clock);
    const first = repository.put(serverSpec("one"), null);
    repository.writeState("agent", first.revision, "sequence:tool", 2);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "a".repeat(64),
      "agent",
      1,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2026-07-23T13:00:00.000Z"
    );

    clock.advance(1_000);
    const second = repository.put(serverSpec("two"), first.revision);
    expect(second.revision).toBe(2);
    expect(() => repository.assertServerRevision("agent", first.revision)).toThrow(
      MockMcpRepositoryError
    );
    expect(() =>
      repository.assertServerRevision("agent", second.revision)
    ).not.toThrow();
    expect(second.createdAt).toBe(first.createdAt);
    expect(repository.readState("agent", 1, "sequence:tool")).toBeUndefined();
    expect(
      store.get<{ terminated_at: string }>(
        "SELECT terminated_at FROM mock_mcp_sessions WHERE session_hash = ?",
        "a".repeat(64)
      )?.terminated_at
    ).toBe("2026-07-23T12:00:01.000Z");
    expect(repository.list()).toMatchObject([
      { slug: "agent", revision: 2, toolCount: 1 },
    ]);
    expect(() => repository.writeState("agent", 1, "stale", 1)).toThrow(
      MockMcpRepositoryError
    );
  });

  it("accepts a canonical replay before checking a stale CAS expectation", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-23T12:00:00.000Z");
    const repository = new MockMcpRepository(store, clock);
    const first = repository.put(serverSpec("one"), null);
    repository.writeState("agent", first.revision, "sequence:tool", 2);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "b".repeat(64),
      "agent",
      1,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2026-07-23T13:00:00.000Z"
    );

    clock.advance(1_000);
    const replay = repository.put(
      {
        tools: serverSpec("one").tools,
        serverInfo: serverSpec("one").serverInfo,
        slug: "agent",
        version: 1,
      },
      99
    );

    expect(replay).toEqual(first);
    expect(repository.readState("agent", 1, "sequence:tool")).toBe(2);
    expect(
      store.get<{ terminated_at: string | null }>(
        "SELECT terminated_at FROM mock_mcp_sessions WHERE session_hash = ?",
        "b".repeat(64)
      )?.terminated_at
    ).toBeNull();
    expect(repository.put(serverSpec("one"), null)).toEqual(first);
  });

  it("converges an identical stale ABA replay on the recreated generation", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const first = repository.put(serverSpec("one"), null);
    expect(repository.delete("agent", first.revision)).toBe(true);

    const recreated = repository.put(serverSpec("one"), null);
    expect(recreated.revision).toBe(2);
    repository.writeState("agent", recreated.revision, "sequence:tool", 2);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "f".repeat(64),
      "agent",
      recreated.revision,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2099-07-23T13:00:00.000Z"
    );

    const converged = repository.put(serverSpec("one"), first.revision);

    expect(converged).toEqual(recreated);
    expect(repository.require("agent")).toEqual(recreated);
    expect(repository.readState("agent", recreated.revision, "sequence:tool")).toBe(2);
    expect(
      store.get<{ last_revision: number }>(
        "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
      )?.last_revision
    ).toBe(recreated.revision);
    expect(
      store.get<{ terminated_at: string | null }>(
        "SELECT terminated_at FROM mock_mcp_sessions WHERE session_hash = ?",
        "f".repeat(64)
      )?.terminated_at
    ).toBeNull();
  });

  it("rejects changed-definition stale and ABA mutations without touching the recreated generation", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const first = repository.put(serverSpec("one"), null);
    expect(repository.delete("agent", first.revision)).toBe(true);

    const recreated = repository.put(serverSpec("recreated"), null);
    repository.writeState("agent", recreated.revision, "sequence:tool", 2);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "d".repeat(64),
      "agent",
      recreated.revision,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2099-07-23T13:00:00.000Z"
    );

    for (const mutation of [
      () => repository.put(serverSpec("stale replace"), first.revision),
      () => repository.resetState("agent", first.revision),
      () => repository.delete("agent", first.revision),
    ]) {
      expect(mutation).toThrow(
        expect.objectContaining<Partial<MockMcpRepositoryError>>({
          code: "server_revision_mismatch",
        })
      );
    }

    expect(repository.require("agent")).toEqual(recreated);
    expect(repository.readState("agent", recreated.revision, "sequence:tool")).toBe(2);
    expect(
      store.get<{ terminated_at: string | null }>(
        "SELECT terminated_at FROM mock_mcp_sessions WHERE session_hash = ?",
        "d".repeat(64)
      )?.terminated_at
    ).toBeNull();
  });

  it("rejects invalid expected revisions before mutation", () => {
    const repository = new MockMcpRepository(memoryStore());
    const first = repository.put(serverSpec("one"), null);

    for (const expectedRevision of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
    ]) {
      expect(() => repository.put(serverSpec("changed"), expectedRevision)).toThrow(
        expect.objectContaining<Partial<MockMcpRepositoryError>>({
          code: "invalid_expected_revision",
        })
      );
      expect(() => repository.resetState("agent", expectedRevision)).toThrow(
        expect.objectContaining<Partial<MockMcpRepositoryError>>({
          code: "invalid_expected_revision",
        })
      );
      expect(() => repository.delete("agent", expectedRevision)).toThrow(
        expect.objectContaining<Partial<MockMcpRepositoryError>>({
          code: "invalid_expected_revision",
        })
      );
    }

    expect(repository.require("agent")).toEqual(first);
  });

  it("persists one bounded monotonic revision generation across delete and recreate", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-23T12:00:00.000Z");
    const repository = new MockMcpRepository(store, clock);
    const first = repository.put(serverSpec("one"), null);
    const replay = repository.put(serverSpec("one"), null);
    const secondRepository = new MockMcpRepository(store, clock);
    const other = secondRepository.put({ ...serverSpec("other"), slug: "other" }, null);

    expect(first.revision).toBe(1);
    expect(replay).toEqual(first);
    expect(other.revision).toBe(2);
    expect(repository.delete("agent", first.revision)).toBe(true);
    expect(repository.delete("other", other.revision)).toBe(true);
    expect(repository.list()).toEqual([]);
    expect(
      store.get<{ last_revision: number }>(
        "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
      )?.last_revision
    ).toBe(2);

    const restartedRepository = new MockMcpRepository(store, clock);
    const recreated = restartedRepository.put(serverSpec("recreated"), null);
    expect(recreated.revision).toBe(3);
    expect(recreated.revision).toBeGreaterThan(first.revision);
    expect(
      store.get<{ count: number; last_revision: number }>(
        `SELECT COUNT(*) AS count, MAX(last_revision) AS last_revision
         FROM mock_mcp_revision_allocator`
      )
    ).toEqual({ count: 1, last_revision: 3 });
  });

  it("does not allocate revisions for reset, rejected mutation, validation, or server-cap failure", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const first = repository.put(serverSpec("one"), null);

    expect(repository.resetState("agent", first.revision)).toBe(0);
    expect(() => repository.delete("missing", first.revision)).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_not_found",
      })
    );
    expect(() => repository.resetState("missing", first.revision)).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_not_found",
      })
    );
    expect(() => repository.put(serverSpec("changed"), null)).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_revision_mismatch",
      })
    );
    expect(() =>
      repository.put(
        { ...serverSpec("missing"), slug: "missing-server" },
        first.revision
      )
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_revision_mismatch",
      })
    );
    expect(() =>
      repository.put({ ...serverSpec("invalid"), slug: "INVALID SLUG" }, null)
    ).toThrow();
    expect(
      store.get<{ last_revision: number }>(
        "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
      )?.last_revision
    ).toBe(first.revision);

    for (let index = 1; index < MOCK_MCP_MAX_SERVERS; index += 1) {
      repository.put(
        {
          ...serverSpec(`server-${index}`),
          slug: `server-${index}`,
        },
        null
      );
    }
    const beforeRejectedPut = store.get<{ last_revision: number }>(
      "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
    )?.last_revision;
    expect(() =>
      repository.put({ ...serverSpec("overflow"), slug: "server-overflow" }, null)
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_limit",
      })
    );
    expect(
      store.get<{ last_revision: number }>(
        "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
      )?.last_revision
    ).toBe(beforeRejectedPut);
  });

  it("fails revision exhaustion before changing an existing definition", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const first = repository.put(serverSpec("one"), null);
    repository.writeState("agent", first.revision, "sequence:tool", 2);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "e".repeat(64),
      "agent",
      first.revision,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2099-07-23T13:00:00.000Z"
    );
    store.run(
      `UPDATE mock_mcp_revision_allocator
       SET last_revision = ?
       WHERE singleton = 1`,
      Number.MAX_SAFE_INTEGER
    );

    expect(repository.put(serverSpec("one"), null)).toEqual(first);
    expect(() => repository.put(serverSpec("two"), first.revision)).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_revision_limit",
      })
    );
    expect(repository.require("agent")).toEqual(first);
    expect(repository.readState("agent", first.revision, "sequence:tool")).toBe(2);
    expect(
      store.get<{ last_revision: number }>(
        "SELECT last_revision FROM mock_mcp_revision_allocator WHERE singleton = 1"
      )?.last_revision
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      store.get<{ terminated_at: string | null }>(
        "SELECT terminated_at FROM mock_mcp_sessions WHERE session_hash = ?",
        "e".repeat(64)
      )?.terminated_at
    ).toBeNull();
  });

  it("fails closed when the revision allocator row is missing or behind active state", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const first = repository.put(serverSpec("one"), null);
    repository.writeState("agent", first.revision, "sequence:tool", 2);

    store.run("DELETE FROM mock_mcp_revision_allocator WHERE singleton = 1");
    expect(() =>
      repository.put(serverSpec("missing-allocator"), first.revision)
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "invalid_persisted_server",
      })
    );
    expect(repository.require("agent")).toEqual(first);

    store.run(
      `INSERT INTO mock_mcp_revision_allocator (singleton, last_revision)
       VALUES (1, 0)`
    );
    expect(() =>
      repository.put(serverSpec("behind-allocator"), first.revision)
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "invalid_persisted_server",
      })
    );
    expect(repository.require("agent")).toEqual(first);
    expect(repository.readState("agent", first.revision, "sequence:tool")).toBe(2);
  });

  it("bounds state cardinality and serialized bytes per server revision", () => {
    const rowRepository = new MockMcpRepository(memoryStore());
    const rowServer = rowRepository.put(serverSpec("rows"), null);
    for (let index = 0; index < MOCK_MCP_MAX_STATE_ROWS_PER_SERVER; index += 1) {
      rowRepository.writeState("agent", rowServer.revision, `row:${index}`, index);
    }
    expect(() =>
      rowRepository.writeState("agent", rowServer.revision, "row:overflow", true)
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "state_limit",
      })
    );
    expect(() =>
      rowRepository.writeState("agent", rowServer.revision, "row:0", "updated")
    ).not.toThrow();

    const byteRepository = new MockMcpRepository(memoryStore());
    const byteServer = byteRepository.put(serverSpec("bytes"), null);
    const payload = "x".repeat(60_000);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const fittingRows = Math.floor(MOCK_MCP_MAX_STATE_BYTES_PER_SERVER / payloadBytes);
    expect(fittingRows).toBeLessThan(MOCK_MCP_MAX_STATE_ROWS_PER_SERVER);
    for (let index = 0; index < fittingRows; index += 1) {
      byteRepository.writeState(
        "agent",
        byteServer.revision,
        `bytes:${index}`,
        payload
      );
    }
    expect(() =>
      byteRepository.writeState("agent", byteServer.revision, "bytes:overflow", payload)
    ).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "state_limit",
      })
    );
  });

  it("resets state and explicitly deletes children without foreign keys", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const record = repository.put(serverSpec("one"), null);
    repository.writeState("agent", record.revision, "one", { value: true });
    repository.writeState("agent", record.revision, "two", 2);
    expect(repository.resetState("agent", record.revision)).toBe(2);
    expect(repository.get("agent")).toBeDefined();
    repository.writeState("agent", record.revision, "remaining", 3);
    store.run(
      `INSERT INTO mock_mcp_sessions (
        session_hash, server_slug, server_revision, protocol_version,
        initialized, created_at, expires_at, terminated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      "c".repeat(64),
      "agent",
      record.revision,
      "2025-11-25",
      1,
      "2026-07-23T12:00:00.000Z",
      "2026-07-23T13:00:00.000Z"
    );
    store.database.exec("PRAGMA foreign_keys = OFF");
    expect(repository.delete("agent", record.revision)).toBe(true);
    expect(() => repository.assertServerRevision("agent", record.revision)).toThrow(
      MockMcpRepositoryError
    );
    expect(() => repository.delete("agent", record.revision)).toThrow(
      expect.objectContaining<Partial<MockMcpRepositoryError>>({
        code: "server_not_found",
      })
    );
    expect(repository.list()).toEqual([]);
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM mock_state WHERE server_slug = ?",
        "agent"
      )?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM mock_mcp_sessions WHERE server_slug = ?",
        "agent"
      )?.count
    ).toBe(0);
    const recreated = repository.put(serverSpec("recreated"), null);
    expect(recreated.revision).toBe(2);
    expect(
      repository.readState("agent", recreated.revision, "remaining")
    ).toBeUndefined();
  });

  it("rejects unbounded or non-JSON application state on write and read", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const record = repository.put(serverSpec("one"), null);
    expect(() =>
      repository.writeState(
        "agent",
        record.revision,
        "oversized",
        "x".repeat(64 * 1024) as JsonValue
      )
    ).toThrow(MockMcpRepositoryError);
    expect(() =>
      repository.writeState(
        "agent",
        record.revision,
        "not-json",
        1n as unknown as JsonValue
      )
    ).toThrow(MockMcpRepositoryError);

    store.run(
      `INSERT INTO mock_state (
        server_slug, server_revision, state_key, value_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      "agent",
      record.revision,
      "corrupt",
      "{not-json",
      "2026-07-23T12:00:00.000Z"
    );
    expect(() => repository.readState("agent", record.revision, "corrupt")).toThrow(
      MockMcpRepositoryError
    );
  });
});

class MemoryBehaviorState implements BehaviorStateAccess {
  readonly values = new Map<string, JsonValue>();
  transactions = 0;

  read(key: string): JsonValue | undefined {
    return this.values.get(key);
  }

  write(key: string, value: JsonValue): void {
    this.values.set(key, value);
  }

  transaction<Value>(callback: () => Value): Value {
    this.transactions += 1;
    return callback();
  }
}

const sequence = (mode: "once" | "hold_last" | "loop"): BehaviorSpec => ({
  version: 1,
  type: "sequence",
  mode,
  steps: [
    { version: 1, type: "static", value: "first" },
    {
      version: 1,
      type: "error",
      code: "planned_failure",
      message: "second",
    },
  ],
});

describe("declarative behavior evaluator", () => {
  it("stages sequence movement until the caller validates and commits", async () => {
    const state = new MemoryBehaviorState();
    const context = {
      input: {},
      stateKey: "tool:next",
      state,
    };
    const first = await evaluateBehavior(sequence("once"), context);
    expect(first.outcome).toEqual({ kind: "value", value: "first" });
    expect(state.values.size).toBe(0);

    const replay = await evaluateBehavior(sequence("once"), context);
    expect(replay.outcome).toEqual(first.outcome);
    replay.commit();
    replay.commit();
    expect(state.transactions).toBe(1);

    const second = await evaluateBehavior(sequence("once"), context);
    expect(second.outcome).toMatchObject({
      kind: "error",
      code: "planned_failure",
    });
    second.commit();
    await expect(evaluateBehavior(sequence("once"), context)).rejects.toMatchObject({
      code: "sequence_exhausted",
    });
  });

  it("rejects a stale sequence plan before writing any state", async () => {
    const state = new MemoryBehaviorState();
    const context = {
      input: {},
      stateKey: "tool:concurrent",
      state,
    };
    const first = await evaluateBehavior(sequence("loop"), context);
    const stale = await evaluateBehavior(sequence("loop"), context);
    expect(first.outcome).toEqual({ kind: "value", value: "first" });
    expect(stale.outcome).toEqual({ kind: "value", value: "first" });

    first.commit();
    expect(() => stale.commit()).toThrow(BehaviorStateConflictError);
    const next = await evaluateBehavior(sequence("loop"), context);
    expect(next.outcome).toMatchObject({
      kind: "error",
      code: "planned_failure",
    });
  });

  it("locks hold-last and loop semantics", async () => {
    for (const mode of ["hold_last", "loop"] as const) {
      const state = new MemoryBehaviorState();
      const values: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const plan = await evaluateBehavior(sequence(mode), {
          input: {},
          stateKey: `tool:${mode}`,
          state,
        });
        values.push(
          plan.outcome.kind === "value" ? String(plan.outcome.value) : "error"
        );
        plan.commit();
      }
      expect(values).toEqual(
        mode === "hold_last"
          ? ["first", "error", "error", "error"]
          : ["first", "error", "first", "error"]
      );
    }
  });

  it("supports first-match, safe templates, deterministic latency, and script fallback", async () => {
    const state = new MemoryBehaviorState();
    const behavior: BehaviorSpec = {
      version: 1,
      type: "match",
      latency: {
        minimumMilliseconds: 5,
        maximumMilliseconds: 25,
        seed: "latency",
      },
      cases: [
        {
          when: { "request.kind": "ticket" },
          behavior: {
            version: 1,
            type: "template",
            template: "Hello {{request.user}}, ticket {{request.id}}",
          },
        },
      ],
      fallback: {
        version: 1,
        type: "script",
        script: {
          scriptId: "future",
          version: 1,
          sha256: "a".repeat(64),
        },
        onFailure: "fallback",
        fallback: { version: 1, type: "static", value: "fallback" },
      },
    };
    const context = {
      input: {
        request: { kind: "ticket", user: "Ada", id: 42 },
      },
      stateKey: "tool:triage",
      invocationKey: "request-1",
      state,
    } satisfies Parameters<typeof evaluateBehavior>[1];
    const first = await evaluateBehavior(behavior, context);
    const again = await evaluateBehavior(behavior, context);
    expect(first.outcome).toEqual({
      kind: "value",
      value: "Hello Ada, ticket 42",
    });
    expect(first.delayMilliseconds).toBe(again.delayMilliseconds);
    expect(first.delayMilliseconds).toBeGreaterThanOrEqual(5);
    expect(first.delayMilliseconds).toBeLessThanOrEqual(25);

    const fallback = await evaluateBehavior(behavior, {
      ...context,
      input: { request: { kind: "other" } },
    });
    expect(fallback.outcome).toEqual({ kind: "value", value: "fallback" });
  });

  it("bounds repeated match-path reads and canonicalization per evaluation", async () => {
    const payloadRecord: Record<string, JsonValue> = {};
    for (let index = 0; index < 12_000; index += 1) {
      payloadRecord[`property_${index}`] = index;
    }
    let payloadEnumerations = 0;
    const payload = new Proxy(payloadRecord, {
      ownKeys: (target) => {
        payloadEnumerations += 1;
        return Reflect.ownKeys(target);
      },
    });
    let payloadReads = 0;
    const argumentsValue = new Proxy(
      { payload },
      {
        get: (target, property, receiver) => {
          if (property === "payload") payloadReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const behavior: BehaviorSpec = {
      version: 1,
      type: "match",
      cases: Array.from({ length: 100 }, (_, index) => ({
        when: { "arguments.payload": index },
        behavior: {
          version: 1,
          type: "static",
          value: `case-${index}`,
        },
      })),
      fallback: {
        version: 1,
        type: "static",
        value: "bounded-fallback",
      },
    };

    const plan = await evaluateBehavior(behavior, {
      input: { arguments: argumentsValue },
      stateKey: "tool:bounded-match",
      state: new MemoryBehaviorState(),
    });

    expect(plan.outcome).toEqual({
      kind: "value",
      value: "bounded-fallback",
    });
    expect(payloadReads).toBe(1);
    expect(payloadEnumerations).toBe(1);
  });

  it("isolates sequence state by the selected match-case path", async () => {
    const state = new MemoryBehaviorState();
    const behavior: BehaviorSpec = {
      version: 1,
      type: "match",
      cases: [
        {
          when: { kind: "alpha" },
          behavior: {
            version: 1,
            type: "sequence",
            mode: "hold_last",
            steps: [
              { version: 1, type: "static", value: "alpha-1" },
              { version: 1, type: "static", value: "alpha-2" },
            ],
          },
        },
        {
          when: { kind: "beta" },
          behavior: {
            version: 1,
            type: "sequence",
            mode: "hold_last",
            steps: [
              { version: 1, type: "static", value: "beta-1" },
              { version: 1, type: "static", value: "beta-2" },
            ],
          },
        },
      ],
    };
    const invoke = async (kind: "alpha" | "beta") => {
      const plan = await evaluateBehavior(behavior, {
        input: { kind },
        stateKey: "tool:routed",
        state,
      });
      plan.commit();
      return plan.outcome.kind === "value" ? plan.outcome.value : null;
    };

    expect(await invoke("alpha")).toBe("alpha-1");
    expect(await invoke("beta")).toBe("beta-1");
    expect(await invoke("alpha")).toBe("alpha-2");
    expect(await invoke("beta")).toBe("beta-2");
  });
});
