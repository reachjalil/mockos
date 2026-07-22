import {
  type AssertionResult,
  type AssertionSpec,
  assertionSpecSchema,
  type RequestLogEntry,
  type RequestLogPage,
  type RequestLogQuery,
  requestLogEntrySchema,
  requestLogQuerySchema,
} from "@mockos/contracts";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  utf8Decode,
  utf8Encode,
} from "../security";
import type { SqlRow, SqlStore, SqlValue } from "../store";

type RequestLogRow = SqlRow & {
  sequence: number;
  id: string;
  timestamp: string;
  source: string;
  provider: string;
  method: string;
  path: string;
  request_headers: string;
  request_body: string | null;
  response_status: number;
  response_headers: string;
  response_body: string | null;
  duration_ms: number;
  correlation_id: string;
};

type AssertionMatch = Pick<
  AssertionSpec,
  "source" | "method" | "path" | "status" | "bodyIncludes" | "responseBodyIncludes"
>;

const selectRequestLog = `SELECT sequence, id, timestamp, source, provider,
  method, path, request_headers, request_body, response_status,
  response_headers, response_body, duration_ms, correlation_id FROM request_log`;

/** Capture adapters should truncate or reject each serialized header map above this. */
export const MAX_REQUEST_LOG_HEADER_BYTES = 64 * 1_024;
/** Capture adapters should truncate each request/response body above this. */
export const MAX_REQUEST_LOG_BODY_BYTES = 1_024 * 1_024;
export const MAX_REQUEST_LOG_ENTRY_BYTES =
  2 * MAX_REQUEST_LOG_BODY_BYTES + 2 * MAX_REQUEST_LOG_HEADER_BYTES + 64 * 1_024;
export const MAX_REQUEST_LOG_TOTAL_BYTES = 128 * 1_024 * 1_024;
export const MAX_ASSERTION_REQUEST_IDS = 1_000;

const storedEntryBytesSql = `(length(CAST(id AS BLOB))
  + length(CAST(timestamp AS BLOB)) + length(CAST(source AS BLOB))
  + length(CAST(provider AS BLOB)) + length(CAST(method AS BLOB))
  + length(CAST(path AS BLOB)) + length(CAST(request_headers AS BLOB))
  + COALESCE(length(CAST(request_body AS BLOB)), 0)
  + length(CAST(response_headers AS BLOB))
  + COALESCE(length(CAST(response_body AS BLOB)), 0)
  + length(CAST(correlation_id AS BLOB)) + 512)`;

export class RequestLogEntryTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestLogEntryTooLargeError";
  }
}

const byteLength = (value: string): number => utf8Encode(value).byteLength;

const assertEntrySize = (
  entry: RequestLogEntry,
  requestHeaders: string,
  responseHeaders: string
): void => {
  if (
    byteLength(requestHeaders) > MAX_REQUEST_LOG_HEADER_BYTES ||
    byteLength(responseHeaders) > MAX_REQUEST_LOG_HEADER_BYTES
  ) {
    throw new RequestLogEntryTooLargeError(
      `Serialized request or response headers cannot exceed ${MAX_REQUEST_LOG_HEADER_BYTES} bytes.`
    );
  }
  if (
    (entry.requestBody !== null &&
      byteLength(entry.requestBody) > MAX_REQUEST_LOG_BODY_BYTES) ||
    (entry.responseBody !== null &&
      byteLength(entry.responseBody) > MAX_REQUEST_LOG_BODY_BYTES)
  ) {
    throw new RequestLogEntryTooLargeError(
      `Request or response bodies cannot exceed ${MAX_REQUEST_LOG_BODY_BYTES} bytes.`
    );
  }
  if (byteLength(JSON.stringify(entry)) > MAX_REQUEST_LOG_ENTRY_BYTES) {
    throw new RequestLogEntryTooLargeError(
      `Serialized request log entries cannot exceed ${MAX_REQUEST_LOG_ENTRY_BYTES} bytes.`
    );
  }
};

