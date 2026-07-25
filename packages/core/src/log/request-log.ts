import {
  type AssertionResult,
  type AssertionSpec,
  assertionSpecSchema,
  REQUEST_LOG_LLM_PENDING_DURATION_MS,
  REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
  type RequestLogEntry,
  type RequestLogLlmFinalization,
  type RequestLogLlmReservation,
  type RequestLogPage,
  type RequestLogQuery,
  requestLogEntrySchema,
  requestLogLlmFinalizationSchema,
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
  protocol: string | null;
  mcp_method: string | null;
  mcp_tool: string | null;
  mcp_arguments_json: string | null;
  mcp_error_code: number | null;
  mcp_tool_is_error: number | null;
  llm_dialect: string | null;
  llm_operation: string | null;
  llm_server_slug: string | null;
  llm_server_revision: number | null;
  llm_model: string | null;
  llm_stream: number | null;
  llm_turn_index: number | null;
  llm_outcome: string | null;
  llm_response_id: string | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  llm_stop_reason: string | null;
  llm_tool_names_json: string | null;
  llm_error_kind: string | null;
};

type AssertionMatch = Pick<
  AssertionSpec,
  | "source"
  | "method"
  | "path"
  | "status"
  | "bodyIncludes"
  | "responseBodyIncludes"
  | "mcpMethod"
  | "mcpTool"
  | "mcpArguments"
  | "llmDialect"
  | "llmOperation"
  | "llmServerSlug"
  | "llmServerRevision"
  | "llmModel"
  | "llmStream"
  | "llmTurnIndex"
  | "llmOutcome"
  | "llmResponseId"
  | "llmInputTokens"
  | "llmOutputTokens"
  | "llmStopReason"
  | "llmToolNames"
  | "llmErrorKind"
>;

const requestLogJoin = `request_log
  LEFT JOIN request_log_llm_terminal
    ON request_log_llm_terminal.request_id = request_log.id`;

const selectRequestLog = `SELECT request_log.sequence, request_log.id,
  request_log.timestamp, request_log.source, request_log.provider,
  request_log.method, request_log.path, request_log.request_headers,
  request_log.request_body,
  COALESCE(request_log_llm_terminal.response_status, request_log.response_status)
    AS response_status,
  request_log.response_headers, request_log.response_body,
  COALESCE(request_log_llm_terminal.duration_ms, request_log.duration_ms)
    AS duration_ms,
  request_log.correlation_id, request_log.protocol, request_log.mcp_method,
  request_log.mcp_tool, request_log.mcp_arguments_json,
  request_log.mcp_error_code, request_log.mcp_tool_is_error,
  request_log.llm_dialect, request_log.llm_operation,
  request_log.llm_server_slug, request_log.llm_server_revision,
  request_log.llm_model, request_log.llm_stream, request_log.llm_turn_index,
  COALESCE(request_log_llm_terminal.llm_outcome, request_log.llm_outcome)
    AS llm_outcome,
  request_log.llm_response_id, request_log.llm_input_tokens,
  request_log.llm_output_tokens, request_log.llm_stop_reason,
  request_log.llm_tool_names_json, request_log.llm_error_kind
  FROM ${requestLogJoin}`;

const effectiveLlmOutcomeSql =
  "COALESCE(request_log_llm_terminal.llm_outcome, request_log.llm_outcome)";
const effectiveResponseStatusSql =
  "COALESCE(request_log_llm_terminal.response_status, request_log.response_status)";

/** Capture adapters should truncate or reject each serialized header map above this. */
export const MAX_REQUEST_LOG_HEADER_BYTES = 64 * 1_024;
/** Capture adapters should truncate each request/response body above this. */
export const MAX_REQUEST_LOG_BODY_BYTES = 1_024 * 1_024;
export const MAX_REQUEST_LOG_ENTRY_BYTES =
  2 * MAX_REQUEST_LOG_BODY_BYTES + 2 * MAX_REQUEST_LOG_HEADER_BYTES + 64 * 1_024;
