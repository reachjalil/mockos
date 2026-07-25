import {
  assertBehaviorSpecBounds,
  type JsonValue,
  jsonValueSchema,
} from "@mockos/contracts/behavior";
import {
  type MockLlmPlan,
  mockLlmModelSchema,
  parseMockLlmPlan,
} from "@mockos/contracts/mock-llm";
import {
  mockLlmMockCredentialSchema,
  mockLlmSlugSchema,
} from "@mockos/contracts/mock-llm-server";
import { canonicalMockLlmJson } from "./canonical-json";
import { EdgeSseStreamDeadlineError, prepareEdgeSseStream } from "./edge-stream";
import {
  createMockLlmProviderObservationPrivacyGuard,
  type MockLlmProviderObservationHook,
  type MockLlmProviderObservationStart,
  reserveMockLlmProviderObservation,
  scheduleMockLlmProviderObservationFinish,
} from "./observation";
import { renderOpenAiPlan } from "./openai";

export const MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES = 256 * 1_024;
export const MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH = 24;
export const MOCK_LLM_OPENAI_MAX_REQUEST_NODES = 10_000;
export const MOCK_LLM_OPENAI_MAX_MESSAGES = 256;
export const MOCK_LLM_OPENAI_MAX_TOOLS = 64;
export const MOCK_LLM_OPENAI_MAX_TEXT_BYTES = 64 * 1_024;
export const MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES = 64 * 1_024;
export const MOCK_LLM_OPENAI_MAX_TOOL_VALUE_DEPTH = 16;
export const MOCK_LLM_OPENAI_MAX_TOOL_VALUE_NODES = 2_000;
export const MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES = 2 * 1_024 * 1_024;

export const mockLlmOpenAiProviderManifest = Object.freeze({
  version: 1,
  dialect: "openai",
  routePrefix: "/llm-mock/{slug}/openai/v1",
  authentication: {
    scheme: "bearer",
    modes: ["accept_any", "strict"] as const,
  },
  operations: [
    {
      id: "create_chat_completion",
      method: "POST",
      path: "/chat/completions",
      streaming: true,
    },
    {
      id: "list_models",
      method: "GET",
      path: "/models",
      streaming: false,
    },
    {
      id: "retrieve_model",
      method: "GET",
      path: "/models/{model}",
      streaming: false,
    },
  ] as const,
});

export type MockLlmOpenAiCatalogModel = {
  readonly id: string;
  readonly createdAtEpochSeconds: number;
};

export type MockLlmOpenAiCatalog = {
  readonly models: readonly MockLlmOpenAiCatalogModel[];
};

export type MockLlmOpenAiRuntimeErrorCode =
  | "authentication"
  | "dialect_disabled"
  | "internal"
  | "invalid_request"
  | "model_not_found"
  | "server_not_found";

export type MockLlmOpenAiRuntimeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: MockLlmOpenAiRuntimeErrorCode };

export type MockLlmOpenAiRuntime = {
  getCatalog(input: {
    readonly slug: string;
    readonly credential: string;
  }): Promise<MockLlmOpenAiRuntimeResult<MockLlmOpenAiCatalog>>;
  planChatCompletion(input: {
    readonly slug: string;
    readonly credential: string;
    readonly request: JsonValue;
  }): Promise<MockLlmOpenAiRuntimeResult<MockLlmPlan>>;
};

export type MockLlmOpenAiRoute = {
  readonly slug: string;
  readonly providerPath: string;
};

export type ParsedMockLlmOpenAiChatRequest = {
  readonly request: Readonly<Record<string, JsonValue>>;
  readonly model: string;
  readonly turnIndex: number;
  readonly stream: boolean;
  readonly includeUsage: boolean;
  readonly includeObfuscation: boolean;
  readonly fingerprint: Readonly<Record<string, JsonValue>>;
};

export class MockLlmOpenAiRequestError extends Error {
  constructor(
    readonly code: "invalid_json" | "invalid_request" | "request_too_large",
    readonly parameter?: string,
    options?: ErrorOptions
  ) {
    super("The OpenAI mock request is invalid.", options);
    this.name = "MockLlmOpenAiRequestError";
  }
}

