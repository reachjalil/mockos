import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApplicationRepository,
  applyMigrations,
  DeviceAuthorizationError,
  decodeJwt,
  FixedClock,
  GroupRepository,
  getProviderProfile,
  OAuthService,
  SeededRng,
  SigningKeyService,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
  UserRepository,
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
const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";
const directoryBaseUrl = "https://login.mockos.test/e/device-tests";
const issuerBase = `${directoryBaseUrl}/${tenantId}/v2.0`;
const graphBaseUrl = `${directoryBaseUrl}/graph/v1.0`;
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code" as const;

const setup = async (options: {
  readonly clientType?: "public" | "confidential";
  readonly grantTypes?: readonly (
    | "authorization_code"
    | "refresh_token"
    | "client_credentials"
    | typeof deviceGrant
  )[];
  readonly beforeTokenSign?: () => Promise<{
    readonly clockSkewSeconds?: number;
  }>;
  readonly seed?: string;
}) => {
  const seed = options.seed ?? "entra-device-core";
  const store = new MemorySqlStore();
  stores.push(store);
  applyMigrations(store);
  const clock = new FixedClock("2026-07-26T12:00:00.000Z");
  const rng = new SeededRng(seed);
  const applications = new ApplicationRepository(store, clock, rng);
  const users = new UserRepository(store, clock, rng);
  const groups = new GroupRepository(store, clock, rng);
  const keys = new SigningKeyService(store, clock, rng);
  await keys.initialize();
  const user = await users.create({
    id: "usr_device_ada",
    userName: "ada@example.test",
    displayName: "Ada Lovelace",
  });
  const clientType = options.clientType ?? "public";
  const application = await applications.create({
    id: "app_device_client",
    name: "Device client",
    clientId: "device-client",
    clientType,
    ...(clientType === "confidential" ? { clientSecret: "device-client-secret" } : {}),
    redirectUris: ["https://client.example/callback"],
    grantTypes: options.grantTypes ?? [deviceGrant, "refresh_token"],
    groupClaimsMode: "all",
  });
  const oauth = new OAuthService({
    store,
    clock,
    rng,
    tenantId,
    profile: getProviderProfile("entra"),
    applications,
    users,
    groups,
    keys,
    ...(options.beforeTokenSign ? { beforeTokenSign: options.beforeTokenSign } : {}),
  });
  return {
    application,
    applications,
    clock,
    groups,
    oauth,
    store,
    user,
    users,
  };
};

const createAuthorization = (
  oauth: OAuthService,
  clientId = "device-client",
  scope = "openid profile offline_access"
) =>
  oauth.createDeviceAuthorization({
    clientId,
    scope,
    issuerBase,
    directoryBaseUrl,
  });

const deviceStatus = (store: SqlStore, userCode: string) =>
  store.get<{ consumed_at: string | null; status: string }>(
    "SELECT consumed_at, status FROM device_codes WHERE user_code = ?",
    userCode
  );

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("provider-owned device authorization policy", () => {
  it("projects the Entra device endpoint and public-client response policy", () => {
    const profile = getProviderProfile("entra");
    const context = { directoryBaseUrl, issuerBase, tenantId };

    expect(profile.urls.deviceAuthorization?.(context)).toBe(
      `${directoryBaseUrl}/${tenantId}/oauth2/v2.0/devicecode`
    );
    expect(profile.urls.activation?.(context)).toBe(`${directoryBaseUrl}/devicelogin`);
    expect(profile.discovery(context)).toMatchObject({
      device_authorization_endpoint: `${directoryBaseUrl}/${tenantId}/oauth2/v2.0/devicecode`,
      grant_types_supported: ["authorization_code", "refresh_token", deviceGrant],
    });
    expect(profile.deviceAuthorizationPolicy).toEqual({
      lifetimeSeconds: 900,
      intervalSeconds: 5,
      includeVerificationUriComplete: false,
      allowedClientTypes: ["public"],
    });
    expect(() =>
      profile.urls.activation?.({
        issuerBase,
        tenantId,
      })
    ).toThrow(/trusted directory base/i);
  });

  it("preserves Okta device timing, complete URI, and confidential compatibility", () => {
    const profile = getProviderProfile("okta");
    expect(profile.deviceAuthorizationPolicy).toEqual({
      lifetimeSeconds: 600,
      intervalSeconds: 5,
      includeVerificationUriComplete: true,
      allowedClientTypes: ["public", "confidential"],
    });
  });
});

