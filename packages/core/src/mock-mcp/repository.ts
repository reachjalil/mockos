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
  type JsonValue,
  jsonValueSchema,
} from "@mockos/contracts/behavior";
import type { Clock, Rng } from "../determinism";
import { CryptoRng, SystemClock } from "../determinism";
import { base64UrlEncode, canonicalJson, hashSecret } from "../security";
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

type SessionRow = SqlRow & {
  readonly server_slug: string;
  readonly server_revision: number;
  readonly protocol_version: string;
  readonly initialized: number;
  readonly created_at: string;
  readonly expires_at: string;
  readonly terminated_at: string | null;
};

type CountRow = SqlRow & {
  readonly count: number;
};

type RevisionAllocatorRow = SqlRow & {
  readonly last_revision: number;
  readonly maximum_revision: number;
};

type StateUsageRow = SqlRow & {
  readonly count: number;
  readonly bytes: number;
};

export const MOCK_STATE_MAX_BYTES = 64 * 1024;
export const MOCK_STATE_MAX_DEPTH = 16;
export const MOCK_STATE_MAX_NODES = 5_000;
export const MOCK_MCP_MAX_STATE_ROWS_PER_SERVER = 256;
export const MOCK_MCP_MAX_STATE_BYTES_PER_SERVER = 2 * 1024 * 1024;
export const MOCK_MCP_SESSION_ID_BYTES = 32;
export const MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER = 100;
export const MOCK_MCP_SESSION_PRUNE_BATCH_SIZE = 100;
export const MOCK_MCP_MAX_SESSION_PRUNE_BATCH_SIZE = 1_000;

const sessionIdPattern = /^[A-Za-z0-9_-]{43}$/;
const protocolVersionPattern = /^[A-Za-z0-9._-]{1,64}$/;

