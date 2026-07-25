export const MOCK_MCP_MAX_CURSOR_LENGTH = 512;

export type MockMcpCursorKind =
  | "tools"
  | "resources"
  | "resource-templates"
  | "prompts";

export type MockMcpCursorScope = {
  readonly kind: MockMcpCursorKind;
  readonly serverSlug: string;
  readonly serverRevision: number;
  readonly sessionScope: string;
};

type CursorPayload = {
  readonly v: 1;
  readonly k: MockMcpCursorKind;
  readonly r: number;
  readonly o: number;
  readonly c: string;
};

export class MockMcpCursorError extends Error {
  constructor(message = "The pagination cursor is invalid.") {
    super(message);
    this.name = "MockMcpCursorError";
  }
}

const hashText = (value: string, seed: number): string => {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const checksum = (scope: MockMcpCursorScope, offset: number): string => {
  const source = JSON.stringify([
    "mockos:mcp-mock:cursor:v1",
    scope.kind,
    scope.serverSlug,
    scope.serverRevision,
    scope.sessionScope,
    offset,
  ]);
  return `${hashText(source, 0)}${hashText(source, 0x9e37_79b9)}`;
};

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const decodeBase64Url = (value: string): string => {
  if (
    value.length < 1 ||
    value.length > MOCK_MCP_MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new MockMcpCursorError();
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat(
    (4 - (value.length % 4)) % 4
  )}`;
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new MockMcpCursorError();
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MockMcpCursorError();
  }
};

export const encodeMockMcpCursor = (
  scope: MockMcpCursorScope,
  offset: number
): string => {
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new MockMcpCursorError("A cursor offset must be a positive safe integer.");
  }
  return encodeBase64Url(
    JSON.stringify({
      v: 1,
      k: scope.kind,
      r: scope.serverRevision,
      o: offset,
      c: checksum(scope, offset),
    } satisfies CursorPayload)
  );
};

export const decodeMockMcpCursor = (
  cursor: string | undefined,
  scope: MockMcpCursorScope,
  itemCount: number
): number => {
  if (cursor === undefined) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(cursor));
  } catch (cause) {
    if (cause instanceof MockMcpCursorError) throw cause;
    throw new MockMcpCursorError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MockMcpCursorError();
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "c,k,o,r,v" ||
    record.v !== 1 ||
    record.k !== scope.kind ||
    record.r !== scope.serverRevision ||
    !Number.isSafeInteger(record.o) ||
    (record.o as number) < 1 ||
    (record.o as number) >= itemCount ||
    typeof record.c !== "string" ||
    record.c !== checksum(scope, record.o as number)
  ) {
    throw new MockMcpCursorError();
  }
  return record.o as number;
};
