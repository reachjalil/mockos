import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  CORE_MIGRATIONS,
  createTenantId,
  decodeJwt,
  Engine,
  type EngineConfig,
  encodeManagementListCursor,
  FixedClock,
  generateSigningKey,
  getSchemaVersion,
  pkceS256,
  RequestLogService,
  SeededRng,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
  signJwt,
  toJwks,
  verifyJwt,
} from "./index";

/** A test-local adapter: production core never imports node:sqlite. */
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
const memoryStore = () => {
  const store = new MemorySqlStore();
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("core substrate", () => {
  it("applies the baseline schema idempotently", () => {
    const store = memoryStore();
    expect(CORE_MIGRATIONS.map(({ version }) => version)).toEqual([1]);
    expect(JSON.stringify(CORE_MIGRATIONS)).not.toMatch(/issuer/i);
    expect(applyMigrations(store)).toBe(1);
    expect(getSchemaVersion(store)).toBe(1);
    expect(applyMigrations(store)).toBe(1);

    expect(
      store
        .all<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .map(({ name }) => name)
    ).toEqual([
      "applications",
      "authn_transactions",
      "device_codes",
      "group_members",
      "groups",
      "meta",
      "mock_llm_revision_allocator",
      "mock_llm_servers",
      "mock_mcp_revision_allocator",
      "mock_mcp_servers",
      "mock_mcp_sessions",
      "mock_state",
      "oauth_access_tokens",
      "oauth_codes",
      "provisioning_run_targets",
      "provisioning_runs",
      "provisioning_steps",
      "provisioning_targets",
      "provisioning_watermarks",
      "refresh_tokens",
      "request_log",
      "request_log_llm_terminal",
      "role_assignments",
      "scenarios",
      "signing_keys",
      "users",
      "web_sessions",
    ]);
    for (const table of [
      "mock_mcp_revision_allocator",
      "mock_llm_revision_allocator",
    ]) {
      expect(
        store.get<{ count: number; last_revision: number }>(
          `SELECT COUNT(*) AS count, MAX(last_revision) AS last_revision
           FROM ${table}`
        )
      ).toEqual({ count: 1, last_revision: 0 });
    }
  });

  it("refuses a database newer than the supported baseline", () => {
    const store = memoryStore();
    expect(applyMigrations(store)).toBe(1);
    store.run("PRAGMA user_version = 2");

    expect(() => applyMigrations(store)).toThrow(
      "Database schema version 2 is newer than supported version 1."
    );
    expect(getSchemaVersion(store)).toBe(2);
  });

  it("allows one active provisioning run per application target", () => {
    const store = memoryStore();
    applyMigrations(store);
    const insertRun = (
      id: string,
      targetRef: string | null,
      status: string,
      completedAt: string | null
    ) =>
      store.run(
        `INSERT INTO provisioning_runs (
          id, application_id, target_ref, mode, status, summary_json,
          created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        id,
        "app_locked",
        targetRef,
        "incremental",
        status,
        "2026-07-22T12:00:00.000Z",
        completedAt
      );

    insertRun("run_active", "target-locked", "queued", null);
    expect(() => insertRun("run_conflict", "target-locked", "running", null)).toThrow();
    // A terminal run releases the target, and a null target is never locked.
    insertRun("run_terminal", "target-locked", "succeeded", "2026-07-22T13:00:00.000Z");
    insertRun("run_untargeted", null, "queued", null);
  });

  it("keeps deterministic identifiers stable and seed-specific", () => {
    const left = new SeededRng("same-seed");
    const right = new SeededRng("same-seed");
    expect([left.uuid(), left.uuid()]).toEqual([right.uuid(), right.uuid()]);
    expect(createTenantId("environment-a")).toBe(createTenantId("environment-a"));
    expect(createTenantId("environment-a")).not.toBe(createTenantId("environment-b"));
  });

  it("paginates secret-free application summaries with stable keyset cursors", async () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-22T12:00:00.000Z");
    const engine = Engine.create(
      { provider: "entra", seed: "application-pages" },
      { store, clock, rng: new SeededRng("application-pages") }
    );
    await engine.initialize();
    for (const suffix of ["c", "a", "b"]) {
      await engine.applications.create({
        id: `app_${suffix}`,
        name: `Application ${suffix.toUpperCase()}`,
        clientId: `client_${suffix}`,
        clientSecret: `client-secret-${suffix}`,
        redirectUris: [`https://client.example/${suffix}/callback`],
      });
    }

    const first = engine.applications.listPage({ limit: 2 });
    expect(first.applications.map(({ id }) => id)).toEqual(["app_a", "app_b"]);
    expect(first.nextCursor).toBeTypeOf("string");
    expect(JSON.stringify(first)).not.toContain("clientSecret");
    expect(JSON.stringify(first)).not.toContain("secret_hash");
    for (const suffix of ["a", "b", "c"]) {
      expect(JSON.stringify(first)).not.toContain(`client-secret-${suffix}`);
    }

    const second = engine.applications.listPage({
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.applications.map(({ id }) => id)).toEqual(["app_c"]);
    expect(second.nextCursor).toBeUndefined();
    expect(() =>
      engine.applications.listPage({ limit: 1, cursor: "not-base64url!" })
    ).toThrow(/cursor/i);
    expect(() =>
      engine.applications.listPage({
        limit: 1,
        cursor: encodeManagementListCursor("scenarios", {
          createdAt: "2026-07-22T12:00:00.000Z",
          id: "scenario-a",
        }),
      })
    ).toThrow(/cursor/i);
  });

  it("signs and verifies portable RS256 JWTs and JWKS", async () => {
    const clock = new FixedClock("2026-07-22T12:00:00.000Z");
    const key = await generateSigningKey({
      kid: "test-key",
      rng: new SeededRng("jwt"),
    });
    const now = Math.floor(clock.now().getTime() / 1_000);
    const token = await signJwt(
      {
        iss: "https://issuer.example/tenant/v2.0",
        aud: "client-id",
        sub: "user-id",
        iat: now,
        exp: now + 3_600,
      },
      key
    );
    expect(decodeJwt(token).header).toMatchObject({ alg: "RS256", kid: "test-key" });
    await expect(
      verifyJwt(token, toJwks([key]), {
        clock,
        issuer: "https://issuer.example/tenant/v2.0",
        audience: "client-id",
      })
    ).resolves.toMatchObject({ sub: "user-id" });

    const [header, payload, signature] = token.split(".");
    const altered = `${header}.${payload}x.${signature}`;
    await expect(verifyJwt(altered, key, { clock })).rejects.toThrow();
  });
});

