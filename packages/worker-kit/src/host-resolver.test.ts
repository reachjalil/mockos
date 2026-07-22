import { describe, expect, it } from "vitest";
import { forwardEnvironmentRequest, resolveEnvironmentRequest } from "./host-resolver";

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

  it("routes the Okta device activation page in path mode", () => {
    const result = resolveEnvironmentRequest(
      `https://mockos.example/e/${environmentId}/activate?user_code=ABCD2345`,
      { hostingMode: "path" }
    );

    expect(result).toMatchObject({
      environmentId,
      forwardedPath: "/activate",
      issuerBase: `https://mockos.example/e/${environmentId}/oauth2/default`,
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

  it("removes caller-supplied internal routing headers before forwarding", () => {
    const request = new Request(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "x-mockos-env": "attacker-env",
          "x-mockos-issuer-base": "https://attacker.example",
          "x-mockos-public-path": "/spoofed",
          "x-mockos-private-future": "spoofed",
        },
      }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (!resolution?.environmentId) throw new Error("Expected environment route.");

    const forwarded = forwardEnvironmentRequest(request, {
      ...resolution,
      environmentId: resolution.environmentId,
    });

    expect(forwarded.headers.get("x-mockos-env")).toBe(environmentId);
    expect(forwarded.headers.get("x-mockos-issuer-base")).toBe(
      `https://mockos.example/e/${environmentId}/${tenantId}/v2.0`
    );
    expect(forwarded.headers.get("x-mockos-public-path")).toBe(
      `/e/${environmentId}/${tenantId}/oauth2/v2.0/token`
    );
    expect(forwarded.headers.has("x-mockos-private-future")).toBe(false);
  });

  it("marks matching control authorization for log redaction without altering it", () => {
    const authorization = "Bearer self-host-control-secret";
    const request = new Request(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      { headers: { authorization } }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (!resolution?.environmentId) throw new Error("Expected environment route.");

    const forwarded = forwardEnvironmentRequest(
      request,
      { ...resolution, environmentId: resolution.environmentId },
      { redactAuthorization: true }
    );

    expect(forwarded.headers.get("authorization")).toBe(authorization);
    expect(forwarded.headers.get("x-mockos-redact-authorization")).toBe("true");
  });
});
