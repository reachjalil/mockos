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
        factors: [
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
    expect(await expiredResponse.json()).toMatchObject({
      status: "PASSWORD_EXPIRED",
      _links: {
        next: {
          name: "changePassword",
          href: "https://do.internal/e/env_authn/api/v1/authn/credentials/change_password",
        },
      },
    });

    const lockedResponse = await request("locked-password");
    expect(await lockedResponse.json()).toEqual({
      status: "LOCKED_OUT",
      _links: {
        next: {
          name: "unlock",
          href: "https://do.internal/e/env_authn/api/v1/authn/recovery/unlock",
          hints: { allow: ["POST"] },
        },
      },
    });
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
    expect(engine.authenticate).not.toHaveBeenCalled();
  });
});
