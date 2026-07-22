const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const DEFAULT_OUTBOUND_BODY_LIMIT_BYTES = 2 * 1_024 * 1_024;
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;

export type OutboundTargetPolicy = {
  /** Self-host-only escape hatch. Literal private addresses remain blocked. */
  readonly allowInsecureTargets?: boolean;
  /** Product/control hosts which outbound provisioning must never call. */
  readonly blockedHostnames?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly timeoutMs?: number;
};

export type SecureOutboundFetchOptions = OutboundTargetPolicy & {
  /** Test seam; production callers intentionally use the global fetch. */
  readonly fetch?: (request: Request) => Promise<Response>;
};

export type OutboundTargetPolicyErrorCode =
  | "BLOCKED_HOSTNAME"
  | "INVALID_BLOCKED_HOSTNAME"
  | "INVALID_LIMIT"
  | "INVALID_URL"
  | "NON_PUBLIC_IP"
  | "REDIRECT_NOT_ALLOWED"
  | "REQUEST_BODY_TOO_LARGE"
  | "RESPONSE_BODY_TOO_LARGE"
  | "UNSUPPORTED_PROTOCOL"
  | "USERINFO_NOT_ALLOWED";

/** Deliberately does not retain a target URL or response body. */
export class OutboundTargetPolicyError extends Error {
  readonly code: OutboundTargetPolicyErrorCode;

  constructor(code: OutboundTargetPolicyErrorCode, message: string) {
    super(message);
    this.name = "OutboundTargetPolicyError";
    this.code = code;
  }
}

const canonicalHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");

const validDnsHostname = (hostname: string): boolean => {
  if (hostname.length < 1 || hostname.length > 253) return false;
  return hostname
    .split(".")
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
};

/** Parses the deployment allow-deny binding as bare, canonical hostnames. */
export const parseOutboundBlockedHostnames = (input?: string): string[] => {
  if (input === undefined || input.trim() === "") return [];
  const hostnames: string[] = [];
  for (const rawValue of input.split(",")) {
    const value = rawValue.trim();
    const hostname = canonicalHostname(value);
    if (
      !value ||
      value.includes("://") ||
      value.includes("/") ||
      value.includes("?") ||
      value.includes("#") ||
      value.includes("@") ||
      value.includes(":") ||
      value.includes("*") ||
      !validDnsHostname(hostname)
    ) {
      throw new OutboundTargetPolicyError(
        "INVALID_BLOCKED_HOSTNAME",
        "Outbound blocked hosts must be comma-separated bare DNS hostnames."
      );
    }
    hostnames.push(hostname);
  }
  return [...new Set(hostnames)];
};

const isBlockedName = (
  hostname: string,
  blockedHostnames: readonly string[]
): boolean => {
  if (!hostname.includes(".")) return true;
  const specialNames = [
    "localhost",
    "local",
    "internal",
    "test",
    "invalid",
    "home.arpa",
  ];
  if (
    specialNames.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    )
  ) {
    return true;
  }
  return blockedHostnames.some((candidate) => {
    const blocked = canonicalHostname(candidate);
    return Boolean(
      blocked && (hostname === blocked || hostname.endsWith(`.${blocked}`))
    );
  });
};

const isNonPublicIpv4 = (hostname: string): boolean => {
  const match = IPV4_LITERAL.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const parseIpv6 = (hostname: string): number[] | undefined => {
  if (!hostname.includes(":")) return undefined;
  const pieces = hostname.split("::");
  if (pieces.length > 2) return [];
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces[1] ? pieces[1].split(":") : [];
  const parsePiece = (piece: string): number | undefined => {
    if (!/^[0-9a-f]{1,4}$/i.test(piece)) return undefined;
    return Number.parseInt(piece, 16);
  };
  const leftValues = left.map(parsePiece);
  const rightValues = right.map(parsePiece);
  if ([...leftValues, ...rightValues].some((value) => value === undefined)) {
    return [];
  }
  if (pieces.length === 1) {
    return leftValues.length === 8 ? (leftValues as number[]) : [];
  }
  const missing = 8 - leftValues.length - rightValues.length;
  if (missing < 1) return [];
  return [
    ...(leftValues as number[]),
    ...Array.from({ length: missing }, () => 0),
    ...(rightValues as number[]),
  ];
};

const isNonPublicIpv6 = (hostname: string): boolean => {
  const groups = parseIpv6(hostname);
  if (!groups) return false;
  if (groups.length !== 8) return true;
  const [first = 0, second = 0] = groups;
  // Public literal IPv6 targets are restricted to global unicast. Cloudflare
  // Workers cannot pin a DNS answer, so transition/documentation ranges are
  // conservatively excluded as well.
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2001 && second === 0x0000) return true; // Teredo
  if (first === 0x2001 && second === 0x0002) return true; // benchmarking
  if (first === 0x2001 && second >= 0x0010 && second <= 0x001f) return true;
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if (first === 0x2002) return true; // 6to4
  if (first === 0x3fff && second <= 0x0fff) return true; // documentation
  return false;
};

