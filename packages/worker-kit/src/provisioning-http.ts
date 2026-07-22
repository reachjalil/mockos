import {
  type ProvisioningHttpOperation,
  type ProvisioningHttpResponse,
  type ProvisioningTarget,
  provisioningHttpOperationSchema,
  provisioningHttpResponseSchema,
  provisioningTargetSchema,
} from "@mockos/contracts";
import { MAX_REQUEST_LOG_BODY_BYTES } from "@mockos/core";
import type { StoredProvisioningExecution } from "./provisioning-persistence";
import { type OutboundTargetPolicy, secureOutboundFetch } from "./secure-fetch";

const ALLOWED_OPERATION_HEADERS = new Set(["accept", "content-type"]);
const MAX_CAPTURE_HEADER_BYTES = 48 * 1_024;
const BODY_TRUNCATED_MARKER = "\n[mockOS capture truncated]";
// Bounds active-run replay storage: at 250 logical executions, response bodies
// remain below 16 MiB before terminal step pruning (plus bounded log captures).
export const MAX_PROVISIONING_HTTP_BODY_BYTES = 64 * 1_024;

export type PerformProvisioningHttpOperationInput = {
  readonly target: ProvisioningTarget;
  readonly bearerToken?: string;
  readonly operation: ProvisioningHttpOperation;
  readonly policy?: OutboundTargetPolicy;
  /** Test/service-binding seam. Target validation still runs before this fetch. */
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly now?: () => number;
  readonly randomId?: () => string;
};

export class UnsafeProvisioningHeaderError extends Error {
  readonly code = "UNSAFE_PROVISIONING_HEADER";

  constructor() {
    super("Provisioning operations may set only Accept and Content-Type headers.");
    this.name = "UnsafeProvisioningHeaderError";
  }
}

const operationUrl = (
  target: ProvisioningTarget,
  operation: ProvisioningHttpOperation
): URL => {
  const base = new URL(target.baseUrl);
  base.hash = "";
  base.search = "";
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  const url = new URL(operation.request.path.slice(1), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error("Provisioning operation escaped its target base URL.");
  }
  return url;
};

const requestBody = (operation: ProvisioningHttpOperation): string | undefined => {
  if (operation.request.body === undefined) return undefined;
  if (typeof operation.request.body === "string") return operation.request.body;
  const serialized = JSON.stringify(operation.request.body);
  if (serialized === undefined) {
    throw new Error("Provisioning operation body is not JSON serializable.");
  }
  return serialized;
};

const redact = (value: string, secret: string | undefined): string =>
  secret ? value.replaceAll(secret, "[REDACTED]") : value;

const captureBody = (value: string): string => {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= MAX_REQUEST_LOG_BODY_BYTES) return value;
  const available =
    MAX_REQUEST_LOG_BODY_BYTES - encoder.encode(BODY_TRUNCATED_MARKER).byteLength;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= available) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${value.slice(0, low)}${BODY_TRUNCATED_MARKER}`;
};

const capturedHeaders = (
  headers: Headers,
  secret: string | undefined,
  redactAuthorization = false
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, rawValue] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    const value =
      redactAuthorization && normalizedName === "authorization"
        ? "[REDACTED]"
        : redact(rawValue, secret);
    const next = { ...result, [normalizedName]: value };
    if (
      new TextEncoder().encode(JSON.stringify(next)).byteLength >
      MAX_CAPTURE_HEADER_BYTES
    ) {
      result["x-mockos-log-truncated"] = "true";
      break;
    }
    result[normalizedName] = value;
  }
  return result;
};

const parsedBody = (body: string): unknown => {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
};

const scopedHeaders = (
  operation: ProvisioningHttpOperation,
  bearerToken: string | undefined
): Headers => {
  const headers = new Headers();
  for (const [rawName, value] of Object.entries(operation.request.headers)) {
    const name = rawName.toLowerCase();
    if (!ALLOWED_OPERATION_HEADERS.has(name)) {
      throw new UnsafeProvisioningHeaderError();
    }
    if (bearerToken && value.includes(bearerToken)) {
      throw new Error("Provisioning operation header contained its target credential.");
    }
    headers.set(name, value);
  }
  if (bearerToken) headers.set("authorization", `Bearer ${bearerToken}`);
  return headers;
};

/**
 * Performs one credential-scoped SCIM request. The returned record is safe to
 * persist and expose across a Durable Object RPC boundary: the bearer secret is
 * removed even when a malicious target reflects it in headers or a body.
 */
export const performProvisioningHttpOperation = async (
  input: PerformProvisioningHttpOperationInput
): Promise<StoredProvisioningExecution> => {
  const target = provisioningTargetSchema.parse(input.target);
  const operation = provisioningHttpOperationSchema.parse(input.operation);
  if (
    (target.auth.kind === "bearer" && !input.bearerToken) ||
    (target.auth.kind === "none" && input.bearerToken !== undefined)
  ) {
    throw new Error("Provisioning target credential metadata is inconsistent.");
  }
  const body = requestBody(operation);
  if (input.bearerToken && body?.includes(input.bearerToken)) {
    throw new Error("Provisioning operation body contained its target credential.");
  }
  const headers = scopedHeaders(operation, input.bearerToken);
  const url = operationUrl(target, operation);
  const now = input.now ?? Date.now;
  const startedAt = now();
  const response = await secureOutboundFetch(
    url,
    {
      method: operation.request.method,
      headers,
      ...(body === undefined ? {} : { body }),
    },
    {
      ...input.policy,
      maxBodyBytes: Math.min(
        input.policy?.maxBodyBytes ?? MAX_PROVISIONING_HTTP_BODY_BYTES,
        MAX_PROVISIONING_HTTP_BODY_BYTES
      ),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }
  );
  const rawResponseBody = await response.text();
  const safeResponseBody = redact(rawResponseBody, input.bearerToken);
  const responseHeaders = capturedHeaders(response.headers, input.bearerToken);
  const parsedResponse = provisioningHttpResponseSchema.parse({
    status: response.status,
    headers: responseHeaders,
    ...(safeResponseBody ? { body: parsedBody(safeResponseBody) } : {}),
  }) satisfies ProvisioningHttpResponse;
  const correlationId =
    response.headers.get("x-ms-request-id") ??
    response.headers.get("x-okta-request-id") ??
    response.headers.get("request-id") ??
    input.randomId?.() ??
    crypto.randomUUID();

  return {
    response: parsedResponse,
    log: {
      id: input.randomId?.() ?? crypto.randomUUID(),
      timestamp: new Date(startedAt).toISOString(),
      method: operation.request.method,
      path: url.pathname,
      requestHeaders: capturedHeaders(headers, input.bearerToken, true),
      requestBody:
        body === undefined ? null : captureBody(redact(body, input.bearerToken)),
      responseStatus: response.status,
      responseHeaders,
      responseBody: rawResponseBody ? captureBody(safeResponseBody) : null,
      durationMs: Math.max(0, now() - startedAt),
      correlationId: redact(correlationId, input.bearerToken),
    },
  };
};
