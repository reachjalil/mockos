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
});
