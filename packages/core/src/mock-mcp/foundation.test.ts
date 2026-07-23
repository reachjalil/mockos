import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  type BehaviorStateAccess,
  BehaviorStateConflictError,
  evaluateBehavior,
  FixedClock,
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
    const first = repository.put(serverSpec("one"));
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
    const second = repository.put(serverSpec("two"));
    expect(second.revision).toBe(2);
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

  it("resets only current application state and cascades deletion", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const record = repository.put(serverSpec("one"));
    repository.writeState("agent", record.revision, "one", { value: true });
    repository.writeState("agent", record.revision, "two", 2);
    expect(repository.resetState("agent")).toBe(2);
    expect(repository.get("agent")).toBeDefined();
    expect(repository.delete("agent")).toBe(true);
    expect(repository.delete("agent")).toBe(false);
    expect(repository.list()).toEqual([]);
  });

  it("rejects unbounded or non-JSON application state on write and read", () => {
    const store = memoryStore();
    const repository = new MockMcpRepository(store);
    const record = repository.put(serverSpec("one"));
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