export interface MockMcpSession {
  readonly serverSlug: string;
  readonly serverRevision: number;
  readonly protocolVersion: string;
  readonly initialized: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateMockMcpSessionInput {
  readonly serverSlug: string;
  /**
   * Revision used to render the initialize response. Issuance fails if a
   * replacement or recreated generation became current before this transaction.
   */
  readonly serverRevision: number;
  readonly protocolVersion: string;
}

export interface CreatedMockMcpSession {
  /** Opaque bearer capability returned only at creation. */
  readonly sessionId: string;
  readonly session: MockMcpSession;
}

export interface LookupMockMcpSessionInput {
  readonly serverSlug: string;
  readonly sessionId: string;
  readonly protocolVersion: string;
}

export type MockMcpSessionUnavailableStatus =
  | "missing"
  | "expired"
  | "stale"
  | "terminated"
  | "protocol_version_mismatch";

export type MockMcpSessionLookupResult =
  | {
      readonly status: "active";
      readonly session: MockMcpSession;
    }
  | {
      readonly status: MockMcpSessionUnavailableStatus;
    };

export type MockMcpSessionTerminationResult =
  | {
      readonly status: "terminated";
    }
  | {
      readonly status:
        | Exclude<MockMcpSessionUnavailableStatus, "terminated">
        | "already_terminated";
    };

const parseServerRow = (row: ServerRow): MockMcpServerRecord =>
  mockMcpServerRecordSchema.parse({
    spec: JSON.parse(row.spec_json),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const isProtocolVersion = (value: string): boolean =>
  protocolVersionPattern.test(value);

const parseSessionRow = (row: SessionRow): MockMcpSession => {
  const serverRevision = Number(row.server_revision);
  const initialized = Number(row.initialized);
  if (
    !Number.isSafeInteger(serverRevision) ||
    serverRevision < 1 ||
    !isProtocolVersion(row.protocol_version) ||
    (initialized !== 0 && initialized !== 1) ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    !Number.isFinite(Date.parse(row.expires_at))
  ) {
    throw new Error("Persisted mock MCP session fields are invalid.");
  }
  return {
    serverSlug: mockMcpSlugSchema.parse(row.server_slug),
    serverRevision,
    protocolVersion: row.protocol_version,
    initialized: initialized === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
};

export class MockMcpRepositoryError extends Error {
  constructor(
    readonly code:
      | "server_limit"
      | "server_revision_limit"
      | "server_not_found"
      | "server_revision_mismatch"
      | "invalid_expected_revision"
      | "sessions_disabled"
      | "session_limit"
      | "invalid_session"
      | "invalid_persisted_session"
      | "invalid_persisted_server"
      | "invalid_state"
      | "state_limit",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockMcpRepositoryError";
  }
}

const assertRequiredRevision = (revision: number): void => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new MockMcpRepositoryError(
      "invalid_expected_revision",
      "A mock MCP revision must be a positive safe integer."
    );
  }
};

const assertExpectedRevision = (expectedRevision: number | null): void => {
  if (expectedRevision !== null) assertRequiredRevision(expectedRevision);
};

/**
 * Durable, environment-local mock MCP configuration and application state.
 * New and changed specs consume one durable environment-wide revision. Replacing
 * a spec is an atomic boundary: old state is removed and old protocol sessions
 * are terminated before the new revision becomes visible. Callers must state
 * create-only (`null`) or a specific current replacement revision. A canonical
 * replay succeeds before that CAS check so a timed-out write remains retry-safe.
 */
export class MockMcpRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;

  constructor(
    store: SqlStore,
    clock: Clock = new SystemClock(),
    rng: Rng = new CryptoRng()
  ) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  put(input: unknown, expectedRevision: number | null): MockMcpServerRecord {
    const spec = parseMockMcpServerSpec(input);
    const serializedSpec = canonicalJson(spec);
    assertExpectedRevision(expectedRevision);
    const now = this.#clock.now().toISOString();
    return this.#store.transaction(() => {
      const existing = this.#serverRow(spec.slug);
      const existingRecord = existing ? parseServerRow(existing) : undefined;

      // Canonical convergence precedes CAS deliberately. This keeps ambiguous
      // write retries idempotent and also treats an identical delete/recreate
      // generation as already converged. Only a changed definition is allowed
      // to fail a stale or ABA expectation.
      if (existing?.spec_json === serializedSpec) {
        if (!existingRecord) {
          throw new MockMcpRepositoryError(
            "invalid_persisted_server",
            `Persisted mock MCP server ${spec.slug} disappeared during replay.`
          );
        }
        return existingRecord;
      }

      if (
        (expectedRevision === null && existingRecord) ||
        (expectedRevision !== null &&
          (!existingRecord || existingRecord.revision !== expectedRevision))
      ) {
        throw new MockMcpRepositoryError(
          "server_revision_mismatch",
          expectedRevision === null
            ? `Mock MCP server ${spec.slug} already exists.`
            : `Mock MCP server ${spec.slug} revision ${expectedRevision} is stale.`
        );
      }

      if (!existingRecord) {
        const count = Number(
          this.#store.get<CountRow>("SELECT COUNT(*) AS count FROM mock_mcp_servers")
            ?.count ?? 0
        );
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new MockMcpRepositoryError(
            "invalid_persisted_server",
            "The persisted mock MCP server count is invalid."
          );
        }
        if (count >= MOCK_MCP_MAX_SERVERS) {
          throw new MockMcpRepositoryError(
            "server_limit",
            `An environment supports at most ${MOCK_MCP_MAX_SERVERS} mock MCP servers.`
          );
        }
      }

      const revision = this.#allocateRevision();
      const createdAt = existingRecord?.createdAt ?? now;
      if (existingRecord) {
        this.#store.run("DELETE FROM mock_state WHERE server_slug = ?", spec.slug);
        this.#store.run(
          `UPDATE mock_mcp_sessions
           SET terminated_at = COALESCE(terminated_at, ?)
          WHERE server_slug = ? AND server_revision = ?`,
          now,
          spec.slug,
          existingRecord.revision
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

  /**
   * Closes the final response race after async authentication, evaluation, or
   * latency. When called inside `transaction()`, the revision check and any
   * staged state writes share the same synchronous SQL transaction.
   */
  assertServerRevision(slug: string, expectedRevision: number): void {
    mockMcpSlugSchema.parse(slug);
    assertRequiredRevision(expectedRevision);
    const current = this.#serverRow(slug);
    if (!current || Number(current.revision) !== expectedRevision) {
      throw new MockMcpRepositoryError(
        "server_revision_mismatch",
        `Mock MCP server ${slug} revision ${expectedRevision} is stale.`
      );
    }
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

  delete(slug: string, expectedRevision: number): true {
    mockMcpSlugSchema.parse(slug);
    assertRequiredRevision(expectedRevision);
    return this.#store.transaction(() => {
      const current = this.#serverRow(slug);
      if (!current) {
        throw new MockMcpRepositoryError(
          "server_not_found",
          `Mock MCP server ${slug} does not exist.`
        );
      }
      const currentRecord = parseServerRow(current);
      this.#revisionAllocatorState();
      if (currentRecord.revision !== expectedRevision) {
        throw new MockMcpRepositoryError(
          "server_revision_mismatch",
          `Mock MCP server ${slug} revision ${expectedRevision} is stale.`
        );
      }

      this.#store.run("DELETE FROM mock_state WHERE server_slug = ?", slug);
      this.#store.run("DELETE FROM mock_mcp_sessions WHERE server_slug = ?", slug);
      const deleted = this.#store.run(
        "DELETE FROM mock_mcp_servers WHERE slug = ? AND revision = ?",
        slug,
        expectedRevision
      );
      if (deleted.changes !== 1) {
        throw new MockMcpRepositoryError(
          "invalid_persisted_server",
          `Mock MCP server ${slug} could not be deleted atomically.`
        );
      }
      return true;
    });
  }

