import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_BEFORE_COMMIT_INJECTION_POINT,
  SCIM_PATCH_OP_SCHEMA,
} from "@mockos/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FixedClock, SeededRng } from "../determinism";
import { Engine } from "../engine";
import type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "../store";
import { ScimProtocolError } from "./errors";
import { ScimService } from "./service";

class MemorySqlStore implements SqlStore {
  readonly database = new DatabaseSync(":memory:");
  #transactionDepth = 0;

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const result = this.database.prepare(sql).run(...(bindings as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[] {
    return this.database
      .prepare(sql)
      .all(...(bindings as SQLInputValue[])) as unknown as T[];
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined {
    return this.database.prepare(sql).get(...(bindings as SQLInputValue[])) as
      | T
      | undefined;
  }

  transaction<T>(callback: () => T): T {
    if (this.#transactionDepth > 0) return callback();
    this.database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth += 1;
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  close(): void {
    this.database.close();
  }
}

const stores: MemorySqlStore[] = [];
const serviceFor = async (provider: "entra" | "okta") => {
  const store = new MemorySqlStore();
  stores.push(store);
  const engine = Engine.create(
    { provider, seed: `scim-service-${provider}` },
    {
      store,
      clock: new FixedClock("2026-07-22T12:00:00.000Z"),
      rng: new SeededRng(`scim-service-${provider}`),
    }
  );
  await engine.initialize();
  return {
    engine,
    service: new ScimService({
      users: engine.users,
      groups: engine.groups,
      lifecycle: engine.lifecycle,
      provider: engine.provider,
      scenarios: engine.scenarios,
    }),
  };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const baseUrl = "https://mockos.test/e/env_scim/scim/v2";
const query = {
  startIndex: 1,
  count: 100,
};

describe("SCIM persistence service read and create slice", () => {
  it("serves provider-neutral registries and provider-specific group status", async () => {
    const entra = await serviceFor("entra");
    const okta = await serviceFor("okta");

    expect(entra.service.groupPatchSuccessStatus).toBe(204);
    expect(okta.service.groupPatchSuccessStatus).toBe(200);
    expect(entra.service.serviceProviderConfig(baseUrl)).toMatchObject({
      patch: { supported: true },
      filter: { supported: true, maxResults: 200 },
      bulk: { supported: false },
      sort: { supported: false },
      etag: { supported: true },
    });
    expect(entra.service.resourceTypes(baseUrl)).toMatchObject({
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        { id: "User", endpoint: "/Users", schema: SCIM_CORE_USER_SCHEMA },
        { id: "Group", endpoint: "/Groups", schema: SCIM_CORE_GROUP_SCHEMA },
      ],
    });
    expect(entra.service.schema(SCIM_ENTERPRISE_USER_SCHEMA, baseUrl)).toMatchObject({
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: "EnterpriseUser",
    });
    expect(entra.service.schema("unknown", baseUrl)).toBeUndefined();
  });

  it("creates safe User representations and maps inactive initial state by provider", async () => {
    const { engine, service } = await serviceFor("okta");
    const created = await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA],
        externalId: "source-1",
        userName: "ada@example.test",
        name: { givenName: "Ada", familyName: "Lovelace" },
        active: false,
        password: "Synthetic-Passw0rd!",
        [SCIM_ENTERPRISE_USER_SCHEMA]: { department: "Research" },
      },
      baseUrl
    );

    expect(created).toMatchObject({
      etag: 'W/"1"',
      location: `${baseUrl}/Users/${created.resource.id}`,
      resource: {
        userName: "ada@example.test",
        displayName: "Ada Lovelace",
        active: false,
        [SCIM_ENTERPRISE_USER_SCHEMA]: { department: "Research" },
      },
    });
    expect(created.resource).not.toHaveProperty("password");
    const stored = engine.users.requireById(created.resource.id);
    expect(stored.lifecycleState).toBe("staged");
    expect(stored.scim).not.toHaveProperty("password");

    const entra = await serviceFor("entra");
    const disabled = await entra.service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "grace@example.test",
        displayName: "Grace Hopper",
        active: false,
      },
      baseUrl
    );
    expect(entra.engine.users.requireById(disabled.resource.id).lifecycleState).toBe(
      "disabled"
    );
  });

  it("allows duplicate externalId but translates unique userName conflicts", async () => {
    const { service } = await serviceFor("entra");
    await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        externalId: "shared-source-id",
        userName: "first@example.test",
      },
      baseUrl
    );
    await expect(
      service.createUser(
        {
          schemas: [SCIM_CORE_USER_SCHEMA],
          externalId: "shared-source-id",
          userName: "second@example.test",
        },
        baseUrl
      )
    ).resolves.toMatchObject({ resource: { externalId: "shared-source-id" } });
    await expect(
      service.createUser(
        {
          schemas: [SCIM_CORE_USER_SCHEMA],
          userName: "FIRST@example.test",
        },
        baseUrl
      )
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
  });