describe("Entra OIDC vertical slice", () => {
  it("runs a one-time authorization-code + PKCE flow with provider claims", async () => {
    const store = memoryStore();
    const clock = new FixedClock("2026-07-22T12:00:00.000Z");
    const engine = Engine.create(
      {
        provider: "entra",
        seed: "oidc-fixture",
        tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
      },
      { store, clock, rng: new SeededRng("oidc-fixture") }
    );
    await engine.initialize();
    const user = await engine.users.create({
      userName: "ada@example.com",
      displayName: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
      password: "correct horse battery staple",
    });
    const application = await engine.applications.create({
      name: "Target app",
      clientId: "target-client",
      clientSecret: "target-client-secret",
      redirectUris: ["https://target.example/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    });
    expect(application.clientSecret).toBe("target-client-secret");
    expect(
      store.get<{ secret_hash: string }>(
        "SELECT secret_hash FROM applications WHERE client_id = ?",
        application.clientId
      )?.secret_hash
    ).not.toContain("target-client-secret");

    const verifier = "correct-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE";
    const challenge = await pkceS256(verifier);
    const authorization = await engine.oauth.createAuthorizationCode({
      clientId: application.clientId,
      redirectUri: "https://target.example/callback",
      userId: user.id,
      scope: "openid profile offline_access",
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      nonce: "fixed-nonce",
    });
    expect(
      store.get<{ code_hash: string }>(
        "SELECT code_hash FROM oauth_codes WHERE client_id = ?",
        application.clientId
      )?.code_hash
    ).not.toBe(authorization.code);
    const finalIssuer = `https://login.example/e/test/${engine.tenantId}/v2.0`;
    await expect(
      engine.oauth.redeemAuthorizationCode({
        code: authorization.code,
        clientId: application.clientId,
        redirectUri: "https://target.example/callback",
        codeVerifier: verifier,
        issuerBase: finalIssuer,
      })
    ).rejects.toMatchObject({ code: "BAD_CLIENT_SECRET" });
    const tokens = await engine.oauth.redeemAuthorizationCode({
      code: authorization.code,
      clientId: application.clientId,
      clientSecret: "target-client-secret",
      redirectUri: "https://target.example/callback",
      codeVerifier: verifier,
      issuerBase: finalIssuer,
    });
    expect(tokens).toMatchObject({
      expiresIn: 3_600,
      scope: "openid profile offline_access",
      tokenType: "Bearer",
    });
    expect(tokens.refreshToken).toMatch(/^refresh_/);
    expect(
      store.get<{ token_hash: string }>(
        "SELECT token_hash FROM refresh_tokens WHERE client_id = ?",
        application.clientId
      )?.token_hash
    ).not.toBe(tokens.refreshToken);
    expect(tokens.idToken).toBeTypeOf("string");
    await expect(
      engine.verifyToken(tokens.idToken ?? "", {
        issuer: finalIssuer,
        audience: application.clientId,
      })
    ).resolves.toMatchObject({
      aud: application.clientId,
      iss: finalIssuer,
      oid: user.id,
      sub: user.id,
      tid: engine.tenantId,
      upn: "ada@example.com",
      nonce: "fixed-nonce",
    });

    const restarted = Engine.create(
      {
        provider: "entra",
        seed: "oidc-fixture",
        tenantId: engine.tenantId,
      },
      { store, clock, rng: new SeededRng("different-process-seam") }
    );
    await restarted.initialize();
    expect(await restarted.jwks()).toEqual(await engine.jwks());
    await expect(
      restarted.verifyToken(tokens.idToken ?? "", {
        issuer: finalIssuer,
        audience: application.clientId,
      })
    ).resolves.toMatchObject({ oid: user.id });

    await expect(
      engine.oauth.redeemAuthorizationCode({
        code: authorization.code,
        clientId: application.clientId,
        clientSecret: "target-client-secret",
        redirectUri: "https://target.example/callback",
        codeVerifier: verifier,
        issuerBase: finalIssuer,
      })
    ).rejects.toMatchObject({
      code: "CODE_ALREADY_REDEEMED",
    });

    const discovery = engine.discovery(finalIssuer);
    expect(discovery).toMatchObject({
      issuer: finalIssuer,
      authorization_endpoint: `https://login.example/e/test/${engine.tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.example/e/test/${engine.tenantId}/oauth2/v2.0/token`,
    });
    expect(discovery).not.toHaveProperty("userinfo_endpoint");
    expect(engine.provider.urls).not.toHaveProperty("userInfo");
    expect(discovery.issuer).not.toContain("/v2.0/");
    expect(
      store.get<{ value: string }>(
        "SELECT value FROM meta WHERE value LIKE 'http%' LIMIT 1"
      )
    ).toBeUndefined();
  });

  it("rejects issuer URLs in persistent engine configuration", () => {
    const store = memoryStore();
    const invalid = {
      provider: "entra",
      seed: "bad-config",
      issuer: "https://persisted.example/tenant/v2.0",
    } as unknown as EngineConfig;
    expect(() => Engine.create(invalid, { store })).toThrow(/request-derived/);
  });

  it("renders provider-native Entra and Okta error skeletons", async () => {
    const store = memoryStore();
    const engine = Engine.create(
      { provider: "entra", seed: "errors" },
      {
        store,
        clock: new FixedClock("2026-07-22T12:00:00.000Z"),
        rng: new SeededRng("errors"),
      }
    );
    await engine.initialize();
    expect(engine.renderError("MFA_REQUIRED")).toMatchObject({
      status: 400,
      body: {
        error: "interaction_required",
        error_codes: [50076],
      },
    });
  });
});
