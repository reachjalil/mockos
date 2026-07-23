import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  utf8Decode,
  utf8Encode,
} from "../security";

export type ManagementListCursorKind = "applications" | "scenarios";

export type ManagementListCursorPosition = {
  readonly createdAt: string;
  readonly id: string;
};

type ManagementListCursorPayload = ManagementListCursorPosition & {
  readonly kind: ManagementListCursorKind;
  readonly v: 1;
};

export class ManagementListCursorError extends Error {
  constructor(message = "Management list cursor is invalid.", options?: ErrorOptions) {
    super(message, options);
    this.name = "ManagementListCursorError";
  }
}

const validTimestamp = (value: string): boolean => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

export const encodeManagementListCursor = (
  kind: ManagementListCursorKind,
  position: ManagementListCursorPosition
): string => {
  if (
    (kind !== "applications" && kind !== "scenarios") ||
    !validTimestamp(position.createdAt) ||
    position.id.length < 1
  ) {
    throw new ManagementListCursorError();
  }
  const cursor = base64UrlEncode(
    utf8Encode(
      canonicalJson({
        v: 1,
        kind,
        createdAt: position.createdAt,
        id: position.id,
      } satisfies ManagementListCursorPayload)
    )
  );
  if (cursor.length > 512) throw new ManagementListCursorError();
  return cursor;
};

export const decodeManagementListCursor = (
  kind: ManagementListCursorKind,
  cursor: string
): ManagementListCursorPosition => {
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(base64UrlDecode(cursor)));
  } catch (cause) {
    throw new ManagementListCursorError(undefined, { cause });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManagementListCursorError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "createdAt,id,kind,v" ||
    record.v !== 1 ||
    record.kind !== kind ||
    typeof record.createdAt !== "string" ||
    !validTimestamp(record.createdAt) ||
    typeof record.id !== "string" ||
    record.id.length < 1
  ) {
    throw new ManagementListCursorError();
  }
  return { createdAt: record.createdAt, id: record.id };
};
