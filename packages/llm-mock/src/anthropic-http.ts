import {
  assertBehaviorSpecBounds,
  type JsonValue,
  jsonValueSchema,
} from "@mockos/contracts/behavior";
import {
  MOCK_LLM_MAX_TOKEN_COUNT,
  type MockLlmPlan,
  mockLlmModelSchema,
  parseMockLlmPlan,
} from "@mockos/contracts/mock-llm";
import {
  mockLlmMockCredentialSchema,
  mockLlmSlugSchema,
} from "@mockos/contracts/mock-llm-server";
import { renderAnthropicPlan } from "./anthropic";
import { canonicalMockLlmJson } from "./canonical-json";
import { mockLlmValueContainsSecret } from "./openai-http";

export const MOCK_LLM_ANTHROPIC_VERSION = "2023-06-01";
export const MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES = 256 * 1_024;
export const MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH = 24;
export const MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES = 10_000;
export const MOCK_LLM_ANTHROPIC_MAX_MESSAGES = 256;
export const MOCK_LLM_ANTHROPIC_MAX_CONTENT_BLOCKS = 256;
export const MOCK_LLM_ANTHROPIC_MAX_TOOLS = 64;
export const MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES = 64 * 1_024;
export const MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_BYTES = 64 * 1_024;
export const MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_DEPTH = 16;
export const MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_NODES = 2_000;
export const MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES = 2 * 1_024 * 1_024;

export const mockLlmAnthropicProviderManifest = Object.freeze({
  version: 1,
  dialect: "anthropic",
  routePrefix: "/llm-mock/{slug}/anthropic",
  authentication: {
    scheme: "x-api-key",
    modes: ["accept_any", "strict"] as const,
  },
  requiredHeaders: {
    "anthropic-version": MOCK_LLM_ANTHROPIC_VERSION,
  },
  operations: [
    {
      id: "create_message",
      method: "POST",
      path: "/v1/messages",
      streaming: false,
    },
    {
      id: "list_models",
      method: "GET",
      path: "/v1/models",
      streaming: false,
    },
    {
      id: "retrieve_model",
      method: "GET",
      path: "/v1/models/{model}",
      streaming: false,
    },
  ] as const,
});

export type MockLlmAnthropicCatalogModel = {
  readonly id: string;
  readonly displayName: string;
  readonly createdAtEpochSeconds: number;
};

export type MockLlmAnthropicCatalog = {
  readonly models: readonly MockLlmAnthropicCatalogModel[];
};

export type MockLlmAnthropicRuntimeErrorCode =
  | "authentication"
  | "dialect_disabled"
  | "internal"
  | "invalid_request"
  | "model_not_found"
  | "server_not_found";

export type MockLlmAnthropicRuntimeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: MockLlmAnthropicRuntimeErrorCode };

export type MockLlmAnthropicRuntime = {
  getCatalog(input: {
    readonly slug: string;
    readonly credential: string;
  }): Promise<MockLlmAnthropicRuntimeResult<MockLlmAnthropicCatalog>>;
  planMessage(input: {
    readonly slug: string;
    readonly credential: string;
    readonly request: JsonValue;
  }): Promise<MockLlmAnthropicRuntimeResult<MockLlmPlan>>;
};

export type MockLlmAnthropicRoute = {
  readonly slug: string;
  readonly providerPath: string;
};

export type ParsedMockLlmAnthropicMessageRequest = {
  readonly request: Readonly<Record<string, JsonValue>>;
  readonly model: string;
  readonly turnIndex: number;
  readonly fingerprint: Readonly<Record<string, JsonValue>>;
};

export class MockLlmAnthropicRequestError extends Error {
  constructor(
    readonly code:
      | "invalid_json"
      | "invalid_request"
      | "request_too_large"
      | "streaming_not_supported",
    readonly parameter?: string,
    options?: ErrorOptions
  ) {
    super("The Anthropic mock request is invalid.", options);
    this.name = "MockLlmAnthropicRequestError";
  }
}

type AnthropicErrorType =
  | "api_error"
  | "authentication_error"
  | "invalid_request_error"
  | "not_found_error"
  | "request_too_large";

type AnthropicErrorInput = {
  readonly status: number;
  readonly message: string;
  readonly type: AnthropicErrorType;
  readonly requestId: string;
  readonly headers?: Readonly<Record<string, string>>;
};

