import {
  MOCK_MCP_MAX_SERVERS,
  type MockMcpServerRecord,
  type MockMcpServerSpec,
  type MockMcpServerSummary,
  mockMcpServerRecordSchema,
  mockMcpSlugSchema,
  parseMockMcpServerSpec,
  toMockMcpServerSummary,
} from "@mockos/contracts";
import {
  assertBehaviorSpecBounds,
  jsonValueSchema,
  type JsonValue,
} from "@mockos/contracts/behavior";
import type { Clock } from "../determinism";
import { SystemClock } from "../determinism";
import { canonicalJson } from "../security";
import type { SqlRow, SqlStore } from "../store";

type ServerRow = SqlRow & {
  readonly slug: string;
  readonly revision: number;
  readonly spec_json: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type StateRow = SqlRow & {
  readonly value_json: string;
};

type CountRow = SqlRow & {
  readonly count: number;
};

export const MOCK_STATE_MAX_BYTES = 64 * 1024;
export const MOCK_STATE_MAX_DEPTH = 16;
export const MOCK_STATE_MAX_NODES = 5_000;

const parseServerRow = (row: ServerRow): MockMcpServerRecord =>
  mockMcpServerRecordSchema.parse({
    spec: JSON.parse(row.spec_json),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

export class MockMcpRepositoryError extends Error {
  constructor(
    readonly code:
      | "server_limit"
      | "server_not_found"
      | "invalid_persisted_server"
      | "invalid_state",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockMcpRepositoryError";
  }
}

/**
 * Durable, environment-local mock MCP configuration and application state.
 * Replacing a spec is an atomic revision boundary: old state is removed and old
 * protocol sessions are terminated before the new revision becomes visible.
 */
export class MockMcpRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;

  constructor(store: SqlStore, clock: Clock = new SystemClock()) {
    this.#store = store;
    this.#clock = clock;
  }

  put(input: unknown): MockMcpServerRecord {
    const spec = parseMockMcpServerSpec(input);
    const now = this.#clock.now().toISOString();
    return this.#store.transaction(() => {
      const existing = this.#serverRow(spec.slug);
      if (!existing) {
        const count = Number(
          this.#store.get<CountRow>("SELECT COUNT(*) AS count FROM mock_mcp_servers")
            ?.count ?? 0
        );
        if (count >= MOCK_MCP_MAX_SERVERS) {
          throw new MockMcpRepositoryError(
            "server_limit",
            `An environment supports at most ${MOCK_MCP_MAX_SERVERS} mock MCP servers.`
          );
        }
      }

      const revision = existing ? Number(existing.revision) + 1 : 1;
      const createdAt = existing?.created_at ?? now;
      if (existing) {
        this.#store.run("DELETE FROM mock_state WHERE server_slug = ?", spec.slug);
        this.#store.run(
          `UPDATE mock_mcp_sessions
           SET terminated_at = COALESCE(terminated_at, ?)
           WHERE server_slug = ? AND server_revision = ?`,
          now,
          spec.slug,
          Number(existing.revision)
        );
      }
      this.#store.run(
        `INSERT INTO mock_mcp_servers (
          slug, revision, spec_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          revision = excluded.revision,
          spec_json = excluded.spec_json,
          updated_at = excluded.updated_at`,
        spec.slug,
        revision,
        canonicalJson(spec),
        createdAt,
        now
      );
      return {
        spec,
        revision,
        createdAt,
        updatedAt: now,
      };
    });
  }

  get(slug: string): MockMcpServerRecord | undefined {
    mockMcpSlugSchema.parse(slug);
    const row = this.#serverRow(slug);
    if (!row) return undefined;
    try {
      return parseServerRow(row);
    } catch (cause) {
      throw new MockMcpRepositoryError(
        "invalid_persisted_server",
        `Persisted mock MCP server ${slug} is invalid.`,
        { cause }
      );
    }
  }

  require(slug: string): MockMcpServerRecord {
    const server = this.get(slug);
    if (!server) {
      throw new MockMcpRepositoryError(
        "server_not_found",
        `Mock MCP server ${slug} does not exist.`
      );
    }
    return server;
  }

  list(): MockMcpServerSummary[] {
    return this.#store
      .all<ServerRow>(
        `SELECT slug, revision, spec_json, created_at, updated_at
         FROM mock_mcp_servers
         ORDER BY updated_at DESC, slug
         LIMIT ?`,
        MOCK_MCP_MAX_SERVERS
      )
      .map((row) => toMockMcpServerSummary(parseServerRow(row)));
  }

  delete(slug: string): boolean {
    mockMcpSlugSchema.parse(slug);
    return this.#store.transaction(
      () =>
        this.#store.run("DELETE FROM mock_mcp_servers WHERE slug = ?", slug).changes > 0
    );
  }

  resetState(slug: string): number {
    const server = this.require(slug);
    return this.#store.transaction(
      () =>
        this.#store.run(
          "DELETE FROM mock_state WHERE server_slug = ? AND server_revision = ?",
          slug,
          server.revision
        ).changes
    );
  }

  readState(slug: string, revision: number, key: string): JsonValue | undefined {
    const row = this.#store.get<StateRow>(
      `SELECT value_json
       FROM mock_state
       WHERE server_slug = ? AND server_revision = ? AND state_key = ?`,
      slug,
      revision,
      key
    );
    if (!row) return undefined;
    try {
      const value: unknown = JSON.parse(row.value_json);
      assertBehaviorSpecBounds(value, {
        maximumBytes: MOCK_STATE_MAX_BYTES,
        maximumDepth: MOCK_STATE_MAX_DEPTH,
        maximumNodes: MOCK_STATE_MAX_NODES,
      });
      return jsonValueSchema.parse(value);
    } catch (cause) {
      throw new MockMcpRepositoryError(
        "invalid_state",
        `Persisted mock state ${key} is invalid.`,
        { cause }
      );
    }
  }

  writeState(slug: string, revision: number, key: string, value: JsonValue): void {
    if (key.length < 1 || key.length > 512) {
      throw new MockMcpRepositoryError(
        "invalid_state",
        "Mock state keys must contain 1 to 512 characters."
      );
    }
    const server = this.require(slug);
    if (server.revision !== revision) {
      throw new MockMcpRepositoryError(
        "invalid_state",
        `Mock MCP server ${slug} revision ${revision} is stale.`
      );
    }
    let validated: JsonValue;
    try {
      assertBehaviorSpecBounds(value, {
        maximumBytes: MOCK_STATE_MAX_BYTES,
        maximumDepth: MOCK_STATE_MAX_DEPTH,
        maximumNodes: MOCK_STATE_MAX_NODES,
      });
      validated = jsonValueSchema.parse(value);
    } catch (cause) {
      throw new MockMcpRepositoryError(
        "invalid_state",
        `Mock state ${key} exceeds its JSON bounds or is invalid.`,
        { cause }
      );
    }
    this.#store.run(
      `INSERT INTO mock_state (
        server_slug, server_revision, state_key, value_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(server_slug, server_revision, state_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at`,
      slug,
      revision,
      key,
      canonicalJson(validated),
      this.#clock.now().toISOString()
    );
  }

  transaction<T>(callback: () => T): T {
    return this.#store.transaction(callback);
  }

  #serverRow(slug: string): ServerRow | undefined {
    return this.#store.get<ServerRow>(
      `SELECT slug, revision, spec_json, created_at, updated_at
       FROM mock_mcp_servers
       WHERE slug = ?`,
      slug
    );
  }
}

export const createMockMcpStateAccess = (
  repository: MockMcpRepository,
  server: Pick<MockMcpServerRecord, "revision"> & {
    readonly spec: Pick<MockMcpServerSpec, "slug">;
  }
) => ({
  read: (key: string): JsonValue | undefined =>
    repository.readState(server.spec.slug, server.revision, key),
  write: (key: string, value: JsonValue): void =>
    repository.writeState(server.spec.slug, server.revision, key, value),
  transaction: <Value>(callback: () => Value): Value =>
    repository.transaction(callback),
});
