import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "../engine";
import { FixedClock, SeededRng } from "../determinism";
import type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "../store";
import { OKTA_AUTHN_STATE_TOKEN_TTL_MS, OktaAuthnError } from "./okta-authn";

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

const setup = async (seed: string) => {
  const store = new MemorySqlStore();
  stores.push(store);
  const clock = new FixedClock("2026-07-22T12:00:00.000Z");
  const engine = Engine.create(
    { provider: "okta", seed },
    { store, clock, rng: new SeededRng(seed) }
  );
  await engine.initialize();
  return { clock, engine, store };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Okta Classic Authn core", () => {
  it("verifies the password before returning MFA, expiry, or lockout state", async () => {
    const { engine, store } = await setup("authn-states");
    await engine.users.create({
      userName: "mfa@example.test",
      displayName: "MFA User",
      password: "SyntheticPassw0rd!",
      passwordState: "expired",
      mfaState: "required",
    });
    await engine.users.create({
      userName: "expired@example.test",
      displayName: "Expired User",
      password: "SyntheticPassw0rd!",
      passwordState: "expired",
    });
    await engine.users.create({
      userName: "locked@example.test",
      displayName: "Locked User",
      password: "SyntheticPassw0rd!",
      lifecycleState: "suspended",
    });
    await engine.users.create({
      userName: "disabled@example.test",
      displayName: "Disabled User",
      password: "SyntheticPassw0rd!",
      lifecycleState: "disabled",
    });

    for (const userName of [
      "mfa@example.test",
      "expired@example.test",
      "locked@example.test",
      "missing@example.test",
    ]) {
      await expect(
        engine.authn.authenticate({ userName, password: "incorrect-password" })
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);

    const mfa = await engine.authn.authenticate({
      userName: "mfa@example.test",
      password: "SyntheticPassw0rd!",
    });
    expect(mfa).toMatchObject({ status: "MFA_REQUIRED" });
    if (mfa.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    expect(mfa.stateToken).toMatch(/^state_[a-f0-9]{48}$/);
    expect(await engine.authn.getTransaction(mfa.stateToken)).toMatchObject({
      stateToken: mfa.stateToken,
      status: "MFA_REQUIRED",
      user: { userName: "mfa@example.test" },
    });

    const expired = await engine.authn.authenticate({
      userName: "expired@example.test",
      password: "SyntheticPassw0rd!",
    });
    expect(expired).toMatchObject({ status: "PASSWORD_EXPIRED" });
    const locked = await engine.authn.authenticate({
      userName: "locked@example.test",
      password: "SyntheticPassw0rd!",
    });
    expect(locked).toEqual({ status: "LOCKED_OUT" });
    await expect(
      engine.authn.authenticate({
        userName: "disabled@example.test",
        password: "SyntheticPassw0rd!",
      })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const persisted = store.all<{ id: string }>(
      "SELECT id FROM authn_transactions ORDER BY created_at"
    );
    expect(persisted).toHaveLength(2);
    expect(persisted.every(({ id }) => /^[a-f0-9]{64}$/.test(id))).toBe(true);
    expect(persisted.map(({ id }) => id)).not.toContain(mfa.stateToken);
    expect(JSON.stringify(store.all("SELECT * FROM authn_transactions"))).not.toContain(
      "SyntheticPassw0rd!"
    );
  });

  it("expires and revokes state tokens without permitting cancellation replay", async () => {
    const { clock, engine, store } = await setup("authn-state-lifetime");
    await engine.users.create({
      userName: "mfa@example.test",
      displayName: "MFA User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });

    const cancelled = await engine.authn.authenticate({
      userName: "mfa@example.test",
      password: "SyntheticPassw0rd!",
    });
    if (cancelled.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    await engine.authn.cancel(cancelled.stateToken);
    await expect(engine.authn.getTransaction(cancelled.stateToken)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_STATE_TOKEN" })
    );
    await expect(engine.authn.cancel(cancelled.stateToken)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_STATE_TOKEN" })
    );

    const expiring = await engine.authn.authenticate({
      userName: "mfa@example.test",
      password: "SyntheticPassw0rd!",
    });
    if (expiring.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    clock.advance(OKTA_AUTHN_STATE_TOKEN_TTL_MS);
    await expect(engine.authn.getTransaction(expiring.stateToken)).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_STATE_TOKEN" })
    );
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);
  });

  it("stores session capabilities as hashes and consumes each exactly once", async () => {
    const { clock, engine, store } = await setup("authn-sessions");
    const user = await engine.users.create({
      userName: "success@example.test",
      displayName: "Success User",
      password: "SyntheticPassw0rd!",
    });

    const success = await engine.authn.authenticate({
      userName: user.userName,
      password: "SyntheticPassw0rd!",
    });
    if (success.status !== "SUCCESS") throw new Error("Expected success state.");
    expect(success.sessionToken).toMatch(/^session_[a-f0-9]{48}$/);
    const persisted = store.get<{ id_hash: string }>(
      "SELECT id_hash FROM web_sessions"
    );
    expect(persisted?.id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted?.id_hash).not.toBe(success.sessionToken);
    await expect(
      engine.authn.consumeSessionToken(success.sessionToken)
    ).resolves.toEqual(expect.objectContaining({ id: user.id }));
    await expect(
      engine.authn.consumeSessionToken(success.sessionToken)
    ).rejects.toBeInstanceOf(OktaAuthnError);

    const concurrent = await engine.authn.authenticate({
      userName: user.userName,
      password: "SyntheticPassw0rd!",
    });
    if (concurrent.status !== "SUCCESS") throw new Error("Expected success state.");
    const competing = await Promise.allSettled([
      engine.authn.consumeSessionToken(concurrent.sessionToken),
      engine.authn.consumeSessionToken(concurrent.sessionToken),
    ]);
    expect(competing.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(competing.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const expired = await engine.authn.authenticate({
      userName: user.userName,
      password: "SyntheticPassw0rd!",
    });
    if (expired.status !== "SUCCESS") throw new Error("Expected success state.");
    clock.set(expired.expiresAt);
    await expect(
      engine.authn.consumeSessionToken(expired.sessionToken)
    ).rejects.toEqual(expect.objectContaining({ code: "INVALID_SESSION_TOKEN" }));
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
  });

  it("revokes pending and session capabilities across lifecycle reactivation", async () => {
    const { engine, store } = await setup("authn-lifecycle-revocation");
    const pendingUser = await engine.users.create({
      userName: "pending@example.test",
      displayName: "Pending User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session@example.test",
      displayName: "Session User",
      password: "SyntheticPassw0rd!",
    });

    const pending = await engine.authn.authenticate({
      userName: pendingUser.userName,
      password: "SyntheticPassw0rd!",
    });
    const session = await engine.authn.authenticate({
      userName: sessionUser.userName,
      password: "SyntheticPassw0rd!",
    });
    if (pending.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    if (session.status !== "SUCCESS") throw new Error("Expected success state.");

    engine.lifecycle.apply(pendingUser.id, "suspend");
    engine.lifecycle.apply(sessionUser.id, "suspend");
    engine.lifecycle.apply(pendingUser.id, "unsuspend");
    engine.lifecycle.apply(sessionUser.id, "unsuspend");

    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
    await expect(engine.authn.getTransaction(pending.stateToken)).rejects.toMatchObject(
      { code: "INVALID_STATE_TOKEN" }
    );
    await expect(
      engine.authn.consumeSessionToken(session.sessionToken)
    ).rejects.toMatchObject({ code: "INVALID_SESSION_TOKEN" });
  });
});