const anthropicError = (input: AnthropicErrorInput): Response =>
  Response.json(
    {
      type: "error",
      error: {
        type: input.type,
        message: input.message,
      },
      request_id: input.requestId,
    },
    {
      status: input.status,
      headers: {
        "request-id": input.requestId,
        ...input.headers,
      },
    }
  );

const invalidRequest = (requestId: string): Response =>
  anthropicError({
    status: 400,
    message: "The request is not valid for this mock Anthropic endpoint.",
    type: "invalid_request_error",
    requestId,
  });

const streamingNotSupported = (requestId: string): Response =>
  anthropicError({
    status: 400,
    message: "Streaming is not supported by this mock Anthropic endpoint.",
    type: "invalid_request_error",
    requestId,
  });

const authenticationError = (requestId: string): Response =>
  anthropicError({
    status: 401,
    message: "A valid provider-scoped Mock Credential is required.",
    type: "authentication_error",
    requestId,
  });

const notFoundError = (
  requestId: string,
  target: "model" | "route" | "server"
): Response =>
  anthropicError({
    status: 404,
    message:
      target === "model"
        ? "The requested mock model does not exist."
        : target === "route"
          ? "The requested mock Anthropic route does not exist."
          : "The requested mock LLM server does not exist or Anthropic is disabled.",
    type: "not_found_error",
    requestId,
  });

const internalError = (requestId: string): Response =>
  anthropicError({
    status: 500,
    message: "The mock Anthropic request could not be completed.",
    type: "api_error",
    requestId,
  });

const requestTooLarge = (requestId: string): Response =>
  anthropicError({
    status: 413,
    message: "The mock Anthropic request body is too large.",
    type: "request_too_large",
    requestId,
  });

const methodNotAllowed = (requestId: string, allow: string): Response =>
  anthropicError({
    status: 405,
    message: "The HTTP method is not supported by this mock Anthropic route.",
    type: "invalid_request_error",
    requestId,
    headers: { allow },
  });

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasOnlyFields = (
  value: Readonly<Record<string, JsonValue>>,
  fields: ReadonlySet<string>
): boolean => Object.keys(value).every((field) => fields.has(field));

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const validText = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && utf8Length(value) <= MOCK_LLM_ANTHROPIC_MAX_TEXT_BYTES;

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MESSAGE_FIELDS = new Set(["role", "content"]);
const TEXT_BLOCK_FIELDS = new Set(["type", "text"]);
const TOOL_USE_BLOCK_FIELDS = new Set(["type", "id", "name", "input"]);
const TOOL_RESULT_BLOCK_FIELDS = new Set([
  "type",
  "tool_use_id",
  "content",
  "is_error",
]);

const assertToolValueBounds = (value: unknown, parameter: string): void => {
  try {
    assertBehaviorSpecBounds(value, {
      maximumBytes: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_BYTES,
      maximumDepth: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_DEPTH,
      maximumNodes: MOCK_LLM_ANTHROPIC_MAX_TOOL_VALUE_NODES,
    });
  } catch (cause) {
    throw new MockLlmAnthropicRequestError("invalid_request", parameter, {
      cause,
    });
  }
};

const validToolIdentifier = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 256;

const normalizeTextBlock = (
  rawBlock: Record<string, JsonValue>,
  parameter: string
): Readonly<Record<string, JsonValue>> => {
  if (
    !hasOnlyFields(rawBlock, TEXT_BLOCK_FIELDS) ||
    rawBlock.type !== "text" ||
    !validText(rawBlock.text)
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", parameter);
  }
  return { type: "text", text: rawBlock.text };
};

const normalizeToolUseBlock = (
  rawBlock: Record<string, JsonValue>,
  parameter: string
): Readonly<Record<string, JsonValue>> => {
  assertToolValueBounds(rawBlock, parameter);
  if (
    !hasOnlyFields(rawBlock, TOOL_USE_BLOCK_FIELDS) ||
    rawBlock.type !== "tool_use" ||
    !validToolIdentifier(rawBlock.id) ||
    typeof rawBlock.name !== "string" ||
    !TOOL_NAME_PATTERN.test(rawBlock.name) ||
    !isRecord(rawBlock.input)
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", parameter);
  }
  return {
    type: "tool_use",
    id: rawBlock.id,
    name: rawBlock.name,
    input: canonicalMockLlmJson(rawBlock.input),
  };
};