  it("filters before stable paging and applies include/exclude projection", async () => {
    const { service } = await serviceFor("entra");
    for (const [userName, displayName] of [
      ["ada@example.test", "Ada"],
      ["grace@example.test", "Grace"],
      ["george@example.test", "George"],
    ] as const) {
      await service.createUser(
        { schemas: [SCIM_CORE_USER_SCHEMA], userName, displayName },
        baseUrl
      );
    }

    const page = service.listUsers(
      {
        filter: 'userName sw "g"',
        startIndex: 2,
        count: 1,
        attributes: "userName,active",
      },
      baseUrl
    );
    expect(page).toMatchObject({
      totalResults: 2,
      startIndex: 2,
      itemsPerPage: 1,
      Resources: [{ userName: "george@example.test", active: true }],
    });
    expect(page.Resources[0]).not.toHaveProperty("displayName");
    expect(page.Resources[0]).toHaveProperty("meta");

    const excluded = service.listUsers(
      { ...query, excludedAttributes: "displayName,name" },
      baseUrl
    );
    expect(excluded.Resources[0]).not.toHaveProperty("displayName");
    expect(service.listUsers({ ...query, count: 0 }, baseUrl)).toMatchObject({
      totalResults: 3,
      itemsPerPage: 0,
      Resources: [],
    });
  });

  it("creates Group membership representations and translates missing members", async () => {
    const { service } = await serviceFor("entra");
    const user = await service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "ada@example.test" },
      baseUrl
    );
    const group = await service.createGroup(
      {
        schemas: [SCIM_CORE_GROUP_SCHEMA],
        displayName: "Engineering",
        members: [{ value: user.resource.id }],
      },
      baseUrl
    );
    expect(group).toMatchObject({
      etag: 'W/"1"',
      resource: {
        displayName: "Engineering",
        members: [{ value: user.resource.id, type: "User" }],
      },
    });
    expect(service.getGroup(group.resource.id, baseUrl)).toEqual(group);
    expect(service.getUser("missing", baseUrl)).toBeUndefined();

    await expect(
      service.createGroup(
        {
          schemas: [SCIM_CORE_GROUP_SCHEMA],
          displayName: "Missing member",
          members: [{ value: "missing" }],
        },
        baseUrl
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects invalid base URLs and resource schema mismatches", async () => {
    const { service } = await serviceFor("okta");
    expect(() => service.serviceProviderConfig("not-a-url")).toThrow(ScimProtocolError);
    await expect(
      service.createUser(
        { schemas: [SCIM_CORE_GROUP_SCHEMA], userName: "wrong@example.test" },
        baseUrl
      )
    ).rejects.toMatchObject({ status: 400, scimType: "invalidValue" });
    await expect(
      service.createGroup(
        { schemas: [SCIM_CORE_USER_SCHEMA], displayName: "Wrong schema" },
        baseUrl
      )
    ).rejects.toMatchObject({ status: 400, scimType: "invalidValue" });
  });
});

