import {
  MOCK_MCP_PROTOCOL_VERSION,
  MOCK_MCP_STATE_CAPACITY,
  type MockMcpGetPromptResult,
  type MockMcpReadResourceResult,
  type MockMcpServerRecord,
  type MockMcpToolResult,
  mockMcpCapabilityNameSchema,
  mockMcpGetPromptResultSchema,
  mockMcpReadResourceResultSchema,
  mockMcpToolResultSchema,
  REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH,
} from "@mockos/contracts";
import type { BehaviorSpec, JsonValue } from "@mockos/contracts/behavior";
import {
  type BehaviorEvaluationContext,
  type BehaviorEvaluationPlan,
  BehaviorStateConflictError,
  type CreatedMockMcpSession,
  type CreateMockMcpSessionInput,
  evaluateBehavior,
  type LookupMockMcpSessionInput,
  type MockMcpSessionLookupResult,
  type MockMcpSessionTerminationResult,
  type ScriptBehaviorExecutor,
} from "@mockos/core";
import {
  decodeMockMcpCursor,
  encodeMockMcpCursor,
  MockMcpCursorError,
  type MockMcpCursorKind,
} from "./cursor";
import { validateMockMcpJsonSchema } from "./json-schema";
import {
  MockMcpResourceTemplateError,
  matchMockMcpResourceTemplate,
} from "./resource-template";

export {
  MOCK_MCP_MAX_CURSOR_LENGTH,
  MockMcpCursorError,
} from "./cursor";
export {
  type MockMcpSchemaIssue,
  type MockMcpSchemaValidation,
  validateMockMcpJsonSchema,
} from "./json-schema";
export {
  assertMockMcpLevelOneResourceTemplate,
  MockMcpResourceTemplateError,
  matchMockMcpResourceTemplate,
} from "./resource-template";
export { MOCK_MCP_STATE_CAPACITY };

export const MOCK_MCP_MAX_MESSAGE_BYTES = 256 * 1024;
export const MOCK_MCP_MAX_OBSERVED_ARGUMENT_BYTES = 64 * 1024;
export const MOCK_MCP_REQUEST_CANCELLED = -32_800;
export const MOCK_MCP_SERVER_NOT_INITIALIZED = -32_002;
const MAX_MESSAGE_DEPTH = 32;
const MAX_MESSAGE_NODES = 20_000;
const MAX_OBSERVATION_DEPTH = 16;
const MAX_OBSERVATION_NODES = 2_000;
const MAX_SEQUENCE_COMMIT_ATTEMPTS = 3;
const MAX_SCHEMA_DIAGNOSTIC_FRAGMENT_LENGTH = 2_048;
const MAX_SCHEMA_DIAGNOSTIC_LENGTH = 8_192;
const JSON_CONTENT_TYPE = "application/json";
const EVENT_STREAM_CONTENT_TYPE = "text/event-stream";
const SESSION_HEADER = "MCP-Session-Id";
const PROTOCOL_HEADER = "MCP-Protocol-Version";
const SENSITIVE_FIELD =
  /authorization|cookie|credential|password|secret|session|token|api.?key/iu;

type MaybePromise<Value> = Value | Promise<Value>;
type JsonRpcId = string | number;

export type MockMcpRepositoryDependencies = {
  assertServerRevision(serverSlug: string, expectedRevision: number): void;
  readState(
    serverSlug: string,
    serverRevision: number,
    key: string
  ): JsonValue | undefined;
  writeState(
    serverSlug: string,
    serverRevision: number,
    key: string,
    value: JsonValue
  ): void;
  transaction<Value>(callback: () => Value): Value;
  createSession(input: CreateMockMcpSessionInput): Promise<CreatedMockMcpSession>;
  getSession(input: LookupMockMcpSessionInput): Promise<MockMcpSessionLookupResult>;
  markInitialized(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionLookupResult>;
  terminateSession(
    input: LookupMockMcpSessionInput
  ): Promise<MockMcpSessionTerminationResult>;
};

export type MockMcpBehaviorEvaluator = (
  behavior: BehaviorSpec,
  context: BehaviorEvaluationContext
) => Promise<BehaviorEvaluationPlan>;

export type MockMcpBearerAuthenticationInput = {
  readonly token: string;
  readonly tokenSha256: string;
  readonly server: MockMcpServerRecord;
  readonly request: Request;
  readonly signal: AbortSignal;
};

export type MockMcpObservation = {
  readonly transportMethod: string;
  readonly httpStatus: number;
  readonly serverSlug: string;
  readonly serverRevision: number;
  readonly sessionPresent: boolean;
  readonly durationMs: number;
  readonly requestId?: JsonRpcId;
  readonly mcpMethod?: string;
  readonly mcpTool?: string;
  readonly mcpArguments?: Readonly<Record<string, JsonValue>>;
  readonly mcpErrorCode?: number;
  readonly mcpToolIsError?: boolean;
};

export type MockMcpFetchDependencies = {
  readonly repository: MockMcpRepositoryDependencies;
  readonly evaluateBehavior?: MockMcpBehaviorEvaluator;
  readonly scripts?: ScriptBehaviorExecutor;
  readonly authenticateBearer?: (
    input: MockMcpBearerAuthenticationInput
  ) => MaybePromise<boolean>;
  /**
   * Receives one bounded, already-redacted event per handled request. Observer
   * failures cannot change an already-selected protocol response.
   */
  readonly observe: (observation: MockMcpObservation) => MaybePromise<void>;
  /**
   * Keeps asynchronous observation work alive without extending the protocol
   * response's revision-consistency window.
   */
  readonly waitUntil?: (promise: Promise<void>) => void;
  readonly now?: () => number;
};

export type MockMcpFetchContext = {
  /** Current, already-authorized server record resolved by the owning runtime. */
  readonly server: MockMcpServerRecord;
};

export type MockMcpFetchHandler = (
  request: Request,
  context: MockMcpFetchContext
) => Promise<Response>;

export type MockMcpTransportFailureCode =
  | "origin_forbidden"
  | "authentication_required"
  | "authentication_unavailable"
  | "not_acceptable"
  | "unsupported_media_type"
  | "payload_too_large"
  | "parse_error"
  | "invalid_message"
  | "method_not_allowed"
  | "protocol_version_required"
  | "protocol_version_unsupported"
  | "session_required"
  | "session_unexpected"
  | "session_not_found"
  | "session_protocol_mismatch"
  | "server_revision_changed"
  | "session_capacity"
  | "internal";

const TRANSPORT_JSON_RPC_CODE: Record<MockMcpTransportFailureCode, number> = {
  origin_forbidden: -32_003,
  authentication_required: -32_001,
  authentication_unavailable: -32_603,
  not_acceptable: -32_600,
  unsupported_media_type: -32_600,
  payload_too_large: -32_600,
  parse_error: -32_700,
  invalid_message: -32_600,
  method_not_allowed: -32_601,
  protocol_version_required: -32_600,
  protocol_version_unsupported: -32_600,
  session_required: -32_600,
  session_unexpected: -32_600,
  session_not_found: -32_001,
  session_protocol_mismatch: -32_600,
  server_revision_changed: -32_001,
  session_capacity: -32_603,
  internal: -32_603,
};

export class MockMcpTransportFailure extends Error {
  constructor(
    readonly code: MockMcpTransportFailureCode,
    readonly status: number,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockMcpTransportFailure";
  }
}

class JsonRpcFault extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: JsonValue,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "JsonRpcFault";
  }
}