const normalizeToolResultContent = (
  content: JsonValue | undefined,
  parameter: string
): JsonValue => {
  if (content === undefined) return "";
  if (validText(content)) return content;
  if (
    !Array.isArray(content) ||
    content.length < 1 ||
    content.length > MOCK_LLM_ANTHROPIC_MAX_CONTENT_BLOCKS
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", parameter);
  }
  return content.map((block, index) => {
    if (!isRecord(block)) {
      throw new MockLlmAnthropicRequestError(
        "invalid_request",
        `${parameter}.${index}`
      );
    }
    return normalizeTextBlock(block, `${parameter}.${index}`);
  });
};

const normalizeToolResultBlock = (
  rawBlock: Record<string, JsonValue>,
  parameter: string
): Readonly<Record<string, JsonValue>> => {
  assertToolValueBounds(rawBlock, parameter);
  if (
    !hasOnlyFields(rawBlock, TOOL_RESULT_BLOCK_FIELDS) ||
    rawBlock.type !== "tool_result" ||
    !validToolIdentifier(rawBlock.tool_use_id) ||
    (rawBlock.is_error !== undefined && typeof rawBlock.is_error !== "boolean")
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", parameter);
  }
  return {
    type: "tool_result",
    toolUseId: rawBlock.tool_use_id,
    content: normalizeToolResultContent(rawBlock.content, `${parameter}.content`),
    isError: rawBlock.is_error === true,
  };
};

const messageFingerprint = (
  rawMessage: JsonValue,
  index: number
): Readonly<Record<string, JsonValue>> => {
  if (
    !isRecord(rawMessage) ||
    !hasOnlyFields(rawMessage, MESSAGE_FIELDS) ||
    (rawMessage.role !== "user" && rawMessage.role !== "assistant")
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", `messages.${index}`);
  }
  const content = rawMessage.content;
  if (validText(content)) {
    return { role: rawMessage.role, content };
  }
  if (
    !Array.isArray(content) ||
    content.length < 1 ||
    content.length > MOCK_LLM_ANTHROPIC_MAX_CONTENT_BLOCKS
  ) {
    throw new MockLlmAnthropicRequestError(
      "invalid_request",
      `messages.${index}.content`
    );
  }
  const normalized = content.map((block, blockIndex) => {
    const parameter = `messages.${index}.content.${blockIndex}`;
    if (!isRecord(block)) {
      throw new MockLlmAnthropicRequestError("invalid_request", parameter);
    }
    if (block.type === "text") return normalizeTextBlock(block, parameter);
    if (block.type === "tool_use" && rawMessage.role === "assistant") {
      return normalizeToolUseBlock(block, parameter);
    }
    if (block.type === "tool_result" && rawMessage.role === "user") {
      return normalizeToolResultBlock(block, parameter);
    }
    throw new MockLlmAnthropicRequestError("invalid_request", parameter);
  });
  return { role: rawMessage.role, content: normalized };
};

type NormalizedTools = {
  readonly definitions: readonly string[];
  readonly names: readonly string[];
};

const toolDefinitions = (rawTools: JsonValue | undefined): NormalizedTools => {
  if (rawTools === undefined) return { definitions: [], names: [] };
  if (!Array.isArray(rawTools) || rawTools.length > MOCK_LLM_ANTHROPIC_MAX_TOOLS) {
    throw new MockLlmAnthropicRequestError("invalid_request", "tools");
  }
  const names = new Set<string>();
  const definitions = rawTools.map((rawTool, index) => {
    const parameter = `tools.${index}`;
    assertToolValueBounds(rawTool, parameter);
    if (
      !isRecord(rawTool) ||
      !hasOnlyFields(
        rawTool,
        new Set(["name", "description", "input_schema", "type"])
      ) ||
      typeof rawTool.name !== "string" ||
      !TOOL_NAME_PATTERN.test(rawTool.name) ||
      (rawTool.description !== undefined && !validText(rawTool.description)) ||
      !isRecord(rawTool.input_schema) ||
      rawTool.input_schema.type !== "object" ||
      (rawTool.type !== undefined && rawTool.type !== "custom")
    ) {
      throw new MockLlmAnthropicRequestError("invalid_request", parameter);
    }
    if (names.has(rawTool.name)) {
      throw new MockLlmAnthropicRequestError("invalid_request", "tools");
    }
    names.add(rawTool.name);
    return canonicalMockLlmJson(rawTool);
  });
  return { definitions, names: [...names] };
};

