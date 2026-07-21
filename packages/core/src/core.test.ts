import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  CORE_MIGRATIONS,
  createTenantId,
  decodeJwt,
  Engine,
  type EngineConfig,
  FixedClock,
  generateSigningKey,
  getSchemaVersion,
  pkceS256,
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
  it("applies ordered PRAGMA user_version migrations idempotently", () => {
    const store = memoryStore();
    expect(CORE_MIGRATIONS.map(({ version }) => version)).toEqual([1]);
    expect(JSON.stringify(CORE_MIGRATIONS)).not.toMatch(/issuer/i);
    expect(applyMigrations(store)).toBe(1);
    expect(getSchemaVersion(store)).toBe(1);
    expect(applyMigrations(store)).toBe(1);
    expect(
      store.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oauth_codes'"
      )?.name
    ).toBe("oauth_codes");
  });

  it("keeps deterministic identifiers stable and seed-specific", () => {
    const left = new SeededRng("same-seed");
    const right = new SeededRng("same-seed");
    expect([left.uuid(), left.uuid()]).toEqual([right.uuid(), right.uuid()]);
    expect(createTenantId("environment-a")).toBe(createTenantId("environment-a"));
    expect(createTenantId("environment-a")).not.toBe(createTenantId("environment-b"));
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