export class MockMcpAdapterConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MockMcpAdapterConfigurationError";
  }
}

type ParsedJsonRpcMessage = {
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: Readonly<Record<string, JsonValue>>;
};

type RequestTrace = {
  requestId?: JsonRpcId;
  method?: string;
  tool?: string;
  arguments?: Readonly<Record<string, JsonValue>>;
  errorCode?: number;
  toolIsError?: boolean;
  sessionPresent: boolean;
};

type ActiveTransport = {
  readonly sessionScope: string;
  readonly sessionId?: string;
  readonly initialized: boolean;
};

type DispatchContext = {
  readonly request: Request;
  readonly server: MockMcpServerRecord;
  readonly transport: ActiveTransport;
  readonly dependencies: MockMcpFetchDependencies;
  readonly trace: RequestTrace;
};

const isObject = (value: unknown): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      ...headers,
    },
  });

const jsonRpcErrorResponse = (
  id: JsonRpcId | null,
  fault: Pick<JsonRpcFault, "code" | "message" | "data">,
  trace: RequestTrace,
  status = 200,
  headers: Readonly<Record<string, string>> = {}
): Response => {
  trace.errorCode = fault.code;
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: fault.code,
        message: fault.message,
        ...(fault.data === undefined ? {} : { data: fault.data }),
      },
    },
    status,
    headers
  );
};

export const responseForMockMcpTransportFailure = (
  failure: MockMcpTransportFailure
): Response =>
  responseForTransportFailure(failure, {
    sessionPresent: false,
  });

const responseForTransportFailure = (
  failure: MockMcpTransportFailure,
  trace: RequestTrace
): Response =>
  jsonRpcErrorResponse(
    null,
    {
      code: TRANSPORT_JSON_RPC_CODE[failure.code],
      message: failure.message,
    },
    trace,
    failure.status,
    failure.headers
  );

export const mockMcpSessionFailure = (
  status: Exclude<MockMcpSessionLookupResult["status"], "active"> | "already_terminated"
): MockMcpTransportFailure =>
  status === "protocol_version_mismatch"
    ? new MockMcpTransportFailure(
        "session_protocol_mismatch",
        400,
        "The MCP session protocol version does not match this request."
      )
    : new MockMcpTransportFailure(
        "session_not_found",
        404,
        "The MCP session is missing, expired, stale, or terminated."
      );

const mediaTypeAccepted = (header: string, expected: string): boolean =>
  header.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry
      .trim()
      .toLowerCase()
      .split(";")
      .map((value) => value.trim());
    if (mediaType !== expected) return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });

const requirePostHeaders = (request: Request): void => {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== JSON_CONTENT_TYPE) {
    throw new MockMcpTransportFailure(
      "unsupported_media_type",
      415,
      "MCP POST requests require Content-Type application/json."
    );
  }
  const accept = request.headers.get("Accept");
  if (
    !accept ||
    !mediaTypeAccepted(accept, JSON_CONTENT_TYPE) ||
    !mediaTypeAccepted(accept, EVENT_STREAM_CONTENT_TYPE)
  ) {
    throw new MockMcpTransportFailure(
      "not_acceptable",
      406,
      "MCP POST requests must accept application/json and text/event-stream."
    );
  }
};

const requireSafeOrigin = (request: Request): void => {
  const origin = request.headers.get("Origin");
  if (origin === null) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new MockMcpTransportFailure(
      "origin_forbidden",
      403,
      "Cross-origin MCP requests are forbidden."
    );
  }
  if (origin !== parsed.origin || parsed.origin !== new URL(request.url).origin) {
    throw new MockMcpTransportFailure(
      "origin_forbidden",
      403,
      "Cross-origin MCP requests are forbidden."
    );
  }
};

