import { describe, expect, it } from "vitest";
import { resolveEnvironmentRequest } from "./host-resolver";

const environmentId = "test-env_01";
const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";

describe("resolveEnvironmentRequest", () => {
  it("resolves locked path-mode Entra traffic", () => {
    const result = resolveEnvironmentRequest(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/authorize`,
      { hostingMode: "path" }
    );
    expect(result).toMatchObject({
      environmentId,
      forwardedPath: `/${tenantId}/oauth2/v2.0/authorize`,
      issuerBase: `https://mockos.example/e/${environmentId}/${tenantId}/v2.0`,
      provider: "entra",
    });
  });

  it("does not silently accept subdomain traffic in path mode", () => {
    expect(
      resolveEnvironmentRequest(
        `https://${environmentId}.id.mockos.live/oauth2/default/v1/authorize`,
        { hostingMode: "path" }
      )
    ).toBeUndefined();
  });

  it("resolves an Okta environment subdomain", () => {
    const result = resolveEnvironmentRequest(
      `https://${environmentId}.id.mockos.live/oauth2/default/v1/authorize`,
      { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
    );
    expect(result).toMatchObject({
      environmentId,
      issuerBase: `https://${environmentId}.id.mockos.live/oauth2/default`,
      provider: "okta",
    });
  });

  it("returns a tenant locator for the Entra login host", () => {
    const result = resolveEnvironmentRequest(
      `https://login.id.mockos.live/${tenantId}/v2.0/.well-known/openid-configuration`,
      { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
    );
    expect(result).toMatchObject({
      issuerBase: `https://login.id.mockos.live/${tenantId}/v2.0`,
      locator: { type: "tenant", tenantId },
      provider: "entra",
    });
    expect(result?.environmentId).toBeUndefined();
  });
});
