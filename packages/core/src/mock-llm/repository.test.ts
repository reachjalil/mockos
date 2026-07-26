import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MOCK_LLM_MAX_SERVERS } from "@mockos/contracts/mock-llm-server";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  canonicalMockLlmJson,
  FixedClock,
  MockLlmRepository,
  type MockLlmRepositoryError,
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
      const result = callback();
      this.database.exec("COMMIT");
      return result;
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
const memoryStore = (): MemorySqlStore => {
  const store = new MemorySqlStore();
  stores.push(store);
  applyMigrations(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const serverSpec = (text: string, slug = "agent") => ({
  version: 1 as const,
  slug,
  name: `Agent ${slug}`,
  dialects: {
    openai: {
      enabled: true as const,
      authentication: {
        mode: "strict" as const,
        apiKeySha256: "a".repeat(64),
      },
    },
    anthropic: { enabled: false as const },
  },
  models: [
    {
      id: "mockos-chat-1",
      displayName: "mockOS Chat",
      createdAtEpochSeconds: 1_784_973_600,
      behavior: {
        version: 1 as const,
        type: "static" as const,
        value: text,
      },
    },
  ],
});

const reorderedServerSpec = (text: string) => {
  const spec = serverSpec(text);
  return {
    models: spec.models,
    dialects: {
      anthropic: spec.dialects.anthropic,
      openai: spec.dialects.openai,
    },
    name: spec.name,
    slug: spec.slug,
    version: spec.version,
  };
};

const allocatorRevision = (store: MemorySqlStore): number | undefined =>
  store.get<{ last_revision: number }>(
    "SELECT last_revision FROM mock_llm_revision_allocator WHERE singleton = 1"
  )?.last_revision;

describe("canonical mock LLM JSON", () => {
  it("sorts fields by UTF-16 code unit and preserves JSON omission semantics", () => {
    expect(canonicalMockLlmJson({ "2": "two", "10": "ten" })).toBe(
      '{"10":"ten","2":"two"}'
    );
    expect(
      canonicalMockLlmJson({
        omitted: undefined,
        array: [undefined, 1],
      })
    ).toBe('{"array":[null,1]}');
  });

  it("rejects a top-level value that JSON cannot represent", () => {
    expect(() => canonicalMockLlmJson(undefined)).toThrow(TypeError);
  });
});

describe("mock LLM persistence", () => {
  it("creates and replaces definitions under mandatory revision CAS", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-25T12:00:00.000Z");
    const repository = new MockLlmRepository(store, clock);

    const first = repository.put(serverSpec("one"), null);
    clock.advance(1_000);
    const second = repository.put(serverSpec("two"), first.revision);

    expect(first).toMatchObject({
      revision: 1,
      createdAt: "2026-07-25T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(second).toMatchObject({
      revision: 2,
      createdAt: first.createdAt,
      updatedAt: "2026-07-25T12:00:01.000Z",
    });
    expect(repository.require("agent")).toEqual(second);
    expect(allocatorRevision(store)).toBe(2);
  });

  it("accepts a canonical replay before checking a stale CAS expectation", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-25T12:00:00.000Z");
    const repository = new MockLlmRepository(store, clock);
    const first = repository.put(serverSpec("one"), null);
    clock.advance(1_000);
    const second = repository.put(serverSpec("two"), first.revision);
    clock.advance(1_000);

    expect(repository.put(reorderedServerSpec("two"), first.revision)).toEqual(second);
    expect(
      repository.put(
        {
          ...reorderedServerSpec("two"),
          defaultUsage: { inputTokens: 0, outputTokens: 0 },
          defaultCadence: {
            chunkDelayMilliseconds: 0,
            chunkSize: 256,
            maximumDurationMilliseconds: 60_000,
          },
        },
        first.revision
      )
    ).toEqual(second);
    expect(repository.put(reorderedServerSpec("two"), null)).toEqual(second);
    expect(repository.require("agent").updatedAt).toBe(second.updatedAt);
    expect(allocatorRevision(store)).toBe(second.revision);
  });

  it("atomically refuses a stale delete after another agent replaces the server", () => {
    const store = memoryStore();
    const repository = new MockLlmRepository(store);
    const first = repository.put(serverSpec("one"), null);
    const second = repository.put(serverSpec("two"), first.revision);

    expect(() => repository.delete("agent", first.revision)).toThrow(
      expect.objectContaining({ code: "server_revision_mismatch" })
    );
    expect(repository.require("agent")).toEqual(second);
    expect(repository.delete("agent", second.revision)).toBe(true);
    expect(repository.delete("agent", second.revision)).toBe(false);
  });

  it("rejects missing, conflicting, stale, and invalid CAS expectations without mutation", () => {
    const store = memoryStore();
    const repository = new MockLlmRepository(store);

    expect(() => repository.put(serverSpec("missing"), 1)).toThrow(
      expect.objectContaining({ code: "server_revision_mismatch" })
    );
    expect(allocatorRevision(store)).toBe(0);

    const first = repository.put(serverSpec("one"), null);
    for (const expectedRevision of [null, 2] as const) {
      expect(() => repository.put(serverSpec("conflict"), expectedRevision)).toThrow(
        expect.objectContaining({ code: "server_revision_mismatch" })
      );
    }
    for (const expectedRevision of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
    ]) {
      expect(() => repository.put(serverSpec("invalid"), expectedRevision)).toThrow(
        expect.objectContaining({ code: "invalid_expected_revision" })
      );
    }

    expect(repository.require("agent")).toEqual(first);
    expect(allocatorRevision(store)).toBe(first.revision);
  });

  it("supports get, require, list, revision assertions, and deletion", () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-25T12:00:00.000Z");
    const repository = new MockLlmRepository(store, clock);
    const agent = repository.put(serverSpec("one"), null);
    clock.advance(1_000);
    const other = repository.put(serverSpec("two", "other"), null);

    expect(repository.get("missing")).toBeUndefined();
    expect(() => repository.require("missing")).toThrow(
      expect.objectContaining({ code: "server_not_found" })
    );
    expect(repository.list()).toEqual([
      {
        slug: "other",
        name: "Agent other",
        revision: other.revision,
        modelCount: 1,
        enabledDialects: ["openai"],
        updatedAt: other.updatedAt,
      },
      {
        slug: "agent",
        name: "Agent agent",
        revision: agent.revision,
        modelCount: 1,
        enabledDialects: ["openai"],
        updatedAt: agent.updatedAt,
      },
    ]);
    expect(() =>
      repository.assertServerRevision("agent", agent.revision)
    ).not.toThrow();
    expect(() => repository.assertServerRevision("agent", other.revision)).toThrow(
      expect.objectContaining({ code: "server_revision_mismatch" })
    );
    expect(() => repository.assertServerRevision("agent", 0)).toThrow(
      expect.objectContaining({ code: "invalid_expected_revision" })
    );
    expect(() => repository.delete("agent", other.revision)).toThrow(
      expect.objectContaining({ code: "server_revision_mismatch" })
    );
    expect(repository.delete("agent", agent.revision)).toBe(true);
    expect(repository.delete("agent", agent.revision)).toBe(false);
    expect(() => repository.delete("other", 0)).toThrow(
      expect.objectContaining({ code: "invalid_expected_revision" })
    );
    expect(() => repository.delete("other", null as never)).toThrow(
      expect.objectContaining({ code: "invalid_expected_revision" })
    );
    expect(repository.get("agent")).toBeUndefined();
  });

  it("keeps revision allocation monotonic across delete, recreate, and repository restart", () => {
    const store = memoryStore();
    const repository = new MockLlmRepository(store);
    const first = repository.put(serverSpec("one"), null);
    expect(repository.delete("agent", first.revision)).toBe(true);
    expect(repository.delete("agent", first.revision)).toBe(false);

    const restartedRepository = new MockLlmRepository(store);
    const recreated = restartedRepository.put(serverSpec("recreated"), null);

    expect(first.revision).toBe(1);
    expect(recreated.revision).toBe(2);
    expect(allocatorRevision(store)).toBe(2);
  });

  it("enforces the server limit without consuming a revision", () => {
    const store = memoryStore();
    const repository = new MockLlmRepository(store);
    for (let index = 0; index < MOCK_LLM_MAX_SERVERS; index += 1) {
      repository.put(serverSpec(`server-${index}`, `server-${index}`), null);
    }
    const before = allocatorRevision(store);

    expect(() =>
      repository.put(serverSpec("overflow", "server-overflow"), null)
    ).toThrow(expect.objectContaining({ code: "server_limit" }));
    expect(repository.list()).toHaveLength(MOCK_LLM_MAX_SERVERS);
    expect(allocatorRevision(store)).toBe(before);
  });

  it("fails revision exhaustion before changing a definition but still replays", () => {
    const store = memoryStore();
    const repository = new MockLlmRepository(store);
    const first = repository.put(serverSpec("one"), null);
    store.run(
      `UPDATE mock_llm_revision_allocator
       SET last_revision = ?
       WHERE singleton = 1`,
      Number.MAX_SAFE_INTEGER
    );

    expect(repository.put(serverSpec("one"), null)).toEqual(first);
    expect(() => repository.put(serverSpec("two"), first.revision)).toThrow(
      expect.objectContaining({ code: "server_revision_limit" })
    );
    expect(repository.require("agent")).toEqual(first);
    expect(allocatorRevision(store)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("fails closed for a missing or regressed revision allocator", () => {
    const missingStore = memoryStore();
    const missingRepository = new MockLlmRepository(missingStore);
    missingStore.run("DELETE FROM mock_llm_revision_allocator WHERE singleton = 1");

    expect(() => missingRepository.put(serverSpec("one"), null)).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );
    expect(
      missingStore.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM mock_llm_servers"
      )?.count
    ).toBe(0);

    const regressedStore = memoryStore();
    const regressedRepository = new MockLlmRepository(regressedStore);
    const first = regressedRepository.put(serverSpec("one"), null);
    regressedStore.run(
      `UPDATE mock_llm_revision_allocator
       SET last_revision = 0
       WHERE singleton = 1`
    );

    expect(() => regressedRepository.put(serverSpec("two"), first.revision)).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );
    expect(() => regressedRepository.delete("agent", first.revision)).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );
    expect(regressedRepository.require("agent")).toEqual(first);
    expect(allocatorRevision(regressedStore)).toBe(0);
  });

  it("rejects corrupted persisted definitions from direct and list reads", () => {
    const invalidStore = memoryStore();
    const invalidRepository = new MockLlmRepository(invalidStore);
    invalidRepository.put(serverSpec("one"), null);
    invalidStore.run(
      "UPDATE mock_llm_servers SET spec_json = ? WHERE slug = ?",
      '{"version":1}',
      "agent"
    );

    expect(() => invalidRepository.delete("agent", 1)).toThrow(
      expect.objectContaining<Partial<MockLlmRepositoryError>>({
        code: "invalid_persisted_server",
      })
    );
    expect(
      invalidStore.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM mock_llm_servers WHERE slug = ?",
        "agent"
      )
    ).toEqual({ count: 1 });
    expect(() => invalidRepository.get("agent")).toThrow(
      expect.objectContaining<Partial<MockLlmRepositoryError>>({
        code: "invalid_persisted_server",
      })
    );
    expect(() => invalidRepository.list()).toThrow(
      expect.objectContaining<Partial<MockLlmRepositoryError>>({
        code: "invalid_persisted_server",
      })
    );

    const nonCanonicalStore = memoryStore();
    const nonCanonicalRepository = new MockLlmRepository(nonCanonicalStore);
    nonCanonicalRepository.put(serverSpec("one"), null);
    const serialized = nonCanonicalStore.get<{ spec_json: string }>(
      "SELECT spec_json FROM mock_llm_servers WHERE slug = ?",
      "agent"
    )?.spec_json;
    if (!serialized) throw new Error("Expected a persisted mock LLM definition.");
    nonCanonicalStore.run(
      "UPDATE mock_llm_servers SET spec_json = ? WHERE slug = ?",
      ` ${serialized}`,
      "agent"
    );
    expect(() => nonCanonicalRepository.delete("agent", 1)).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );
    expect(() => nonCanonicalRepository.get("agent")).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );

    const mismatchedStore = memoryStore();
    const mismatchedRepository = new MockLlmRepository(mismatchedStore);
    mismatchedRepository.put(serverSpec("one"), null);
    mismatchedStore.run(
      "UPDATE mock_llm_servers SET slug = ? WHERE slug = ?",
      "other",
      "agent"
    );
    expect(() => mismatchedRepository.get("other")).toThrow(
      expect.objectContaining({ code: "invalid_persisted_server" })
    );
  });
});