const requireAuthentication = async (
  request: Request,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies
): Promise<void> => {
  if (server.spec.authentication.mode === "none") return;
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/iu);
  if (!match?.[1]) {
    throw new MockMcpTransportFailure(
      "authentication_required",
      401,
      "A valid bearer credential is required.",
      { "WWW-Authenticate": "Bearer" }
    );
  }
  if (!dependencies.authenticateBearer) {
    throw new MockMcpTransportFailure(
      "authentication_unavailable",
      500,
      "Bearer authentication is unavailable."
    );
  }
  let authenticated = false;
  try {
    authenticated = await dependencies.authenticateBearer({
      token: match[1],
      tokenSha256: server.spec.authentication.tokenSha256,
      server,
      request,
      signal: request.signal,
    });
  } catch {
    authenticated = false;
  }
  if (!authenticated) {
    throw new MockMcpTransportFailure(
      "authentication_required",
      401,
      "A valid bearer credential is required.",
      { "WWW-Authenticate": "Bearer" }
    );
  }
};

const assertMessageBounds = (value: unknown): void => {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    nodes += 1;
    if (nodes > MAX_MESSAGE_NODES || entry.depth > MAX_MESSAGE_DEPTH) {
      throw new MockMcpTransportFailure(
        "invalid_message",
        400,
        "The JSON-RPC message exceeds its structural bounds."
      );
    }
    if (typeof entry.value === "number" && !Number.isFinite(entry.value)) {
      throw new MockMcpTransportFailure(
        "invalid_message",
        400,
        "The JSON-RPC message contains a non-finite number."
      );
    }
    if (!entry.value || typeof entry.value !== "object") continue;
    const children = Array.isArray(entry.value)
      ? entry.value
      : Object.entries(entry.value).map(([key, child]) => {
          if (key === "__proto__" || key === "constructor" || key === "prototype") {
            throw new MockMcpTransportFailure(
              "invalid_message",
              400,
              "The JSON-RPC message contains a prohibited object key."
            );
          }
          return child;
        });
    for (const child of children) {
      pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
};

const readJsonMessage = async (request: Request): Promise<unknown> => {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MOCK_MCP_MAX_MESSAGE_BYTES)
  ) {
    throw new MockMcpTransportFailure(
      "payload_too_large",
      413,
      `MCP messages cannot exceed ${MOCK_MCP_MAX_MESSAGE_BYTES} bytes.`
    );
  }
  if (!request.body) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "The JSON-RPC request body is missing."
    );
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MOCK_MCP_MAX_MESSAGE_BYTES) {
        await reader.cancel();
        throw new MockMcpTransportFailure(
          "payload_too_large",
          413,
          `MCP messages cannot exceed ${MOCK_MCP_MAX_MESSAGE_BYTES} bytes.`
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) {
    if (cause instanceof MockMcpTransportFailure) throw cause;
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "The JSON-RPC request body must be valid UTF-8.",
      {},
      { cause }
    );
  } finally {
    reader.releaseLock();
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new MockMcpTransportFailure(
      "parse_error",
      400,
      "The JSON-RPC request body is not valid JSON.",
      {},
      { cause }
    );
  }
  assertMessageBounds(value);
  if (Array.isArray(value)) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "JSON-RPC batches are not supported."
    );
  }
  return value;
};

const parseJsonRpcMessage = (value: unknown): ParsedJsonRpcMessage => {
  if (!isObject(value)) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "The JSON-RPC message must be an object."
    );
  }
  const allowed = new Set(["jsonrpc", "id", "method", "params"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.jsonrpc !== "2.0" ||
    typeof value.method !== "string" ||
    value.method.length < 1 ||
    value.method.length > 256
  ) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "The JSON-RPC message is invalid."
    );
  }
  const id = value.id;
  if (
    id !== undefined &&
    !(
      (typeof id === "string" && id.length <= 128) ||
      (typeof id === "number" && Number.isSafeInteger(id))
    )
  ) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "The JSON-RPC request id is invalid."
    );
  }
  if (value.params !== undefined && !isObject(value.params)) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "JSON-RPC params must be an object."
    );
  }
  return {
    ...(id === undefined ? {} : { id }),
    method: value.method,
    ...(value.params === undefined ? {} : { params: value.params }),
  };
};

const requireProtocolVersion = (request: Request): string => {
  const version = request.headers.get(PROTOCOL_HEADER);
  if (version === null) {
    throw new MockMcpTransportFailure(
      "protocol_version_required",
      400,
      `Post-initialization requests require ${PROTOCOL_HEADER}.`
    );
  }
  if (version !== MOCK_MCP_PROTOCOL_VERSION) {
    throw new MockMcpTransportFailure(
      "protocol_version_unsupported",
      400,
      `Only MCP protocol ${MOCK_MCP_PROTOCOL_VERSION} is supported.`
    );
  }
  return version;
};

const sessionIdFrom = (request: Request): string | undefined => {
  const sessionId = request.headers.get(SESSION_HEADER);
  if (sessionId === null) return undefined;
  if (
    sessionId.length < 1 ||
    sessionId.length > 512 ||
    [...sessionId].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x21 || code > 0x7e;
    })
  ) {
    throw new MockMcpTransportFailure(
      "session_not_found",
      404,
      "The MCP session is missing, expired, stale, or terminated."
    );
  }
  return sessionId;
};

