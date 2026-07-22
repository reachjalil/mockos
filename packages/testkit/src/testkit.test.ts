import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertFixtureResults,
  loadFixtures,
  NodeSqlStore,
  runFixtures,
  SeededClock,
  SeededRng,
} from "./index.js";

const jsonFilesRecursively = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return jsonFilesRecursively(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    })
  );
  return nested.flat().sort();
};

describe("NodeSqlStore", () => {
  it("supports reads, writes, and rollback", () => {
    const store = new NodeSqlStore();
    store.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    store.run("INSERT INTO sample (name) VALUES (?)", "first");
    store.run("INSERT INTO sample (name) VALUES (?)", "second");

    expect(
      store.get<{ name: string }>("SELECT name FROM sample WHERE id = ?", 1)
    ).toEqual({ name: "first" });
    expect(store.all("SELECT name FROM sample ORDER BY id")).toHaveLength(2);
    expect(() =>
      store.transaction(() => {
        store.run("INSERT INTO sample (name) VALUES (?)", "rolled back");
        throw new Error("stop");
      })
    ).toThrow("stop");
    expect(store.all("SELECT name FROM sample ORDER BY id")).toHaveLength(2);
    store.close();
  });
});

describe("deterministic seams", () => {
  it("repeats random values for the same seed", () => {
    const first = new SeededRng("fixture-seed");
    const second = new SeededRng("fixture-seed");
    expect(first.bytes(32)).toEqual(second.bytes(32));
  });

  it("advances time only when requested", () => {
    const clock = new SeededClock("2026-01-01T00:00:00.000Z");
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });
});

describe("conformance fixtures", () => {
  it("loads at least 25 individually sourced Entra OIDC fixtures", async () => {
    const directory = fileURLToPath(new URL("../fixtures/entra/oidc", import.meta.url));
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .map((file) => join(directory, file));
    const fixtures = await loadFixtures(files);

    expect(fixtures.length).toBeGreaterThanOrEqual(25);
    expect(fixtures.every(({ provider }) => provider === "entra")).toBe(true);
    expect(fixtures.every(({ status }) => status === "documented")).toBe(true);
  });

  it("loads at least 20 individually sourced Okta OIDC fixtures", async () => {
    const directory = fileURLToPath(new URL("../fixtures/okta/oidc", import.meta.url));
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .map((file) => join(directory, file));
    const fixtures = await loadFixtures(files);

    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.every(({ provider }) => provider === "okta")).toBe(true);
    expect(fixtures.every(({ status }) => status === "documented")).toBe(true);
  });

  it("locks the M3 SCIM conformance corpus", async () => {
    const directories = {
      rfc: fileURLToPath(new URL("../fixtures/rfc/scim", import.meta.url)),
      entra: fileURLToPath(new URL("../fixtures/entra/scim", import.meta.url)),
      okta: fileURLToPath(new URL("../fixtures/okta/scim", import.meta.url)),
    } as const;
    const [rfc, entra, okta] = await Promise.all([
      loadFixtures(await jsonFilesRecursively(directories.rfc)),
      loadFixtures(await jsonFilesRecursively(directories.entra)),
      loadFixtures(await jsonFilesRecursively(directories.okta)),
    ]);
    const fixtures = [...rfc, ...entra, ...okta];
    const providerCounts = (corpus: typeof fixtures) => ({
      entra: corpus.filter(({ provider }) => provider === "entra").length,
      okta: corpus.filter(({ provider }) => provider === "okta").length,
    });
    const statusCounts = (corpus: typeof fixtures) => ({
      documented: corpus.filter(({ status }) => status === "documented").length,
      implemented: corpus.filter(({ status }) => status === "implemented").length,
    });

    expect(fixtures).toHaveLength(113);
    expect(new Set(fixtures.map(({ name }) => name)).size).toBe(113);
    expect(fixtures.every(({ area }) => area === "scim")).toBe(true);
    expect(providerCounts(rfc)).toEqual({ entra: 0, okta: 91 });
    expect(providerCounts(entra)).toEqual({ entra: 10, okta: 0 });
    expect(providerCounts(okta)).toEqual({ entra: 0, okta: 12 });
    expect(statusCounts(fixtures)).toEqual({ documented: 0, implemented: 113 });
    expect(
      fixtures.filter(({ status }) => status === "documented").map(({ name }) => name)
    ).toEqual([]);
  });

  it("reports exact and subset mismatches", async () => {
    const directory = fileURLToPath(new URL("../fixtures/entra/oidc", import.meta.url));
    const [file] = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    if (!file) throw new Error("expected at least one fixture");
    const fixtures = await loadFixtures([join(directory, file)]);
    const results = await runFixtures(fixtures, (fixture) => ({
      status: fixture.expected.status,
      headers: fixture.expected.headers,
      body: fixture.expected.body ?? fixture.expected.bodyContains,
    }));
    expect(() => assertFixtureResults(results)).not.toThrow();
  });

  it("compares independently parsed subset arrays and reports nested paths", async () => {
    const directory = fileURLToPath(new URL("../fixtures/entra/oidc", import.meta.url));
    const [file] = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    if (!file) throw new Error("expected at least one fixture");
    const [loaded] = await loadFixtures([join(directory, file)]);
    if (!loaded) throw new Error("expected the fixture to load");

    const expectedBody = {
      envelope: { values: [{ identity: { userName: "ada@example.test" } }] },
    };
    const fixture = {
      ...loaded,
      expected: { status: 200, bodyContains: expectedBody },
    };
    const independentlyParsed = JSON.parse(
      JSON.stringify(expectedBody)
    ) as typeof expectedBody;
    const [equalResult] = await runFixtures([fixture], () => ({
      status: 200,
      body: independentlyParsed,
    }));
    expect(equalResult?.failures).toEqual([]);

    independentlyParsed.envelope.values[0] = {
      identity: { userName: "grace@example.test" },
    };
    const [mismatchResult] = await runFixtures([fixture], () => ({
      status: 200,
      body: independentlyParsed,
    }));
    expect(mismatchResult?.failures).toContainEqual({
      path: "body.envelope.values[0].identity.userName",
      message: 'expected "ada@example.test", received "grace@example.test"',
    });
  });
});