const validAutoToolChoice = (value: JsonValue | undefined): boolean =>
  value === undefined ||
  (isRecord(value) && hasOnlyFields(value, new Set(["type"])) && value.type === "auto");

export const parseMockLlmAnthropicMessageRequest = (
  input: unknown
): ParsedMockLlmAnthropicMessageRequest => {
  try {
    assertBehaviorSpecBounds(input, {
      maximumBytes: MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES,
      maximumDepth: MOCK_LLM_ANTHROPIC_MAX_REQUEST_DEPTH,
      maximumNodes: MOCK_LLM_ANTHROPIC_MAX_REQUEST_NODES,
    });
  } catch (cause) {
    throw new MockLlmAnthropicRequestError("request_too_large", undefined, {
      cause,
    });
  }

  let value: JsonValue;
  try {
    value = jsonValueSchema.parse(input);
  } catch (cause) {
    throw new MockLlmAnthropicRequestError("invalid_request", undefined, {
      cause,
    });
  }
  if (
    !isRecord(value) ||
    !hasOnlyFields(
      value,
      new Set([
        "model",
        "max_tokens",
        "messages",
        "stream",
        "system",
        "tool_choice",
        "tools",
      ])
    )
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request");
  }

  const parsedModel = mockLlmModelSchema.safeParse(value.model);
  if (!parsedModel.success) {
    throw new MockLlmAnthropicRequestError("invalid_request", "model");
  }
  if (
    typeof value.max_tokens !== "number" ||
    !Number.isSafeInteger(value.max_tokens) ||
    value.max_tokens < 1 ||
    value.max_tokens > MOCK_LLM_MAX_TOKEN_COUNT
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", "max_tokens");
  }
  if (
    !Array.isArray(value.messages) ||
    value.messages.length < 1 ||
    value.messages.length > MOCK_LLM_ANTHROPIC_MAX_MESSAGES
  ) {
    throw new MockLlmAnthropicRequestError("invalid_request", "messages");
  }
  if (value.system !== undefined && !validText(value.system)) {
    throw new MockLlmAnthropicRequestError("invalid_request", "system");
  }
  if (value.stream !== undefined && typeof value.stream !== "boolean") {
    throw new MockLlmAnthropicRequestError("invalid_request", "stream");
  }
  if (value.stream === true) {
    throw new MockLlmAnthropicRequestError("streaming_not_supported", "stream");
  }
  if (!validAutoToolChoice(value.tool_choice)) {
    throw new MockLlmAnthropicRequestError("invalid_request", "tool_choice");
  }

  const messages = value.messages.map(messageFingerprint);
  const normalizedTools = toolDefinitions(value.tools);
  const turnIndex = messages.reduce(
    (count, message) => count + (message.role === "assistant" ? 1 : 0),
    0
  );
  const fingerprint: Record<string, JsonValue> = {
    dialect: "anthropic",
    operation: "messages.create",
    model: parsedModel.data,
    maxTokens: value.max_tokens,
    system: typeof value.system === "string" ? value.system : null,
    messages: messages.map((message) => ({ ...message })),
    toolNames: [...normalizedTools.names],
    toolDefinitions: [...normalizedTools.definitions],
  };
  return Object.freeze({
    request: Object.freeze(value),
    model: parsedModel.data,
    turnIndex,
    fingerprint: Object.freeze(fingerprint),
  });
};

const contentLengthExceedsLimit = (request: Request): boolean => {
  const value = request.headers.get("content-length")?.trim();
  if (!value) return false;
  return (
    !/^\d+$/.test(value) || Number(value) > MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES
  );
};

const readBoundedJsonBody = async (request: Request): Promise<unknown> => {
  if (contentLengthExceedsLimit(request)) {
    void request.body?.cancel("mock LLM request body limit reached").catch(() => {});
    throw new MockLlmAnthropicRequestError("request_too_large");
  }
  if (!request.body) throw new MockLlmAnthropicRequestError("invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MOCK_LLM_ANTHROPIC_MAX_REQUEST_BODY_BYTES) {
        void reader.cancel("mock LLM request body limit reached").catch(() => {});
        throw new MockLlmAnthropicRequestError("request_too_large");
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
    throw new MockLlmAnthropicRequestError("invalid_json", undefined, {
      cause,
    });
  }
};