const activeTransportFor = async (
  request: Request,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies
): Promise<ActiveTransport> => {
  const protocolVersion = requireProtocolVersion(request);
  const sessionId = sessionIdFrom(request);
  if (!server.spec.transport.stateful) {
    if (sessionId !== undefined) {
      throw new MockMcpTransportFailure(
        "session_unexpected",
        400,
        "This mock MCP server is stateless and does not accept a session header."
      );
    }
    return {
      sessionScope: `stateless:${server.spec.slug}:${server.revision}`,
      initialized: true,
    };
  }
  if (!sessionId) {
    throw new MockMcpTransportFailure(
      "session_required",
      400,
      `Stateful requests require ${SESSION_HEADER}.`
    );
  }
  const result = await dependencies.repository.getSession({
    serverSlug: server.spec.slug,
    sessionId,
    protocolVersion,
  });
  if (result.status !== "active") throw mockMcpSessionFailure(result.status);
  if (
    result.session.serverRevision !== server.revision ||
    result.session.serverSlug !== server.spec.slug
  ) {
    throw mockMcpSessionFailure("stale");
  }
  return {
    sessionScope: sessionId,
    sessionId,
    initialized: result.session.initialized,
  };
};

const initializeResult = (server: MockMcpServerRecord) => ({
  protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  },
  serverInfo: server.spec.serverInfo,
  ...(server.spec.instructions === undefined
    ? {}
    : { instructions: server.spec.instructions }),
});

const validateInitializeParams = (
  params: Readonly<Record<string, JsonValue>> | undefined
): void => {
  if (
    !params ||
    typeof params.protocolVersion !== "string" ||
    params.protocolVersion.length < 1 ||
    params.protocolVersion.length > 64 ||
    !isObject(params.capabilities) ||
    !isObject(params.clientInfo) ||
    typeof params.clientInfo.name !== "string" ||
    params.clientInfo.name.length < 1 ||
    params.clientInfo.name.length > 256 ||
    typeof params.clientInfo.version !== "string" ||
    params.clientInfo.version.length < 1 ||
    params.clientInfo.version.length > 128
  ) {
    throw new JsonRpcFault(-32_602, "Initialize params are invalid.");
  }
};

const handleInitialize = async (
  request: Request,
  message: ParsedJsonRpcMessage,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies,
  trace: RequestTrace
): Promise<Response> => {
  if (message.id === undefined) {
    throw new MockMcpTransportFailure(
      "invalid_message",
      400,
      "Initialize must be a JSON-RPC request."
    );
  }
  if (sessionIdFrom(request) !== undefined) {
    throw new MockMcpTransportFailure(
      "session_unexpected",
      400,
      "Initialize requests cannot carry an MCP session."
    );
  }
  const initializeVersion = request.headers.get(PROTOCOL_HEADER);
  if (initializeVersion !== null && initializeVersion !== MOCK_MCP_PROTOCOL_VERSION) {
    throw new MockMcpTransportFailure(
      "protocol_version_unsupported",
      400,
      `Only MCP protocol ${MOCK_MCP_PROTOCOL_VERSION} is supported.`
    );
  }
  try {
    validateInitializeParams(message.params);
  } catch (error) {
    if (error instanceof JsonRpcFault) {
      return jsonRpcErrorResponse(message.id, error, trace);
    }
    throw error;
  }

  let sessionId: string | undefined;
  if (server.spec.transport.stateful) {
    try {
      const created = await dependencies.repository.createSession({
        serverSlug: server.spec.slug,
        serverRevision: server.revision,
        protocolVersion: MOCK_MCP_PROTOCOL_VERSION,
      });
      sessionId = created.sessionId;
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      if (code === "server_revision_mismatch") {
        throw new MockMcpTransportFailure(
          "server_revision_changed",
          409,
          "The mock MCP server changed during initialization."
        );
      }
      if (code === "session_limit") {
        throw new MockMcpTransportFailure(
          "session_capacity",
          503,
          "The mock MCP server has reached its active-session limit.",
          { "Retry-After": "1" }
        );
      }
      throw new MockMcpTransportFailure(
        "internal",
        500,
        "The MCP session could not be created.",
        {},
        { cause }
      );
    }
  }
  assertCurrentServerRevision(server, dependencies);
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: message.id,
      result: initializeResult(server),
    },
    200,
    sessionId === undefined ? {} : { [SESSION_HEADER]: sessionId }
  );
};

const paramsWithOnly = (
  params: Readonly<Record<string, JsonValue>> | undefined,
  keys: readonly string[]
): Readonly<Record<string, JsonValue>> => {
  const value = params ?? {};
  const allowed = new Set([...keys, "_meta"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new JsonRpcFault(-32_602, "Request params contain unknown fields.");
  }
  return value;
};

const cursorFromParams = (
  params: Readonly<Record<string, JsonValue>> | undefined
): string | undefined => {
  const value = paramsWithOnly(params, ["cursor"]).cursor;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new JsonRpcFault(-32_602, "The pagination cursor is invalid.");
  }
  return value;
};

const paginate = <Value>(
  values: readonly Value[],
  kind: MockMcpCursorKind,
  cursor: string | undefined,
  server: MockMcpServerRecord,
  transport: ActiveTransport
): { readonly values: readonly Value[]; readonly nextCursor?: string } => {
  const scope = {
    kind,
    serverSlug: server.spec.slug,
    serverRevision: server.revision,
    sessionScope: transport.sessionScope,
  } as const;
  let offset: number;
  try {
    offset = decodeMockMcpCursor(cursor, scope, values.length);
  } catch (cause) {
    if (cause instanceof MockMcpCursorError) {
      throw new JsonRpcFault(-32_602, cause.message);
    }
    throw cause;
  }
  const end = Math.min(values.length, offset + server.spec.pageSize);
  return {
    values: values.slice(offset, end),
    ...(end < values.length ? { nextCursor: encodeMockMcpCursor(scope, end) } : {}),
  };
};

