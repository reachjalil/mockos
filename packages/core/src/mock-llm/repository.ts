import {
  MOCK_LLM_MAX_SERVERS,
  type MockLlmServerRecord,
  type MockLlmServerSummary,
  mockLlmServerRecordSchema,
  mockLlmSlugSchema,
  parseMockLlmServerSpec,
  toMockLlmServerSummary,
} from "@mockos/contracts/mock-llm-server";
import type { Clock } from "../determinism";
import { SystemClock } from "../determinism";
import type { SqlRow, SqlStore } from "../store";
import { canonicalMockLlmJson } from "./canonical-json";

type ServerRow = SqlRow & {
  readonly slug: string;
  readonly revision: number;
  readonly spec_json: string;
  readonly created_at: string;
  readonly updated_at: string;
};

type CountRow = SqlRow & {
  readonly count: number;
};

type RevisionAllocatorRow = SqlRow & {
  readonly last_revision: number;
  readonly maximum_revision: number;
};

export class MockLlmRepositoryError extends Error {
  constructor(
    readonly code:
      | "server_limit"
      | "server_revision_limit"
      | "server_not_found"
      | "server_revision_mismatch"
      | "invalid_expected_revision"
      | "invalid_persisted_server",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockLlmRepositoryError";
  }
}

const parseServerRow = (row: ServerRow): MockLlmServerRecord => {
  try {
    const record = mockLlmServerRecordSchema.parse({
      spec: JSON.parse(row.spec_json),
      revision: Number(row.revision),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    if (
      record.spec.slug !== row.slug ||
      canonicalMockLlmJson(record.spec) !== row.spec_json
    ) {
      throw new Error(
        "Persisted mock LLM server identity or canonical JSON is inconsistent."
      );
    }
    return record;
  } catch (cause) {
    throw new MockLlmRepositoryError(
      "invalid_persisted_server",
      `Persisted mock LLM server ${row.slug} is invalid.`,
      { cause }
    );
  }
};

const assertRequiredRevision = (revision: number): void => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MockLlmRepositoryError(
      "invalid_expected_revision",
      "A mock LLM revision must be a positive safe integer."
    );
  }
};

const assertExpectedRevision = (expectedRevision: number | null): void => {
  if (expectedRevision !== null) assertRequiredRevision(expectedRevision);
};

/**
 * Durable, environment-local mock LLM definitions.
 *
 * Every changed definition consumes a global monotonic LLM revision. Callers
 * must state whether they expect creation (`null`) or a specific current
 * revision. A canonical replay is an idempotent success even when that
 * expectation is stale, so safe retries cannot create false conflicts.
 */
