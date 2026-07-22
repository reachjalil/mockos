import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations, Engine, ScimService } from "@mockos/core";
import {
  assertFixtureResults,
  type ConformanceFixture,
  loadFixtures,
  NodeSqlStore,
  runFixtures,
  SeededClock,
  SeededRng,
} from "@mockos/testkit";
import { describe, expect, it } from "vitest";
import { createScimHttpApp } from "./index.js";

const FIXTURE_ORIGIN = "https://fixtures.mockos.test";
const FIXTURE_CLOCK = "2026-07-22T12:00:00.000Z";

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

const scimFixtureFiles = async (): Promise<string[]> => {
  const directories = [
    new URL("../../testkit/fixtures/rfc/scim", import.meta.url),
    new URL("../../testkit/fixtures/entra/scim", import.meta.url),
    new URL("../../testkit/fixtures/okta/scim", import.meta.url),
  ].map((url) => fileURLToPath(url));
  return (
    await Promise.all(directories.map((directory) => jsonFilesRecursively(directory)))
  )
    .flat()
    .sort();
};

const fixtureRequest = (fixture: ConformanceFixture): Request => {
  const url = new URL(fixture.request.path, FIXTURE_ORIGIN);
  for (const [name, value] of Object.entries(fixture.request.query ?? {})) {
    url.searchParams.set(name, value);
  }

  const headers = new Headers(fixture.request.headers);
  let body: BodyInit | undefined;
  if (fixture.request.form !== undefined) {
    body = new URLSearchParams(fixture.request.form);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
  } else if (fixture.request.body !== undefined) {
    body = JSON.stringify(fixture.request.body);
  }

  return new Request(url, {
    method: fixture.request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
};

const responseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const executeScimFixture = async (fixture: ConformanceFixture) => {
  const store = new NodeSqlStore();
  try {
    applyMigrations(store);
    const engine = Engine.create(
      {
        provider: fixture.provider,
        seed: `scim-fixture:${fixture.name}`,
      },
      {
        store,
        clock: new SeededClock(FIXTURE_CLOCK),
        rng: new SeededRng(`scim-fixture:${fixture.name}`),
      }
    );

    await engine.users.create({
      id: "usr_ada",
      userName: "ada@example.test",
      displayName: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
      active: true,
      scim: {
        emails: [
          {
            value: "ada@example.test",
            type: "work",
            primary: true,
          },
        ],
      },
    });
    await engine.users.create({
      id: "usr_grace",
      userName: "grace@example.test",
      displayName: "Grace Hopper",
      givenName: "Grace",
      familyName: "Hopper",
      active: false,
      scim: {
        emails: [
          {
            value: "grace@example.test",
            type: "work",
            primary: true,
          },
        ],
      },
    });
    engine.groups.create({
      id: "grp_engineering",
      displayName: "Engineering",
      memberIds: ["usr_ada"],
    });

    const service = new ScimService({
      users: engine.users,
      groups: engine.groups,
      lifecycle: engine.lifecycle,
      provider: engine.provider,
      dialect: engine.provider.scimDialect,
      scenarios: engine.scenarios,
    });
    const response = await createScimHttpApp(service).fetch(fixtureRequest(fixture));
    return {
      status: response.status,
      headers: response.headers,
      body: await responseBody(response),
    };
  } finally {
    store.close();
  }
};

describe("M3 SCIM fixture executor", () => {
  it("executes all 113 RFC, Entra, and Okta fixtures through the real HTTP stack", {
    timeout: 30_000,
  }, async () => {
    const fixtures = await loadFixtures(await scimFixtureFiles());
    expect(fixtures).toHaveLength(113);

    const results = await runFixtures(fixtures, executeScimFixture);
    expect(results).toHaveLength(113);
    assertFixtureResults(results);
  });
});
