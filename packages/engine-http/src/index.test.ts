import { describe, expect, it, vi } from "vitest";
import { createEntraHttpApp, type EntraHttpEngine, OAuthProtocolError } from "./index";

const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";

const engine: EntraHttpEngine = {
  tenantId,
  authorize: () => ({ code: "unused" }),
  discovery: (issuer) => ({ issuer }),
  jwks: () => ({ keys: [] }),
  token: () => ({ accessToken: "unused", expiresIn: 3600 }),
};

const discovery = (issuer: string) =>
  createEntraHttpApp({ engine }).request(
    `https://do.internal/${tenantId}/v2.0/.well-known/openid-configuration`,
    { headers: { "x-mockos-issuer-base": issuer } }
  );

describe("trusted issuer routing", () => {
  it.each([
    "http://localhost:8787",
    "http://127.0.0.1:8787",
    "http://127.42.19.7:8787",
    "http://[::1]:8787",
  ])("allows the loopback issuer %s for local Wrangler use", async (issuer) => {
    const response = await discovery(`${issuer}/e/local-env/${tenantId}/v2.0`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${issuer}/e/local-env/${tenantId}/v2.0`,
    });
  });

  it("rejects non-loopback HTTP issuers", async () => {
    const response = await discovery(
      `http://mockos.example/e/local-env/${tenantId}/v2.0`
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it.each(["ftp://localhost:8787", "ws://127.0.0.1:8787"])(
    "rejects the non-HTTP issuer scheme %s even on loopback",
    async (issuer) => {
      const response = await discovery(`${issuer}/e/local-env/${tenantId}/v2.0`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    }
  );

  it.each([
    `https://user:password@mockos.example/e/local-env/${tenantId}/v2.0`,
    `https://mockos.example/e/local-env/${tenantId}/v2.0?issuer=spoofed`,
    `https://mockos.example/e/local-env/${tenantId}/v2.0#spoofed`,
  ])("rejects unsafe trusted issuer metadata %s", async (issuer) => {
    const response = await discovery(issuer);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("Entra authorization response modes", () => {
  const authorizePath = `https://do.internal/${tenantId}/oauth2/v2.0/authorize`;
  const authorizationParams = {
    client_id: "mock-client",
    redirect_uri: "https://client.example/callback?existing=1&safe=yes",
    response_type: "code",
    scope: "openid profile",
    state: 'state<&"',
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
  };

  it("returns a safely escaped form_post response", async () => {
    const app = createEntraHttpApp({
      engine: { ...engine, authorize: () => ({ code: 'code<&"' }) },
    });
    const response = await app.request(authorizePath, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...authorizationParams,
        response_mode: "form_post",
        username: "ada@example.test",
        password: "Passw0rd!",
      }).toString(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(
      'action="https://client.example/callback?existing=1&amp;safe=yes"'
    );
    expect(html).toContain('value="code&lt;&amp;&quot;"');
    expect(html).toContain('value="state&lt;&amp;&quot;"');
  });

  it("rejects unsupported response modes before rendering login", async () => {
    const url = new URL(authorizePath);
    url.search = new URLSearchParams({
      ...authorizationParams,
      response_mode: "fragment",
    }).toString();
    const response = await createEntraHttpApp({ engine }).request(url);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("Entra token grants", () => {
  const issuer = `https://login.mockos.test/e/test/${tenantId}/v2.0`;
  const graphBaseUrl = "https://login.mockos.test/e/test/graph/v1.0";
  const tokenPath = `https://do.internal/${tenantId}/oauth2/v2.0/token`;
  const withIssuer = (body: URLSearchParams) => ({
    method: "POST",
    headers: {
      "x-mockos-graph-base": graphBaseUrl,
      "x-mockos-issuer-base": issuer,
    },
    body,
  });

  it("dispatches validated authorization-code and refresh-token requests", async () => {
    const token = vi.fn(() => ({
      accessToken: "access-token",
      expiresIn: 3_600,
      refreshToken: "replacement-refresh-token",
      scope: "openid offline_access",
    }));
    const app = createEntraHttpApp({ engine: { ...engine, token } });

    const authorizationCode = await app.request(
      tokenPath,
      withIssuer(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "mock-client",
          client_secret: "mock-client-secret",
          code: "authorization-code",
          redirect_uri: "https://client.example/callback",
          code_verifier: "verifier",
        })
      )
    );
    expect(authorizationCode.status).toBe(200);
    expect(token).toHaveBeenNthCalledWith(1, {
      grantType: "authorization_code",
      graphBaseUrl,
      issuerBase: issuer,
      clientId: "mock-client",
      clientSecret: "mock-client-secret",
      code: "authorization-code",
      redirectUri: "https://client.example/callback",
      codeVerifier: "verifier",
    });

    const refresh = await app.request(
      tokenPath,
      withIssuer(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "mock-client",
          client_secret: "mock-client-secret",
          refresh_token: "current-refresh-token",
          scope: "openid offline_access",
        })
      )
    );
    expect(refresh.status).toBe(200);
    expect(await refresh.json()).toMatchObject({
      token_type: "Bearer",
      expires_in: 3_600,
      access_token: "access-token",
      refresh_token: "replacement-refresh-token",
      scope: "openid offline_access",
    });
    expect(token).toHaveBeenNthCalledWith(2, {
      grantType: "refresh_token",
      graphBaseUrl,
      issuerBase: issuer,
      clientId: "mock-client",
      clientSecret: "mock-client-secret",
      refreshToken: "current-refresh-token",
      scope: "openid offline_access",
    });
  });

  it("rejects a refresh grant without a refresh_token before engine dispatch", async () => {
    const token = vi.fn(engine.token);
    const response = await createEntraHttpApp({ engine: { ...engine, token } }).request(
      tokenPath,
      withIssuer(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "mock-client",
        })
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_request",
      error_description: expect.stringContaining("'refresh_token'"),
    });
    expect(token).not.toHaveBeenCalled();
  });

  it.each([
    "ftp://localhost:8787/graph/v1.0",
    "ws://127.9.8.7:8787/graph/v1.0",
    "http://graph.mockos.example/graph/v1.0",
  ])("rejects the untrusted Graph base %s", async (graphBase) => {
    const token = vi.fn(engine.token);
    const response = await createEntraHttpApp({ engine: { ...engine, token } }).request(
      tokenPath,
      {
        method: "POST",
        headers: {
          "x-mockos-graph-base": graphBase,
          "x-mockos-issuer-base": issuer,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "mock-client",
          refresh_token: "current-refresh-token",
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(token).not.toHaveBeenCalled();
  });

  it("renders disabled-user refresh failures as Entra AADSTS50057 errors", async () => {
    const token = vi.fn(() => {
      throw new OAuthProtocolError("USER_DISABLED", "User account is disabled.");
    });
    const response = await createEntraHttpApp({ engine: { ...engine, token } }).request(
      tokenPath,
      withIssuer(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "mock-client",
          refresh_token: "current-refresh-token",
        })
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("x-ms-request-id")).toBeTruthy();
    expect(await response.json()).toMatchObject({
      error: "invalid_grant",
      error_codes: [50057],
      error_description: expect.stringContaining("AADSTS50057"),
    });
  });
});