describe("SCIM persistence service mutations", () => {
  it("atomically applies Okta profile and lifecycle patches with stable no-ops", async () => {
    const { engine, service } = await serviceFor("okta");
    const created = await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "ada@example.test",
        displayName: "Ada",
      },
      baseUrl
    );

    const deprovisioned = await service.patchUser(
      created.resource.id,
      {
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [
          { op: "replace", path: "displayName", value: "Ada Lovelace" },
          { op: "replace", path: "active", value: false },
        ],
      },
      'W/"1"',
      baseUrl
    );
    expect(deprovisioned).toMatchObject({
      etag: 'W/"2"',
      resource: { displayName: "Ada Lovelace", active: false },
    });
    expect(engine.users.requireById(created.resource.id).lifecycleState).toBe(
      "deprovisioned"
    );

    const noOp = await service.patchUser(
      created.resource.id,
      {
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [{ op: "replace", path: "active", value: false }],
      },
      'W/"2"',
      baseUrl
    );
    expect(noOp.etag).toBe('W/"2"');
    await expect(
      service.patchUser(
        created.resource.id,
        {
          schemas: [SCIM_PATCH_OP_SCHEMA],
          Operations: [{ op: "replace", path: "displayName", value: "Stale" }],
        },
        'W/"1"',
        baseUrl
      )
    ).rejects.toMatchObject({ status: 412 });

    const reactivated = await service.patchUser(
      created.resource.id,
      {
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [{ op: "replace", path: "active", value: true }],
      },
      'W/"2"',
      baseUrl
    );
    expect(reactivated).toMatchObject({ etag: 'W/"3"', resource: { active: true } });
  });

  it("does not partially transition a User when a mixed patch violates uniqueness", async () => {
    const { engine, service } = await serviceFor("entra");
    await service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "taken@example.test" },
      baseUrl
    );
    const target = await service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "target@example.test" },
      baseUrl
    );

    await expect(
      service.patchUser(
        target.resource.id,
        {
          schemas: [SCIM_PATCH_OP_SCHEMA],
          Operations: [
            { op: "replace", path: "userName", value: "TAKEN@example.test" },
            { op: "replace", path: "active", value: false },
          ],
        },
        'W/"1"',
        baseUrl
      )
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
    expect(engine.users.requireById(target.resource.id)).toMatchObject({
      userName: "target@example.test",
      lifecycleState: "active",
      resourceVersion: 1,
    });
  });

  it("replaces, patches, and deletes Groups with ETag preconditions", async () => {
    const { service } = await serviceFor("entra");
    const first = await service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "first@example.test" },
      baseUrl
    );
    const second = await service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "second@example.test" },
      baseUrl
    );
    const group = await service.createGroup(
      {
        schemas: [SCIM_CORE_GROUP_SCHEMA],
        displayName: "Original",
        members: [{ value: first.resource.id }],
      },
      baseUrl
    );

    const patched = await service.patchGroup(
      group.resource.id,
      {
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [
          { op: "replace", path: "displayName", value: "Renamed" },
          { op: "add", path: "members", value: [{ value: second.resource.id }] },
        ],
      },
      'W/"1"',
      baseUrl
    );
    expect(patched).toMatchObject({
      etag: 'W/"2"',
      resource: { displayName: "Renamed" },
    });
    expect(patched.resource.members.map((member) => member.value)).toEqual([
      first.resource.id,
      second.resource.id,
    ]);

    const noOp = await service.patchGroup(
      group.resource.id,
      {
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [{ op: "replace", path: "displayName", value: "Renamed" }],
      },
      'W/"2"',
      baseUrl
    );
    expect(noOp.etag).toBe('W/"2"');
    await expect(service.deleteGroup(group.resource.id, 'W/"1"')).rejects.toMatchObject(
      { status: 412 }
    );
    await service.deleteGroup(group.resource.id, 'W/"2"');
    expect(service.getGroup(group.resource.id, baseUrl)).toBeUndefined();
  });

  it("uses provider lifecycle rules for deletes", async () => {
    const okta = await serviceFor("okta");
    const oktaUser = await okta.service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "okta@example.test" },
      baseUrl
    );
    await okta.service.deleteUser(oktaUser.resource.id, 'W/"1"');
    expect(okta.engine.users.requireById(oktaUser.resource.id)).toMatchObject({
      lifecycleState: "deleted",
      resourceVersion: 3,
    });

    const entra = await serviceFor("entra");
    const entraUser = await entra.service.createUser(
      { schemas: [SCIM_CORE_USER_SCHEMA], userName: "entra@example.test" },
      baseUrl
    );
    await entra.service.deleteUser(entraUser.resource.id, 'W/"1"');
    expect(entra.engine.users.requireById(entraUser.resource.id)).toMatchObject({
      lifecycleState: "deleted",
      resourceVersion: 2,
    });
  });
});

