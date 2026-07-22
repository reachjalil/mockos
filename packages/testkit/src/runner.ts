import type { ConformanceFixture } from "./fixtures.js";

export interface FixtureResponse {
  status: number;
  headers?: Headers | Record<string, string>;
  body?: unknown;
}

export type FixtureExecutor = (
  fixture: ConformanceFixture
) => FixtureResponse | Promise<FixtureResponse>;

export interface FixtureFailure {
  path: string;
  message: string;
}

export interface FixtureResult {
  fixture: ConformanceFixture;
  passed: boolean;
  failures: FixtureFailure[];
  response: FixtureResponse;
}

const normalizeHeaders = (
  headers: FixtureResponse["headers"]
): Record<string, string> => {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(
      [...headers.entries()].map(([name, value]) => [name.toLowerCase(), value])
    );
  }
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
};

const compareSubset = (
  expected: unknown,
  actual: unknown,
  path: string,
  failures: FixtureFailure[]
): void => {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push({ path, message: "expected an array" });
      return;
    }
    if (actual.length !== expected.length) {
      failures.push({
        path,
        message: `expected array length ${expected.length}, received ${actual.length}`,
      });
    }
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      compareSubset(expected[index], actual[index], `${path}[${index}]`, failures);
    }
    return;
  }
  if (typeof expected !== "object" || expected === null) {
    if (!Object.is(expected, actual)) {
      failures.push({
        path,
        message: `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      });
    }
    return;
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    failures.push({ path, message: "expected an object" });
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    compareSubset(
      value,
      (actual as Record<string, unknown>)[key],
      `${path}.${key}`,
      failures
    );
  }
};

export const runFixture = async (
  fixture: ConformanceFixture,
  execute: FixtureExecutor
): Promise<FixtureResult> => {
  const response = await execute(fixture);
  const failures: FixtureFailure[] = [];
  if (response.status !== fixture.expected.status) {
    failures.push({
      path: "status",
      message: `expected ${fixture.expected.status}, received ${response.status}`,
    });
  }

  const actualHeaders = normalizeHeaders(response.headers);
  for (const [name, expectedValue] of Object.entries(fixture.expected.headers ?? {})) {
    const actualValue = actualHeaders[name.toLowerCase()];
    if (actualValue !== expectedValue) {
      failures.push({
        path: `headers.${name.toLowerCase()}`,
        message: `expected ${JSON.stringify(expectedValue)}, received ${JSON.stringify(actualValue)}`,
      });
    }
  }

  if (fixture.expected.body !== undefined) {
    if (JSON.stringify(response.body) !== JSON.stringify(fixture.expected.body)) {
      failures.push({ path: "body", message: "response body did not match exactly" });
    }
  }
  if (fixture.expected.bodyContains !== undefined) {
    compareSubset(fixture.expected.bodyContains, response.body, "body", failures);
  }

  return {
    fixture,
    passed: failures.length === 0,
    failures,
    response,
  };
};

export const runFixtures = async (
  fixtures: readonly ConformanceFixture[],
  execute: FixtureExecutor
): Promise<FixtureResult[]> => {
  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    results.push(await runFixture(fixture, execute));
  }
  return results;
};

export class FixtureRunError extends Error {
  readonly results: FixtureResult[];

  constructor(results: FixtureResult[]) {
    const failures = results.filter((result) => !result.passed);
    super(
      failures
        .map(
          ({ fixture, failures: fixtureFailures }) =>
            `${fixture.name}: ${fixtureFailures
              .map(({ path, message }) => `${path} ${message}`)
              .join("; ")}`
        )
        .join("\n")
    );
    this.name = "FixtureRunError";
    this.results = results;
  }
}

export const assertFixtureResults = (results: FixtureResult[]): void => {
  if (results.some((result) => !result.passed)) {
    throw new FixtureRunError(results);
  }
};
