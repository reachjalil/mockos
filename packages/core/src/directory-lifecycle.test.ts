import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { ProviderId } from "@mockos/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  DirectoryUniquenessError,
  DirectoryVersionPreconditionError,
  Engine,
  FixedClock,
  InvalidLifecycleActionError,
  InvalidUserLifecycleTransitionError,
  SeededRng,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
} from "./index";

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

const setup = async (provider: ProviderId = "entra") => {
  const store = new MemorySqlStore();
  stores.push(store);
  const clock = new FixedClock("2026-07-22T12:00:00.000Z");
  const engine = Engine.create(
    { provider, seed: `directory-${provider}` },
    { store, clock, rng: new SeededRng(`directory-${provider}`) }
  );
  await engine.initialize();
  return { store, clock, engine };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("versioned directory repositories", () => {
  it("checks user preconditions before diffing and preserves stable no-ops", async () => {
    const { clock, engine } = await setup();
    const created = await engine.users.create({
      id: "usr_ada",
      externalId: "source-42",
      userName: "ada@example.test",
      displayName: "Ada Lovelace",
      scim: { locale: "en-GB", title: "Programmer" },
    });
    expect(created).toMatchObject({
      lifecycleState: "active",
      accountEnabled: true,
      resourceVersion: 1,
      scim: { locale: "en-GB", title: "Programmer" },
    });

    clock.advance(1_000);
    await expect(
      engine.users.updateScim(
        created.id,
        {
          externalId: "source-42",
          displayName: "Ada Lovelace",
          scim: { title: "Programmer", locale: "en-GB" },
        },
        2
      )
    ).rejects.toBeInstanceOf(DirectoryVersionPreconditionError);
    const noOp = await engine.users.updateScim(
      created.id,
      {
        externalId: "source-42",
        displayName: "Ada Lovelace",
        scim: { title: "Programmer", locale: "en-GB" },
      },
      1
    );
    expect(noOp).toEqual({ record: created, changed: false });

    const changed = await engine.users.updateScim(
      created.id,
      { displayName: "Augusta Ada King" },
      1
    );
    expect(changed).toMatchObject({
      changed: true,
      record: {
        displayName: "Augusta Ada King",
        resourceVersion: 2,
        updatedAt: "2026-07-22T12:00:01.000Z",
      },
    });
    await expect(
      engine.users.updateScim(created.id, { displayName: "Augusta Ada King" }, 1)
    ).rejects.toMatchObject({
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  it("allows duplicate external IDs while retaining case-insensitive userName uniqueness", async () => {
    const { engine } = await setup();
    const first = await engine.users.create({
      id: "usr_first",
      externalId: "shared-source-id",
      userName: "first@example.test",
      displayName: "First User",
    });
    await expect(
      engine.users.create({
        id: "usr_second",
        externalId: "shared-source-id",
        userName: "second@example.test",
        displayName: "Second User",
      })
    ).resolves.toMatchObject({ externalId: "shared-source-id" });
    await expect(
      engine.users.create({
        id: "usr_conflict",
        userName: "FIRST@example.test",
        displayName: "Conflicting User",
      })
    ).rejects.toBeInstanceOf(DirectoryUniquenessError);

    engine.users.deleteScim(first.id, 1);
    await expect(
      engine.users.create({
        id: "usr_third",
        externalId: "shared-source-id",
        userName: "third@example.test",
        displayName: "Third User",
      })
    ).resolves.toMatchObject({ externalId: "shared-source-id" });
  });

  it("versions a group aggregate once and permits duplicate names and external IDs", async () => {
    const { clock, engine } = await setup();
    const firstUser = await engine.users.create({
      id: "usr_first",
      userName: "first@example.test",
      displayName: "First User",
    });
    const secondUser = await engine.users.create({
      id: "usr_second",
      userName: "second@example.test",
      displayName: "Second User",
    });
    const group = engine.groups.create({
      id: "grp_primary",
      externalId: "shared-group-source",
      displayName: "Engineers",
      memberIds: [firstUser.id],
      scim: { description: "Primary team" },
    });
    expect(
      engine.groups.create({
        id: "grp_duplicate",
        externalId: "shared-group-source",
        displayName: "Engineers",
      })
    ).toMatchObject({
      externalId: "shared-group-source",
      displayName: "Engineers",
      resourceVersion: 1,
    });

    clock.advance(1_000);
    expect(engine.groups.addMembers(group.id, [firstUser.id], 1)).toEqual({
      record: group,
      changed: false,
    });
    expect(() => engine.groups.addMembers(group.id, [firstUser.id], 2)).toThrow(
      DirectoryVersionPreconditionError
    );
    expect(
      engine.groups.updateScim(
        group.id,
        {
          displayName: "Platform Engineers",
          memberIds: [secondUser.id, firstUser.id, secondUser.id],
          scim: { description: "Updated team" },
        },
        1
      )
    ).toMatchObject({
      changed: true,
      record: {
        displayName: "Platform Engineers",
        resourceVersion: 2,
        updatedAt: "2026-07-22T12:00:01.000Z",
      },
    });
    expect(engine.groups.listMembers(group.id).map(({ id }) => id)).toEqual([
      firstUser.id,
      secondUser.id,
    ]);
    expect(engine.groups.removeMembers(group.id, ["usr_missing"], 2)).toMatchObject({
      changed: false,
      record: { resourceVersion: 2 },
    });
  });

  it("removes memberships and bumps each affected group in the user-delete transaction", async () => {
    const { clock, engine } = await setup();
    const user = await engine.users.create({
      id: "usr_member",
      userName: "member@example.test",
      displayName: "Group Member",
    });
    const firstGroup = engine.groups.create({
      id: "grp_first",
      displayName: "First Group",
      memberIds: [user.id],
    });
    const secondGroup = engine.groups.create({
      id: "grp_second",
      displayName: "Second Group",
      memberIds: [user.id],
    });
    expect(() => engine.users.deleteScim(user.id, 2)).toThrow(
      DirectoryVersionPreconditionError
    );
    expect(engine.groups.listMembers(firstGroup.id)).toHaveLength(1);

    clock.advance(1_000);
    expect(engine.users.deleteScim(user.id, 1)).toMatchObject({
      changed: true,
      deleted: true,
      affectedGroupIds: [firstGroup.id, secondGroup.id],
      record: {
        lifecycleState: "deleted",
        accountEnabled: false,
        resourceVersion: 2,
        softDeletedAt: "2026-07-22T12:00:01.000Z",
      },
    });
    expect(engine.groups.listMembers(firstGroup.id)).toEqual([]);
    expect(engine.groups.listMembers(secondGroup.id)).toEqual([]);
    expect(engine.groups.requireById(firstGroup.id).resourceVersion).toBe(2);
    expect(engine.groups.requireById(secondGroup.id).resourceVersion).toBe(2);
    expect(engine.users.list()).toEqual([]);
    expect(engine.users.list({ includeDeleted: true })).toHaveLength(1);
    expect(() => engine.users.transitionLifecycle(user.id, "active")).toThrow(
      InvalidUserLifecycleTransitionError
    );
  });
});

describe("provider lifecycle policy", () => {
  it("accepts only Entra lifecycle actions for the current state", async () => {
    const { engine } = await setup("entra");
    const user = await engine.users.create({
      id: "usr_entra",
      userName: "entra@example.test",
      displayName: "Entra User",
    });
    expect(() => engine.lifecycle.apply(user.id, "suspend")).toThrow(
      InvalidLifecycleActionError
    );
    expect(engine.users.requireById(user.id)).toMatchObject({
      lifecycleState: "active",
      resourceVersion: 1,
    });
    expect(engine.lifecycle.apply(user.id, "disable", 1)).toMatchObject({
      previousState: "active",
      currentState: "disabled",
      changed: true,
      version: 2,
      etag: 'W/"2"',
      revoked: { accessTokens: 0, refreshTokens: 0 },
    });
    expect(engine.lifecycle.apply(user.id, "disable", 2)).toMatchObject({
      previousState: "disabled",
      currentState: "disabled",
      changed: false,
      version: 2,
      revoked: { accessTokens: 0, refreshTokens: 0 },
    });
    expect(engine.lifecycle.apply(user.id, "reactivate", 2)).toMatchObject({
      previousState: "disabled",
      currentState: "active",
      changed: true,
      version: 3,
    });
  });

  it("revokes effective straggler tokens for an idempotent disabling action", async () => {
    const { store, engine } = await setup("entra");
    const user = await engine.users.create({
      id: "usr_disabled",
      userName: "disabled@example.test",
      displayName: "Disabled User",
      lifecycleState: "disabled",
    });
    store.run(
      `INSERT INTO oauth_access_tokens (
        token_hash, client_id, user_id, scope, jti, issued_at, expires_at, family_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "access-hash",
      "client-id",
      user.id,
      "openid",
      "access-id",
      "2026-07-22T12:00:00.000Z",
      "2026-07-22T13:00:00.000Z",
      "family-id"
    );
    store.run(
      `INSERT INTO refresh_tokens (
        token_hash, family_id, client_id, user_id, scope, issued_at, expires_at,
        auth_time, generation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "refresh-hash",
      "family-id",
      "client-id",
      user.id,
      "openid offline_access",
      "2026-07-22T12:00:00.000Z",
      "2026-08-22T12:00:00.000Z",
      1_784_721_600,
      0
    );

    expect(engine.lifecycle.apply(user.id, "disable", 1)).toMatchObject({
      previousState: "disabled",
      currentState: "disabled",
      changed: false,
      version: 1,
      revoked: { accessTokens: 1, refreshTokens: 1 },
    });
    expect(
      store.get<{ revoked_at: string | null }>(
        "SELECT revoked_at FROM oauth_access_tokens WHERE token_hash = ?",
        "access-hash"
      )?.revoked_at
    ).toBe("2026-07-22T12:00:00.000Z");
    expect(
      store.get<{ revoked_at: string | null }>(
        "SELECT revoked_at FROM refresh_tokens WHERE token_hash = ?",
        "refresh-hash"
      )?.revoked_at
    ).toBe("2026-07-22T12:00:00.000Z");
  });

  it("requires Okta deprovisioning before deletion", async () => {
    const { engine } = await setup("okta");
    const user = await engine.users.create({
      id: "usr_okta",
      userName: "okta@example.test",
      displayName: "Okta User",
    });
    expect(() => engine.lifecycle.apply(user.id, "delete")).toThrow(
      InvalidLifecycleActionError
    );
    expect(engine.lifecycle.apply(user.id, "deprovision")).toMatchObject({
      previousState: "active",
      currentState: "deprovisioned",
      version: 2,
    });
    expect(engine.lifecycle.apply(user.id, "delete")).toMatchObject({
      previousState: "deprovisioned",
      currentState: "deleted",
      version: 3,
    });
  });
});
