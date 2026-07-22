import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ApplicationRecord,
  type CreatedApplication,
  Engine,
  FixedClock,
  hashSecret,
  pkceS256,
  SeededRng,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
  type UserRecord,
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

const setup = async (grantTypes: CreatedApplication["grantTypes"]) => {
  const store = new MemorySqlStore();
  stores.push(store);
  const clock = new FixedClock("2026-07-22T12:00:00.000Z");
  const engine = Engine.create(
    { provider: "okta", seed: "okta-m2" },
    { store, clock, rng: new SeededRng("okta-m2") }
  );
  await engine.initialize();
  const user = await engine.users.create({
    id: "00uMockAda",
    userName: "ada@example.com",
    displayName: "Ada Lovelace",
    givenName: "Ada",
    familyName: "Lovelace",
  });
  const group = engine.groups.create({
    id: "00gMockEngineers",
    displayName: "Engineers",
  });
  engine.groups.addMember(group.id, user.id);
  const application = await engine.applications.create({
    name: "Okta target",
    clientId: "0oaMockClient",
    clientSecret: "okta-client-secret",
    redirectUris: ["https://client.example/callback"],
    grantTypes,
  });
  return { store, clock, engine, user, application };
};

const issueAuthorizationCodeTokens = async (input: {
  readonly engine: Engine;
  readonly user: UserRecord;
  readonly application: ApplicationRecord;
  readonly issuer: string;
}) => {
  const verifier = "okta-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE";
  const authorization = await input.engine.oauth.createAuthorizationCode({
    clientId: input.application.clientId,
    redirectUri: "https://client.example/callback",
    userId: input.user.id,
    scope: "openid profile email groups offline_access",
    codeChallenge: await pkceS256(verifier),
    codeChallengeMethod: "S256",
    nonce: "okta-nonce",
  });
  return input.engine.oauth.redeemAuthorizationCode({
    code: authorization.code,
    clientId: input.application.clientId,
    clientSecret: "okta-client-secret",
    redirectUri: "https://client.example/callback",
    codeVerifier: verifier,
    issuerBase: input.issuer,
  });
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Okta OIDC profile", () => {
  it("renders request-derived discovery, scope-aware claims, and native errors", async () => {
    const { engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    expect(engine.discovery(issuer)).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/v1/authorize`,
      token_endpoint: `${issuer}/v1/token`,
      introspection_endpoint: `${issuer}/v1/introspect`,
      revocation_endpoint: `${issuer}/v1/revoke`,
      device_authorization_endpoint: `${issuer}/v1/device/authorize`,
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
    });

    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const accessClaims = await engine.verifyToken(tokens.accessToken, {
      issuer,
      audience: application.clientId,
    });
    expect(accessClaims).toMatchObject({
      iss: issuer,
      aud: application.clientId,
      sub: user.id,
      cid: application.clientId,
      uid: user.id,
      ver: 1,
      scp: ["openid", "profile", "email", "groups", "offline_access"],
      email: "ada@example.com",
      groups: ["Engineers"],
      auth_time: 1_784_721_600,
      acr: "urn:okta:loa:1fa:any",
    });
    expect(accessClaims.jti).toMatch(/^AT\./);
    expect(accessClaims).not.toHaveProperty("token_use");

    const idClaims = await engine.verifyToken(tokens.idToken ?? "", {
      issuer,
      audience: application.clientId,
    });
    expect(idClaims).toMatchObject({
      name: "Ada Lovelace",
      preferred_username: "ada@example.com",
      email: "ada@example.com",
      email_verified: true,
      nonce: "okta-nonce",
      amr: ["pwd"],
      idp: engine.tenantId,
      groups: ["Engineers"],
    });
    expect(idClaims.auth_time).toBe(idClaims.iat);
    expect(idClaims.at_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(idClaims.jti).toMatch(/^ID\./);

    const minimalIdToken = await engine.issueIdToken({
      issuerBase: issuer,
      clientId: application.clientId,
      userId: user.id,
      scopes: ["openid"],
    });
    const minimalClaims = await engine.verifyToken(minimalIdToken);
    expect(minimalClaims).not.toHaveProperty("name");
    expect(minimalClaims).not.toHaveProperty("email");

    const oauthError = engine.renderError("BAD_CLIENT_SECRET", undefined, "oauth");
    expect(oauthError).toMatchObject({
      status: 401,
      headers: { "x-okta-request-id": expect.any(String) },
      body: {
        error: "invalid_client",
        error_description: "Client authentication failed.",
      },
    });
    expect(engine.renderError("BAD_CLIENT_SECRET")).toMatchObject({
      status: 401,
      body: {
        errorCode: "E0000004",
        errorSummary: "Authentication failed",
        errorCauses: [],
      },
    });
    expect(engine.renderError("RATE_LIMITED")).toMatchObject({
      status: 429,
      headers: {
        "x-rate-limit-limit": "60",
        "x-rate-limit-remaining": "0",
        "x-rate-limit-reset": "1784721660",
      },
      body: { errorCode: "E0000047" },
    });
  });

  it("introspects and revokes access and refresh tokens without leaking misses", async () => {
    const { engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const credentials = {
      clientId: application.clientId,
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
    };

    await expect(
      engine.oauth.introspectToken({ token: tokens.accessToken, ...credentials })
    ).resolves.toMatchObject({
      active: true,
      scope: "openid profile email groups offline_access",
      username: "ada@example.com",
      sub: user.id,
      aud: application.clientId,
      iss: issuer,
      token_type: "Bearer",
      client_id: application.clientId,
      uid: user.id,
    });
    await expect(
      engine.oauth.introspectToken({
        token: tokens.refreshToken ?? "",
        tokenTypeHint: "refresh_token",
        ...credentials,
      })
    ).resolves.toMatchObject({ active: true, token_type: "refresh_token" });

    await engine.oauth.revokeToken({ token: tokens.accessToken, ...credentials });
    await expect(
      engine.oauth.introspectToken({ token: tokens.accessToken, ...credentials })
    ).resolves.toEqual({ active: false });
    await expect(
      engine.oauth.revokeToken({ token: "unknown-token", ...credentials })
    ).resolves.toBeUndefined();
    await engine.oauth.revokeToken({
      token: tokens.refreshToken ?? "",
      tokenTypeHint: "refresh_token",
      ...credentials,
    });
    await expect(
      engine.oauth.introspectToken({
        token: tokens.refreshToken ?? "",
        ...credentials,
      })
    ).resolves.toEqual({ active: false });
    await expect(
      engine.oauth.introspectToken({
        token: tokens.refreshToken ?? "",
        ...credentials,
        clientSecret: "wrong-secret",
      })
    ).rejects.toMatchObject({
      code: "BAD_CLIENT_SECRET",
      oauthError: "invalid_client",
    });
  });

  it("rotates refresh tokens with bounded scopes and revokes a replayed family", async () => {
    const { store, clock, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const credentials = {
      clientId: application.clientId,
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
    };
    const initial = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const originalToken = initial.refreshToken ?? "";
    const originalHash = await hashSecret(originalToken);
    const original = store.get<{
      auth_time: number;
      consumed_at: string | null;
      expires_at: string;
      family_id: string;
      generation: number;
      parent_token_hash: string | null;
      replaced_by_hash: string | null;
      revoked_at: string | null;
      token_hash: string;
    }>("SELECT * FROM refresh_tokens WHERE token_hash = ?", originalHash);
    expect(original).toMatchObject({
      token_hash: originalHash,
      auth_time: 1_784_721_600,
      generation: 0,
      parent_token_hash: null,
      replaced_by_hash: null,
      consumed_at: null,
      revoked_at: null,
    });
    expect(original?.token_hash).not.toBe(originalToken);

    clock.advance(60_000);
    const rotated = await engine.oauth.redeemRefreshToken({
      refreshToken: originalToken,
      scope: "openid profile",
      ...credentials,
    });
    expect(rotated).toMatchObject({
      scope: "openid profile",
      tokenType: "Bearer",
    });
    expect(rotated.refreshToken).toMatch(/^refresh_/);
    expect(rotated.refreshToken).not.toBe(originalToken);
    const replacementHash = await hashSecret(rotated.refreshToken ?? "");
    const consumed = store.get<{
      consumed_at: string | null;
      replaced_by_hash: string | null;
    }>(
      "SELECT consumed_at, replaced_by_hash FROM refresh_tokens WHERE token_hash = ?",
      originalHash
    );
    expect(consumed?.consumed_at).toBe("2026-07-22T12:01:00.000Z");
    expect(consumed?.replaced_by_hash).toBe(replacementHash);
    const replacement = store.get<{
      auth_time: number;
      expires_at: string;
      family_id: string;
      generation: number;
      parent_token_hash: string | null;
      scope: string;
      token_hash: string;
    }>("SELECT * FROM refresh_tokens WHERE token_hash = ?", replacementHash);
    expect(replacement).toMatchObject({
      token_hash: replacementHash,
      family_id: original?.family_id,
      auth_time: original?.auth_time,
      generation: 1,
      parent_token_hash: originalHash,
      expires_at: original?.expires_at,
      scope: "openid profile",
    });
    const refreshedClaims = await engine.verifyToken(rotated.idToken ?? "");
    expect(refreshedClaims).toMatchObject({
      auth_time: 1_784_721_600,
      iat: 1_784_721_660,
    });

    await expect(
      engine.oauth.introspectToken({ token: originalToken, ...credentials })
    ).resolves.toEqual({ active: false });
    await expect(
      engine.oauth.introspectToken({
        token: rotated.refreshToken ?? "",
        ...credentials,
      })
    ).resolves.toMatchObject({ active: true, scope: "openid profile" });

    await expect(
      engine.oauth.redeemRefreshToken({
        refreshToken: originalToken,
        ...credentials,
      })
    ).rejects.toMatchObject({
      code: "INVALID_GRANT",
      oauthError: "invalid_grant",
    });
    await expect(
      engine.oauth.introspectToken({
        token: rotated.refreshToken ?? "",
        ...credentials,
      })
    ).resolves.toEqual({ active: false });
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM refresh_tokens
         WHERE family_id = ? AND revoked_at IS NULL`,
        original?.family_id ?? ""
      )?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM oauth_access_tokens
         WHERE family_id = ? AND revoked_at IS NULL`,
        original?.family_id ?? ""
      )?.count
    ).toBe(0);
  });

  it("rejects refresh scope escalation without consuming the token", async () => {
    const { store, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const refreshToken = tokens.refreshToken ?? "";
    const tokenHash = await hashSecret(refreshToken);
    const credentials = {
      clientId: application.clientId,
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
    };
    await expect(
      engine.oauth.redeemRefreshToken({
        refreshToken,
        scope: "openid profile administrator",
        ...credentials,
      })
    ).rejects.toMatchObject({ code: "INVALID_SCOPE", oauthError: "invalid_scope" });
    expect(
      store.get<{ consumed_at: string | null; revoked_at: string | null }>(
        "SELECT consumed_at, revoked_at FROM refresh_tokens WHERE token_hash = ?",
        tokenHash
      )
    ).toEqual({ consumed_at: null, revoked_at: null });
    await expect(
      engine.oauth.redeemRefreshToken({ refreshToken, ...credentials })
    ).resolves.toMatchObject({ refreshToken: expect.stringMatching(/^refresh_/) });
  });

  it("rolls back refresh consumption when replacement persistence fails", async () => {
    const { store, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const refreshToken = tokens.refreshToken ?? "";
    const tokenHash = await hashSecret(refreshToken);
    const credentials = {
      clientId: application.clientId,
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
    };
    const accessCount = store.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM oauth_access_tokens"
    )?.count;
    store.database.exec(`CREATE TRIGGER reject_rotated_refresh
      BEFORE INSERT ON refresh_tokens WHEN NEW.generation > 0
      BEGIN SELECT RAISE(ABORT, 'reject rotated refresh'); END`);
    await expect(
      engine.oauth.redeemRefreshToken({ refreshToken, ...credentials })
    ).rejects.toThrow(/reject rotated refresh/);
    expect(
      store.get<{
        consumed_at: string | null;
        replaced_by_hash: string | null;
        revoked_at: string | null;
      }>(
        `SELECT consumed_at, replaced_by_hash, revoked_at
         FROM refresh_tokens WHERE token_hash = ?`,
        tokenHash
      )
    ).toEqual({ consumed_at: null, replaced_by_hash: null, revoked_at: null });
    expect(
      store.get<{ count: number }>("SELECT COUNT(*) AS count FROM oauth_access_tokens")
        ?.count
    ).toBe(accessCount);
    store.database.exec("DROP TRIGGER reject_rotated_refresh");
    await expect(
      engine.oauth.redeemRefreshToken({ refreshToken, ...credentials })
    ).resolves.toMatchObject({ refreshToken: expect.stringMatching(/^refresh_/) });
  });

  it("serializes concurrent refresh redemption and revokes the replayed family", async () => {
    const { store, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    const refreshToken = tokens.refreshToken ?? "";
    const tokenHash = await hashSecret(refreshToken);
    const familyId = store.get<{ family_id: string }>(
      "SELECT family_id FROM refresh_tokens WHERE token_hash = ?",
      tokenHash
    )?.family_id;
    const input = {
      refreshToken,
      clientId: application.clientId,
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
    };
    const attempts = await Promise.allSettled([
      engine.oauth.redeemRefreshToken(input),
      engine.oauth.redeemRefreshToken(input),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM refresh_tokens
         WHERE family_id = ? AND revoked_at IS NULL`,
        familyId ?? ""
      )?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM oauth_access_tokens
         WHERE family_id = ? AND revoked_at IS NULL`,
        familyId ?? ""
      )?.count
    ).toBe(0);
  });

  it("revokes only effective tokens on suspension and preserves disabled errors", async () => {
    const { clock, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const tokens = await issueAuthorizationCodeTokens({
      engine,
      user,
      application,
      issuer,
    });
    clock.advance(3_601_000);
    expect(engine.lifecycle.apply(user.id, "suspend")).toMatchObject({
      previousState: "active",
      currentState: "suspended",
      changed: true,
      version: 2,
      etag: 'W/"2"',
      revoked: { accessTokens: 0, refreshTokens: 1 },
    });
    await expect(
      engine.oauth.redeemRefreshToken({
        refreshToken: tokens.refreshToken ?? "",
        clientId: application.clientId,
        clientSecret: "okta-client-secret",
        issuerBase: issuer,
      })
    ).rejects.toMatchObject({ code: "USER_DISABLED", oauthError: "invalid_grant" });
    expect(engine.lifecycle.apply(user.id, "unsuspend")).toMatchObject({
      previousState: "suspended",
      currentState: "active",
      revoked: { accessTokens: 0, refreshTokens: 0 },
    });
    await expect(
      engine.oauth.redeemRefreshToken({
        refreshToken: tokens.refreshToken ?? "",
        clientId: application.clientId,
        clientSecret: "okta-client-secret",
        issuerBase: issuer,
      })
    ).rejects.toMatchObject({ code: "INVALID_GRANT" });
  });

  it("rolls back the lifecycle transition when credential revocation fails", async () => {
    const { store, engine, user, application } = await setup([
      "authorization_code",
      "refresh_token",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    await issueAuthorizationCodeTokens({ engine, user, application, issuer });
    store.database.exec(`CREATE TRIGGER reject_refresh_revocation
      BEFORE UPDATE OF revoked_at ON refresh_tokens
      WHEN NEW.revoked_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'reject refresh revocation'); END`);

    expect(() => engine.lifecycle.apply(user.id, "suspend")).toThrow(
      /reject refresh revocation/
    );
    expect(engine.users.requireById(user.id)).toMatchObject({
      lifecycleState: "active",
      accountEnabled: true,
      resourceVersion: 1,
    });
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM oauth_access_tokens
         WHERE user_id = ? AND revoked_at IS NOT NULL`,
        user.id
      )?.count
    ).toBe(0);
    expect(
      store.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM refresh_tokens
         WHERE user_id = ? AND revoked_at IS NOT NULL`,
        user.id
      )?.count
    ).toBe(0);

    store.database.exec("DROP TRIGGER reject_refresh_revocation");
    expect(engine.lifecycle.apply(user.id, "suspend")).toMatchObject({
      currentState: "suspended",
      revoked: { accessTokens: 1, refreshTokens: 1 },
    });
  });
});

describe("Okta device authorization", () => {
  it("models pending, slow-down, activation, denial, expiry, and one-time use", async () => {
    const { store, clock, engine, user, application } = await setup([
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
    ]);
    const issuer = "https://id.mockos.test/e/acme/oauth2/default";
    const authorization = await engine.oauth.createDeviceAuthorization({
      clientId: application.clientId,
      scope: "openid profile offline_access",
      issuerBase: issuer,
    });
    expect(authorization).toMatchObject({
      expiresIn: 600,
      interval: 5,
      verificationUri: "https://id.mockos.test/e/acme/activate",
    });
    expect(authorization.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{8}$/);
    expect(authorization.verificationUriComplete).toBe(
      `${authorization.verificationUri}?user_code=${authorization.userCode}`
    );
    expect(
      store.get<{ code_hash: string }>(
        "SELECT code_hash FROM device_codes WHERE user_code = ?",
        authorization.userCode
      )?.code_hash
    ).not.toBe(authorization.deviceCode);

    const poll = () =>
      engine.oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: authorization.deviceCode,
        issuerBase: issuer,
      });
    await expect(poll()).rejects.toMatchObject({
      error: "authorization_pending",
      errorDescription: "The device authorization is pending. Please try again later.",
    });
    await expect(poll()).rejects.toMatchObject({ error: "slow_down" });
    engine.oauth.activateDeviceAuthorization(authorization.userCode, user.id);
    clock.advance(10_000);
    const tokens = await poll();
    expect(tokens).toMatchObject({
      scope: "openid profile offline_access",
      tokenType: "Bearer",
    });
    expect(tokens.refreshToken).toMatch(/^refresh_/);
    await expect(poll()).rejects.toMatchObject({ error: "invalid_grant" });

    const denied = await engine.oauth.createDeviceAuthorization({
      clientId: application.clientId,
      scope: "openid",
      issuerBase: issuer,
    });
    engine.oauth.denyDeviceAuthorization(denied.userCode);
    await expect(
      engine.oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: denied.deviceCode,
        issuerBase: issuer,
      })
    ).rejects.toMatchObject({ error: "access_denied" });

    const expired = await engine.oauth.createDeviceAuthorization({
      clientId: application.clientId,
      scope: "openid",
      issuerBase: issuer,
    });
    clock.advance(601_000);
    await expect(
      engine.oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: expired.deviceCode,
        issuerBase: issuer,
      })
    ).rejects.toMatchObject({ error: "expired_token" });
  });
});