const parseJsonRecord = (value: string, field: string): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new Error(`Stored request log ${field} is invalid JSON.`, { cause });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Stored request log ${field} must contain string values.`);
  }
  return parsed as Record<string, string>;
};

const toEntry = (row: RequestLogRow): RequestLogEntry =>
  requestLogEntrySchema.parse({
    id: row.id,
    timestamp: row.timestamp,
    source: row.source,
    provider: row.provider,
    method: row.method,
    path: row.path,
    requestHeaders: parseJsonRecord(row.request_headers, "request_headers"),
    requestBody: row.request_body,
    responseStatus: Number(row.response_status),
    responseHeaders: parseJsonRecord(row.response_headers, "response_headers"),
    responseBody: row.response_body,
    durationMs: Number(row.duration_ms),
    correlationId: row.correlation_id,
  });

const hashText = (value: string, seed: number): string => {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const fingerprint = (value: unknown): string => {
  const serialized = canonicalJson(value);
  return `${serialized.length.toString(36)}.${hashText(serialized, 0)}${hashText(
    serialized,
    0x9e37_79b9
  )}`;
};

type CursorPayload = {
  readonly v: 1;
  readonly before: number;
  readonly filter: string;
  readonly check: string;
};

export class RequestLogCursorError extends Error {
  constructor(message = "Request log cursor is invalid.", options?: ErrorOptions) {
    super(message, options);
    this.name = "RequestLogCursorError";
  }
}

const cursorCheck = (before: number, filter: string): string =>
  fingerprint({ namespace: "request-log", v: 1, before, filter });

const encodeCursor = (before: number, filter: string): string =>
  base64UrlEncode(
    utf8Encode(
      canonicalJson({
        v: 1,
        before,
        filter,
        check: cursorCheck(before, filter),
      } satisfies CursorPayload)
    )
  );

const decodeCursor = (cursor: string, expectedFilter: string): CursorPayload => {
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(base64UrlDecode(cursor)));
  } catch (cause) {
    throw new RequestLogCursorError(undefined, { cause });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestLogCursorError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "before,check,filter,v" ||
    record.v !== 1 ||
    !Number.isSafeInteger(record.before) ||
    (record.before as number) < 1 ||
    typeof record.filter !== "string" ||
    typeof record.check !== "string"
  ) {
    throw new RequestLogCursorError();
  }
  if (record.filter !== expectedFilter) {
    throw new RequestLogCursorError(
      "Request log cursor does not match the supplied filters."
    );
  }
  if (record.check !== cursorCheck(record.before as number, record.filter)) {
    throw new RequestLogCursorError();
  }
  return record as CursorPayload;
};

const countExpectation = (spec: AssertionSpec): string => {
  const expected: string[] = [];
  if (spec.count.exactly !== undefined) expected.push(`exactly ${spec.count.exactly}`);
  if (spec.count.atLeast !== undefined) expected.push(`at least ${spec.count.atLeast}`);
  if (spec.count.atMost !== undefined) expected.push(`at most ${spec.count.atMost}`);
  return expected.join(" and ") || "any number of";
};

const assertionWhere = (
  match: AssertionMatch,
  where: string[],
  bindings: SqlValue[]
) => {
  if (match.source) {
    where.push("source = ?");
    bindings.push(match.source);
  }
  if (match.method !== undefined) {
    where.push("method = ?");
    bindings.push(match.method.trim().toUpperCase());
  }
  if (match.path !== undefined) {
    where.push("path = ?");
    bindings.push(match.path);
  }
  if (match.status !== undefined) {
    where.push("response_status = ?");
    bindings.push(match.status);
  }
  if (match.bodyIncludes !== undefined) {
    where.push("request_body IS NOT NULL AND instr(request_body, ?) > 0");
    bindings.push(match.bodyIncludes);
  }
  if (match.responseBodyIncludes !== undefined) {
    where.push("response_body IS NOT NULL AND instr(response_body, ?) > 0");
    bindings.push(match.responseBodyIncludes);
  }
};

/**
 * Synchronous append-only request log with a transactionally trimmed ring.
 * Pagination follows append sequence newest-first, independent of timestamps.
 */
export class RequestLogService {
  readonly #store: SqlStore;
  readonly #limit: number;
  readonly #maxBytes: number;

  constructor(options: {
    readonly store: SqlStore;
    readonly limit: number;
    readonly maxBytes?: number;
  }) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
      throw new Error("Request log limit must be a positive safe integer.");
    }
    const maxBytes = options.maxBytes ?? MAX_REQUEST_LOG_TOTAL_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("Request log byte limit must be a positive safe integer.");
    }
    this.#store = options.store;
    this.#limit = options.limit;
    this.#maxBytes = maxBytes;
  }

  append(entry: RequestLogEntry): RequestLogEntry {
    const normalized = requestLogEntrySchema.parse({
      ...entry,
      method: entry.method.trim().toUpperCase(),
    });
    const requestHeaders = JSON.stringify(normalized.requestHeaders);
    const responseHeaders = JSON.stringify(normalized.responseHeaders);
    assertEntrySize(normalized, requestHeaders, responseHeaders);
    const entryBytes = byteLength(JSON.stringify(normalized));
    if (entryBytes > this.#maxBytes) {
      throw new RequestLogEntryTooLargeError(
        `Serialized request log entries cannot exceed the ${this.#maxBytes}-byte log budget.`
      );
    }
    this.#store.transaction(() => {
      // Trim before inserting so a full ring still has storage headroom for the
      // next entry. The byte budget prevents a high row limit combined with
      // large bodies from exhausting the Durable Object's storage quota.
      this.#store.run(
        `DELETE FROM request_log WHERE sequence IN (
          SELECT sequence FROM (
            SELECT sequence,
              row_number() OVER (ORDER BY sequence DESC) AS row_position,
              sum(${storedEntryBytesSql}) OVER (
                ORDER BY sequence DESC
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS retained_bytes
            FROM request_log
          ) retained
          WHERE row_position >= ? OR retained_bytes > ?
        )`,
        this.#limit,
        Math.max(0, this.#maxBytes - entryBytes)
      );
      this.#store.run(
        `INSERT INTO request_log (
          id, timestamp, source, provider, method, path, request_headers,
          request_body, response_status, response_headers, response_body,
          duration_ms, correlation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        normalized.id,
        normalized.timestamp,
        normalized.source,
        normalized.provider,
        normalized.method,
        normalized.path,
        requestHeaders,
        normalized.requestBody,
        normalized.responseStatus,
        responseHeaders,
        normalized.responseBody,
        normalized.durationMs,
        normalized.correlationId
      );
    });
    return normalized;
  }

  query(input: RequestLogQuery): RequestLogPage {
    const parsed = requestLogQuerySchema.parse(input);
    const method = parsed.method?.toUpperCase();
    const filter = fingerprint({
      source: parsed.source ?? null,
      provider: parsed.provider ?? null,
      method: method ?? null,
      path: parsed.path ?? null,
      status: parsed.status ?? null,
    });
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor, filter) : undefined;
    const where: string[] = [];
    const bindings: SqlValue[] = [];
    if (parsed.source) {
      where.push("source = ?");
      bindings.push(parsed.source);
    }
    if (parsed.provider) {
      where.push("provider = ?");
      bindings.push(parsed.provider);
    }
    if (method) {
      where.push("method = ?");
      bindings.push(method);
    }
    if (parsed.path) {
      where.push("path = ?");
      bindings.push(parsed.path);
    }
    if (parsed.status !== undefined) {
      where.push("response_status = ?");
      bindings.push(parsed.status);
    }
    if (cursor) {
      where.push("sequence < ?");
      bindings.push(cursor.before);
    }
    const rows = this.#store.all<RequestLogRow>(
      `${selectRequestLog}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
       ORDER BY sequence DESC LIMIT ?`,
      ...bindings,
      parsed.limit + 1
    );
    const hasMore = rows.length > parsed.limit;
    const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;
    const lastSequence = pageRows.at(-1)?.sequence;
    return {
      entries: pageRows.map(toEntry),
      ...(hasMore && lastSequence !== undefined
        ? {
            nextCursor: encodeCursor(Number(lastSequence), filter),
          }
        : {}),
    };
  }

  /**
   * Matches request attributes exactly; bodyIncludes is a literal,
   * case-sensitive substring search over the stored request body. Sequence
   * assertions count greedy-earliest, non-overlapping subsequences in append
   * order; request IDs are returned only for complete sequence matches.
   */
  assertRequests(input: AssertionSpec): AssertionResult {
    const spec = assertionSpecSchema.parse(input);
    if (spec.sequence) {
      const { matched, requestIds, partialSteps, truncated } = this.#store.transaction(
        () => {
          const requestIds: string[] = [];
          let matched = 0;
          let afterSequence = 0;
          let partialSteps = 0;
          let truncated = false;
          while (true) {
            const candidateIds: string[] = [];
            let candidateAfterSequence = afterSequence;
            for (const step of spec.sequence ?? []) {
              const where = ["sequence > ?"];
              const bindings: SqlValue[] = [candidateAfterSequence];
              assertionWhere(spec, where, bindings);
              assertionWhere(step, where, bindings);
              const row = this.#store.get<{ id: string; sequence: number } & SqlRow>(
                `SELECT id, sequence FROM request_log
                 WHERE ${where.join(" AND ")}
                 ORDER BY sequence ASC LIMIT 1`,
                ...bindings
              );
              if (!row) {
                partialSteps = candidateIds.length;
                return { matched, requestIds, partialSteps, truncated };
              }
              candidateIds.push(row.id);
              candidateAfterSequence = Number(row.sequence);
            }
            matched += 1;
            afterSequence = candidateAfterSequence;
            const remainingIds = MAX_ASSERTION_REQUEST_IDS - requestIds.length;
            if (remainingIds > 0) {
              requestIds.push(...candidateIds.slice(0, remainingIds));
            }
            if (candidateIds.length > remainingIds) truncated = true;
          }
        }
      );
      const pass =
        (spec.count.exactly === undefined || matched === spec.count.exactly) &&
        (spec.count.atLeast === undefined || matched >= spec.count.atLeast) &&
        (spec.count.atMost === undefined || matched <= spec.count.atMost);
      const expected = countExpectation(spec);
      const partial =
        partialSteps > 0
          ? ` The next candidate matched ${partialSteps} of ${spec.sequence.length} step(s).`
          : "";
      const returned = truncated
        ? ` Returning the first ${MAX_ASSERTION_REQUEST_IDS} request IDs from complete matches.`
        : "";
      return {
        pass,
        matched,
        message: pass
          ? `Matched ${matched} non-overlapping ordered request sequence(s); expected ${expected}.${partial}${returned}`
          : `Expected ${expected} non-overlapping ordered request sequence(s), found ${matched}.${partial}${returned}`,
        requestIds,
      };
    }
    const where: string[] = [];
    const bindings: SqlValue[] = [];
    assertionWhere(spec, where, bindings);
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const { matched, rows } = this.#store.transaction(() => {
      const matched = Number(
        this.#store.get<{ count: number } & SqlRow>(
          `SELECT count(*) AS count FROM request_log${whereSql}`,
          ...bindings
        )?.count ?? 0
      );
      const rows = this.#store.all<{ id: string } & SqlRow>(
        `SELECT id FROM request_log${whereSql}
         ORDER BY sequence DESC LIMIT ?`,
        ...bindings,
        MAX_ASSERTION_REQUEST_IDS
      );
      return { matched, rows };
    });
    const pass =
      (spec.count.exactly === undefined || matched === spec.count.exactly) &&
      (spec.count.atLeast === undefined || matched >= spec.count.atLeast) &&
      (spec.count.atMost === undefined || matched <= spec.count.atMost);
    const expected = countExpectation(spec);
    const truncated = matched > rows.length;
    return {
      pass,
      matched,
      message: pass
        ? `Matched ${matched} request(s); expected ${expected}.${
            truncated
              ? ` Returning the newest ${MAX_ASSERTION_REQUEST_IDS} request IDs.`
              : ""
          }`
        : `Expected ${expected} matching request(s), found ${matched}.${
            truncated
              ? ` Returning the newest ${MAX_ASSERTION_REQUEST_IDS} request IDs.`
              : ""
          }`,
      requestIds: rows.map(({ id }) => id),
    };
  }

  assert(input: AssertionSpec): AssertionResult {
    return this.assertRequests(input);
  }
}