type OpenAiErrorInput = {
  readonly status: number;
  readonly message: string;
  readonly type: string;
  readonly code: string;
  readonly requestId: string;
  readonly parameter?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
};

const openAiError = (input: OpenAiErrorInput): Response =>
  Response.json(
    {
      error: {
        message: input.message,
        type: input.type,
        param: input.parameter ?? null,
        code: input.code,
      },
    },
    {
      status: input.status,
      headers: {
        "x-request-id": input.requestId,
        ...input.headers,
      },
    }
  );

const invalidRequest = (
  requestId: string,
  code = "invalid_request",
  parameter?: string
): Response =>
  openAiError({
    status: 400,
    message: "The request is not valid for this mock OpenAI endpoint.",
    type: "invalid_request_error",
    code,
    requestId,
    parameter,
  });

const authenticationError = (requestId: string): Response =>
  openAiError({
    status: 401,
    message: "A valid provider-scoped Mock Credential is required.",
    type: "authentication_error",
    code: "invalid_api_key",
    requestId,
    headers: { "www-authenticate": "Bearer" },
  });

const notFoundError = (
  requestId: string,
  code: "mock_llm_server_not_found" | "model_not_found" | "route_not_found",
  parameter?: string
): Response =>
  openAiError({
    status: 404,
    message:
      code === "model_not_found"
        ? "The requested mock model does not exist."
        : code === "route_not_found"
          ? "The requested mock OpenAI route does not exist."
          : "The requested mock LLM server does not exist or OpenAI is disabled.",
    type: "invalid_request_error",
    code,
    requestId,
    parameter,
  });

const internalError = (requestId: string): Response =>
  openAiError({
    status: 500,
    message: "The mock OpenAI request could not be completed.",
    type: "api_error",
    code: "internal_error",
    requestId,
  });

const requestTooLarge = (requestId: string): Response =>
  openAiError({
    status: 413,
    message: "The mock OpenAI request body is too large.",
    type: "request_too_large_error",
    code: "request_too_large",
    requestId,
  });

const methodNotAllowed = (requestId: string, allow: string): Response =>
  openAiError({
    status: 405,
    message: "The HTTP method is not supported by this mock OpenAI route.",
    type: "invalid_request_error",
    code: "method_not_allowed",
    requestId,
    headers: { allow },
  });

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasOnlyFields = (
  value: Readonly<Record<string, JsonValue>>,
  fields: ReadonlySet<string>
): boolean => Object.keys(value).every((field) => fields.has(field));

const validOptionalName = (value: JsonValue | undefined): boolean =>
  value === undefined ||
  (typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value));

const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).byteLength;
const validText = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && utf8Length(value) <= MOCK_LLM_OPENAI_MAX_TEXT_BYTES;
const COMMON_MESSAGE_FIELDS = new Set(["role", "content", "name"]);
const ASSISTANT_MESSAGE_FIELDS = new Set(["role", "content", "name", "tool_calls"]);
const TOOL_MESSAGE_FIELDS = new Set(["role", "content", "tool_call_id"]);

const validateAssistantToolCalls = (
  input: JsonValue | undefined,
  messageIndex: number
): void => {
  if (input === undefined) return;
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MOCK_LLM_OPENAI_MAX_TOOLS
  ) {
    throw new MockLlmOpenAiRequestError(
      "invalid_request",
      `messages.${messageIndex}.tool_calls`
    );
  }
  for (const [toolIndex, toolCall] of input.entries()) {
    if (
      !isRecord(toolCall) ||
      !hasOnlyFields(toolCall, new Set(["id", "type", "function"])) ||
      typeof toolCall.id !== "string" ||
      toolCall.id.length < 1 ||
      toolCall.id.length > 256 ||
      toolCall.type !== "function" ||
      !isRecord(toolCall.function) ||
      !hasOnlyFields(toolCall.function, new Set(["name", "arguments"])) ||
      typeof toolCall.function.name !== "string" ||
      !FUNCTION_NAME_PATTERN.test(toolCall.function.name) ||
      typeof toolCall.function.arguments !== "string" ||
      utf8Length(toolCall.function.arguments) > MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES
    ) {
      throw new MockLlmOpenAiRequestError(
        "invalid_request",
        `messages.${messageIndex}.tool_calls.${toolIndex}`
      );
    }
  }
};

