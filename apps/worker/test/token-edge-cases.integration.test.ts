import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const environmentId = "token-edge-cases-01";
const tenantId = "cabf5f83-6085-4f3f-8c4c-6eb127407ee1";
const clientId = "token-edge-client";
const issuer = `${origin}/e/${environmentId}/${tenantId}/v2.0`;
const tokenLocation = {
  issuerBase: issuer,
  graphBaseUrl: `${origin}/e/${environmentId}/graph/v1.0`,
};
const userName = "overage@example.test";
const worker = (exports as unknown as { default: Fetcher }).default;

type MintedToken = {
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  claims: Record<string, unknown>;
  broken?: string;
};

const decode = <T>(encoded: string): T => {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  ) as T;
};

const signatureValid = async (
  token: string,
  jwks: { keys: Array<JsonWebKey & { kid?: string }> }
): Promise<boolean> => {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;
  const header = decode<{ kid: string }>(encodedHeader);
  const jwk = jwks.keys.find(({ kid }) => kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = Uint8Array.from(
    atob(
      encodedSignature
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(encodedSignature.length / 4) * 4, "=")
    ),
    (value) => value.charCodeAt(0)
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
};

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${origin}${path}`, { ...init, headers });
};

describe("M6 token and group-overage edges", () => {
  it("runs clock skew, every broken-token variant, and the 200/201 fallback", async () => {
    const configure = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        id: environmentId,
        name: "Token edge integration environment",
        provider: "entra",
        seed: "token-edge-integration",
        tenantId,
        createdAt: "2026-07-22T12:00:00.000Z",
        idleTtlHours: 168,
        requestLogLimit: 10_000,
      }),
    });
    expect(configure.status, await configure.clone().text()).toBe(200);

    const groups = Array.from({ length: 200 }, (_, index) => ({
      displayName: `Security group ${String(index + 1).padStart(3, "0")}`,
      members: [userName],
    }));
    const seed = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/identities:seed`,
      {
        method: "POST",
        body: JSON.stringify({
          users: [
            {
              userName,
              displayName: "Overage User",
              password: "Passw0rd!",
              active: true,
              mfaState: "none",
              roles: [],
            },
          ],
          groups,
        }),
      }
    );
    expect(seed.status, await seed.clone().text()).toBe(200);
    const seeded = await seed.json<{
      data: { users: Array<{ id: string }>; groups: Array<{ id: string }> };
    }>();
    const userId = seeded.data.users[0]?.id;
    expect(userId).toBeTruthy();
    expect(seeded.data.groups).toHaveLength(200);

    const application = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/applications`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Token edge client",
          clientId,
          clientSecret: "token-edge-secret",
          redirectUris: ["https://client.example/callback"],
          grantTypes: ["authorization_code"],
          appRoles: [],
          groupClaimsMode: "all",
        }),
      }
    );
    expect(application.status, await application.clone().text()).toBe(201);

    const namespace = Reflect.get(env, "ENVIRONMENTS") as {
      get(id: DurableObjectId): {
        getWellKnownUrls(location: {
          directoryBaseUrl: string;
          issuerBase: string;
          graphBaseUrl?: string;
        }): Promise<Record<string, unknown>>;
        mintToken(
          input: Record<string, unknown>,
          location: { issuerBase: string; graphBaseUrl?: string }
        ): Promise<MintedToken>;
        setScenario(input: Record<string, unknown>): Promise<unknown>;
      };
      idFromName(name: string): DurableObjectId;
    };
    const environment = namespace.get(namespace.idFromName(environmentId));
    const inline = await environment.mintToken(
      { clientId, subject: userId },
      tokenLocation
    );
    expect(inline.claims.groups).toHaveLength(200);
    expect(inline.claims).not.toHaveProperty("_claim_names");

    const extraGroup = await worker.fetch(
      `${origin}/e/${environmentId}/scim/v2/Groups`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer mock-scim-token",
          "content-type": "application/scim+json",
        },
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Security group 201",
          members: [{ value: userId }],
        }),
      }
    );
    expect(extraGroup.status, await extraGroup.clone().text()).toBe(201);
    const extraGroupBody = await extraGroup.json<{ id: string }>();

    const overage = await environment.mintToken(
      { clientId, subject: userId },
      tokenLocation
    );
    expect(overage.claims).not.toHaveProperty("groups");
    expect(overage.claims).toMatchObject({
      _claim_names: { groups: "src1" },
      _claim_sources: {
        src1: {
          endpoint: `${origin}/e/${environmentId}/graph/v1.0/users/${userId}/getMemberObjects`,
        },
      },
    });
    const endpoint = Reflect.get(
      Reflect.get(overage.claims, "_claim_sources") as object,
      "src1"
    ) as { endpoint: string };
    const fallback = await worker.fetch(endpoint.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${overage.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ securityEnabledOnly: true }),
    });
    expect(fallback.status, await fallback.clone().text()).toBe(200);
    const fallbackBody = await fallback.json<{ value: string[] }>();
    expect(fallbackBody.value).toHaveLength(201);
    expect(fallbackBody.value).toEqual(expect.arrayContaining([extraGroupBody.id]));

    const subdomainLocation = {
      directoryBaseUrl: `https://${environmentId}.id.mockos.live`,
      issuerBase: `https://login.id.mockos.live/${tenantId}/v2.0`,
      graphBaseUrl: `https://${environmentId}.id.mockos.live/graph/v1.0`,
    };
    const subdomainMint = await environment.mintToken(
      { clientId, subject: userId },
      subdomainLocation
    );
    expect(subdomainMint.claims).toMatchObject({
      iss: `https://login.id.mockos.live/${tenantId}/v2.0`,
      _claim_sources: {
        src1: {
          endpoint: `https://${environmentId}.id.mockos.live/graph/v1.0/users/${userId}/getMemberObjects`,
        },
      },
    });
    await expect(
      environment.getWellKnownUrls(subdomainLocation)
    ).resolves.toMatchObject({
      issuer: `https://login.id.mockos.live/${tenantId}/v2.0`,
      scimBaseUrl: `https://${environmentId}.id.mockos.live/scim/v2`,
      graphBaseUrl: `https://${environmentId}.id.mockos.live/graph/v1.0`,
    });

    const loopbackLocation = {
      directoryBaseUrl: "http://127.42.19.7:8787",
      issuerBase: `http://127.42.19.7:8787/${tenantId}/v2.0`,
      graphBaseUrl: "http://127.42.19.7:8787/graph/v1.0",
    };
    await expect(
      environment.mintToken({ clientId, subject: userId }, loopbackLocation)
    ).resolves.toMatchObject({
      claims: {
        iss: loopbackLocation.issuerBase,
        _claim_sources: {
          src1: {
            endpoint: `${loopbackLocation.graphBaseUrl}/users/${userId}/getMemberObjects`,
          },
        },
      },
    });
    await expect(environment.getWellKnownUrls(loopbackLocation)).resolves.toMatchObject(
      {
        issuer: loopbackLocation.issuerBase,
        scimBaseUrl: `${loopbackLocation.directoryBaseUrl}/scim/v2`,
        graphBaseUrl: loopbackLocation.graphBaseUrl,
      }
    );

    await environment.setScenario({
      id: "clock-forward-once",
      injectionPoint: "token.before_sign",
      action: { type: "token_clock_skew", seconds: 300 },
      probability: 1,
      remaining: 1,
      enabled: true,
    });
    const wallClock = Math.floor(Date.now() / 1_000);
    const skewed = await environment.mintToken(
      { clientId, subject: userId },
      tokenLocation
    );
    expect(Number(skewed.claims.iat)).toBeGreaterThanOrEqual(wallClock + 299);
    expect(Number(skewed.claims.nbf)).toBe(Number(skewed.claims.iat));

    const jwks = await (
      await worker.fetch(`${origin}/e/${environmentId}/${tenantId}/discovery/v2.0/keys`)
    ).json<{ keys: Array<JsonWebKey & { kid?: string }> }>();
    const variants = [
      "expired",
      "wrong_audience",
      "not_yet_valid",
      "bad_signature",
      "wrong_issuer",
    ] as const;
    const broken = new Map<string, MintedToken>();
    for (const variant of variants) {
      const minted = await environment.mintToken(
        { clientId, subject: userId, broken: variant },
        tokenLocation
      );
      expect(minted.broken).toBe(variant);
      expect(minted.token.split(".")).toHaveLength(3);
      broken.set(variant, minted);
    }
    expect(Number(broken.get("expired")?.claims.exp)).toBeLessThan(wallClock);
    expect(broken.get("wrong_audience")?.claims.aud).not.toBe(clientId);
    expect(Number(broken.get("not_yet_valid")?.claims.nbf)).toBeGreaterThan(wallClock);
    expect(broken.get("wrong_issuer")?.claims.iss).toBe(
      "https://wrong-issuer.mockos.invalid"
    );
    await expect(
      signatureValid(broken.get("bad_signature")?.token ?? "", jwks)
    ).resolves.toBe(false);
    for (const variant of variants.filter((value) => value !== "bad_signature")) {
      await expect(
        signatureValid(broken.get(variant)?.token ?? "", jwks)
      ).resolves.toBe(true);
    }
  });
});