export const MAX_REQUEST_LOG_TOTAL_BYTES = 128 * 1_024 * 1_024;
export const MAX_ASSERTION_REQUEST_IDS = 1_000;
const REQUEST_LOG_LLM_TERMINAL_FIXED_BYTES = 256;

const storedEntryBytesSql = `(length(CAST(id AS BLOB))
  + length(CAST(timestamp AS BLOB)) + length(CAST(source AS BLOB))
  + length(CAST(provider AS BLOB)) + length(CAST(method AS BLOB))
  + length(CAST(path AS BLOB)) + length(CAST(request_headers AS BLOB))
  + COALESCE(length(CAST(request_body AS BLOB)), 0)
  + length(CAST(response_headers AS BLOB))
  + COALESCE(length(CAST(response_body AS BLOB)), 0)
  + COALESCE(length(CAST(protocol AS BLOB)), 0)
  + COALESCE(length(CAST(mcp_method AS BLOB)), 0)
  + COALESCE(length(CAST(mcp_tool AS BLOB)), 0)
  + COALESCE(length(CAST(mcp_arguments_json AS BLOB)), 0)
  + COALESCE(length(CAST(llm_dialect AS BLOB)), 0)
  + COALESCE(length(CAST(llm_operation AS BLOB)), 0)
  + COALESCE(length(CAST(llm_server_slug AS BLOB)), 0)
  + COALESCE(length(CAST(llm_model AS BLOB)), 0)
  + COALESCE(length(CAST(llm_outcome AS BLOB)), 0)
  + COALESCE(length(CAST(llm_response_id AS BLOB)), 0)
  + COALESCE(length(CAST(llm_stop_reason AS BLOB)), 0)
  + COALESCE(length(CAST(llm_tool_names_json AS BLOB)), 0)
  + COALESCE(length(CAST(llm_error_kind AS BLOB)), 0)
  + CASE WHEN llm_dialect IS NULL THEN 0
      ELSE length(CAST(id AS BLOB)) + 256 END
  + length(CAST(correlation_id AS BLOB)) + 512)`;

export class RequestLogEntryTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestLogEntryTooLargeError";
  }
}