const withoutBehavior = <Value extends { readonly behavior: BehaviorSpec }>(
  value: Value
): Omit<Value, "behavior"> => {
  const { behavior: _behavior, ...metadata } = value;
  return metadata;
};

const stableFingerprint = (value: string): string => {
  let first = 2_166_136_261;
  let second = (2_166_136_261 ^ 0x9e37_79b9) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul((first ^ code) >>> 0, 16_777_619) >>> 0;
    second = Math.imul((second ^ code) >>> 0, 16_777_619) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
};

const stateKeyFor = (kind: string, identity: string): string =>
  `${kind}:${stableFingerprint(identity)}`;

const abortFault = (): JsonRpcFault =>
  new JsonRpcFault(MOCK_MCP_REQUEST_CANCELLED, "Request cancelled.");

const waitForLatency = async (
  milliseconds: number,
  signal: AbortSignal
): Promise<void> => {
  if (signal.aborted) throw abortFault();
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(abortFault());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const configuredFault = (
  server: MockMcpServerRecord,
  outcome: Extract<BehaviorEvaluationPlan["outcome"], { kind: "error" }>
): JsonRpcFault => {
  const code = server.spec.errorCodeMap[outcome.code];
  if (code === undefined) {
    throw new MockMcpAdapterConfigurationError(
      `Behavior error ${outcome.code} has no configured JSON-RPC code.`
    );
  }
  return new JsonRpcFault(code, outcome.message, outcome.details);
};

const assertCurrentServerRevision = (
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies
): void => {
  try {
    dependencies.repository.assertServerRevision(server.spec.slug, server.revision);
  } catch (cause) {
    const code =
      cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
    if (code === "server_revision_mismatch" || code === "server_not_found") {
      throw new MockMcpTransportFailure(
        "server_revision_changed",
        409,
        "The mock MCP server changed while the request was in progress."
      );
    }
    throw cause;
  }
};

const evaluateResult = async <Result>(
  input: {
    readonly behavior: BehaviorSpec;
    readonly behaviorInput: Readonly<Record<string, JsonValue>>;
    readonly stateKey: string;
    readonly invocationKey: string;
    readonly parse: (value: JsonValue) => Result;
  },
  context: DispatchContext
): Promise<Result> => {
  const state = {
    read: (key: string): JsonValue | undefined =>
      context.dependencies.repository.readState(
        context.server.spec.slug,
        context.server.revision,
        key
      ),
    write: (key: string, value: JsonValue): void =>
      context.dependencies.repository.writeState(
        context.server.spec.slug,
        context.server.revision,
        key,
        value
      ),
    transaction: <Value>(callback: () => Value): Value =>
      context.dependencies.repository.transaction(() => {
        assertCurrentServerRevision(context.server, context.dependencies);
        return callback();
      }),
  };
  const evaluator = context.dependencies.evaluateBehavior ?? evaluateBehavior;

  for (let attempt = 1; attempt <= MAX_SEQUENCE_COMMIT_ATTEMPTS; attempt += 1) {
    if (context.request.signal.aborted) throw abortFault();
    const plan = await evaluator(input.behavior, {
      input: input.behaviorInput,
      stateKey: input.stateKey,
      invocationKey: input.invocationKey,
      state,
      ...(context.dependencies.scripts === undefined
        ? {}
        : { scripts: context.dependencies.scripts }),
    });
    const fault =
      plan.outcome.kind === "error"
        ? configuredFault(context.server, plan.outcome)
        : undefined;
    const parsed =
      plan.outcome.kind === "value" ? input.parse(plan.outcome.value) : undefined;
    await waitForLatency(plan.delayMilliseconds, context.request.signal);
    try {
      plan.commit();
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      if (code === "state_limit") {
        throw new JsonRpcFault(
          MOCK_MCP_STATE_CAPACITY,
          "Mock MCP application state capacity reached."
        );
      }
      if (
        cause instanceof BehaviorStateConflictError &&
        attempt < MAX_SEQUENCE_COMMIT_ATTEMPTS
      ) {
        continue;
      }
      throw cause;
    }
    assertCurrentServerRevision(context.server, context.dependencies);
    if (fault) throw fault;
    return parsed as Result;
  }
  throw new MockMcpAdapterConfigurationError(
    "Behavior sequence state could not be committed."
  );
};

const resultValidationError = (
  label: string,
  detail?: string
): MockMcpAdapterConfigurationError =>
  new MockMcpAdapterConfigurationError(
    `${label} behavior produced an invalid result.${detail ? ` ${detail}` : ""}`
  );

const toolResultFrom = (
  value: JsonValue,
  outputSchema: MockMcpServerRecord["spec"]["tools"][number]["outputSchema"]
): MockMcpToolResult => {
  const shaped =
    typeof value === "string"
      ? { content: [{ type: "text" as const, text: value }] }
      : value;
  const parsed = mockMcpToolResultSchema.safeParse(shaped);
  if (!parsed.success) throw resultValidationError("Tool");
  if (outputSchema !== undefined && parsed.data.isError !== true) {
    if (parsed.data.structuredContent === undefined) {
      throw resultValidationError(
        "Tool",
        "A declared output schema requires structuredContent."
      );
    }
    const validation = validateMockMcpJsonSchema(
      outputSchema,
      parsed.data.structuredContent
    );
    if (!validation.valid) {
      throw resultValidationError(
        "Tool",
        validation.issues
          .slice(0, 3)
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")
      );
    }
  }
  return parsed.data;
};

const resourceResultFrom = (
  value: JsonValue,
  uri: string
): MockMcpReadResourceResult => {
  const shaped =
    typeof value === "string" ? { contents: [{ uri, text: value }] } : value;
  const parsed = mockMcpReadResourceResultSchema.safeParse(shaped);
  if (!parsed.success) throw resultValidationError("Resource");
  return parsed.data;
};

const promptResultFrom = (value: JsonValue): MockMcpGetPromptResult => {
  const shaped =
    typeof value === "string"
      ? {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: value },
            },
          ],
        }
      : value;
  const parsed = mockMcpGetPromptResultSchema.safeParse(shaped);
  if (!parsed.success) throw resultValidationError("Prompt");
  return parsed.data;
};

