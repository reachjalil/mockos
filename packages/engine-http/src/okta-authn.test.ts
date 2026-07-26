import { OktaAuthnError, type OktaAuthnResult, type UserRecord } from "@mockos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOktaAuthnApi, type OktaAuthnEngine } from "./okta-authn";

const user: UserRecord = {
  id: "usr_authn_fixture",
  userName: "ada@example.test",
  displayName: "Ada Lovelace",
  givenName: "Ada",
  familyName: "Lovelace",
  lifecycleState: "active",
  accountEnabled: true,
  passwordState: "valid",
  mfaState: "none",
  provider: {},
  scim: {},
  resourceVersion: 1,
  createdAt: "2026-07-22T11:00:00.000Z",
  updatedAt: "2026-07-22T11:30:00.000Z",
};

const success: OktaAuthnResult = {
  status: "SUCCESS",
  sessionToken: "session_fixture_value",
  expiresAt: "2026-07-22T12:05:00.000Z",
  user,
};

const mfa: OktaAuthnResult = {
  status: "MFA_REQUIRED",
  stateToken: "state_fixture_value",
  expiresAt: "2026-07-22T12:05:00.000Z",
  user,
};

const expired: OktaAuthnResult = {
  status: "PASSWORD_EXPIRED",
  stateToken: "state_expired_fixture",
  expiresAt: "2026-07-22T12:05:00.000Z",
  user: { ...user, passwordState: "expired" },
};

const createEngine = (): OktaAuthnEngine => ({
  authenticate: vi.fn(async () => success),
  getTransaction: vi.fn(async () => mfa),
  cancel: vi.fn(async () => undefined),
  verifyFactor: vi.fn(async () => success),
});