describe("Entra device authorization", () => {
  it("handles pending, slow-down, approval, denial, expiry, and one-time use", async () => {
    const { application, clock, oauth, store, user } = await setup({});
    const authorization = await createAuthorization(oauth);

    expect(authorization).toMatchObject({
      expiresIn: 900,
      interval: 5,
      verificationUri: `${directoryBaseUrl}/devicelogin`,
    });
    expect(authorization).not.toHaveProperty("verificationUriComplete");
    expect(authorization.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{8}$/);
    const persisted = store.get<{ code_hash: string; user_code: string }>(
      "SELECT code_hash, user_code FROM device_codes WHERE user_code = ?",
      authorization.userCode
    );
    expect(persisted).toMatchObject({ user_code: authorization.userCode });
    expect(persisted?.code_hash).not.toBe(authorization.deviceCode);
    expect(JSON.stringify(persisted)).not.toContain(authorization.deviceCode);

    const poll = () =>
      oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: authorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      });
    await expect(poll()).rejects.toMatchObject({
      error: "authorization_pending",
    });
    await expect(poll()).rejects.toMatchObject({ error: "slow_down" });
    oauth.activateDeviceAuthorization(authorization.userCode, user.id);
    clock.advance(10_000);
    const tokens = await poll();
    expect(tokens).toMatchObject({
      expiresIn: 3_600,
      scope: "openid profile offline_access",
      tokenType: "Bearer",
    });
    const accessTokenId = decodeJwt(tokens.accessToken).payload.uti;
    expect(accessTokenId).toEqual(expect.any(String));
    const refreshed = await oauth.redeemRefreshToken({
      clientId: application.clientId,
      refreshToken: tokens.refreshToken ?? "",
      issuerBase,
      graphBaseUrl,
    });
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
    expect(decodeJwt(refreshed.accessToken).payload.uti).not.toBe(accessTokenId);
    expect(deviceStatus(store, authorization.userCode)).toMatchObject({
      status: "consumed",
    });
    await expect(poll()).rejects.toMatchObject({ error: "invalid_grant" });

    const denied = await createAuthorization(oauth);
    oauth.denyDeviceAuthorization(denied.userCode);
    await expect(
      oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: denied.deviceCode,
        issuerBase,
      })
    ).rejects.toMatchObject({ error: "access_denied" });

    const expired = await createAuthorization(oauth);
    clock.advance(901_000);
    await expect(
      oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: expired.deviceCode,
        issuerBase,
      })
    ).rejects.toMatchObject({ error: "expired_token" });
    expect(() => oauth.activateDeviceAuthorization(expired.userCode, user.id)).toThrow(
      DeviceAuthorizationError
    );
  });

  it("rejects unknown, wrong, unregistered, and confidential Entra clients", async () => {
    const { application, applications, oauth, user } = await setup({});
    const authorization = await createAuthorization(oauth);
    oauth.activateDeviceAuthorization(authorization.userCode, user.id);
    await applications.create({
      id: "app_wrong_client",
      name: "Wrong public client",
      clientId: "wrong-client",
      clientType: "public",
      redirectUris: ["https://wrong.example/callback"],
      grantTypes: [deviceGrant],
    });

    await expect(createAuthorization(oauth, "unknown-client")).rejects.toMatchObject({
      error: "invalid_client",
    });
    await expect(
      oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: "device_missing",
        issuerBase,
      })
    ).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(
      createAuthorization(oauth, application.clientId, "   ")
    ).rejects.toMatchObject({
      error: "invalid_scope",
    });
    await expect(
      oauth.pollDeviceAuthorization({
        clientId: "wrong-client",
        deviceCode: authorization.deviceCode,
        issuerBase,
      })
    ).rejects.toMatchObject({ error: "invalid_grant" });

    const withoutGrant = await setup({
      grantTypes: ["authorization_code"],
      seed: "entra-device-no-grant",
    });
    await expect(createAuthorization(withoutGrant.oauth)).rejects.toMatchObject({
      error: "unsupported_grant_type",
    });

    const confidential = await setup({
      clientType: "confidential",
      seed: "entra-device-confidential",
    });
    await expect(createAuthorization(confidential.oauth)).rejects.toMatchObject({
      error: "invalid_client",
      errorDescription:
        "Microsoft Entra ID does not allow confidential clients to use device authorization.",
    });
    await expect(
      confidential.oauth.pollDeviceAuthorization({
        clientId: confidential.application.clientId,
        deviceCode: authorization.deviceCode,
        issuerBase,
      })
    ).rejects.toMatchObject({ error: "invalid_client" });

    expect(application.clientType).toBe("public");
  });

  it("carries the trusted Graph base into Entra group-overage tokens", async () => {
    const { application, groups, oauth, user } = await setup({
      seed: "entra-device-overage",
    });
    for (let index = 0; index <= 200; index += 1) {
      groups.create({
        id: `grp_device_${String(index).padStart(3, "0")}`,
        displayName: `Device group ${String(index).padStart(3, "0")}`,
        memberIds: [user.id],
      });
    }
    const authorization = await createAuthorization(oauth);
    oauth.activateDeviceAuthorization(authorization.userCode, user.id);

    await expect(
      oauth.pollDeviceAuthorization({
        clientId: application.clientId,
        deviceCode: authorization.deviceCode,
        issuerBase,
      })
    ).rejects.toThrow(/trusted Graph base/i);
    const tokens = await oauth.pollDeviceAuthorization({
      clientId: application.clientId,
      deviceCode: authorization.deviceCode,
      issuerBase,
      graphBaseUrl,
    });
    expect(decodeJwt(tokens.accessToken).payload).toMatchObject({
      _claim_names: { groups: "src1" },
      _claim_sources: {
        src1: {
          endpoint: `${graphBaseUrl}/users/${user.id}/getMemberObjects`,
        },
      },
    });
  });

  it("does not consume an approved code when signing or token persistence fails", async () => {
    let failSigning = true;
    const signing = await setup({
      beforeTokenSign: async () => {
        if (failSigning) {
          failSigning = false;
          throw new Error("injected signing preparation failure");
        }
        return {};
      },
      seed: "entra-device-sign-failure",
    });
    const signAuthorization = await createAuthorization(signing.oauth);
    signing.oauth.activateDeviceAuthorization(
      signAuthorization.userCode,
      signing.user.id
    );
    await expect(
      signing.oauth.pollDeviceAuthorization({
        clientId: signing.application.clientId,
        deviceCode: signAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      })
    ).rejects.toThrow("injected signing preparation failure");
    expect(deviceStatus(signing.store, signAuthorization.userCode)).toEqual({
      consumed_at: null,
      status: "approved",
    });
    await expect(
      signing.oauth.pollDeviceAuthorization({
        clientId: signing.application.clientId,
        deviceCode: signAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      })
    ).resolves.toMatchObject({ tokenType: "Bearer" });

    const persistence = await setup({ seed: "entra-device-persist-failure" });
    const persistAuthorization = await createAuthorization(persistence.oauth);
    persistence.oauth.activateDeviceAuthorization(
      persistAuthorization.userCode,
      persistence.user.id
    );
    persistence.store.database.exec(`CREATE TRIGGER reject_device_access_token
      BEFORE INSERT ON oauth_access_tokens
      BEGIN SELECT RAISE(ABORT, 'reject device token persistence'); END`);
    await expect(
      persistence.oauth.pollDeviceAuthorization({
        clientId: persistence.application.clientId,
        deviceCode: persistAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      })
    ).rejects.toThrow("reject device token persistence");
    expect(deviceStatus(persistence.store, persistAuthorization.userCode)).toEqual({
      consumed_at: null,
      status: "approved",
    });
    persistence.store.database.exec("DROP TRIGGER reject_device_access_token");
    await expect(
      persistence.oauth.pollDeviceAuthorization({
        clientId: persistence.application.clientId,
        deviceCode: persistAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      })
    ).resolves.toMatchObject({ tokenType: "Bearer" });
  });

  it("keeps lifecycle races retryable and serializes concurrent approved polls", async () => {
    let releaseSigning!: () => void;
    let enteredSigning!: () => void;
    const signingGate = new Promise<void>((resolve) => {
      releaseSigning = resolve;
    });
    const signingEntered = new Promise<void>((resolve) => {
      enteredSigning = resolve;
    });
    let gateFirstSign = true;
    const lifecycle = await setup({
      beforeTokenSign: async () => {
        if (gateFirstSign) {
          gateFirstSign = false;
          enteredSigning();
          await signingGate;
        }
        return {};
      },
      seed: "entra-device-lifecycle-race",
    });
    const lifecycleAuthorization = await createAuthorization(lifecycle.oauth);
    lifecycle.oauth.activateDeviceAuthorization(
      lifecycleAuthorization.userCode,
      lifecycle.user.id
    );
    const racedPoll = lifecycle.oauth.pollDeviceAuthorization({
      clientId: lifecycle.application.clientId,
      deviceCode: lifecycleAuthorization.deviceCode,
      issuerBase,
      graphBaseUrl,
    });
    await signingEntered;
    lifecycle.users.setAccountEnabled(lifecycle.user.id, false);
    releaseSigning();
    await expect(racedPoll).rejects.toMatchObject({ code: "USER_DISABLED" });
    expect(deviceStatus(lifecycle.store, lifecycleAuthorization.userCode)).toEqual({
      consumed_at: null,
      status: "approved",
    });
    lifecycle.users.setAccountEnabled(lifecycle.user.id, true);
    await expect(
      lifecycle.oauth.pollDeviceAuthorization({
        clientId: lifecycle.application.clientId,
        deviceCode: lifecycleAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      })
    ).resolves.toMatchObject({ tokenType: "Bearer" });

    const concurrent = await setup({ seed: "entra-device-concurrent" });
    const concurrentAuthorization = await createAuthorization(concurrent.oauth);
    concurrent.oauth.activateDeviceAuthorization(
      concurrentAuthorization.userCode,
      concurrent.user.id
    );
    const poll = () =>
      concurrent.oauth.pollDeviceAuthorization({
        clientId: concurrent.application.clientId,
        deviceCode: concurrentAuthorization.deviceCode,
        issuerBase,
        graphBaseUrl,
      });
    const results = await Promise.allSettled([poll(), poll()]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject(
      { error: "invalid_grant" }
    );
    expect(
      concurrent.store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM oauth_access_tokens"
      )
    ).toEqual({ count: 1 });
    expect(
      concurrent.store.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM refresh_tokens"
      )
    ).toEqual({ count: 1 });
  });
});
