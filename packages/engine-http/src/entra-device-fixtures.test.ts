import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "@mockos/core";
import {
  assertFixtureResults,
  type ConformanceFixture,
  loadFixtures,
  NodeSqlStore,
  runFixtures,
  SeededClock,
  SeededRng,
} from "@mockos/testkit";
import { describe, expect, it } from "vitest";
import {
  createEntraHttpApp,
  type EntraHttpEngine,
  OAuthProtocolError,
} from "./index.js";

const FIXTURE_ORIGIN = "https://fixtures.mockos.test";
const FIXTURE_CLOCK = "2026-07-26T12:00:00.000Z";
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_ID = "00000000-0000-4000-8000-000000000002";
const USER_NAME = "ada.device@example.test";
const PASSWORD = "SyntheticPassw0rd!";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code" as const;

type DeviceAuthorizationResponse = {
  device_code: string;
  expires_in: number;
  interval: number;
  message: string;
  user_code: string;
  verification_uri: string;
};

const fixtureRequest = (
  fixture: ConformanceFixture,
  formOverrides: Record<string, string> = {}
): Request => {
  const url = new URL(fixture.request.path, FIXTURE_ORIGIN);
  for (const [name, value] of Object.entries(fixture.request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers(fixture.request.headers);
  headers.set("x-mockos-directory-base", FIXTURE_ORIGIN);
  headers.set("x-mockos-issuer-base", `${FIXTURE_ORIGIN}/${TENANT_ID}/v2.0`);
  headers.set("x-mockos-graph-base", `${FIXTURE_ORIGIN}/graph/v1.0`);
  headers.set("x-mockos-public-path", url.pathname);

  const form =
    fixture.request.form === undefined
      ? undefined
      : { ...fixture.request.form, ...formOverrides };
  const body =
    form === undefined
      ? fixture.request.body === undefined
        ? undefined
        : JSON.stringify(fixture.request.body)
      : new URLSearchParams(form).toString();
  return new Request(url, {
    method: fixture.request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
};

const responseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

describe("Entra device authorization conformance fixtures", () => {
  it("executes all five device cases through the core-backed HTTP composition", async () => {
    const fixtureDirectory = fileURLToPath(
      new URL("../../testkit/fixtures/entra/oidc", import.meta.url)
    );
    const fixtureFiles = (await readdir(fixtureDirectory))
      .filter((file) => /^2[3-7]-.*\.json$/.test(file))
      .sort()
      .map((file) => join(fixtureDirectory, file));
    const fixtures = await loadFixtures(fixtureFiles);
    expect(fixtures.map(({ name }) => name)).toEqual([
      "Start device authorization",
      "Device authorization pending",
      "Device authorization declined",
      "Invalid device code",
      "Expired device code",
    ]);
    expect(fixtures.every(({ status }) => status === "implemented")).toBe(true);

    const store = new NodeSqlStore();
    const clock = new SeededClock(FIXTURE_CLOCK);
    try {
      const engine = Engine.create(
        {
          provider: "entra",
          seed: "entra-device-fixtures",
          tenantId: TENANT_ID,
        },
        {
          store,
          clock,
          rng: new SeededRng("entra-device-fixtures"),
        }
      );
      await engine.initialize();
      const user = await engine.users.create({
        id: "usr_device_fixture",
        userName: USER_NAME,
        displayName: "Ada Device Fixture",
        password: PASSWORD,
      });
      await engine.applications.create({
        id: "app_device_fixture",
        name: "Entra device fixture client",
        clientId: CLIENT_ID,
        clientType: "public",
        redirectUris: ["http://localhost/mockos-device-fixture"],
        grantTypes: [DEVICE_GRANT, "refresh_token"],
      });

      const authenticate = async (username: string, password: string) => {
        const authenticated = await engine.users.authenticate(username, password);
        if (!authenticated) throw new OAuthProtocolError("INVALID_GRANT");
        return authenticated;
      };
      const httpEngine: EntraHttpEngine = {
        tenantId: engine.tenantId,
        discovery: (issuerBase) => engine.discovery(issuerBase),
        jwks: () => engine.jwks(),
        activateDeviceAuthorization: async (input) => {
          const authenticated = await authenticate(input.username, input.password);
          engine.oauth.activateDeviceAuthorization(input.userCode, authenticated.id);
        },
        authorize: () => {
          throw new OAuthProtocolError("UNSUPPORTED_GRANT");
        },
        createDeviceAuthorization: (input) =>
          engine.oauth.createDeviceAuthorization(input),
        denyDeviceAuthorization: async (input) => {
          await authenticate(input.username, input.password);
          engine.oauth.denyDeviceAuthorization(input.userCode);
        },
        token: (input) => {
          if (input.grantType !== DEVICE_GRANT) {
            throw new OAuthProtocolError("UNSUPPORTED_GRANT");
          }
          return engine.oauth.pollDeviceAuthorization({
            clientId: input.clientId,
            deviceCode: input.deviceCode,
            graphBaseUrl: input.graphBaseUrl,
            issuerBase: input.issuerBase,
          });
        },
      };
      const app = createEntraHttpApp({ engine: httpEngine });

      const createDeviceAuthorization =
        async (): Promise<DeviceAuthorizationResponse> => {
          const response = await app.fetch(
            new Request(`${FIXTURE_ORIGIN}/${TENANT_ID}/oauth2/v2.0/devicecode`, {
              method: "POST",
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                "x-mockos-directory-base": FIXTURE_ORIGIN,
                "x-mockos-issuer-base": `${FIXTURE_ORIGIN}/${TENANT_ID}/v2.0`,
                "x-mockos-public-path": `/${TENANT_ID}/oauth2/v2.0/devicecode`,
              },
              body: new URLSearchParams({
                client_id: CLIENT_ID,
                scope: "openid profile",
              }),
            })
          );
          expect(response.status, await response.clone().text()).toBe(200);
          return response.json() as Promise<DeviceAuthorizationResponse>;
        };

      const execute = async (fixture: ConformanceFixture) => {
        let deviceCode: string | undefined;
        if (
          fixture.name === "Device authorization pending" ||
          fixture.name === "Device authorization declined" ||
          fixture.name === "Expired device code"
        ) {
          const authorization = await createDeviceAuthorization();
          deviceCode = authorization.device_code;
          if (fixture.name === "Device authorization declined") {
            const denial = await app.fetch(
              new Request(`${FIXTURE_ORIGIN}/devicelogin`, {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  "x-mockos-public-path": "/devicelogin",
                },
                body: new URLSearchParams({
                  decision: "deny",
                  password: PASSWORD,
                  user_code: authorization.user_code,
                  username: USER_NAME,
                }),
              })
            );
            expect(denial.status, await denial.clone().text()).toBe(200);
          }
          if (fixture.name === "Expired device code") {
            clock.advance(901_000);
          }
        }

        const response = await app.fetch(
          fixtureRequest(
            fixture,
            deviceCode === undefined ? {} : { device_code: deviceCode }
          )
        );
        return {
          status: response.status,
          headers: response.headers,
          body: await responseBody(response),
        };
      };

      const results = await runFixtures(fixtures, execute);
      expect(results).toHaveLength(5);
      assertFixtureResults(results);

      const started = results[0]?.response.body;
      expect(started).toMatchObject({
        device_code: expect.any(String),
        expires_in: 900,
        interval: 5,
        message: expect.any(String),
        user_code: expect.stringMatching(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{8}$/),
        verification_uri: `${FIXTURE_ORIGIN}/devicelogin`,
      });
      expect(started).not.toHaveProperty("verification_uri_complete");
      const startedBody = started as DeviceAuthorizationResponse;
      expect(startedBody.message).toBe(
        `To sign in, use a web browser to open the page ${startedBody.verification_uri} ` +
          `and enter the code ${startedBody.user_code} to authenticate.`
      );
      expect(engine.users.findById(user.id)).toMatchObject({ id: user.id });
    } finally {
      store.close();
    }
  });
});
