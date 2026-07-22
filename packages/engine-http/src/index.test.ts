import { describe, expect, it } from "vitest";
import { createEntraHttpApp, type EntraHttpEngine } from "./index";

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
  it.each(["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"])(
    "allows the loopback issuer %s for local Wrangler use",
    async (issuer) => {
      const response = await discovery(`${issuer}/e/local-env/${tenantId}/v2.0`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        issuer: `${issuer}/e/local-env/${tenantId}/v2.0`,
      });
    }
  );

  it("rejects non-loopback HTTP issuers", async () => {
    const response = await discovery(
      `http://mockos.example/e/local-env/${tenantId}/v2.0`
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

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