const positiveSafeInteger = (
  value: number | undefined,
  fallback: number,
  name: string
): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new OutboundTargetPolicyError(
      "INVALID_LIMIT",
      `${name} must be a positive safe integer.`
    );
  }
  return resolved;
};

/**
 * Validates the controls which can be enforced without DNS pinning in Workers.
 * The same function is used when a target is saved and immediately before each
 * network request.
 */
export const validateOutboundTarget = (
  input: string | URL,
  policy: OutboundTargetPolicy = {}
): URL => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OutboundTargetPolicyError(
      "INVALID_URL",
      "Outbound target must be an absolute URL."
    );
  }
  if (url.username || url.password) {
    throw new OutboundTargetPolicyError(
      "USERINFO_NOT_ALLOWED",
      "Outbound target credentials must be supplied through scoped headers."
    );
  }
  if (
    url.protocol !== "https:" &&
    !(policy.allowInsecureTargets === true && url.protocol === "http:")
  ) {
    throw new OutboundTargetPolicyError(
      "UNSUPPORTED_PROTOCOL",
      "Outbound targets require HTTPS."
    );
  }
  const hostname = canonicalHostname(url.hostname);
  if (isBlockedName(hostname, policy.blockedHostnames ?? [])) {
    throw new OutboundTargetPolicyError(
      "BLOCKED_HOSTNAME",
      "Outbound target hostname is blocked by policy."
    );
  }
  if (isNonPublicIpv4(hostname) || isNonPublicIpv6(hostname)) {
    throw new OutboundTargetPolicyError(
      "NON_PUBLIC_IP",
      "Outbound targets cannot use non-public IP literals."
    );
  }
  return url;
};

const readBodyWithinLimit = async (
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
  code: "REQUEST_BODY_TOO_LARGE" | "RESPONSE_BODY_TOO_LARGE"
): Promise<Uint8Array | undefined> => {
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      void reader.cancel("mockOS outbound body limit reached").catch(() => undefined);
      throw new OutboundTargetPolicyError(
        code,
        `Outbound ${code === "REQUEST_BODY_TOO_LARGE" ? "request" : "response"} body exceeds the configured limit.`
      );
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
};

/** A per-operation fetch with redirect, timeout, URL and body-size defenses. */
export const secureOutboundFetch = async (
  input: string | URL,
  init: RequestInit = {},
  options: SecureOutboundFetchOptions = {}
): Promise<Response> => {
  const url = validateOutboundTarget(input, options);
  const maxBodyBytes = positiveSafeInteger(
    options.maxBodyBytes,
    DEFAULT_OUTBOUND_BODY_LIMIT_BYTES,
    "Outbound body limit"
  );
  const timeoutMs = positiveSafeInteger(
    options.timeoutMs,
    DEFAULT_OUTBOUND_TIMEOUT_MS,
    "Outbound timeout"
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  // Workers do not implement redirect:"error". Manual mode is equivalent
  // only when every redirect response is rejected before it can escape.
  const request = new Request(url, { ...init, redirect: "manual", signal });
  await readBodyWithinLimit(
    request.clone().body,
    maxBodyBytes,
    "REQUEST_BODY_TOO_LARGE"
  );
  const response = await (options.fetch ?? fetch)(request);
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel("mockOS outbound redirects are disabled");
    throw new OutboundTargetPolicyError(
      "REDIRECT_NOT_ALLOWED",
      "Outbound provisioning redirects are not allowed."
    );
  }
  const announcedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > maxBodyBytes) {
    void response.body?.cancel("mockOS outbound body limit reached");
    throw new OutboundTargetPolicyError(
      "RESPONSE_BODY_TOO_LARGE",
      "Outbound response body exceeds the configured limit."
    );
  }
  const body = await readBodyWithinLimit(
    response.body,
    maxBodyBytes,
    "RESPONSE_BODY_TOO_LARGE"
  );
  const responseBody = body
    ? (body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength
      ) as ArrayBuffer)
    : null;
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
