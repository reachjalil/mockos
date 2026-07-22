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
});
