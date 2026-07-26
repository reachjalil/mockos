import type { ParityObservation } from "./observation.js";

/** Marker substituted for a value that legitimately differs on every run. */
export const VOLATILE = "<<volatile>>";

export interface NormalizeOptions {
  /**
   * Exact literals replaced wherever they appear, including inside strings.
   * Tenant ids, org hosts, and client ids differ per target but are structurally
   * the same value, so they are replaced rather than dropped.
   */
  readonly literals?: Readonly<Record<string, string>>;
}

/**
 * Claims and fields that differ on every issuance. Replaced, never deleted, so
 * a missing claim still reads as a difference.
 */
const VOLATILE_KEYS = new Set([
  "at_hash",
  "auth_time",
  "c_hash",
  "correlation_id",
  "correlationid",
  "errorid",
  "exp",
  "expiresat",
  "iat",
  "jti",
  // Signing-key identifiers are assigned per target and rotate independently.
  // Their correlation with JWKS is asserted by the client under test, not here.
  "kid",
  "nbf",
  "nonce",
  "sid",
  "state",
  "statetoken",
  "timestamp",
  "trace_id",
  "traceid",
  "uti",
]);

/** Opaque credentials: presence and shape matter, value never does. */
const OPAQUE_KEYS = new Set([
  "code",
  "device_code",
  "refresh_token",
  "session_token",
  "sessiontoken",
  "user_code",
]);

/** Credentials that are JWTs, where the decoded claim set is the real signal. */
const JWT_KEYS = new Set(["access_token", "id_token"]);

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const decodeSegment = (segment: string): unknown => {
  const padded = segment.replaceAll("-", "+").replaceAll("_", "/");
  const text = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return JSON.parse(text) as unknown;
};

/**
 * Decodes a JWT into header and payload for structural comparison. The
 * signature is dropped: it can never match across targets and its validity is
 * asserted separately by the client under test.
 */
export const decodeJwtForComparison = (
  token: string
): { header: unknown; payload: unknown } | null => {
  if (!JWT_PATTERN.test(token)) return null;
  const [header, payload] = token.split(".");
  if (!header || !payload) return null;
  try {
    return { header: decodeSegment(header), payload: decodeSegment(payload) };
  } catch {
    return null;
  }
};

const applyLiterals = (value: string, literals: Readonly<Record<string, string>>) => {
  let replaced = value;
  // Longest first, so a client id that contains a tenant id cannot be partly
  // rewritten by the shorter literal.
  for (const literal of Object.keys(literals).sort((a, b) => b.length - a.length)) {
    if (literal === "") continue;
    replaced = replaced.replaceAll(literal, literals[literal] as string);
  }
  return replaced;
};

const normalizeValue = (
  value: unknown,
  key: string | undefined,
  options: NormalizeOptions
): unknown => {
  const lowered = key?.toLowerCase();
  if (lowered !== undefined) {
    if (VOLATILE_KEYS.has(lowered)) return VOLATILE;
    if (OPAQUE_KEYS.has(lowered)) return VOLATILE;
    if (JWT_KEYS.has(lowered) && typeof value === "string") {
      const decoded = decodeJwtForComparison(value);
      // A non-JWT in a token field is itself a difference worth surfacing.
      if (!decoded) return VOLATILE;
      return {
        __jwt: {
          header: normalizeValue(decoded.header, undefined, options),
          payload: normalizeValue(decoded.payload, undefined, options),
        },
      };
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, key, options));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [
          entryKey,
          normalizeValue(entryValue, entryKey, options),
        ])
    );
  }
  if (typeof value === "string" && options.literals) {
    return applyLiterals(value, options.literals);
  }
  return value;
};

/** Canonicalises one observation so two targets become comparable. */
export const normalizeObservation = (
  observation: ParityObservation,
  options: NormalizeOptions = {}
): ParityObservation => {
  const literals = options.literals;
  const path = literals ? applyLiterals(observation.path, literals) : observation.path;
  return {
    method: observation.method,
    path,
    query: normalizeValue(
      observation.query,
      undefined,
      options
    ) as ParityObservation["query"],
    requestHeaders: normalizeValue(
      observation.requestHeaders,
      undefined,
      options
    ) as ParityObservation["requestHeaders"],
    requestBody: normalizeValue(observation.requestBody, undefined, options),
    status: observation.status,
    responseHeaders: normalizeValue(
      observation.responseHeaders,
      undefined,
      options
    ) as ParityObservation["responseHeaders"],
    responseBody: normalizeValue(observation.responseBody, undefined, options),
  };
};