const jsonRequest = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("Okta Classic Authn HTTP adapter", () => {
  let engine: OktaAuthnEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it("renders a successful primary authentication without echoing credentials", async () => {
    const app = createOktaAuthnApi({
      engine,
      requestId: () => "req_authn_success",
    });
    const response = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest({
        username: "ada@example.test",
        password: "SyntheticPassw0rd!",
      })
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "SUCCESS",
      sessionToken: "session_fixture_value",
      expiresAt: "2026-07-22T12:05:00.000Z",
      _embedded: {
        user: {
          id: user.id,
          profile: {
            login: user.userName,
            firstName: "Ada",
            lastName: "Lovelace",
          },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("SyntheticPassw0rd!");
    expect(
      (body._embedded as { user: Record<string, unknown> }).user
    ).not.toHaveProperty("passwordChanged");
    expect(engine.authenticate).toHaveBeenCalledWith({
      userName: "ada@example.test",
      password: "SyntheticPassw0rd!",
    });
  });

  it("renders MFA, password-expired, and lockout states with public path links", async () => {
    vi.mocked(engine.authenticate)
      .mockResolvedValueOnce(mfa)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce({ status: "LOCKED_OUT" });
    const app = createOktaAuthnApi({ engine });
    const request = (password: string) =>
      app.request(
        "https://do.internal/api/v1/authn",
        jsonRequest(
          { username: user.userName, password },
          { "x-mockos-public-path": "/e/env_authn/api/v1/authn" }
        )
      );

    const mfaResponse = await request("mfa-password");
    expect(await mfaResponse.json()).toMatchObject({
      status: "MFA_REQUIRED",
      stateToken: "state_fixture_value",
      _embedded: {
        factor: [
          {
            factorType: "token:software:totp",
            profile: {},
            _links: {
              verify: {
                href: `https://do.internal/e/env_authn/api/v1/authn/factors/mfa_${user.id}/verify`,
              },
            },
          },
        ],
      },
      _links: {
        cancel: {
          href: "https://do.internal/e/env_authn/api/v1/authn/cancel",
        },
      },
    });

    const expiredResponse = await request("expired-password");
    const expiredBody = await expiredResponse.json();
    expect(expiredBody).toMatchObject({
      status: "PASSWORD_EXPIRED",
      _links: {
        cancel: {
          href: "https://do.internal/e/env_authn/api/v1/authn/cancel",
          hints: { allow: ["POST"] },
        },
      },
    });
    expect(expiredBody).not.toHaveProperty("_links.next");

    const lockedResponse = await request("locked-password");
    expect(await lockedResponse.json()).toEqual({ status: "LOCKED_OUT" });
  });

  it("mounts every emitted MFA action and verifies the exact factor transaction", async () => {
    vi.mocked(engine.authenticate).mockResolvedValue(mfa);
    const app = createOktaAuthnApi({ engine });
    const primary = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest(
        { username: user.userName, password: "SyntheticPassw0rd!" },
        { "x-mockos-public-path": "/e/env_authn/api/v1/authn" }
      )
    );
    const body = (await primary.json()) as {
      stateToken: string;
      _embedded: {
        factor: Array<{
          id: string;
          _links: { verify: { href: string; hints: { allow: string[] } } };
        }>;
      };
      _links: { cancel: { href: string; hints: { allow: string[] } } };
    };
    const factor = body._embedded.factor[0];
    expect(factor).toBeDefined();
    expect(factor?._links.verify.hints.allow).toEqual(["POST"]);
    expect(body._links.cancel.hints.allow).toEqual(["POST"]);

    const verifyPublicPath = new URL(factor?._links.verify.href ?? "").pathname;
    const verify = await app.request(
      `https://do.internal/api/v1/authn/factors/${factor?.id}/verify`,
      jsonRequest(
        { stateToken: body.stateToken, passCode: "000000" },
        { "x-mockos-public-path": verifyPublicPath }
      )
    );
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({
      status: "SUCCESS",
      sessionToken: "session_fixture_value",
    });
    expect(engine.verifyFactor).toHaveBeenCalledWith({
      factorId: factor?.id,
      passCode: "000000",
      stateToken: body.stateToken,
    });

    const cancelPublicPath = new URL(body._links.cancel.href).pathname;
    const cancel = await app.request("https://do.internal/api/v1/authn/cancel", {
      ...jsonRequest({ stateToken: body.stateToken }),
      headers: {
        "content-type": "application/json",
        "x-mockos-public-path": cancelPublicPath,
      },
    });
    expect(cancel.status).toBe(200);
  });

  it("renders the exact invalid-passcode error without reflecting the passcode", async () => {
    vi.mocked(engine.verifyFactor).mockRejectedValue(
      new OktaAuthnError("INVALID_PASSCODE")
    );
    const app = createOktaAuthnApi({
      engine,
      requestId: () => "req_invalid_passcode",
    });
    const response = await app.request(
      `https://do.internal/api/v1/authn/factors/mfa_${user.id}/verify`,
      jsonRequest({
        stateToken: "state_fixture_value",
        passCode: "111111",
      })
    );
    expect(response.status).toBe(403);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual({
      errorCode: "E0000068",
      errorSummary: "Invalid Passcode/Answer",
      errorLink: "E0000068",
      errorId: "req_invalid_passcode",
      errorCauses: [],
    });
    expect(responseText).not.toContain("111111");
  });

  it("retrieves and cancels an exact state token", async () => {
    const app = createOktaAuthnApi({ engine });
    const state = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest({ stateToken: "state_fixture_value" })
    );
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({
      status: "MFA_REQUIRED",
      stateToken: "state_fixture_value",
    });
    expect(engine.getTransaction).toHaveBeenCalledWith("state_fixture_value");

    const cancelled = await app.request(
      "https://do.internal/api/v1/authn/cancel",
      jsonRequest({ stateToken: "state_fixture_value" })
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.text()).toBe("");
    expect(engine.cancel).toHaveBeenCalledWith("state_fixture_value");
  });

  it("derives links from the exact routed suffix when the prefix contains authn", async () => {
    const app = createOktaAuthnApi({ engine });
    vi.mocked(engine.authenticate).mockResolvedValue(mfa);
    const mfaResponse = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest(
        { username: user.userName, password: "SyntheticPassw0rd!" },
        {
          "x-mockos-public-path": "/api/v1/authn-prefix/e/env_authn/api/v1/authn",
        }
      )
    );
    const mfaBody = (await mfaResponse.json()) as {
      _embedded: { factor: Array<{ _links: { verify: { href: string } } }> };
      _links: { cancel: { href: string } };
    };
    expect(mfaBody._links.cancel.href).toBe(
      "https://do.internal/api/v1/authn-prefix/e/env_authn/api/v1/authn/cancel"
    );
    expect(mfaBody._embedded.factor[0]?._links.verify.href).toBe(
      `https://do.internal/api/v1/authn-prefix/e/env_authn/api/v1/authn/factors/mfa_${user.id}/verify`
    );
  });

  it("permits bounded same-origin preflight and rejects cross-origin requests", async () => {
    const app = createOktaAuthnApi({ engine });
    const preflight = await app.request("https://do.internal/api/v1/authn", {
      method: "OPTIONS",
      headers: {
        origin: "https://do.internal",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, accept",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://do.internal"
    );
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "content-type, accept"
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(preflight.headers.get("vary")).toContain("Origin");

    const unsupportedPreflight = await app.request("https://do.internal/api/v1/authn", {
      method: "OPTIONS",
      headers: {
        origin: "https://do.internal",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-auth-token",
      },
    });
    expect(unsupportedPreflight.status).toBe(403);
    expect(unsupportedPreflight.headers.get("access-control-allow-origin")).toBeNull();

    const oversizedPreflight = await app.request("https://do.internal/api/v1/authn", {
      method: "OPTIONS",
      headers: {
        origin: "https://do.internal",
        "access-control-request-method": "POST",
        "access-control-request-headers": `content-type,${"x".repeat(257)}`,
      },
    });
    expect(oversizedPreflight.status).toBe(403);

    const sameOrigin = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest(
        { username: user.userName, password: "SyntheticPassw0rd!" },
        { origin: "https://do.internal" }
      )
    );
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBe(
      "https://do.internal"
    );
    vi.mocked(engine.authenticate).mockClear();

    const rejected = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest(
        { username: user.userName, password: "SyntheticPassw0rd!" },
        { origin: "https://client.example" }
      )
    );
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
    expect(engine.authenticate).not.toHaveBeenCalled();
  });

  it("uses indistinguishable authentication errors for unknown or stateful users", async () => {
    vi.mocked(engine.authenticate).mockRejectedValue(
      new OktaAuthnError("INVALID_CREDENTIALS")
    );
    const app = createOktaAuthnApi({
      engine,
      requestId: () => "req_invalid_credentials",
    });
    const response = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest({ username: "unknown@example.test", password: "incorrect" })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("x-okta-request-id")).toBe("req_invalid_credentials");
    expect(await response.json()).toEqual({
      errorCode: "E0000004",
      errorSummary: "Authentication failed",
      errorLink: "E0000004",
      errorId: "req_invalid_credentials",
      errorCauses: [],
    });
  });

  it("rejects mixed, malformed, oversized, and unsupported requests", async () => {
    const app = createOktaAuthnApi({
      engine,
      requestId: () => "req_validation",
    });
    const mixed = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest({
        stateToken: "state_fixture_value",
        username: user.userName,
        password: "SyntheticPassw0rd!",
      })
    );
    expect(mixed.status).toBe(400);

    const malformed = await app.request("https://do.internal/api/v1/authn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const oversized = await app.request(
      "https://do.internal/api/v1/authn",
      jsonRequest({ username: user.userName, password: "x".repeat(70_000) })
    );
    expect(oversized.status).toBe(413);

    const wrongMediaType = await app.request("https://do.internal/api/v1/authn", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "credentials",
    });
    expect(wrongMediaType.status).toBe(400);

    const method = await app.request("https://do.internal/api/v1/authn");
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
    const invalidPasscode = await app.request(
      `https://do.internal/api/v1/authn/factors/mfa_${user.id}/verify`,
      jsonRequest({
        stateToken: "state_fixture_value",
        passCode: "not-six-digits",
      })
    );
    expect(invalidPasscode.status).toBe(400);
    const factorMethod = await app.request(
      `https://do.internal/api/v1/authn/factors/mfa_${user.id}/verify`
    );
    expect(factorMethod.status).toBe(405);
    expect(factorMethod.headers.get("allow")).toBe("POST");
    expect(engine.authenticate).not.toHaveBeenCalled();
    expect(engine.verifyFactor).not.toHaveBeenCalled();
  });
});