const messageFingerprint = (
  rawMessage: JsonValue,
  index: number
): Readonly<Record<string, JsonValue>> => {
  if (!isRecord(rawMessage)) {
    throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}`);
  }
  const role = rawMessage.role;
  if (
    role !== "assistant" &&
    role !== "developer" &&
    role !== "system" &&
    role !== "tool" &&
    role !== "user"
  ) {
    throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}.role`);
  }
  if (!Object.hasOwn(rawMessage, "content") && role !== "assistant") {
    throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}.content`);
  }
  if (role === "assistant") {
    if (
      !hasOnlyFields(rawMessage, ASSISTANT_MESSAGE_FIELDS) ||
      !validOptionalName(rawMessage.name) ||
      (rawMessage.content !== undefined &&
        rawMessage.content !== null &&
        !validText(rawMessage.content))
    ) {
      throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}`);
    }
    validateAssistantToolCalls(rawMessage.tool_calls, index);
    if (
      (rawMessage.content === undefined || rawMessage.content === null) &&
      rawMessage.tool_calls === undefined
    ) {
      throw new MockLlmOpenAiRequestError(
        "invalid_request",
        `messages.${index}.content`
      );
    }
  } else if (role === "tool") {
    if (
      !hasOnlyFields(rawMessage, TOOL_MESSAGE_FIELDS) ||
      !validText(rawMessage.content) ||
      typeof rawMessage.tool_call_id !== "string" ||
      rawMessage.tool_call_id.length < 1 ||
      rawMessage.tool_call_id.length > 256
    ) {
      throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}`);
    }
  } else if (
    !hasOnlyFields(rawMessage, COMMON_MESSAGE_FIELDS) ||
    !validText(rawMessage.content) ||
    !validOptionalName(rawMessage.name)
  ) {
    throw new MockLlmOpenAiRequestError("invalid_request", `messages.${index}`);
  }
  const fingerprint: Record<string, JsonValue> = {
    role,
    content: rawMessage.content ?? null,
  };
  if (typeof rawMessage.name === "string") fingerprint.name = rawMessage.name;
  if (typeof rawMessage.tool_call_id === "string") {
    fingerprint.toolCallId = rawMessage.tool_call_id;
  }
  if (rawMessage.tool_calls !== undefined) {
    fingerprint.toolCalls = canonicalMockLlmJson(rawMessage.tool_calls);
  }
  return fingerprint;
};

type NormalizedTools = {
  readonly definitions: readonly string[];
  readonly names: readonly string[];
};

const toolDefinitions = (rawTools: JsonValue | undefined): NormalizedTools => {
  if (rawTools === undefined) return { definitions: [], names: [] };
  if (!Array.isArray(rawTools) || rawTools.length > MOCK_LLM_OPENAI_MAX_TOOLS) {
    throw new MockLlmOpenAiRequestError("invalid_request", "tools");
  }
  const names = new Set<string>();
  const definitions = rawTools.map((rawTool, index) => {
    try {
      assertBehaviorSpecBounds(rawTool, {
        maximumBytes: MOCK_LLM_OPENAI_MAX_TOOL_VALUE_BYTES,
        maximumDepth: MOCK_LLM_OPENAI_MAX_TOOL_VALUE_DEPTH,
        maximumNodes: MOCK_LLM_OPENAI_MAX_TOOL_VALUE_NODES,
      });
    } catch (cause) {
      throw new MockLlmOpenAiRequestError("invalid_request", `tools.${index}`, {
        cause,
      });
    }
    if (
      !isRecord(rawTool) ||
      !hasOnlyFields(rawTool, new Set(["type", "function"])) ||
      rawTool.type !== "function"
    ) {
      throw new MockLlmOpenAiRequestError("invalid_request", `tools.${index}`);
    }
    const functionDefinition = rawTool.function;
    if (
      !isRecord(functionDefinition) ||
      !hasOnlyFields(
        functionDefinition,
        new Set(["name", "description", "parameters", "strict"])
      ) ||
      typeof functionDefinition.name !== "string" ||
      !FUNCTION_NAME_PATTERN.test(functionDefinition.name) ||
      (functionDefinition.description !== undefined &&
        typeof functionDefinition.description !== "string") ||
      (functionDefinition.parameters !== undefined &&
        !isRecord(functionDefinition.parameters)) ||
      (functionDefinition.strict !== undefined &&
        typeof functionDefinition.strict !== "boolean")
    ) {
      throw new MockLlmOpenAiRequestError(
        "invalid_request",
        `tools.${index}.function.name`
      );
    }
    if (names.has(functionDefinition.name)) {
      throw new MockLlmOpenAiRequestError("invalid_request", "tools");
    }
    names.add(functionDefinition.name);
    return canonicalMockLlmJson(rawTool);
  });
  return { definitions, names: [...names] };
};

export const parseMockLlmOpenAiChatRequest = (
  input: unknown
): ParsedMockLlmOpenAiChatRequest => {
  try {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES,
      maximumDepth: MOCK_LLM_OPENAI_MAX_REQUEST_DEPTH,
      maximumNodes: MOCK_LLM_OPENAI_MAX_REQUEST_NODES,
    });
  } catch (cause) {
    throw new MockLlmOpenAiRequestError("request_too_large", undefined, { cause });
  }

  let value: JsonValue;
  try {
    value = jsonValueSchema.parse(input);
  } catch (cause) {
    throw new MockLlmOpenAiRequestError("invalid_request", undefined, { cause });
  }
  if (!isRecord(value)) {
    throw new MockLlmOpenAiRequestError("invalid_request");
  }
  if (
    !hasOnlyFields(
      value,
      new Set([
        "model",
        "messages",
        "n",
        "stream",
        "stream_options",
        "tool_choice",
        "tools",
      ])
    )
  ) {
    throw new MockLlmOpenAiRequestError("invalid_request");
  }

  const parsedModel = mockLlmModelSchema.safeParse(value.model);
  if (!parsedModel.success) {
    throw new MockLlmOpenAiRequestError("invalid_request", "model");
  }
  if (
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > MOCK_LLM_OPENAI_MAX_MESSAGES
  ) {
    throw new MockLlmOpenAiRequestError("invalid_request", "messages");
  }
  if (value.stream !== undefined && typeof value.stream !== "boolean") {
    throw new MockLlmOpenAiRequestError("invalid_request", "stream");
  }
  const stream = value.stream === true;
  let includeUsage = false;
  let includeObfuscation = stream;
  if (Object.hasOwn(value, "stream_options")) {
    if (
      !stream ||
      !isRecord(value.stream_options) ||
      !hasOnlyFields(
        value.stream_options,
        new Set(["include_usage", "include_obfuscation"])
      ) ||
      (value.stream_options.include_usage !== undefined &&
        typeof value.stream_options.include_usage !== "boolean") ||
      (value.stream_options.include_obfuscation !== undefined &&
        typeof value.stream_options.include_obfuscation !== "boolean")
    ) {
      throw new MockLlmOpenAiRequestError("invalid_request", "stream_options");
    }
    includeUsage = value.stream_options.include_usage === true;
    includeObfuscation = value.stream_options.include_obfuscation !== false;
  }
  if (
    value.n !== undefined &&
    (typeof value.n !== "number" || !Number.isSafeInteger(value.n) || value.n !== 1)
  ) {
    throw new MockLlmOpenAiRequestError("invalid_request", "n");
  }
  if (value.tool_choice !== undefined && value.tool_choice !== "auto") {
    throw new MockLlmOpenAiRequestError("invalid_request", "tool_choice");
  }

  const messages = value.messages.map(messageFingerprint);
  const normalizedTools = toolDefinitions(value.tools);
  const turnIndex = messages.reduce(
    (count, message) => count + (message.role === "assistant" ? 1 : 0),
    0
  );
  const fingerprint: Record<string, JsonValue> = {
    dialect: "openai",
    operation: "chat.completions.create",
    model: parsedModel.data,
    messages: messages.map((message) => ({ ...message })),
    toolNames: [...normalizedTools.names],
    toolDefinitions: [...normalizedTools.definitions],
  };
  return Object.freeze({
    request: Object.freeze(value),
    model: parsedModel.data,
    turnIndex,
    stream,
    includeUsage,
    includeObfuscation,
    fingerprint: Object.freeze(fingerprint),
  });
};

const contentLengthExceedsLimit = (request: Request): boolean => {
  const value = request.headers.get("content-length")?.trim();
  if (!value) return false;
  return !/^\d+$/.test(value) || Number(value) > MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES;
};

const readBoundedJsonBody = async (request: Request): Promise<unknown> => {
  if (contentLengthExceedsLimit(request)) {
    void request.body?.cancel("mock LLM request body limit reached").catch(() => {});
    throw new MockLlmOpenAiRequestError("request_too_large");
  }
  if (!request.body) throw new MockLlmOpenAiRequestError("invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MOCK_LLM_OPENAI_MAX_REQUEST_BODY_BYTES) {
        void reader.cancel("mock LLM request body limit reached").catch(() => {});
        throw new MockLlmOpenAiRequestError("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
  } catch (cause) {
    throw new MockLlmOpenAiRequestError("invalid_json", undefined, { cause });
  }
};

export const mockLlmValueContainsSecret = (
  root: unknown,
  secrets: readonly (string | undefined)[]
): boolean => {
  const candidates = secrets.filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0
  );
  if (candidates.length === 0) return false;
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (candidates.some((secret) => value.includes(secret))) return true;
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (candidates.some((secret) => key.includes(secret))) return true;
      pending.push(child);
    }
  }
  return false;
};

export const mockLlmPlanContainsSecret = (
  plan: MockLlmPlan,
  secrets: readonly (string | undefined)[]
): boolean =>
  mockLlmValueContainsSecret(plan, secrets) ||
  (plan.kind === "response" &&
    mockLlmValueContainsSecret(
      plan.segments
        .filter(
          (
            segment
          ): segment is Extract<
            (typeof plan.segments)[number],
            { readonly type: "text" }
          > => segment.type === "text"
        )
        .map((segment) => segment.text)
        .join(""),
      secrets
    ));

const bearerCredential = (request: Request): string | undefined => {
  const authorization = request.headers.get("authorization");
  const match = authorization && /^Bearer +([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) return undefined;
  const parsed = mockLlmMockCredentialSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : undefined;
};

const providerIdentity = (): { requestId: string; responseId: string } => {
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const responseId = crypto.randomUUID().replaceAll("-", "");
  return {
    requestId: `req_${requestId}`,
    responseId: `chatcmpl-${responseId}`,
  };
};

const validateCatalog = (
  input: MockLlmOpenAiCatalog
): readonly MockLlmOpenAiCatalogModel[] | undefined => {
  if (!Array.isArray(input.models) || input.models.length > 64) return undefined;
  const seen = new Set<string>();
  const models: MockLlmOpenAiCatalogModel[] = [];
  for (const model of input.models) {
    const id = mockLlmModelSchema.safeParse(model?.id);
    if (
      !id.success ||
      seen.has(id.data) ||
      !Number.isSafeInteger(model?.createdAtEpochSeconds) ||
      model.createdAtEpochSeconds < 0
    ) {
      return undefined;
    }
    seen.add(id.data);
    models.push({
      id: id.data,
      createdAtEpochSeconds: model.createdAtEpochSeconds,
    });
  }
  return models;
};

const modelBody = (model: MockLlmOpenAiCatalogModel) => ({
  id: model.id,
  object: "model",
  created: model.createdAtEpochSeconds,
  owned_by: "mockos",
});

const jsonResponse = (
  body: Readonly<Record<string, unknown>>,
  requestId: string
): Response => {
  const serialized = JSON.stringify(body);
  if (utf8Length(serialized) > MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES) {
    return internalError(requestId);
  }
  return new Response(serialized, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
  });
};

const responseForRuntimeError = (
  code: MockLlmOpenAiRuntimeErrorCode,
  requestId: string
): Response => {
  switch (code) {
    case "authentication":
      return authenticationError(requestId);
    case "dialect_disabled":
    case "server_not_found":
      return notFoundError(requestId, "mock_llm_server_not_found");
    case "model_not_found":
      return notFoundError(requestId, "model_not_found", "model");
    case "invalid_request":
      return invalidRequest(requestId);
    case "internal":
      return internalError(requestId);
  }
};

const callRuntime = async <Value>(
  operation: () => Promise<MockLlmOpenAiRuntimeResult<Value>>
): Promise<MockLlmOpenAiRuntimeResult<Value> | undefined> => {
  try {
    return await operation();
  } catch {
    return undefined;
  }
};

const defaultDelay = async (milliseconds: number, signal: AbortSignal) => {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
  }
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const complete = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
};

export type CreateMockLlmOpenAiFetchHandlerOptions = {
  readonly runtime: MockLlmOpenAiRuntime;
  readonly platformApiKey?: string;
  readonly observation?: MockLlmProviderObservationHook;
  readonly createIdentity?: () => {
    readonly requestId: string;
    readonly responseId: string;
  };
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly durationNow?: () => number;
};

export const createMockLlmOpenAiFetchHandler = (
  options: CreateMockLlmOpenAiFetchHandlerOptions
) => {
  const createIdentity = options.createIdentity ?? providerIdentity;
  const delay = options.delay ?? defaultDelay;
  return async (request: Request, rawRoute: MockLlmOpenAiRoute): Promise<Response> => {
    const durationNow = options.durationNow ?? (() => performance.now());
    const requestStartedAtMilliseconds = durationNow();
    const elapsedDurationMilliseconds = () =>
      Math.max(0, Math.floor(durationNow() - requestStartedAtMilliseconds));
    const identity = createIdentity();
    const slug = mockLlmSlugSchema.safeParse(rawRoute.slug);
    if (!slug.success || !rawRoute.providerPath.startsWith("/")) {
      void request.body?.cancel("invalid mock LLM route").catch(() => {});
      return notFoundError(identity.requestId, "route_not_found");
    }

    const credential = bearerCredential(request);
    if (
      !credential ||
      request.headers.has("x-api-key") ||
      request.headers.has("x-anthropic-api-key") ||
      (options.platformApiKey && credential.includes(options.platformApiKey))
    ) {
      void request.body?.cancel("mock LLM authentication rejected").catch(() => {});
      return authenticationError(identity.requestId);
    }

    if (request.method === "GET" && rawRoute.providerPath === "/models") {
      const result = await callRuntime(() =>
        options.runtime.getCatalog({
          slug: slug.data,
          credential,
        })
      );
      if (!result) return internalError(identity.requestId);
      if (!result.ok) return responseForRuntimeError(result.code, identity.requestId);
      const models = validateCatalog(result.value);
      if (
        !models ||
        mockLlmValueContainsSecret(models, [credential, options.platformApiKey])
      ) {
        return internalError(identity.requestId);
      }
      return jsonResponse(
        { object: "list", data: models.map(modelBody) },
        identity.requestId
      );
    }
    if (rawRoute.providerPath === "/models") {
      void request.body?.cancel("mock LLM method rejected").catch(() => {});
      return methodNotAllowed(identity.requestId, "GET");
    }

    if (rawRoute.providerPath.startsWith("/models/")) {
      if (request.method !== "GET") {
        void request.body?.cancel("mock LLM method rejected").catch(() => {});
        return methodNotAllowed(identity.requestId, "GET");
      }
      const encodedModel = rawRoute.providerPath.slice("/models/".length);
      if (!encodedModel || encodedModel.includes("/")) {
        return notFoundError(identity.requestId, "route_not_found");
      }
      let requestedModel: string;
      try {
        requestedModel = decodeURIComponent(encodedModel);
      } catch {
        return notFoundError(identity.requestId, "route_not_found");
      }
      if (!mockLlmModelSchema.safeParse(requestedModel).success) {
        return notFoundError(identity.requestId, "model_not_found", "model");
      }
      const result = await callRuntime(() =>
        options.runtime.getCatalog({
          slug: slug.data,
          credential,
        })
      );
      if (!result) return internalError(identity.requestId);
      if (!result.ok) return responseForRuntimeError(result.code, identity.requestId);
      const models = validateCatalog(result.value);
      if (
        !models ||
        mockLlmValueContainsSecret(models, [credential, options.platformApiKey])
      ) {
        return internalError(identity.requestId);
      }
      const model = models.find((candidate) => candidate.id === requestedModel);
      return model
        ? jsonResponse(modelBody(model), identity.requestId)
        : notFoundError(identity.requestId, "model_not_found", "model");
    }

    if (rawRoute.providerPath !== "/chat/completions") {
      void request.body?.cancel("mock LLM route not found").catch(() => {});
      return notFoundError(identity.requestId, "route_not_found");
    }
    if (request.method !== "POST") {
      void request.body?.cancel("mock LLM method rejected").catch(() => {});
      return methodNotAllowed(identity.requestId, "POST");
    }
    const contentTypeParts = request.headers
      .get("content-type")
      ?.split(";")
      .map((part) => part.trim());
    const mediaType = contentTypeParts?.[0]?.toLowerCase();
    const mediaTypeParameters = contentTypeParts?.slice(1) ?? [];
    if (
      mediaType !== "application/json" ||
      mediaTypeParameters.some((parameter) => !/^charset\s*=\s*utf-8$/i.test(parameter))
    ) {
      void request.body?.cancel("mock LLM media type rejected").catch(() => {});
      return invalidRequest(identity.requestId, "invalid_content_type");
    }
    const contentEncoding = request.headers
      .get("content-encoding")
      ?.trim()
      .toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      void request.body?.cancel("mock LLM content encoding rejected").catch(() => {});
      return invalidRequest(identity.requestId, "unsupported_content_encoding");
    }

    let body: unknown;
    let parsed: ParsedMockLlmOpenAiChatRequest;
    try {
      body = await readBoundedJsonBody(request);
      parsed = parseMockLlmOpenAiChatRequest(body);
    } catch (error) {
      if (
        error instanceof MockLlmOpenAiRequestError &&
        error.code === "request_too_large"
      ) {
        return requestTooLarge(identity.requestId);
      }
      return invalidRequest(
        identity.requestId,
        error instanceof MockLlmOpenAiRequestError ? error.code : "invalid_request",
        error instanceof MockLlmOpenAiRequestError ? error.parameter : undefined
      );
    }
    if (mockLlmValueContainsSecret(body, [credential, options.platformApiKey])) {
      return invalidRequest(identity.requestId, "credential_reflection_not_allowed");
    }

    const result = await callRuntime(() =>
      options.runtime.planChatCompletion({
        slug: slug.data,
        credential,
        request: parsed.request,
      })
    );
    if (!result) return internalError(identity.requestId);
    if (!result.ok) return responseForRuntimeError(result.code, identity.requestId);
    let plan: MockLlmPlan;
    try {
      plan = parseMockLlmPlan(result.value);
    } catch {
      return internalError(identity.requestId);
    }
    if (plan.model !== parsed.model) {
      return internalError(identity.requestId);
    }
    if (mockLlmPlanContainsSecret(plan, [credential, options.platformApiKey])) {
      return internalError(identity.requestId);
    }
    if (plan.kind === "response") {
      const declaredTools = new Set(
        Array.isArray(parsed.fingerprint.toolNames)
          ? parsed.fingerprint.toolNames.filter(
              (name): name is string => typeof name === "string"
            )
          : []
      );
      if (
        plan.segments.some(
          (segment) => segment.type === "tool_call" && !declaredTools.has(segment.name)
        )
      ) {
        return internalError(identity.requestId);
      }
    }
    const wire = renderOpenAiPlan(plan, {
      stream: parsed.stream,
      includeUsage: parsed.includeUsage,
      includeObfuscation: parsed.includeObfuscation,
      requestId: identity.requestId,
      responseId: identity.responseId,
    });
    if (mockLlmValueContainsSecret(wire, [credential, options.platformApiKey])) {
      return internalError(identity.requestId);
    }
    const observationPrivacyGuard = createMockLlmProviderObservationPrivacyGuard([
      credential,
      options.platformApiKey,
    ]);
    const prospectiveObservationMetadata = {
      requestPath: new URL(request.url).pathname,
      possibleResponseStatuses: [wire.status, 499, 500],
    };

    const observationStart = (): MockLlmProviderObservationStart =>
      plan.kind === "response"
        ? {
            observationId: identity.requestId,
            responseId: identity.responseId,
            dialect: "openai",
            operation: "chat.completions.create",
            slug: slug.data,
            method: "POST",
            path: "/chat/completions",
            model: parsed.model,
            stream: parsed.stream,
            turnIndex: plan.turnIndex,
            response: {
              inputTokens: plan.usage.inputTokens,
              outputTokens: plan.usage.outputTokens,
              stopReason: plan.stopReason,
              toolNames: plan.segments.flatMap((segment) =>
                segment.type === "tool_call" ? [segment.name] : []
              ),
            },
          }
        : {
            observationId: identity.requestId,
            dialect: "openai",
            operation: "chat.completions.create",
            slug: slug.data,
            method: "POST",
            path: "/chat/completions",
            model: parsed.model,
            stream: parsed.stream,
            turnIndex: plan.turnIndex,
            errorKind: plan.error.kind,
          };
    const finishObservation = (
      reserved: boolean,
      outcome: "cancelled" | "completed" | "deadline_exceeded" | "failed",
      responseStatus: number
    ): void =>
      scheduleMockLlmProviderObservationFinish(
        options.observation,
        reserved,
        {
          observationId: identity.requestId,
          outcome,
          responseStatus,
          durationMilliseconds: elapsedDurationMilliseconds(),
        },
        observationPrivacyGuard
      );

    if (wire.kind === "sse") {
      if (plan.kind !== "response") return internalError(identity.requestId);
      let prepared: ReturnType<typeof prepareEdgeSseStream>;
      try {
        prepared = prepareEdgeSseStream({
          frames: wire.frames,
          schedule: plan.cadence,
          signal: request.signal,
          maximumBytes: MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES,
          ...(options.now ? { now: options.now } : {}),
        });
      } catch {
        return internalError(identity.requestId);
      }
      const reserved = await reserveMockLlmProviderObservation(
        options.observation,
        observationStart(),
        observationPrivacyGuard,
        prospectiveObservationMetadata
      );
      let selectedResponseStatus: number | undefined;
      scheduleMockLlmProviderObservationFinish(
        options.observation,
        reserved,
        prepared.terminal.then((result) => ({
          observationId: identity.requestId,
          outcome: result.outcome,
          responseStatus:
            selectedResponseStatus ?? (result.outcome === "cancelled" ? 499 : 500),
          durationMilliseconds: elapsedDurationMilliseconds(),
        })),
        observationPrivacyGuard
      );
      try {
        await prepared.waitForInitialDelay();
      } catch {
        if (request.signal.aborted) {
          return new Response(null, { status: 499 });
        }
        return internalError(identity.requestId);
      }
      try {
        const response = new Response(prepared.createReadableStream(), {
          status: wire.status,
          headers: wire.headers,
        });
        selectedResponseStatus = wire.status;
        return response;
      } catch {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        return internalError(identity.requestId);
      }
    }

    const serialized = JSON.stringify(wire.body);
    if (utf8Length(serialized) > MOCK_LLM_OPENAI_MAX_RESPONSE_BODY_BYTES) {
      return internalError(identity.requestId);
    }
    const reserved = await reserveMockLlmProviderObservation(
      options.observation,
      observationStart(),
      observationPrivacyGuard,
      prospectiveObservationMetadata
    );
    const initialDelayMilliseconds =
      plan.kind === "response"
        ? plan.cadence.initialDelayMilliseconds
        : plan.initialDelayMilliseconds;
    try {
      await delay(initialDelayMilliseconds, request.signal);
    } catch (reason) {
      if (request.signal.aborted) {
        finishObservation(reserved, "cancelled", 499);
        return new Response(null, { status: 499 });
      }
      finishObservation(
        reserved,
        reason instanceof EdgeSseStreamDeadlineError ? "deadline_exceeded" : "failed",
        500
      );
      return internalError(identity.requestId);
    }
    try {
      const response = new Response(serialized, {
        status: wire.status,
        headers: wire.headers,
      });
      finishObservation(reserved, "completed", wire.status);
      return response;
    } catch {
      finishObservation(reserved, "failed", 500);
      return internalError(identity.requestId);
    }
  };
};
