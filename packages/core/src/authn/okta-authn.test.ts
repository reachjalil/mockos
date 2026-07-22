import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedClock, SeededRng } from "../determinism";
import { Engine } from "../engine";
import type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "../store";
import {
  OKTA_AUTHN_EXPIRY_GC_BATCH_SIZE,
  OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND,
  OKTA_AUTHN_SESSION_TOKEN_TTL_MS,
  OKTA_AUTHN_STATE_TOKEN_TTL_MS,
  OktaAuthnError,
  OktaAuthnService,
} from "./okta-authn";

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

  it("slides a valid state transaction expiry while preserving exact-boundary expiry", async () => {
    const { clock, engine } = await setup("authn-state-sliding-expiry");
    await engine.users.create({
      userName: "sliding@example.test",
      displayName: "Sliding State User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const pending = await engine.authn.authenticate({
      userName: "sliding@example.test",
      password: "SyntheticPassw0rd!",
    });
    if (pending.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    const originalExpiry = pending.expiresAt;

    clock.advance(OKTA_AUTHN_STATE_TOKEN_TTL_MS - 1_000);
    const refreshed = await engine.authn.getTransaction(pending.stateToken);
    if (refreshed.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    expect(Date.parse(refreshed.expiresAt)).toBe(
      clock.now().getTime() + OKTA_AUTHN_STATE_TOKEN_TTL_MS
    );
    expect(Date.parse(refreshed.expiresAt)).toBeGreaterThan(Date.parse(originalExpiry));

    clock.advance(2_000);
    await expect(
      engine.authn.getTransaction(pending.stateToken)
    ).resolves.toMatchObject({
      status: "MFA_REQUIRED",
    });
    clock.advance(OKTA_AUTHN_STATE_TOKEN_TTL_MS);
    await expect(engine.authn.getTransaction(pending.stateToken)).rejects.toMatchObject(
      {
        code: "INVALID_STATE_TOKEN",
      }
    );
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

  it("prunes unpresented expired rows before issuing another capability", async () => {
    const { clock, engine, store } = await setup("authn-expiry-gc");
    const pendingUser = await engine.users.create({
      userName: "pending-gc@example.test",
      displayName: "Pending GC User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-gc@example.test",
      displayName: "Session GC User",
      password: "SyntheticPassw0rd!",
    });
    const oldPending = await engine.authn.authenticate({
      userName: pendingUser.userName,
      password: "SyntheticPassw0rd!",
    });
    const oldSession = await engine.authn.authenticate({
      userName: sessionUser.userName,
      password: "SyntheticPassw0rd!",
    });
    if (oldPending.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    if (oldSession.status !== "SUCCESS") throw new Error("Expected success state.");

    clock.advance(
      Math.max(OKTA_AUTHN_STATE_TOKEN_TTL_MS, OKTA_AUTHN_SESSION_TOKEN_TTL_MS)
    );
    await engine.authn.authenticate({
      userName: pendingUser.userName,
      password: "SyntheticPassw0rd!",
    });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(1);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
    await engine.authn.authenticate({
      userName: sessionUser.userName,
      password: "SyntheticPassw0rd!",
    });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(1);
    await expect(
      engine.authn.getTransaction(oldPending.stateToken)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TOKEN" });
    await expect(
      engine.authn.consumeSessionToken(oldSession.sessionToken)
    ).rejects.toMatchObject({ code: "INVALID_SESSION_TOKEN" });
  });

  it("bounds each indexed expiry collection pass", async () => {
    const { clock, engine, store } = await setup("authn-bounded-expiry-gc");
    const pendingUser = await engine.users.create({
      userName: "pending-bounded-gc@example.test",
      displayName: "Pending Bounded GC User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-bounded-gc@example.test",
      displayName: "Session Bounded GC User",
      password: "SyntheticPassw0rd!",
    });
    const createdAt = "2026-07-22T11:00:00.000Z";
    const expiresAt = "2026-07-22T11:05:00.000Z";
    for (let index = 0; index <= OKTA_AUTHN_EXPIRY_GC_BATCH_SIZE; index += 1) {
      store.run(
        `INSERT INTO authn_transactions (
           id, state, user_id, payload_json, created_at, expires_at
         ) VALUES (?, 'MFA_REQUIRED', ?, '{}', ?, ?)`,
        `expired_state_${index.toString().padStart(3, "0")}`,
        pendingUser.id,
        createdAt,
        expiresAt
      );
      store.run(
        `INSERT INTO web_sessions (id_hash, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        `expired_session_${index.toString().padStart(3, "0")}`,
        sessionUser.id,
        createdAt,
        expiresAt
      );
    }

    const pending = await engine.authn.authenticate({
      userName: pendingUser.userName,
      password: "SyntheticPassw0rd!",
    });
    expect(pending.status).toBe("MFA_REQUIRED");
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authn_transactions WHERE expires_at <= ?",
        clock.now().toISOString()
      )?.count
    ).toBe(1);
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM web_sessions WHERE expires_at <= ?",
        clock.now().toISOString()
      )?.count
    ).toBe(1);

    const success = await engine.authn.authenticate({
      userName: sessionUser.userName,
      password: "SyntheticPassw0rd!",
    });
    expect(success.status).toBe("SUCCESS");
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM authn_transactions WHERE expires_at <= ?",
        clock.now().toISOString()
      )?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM web_sessions WHERE expires_at <= ?",
        clock.now().toISOString()
      )?.count
    ).toBe(0);
  });

  it("keeps live state and session capabilities within per-user per-kind caps", async () => {
    const { engine, store } = await setup("authn-live-caps");
    const pendingUser = await engine.users.create({
      userName: "pending-cap@example.test",
      displayName: "Pending Cap User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-cap@example.test",
      displayName: "Session Cap User",
      password: "SyntheticPassw0rd!",
    });
    const stateTokens: string[] = [];
    const sessionTokens: string[] = [];
    for (
      let index = 0;
      index < OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND + 2;
      index += 1
    ) {
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
      stateTokens.push(pending.stateToken);
      sessionTokens.push(session.sessionToken);
    }
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND);
    const stateResults = await Promise.allSettled(
      stateTokens.map((token) => engine.authn.getTransaction(token))
    );
    const sessionResults = await Promise.allSettled(
      sessionTokens.map((token) => engine.authn.consumeSessionToken(token))
    );
    expect(stateResults.filter(({ status }) => status === "fulfilled")).toHaveLength(
      OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND
    );
    expect(sessionResults.filter(({ status }) => status === "fulfilled")).toHaveLength(
      OKTA_AUTHN_MAX_CAPABILITIES_PER_USER_PER_KIND
    );
    expect(stateResults.filter(({ status }) => status === "rejected")).toHaveLength(2);
    expect(sessionResults.filter(({ status }) => status === "rejected")).toHaveLength(
      2
    );
  });

  it("keeps each Authn capability table within its environment cap", async () => {
    const { clock, engine, store } = await setup("authn-environment-caps");
    const pendingUser = await engine.users.create({
      userName: "pending-environment-cap@example.test",
      displayName: "Pending Environment Cap User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-environment-cap@example.test",
      displayName: "Session Environment Cap User",
      password: "SyntheticPassw0rd!",
    });
    const authn = new OktaAuthnService({
      clock,
      rng: new SeededRng("authn-environment-cap-service"),
      store,
      users: engine.users,
      maxCapabilitiesPerUserPerKind: 10,
      maxStateTransactions: 3,
      maxSessionTokens: 3,
    });
    const stateTokens: string[] = [];
    const sessionTokens: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const pending = await authn.authenticate({
        userName: pendingUser.userName,
        password: "SyntheticPassw0rd!",
      });
      const success = await authn.authenticate({
        userName: sessionUser.userName,
        password: "SyntheticPassw0rd!",
      });
      if (pending.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
      if (success.status !== "SUCCESS") throw new Error("Expected success state.");
      stateTokens.push(pending.stateToken);
      sessionTokens.push(success.sessionToken);
    }

    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(3);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(3);
    const stateResults = await Promise.allSettled(
      stateTokens.map((token) => authn.getTransaction(token))
    );
    const sessionResults = await Promise.allSettled(
      sessionTokens.map((token) => authn.consumeSessionToken(token))
    );
    expect(stateResults.filter(({ status }) => status === "fulfilled")).toHaveLength(3);
    expect(sessionResults.filter(({ status }) => status === "fulfilled")).toHaveLength(
      3
    );
  });

  it("keeps expiry indexes version-neutral for schema-v5 rollback", async () => {
    const { store } = await setup("authn-version-neutral-indexes");
    expect(
      store.get<{ user_version: number }>("PRAGMA user_version")?.user_version
    ).toBe(5);
    expect(
      store
        .all<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name IN (
               'authn_transactions_expiry_idx',
               'authn_transactions_user_expiry_idx',
               'web_sessions_expiry_idx',
               'web_sessions_user_expiry_idx'
             )
           ORDER BY name`
        )
        .map(({ name }) => name)
    ).toEqual([
      "authn_transactions_expiry_idx",
      "authn_transactions_user_expiry_idx",
      "web_sessions_expiry_idx",
      "web_sessions_user_expiry_idx",
    ]);
  });

  it("revokes capabilities through exported lifecycle convenience mutators", async () => {
    const { engine, store } = await setup("authn-exported-lifecycle-revocation");
    const pendingUser = await engine.users.create({
      userName: "pending-export@example.test",
      displayName: "Pending Export User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-export@example.test",
      displayName: "Session Export User",
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

    engine.users.setAccountEnabled(pendingUser.id, false);
    engine.users.setAccountEnabled(sessionUser.id, false);
    engine.users.setAccountEnabled(pendingUser.id, true);
    engine.users.setAccountEnabled(sessionUser.id, true);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
    await expect(engine.authn.getTransaction(pending.stateToken)).rejects.toMatchObject(
      {
        code: "INVALID_STATE_TOKEN",
      }
    );
    await expect(
      engine.authn.consumeSessionToken(session.sessionToken)
    ).rejects.toMatchObject({ code: "INVALID_SESSION_TOKEN" });
  });

  it("revokes active capabilities when SCIM changes the password", async () => {
    const { engine, store } = await setup("authn-password-change-revocation");
    const pendingUser = await engine.users.create({
      userName: "pending-password@example.test",
      displayName: "Pending Password User",
      password: "OldSyntheticPassw0rd!",
      mfaState: "required",
    });
    const sessionUser = await engine.users.create({
      userName: "session-password@example.test",
      displayName: "Session Password User",
      password: "OldSyntheticPassw0rd!",
    });
    const pending = await engine.authn.authenticate({
      userName: pendingUser.userName,
      password: "OldSyntheticPassw0rd!",
    });
    const session = await engine.authn.authenticate({
      userName: sessionUser.userName,
      password: "OldSyntheticPassw0rd!",
    });
    if (pending.status !== "MFA_REQUIRED") throw new Error("Expected MFA state.");
    if (session.status !== "SUCCESS") throw new Error("Expected success state.");

    await engine.users.updateScim(pendingUser.id, {
      password: "NewSyntheticPassw0rd!",
    });
    await engine.users.updateScim(sessionUser.id, {
      password: "NewSyntheticPassw0rd!",
    });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
    await expect(engine.authn.getTransaction(pending.stateToken)).rejects.toMatchObject(
      {
        code: "INVALID_STATE_TOKEN",
      }
    );
    await expect(
      engine.authn.consumeSessionToken(session.sessionToken)
    ).rejects.toMatchObject({ code: "INVALID_SESSION_TOKEN" });
  });

  it("refuses issuance from a stale post-verification User snapshot", async () => {
    const { engine, store } = await setup("authn-verification-race");
    const lifecycleUser = await engine.users.create({
      userName: "lifecycle-race@example.test",
      displayName: "Lifecycle Race User",
      password: "SyntheticPassw0rd!",
    });
    const passwordUser = await engine.users.create({
      userName: "password-race@example.test",
      displayName: "Password Race User",
      password: "SyntheticPassw0rd!",
      mfaState: "required",
    });
    const verify = engine.users.verifyPrimaryCredentials.bind(engine.users);
    const spy = vi.spyOn(engine.users, "verifyPrimaryCredentials");
    spy.mockImplementationOnce(async (userName, password) => {
      const snapshot = await verify(userName, password);
      engine.users.setAccountEnabled(lifecycleUser.id, false);
      return snapshot;
    });
    await expect(
      engine.authn.authenticate({
        userName: lifecycleUser.userName,
        password: "SyntheticPassw0rd!",
      })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    spy.mockImplementationOnce(async (userName, password) => {
      const snapshot = await verify(userName, password);
      await engine.users.updateScim(passwordUser.id, {
        password: "RotatedSyntheticPassw0rd!",
      });
      return snapshot;
    });
    await expect(
      engine.authn.authenticate({
        userName: passwordUser.userName,
        password: "SyntheticPassw0rd!",
      })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM authn_transactions")
        ?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM web_sessions")?.count
    ).toBe(0);
  });
});
