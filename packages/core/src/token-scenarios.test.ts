import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brokenTokenClaimOverrides,
  corruptJwtSignature,
  decodeJwt,
  Engine,
  FixedClock,
  importSigningKey,
  pkceS256,
  SeededRng,
  SIGNING_KEY_ROLLBACK_WINDOW_SECONDS,
  SigningKeyService,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
  signJwt,
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
const clock = new FixedClock("2026-07-22T12:00:00.000Z");
const now = Math.floor(clock.now().getTime() / 1_000);
const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";
const issuer = `https://login.mockos.test/e/token-tests/${tenantId}/v2.0`;

const setup = async () => {
  clock.set("2026-07-22T12:00:00.000Z");
  const store = new MemorySqlStore();
  stores.push(store);
  const engine = Engine.create(
    { provider: "entra", seed: "m6-token-tests", tenantId },
    { store, clock, rng: new SeededRng("m6-token-tests") }
  );
  await engine.initialize();
  const user = await engine.users.create({
    id: "usr_token_test",
    userName: "ada@example.test",
    displayName: "Ada Lovelace",
    password: "Passw0rd!",
  });
  const application = await engine.applications.create({
    name: "Token test client",
    clientId: "token-test-client",
    clientSecret: "token-test-secret",
    redirectUris: ["https://client.example/callback"],
    grantTypes: ["authorization_code", "refresh_token"],
    groupClaimsMode: "all",
  });
  return { application, engine, store, user };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("M6 token scenarios", () => {
  it("keeps all five broken-token fixtures deterministic and bounded", async () => {
    expect(
      brokenTokenClaimOverrides("expired", {
        clientId: "client id",
        nowEpochSeconds: now,
      })
    ).toEqual({ iat: now - 3_600, nbf: now - 3_600, exp: now - 60 });
    expect(
      brokenTokenClaimOverrides("wrong_audience", {
        clientId: "client id",
        nowEpochSeconds: now,
      })
    ).toEqual({ aud: "https://wrong-audience.mockos.invalid/client%20id" });
    expect(
      brokenTokenClaimOverrides("not_yet_valid", {
        clientId: "client id",
        nowEpochSeconds: now,
      })
    ).toEqual({ nbf: now + 3_600, exp: now + 7_200 });
    expect(
      brokenTokenClaimOverrides("wrong_issuer", {
        clientId: "client id",
        nowEpochSeconds: now,
      })
    ).toEqual({ iss: "https://wrong-issuer.mockos.invalid" });
    expect(
      brokenTokenClaimOverrides("bad_signature", {
        clientId: "client id",
        nowEpochSeconds: now,
      })
    ).toEqual({});

    const { engine } = await setup();
    const signed = await engine.keys.sign({ sub: "fixture" });
    const corrupted = corruptJwtSignature(signed);
    expect(corrupted).not.toBe(signed);
    expect(corrupted.split(".").slice(0, 2)).toEqual(signed.split(".").slice(0, 2));
    await expect(engine.verifyToken(corrupted)).rejects.toThrow(
      "JWT signature is invalid."
    );
  });

  it("rotates the pre-published next key mid-session and keeps one overlap", async () => {
    const { application, engine, store, user } = await setup();
    const before = await engine.jwks();
    expect(before.keys).toHaveLength(2);
    const oldToken = await engine.issueIdToken({
      issuerBase: issuer,
      clientId: application.clientId,
      userId: user.id,
    });
    const oldKid = decodeJwt(oldToken).header.kid;
    store.database.exec(`CREATE TRIGGER reject_rollover_successor
      BEFORE INSERT ON signing_keys WHEN NEW.status = 'next'
      BEGIN SELECT RAISE(ABORT, 'reject rollover successor'); END`);
    await expect(engine.keys.rotate()).rejects.toThrow("reject rollover successor");
    expect(await engine.jwks()).toEqual(before);
    expect(
      store.all<{ status: string }>("SELECT status FROM signing_keys ORDER BY status")
    ).toEqual([{ status: "active" }, { status: "next" }]);
    store.database.exec("DROP TRIGGER reject_rollover_successor");

    const verifier = "m6-rotation-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const authorization = await engine.oauth.createAuthorizationCode({
      clientId: application.clientId,
      redirectUri: "https://client.example/callback",
      userId: user.id,
      scope: "openid profile",
      codeChallenge: await pkceS256(verifier),
      codeChallengeMethod: "S256",
    });
    engine.setScenario({
      id: "rotate-during-code-session",
      injectionPoint: "token.before_sign",
      action: { type: "rotate_signing_key" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const tokens = await engine.oauth.redeemAuthorizationCode({
      code: authorization.code,
      clientId: application.clientId,
      clientSecret: "token-test-secret",
      redirectUri: "https://client.example/callback",
      codeVerifier: verifier,
      issuerBase: issuer,
    });
    const newKid = decodeJwt(tokens.idToken ?? "").header.kid;
    expect(newKid).not.toBe(oldKid);
    expect(before.keys.map(({ kid }) => kid)).toContain(newKid);

    const after = await engine.jwks();
    expect(after.keys).toHaveLength(3);
    expect(after.keys.map(({ kid }) => kid)).toEqual(
      expect.arrayContaining([oldKid, newKid])
    );
    await expect(engine.verifyToken(oldToken)).resolves.toMatchObject({ sub: user.id });
    await expect(
      engine.verifyToken(tokens.idToken ?? "", {
        clockToleranceSeconds: SIGNING_KEY_ROLLBACK_WINDOW_SECONDS,
      })
    ).resolves.toMatchObject({ sub: user.id });
    const firstRing = store.all<{
      kid: string;
      status: string;
      private_jwk: string;
      retired_at: string | null;
    }>(
      `SELECT kid, status, private_jwk, retired_at
       FROM signing_keys ORDER BY status, retired_at, kid`
    );
    expect(firstRing).toEqual(
      expect.arrayContaining([
        {
          kid: oldKid,
          status: "next",
          private_jwk: "{}",
          retired_at: "2026-07-22T12:00:00.000Z",
        },
        expect.objectContaining({
          kid: newKid,
          status: "active",
          retired_at: null,
        }),
        expect.objectContaining({ status: "next", retired_at: null }),
      ])
    );
    expect(
      firstRing
        .filter(({ status, retired_at }) => status === "next" && !retired_at)
        .every(({ private_jwk }) => JSON.parse(private_jwk).d)
    ).toBe(true);

    // The overlap is encoded as legacy-visible `next`, so the previous v5
    // JWKS query continues publishing the old kid throughout the rollback window.
    expect(
      store
        .all<{ kid: string }>(
          "SELECT kid FROM signing_keys WHERE status IN ('active', 'next')"
        )
        .map(({ kid }) => kid)
    ).toContain(oldKid);

    // Exercise the exact schema-v5 active-key read used by the previous code.
    // A deployment rollback can still import and sign with the promoted active
    // key while its unchanged JWKS query publishes active, successor, and overlap.
    const legacyActive = store.get<{
      kid: string;
      private_jwk: string;
      public_jwk: string;
    }>(
      `SELECT kid, public_jwk, private_jwk FROM signing_keys
       WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    expect(legacyActive?.kid).toBe(newKid);
    if (!legacyActive) throw new Error("Expected the schema-v5 active key.");
    const rollbackToken = await signJwt(
      { sub: "schema-v5-rollback" },
      await importSigningKey({
        publicJwk: JSON.parse(legacyActive.public_jwk),
        privateJwk: JSON.parse(legacyActive.private_jwk),
      })
    );
    await expect(engine.verifyToken(rollbackToken)).resolves.toMatchObject({
      sub: "schema-v5-rollback",
    });

    await expect(engine.keys.rotate()).rejects.toThrow(
      "Signing key rotation is gated until 2026-07-23T14:00:00.000Z."
    );
    clock.advance(SIGNING_KEY_ROLLBACK_WINDOW_SECONDS * 1_000);
    await engine.keys.rotate();
    const secondWindow = await engine.jwks();
    expect(secondWindow.keys).toHaveLength(3);
    expect(secondWindow.keys.map(({ kid }) => kid)).not.toContain(oldKid);
    expect(secondWindow.keys.map(({ kid }) => kid)).toContain(newKid);
    await expect(engine.verifyToken(oldToken)).rejects.toThrow(
      "JWT kid is not recognized."
    );
    await expect(
      engine.verifyToken(tokens.idToken ?? "", {
        clockToleranceSeconds: SIGNING_KEY_ROLLBACK_WINDOW_SECONDS,
      })
    ).resolves.toMatchObject({ sub: user.id });

    const secondRing = store.all<{
      kid: string;
      status: string;
      private_jwk: string;
    }>("SELECT kid, status, private_jwk FROM signing_keys ORDER BY status, kid");
    expect(secondRing).toHaveLength(4);
    expect(
      secondRing
        .filter(({ status }) => status === "retired")
        .every(({ private_jwk }) => private_jwk === "{}")
    ).toBe(true);
    expect(
      secondRing
        .filter(({ status }) => status === "next")
        .some(({ kid, private_jwk }) => kid === newKid && private_jwk === "{}")
    ).toBe(true);

    clock.advance(SIGNING_KEY_ROLLBACK_WINDOW_SECONDS * 1_000);
    await engine.keys.rotate();
    const boundedRing = store.all<{
      kid: string;
      status: string;
      private_jwk: string;
    }>("SELECT kid, status, private_jwk FROM signing_keys ORDER BY status, kid");
    expect(boundedRing).toHaveLength(4);
    expect(boundedRing.map(({ kid }) => kid)).not.toContain(oldKid);
    expect(
      boundedRing
        .filter(({ status }) => status === "retired" || status === "next")
        .filter(({ private_jwk }) => private_jwk === "{}")
    ).toHaveLength(2);
  });

  it("refreshes the active kid across services sharing one persistent store", async () => {
    const { engine, store } = await setup();
    const peer = new SigningKeyService(
      store,
      clock,
      new SeededRng("m6-shared-signing-service")
    );
    await expect(peer.initialize()).resolves.toBeUndefined();
    const originalKid = decodeJwt(await peer.sign({ sub: "before" })).header.kid;

    await engine.keys.rotate();
    clock.advance(SIGNING_KEY_ROLLBACK_WINDOW_SECONDS * 1_000);
    await engine.keys.rotate();

    const token = await peer.sign({ sub: "after" });
    const currentKid = decodeJwt(token).header.kid;
    expect(currentKid).not.toBe(originalKid);
    expect((await engine.jwks()).keys.map(({ kid }) => kid)).toContain(currentKid);
    await expect(peer.verify(token)).resolves.toMatchObject({ sub: "after" });
    expect(
      store.get<{ status: string }>(
        "SELECT status FROM signing_keys WHERE kid = ?",
        originalKid
      )?.status
    ).toBe("retired");
  });

  it("retries when rotation wins the sign/post-sign publication race", async () => {
    const { engine } = await setup();
    const oldKid = decodeJwt(await engine.keys.sign({ sub: "baseline" })).header.kid;
    let releaseFirstSignature: (() => void) | undefined;
    let markFirstSignatureStarted: (() => void) | undefined;
    const firstSignatureStarted = new Promise<void>((resolve) => {
      markFirstSignatureStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirstSignature = resolve;
    });
    const nativeSign = crypto.subtle.sign.bind(crypto.subtle);
    let first = true;
    const signSpy = vi
      .spyOn(crypto.subtle, "sign")
      .mockImplementation(async (algorithm, key, data) => {
        if (first) {
          first = false;
          markFirstSignatureStarted?.();
          await release;
        }
        return nativeSign(algorithm, key, data);
      });
    try {
      const pending = engine.keys.sign({ sub: "interleaved" });
      await firstSignatureStarted;
      const rotation = await engine.keys.rotate();
      releaseFirstSignature?.();
      const token = await pending;
      expect(decodeJwt(token).header.kid).toBe(rotation.activeKid);
      expect(decodeJwt(token).header.kid).not.toBe(oldKid);
      await expect(engine.keys.verify(token)).resolves.toMatchObject({
        sub: "interleaved",
      });
    } finally {
      releaseFirstSignature?.();
      signSpy.mockRestore();
    }
  });

  it("skews only JWT temporal claims and leaves grant persistence on the clock", async () => {
    const { application, engine, store, user } = await setup();
    const verifier = "m6-skew-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-AB";
    const authorization = await engine.oauth.createAuthorizationCode({
      clientId: application.clientId,
      redirectUri: "https://client.example/callback",
      userId: user.id,
      scope: "openid profile",
      codeChallenge: await pkceS256(verifier),
      codeChallengeMethod: "S256",
    });
    engine.setScenario({
      id: "future-token-clock",
      injectionPoint: "token.before_sign",
      action: { type: "token_clock_skew", seconds: 300 },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const tokens = await engine.oauth.redeemAuthorizationCode({
      code: authorization.code,
      clientId: application.clientId,
      clientSecret: "token-test-secret",
      redirectUri: "https://client.example/callback",
      codeVerifier: verifier,
      issuerBase: issuer,
    });
    const claims = decodeJwt(tokens.accessToken).payload;
    expect(claims).toMatchObject({
      iat: now + 300,
      nbf: now + 300,
      exp: now + 3_900,
    });
    expect(
      store.get<{ issued_at: string; expires_at: string }>(
        "SELECT issued_at, expires_at FROM oauth_access_tokens LIMIT 1"
      )
    ).toEqual({
      issued_at: "2026-07-22T12:00:00.000Z",
      expires_at: "2026-07-22T13:00:00.000Z",
    });
    await expect(engine.verifyToken(tokens.accessToken)).rejects.toThrow(
      "JWT is not active yet."
    );
    await expect(
      engine.verifyToken(tokens.accessToken, { clockToleranceSeconds: 300 })
    ).resolves.toMatchObject({ sub: user.id });
    expect(clock.now().toISOString()).toBe("2026-07-22T12:00:00.000Z");
  });

  it("switches from 200 inline groups to a same-origin Graph claim source at 201", async () => {
    const { application, engine, store, user } = await setup();
    const groups = Array.from(
      { length: 201 },
      (_, index) => `grp_${String(index + 1).padStart(3, "0")}`
    );
    const inline = decodeJwt(
      await engine.issueIdToken({
        issuerBase: issuer,
        graphBaseUrl: "https://login.mockos.test/e/token-tests/graph/v1.0",
        clientId: application.clientId,
        userId: user.id,
        groups: groups.slice(0, 200),
      })
    ).payload;
    expect(inline.groups).toEqual(groups.slice(0, 200));
    expect(inline).not.toHaveProperty("_claim_names");

    const overage = decodeJwt(
      await engine.issueIdToken({
        issuerBase: issuer,
        graphBaseUrl: "https://login.mockos.test/e/token-tests/graph/v1.0",
        clientId: application.clientId,
        userId: user.id,
        groups,
      })
    ).payload;
    expect(overage).not.toHaveProperty("groups");
    expect(overage).toMatchObject({
      _claim_names: { groups: "src1" },
      _claim_sources: {
        src1: {
          endpoint:
            "https://login.mockos.test/e/token-tests/graph/v1.0/users/usr_token_test/getMemberObjects",
        },
      },
    });

    const loopbackOverage = decodeJwt(
      await engine.issueIdToken({
        issuerBase: issuer,
        graphBaseUrl: "http://127.42.19.7:8787/graph/v1.0",
        clientId: application.clientId,
        userId: user.id,
        groups,
      })
    ).payload;
    expect(loopbackOverage).toMatchObject({
      _claim_sources: {
        src1: {
          endpoint:
            "http://127.42.19.7:8787/graph/v1.0/users/usr_token_test/getMemberObjects",
        },
      },
    });

    for (const graphBaseUrl of [
      "ftp://localhost:8787/graph/v1.0",
      "ws://127.0.0.1:8787/graph/v1.0",
      "http://graph.mockos.example/graph/v1.0",
    ]) {
      await expect(
        engine.issueIdToken({
          issuerBase: issuer,
          graphBaseUrl,
          clientId: application.clientId,
          userId: user.id,
          groups,
        })
      ).rejects.toThrow("trusted URL");
    }

    store.run(
      "UPDATE applications SET group_claims_mode = 'none' WHERE client_id = ?",
      application.clientId
    );
    const disabled = decodeJwt(
      await engine.issueIdToken({
        issuerBase: issuer,
        graphBaseUrl: "https://login.mockos.test/e/token-tests/graph/v1.0",
        clientId: application.clientId,
        userId: user.id,
        groups,
      })
    ).payload;
    expect(disabled).not.toHaveProperty("groups");
    expect(disabled).not.toHaveProperty("_claim_names");
  });

  it("probes at most 201 membership IDs when deriving Entra overage claims", async () => {
    const { application, engine, store, user } = await setup();
    for (let index = 1; index <= 202; index += 1) {
      engine.groups.create({
        id: `grp_bounded_${String(index).padStart(3, "0")}`,
        displayName: `Bounded Group ${String(index).padStart(3, "0")}`,
        memberIds: [user.id],
      });
    }
    expect(
      store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM group_members WHERE user_id = ?",
        user.id
      )
    ).toEqual({ count: 202 });
    expect(() => engine.groups.listIdsForUser(user.id, 1_002)).toThrow(
      "integer from 1 through 1001"
    );

    const allSpy = vi.spyOn(store, "all");
    const token = await engine.issueIdToken({
      issuerBase: issuer,
      graphBaseUrl: "https://login.mockos.test/e/token-tests/graph/v1.0",
      clientId: application.clientId,
      userId: user.id,
    });
    const idOnlyMembershipRead = allSpy.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("SELECT g.id")
    );
    expect(idOnlyMembershipRead?.slice(1)).toEqual([user.id, 201]);
    expect(decodeJwt(token).payload).toMatchObject({
      _claim_names: { groups: "src1" },
    });

    allSpy.mockClear();
    const verifier = "m6-bounded-groups-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const authorization = await engine.oauth.createAuthorizationCode({
      clientId: application.clientId,
      redirectUri: "https://client.example/callback",
      userId: user.id,
      scope: "openid groups",
      codeChallenge: await pkceS256(verifier),
      codeChallengeMethod: "S256",
    });
    const tokens = await engine.oauth.redeemAuthorizationCode({
      code: authorization.code,
      clientId: application.clientId,
      clientSecret: "token-test-secret",
      redirectUri: "https://client.example/callback",
      codeVerifier: verifier,
      issuerBase: issuer,
      graphBaseUrl: "https://login.mockos.test/e/token-tests/graph/v1.0",
    });
    const oauthMembershipRead = allSpy.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("SELECT g.id")
    );
    expect(oauthMembershipRead?.slice(1)).toEqual([user.id, 201]);
    expect(decodeJwt(tokens.idToken ?? "").payload).toMatchObject({
      _claim_names: { groups: "src1" },
    });
  });
});