describe("M6 deterministic SCIM edge scenarios", () => {
  it("returns a replay-safe 409 conflict without partially applying a mixed patch", async () => {
    const { engine, service } = await serviceFor("entra");
    const created = await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "conflict@example.test",
        displayName: "Before conflict",
      },
      baseUrl
    );
    engine.setScenario({
      id: "scim-conflict-once",
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_conflict" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const patch = {
      schemas: [SCIM_PATCH_OP_SCHEMA] as [typeof SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: "replace" as const, path: "displayName", value: "After conflict" },
        { op: "replace" as const, path: "active", value: false },
      ],
    };

    await expect(
      service.patchUser(created.resource.id, patch, 'W/"1"', baseUrl)
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
    expect(engine.users.requireById(created.resource.id)).toMatchObject({
      displayName: "Before conflict",
      lifecycleState: "active",
      resourceVersion: 1,
    });

    await expect(
      service.patchUser(created.resource.id, patch, 'W/"1"', baseUrl)
    ).resolves.toMatchObject({
      etag: 'W/"2"',
      resource: { displayName: "After conflict", active: false },
    });
  });

  it("serializes a soft-delete race and concurrent replay into one fail-closed state", async () => {
    const { engine, service } = await serviceFor("entra");
    const created = await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "race@example.test",
        displayName: "Before race",
      },
      baseUrl
    );
    const group = await service.createGroup(
      {
        schemas: [SCIM_CORE_GROUP_SCHEMA],
        displayName: "Race members",
        members: [{ value: created.resource.id }],
      },
      baseUrl
    );
    engine.setScenario({
      id: "scim-soft-delete-once",
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_soft_delete_race" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const patch = {
      schemas: [SCIM_PATCH_OP_SCHEMA] as [typeof SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: "replace" as const, path: "displayName", value: "Partial write" },
      ],
    };

    const outcomes = await Promise.allSettled([
      service.patchUser(created.resource.id, patch, 'W/"1"', baseUrl),
      service.patchUser(created.resource.id, patch, 'W/"1"', baseUrl),
    ]);
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toMatchObject({ status: 404 });
      }
    }
    expect(engine.users.requireById(created.resource.id)).toMatchObject({
      userName: "race@example.test",
      displayName: "Before race",
      lifecycleState: "deleted",
      resourceVersion: 2,
    });
    expect(engine.groups.requireById(group.resource.id)).toMatchObject({
      displayName: "Race members",
      resourceVersion: 2,
    });
    expect(engine.groups.listMembers(group.resource.id)).toEqual([]);
    expect(service.getUser(created.resource.id, baseUrl)).toBeUndefined();
  });

  it("rejects a stale precondition before consuming or applying a delete race", async () => {
    const { engine, service } = await serviceFor("okta");
    const created = await service.createUser(
      {
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "stale-race@example.test",
        displayName: "Stale race",
      },
      baseUrl
    );
    engine.setScenario({
      id: "stale-soft-delete-once",
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_soft_delete_race" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const patch = {
      schemas: [SCIM_PATCH_OP_SCHEMA] as [typeof SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: "replace" as const, path: "displayName", value: "Must not persist" },
      ],
    };

    await expect(
      service.patchUser(created.resource.id, patch, 'W/"9"', baseUrl)
    ).rejects.toMatchObject({ status: 412 });
    expect(engine.users.requireById(created.resource.id)).toMatchObject({
      displayName: "Stale race",
      lifecycleState: "active",
      resourceVersion: 1,
    });
    expect(engine.scenarios.list()).toEqual([
      expect.objectContaining({
        id: "stale-soft-delete-once",
        enabled: true,
        remaining: 1,
      }),
    ]);

    await expect(
      service.patchUser(created.resource.id, patch, 'W/"1"', baseUrl)
    ).rejects.toMatchObject({ status: 404 });
    expect(engine.users.requireById(created.resource.id)).toMatchObject({
      displayName: "Stale race",
      lifecycleState: "deleted",
      resourceVersion: 2,
    });
  });

  it("denies a soft-delete race on create without inserting a resource", async () => {
    const { engine, service } = await serviceFor("okta");
    engine.setScenario({
      id: "invalid-create-race",
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_soft_delete_race" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });

    await expect(
      service.createGroup(
        { schemas: [SCIM_CORE_GROUP_SCHEMA], displayName: "Must not exist" },
        baseUrl
      )
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
    expect(engine.groups.list({ includeDeleted: true })).toEqual([]);
  });
});