const invocationKey = (id: JsonRpcId): string => `jsonrpc:${String(id)}`;

const boundedSchemaDiagnostics = (
  issues: readonly { readonly path: string; readonly message: string }[]
): string =>
  issues
    .slice(0, 3)
    .map(
      (issue) =>
        `${issue.path.slice(0, MAX_SCHEMA_DIAGNOSTIC_FRAGMENT_LENGTH)} ${issue.message.slice(
          0,
          MAX_SCHEMA_DIAGNOSTIC_FRAGMENT_LENGTH
        )}`
    )
    .join("; ")
    .slice(0, MAX_SCHEMA_DIAGNOSTIC_LENGTH);

const dispatchRequest = async (
  message: ParsedJsonRpcMessage & { readonly id: JsonRpcId },
  context: DispatchContext
): Promise<JsonValue> => {
  const { server, transport } = context;
  switch (message.method) {
    case "ping": {
      paramsWithOnly(message.params, []);
      return {};
    }
    case "tools/list": {
      const page = paginate(
        server.spec.tools.map(withoutBehavior),
        "tools",
        cursorFromParams(message.params),
        server,
        transport
      );
      return {
        tools: [...page.values],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } as JsonValue;
    }
    case "tools/call": {
      const params = paramsWithOnly(message.params, ["name", "arguments"]);
      if (typeof params.name !== "string") {
        throw new JsonRpcFault(-32_602, "Tool name is required.");
      }
      if (!mockMcpCapabilityNameSchema.safeParse(params.name).success) {
        throw new JsonRpcFault(-32_602, "Tool name is invalid.");
      }
      const tool = server.spec.tools.find(
        (candidate) => candidate.name === params.name
      );
      if (!tool) {
        throw new JsonRpcFault(-32_602, `Unknown tool: ${params.name}`);
      }
      const argumentsValue = params.arguments ?? {};
      if (!isObject(argumentsValue)) {
        throw new JsonRpcFault(-32_602, "Tool arguments must be an object.");
      }
      context.trace.tool = tool.name;
      context.trace.arguments = argumentsValue;
      const validation = validateMockMcpJsonSchema(tool.inputSchema, argumentsValue);
      if (!validation.valid) {
        const details = boundedSchemaDiagnostics(validation.issues);
        const result = mockMcpToolResultSchema.safeParse({
          content: [
            {
              type: "text",
              text: "Tool arguments do not match inputSchema.",
            },
            ...(details ? [{ type: "text" as const, text: details }] : []),
          ],
          isError: true,
        });
        if (!result.success) {
          throw new MockMcpAdapterConfigurationError(
            "The bounded tool input error result is invalid."
          );
        }
        context.trace.toolIsError = true;
        return result.data as JsonValue;
      }
      const result = await evaluateResult(
        {
          behavior: tool.behavior,
          behaviorInput: { arguments: argumentsValue },
          stateKey: stateKeyFor("tool", tool.name),
          invocationKey: invocationKey(message.id),
          parse: (value) => toolResultFrom(value, tool.outputSchema),
        },
        context
      );
      context.trace.toolIsError = result.isError === true;
      return result as JsonValue;
    }
    case "resources/list": {
      const page = paginate(
        server.spec.resources.map(withoutBehavior),
        "resources",
        cursorFromParams(message.params),
        server,
        transport
      );
      return {
        resources: [...page.values],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } as JsonValue;
    }
    case "resources/templates/list": {
      const page = paginate(
        server.spec.resourceTemplates.map(withoutBehavior),
        "resource-templates",
        cursorFromParams(message.params),
        server,
        transport
      );
      return {
        resourceTemplates: [...page.values],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } as JsonValue;
    }
    case "resources/read": {
      const params = paramsWithOnly(message.params, ["uri"]);
      if (typeof params.uri !== "string" || params.uri.length > 1_024) {
        throw new JsonRpcFault(-32_602, "A bounded resource URI is required.");
      }
      const fixed = server.spec.resources.find(
        (resource) => resource.uri === params.uri
      );
      if (fixed) {
        return (await evaluateResult(
          {
            behavior: fixed.behavior,
            behaviorInput: { uri: params.uri },
            stateKey: stateKeyFor("resource", fixed.uri),
            invocationKey: invocationKey(message.id),
            parse: (value) => resourceResultFrom(value, params.uri as string),
          },
          context
        )) as JsonValue;
      }
      for (const template of server.spec.resourceTemplates) {
        let variables: Readonly<Record<string, JsonValue>> | undefined;
        try {
          variables = matchMockMcpResourceTemplate(template.uriTemplate, params.uri);
        } catch (cause) {
          if (cause instanceof MockMcpResourceTemplateError) {
            throw new MockMcpAdapterConfigurationError(cause.message, { cause });
          }
          throw cause;
        }
        if (!variables) continue;
        return (await evaluateResult(
          {
            behavior: template.behavior,
            behaviorInput: { uri: params.uri, variables },
            stateKey: stateKeyFor(
              "resource-template",
              `${template.uriTemplate}\u0000${params.uri}`
            ),
            invocationKey: invocationKey(message.id),
            parse: (value) => resourceResultFrom(value, params.uri as string),
          },
          context
        )) as JsonValue;
      }
      throw new JsonRpcFault(-32_002, "Resource not found.", {
        uri: params.uri,
      });
    }
    case "prompts/list": {
      const page = paginate(
        server.spec.prompts.map(withoutBehavior),
        "prompts",
        cursorFromParams(message.params),
        server,
        transport
      );
      return {
        prompts: [...page.values],
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } as JsonValue;
    }
    case "prompts/get": {
      const params = paramsWithOnly(message.params, ["name", "arguments"]);
      if (typeof params.name !== "string") {
        throw new JsonRpcFault(-32_602, "Prompt name is required.");
      }
      if (!mockMcpCapabilityNameSchema.safeParse(params.name).success) {
        throw new JsonRpcFault(-32_602, "Prompt name is invalid.");
      }
      const prompt = server.spec.prompts.find(
        (candidate) => candidate.name === params.name
      );
      if (!prompt) {
        throw new JsonRpcFault(-32_602, `Unknown prompt: ${params.name}`);
      }
      const argumentValue = params.arguments ?? {};
      if (
        !isObject(argumentValue) ||
        Object.values(argumentValue).some((value) => typeof value !== "string")
      ) {
        throw new JsonRpcFault(-32_602, "Prompt arguments must contain strings.");
      }
      const declared = new Set(prompt.arguments.map((argument) => argument.name));
      if (Object.keys(argumentValue).some((name) => !declared.has(name))) {
        throw new JsonRpcFault(-32_602, "Prompt arguments contain unknown names.");
      }
      const missing = prompt.arguments.find(
        (argument) =>
          argument.required === true && !Object.hasOwn(argumentValue, argument.name)
      );
      if (missing) {
        throw new JsonRpcFault(
          -32_602,
          `Required prompt argument ${missing.name} is missing.`
        );
      }
      return (await evaluateResult(
        {
          behavior: prompt.behavior,
          behaviorInput: { arguments: argumentValue },
          stateKey: stateKeyFor("prompt", prompt.name),
          invocationKey: invocationKey(message.id),
          parse: promptResultFrom,
        },
        context
      )) as JsonValue;
    }
    default:
      throw new JsonRpcFault(-32_601, `Method not found: ${message.method}`);
  }
};

