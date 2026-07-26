import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const controlOrigin = "https://mockos.test";
const publicOrigin = new URL(Reflect.get(env, "PUBLIC_ORIGIN") as string).origin;
const environmentId = "entra-device-flow";
const tenantId = "6b71d2a6-e527-4433-9f00-7dded7301e9f";
const clientId = "entra-device-public-client";
const userName = "grace.device@example.test";
const password = "Passw0rd!";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const worker = (exports as unknown as { default: Fetcher }).default;

type DeviceAuthorization = {
  device_code: string;
  expires_in: number;
  interval: number;
  message: string;
  user_code: string;
  verification_uri: string;
};

type RequestLogPage = {
  entries: Array<{
    path: string;
    responseBody: string | null;
    responseStatus: number;
  }>;
};

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${controlOrigin}${path}`, { ...init, headers });
};

const formRequest = (url: string, fields: Record<string, string>) =>
  worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

const expectDeviceError = async (response: Response, error: string) => {
  expect(response.status).toBe(400);
  expect(response.headers.get("retry-after")).toBeNull();
  expect(await response.json()).toMatchObject({ error });
};

describe("Entra device authorization mounted flow", () => {
  it("routes trusted public metadata and models pending, denial, approval, and one-shot polling", {
    timeout: 20_000,
  }, async () => {
    const configure = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        id: environmentId,
        name: "Entra device integration environment",
        provider: "entra",
        seed: "entra-device-integration",
        tenantId,
        createdAt: "2026-07-26T00:00:00.000Z",
        idleTtlHours: 168,
        requestLogLimit: 10_000,
      }),
    });
    expect(configure.status, await configure.clone().text()).toBe(200);

    try {
      const seed = await controlFetch(
        `/__mockos/v1/environments/${environmentId}/identities:seed`,
        {
          method: "POST",
          body: JSON.stringify({
            users: [
              {
                userName,
                displayName: "Grace Hopper",
                givenName: "Grace",
                familyName: "Hopper",
                password,
                active: true,
                mfaState: "none",
                roles: [],
              },
            ],
            groups: [],
          }),
        }
      );
      expect(seed.status, await seed.clone().text()).toBe(200);

      const application = await controlFetch(
        `/__mockos/v1/environments/${environmentId}/applications`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Entra device public client",
            clientId,
            clientType: "public",
            redirectUris: [],
            grantTypes: [deviceGrant, "refresh_token"],
            appRoles: [],
            groupClaimsMode: "none",
          }),
        }
      );
      expect(application.status, await application.clone().text()).toBe(201);
      expect(
        await application.json<{
          data: { clientType: string; redirectUris: string[] };
        }>()
      ).toMatchObject({
        data: {
          clientType: "public",
          redirectUris: [],
        },
      });

      const publicBase = `${publicOrigin}/e/${environmentId}`;
      const issuer = `${publicBase}/${tenantId}/v2.0`;
      const deviceEndpoint = `${publicBase}/${tenantId}/oauth2/v2.0/devicecode`;
      const tokenEndpoint = `${publicBase}/${tenantId}/oauth2/v2.0/token`;
      const verificationUri = `${publicBase}/devicelogin`;

      const discoveryResponse = await worker.fetch(
        `${issuer}/.well-known/openid-configuration`
      );
      expect(discoveryResponse.status, await discoveryResponse.clone().text()).toBe(
        200
      );
      expect(await discoveryResponse.json()).toMatchObject({
        device_authorization_endpoint: deviceEndpoint,
        grant_types_supported: expect.arrayContaining([deviceGrant]),
      });

      const createDevice = async () => {
        const response = await formRequest(deviceEndpoint, {
          client_id: clientId,
          scope: "openid profile offline_access",
        });
        expect(response.status, await response.clone().text()).toBe(200);
        const authorization = await response.json<DeviceAuthorization>();
        expect(authorization).toMatchObject({
          expires_in: 900,
          interval: 5,
          verification_uri: verificationUri,
        });
        expect(authorization).not.toHaveProperty("verification_uri_complete");
        expect(authorization.message).toBe(
          `To sign in, use a web browser to open the page ${verificationUri} ` +
            `and enter the code ${authorization.user_code} to authenticate.`
        );
        return authorization;
      };

      const pending = await createDevice();
      await expectDeviceError(
        await formRequest(tokenEndpoint, {
          grant_type: "device_code",
          client_id: clientId,
          device_code: pending.device_code,
        }),
        "authorization_pending"
      );
      await expectDeviceError(
        await formRequest(tokenEndpoint, {
          grant_type: deviceGrant,
          client_id: clientId,
          device_code: pending.device_code,
        }),
        "slow_down"
      );

      const denied = await createDevice();
      const unauthenticatedDenial = await formRequest(denied.verification_uri, {
        user_code: denied.user_code,
        username: userName,
        password: "wrong-password",
        decision: "deny",
      });
      expect(unauthenticatedDenial.status).toBe(400);
      expect(await unauthenticatedDenial.text()).toContain(
        "Error validating credentials"
      );
      const denial = await formRequest(denied.verification_uri, {
        user_code: denied.user_code,
        username: userName,
        password,
        decision: "deny",
      });
      expect(denial.status, await denial.clone().text()).toBe(200);
      expect(await denial.text()).toContain("Device authorization declined");
      await expectDeviceError(
        await formRequest(tokenEndpoint, {
          grant_type: deviceGrant,
          client_id: clientId,
          device_code: denied.device_code,
        }),
        "authorization_declined"
      );

      const approved = await createDevice();
      const activationPage = await worker.fetch(
        `${approved.verification_uri}?user_code=${encodeURIComponent(
          approved.user_code
        )}`
      );
      expect(activationPage.status).toBe(200);
      const activationHtml = await activationPage.text();
      expect(activationHtml).toContain("Sign in on this device");
      expect(activationHtml).toContain(`action="/e/${environmentId}/devicelogin"`);
      const activation = await formRequest(approved.verification_uri, {
        user_code: approved.user_code,
        username: userName,
        password,
        decision: "approve",
      });
      expect(activation.status, await activation.clone().text()).toBe(200);
      expect(await activation.text()).toContain("Device authorized");

      const tokenResponse = await formRequest(tokenEndpoint, {
        grant_type: deviceGrant,
        client_id: clientId,
        device_code: approved.device_code,
      });
      expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
      const issuedTokens = (await tokenResponse.json()) as {
        access_token: string;
        id_token: string;
        refresh_token: string;
      };
      expect(issuedTokens).toMatchObject({
        access_token: expect.any(String),
        expires_in: 3_600,
        id_token: expect.any(String),
        refresh_token: expect.any(String),
        scope: "openid profile offline_access",
        token_type: "Bearer",
      });

      const refreshResponse = await formRequest(tokenEndpoint, {
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: issuedTokens.refresh_token,
        scope: "openid profile offline_access",
      });
      expect(refreshResponse.status, await refreshResponse.clone().text()).toBe(200);
      const refreshedTokens = (await refreshResponse.json()) as {
        access_token: string;
        id_token: string;
        refresh_token: string;
      };
      expect(refreshedTokens).toMatchObject({
        access_token: expect.any(String),
        id_token: expect.any(String),
        refresh_token: expect.any(String),
      });
      expect(refreshedTokens.access_token).not.toBe(issuedTokens.access_token);
      expect(refreshedTokens.refresh_token).not.toBe(issuedTokens.refresh_token);

      await expectDeviceError(
        await formRequest(tokenEndpoint, {
          grant_type: deviceGrant,
          client_id: clientId,
          device_code: approved.device_code,
        }),
        "bad_verification_code"
      );
      await expectDeviceError(
        await formRequest(tokenEndpoint, {
          grant_type: "device_code",
          client_id: clientId,
          device_code: "unknown-device-code",
        }),
        "bad_verification_code"
      );

      const namespace = Reflect.get(env, "ENVIRONMENTS") as {
        get(id: DurableObjectId): {
          getRequestLog(query: Record<string, unknown>): Promise<RequestLogPage>;
          setScenario(input: Record<string, unknown>): Promise<unknown>;
        };
        idFromName(name: string): DurableObjectId;
      };
      const stub = namespace.get(namespace.idFromName(environmentId));
      const rawDeviceCode = "device/secret+raw";
      const rawUserCode = "USER CODE/42";
      await stub.setScenario({
        id: "device-response-redaction",
        injectionPoint: "oauth.device",
        action: {
          type: "mutate",
          patch: {
            device_code: rawDeviceCode,
            user_code: rawUserCode,
            message: `Use ${rawDeviceCode} and ${rawUserCode}`,
            raw_copy: `${rawDeviceCode}|${rawUserCode}`,
            encoded_copy: `${encodeURIComponent(rawDeviceCode)}|${new URLSearchParams({
              value: rawUserCode,
            })
              .toString()
              .slice("value=".length)}`,
          },
        },
        probability: 1,
        remaining: 1,
        enabled: true,
      });
      const mutated = await formRequest(deviceEndpoint, {
        client_id: clientId,
        scope: "openid",
      });
      expect(mutated.status, await mutated.clone().text()).toBe(200);
      expect(await mutated.json()).toMatchObject({
        device_code: rawDeviceCode,
        user_code: rawUserCode,
      });

      const publicDevicePath = new URL(deviceEndpoint).pathname;
      const logs = await stub.getRequestLog({
        method: "POST",
        path: publicDevicePath,
        status: 200,
        limit: 100,
      });
      const mutatedLog = logs.entries.find((entry) =>
        entry.responseBody?.includes('"raw_copy"')
      );
      expect(mutatedLog).toBeDefined();
      const loggedBody = mutatedLog?.responseBody ?? "";
      expect(loggedBody).not.toContain(rawDeviceCode);
      expect(loggedBody).not.toContain(rawUserCode);
      expect(loggedBody).not.toContain(encodeURIComponent(rawDeviceCode));
      expect(loggedBody).not.toContain("USER+CODE%2F42");
      expect(JSON.parse(loggedBody)).toMatchObject({
        device_code: "[REDACTED]",
        user_code: "[REDACTED]",
        message: "[REDACTED]",
        raw_copy: "[REDACTED]|[REDACTED]",
        encoded_copy: "[REDACTED]|[REDACTED]",
      });

      await stub.setScenario({
        id: "ordinary-message-preserved",
        injectionPoint: "oidc.discovery",
        action: {
          type: "mutate",
          patch: { message: "ordinary non-secret provider message" },
        },
        probability: 1,
        remaining: 1,
        enabled: true,
      });
      const ordinary = await worker.fetch(`${issuer}/.well-known/openid-configuration`);
      expect(ordinary.status).toBe(200);
      expect(await ordinary.json()).toMatchObject({
        message: "ordinary non-secret provider message",
      });
      const discoveryLogs = await stub.getRequestLog({
        method: "GET",
        path: new URL(`${issuer}/.well-known/openid-configuration`).pathname,
        status: 200,
        limit: 100,
      });
      expect(
        discoveryLogs.entries.some((entry) =>
          entry.responseBody?.includes("ordinary non-secret provider message")
        )
      ).toBe(true);
    } finally {
      const deleted = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(204);
    }
  });
});
