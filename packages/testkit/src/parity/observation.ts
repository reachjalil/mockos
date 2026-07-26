/**
 * A single observed provider exchange, in one shape for both a real tenant and
 * mockOS.
 *
 * mockOS can describe its own traffic through `get_request_log`, but no real
 * provider offers that, so parity capture has to observe from the client side.
 * This record is the only observation channel both sides can produce.
 */
export interface ParityObservation {
  /** Uppercase HTTP method. */
  readonly method: string;
  /** Origin-relative path. Origins differ between targets and never compare. */
  readonly path: string;
  /** Sorted query parameter names and values, origin-independent. */
  readonly query: Readonly<Record<string, readonly string[]>>;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: unknown;
}

export type ParitySink = {
  readonly observations: readonly ParityObservation[];
  record(observation: ParityObservation): void;
};

/** Request and response headers that carry comparable protocol meaning. */
const COMPARABLE_HEADERS = new Set([
  "allow",
  "cache-control",
  "content-type",
  "location",
  "pragma",
  "retry-after",
  "www-authenticate",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
]);

const headerRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lowered = name.toLowerCase();
    if (COMPARABLE_HEADERS.has(lowered)) record[lowered] = value;
  }
  return record;
};

const queryRecord = (url: URL): Record<string, string[]> => {
  const record: Record<string, string[]> = {};
  for (const key of [...new Set(url.searchParams.keys())].sort()) {
    record[key] = url.searchParams.getAll(key);
  }
  return record;
};

/**
 * Parses a body into a comparable value. Form and JSON payloads become plain
 * objects so structure compares; anything else stays an opaque string so a
 * binary or HTML body can never be mistaken for structured agreement.
 */
export const parseBody = (contentType: string | null, raw: string): unknown => {
  if (raw === "") return null;
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (media === "application/x-www-form-urlencoded") {
    const parsed = new URLSearchParams(raw);
    const record: Record<string, string[]> = {};
    for (const key of [...new Set(parsed.keys())].sort()) {
      record[key] = parsed.getAll(key);
    }
    return record;
  }
  if (media === "application/json" || media.endsWith("+json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // A malformed JSON body is a real difference; keep it visible rather than
      // silently comparing it as an object.
      return { __unparseableJson: raw };
    }
  }
  return raw;
};

export const createParitySink = (): ParitySink => {
  const observations: ParityObservation[] = [];
  return {
    observations,
    record(observation) {
      observations.push(observation);
    },
  };
};

/**
 * Wraps a fetch implementation so every exchange is recorded without changing
 * what the caller sees. Both the request and response bodies are cloned, so the
 * SDK under test still consumes its own stream.
 */
export const createObservingFetch = (
  sink: ParitySink,
  inner: typeof fetch = fetch
): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    const requestRaw = await request.clone().text();
    const response = await inner(request);
    const responseRaw = await response.clone().text();

    sink.record({
      method: request.method.toUpperCase(),
      path: url.pathname,
      query: queryRecord(url),
      requestHeaders: headerRecord(request.headers),
      requestBody: parseBody(request.headers.get("content-type"), requestRaw),
      status: response.status,
      responseHeaders: headerRecord(response.headers),
      responseBody: parseBody(response.headers.get("content-type"), responseRaw),
    });

    return response;
  };
};
