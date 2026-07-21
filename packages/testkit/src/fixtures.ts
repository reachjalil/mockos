import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

export const fixtureProviders = ["entra", "okta"] as const;
export const fixtureAreas = [
  "oidc",
  "scim",
  "directory",
  "errors",
  "provisioning",
] as const;
export const fixtureStatuses = ["documented", "implemented", "verified-live"] as const;

export type FixtureProvider = (typeof fixtureProviders)[number];
export type FixtureArea = (typeof fixtureAreas)[number];
export type FixtureStatus = (typeof fixtureStatuses)[number];

export interface FixtureRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  form?: Record<string, string>;
  body?: unknown;
}

export interface FixtureExpected {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyContains?: Record<string, unknown>;
}

export interface ConformanceFixture {
  name: string;
  description: string;
  provider: FixtureProvider;
  area: FixtureArea;
  request: FixtureRequest;
  expected: FixtureExpected;
  provenance: "official-docs" | "rfc" | "sanitized-live-capture";
  sourceUrl: string;
  lastVerified: string;
  status: FixtureStatus;
  notes?: string;
}

export class FixtureValidationError extends Error {
  readonly file?: string;

  constructor(message: string, file?: string) {
    super(file ? `${file}: ${message}` : message);
    this.name = "FixtureValidationError";
    this.file = file;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (
  record: Record<string, unknown>,
  key: string,
  file?: string
): string => {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new FixtureValidationError(`${key} must be a non-empty string`, file);
  }
  return value;
};

const requireRecord = (
  record: Record<string, unknown>,
  key: string,
  file?: string
): Record<string, unknown> => {
  const value = record[key];
  if (!isRecord(value)) {
    throw new FixtureValidationError(`${key} must be an object`, file);
  }
  return value;
};

export const parseFixture = (value: unknown, file?: string): ConformanceFixture => {
  if (!isRecord(value)) {
    throw new FixtureValidationError("fixture must be an object", file);
  }

  const provider = requireString(value, "provider", file);
  if (!fixtureProviders.includes(provider as FixtureProvider)) {
    throw new FixtureValidationError(`unsupported provider: ${provider}`, file);
  }
  const area = requireString(value, "area", file);
  if (!fixtureAreas.includes(area as FixtureArea)) {
    throw new FixtureValidationError(`unsupported area: ${area}`, file);
  }
  const provenance = requireString(value, "provenance", file);
  if (!["official-docs", "rfc", "sanitized-live-capture"].includes(provenance)) {
    throw new FixtureValidationError(`unsupported provenance: ${provenance}`, file);
  }
  const status = requireString(value, "status", file);
  if (!fixtureStatuses.includes(status as FixtureStatus)) {
    throw new FixtureValidationError(`unsupported status: ${status}`, file);
  }

  const sourceUrl = requireString(value, "sourceUrl", file);
  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    throw new FixtureValidationError("sourceUrl must be an absolute URL", file);
  }
  if (parsedSource.protocol !== "https:") {
    throw new FixtureValidationError("sourceUrl must use HTTPS", file);
  }

  const lastVerified = requireString(value, "lastVerified", file);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastVerified)) {
    throw new FixtureValidationError("lastVerified must use YYYY-MM-DD", file);
  }

  const request = requireRecord(value, "request", file);
  const expected = requireRecord(value, "expected", file);
  const method = requireString(request, "method", file).toUpperCase();
  const path = requireString(request, "path", file);
  if (!path.startsWith("/")) {
    throw new FixtureValidationError("request.path must start with /", file);
  }
  const expectedStatus = expected.status;
  if (
    typeof expectedStatus !== "number" ||
    !Number.isInteger(expectedStatus) ||
    expectedStatus < 100 ||
    expectedStatus > 599
  ) {
    throw new FixtureValidationError(
      "expected.status must be an HTTP status from 100 to 599",
      file
    );
  }

  return {
    ...(value as unknown as ConformanceFixture),
    provider: provider as FixtureProvider,
    area: area as FixtureArea,
    provenance: provenance as ConformanceFixture["provenance"],
    status: status as FixtureStatus,
    request: {
      ...(request as unknown as FixtureRequest),
      method,
      path,
    },
    expected: {
      ...(expected as unknown as FixtureExpected),
      status: expectedStatus,
    },
  };
};

export const loadFixture = async (file: string): Promise<ConformanceFixture> => {
  if (extname(file) !== ".json") {
    throw new FixtureValidationError("fixture filename must end in .json", file);
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FixtureValidationError(`invalid JSON: ${detail}`, file);
  }
  return parseFixture(value, basename(file));
};

export const loadFixtures = async (
  files: readonly string[]
): Promise<ConformanceFixture[]> => Promise.all([...files].sort().map(loadFixture));