const providerCredential = (request: Request): string | undefined => {
  const value = request.headers.get("x-api-key");
  if (!value) return undefined;
  const parsed = mockLlmMockCredentialSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const hasBetaHeader = (request: Request): boolean => {
  for (const [name] of request.headers) {
    if (name === "anthropic-beta" || name.startsWith("anthropic-beta-")) {
      return true;
    }
  }
  return false;
};

const providerIdentity = (): { requestId: string; responseId: string } => {
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const responseId = crypto.randomUUID().replaceAll("-", "");
  return {
    requestId: `req_${requestId}`,
    responseId: `msg_${responseId}`,
  };
};

const validateCatalog = (
  input: MockLlmAnthropicCatalog
): readonly MockLlmAnthropicCatalogModel[] | undefined => {
  if (!Array.isArray(input.models) || input.models.length > 64) return undefined;
  const seen = new Set<string>();
  const models: MockLlmAnthropicCatalogModel[] = [];
  for (const model of input.models) {
    const id = mockLlmModelSchema.safeParse(model?.id);
    if (
      !id.success ||
      seen.has(id.data) ||
      typeof model?.displayName !== "string" ||
      model.displayName.trim() !== model.displayName ||
      model.displayName.length < 1 ||
      model.displayName.length > 128 ||
      !Number.isSafeInteger(model?.createdAtEpochSeconds) ||
      model.createdAtEpochSeconds < 0 ||
      Number.isNaN(new Date(model.createdAtEpochSeconds * 1_000).getTime())
    ) {
      return undefined;
    }
    seen.add(id.data);
    models.push({
      id: id.data,
      displayName: model.displayName,
      createdAtEpochSeconds: model.createdAtEpochSeconds,
    });
  }
  return models;
};

const modelBody = (model: MockLlmAnthropicCatalogModel) => ({
  id: model.id,
  type: "model",
  display_name: model.displayName,
  created_at: new Date(model.createdAtEpochSeconds * 1_000).toISOString(),
  capabilities: null,
  max_input_tokens: null,
  max_tokens: null,
});

const jsonResponse = (
  body: Readonly<Record<string, unknown>>,
  requestId: string
): Response => {
  const serialized = JSON.stringify(body);
  if (utf8Length(serialized) > MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES) {
    return internalError(requestId);
  }
  return new Response(serialized, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "request-id": requestId,
    },
  });
};

const responseForRuntimeError = (
  code: MockLlmAnthropicRuntimeErrorCode,
  requestId: string
): Response => {
  switch (code) {
    case "authentication":
      return authenticationError(requestId);
    case "dialect_disabled":
    case "server_not_found":
      return notFoundError(requestId, "server");
    case "model_not_found":
      return notFoundError(requestId, "model");
    case "invalid_request":
      return invalidRequest(requestId);
    case "internal":
      return internalError(requestId);
  }
};