export class RequestLogLlmFinalizationConflictError extends Error {
  constructor(
    message = "LLM request-log observation was already finalized differently."
  ) {
    super(message);
    this.name = "RequestLogLlmFinalizationConflictError";
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

const parseJsonStringArray = (value: string, field: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new Error(`Stored request log ${field} is invalid JSON.`, { cause });
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Stored request log ${field} must contain string values.`);
  }
  return parsed;
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
    ...(row.protocol === null ? {} : { protocol: row.protocol }),
    ...(row.mcp_method === null ? {} : { mcpMethod: row.mcp_method }),
    ...(row.mcp_tool === null ? {} : { mcpTool: row.mcp_tool }),
    ...(row.mcp_arguments_json === null
      ? {}
      : { mcpArguments: JSON.parse(row.mcp_arguments_json) }),
    ...(row.mcp_error_code === null
      ? {}
      : { mcpErrorCode: Number(row.mcp_error_code) }),
    ...(row.mcp_tool_is_error === null
      ? {}
      : { mcpToolIsError: Number(row.mcp_tool_is_error) === 1 }),
    ...(row.llm_dialect === null ? {} : { llmDialect: row.llm_dialect }),
    ...(row.llm_operation === null ? {} : { llmOperation: row.llm_operation }),
    ...(row.llm_server_slug === null ? {} : { llmServerSlug: row.llm_server_slug }),
    ...(row.llm_server_revision === null
      ? {}
      : { llmServerRevision: Number(row.llm_server_revision) }),
    ...(row.llm_model === null ? {} : { llmModel: row.llm_model }),
    ...(row.llm_stream === null ? {} : { llmStream: Number(row.llm_stream) === 1 }),
    ...(row.llm_turn_index === null
      ? {}
      : { llmTurnIndex: Number(row.llm_turn_index) }),
    ...(row.llm_outcome === null ? {} : { llmOutcome: row.llm_outcome }),
    ...(row.llm_response_id === null ? {} : { llmResponseId: row.llm_response_id }),
    ...(row.llm_input_tokens === null
      ? {}
      : { llmInputTokens: Number(row.llm_input_tokens) }),
    ...(row.llm_output_tokens === null
      ? {}
      : { llmOutputTokens: Number(row.llm_output_tokens) }),
    ...(row.llm_stop_reason === null ? {} : { llmStopReason: row.llm_stop_reason }),
    ...(row.llm_tool_names_json === null
      ? {}
      : {
          llmToolNames: parseJsonStringArray(
            row.llm_tool_names_json,
            "llm_tool_names_json"
          ),
        }),
    ...(row.llm_error_kind === null ? {} : { llmErrorKind: row.llm_error_kind }),
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
    where.push("request_log.source = ?");
    bindings.push(match.source);
  }
  if (match.method !== undefined) {
    where.push("request_log.method = ?");
    bindings.push(match.method.trim().toUpperCase());
  }
  if (match.path !== undefined) {
    where.push("request_log.path = ?");
    bindings.push(match.path);
  }
  if (match.status !== undefined) {
    where.push(`${effectiveResponseStatusSql} = ?`);
    bindings.push(match.status);
  }
  if (match.bodyIncludes !== undefined) {
    where.push(
      "request_log.request_body IS NOT NULL AND instr(request_log.request_body, ?) > 0"
    );
    bindings.push(match.bodyIncludes);
  }
  if (match.responseBodyIncludes !== undefined) {
    where.push(
      "request_log.response_body IS NOT NULL AND instr(request_log.response_body, ?) > 0"
    );
    bindings.push(match.responseBodyIncludes);
  }
  if (match.mcpMethod !== undefined) {
    where.push("request_log.mcp_method = ?");
    bindings.push(match.mcpMethod);
  }
  if (match.mcpTool !== undefined) {
    where.push("request_log.mcp_tool = ?");
    bindings.push(match.mcpTool);
  }
  if (match.mcpArguments !== undefined) {
    where.push("request_log.mcp_arguments_json = ?");
    bindings.push(canonicalJson(match.mcpArguments));
  }
  if (match.llmDialect !== undefined) {
    where.push("request_log.llm_dialect = ?");
    bindings.push(match.llmDialect);
  }
  if (match.llmOperation !== undefined) {
    where.push("request_log.llm_operation = ?");
    bindings.push(match.llmOperation);
  }
  if (match.llmServerSlug !== undefined) {
    where.push("request_log.llm_server_slug = ?");
    bindings.push(match.llmServerSlug);
  }
  if (match.llmServerRevision !== undefined) {
    where.push("request_log.llm_server_revision = ?");
    bindings.push(match.llmServerRevision);
  }
  if (match.llmModel !== undefined) {
    where.push("request_log.llm_model = ?");
    bindings.push(match.llmModel);
  }
  if (match.llmStream !== undefined) {
    where.push("request_log.llm_stream = ?");
    bindings.push(match.llmStream ? 1 : 0);
  }
  if (match.llmTurnIndex !== undefined) {
    where.push("request_log.llm_turn_index = ?");
    bindings.push(match.llmTurnIndex);
  }
  if (match.llmOutcome !== undefined) {
    where.push(`${effectiveLlmOutcomeSql} = ?`);
    bindings.push(match.llmOutcome);
  }
  if (match.llmResponseId !== undefined) {
    where.push("request_log.llm_response_id = ?");
    bindings.push(match.llmResponseId);
  }
  if (match.llmInputTokens !== undefined) {
    where.push("request_log.llm_input_tokens = ?");
    bindings.push(match.llmInputTokens);
  }
  if (match.llmOutputTokens !== undefined) {
    where.push("request_log.llm_output_tokens = ?");
    bindings.push(match.llmOutputTokens);
  }
  if (match.llmStopReason !== undefined) {
    where.push("request_log.llm_stop_reason = ?");
    bindings.push(match.llmStopReason);
  }
  if (match.llmToolNames !== undefined) {
    where.push("request_log.llm_tool_names_json = ?");
    bindings.push(canonicalJson(match.llmToolNames));
  }
  if (match.llmErrorKind !== undefined) {
    where.push("request_log.llm_error_kind = ?");
    bindings.push(match.llmErrorKind);
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
    if (normalized.llmDialect !== undefined && normalized.llmOutcome !== "pending") {
      throw new Error("A new LLM request-log observation must be pending.");
    }
    const terminalReserve =
      normalized.llmDialect === undefined
        ? 0
        : byteLength(normalized.id) + REQUEST_LOG_LLM_TERMINAL_FIXED_BYTES;
    const entryBytes = byteLength(JSON.stringify(normalized)) + terminalReserve;
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
        `DELETE FROM request_log_llm_terminal
         WHERE request_id NOT IN (SELECT id FROM request_log)`
      );
      this.#store.run(
        `INSERT INTO request_log (
          id, timestamp, source, provider, method, path, request_headers,
          request_body, response_status, response_headers, response_body,
          duration_ms, correlation_id, protocol, mcp_method, mcp_tool,
          mcp_arguments_json, mcp_error_code, mcp_tool_is_error, llm_dialect,
          llm_operation, llm_server_slug, llm_server_revision, llm_model,
          llm_stream, llm_turn_index, llm_outcome, llm_response_id,
          llm_input_tokens, llm_output_tokens, llm_stop_reason,
          llm_tool_names_json, llm_error_kind
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
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
        normalized.correlationId,
        normalized.protocol ?? null,
        normalized.mcpMethod ?? null,
        normalized.mcpTool ?? null,
        normalized.mcpArguments === undefined
          ? null
          : canonicalJson(normalized.mcpArguments),
        normalized.mcpErrorCode ?? null,
        normalized.mcpToolIsError === undefined
          ? null
          : normalized.mcpToolIsError
            ? 1
            : 0,
        normalized.llmDialect ?? null,
        normalized.llmOperation ?? null,
        normalized.llmServerSlug ?? null,
        normalized.llmServerRevision ?? null,
        normalized.llmModel ?? null,
        normalized.llmStream === undefined ? null : normalized.llmStream ? 1 : 0,
        normalized.llmTurnIndex ?? null,
        normalized.llmOutcome ?? null,
        normalized.llmResponseId ?? null,
        normalized.llmInputTokens ?? null,
        normalized.llmOutputTokens ?? null,
        normalized.llmStopReason ?? null,
        normalized.llmToolNames === undefined
          ? null
          : canonicalJson(normalized.llmToolNames),
        normalized.llmErrorKind ?? null
      );
    });
    return normalized;
  }

  reserveLlmObservation(entry: RequestLogLlmReservation): RequestLogEntry {
    if (entry.llmDialect === undefined || entry.llmOutcome !== "pending") {
      throw new Error(
        "An LLM request-log reservation requires complete pending LLM metadata."
      );
    }
    return this.append({
      ...entry,
      responseStatus: REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
      durationMs: REQUEST_LOG_LLM_PENDING_DURATION_MS,
    });
  }

  finalizeLlmObservation(
    requestId: string,
    input: RequestLogLlmFinalization
  ): RequestLogEntry | undefined {
    if (requestId.length < 1) {
      throw new Error("An LLM request-log observation ID is required.");
    }
    const terminal = requestLogLlmFinalizationSchema.parse(input);
    return this.#store.transaction(() => {
      const existing = this.#store.get<
        {
          llm_outcome: string;
          response_status: number;
          duration_ms: number;
        } & SqlRow
      >(
        `SELECT llm_outcome, response_status, duration_ms
         FROM request_log_llm_terminal WHERE request_id = ?`,
        requestId
      );
      if (existing) {
        if (
          existing.llm_outcome !== terminal.llmOutcome ||
          Number(existing.response_status) !== terminal.responseStatus ||
          Number(existing.duration_ms) !== terminal.durationMs
        ) {
          throw new RequestLogLlmFinalizationConflictError();
        }
      } else {
        const parent = this.#store.get<{ llm_dialect: string | null } & SqlRow>(
          "SELECT llm_dialect FROM request_log WHERE id = ?",
          requestId
        );
        if (!parent) return undefined;
        if (parent.llm_dialect === null) {
          throw new RequestLogLlmFinalizationConflictError(
            "Only an LLM request-log observation can be finalized."
          );
        }
        this.#store.run(
          `INSERT INTO request_log_llm_terminal (
            request_id, llm_outcome, response_status, duration_ms
          ) VALUES (?, ?, ?, ?)`,
          requestId,
          terminal.llmOutcome,
          terminal.responseStatus,
          terminal.durationMs
        );
      }
      const row = this.#store.get<RequestLogRow>(
        `${selectRequestLog} WHERE request_log.id = ?`,
        requestId
      );
      return row ? toEntry(row) : undefined;
    });
  }

  query(input: RequestLogQuery): RequestLogPage {
    const parsed = requestLogQuerySchema.parse(input);
    const method = parsed.method?.toUpperCase();
    const legacyFilterMaterial = {
      source: parsed.source ?? null,
      provider: parsed.provider ?? null,
      protocol: parsed.protocol ?? null,
      method: method ?? null,
      path: parsed.path ?? null,
      status: parsed.status ?? null,
      mcpMethod: parsed.mcpMethod ?? null,
      mcpTool: parsed.mcpTool ?? null,
    };
    const llmFilterMaterial = {
      llmDialect: parsed.llmDialect ?? null,
      llmOperation: parsed.llmOperation ?? null,
      llmServerSlug: parsed.llmServerSlug ?? null,
      llmServerRevision: parsed.llmServerRevision ?? null,
      llmModel: parsed.llmModel ?? null,
      llmStream: parsed.llmStream ?? null,
      llmTurnIndex: parsed.llmTurnIndex ?? null,
      llmOutcome: parsed.llmOutcome ?? null,
      llmResponseId: parsed.llmResponseId ?? null,
      llmInputTokens: parsed.llmInputTokens ?? null,
      llmOutputTokens: parsed.llmOutputTokens ?? null,
      llmStopReason: parsed.llmStopReason ?? null,
      llmToolNames: parsed.llmToolNames ?? null,
      llmErrorKind: parsed.llmErrorKind ?? null,
    };
    const hasLlmFilters = Object.values(llmFilterMaterial).some(
      (value) => value !== null
    );
    const filter = fingerprint(
      hasLlmFilters
        ? { ...legacyFilterMaterial, ...llmFilterMaterial }
        : legacyFilterMaterial
    );
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor, filter) : undefined;
    const where: string[] = [];
    const bindings: SqlValue[] = [];
    if (parsed.provider) {
      where.push("request_log.provider = ?");
      bindings.push(parsed.provider);
    }
    if (parsed.protocol) {
      where.push("request_log.protocol = ?");
      bindings.push(parsed.protocol);
    }
    assertionWhere({ ...parsed, method }, where, bindings);
    if (cursor) {
      where.push("request_log.sequence < ?");
      bindings.push(cursor.before);
    }
    const rows = this.#store.all<RequestLogRow>(
      `${selectRequestLog}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
       ORDER BY request_log.sequence DESC LIMIT ?`,
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
              const where = ["request_log.sequence > ?"];
              const bindings: SqlValue[] = [candidateAfterSequence];
              assertionWhere(spec, where, bindings);
              assertionWhere(step, where, bindings);
              const row = this.#store.get<{ id: string; sequence: number } & SqlRow>(
                `SELECT request_log.id, request_log.sequence
                 FROM ${requestLogJoin}
                 WHERE ${where.join(" AND ")}
                 ORDER BY request_log.sequence ASC LIMIT 1`,
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
          `SELECT count(*) AS count FROM ${requestLogJoin}${whereSql}`,
          ...bindings
        )?.count ?? 0
      );
      const rows = this.#store.all<{ id: string } & SqlRow>(
        `SELECT request_log.id FROM ${requestLogJoin}${whereSql}
         ORDER BY request_log.sequence DESC LIMIT ?`,
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
