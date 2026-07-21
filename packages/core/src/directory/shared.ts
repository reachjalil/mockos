import type { SqlValue } from "../store";

export const normalizeName = (value: string): string => value.trim().toLowerCase();

export const asOptionalString = (value: SqlValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

export const parseJson = <T>(value: SqlValue | undefined, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const idFromUuid = (prefix: string, uuid: string): string =>
  `${prefix}_${uuid.replaceAll("-", "")}`;