const callRuntime = async <Value>(
  operation: () => Promise<MockLlmAnthropicRuntimeResult<Value>>
): Promise<MockLlmAnthropicRuntimeResult<Value> | undefined> => {
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

export type CreateMockLlmAnthropicFetchHandlerOptions = {
  readonly runtime: MockLlmAnthropicRuntime;
  readonly platformApiKey?: string;
  readonly createIdentity?: () => {
    readonly requestId: string;
    readonly responseId: string;
  };
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

export const createMockLlmAnthropicFetchHandler = (
  options: CreateMockLlmAnthropicFetchHandlerOptions
) => {
  const createIdentity = options.createIdentity ?? providerIdentity;
  const delay = options.delay ?? defaultDelay;
  return async (
    request: Request,
    rawRoute: MockLlmAnthropicRoute
  ): Promise<Response> => {
    const identity = createIdentity();
    const slug = mockLlmSlugSchema.safeParse(rawRoute.slug);
    if (!slug.success || !rawRoute.providerPath.startsWith("/")) {
      void request.body?.cancel("invalid mock LLM route").catch(() => {});
      return notFoundError(identity.requestId, "route");
    }

    const credential = providerCredential(request);
    if (
      !credential ||
      request.headers.has("authorization") ||
      request.headers.has("x-anthropic-api-key") ||
      (options.platformApiKey && credential.includes(options.platformApiKey))
    ) {
      void request.body?.cancel("mock LLM authentication rejected").catch(() => {});
      return authenticationError(identity.requestId);
    }
    if (
      request.headers.get("anthropic-version") !== MOCK_LLM_ANTHROPIC_VERSION ||
      hasBetaHeader(request)
    ) {
      void request.body?.cancel("mock LLM provider headers rejected").catch(() => {});
      return invalidRequest(identity.requestId);
    }

    if (request.method === "GET" && rawRoute.providerPath === "/v1/models") {
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
        {
          data: models.map(modelBody),
          first_id: models.at(0)?.id ?? null,
          last_id: models.at(-1)?.id ?? null,
          has_more: false,
        },
        identity.requestId
      );
    }
    if (rawRoute.providerPath === "/v1/models") {
      void request.body?.cancel("mock LLM method rejected").catch(() => {});
      return methodNotAllowed(identity.requestId, "GET");
    }

    if (rawRoute.providerPath.startsWith("/v1/models/")) {
      if (request.method !== "GET") {
        void request.body?.cancel("mock LLM method rejected").catch(() => {});
        return methodNotAllowed(identity.requestId, "GET");
      }
      const encodedModel = rawRoute.providerPath.slice("/v1/models/".length);
      if (!encodedModel || encodedModel.includes("/")) {
        return notFoundError(identity.requestId, "route");
      }
      let requestedModel: string;
      try {
        requestedModel = decodeURIComponent(encodedModel);
      } catch {
        return notFoundError(identity.requestId, "route");
      }
      if (!mockLlmModelSchema.safeParse(requestedModel).success) {
        return notFoundError(identity.requestId, "model");
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
        : notFoundError(identity.requestId, "model");
    }

    if (rawRoute.providerPath !== "/v1/messages") {
      void request.body?.cancel("mock LLM route not found").catch(() => {});
      return notFoundError(identity.requestId, "route");
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
      return invalidRequest(identity.requestId);
    }
    const contentEncoding = request.headers
      .get("content-encoding")
      ?.trim()
      .toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      void request.body?.cancel("mock LLM content encoding rejected").catch(() => {});
      return invalidRequest(identity.requestId);
    }

    let body: unknown;
    let parsed: ParsedMockLlmAnthropicMessageRequest;
    try {
      body = await readBoundedJsonBody(request);
      parsed = parseMockLlmAnthropicMessageRequest(body);
    } catch (error) {
      if (
        error instanceof MockLlmAnthropicRequestError &&
        error.code === "request_too_large"
      ) {
        return requestTooLarge(identity.requestId);
      }
      if (
        error instanceof MockLlmAnthropicRequestError &&
        error.code === "streaming_not_supported"
      ) {
        return streamingNotSupported(identity.requestId);
      }
      return invalidRequest(identity.requestId);
    }
    if (mockLlmValueContainsSecret(body, [credential, options.platformApiKey])) {
      return invalidRequest(identity.requestId);
    }

    const result = await callRuntime(() =>
      options.runtime.planMessage({
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
    if (mockLlmValueContainsSecret(plan, [credential, options.platformApiKey])) {
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
    const initialDelayMilliseconds =
      plan.kind === "response"
        ? plan.cadence.initialDelayMilliseconds
        : plan.initialDelayMilliseconds;
    try {
      await delay(initialDelayMilliseconds, request.signal);
    } catch {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      return internalError(identity.requestId);
    }
    const wire = renderAnthropicPlan(plan, {
      stream: false,
      requestId: identity.requestId,
      responseId: identity.responseId,
    });
    if (wire.kind !== "json") return internalError(identity.requestId);
    if (mockLlmValueContainsSecret(wire.body, [credential, options.platformApiKey])) {
      return internalError(identity.requestId);
    }
    const serialized = JSON.stringify(wire.body);
    if (utf8Length(serialized) > MOCK_LLM_ANTHROPIC_MAX_RESPONSE_BODY_BYTES) {
      return internalError(identity.requestId);
    }
    return new Response(serialized, {
      status: wire.status,
      headers: wire.headers,
    });
  };
};