const handleInitializedNotification = async (
  message: ParsedJsonRpcMessage,
  request: Request,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies
): Promise<void> => {
  paramsWithOnly(message.params, []);
  const protocolVersion = requireProtocolVersion(request);
  const sessionId = sessionIdFrom(request);
  if (!server.spec.transport.stateful) {
    if (sessionId !== undefined) {
      throw new MockMcpTransportFailure(
        "session_unexpected",
        400,
        "This mock MCP server is stateless and does not accept a session header."
      );
    }
    return;
  }
  if (!sessionId) {
    throw new MockMcpTransportFailure(
      "session_required",
      400,
      `Stateful requests require ${SESSION_HEADER}.`
    );
  }
  const result = await dependencies.repository.markInitialized({
    serverSlug: server.spec.slug,
    sessionId,
    protocolVersion,
  });
  if (result.status !== "active") throw mockMcpSessionFailure(result.status);
};

const handlePost = async (
  request: Request,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies,
  trace: RequestTrace
): Promise<Response> => {
  requirePostHeaders(request);
  const message = parseJsonRpcMessage(await readJsonMessage(request));
  trace.requestId = message.id;
  trace.method = message.method;

  if (message.method === "initialize") {
    return handleInitialize(request, message, server, dependencies, trace);
  }
  if (message.id === undefined) {
    if (message.method === "notifications/initialized") {
      await handleInitializedNotification(message, request, server, dependencies);
    } else {
      await activeTransportFor(request, server, dependencies);
    }
    assertCurrentServerRevision(server, dependencies);
    return new Response(null, { status: 202 });
  }

  const transport = await activeTransportFor(request, server, dependencies);
  trace.sessionPresent = transport.sessionId !== undefined;
  if (!transport.initialized && message.method !== "ping") {
    assertCurrentServerRevision(server, dependencies);
    return jsonRpcErrorResponse(
      message.id,
      new JsonRpcFault(
        MOCK_MCP_SERVER_NOT_INITIALIZED,
        "The MCP session has not received notifications/initialized."
      ),
      trace
    );
  }

  try {
    const result = await dispatchRequest(
      { ...message, id: message.id },
      { request, server, transport, dependencies, trace }
    );
    assertCurrentServerRevision(server, dependencies);
    return jsonResponse({ jsonrpc: "2.0", id: message.id, result });
  } catch (cause) {
    if (cause instanceof JsonRpcFault) {
      assertCurrentServerRevision(server, dependencies);
      return jsonRpcErrorResponse(message.id, cause, trace);
    }
    if (cause instanceof MockMcpTransportFailure) throw cause;
    assertCurrentServerRevision(server, dependencies);
    return jsonRpcErrorResponse(
      message.id,
      new JsonRpcFault(-32_603, "Internal error."),
      trace
    );
  }
};

const handleDelete = async (
  request: Request,
  server: MockMcpServerRecord,
  dependencies: MockMcpFetchDependencies,
  trace: RequestTrace
): Promise<Response> => {
  if (!server.spec.transport.stateful) {
    throw new MockMcpTransportFailure(
      "method_not_allowed",
      405,
      "Stateless mock MCP servers do not expose session deletion.",
      { Allow: "POST" }
    );
  }
  const protocolVersion = requireProtocolVersion(request);
  const sessionId = sessionIdFrom(request);
  trace.sessionPresent = sessionId !== undefined;
  if (!sessionId) {
    throw new MockMcpTransportFailure(
      "session_required",
      400,
      `Session deletion requires ${SESSION_HEADER}.`
    );
  }
  const result = await dependencies.repository.terminateSession({
    serverSlug: server.spec.slug,
    sessionId,
    protocolVersion,
  });
  if (result.status !== "terminated") throw mockMcpSessionFailure(result.status);
  assertCurrentServerRevision(server, dependencies);
  return new Response(null, { status: 204 });
};