  resetState(slug: string, expectedRevision: number): number {
    mockMcpSlugSchema.parse(slug);
    assertRequiredRevision(expectedRevision);
    return this.#store.transaction(() => {
      const current = this.#serverRow(slug);
      if (!current) {
        throw new MockMcpRepositoryError(
          "server_not_found",
          `Mock MCP server ${slug} does not exist.`
        );
      }
      const currentRecord = parseServerRow(current);
      this.#revisionAllocatorState();
      if (currentRecord.revision !== expectedRevision) {
        throw new MockMcpRepositoryError(
          "server_revision_mismatch",
          `Mock MCP server ${slug} revision ${expectedRevision} is stale.`
        );
      }
      return this.#store.run(
        "DELETE FROM mock_state WHERE server_slug = ? AND server_revision = ?",
        slug,
        expectedRevision
      ).changes;
    });
  }

  /**
   * Atomically issues a revision-bound transport session.
   *
   * The raw 32-byte bearer ID is generated and hashed before entering the
   * synchronous SQL transaction. Only its SHA-256 digest enters persistence.
   */
  async createSession(
    input: CreateMockMcpSessionInput
  ): Promise<CreatedMockMcpSession> {
    mockMcpSlugSchema.parse(input.serverSlug);
    if (
      !Number.isSafeInteger(input.serverRevision) ||
      input.serverRevision < 1 ||
      !isProtocolVersion(input.protocolVersion)
    ) {
      throw new MockMcpRepositoryError(
        "invalid_session",
        "Mock MCP session creation input is invalid."
      );
    }

    const sessionBytes = this.#rng.bytes(MOCK_MCP_SESSION_ID_BYTES);
    if (sessionBytes.byteLength !== MOCK_MCP_SESSION_ID_BYTES) {
      throw new MockMcpRepositoryError(
        "invalid_session",
        `Mock MCP session ID generation must produce exactly ${MOCK_MCP_SESSION_ID_BYTES} bytes.`
      );
    }
    const sessionId = base64UrlEncode(sessionBytes);
    const sessionHash = await hashSecret(sessionId);
    return this.#store.transaction(() => {
      const server = this.require(input.serverSlug);
      if (server.revision !== input.serverRevision) {
        throw new MockMcpRepositoryError(
          "server_revision_mismatch",
          `Mock MCP server ${input.serverSlug} revision ${input.serverRevision} is stale.`
        );
      }
      if (!server.spec.transport.stateful) {
        throw new MockMcpRepositoryError(
          "sessions_disabled",
          `Mock MCP server ${input.serverSlug} does not use transport sessions.`
        );
      }

      const createdAt = this.#clock.now();
      const createdAtIso = createdAt.toISOString();
      this.#pruneSessionRows(
        createdAtIso,
        MOCK_MCP_SESSION_PRUNE_BATCH_SIZE,
        input.serverSlug
      );
      const activeCount = Number(
        this.#store.get<CountRow>(
          `SELECT COUNT(*) AS count
           FROM mock_mcp_sessions
           WHERE server_slug = ?
             AND terminated_at IS NULL
             AND expires_at > ?`,
          input.serverSlug,
          createdAtIso
        )?.count ?? 0
      );
      if (activeCount >= MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER) {
        throw new MockMcpRepositoryError(
          "session_limit",
          `Mock MCP server ${input.serverSlug} supports at most ${MOCK_MCP_MAX_ACTIVE_SESSIONS_PER_SERVER} active sessions.`
        );
      }

      const expiresAt = new Date(
        createdAt.getTime() + server.spec.transport.sessionTtlSeconds * 1_000
      ).toISOString();
      this.#store.run(
        `INSERT INTO mock_mcp_sessions (
          session_hash, server_slug, server_revision, protocol_version,
          initialized, created_at, expires_at, terminated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, NULL)`,
        sessionHash,
        input.serverSlug,
        server.revision,
        input.protocolVersion,
        createdAtIso,
        expiresAt
      );
      return {
        sessionId,
        session: {
          serverSlug: input.serverSlug,
          serverRevision: server.revision,
          protocolVersion: input.protocolVersion,
          initialized: false,
          createdAt: createdAtIso,
          expiresAt,
        },
      };
    });
  }

  async getSession(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionLookupResult> {
    const sessionHash = await this.#sessionHash(input.sessionId);
    if (!sessionHash) return { status: "missing" };
    return this.#store.transaction(() =>
      this.#lookupSession(input, sessionHash, this.#clock.now().toISOString())
    );
  }

  async markInitialized(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionLookupResult> {
    const sessionHash = await this.#sessionHash(input.sessionId);
    if (!sessionHash) return { status: "missing" };
    return this.#store.transaction(() => {
      const now = this.#clock.now().toISOString();
      const result = this.#lookupSession(input, sessionHash, now);
      if (result.status !== "active" || result.session.initialized) return result;
      const updated = this.#store.run(
        `UPDATE mock_mcp_sessions
         SET initialized = 1
         WHERE session_hash = ?
           AND server_slug = ?
           AND server_revision = ?
           AND protocol_version = ?
           AND initialized = 0
           AND terminated_at IS NULL
           AND expires_at > ?`,
        sessionHash,
        input.serverSlug,
        result.session.serverRevision,
        input.protocolVersion,
        now
      );
      if (updated.changes !== 1) {
        throw new MockMcpRepositoryError(
          "invalid_persisted_session",
          `Persisted mock MCP session for ${input.serverSlug} could not be initialized.`
        );
      }
      return {
        status: "active",
        session: { ...result.session, initialized: true },
      };
    });
  }

  async terminateSession(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionTerminationResult> {
    const sessionHash = await this.#sessionHash(input.sessionId);
    if (!sessionHash) return { status: "missing" };
    return this.#store.transaction(() => {
      const now = this.#clock.now().toISOString();
      const result = this.#lookupSession(input, sessionHash, now);
      if (result.status === "terminated") {
        return { status: "already_terminated" };
      }
      if (result.status !== "active") return result;
      const updated = this.#store.run(
        `UPDATE mock_mcp_sessions
         SET terminated_at = ?
         WHERE session_hash = ?
           AND server_slug = ?
           AND server_revision = ?
           AND protocol_version = ?
           AND terminated_at IS NULL
           AND expires_at > ?`,
        now,
        sessionHash,
        input.serverSlug,
        result.session.serverRevision,
        input.protocolVersion,
        now
      );
      if (updated.changes !== 1) {
        throw new MockMcpRepositoryError(
          "invalid_persisted_session",
          `Persisted mock MCP session for ${input.serverSlug} could not be terminated.`
        );
      }
      return { status: "terminated" };
    });
  }

  /**
   * Deletes at most `limit` expired or terminated rows across the environment.
   * Active sessions and their cap are unaffected.
   */
  pruneSessions(limit = MOCK_MCP_SESSION_PRUNE_BATCH_SIZE): number {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MOCK_MCP_MAX_SESSION_PRUNE_BATCH_SIZE
    ) {
      throw new MockMcpRepositoryError(
        "invalid_session",
        `Mock MCP session prune limit must be between 1 and ${MOCK_MCP_MAX_SESSION_PRUNE_BATCH_SIZE}.`
      );
    }
    return this.#store.transaction(() =>
      this.#pruneSessionRows(this.#clock.now().toISOString(), limit)
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
    const serialized = canonicalJson(validated);
    const existing = this.#store.get<StateRow>(
      `SELECT value_json
       FROM mock_state
       WHERE server_slug = ? AND server_revision = ? AND state_key = ?`,
      slug,
      revision,
      key
    );
    const usage = this.#store.get<StateUsageRow>(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(length(CAST(value_json AS BLOB))), 0) AS bytes
       FROM mock_state
       WHERE server_slug = ? AND server_revision = ?`,
      slug,
      revision
    );
    const projectedRows = Number(usage?.count ?? 0) + (existing ? 0 : 1);
    const projectedBytes =
      Number(usage?.bytes ?? 0) -
      (existing ? new TextEncoder().encode(existing.value_json).byteLength : 0) +
      new TextEncoder().encode(serialized).byteLength;
    if (
      projectedRows > MOCK_MCP_MAX_STATE_ROWS_PER_SERVER ||
      projectedBytes > MOCK_MCP_MAX_STATE_BYTES_PER_SERVER
    ) {
      throw new MockMcpRepositoryError(
        "state_limit",
        `Mock MCP server ${slug} state exceeds its bounded storage capacity.`
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
      serialized,
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

  #revisionAllocatorState(): {
    readonly lastRevision: number;
    readonly maximumRevision: number;
  } {
    const allocator = this.#store.get<RevisionAllocatorRow>(
      `SELECT last_revision,
              COALESCE(
                (SELECT MAX(revision) FROM mock_mcp_servers),
                0
              ) AS maximum_revision
       FROM mock_mcp_revision_allocator
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
      throw new MockMcpRepositoryError(
        "invalid_persisted_server",
        "The mock MCP revision allocator is invalid."
      );
    }
    return { lastRevision, maximumRevision };
  }

  #allocateRevision(): number {
    const { lastRevision } = this.#revisionAllocatorState();
    if (lastRevision >= Number.MAX_SAFE_INTEGER) {
      throw new MockMcpRepositoryError(
        "server_revision_limit",
        "The mock MCP server revision capacity has been exhausted."
      );
    }
    const revision = lastRevision + 1;
    const updated = this.#store.run(
      `UPDATE mock_mcp_revision_allocator
       SET last_revision = ?
       WHERE singleton = 1 AND last_revision = ?`,
      revision,
      lastRevision
    );
    if (updated.changes !== 1) {
      throw new MockMcpRepositoryError(
        "invalid_persisted_server",
        "The mock MCP revision allocator could not advance."
      );
    }
    return revision;
  }

  async #sessionHash(sessionId: string): Promise<string | undefined> {
    if (!sessionIdPattern.test(sessionId)) return undefined;
    return hashSecret(sessionId);
  }

  #lookupSession(
    input: LookupMockMcpSessionInput,
    sessionHash: string,
    now: string
  ): MockMcpSessionLookupResult {
    mockMcpSlugSchema.parse(input.serverSlug);
    const row = this.#store.get<SessionRow>(
      `SELECT server_slug, server_revision, protocol_version, initialized,
              created_at, expires_at, terminated_at
       FROM mock_mcp_sessions
       WHERE session_hash = ? AND server_slug = ?`,
      sessionHash,
      input.serverSlug
    );
    if (!row) return { status: "missing" };

    // Classification precedence is deliberate and stable for transport mapping:
    // a foreign binding is missing; replacement is stale even though put()
    // terminates the old row; then negotiated version, explicit termination,
    // expiry, and finally active metadata are considered.
    const server = this.#serverRow(input.serverSlug);
    if (!server || Number(row.server_revision) !== Number(server.revision)) {
      return { status: "stale" };
    }
    if (
      !isProtocolVersion(input.protocolVersion) ||
      row.protocol_version !== input.protocolVersion
    ) {
      return { status: "protocol_version_mismatch" };
    }
    if (row.terminated_at !== null) return { status: "terminated" };
    if (Date.parse(row.expires_at) <= Date.parse(now)) {
      return { status: "expired" };
    }
    try {
      return { status: "active", session: parseSessionRow(row) };
    } catch (cause) {
      throw new MockMcpRepositoryError(
        "invalid_persisted_session",
        `Persisted mock MCP session for ${input.serverSlug} is invalid.`,
        { cause }
      );
    }
  }

  #pruneSessionRows(now: string, limit: number, serverSlug?: string): number {
    const slugPredicate = serverSlug === undefined ? "" : "AND server_slug = ?";
    const bindings = serverSlug === undefined ? [now, limit] : [now, serverSlug, limit];
    const expired = this.#store.run(
      `DELETE FROM mock_mcp_sessions
       WHERE session_hash IN (
         SELECT session_hash
         FROM mock_mcp_sessions
         WHERE expires_at <= ? ${slugPredicate}
         ORDER BY expires_at, created_at, session_hash
         LIMIT ?
       )`,
      ...bindings
    ).changes;
    const remaining = limit - expired;
    if (remaining <= 0) return expired;

    const terminatedBindings =
      serverSlug === undefined ? [remaining] : [serverSlug, remaining];
    const terminated = this.#store.run(
      `DELETE FROM mock_mcp_sessions
       WHERE session_hash IN (
         SELECT session_hash
         FROM mock_mcp_sessions
         WHERE terminated_at IS NOT NULL ${slugPredicate}
         ORDER BY terminated_at, created_at, session_hash
         LIMIT ?
       )`,
      ...terminatedBindings
    ).changes;
    return expired + terminated;
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
