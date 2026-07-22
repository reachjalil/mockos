import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCIM_BEFORE_COMMIT_INJECTION_POINT,
  SCIM_PATCH_OP_SCHEMA,
  type ScenarioSpec,
  scenarioSpecSchema,
} from "@mockos/contracts";
import { Engine, FixedClock, ScimService, SeededRng } from "@mockos/core";
import { NodeSqlStore } from "@mockos/testkit";
import { describe, expect, it } from "vitest";
import { createScimHttpApp } from "./scim";

type EdgeFixture = {
  readonly name: string;
  readonly description: string;
  readonly provider: "entra" | "okta";
  readonly resourceType: "User" | "Group";
  readonly scenario?: ScenarioSpec;
  readonly request: {
    readonly path: string;
    readonly body: unknown;
  };
  readonly expected: {
    readonly status: number;
    readonly bodyContains: Readonly<Record<string, unknown>>;
    readonly stored: {
      readonly displayName: string;
      readonly resourceVersion: number;
      readonly deleted: boolean;
    };
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseFixture = (value: unknown, file: string): EdgeFixture => {
  if (!isRecord(value)) throw new Error(`${file}: fixture must be an object.`);
  const request = value.request;
  const expected = value.expected;
  if (!isRecord(request) || !isRecord(expected) || !isRecord(expected.stored)) {
    throw new Error(`${file}: request, expected, and expected.stored are required.`);
  }
  if (
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    (value.provider !== "entra" && value.provider !== "okta") ||
    (value.resourceType !== "User" && value.resourceType !== "Group") ||
    typeof request.path !== "string" ||
    !request.path.startsWith("/scim/v2/") ||
    !Number.isInteger(expected.status) ||
    !isRecord(expected.bodyContains) ||
    typeof expected.stored.displayName !== "string" ||
    !Number.isInteger(expected.stored.resourceVersion) ||
    typeof expected.stored.deleted !== "boolean"
  ) {
    throw new Error(`${file}: fixture contains an invalid field.`);
  }
  return {
    name: value.name,
    description: value.description,
    provider: value.provider,
    resourceType: value.resourceType,
    ...(value.scenario === undefined
      ? {}
      : { scenario: scenarioSpecSchema.parse(value.scenario) }),
    request: { path: request.path, body: request.body },
    expected: {
      status: expected.status as number,
      bodyContains: expected.bodyContains,
      stored: {
        displayName: expected.stored.displayName,
        resourceVersion: expected.stored.resourceVersion as number,
        deleted: expected.stored.deleted,
      },
    },
  };
};

const fixtures = async (): Promise<readonly EdgeFixture[]> => {
  const directory = fileURLToPath(
    new URL("../../testkit/fixtures/m6/scim", import.meta.url)
  );
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (file) =>
      parseFixture(JSON.parse(await readFile(join(directory, file), "utf8")), file)
    )
  );
};

const runtimeFor = async (provider: "entra" | "okta", seed: string) => {
  const store = new NodeSqlStore();
  const engine = Engine.create(
    { provider, seed },
    {
      store,
      clock: new FixedClock("2026-07-22T12:00:00.000Z"),
      rng: new SeededRng(seed),
    }
  );
  await engine.initialize();
  await engine.users.create({
    id: "usr_edge",
    userName: "edge@example.test",
    displayName: "Before edge case",
    active: true,
  });
  engine.groups.create({
    id: "grp_edge",
    displayName: "Before edge group",
    memberIds: ["usr_edge"],
  });
  const service = new ScimService({
    users: engine.users,
    groups: engine.groups,
    lifecycle: engine.lifecycle,
    provider: engine.provider,
    scenarios: engine.scenarios,
  });
  return { store, engine, app: createScimHttpApp(service) };
};

const requestHeaders = {
  authorization: "Bearer synthetic-edge-fixture",
  "content-type": "application/scim+json",
  "if-match": 'W/"1"',
};

describe("M6 SCIM edge-case fixtures", () => {
  it("executes the locked conflict, race, and narrow tolerance corpus", async () => {
    const cases = await fixtures();
    expect(cases).toHaveLength(8);
    expect(new Set(cases.map(({ name }) => name)).size).toBe(cases.length);

    for (const fixture of cases) {
      const { store, engine, app } = await runtimeFor(
        fixture.provider,
        `m6:${fixture.name}`
      );
      try {
        if (fixture.scenario) engine.setScenario(fixture.scenario);
        const response = await app.request(
          new URL(fixture.request.path, "https://m6.mockos.test"),
          {
            method: "PATCH",
            headers: requestHeaders,
            body: JSON.stringify(fixture.request.body),
          }
        );
        expect(response.status, fixture.name).toBe(fixture.expected.status);
        expect(await response.json(), fixture.name).toMatchObject(
          fixture.expected.bodyContains
        );
        const record =
          fixture.resourceType === "User"
            ? engine.users.requireById("usr_edge")
            : engine.groups.requireById("grp_edge");
        expect(record, fixture.name).toMatchObject({
          displayName: fixture.expected.stored.displayName,
          resourceVersion: fixture.expected.stored.resourceVersion,
        });
        const deleted =
          fixture.resourceType === "User"
            ? engine.users.requireById("usr_edge").lifecycleState === "deleted"
            : engine.groups.requireById("grp_edge").softDeletedAt !== undefined;
        expect(deleted, fixture.name).toBe(fixture.expected.stored.deleted);
      } finally {
        store.close();
      }
    }
  });

  it("converges concurrent User PATCH and replay onto one atomic tombstone", async () => {
    const { store, engine, app } = await runtimeFor("entra", "m6-http-concurrency");
    try {
      engine.setScenario({
        id: "http-soft-delete-once",
        injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
        action: { type: "scim_soft_delete_race" },
        probability: 1,
        remaining: 1,
        enabled: true,
      });
      const invoke = () =>
        app.request("https://m6.mockos.test/scim/v2/Users/usr_edge", {
          method: "PATCH",
          headers: requestHeaders,
          body: JSON.stringify({
            schemas: [SCIM_PATCH_OP_SCHEMA],
            Operations: [
              { op: "replace", path: "displayName", value: "Must not persist" },
            ],
          }),
        });

      const responses = await Promise.all([invoke(), invoke()]);
      expect(responses.map(({ status }) => status)).toEqual([404, 404]);
      expect((await invoke()).status).toBe(404);
      expect(engine.users.requireById("usr_edge")).toMatchObject({
        displayName: "Before edge case",
        lifecycleState: "deleted",
        resourceVersion: 2,
      });
      expect(engine.groups.requireById("grp_edge")).toMatchObject({
        resourceVersion: 2,
      });
      expect(engine.groups.listMembers("grp_edge")).toEqual([]);
    } finally {
      store.close();
    }
  });
});