const redactObservedArguments = (
  value: Readonly<Record<string, JsonValue>>
): Readonly<Record<string, JsonValue>> => {
  let nodes = 0;
  const redact = (entry: JsonValue, depth: number, key?: string): JsonValue => {
    nodes += 1;
    if (
      nodes > MAX_OBSERVATION_NODES ||
      depth > MAX_OBSERVATION_DEPTH ||
      (key !== undefined && SENSITIVE_FIELD.test(key))
    ) {
      return "[REDACTED]";
    }
    if (typeof entry === "string") {
      return entry.length <= 8_192 ? entry : `${entry.slice(0, 8_192)}[TRUNCATED]`;
    }
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry)) {
      return entry.map((child) => redact(child, depth + 1));
    }
    return Object.fromEntries(
      Object.entries(entry).map(([childKey, child]) => [
        childKey,
        redact(child, depth + 1, childKey),
      ])
    );
  };
  const redacted = redact(value as JsonValue, 0);
  if (!isObject(redacted)) return { _mockos: "[REDACTED]" };
  if (
    Object.keys(redacted).some(
      (key) => key.length < 1 || key.length > REQUEST_LOG_MCP_ARGUMENT_KEY_MAX_LENGTH
    )
  ) {
    return { _mockos: "[REDACTED:UNSUPPORTED_KEY]" };
  }
  if (
    new TextEncoder().encode(JSON.stringify(redacted)).byteLength >
    MOCK_MCP_MAX_OBSERVED_ARGUMENT_BYTES
  ) {
    return { _mockos: "[REDACTED:OVERSIZE]" };
  }
  return Object.freeze(redacted);
};

const emitObservation = (
  dependencies: MockMcpFetchDependencies,
  observation: MockMcpObservation
): void => {
  let result: MaybePromise<void>;
  try {
    result = dependencies.observe(Object.freeze(observation));
  } catch {
    // Observation is a bounded side channel. It cannot convert a committed
    // sequence result into a retryable transport failure.
    return;
  }
  if (result instanceof Promise) {
    const settled = result.catch(() => undefined);
    try {
      dependencies.waitUntil?.(settled);
    } catch {
      // Scheduling is part of the same non-fatal observation side channel.
    }
  }
};

/**
 * Creates the SDK-independent MCP 2025-11-25 data-plane adapter. The owning
 * Worker resolves the server record and supplies its environment-local
 * repository; no private or Cloud-specific dependency enters this package.
 */
export const createMockMcpFetchHandler = (
  dependencies: MockMcpFetchDependencies
): MockMcpFetchHandler => {
  const now = dependencies.now ?? Date.now;
  return async (request, { server }) => {
    const startedAt = now();
    const trace: RequestTrace = {
      sessionPresent: request.headers.has(SESSION_HEADER),
    };
    let authenticated = false;
    let response: Response;
    try {
      requireSafeOrigin(request);
      await requireAuthentication(request, server, dependencies);
      authenticated = true;
      assertCurrentServerRevision(server, dependencies);
      if (request.method === "POST") {
        response = await handlePost(request, server, dependencies, trace);
      } else if (request.method === "DELETE") {
        response = await handleDelete(request, server, dependencies, trace);
      } else {
        const allow = server.spec.transport.stateful ? "POST, DELETE" : "POST";
        const supported = server.spec.transport.stateful ? "POST and DELETE" : "POST";
        throw new MockMcpTransportFailure(
          "method_not_allowed",
          405,
          `This mock MCP endpoint supports ${supported}.`,
          { Allow: allow }
        );
      }
      assertCurrentServerRevision(server, dependencies);
    } catch (cause) {
      let currentCause = cause;
      if (authenticated) {
        try {
          assertCurrentServerRevision(server, dependencies);
        } catch (revisionCause) {
          currentCause = revisionCause;
        }
      }
      response =
        currentCause instanceof MockMcpTransportFailure
          ? responseForTransportFailure(currentCause, trace)
          : jsonRpcErrorResponse(
              trace.requestId ?? null,
              new JsonRpcFault(-32_603, "Internal error."),
              trace,
              500
            );
    }

    const endedAt = now();
    const durationMs = Math.max(
      0,
      Math.min(
        Number.MAX_SAFE_INTEGER,
        Number.isFinite(endedAt - startedAt) ? Math.floor(endedAt - startedAt) : 0
      )
    );
    emitObservation(dependencies, {
      transportMethod: request.method.slice(0, 16),
      httpStatus: response.status,
      serverSlug: server.spec.slug,
      serverRevision: server.revision,
      sessionPresent: trace.sessionPresent,
      durationMs,
      ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
      ...(trace.method === undefined ? {} : { mcpMethod: trace.method }),
      ...(trace.tool === undefined ? {} : { mcpTool: trace.tool }),
      ...(trace.arguments === undefined
        ? {}
        : { mcpArguments: redactObservedArguments(trace.arguments) }),
      ...(trace.errorCode === undefined ? {} : { mcpErrorCode: trace.errorCode }),
      ...(trace.toolIsError === undefined ? {} : { mcpToolIsError: trace.toolIsError }),
    });
    return response;
  };
};