export class MockLlmRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;

  constructor(store: SqlStore, clock: Clock = new SystemClock()) {
    this.#store = store;
    this.#clock = clock;
  }

  put(input: unknown, expectedRevision: number | null): MockLlmServerRecord {
    const spec = parseMockLlmServerSpec(input);
    const serializedSpec = canonicalMockLlmJson(spec);
    assertExpectedRevision(expectedRevision);
    const now = this.#clock.now().toISOString();

    return this.#store.transaction(() => {
      const existing = this.#serverRow(spec.slug);
      const existingRecord = existing ? parseServerRow(existing) : undefined;

      // Replay precedes CAS deliberately. A timed-out successful write can be
      // retried with its now-stale expectation without allocating a revision.
      if (existing?.spec_json === serializedSpec) {
        if (!existingRecord) {
          throw new MockLlmRepositoryError(
            "invalid_persisted_server",
            `Persisted mock LLM server ${spec.slug} disappeared during replay.`
          );
        }
        return existingRecord;
      }

      if (
        (expectedRevision === null && existingRecord) ||
        (expectedRevision !== null &&
          (!existingRecord || existingRecord.revision !== expectedRevision))
      ) {
        throw new MockLlmRepositoryError(
          "server_revision_mismatch",
          expectedRevision === null
            ? `Mock LLM server ${spec.slug} already exists.`
            : `Mock LLM server ${spec.slug} revision ${expectedRevision} is stale.`
        );
      }

      if (!existingRecord) {
        const count = Number(
          this.#store.get<CountRow>("SELECT COUNT(*) AS count FROM mock_llm_servers")
            ?.count ?? 0
        );
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new MockLlmRepositoryError(
            "invalid_persisted_server",
            "The persisted mock LLM server count is invalid."
          );
        }
        if (count >= MOCK_LLM_MAX_SERVERS) {
          throw new MockLlmRepositoryError(
            "server_limit",
            `An environment supports at most ${MOCK_LLM_MAX_SERVERS} mock LLM servers.`
          );
        }
      }

      const revision = this.#allocateRevision();
      const createdAt = existingRecord?.createdAt ?? now;
      this.#store.run(
        `INSERT INTO mock_llm_servers (
          slug, revision, spec_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          revision = excluded.revision,
          spec_json = excluded.spec_json,
          updated_at = excluded.updated_at`,
        spec.slug,
        revision,
        serializedSpec,
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

  get(slug: string): MockLlmServerRecord | undefined {
    mockLlmSlugSchema.parse(slug);
    const row = this.#serverRow(slug);
    return row ? parseServerRow(row) : undefined;
  }

  require(slug: string): MockLlmServerRecord {
    const server = this.get(slug);
    if (!server) {
      throw new MockLlmRepositoryError(
        "server_not_found",
        `Mock LLM server ${slug} does not exist.`
      );
    }
    return server;
  }

  list(): MockLlmServerSummary[] {
    return this.#store
      .all<ServerRow>(
        `SELECT slug, revision, spec_json, created_at, updated_at
         FROM mock_llm_servers
         ORDER BY updated_at DESC, slug
         LIMIT ?`,
        MOCK_LLM_MAX_SERVERS
      )
      .map((row) => toMockLlmServerSummary(parseServerRow(row)));
  }

  delete(slug: string, expectedRevision: number): boolean {
    mockLlmSlugSchema.parse(slug);
    assertRequiredRevision(expectedRevision);
    return this.#store.transaction(() => {
      const current = this.#serverRow(slug);
      if (!current) return false;
      const currentRecord = parseServerRow(current);
      this.#revisionAllocatorState();
      if (currentRecord.revision !== expectedRevision) {
        throw new MockLlmRepositoryError(
          "server_revision_mismatch",
          `Mock LLM server ${slug} revision ${expectedRevision} is stale.`
        );
      }

      const deleted = this.#store.run(
        "DELETE FROM mock_llm_servers WHERE slug = ? AND revision = ?",
        slug,
        expectedRevision
      );
      if (deleted.changes !== 1) {
        throw new MockLlmRepositoryError(
          "invalid_persisted_server",
          `Mock LLM server ${slug} could not be deleted atomically.`
        );
      }
      return true;
    });
  }

  assertServerRevision(slug: string, expectedRevision: number): void {
    mockLlmSlugSchema.parse(slug);
    assertRequiredRevision(expectedRevision);
    const current = this.get(slug);
    if (!current || current.revision !== expectedRevision) {
      throw new MockLlmRepositoryError(
        "server_revision_mismatch",
        `Mock LLM server ${slug} revision ${expectedRevision} is stale.`
      );
    }
  }

  #serverRow(slug: string): ServerRow | undefined {
    return this.#store.get<ServerRow>(
      `SELECT slug, revision, spec_json, created_at, updated_at
       FROM mock_llm_servers
       WHERE slug = ?`,
      slug
    );
  }

  #revisionAllocatorState(): {
    readonly lastRevision: number;
    readonly maximumRevision: number;
  } {
    const allocator = this.#store.get<RevisionAllocatorRow>(
      `SELECT last_revision,
              COALESCE(
                (SELECT MAX(revision) FROM mock_llm_servers),
                0
              ) AS maximum_revision
       FROM mock_llm_revision_allocator
       WHERE singleton = 1`
    );
    const lastRevision = Number(allocator?.last_revision);
    const maximumRevision = Number(allocator?.maximum_revision);
    if (
      !allocator ||
      !Number.isSafeInteger(lastRevision) ||
      lastRevision < 0 ||
      !Number.isSafeInteger(maximumRevision) ||
      maximumRevision < 0 ||
      lastRevision < maximumRevision
    ) {
      throw new MockLlmRepositoryError(
        "invalid_persisted_server",
        "The mock LLM revision allocator is invalid."
      );
    }
    return { lastRevision, maximumRevision };
  }

  #allocateRevision(): number {
    const { lastRevision } = this.#revisionAllocatorState();
    if (lastRevision >= Number.MAX_SAFE_INTEGER) {
      throw new MockLlmRepositoryError(
        "server_revision_limit",
        "The mock LLM server revision capacity has been exhausted."
      );
    }

    const revision = lastRevision + 1;
    const updated = this.#store.run(
      `UPDATE mock_llm_revision_allocator
       SET last_revision = ?
       WHERE singleton = 1 AND last_revision = ?`,
      revision,
      lastRevision
    );
    if (updated.changes !== 1) {
      throw new MockLlmRepositoryError(
        "invalid_persisted_server",
        "The mock LLM revision allocator could not advance."
      );
    }
    return revision;
  }
}
