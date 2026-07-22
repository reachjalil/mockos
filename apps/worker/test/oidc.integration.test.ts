import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const environmentId = "oidc-test-01";
const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";
const clientId = "mockos-pkce-client";
const clientSecret = "mockos-pkce-secret";
const redirectUri = "https://client.example/callback";
const userName = "ada@example.test";
const worker = (exports as unknown as { default: Fetcher }).default;

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const decodePart = <T>(part: string): T => {
  const normalized = part.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  ) as T;
};

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${origin}${path}`, { ...init, headers });
};

const verifyJwt = async (
  token: string,
  jwks: { keys: Array<JsonWebKey & { kid?: string }> }
): Promise<Record<string, unknown>> => {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Expected a compact JWT.");
  }
  const header = decodePart<{ alg: string; kid: string }>(encodedHeader);
  expect(header.alg).toBe("RS256");
  const jwk = jwks.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error(`JWKS did not contain kid ${header.kid}.`);
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
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  expect(verified).toBe(true);
  return decodePart<Record<string, unknown>>(encodedPayload);
};

describe("Entra authorization-code flow", () => {
  it("completes hosted login and PKCE, then verifies the id_token with JWKS", async () => {
    const configure = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        id: environmentId,
        name: "OIDC integration environment",
        provider: "entra",
        seed: "oidc-integration",
        tenantId,
        createdAt: "2026-07-21T12:00:00.000Z",
        idleTtlHours: 168,
        requestLogLimit: 10_000,
      }),
    });
    expect(configure.status).toBe(200);

    const seed = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/identities:seed`,
      {
        method: "POST",
        body: JSON.stringify({
          users: [
            {
              userName,
              displayName: "Ada Lovelace",
              givenName: "Ada",
              familyName: "Lovelace",
              password: "Passw0rd!",
              active: true,
              mfaState: "none",
              roles: [],
            },
          ],
          groups: [],
        }),
      }
    );
    expect(seed.status).toBe(200);
    const seedBody = await seed.json<{
      data: { users: Array<{ id: string; userName: string }> };
    }>();
    const userId = seedBody.data.users[0]?.id;
    expect(userId).toBeTruthy();

    const application = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/applications`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "PKCE test client",
          clientId,
          clientSecret,
          redirectUris: [redirectUri],
          grantTypes: ["authorization_code"],
          appRoles: [],
          groupClaimsMode: "none",
        }),
      }
    );
    expect(application.status).toBe(201);

    const issuer = `${origin}/e/${environmentId}/${tenantId}/v2.0`;
    const discoveryResponse = await worker.fetch(
      `${issuer}/.well-known/openid-configuration`
    );
    expect(discoveryResponse.status).toBe(200);
    const discovery = await discoveryResponse.json<Record<string, unknown>>();
    expect(discovery).toMatchObject({
      issuer,
      authorization_endpoint: `${origin}/e/${environmentId}/${tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: `${origin}/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      jwks_uri: `${origin}/e/${environmentId}/${tenantId}/discovery/v2.0/keys`,
    });
    const jwksUrl = `${origin}/e/${environmentId}/${tenantId}/discovery/v2.0/keys`;
    const beforeRotation = await (await worker.fetch(jwksUrl)).json<{
      keys: Array<JsonWebKey & { kid?: string }>;
    }>();
    expect(beforeRotation.keys).toHaveLength(2);

    const verifier = "mockos-pkce-verifier-with-at-least-forty-three-characters-123";
    const challenge = base64Url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
      )
    );
    const authorizeUrl = new URL(
      `${origin}/e/${environmentId}/${tenantId}/oauth2/v2.0/authorize`
    );
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: "openid profile email",
      state: "integration-state",
      nonce: "integration-nonce",
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: userName,
    }).toString();

    const loginPage = await worker.fetch(authorizeUrl);
    expect(loginPage.status).toBe(200);
    expect(loginPage.headers.get("content-type")).toContain("text/html");
    const html = await loginPage.text();
    expect(html).toContain("Sign in · mockOS test environment");
    expect(html).toContain('aria-label="mockOS"');
    expect(html).toContain("Microsoft Entra ID simulation");
    expect(html).toContain("Never enter production credentials");
    expect(html).toContain('name="code_challenge"');

    const loginAction = /<form method="post" action="([^"]+)">/.exec(html)?.[1];
    expect(loginAction).toBe(`/e/${environmentId}/${tenantId}/oauth2/v2.0/authorize`);

    const login = await worker.fetch(new URL(loginAction ?? "", origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: "openid profile email",
        state: "integration-state",
        nonce: "integration-nonce",
        code_challenge: challenge,
        code_challenge_method: "S256",
        username: userName,
        password: "Passw0rd!",
      }).toString(),
      redirect: "manual",
    });
    expect(login.status, await login.clone().text()).toBe(302);
    const callback = new URL(login.headers.get("location") ?? "");
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("integration-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const namespace = Reflect.get(env, "ENVIRONMENTS") as {
      get(id: DurableObjectId): {
        setScenario(input: Record<string, unknown>): Promise<unknown>;
      };
      idFromName(name: string): DurableObjectId;
    };
    await namespace.get(namespace.idFromName(environmentId)).setScenario({
      id: "rotate-mid-authorization-session",
      injectionPoint: "token.before_sign",
      action: { type: "rotate_signing_key" },
      probability: 1,
      remaining: 1,
      enabled: true,
    });

    const tokenResponse = await worker.fetch(
      `${origin}/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code: code ?? "",
          redirect_uri: redirectUri,
          code_verifier: verifier,
        }).toString(),
      }
    );
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json<{
      access_token: string;
      expires_in: number;
      id_token: string;
      token_type: string;
    }>();
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token).toBeTruthy();
    expect(token.expires_in).toBeGreaterThan(0);

    const jwksResponse = await worker.fetch(jwksUrl);
    expect(jwksResponse.status).toBe(200);
    const afterRotation = await jwksResponse.json<{
      keys: Array<JsonWebKey & { kid?: string }>;
    }>();
    const tokenKid = decodePart<{ kid: string }>(
      token.id_token.split(".")[0] ?? ""
    ).kid;
    expect(afterRotation.keys).toHaveLength(3);
    expect(beforeRotation.keys.map(({ kid }) => kid)).toContain(tokenKid);
    expect(afterRotation.keys.map(({ kid }) => kid)).toContain(tokenKid);
    const claims = await verifyJwt(token.id_token, afterRotation);
    expect(claims).toMatchObject({
      iss: issuer,
      aud: clientId,
      tid: tenantId,
      oid: userId,
      upn: userName,
      nonce: "integration-nonce",
    });
  });
});
