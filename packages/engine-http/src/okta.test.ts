import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOktaHttpApp, OAuthProtocolError, type OktaHttpEngine } from "./index";

const issuer = "https://id.mockos.test/e/acme/oauth2/default";

const tokenResult = {
  accessToken: "access-token",
  expiresIn: 3600,
  idToken: "id-token",
  refreshToken: "refresh-token",
  scope: "openid profile offline_access",
  tokenType: "Bearer",
} as const;

const createFakeEngine = (): OktaHttpEngine => ({
  activateDeviceAuthorization: vi.fn(),
  authorize: vi.fn(() => ({ code: "authorization-code" })),
  createDeviceAuthorization: vi.fn(() => ({
    deviceCode: "device-code",
    userCode: "ABCD2345",
    verificationUri: "https://id.mockos.test/e/acme/activate",
    verificationUriComplete:
      "https://id.mockos.test/e/acme/activate?user_code=ABCD2345",
    expiresIn: 600,
    interval: 5,
  })),
  discovery: vi.fn((issuerBase) => ({
    issuer: issuerBase,
    jwks_uri: `${issuerBase}/v1/keys`,
  })),
  introspect: vi.fn(
    () =>
      ({
        active: true,
        aud: "0oaMockClient",
        client_id: "0oaMockClient",
        exp: 1_784_725_200,
        iat: 1_784_721_600,
        iss: issuer,
        scope: "openid profile",
        sub: "00uMockAda",
        token_type: "Bearer",
        uid: "00uMockAda",
        username: "ada@example.com",
      }) as const
  ),
  jwks: vi.fn(() => ({ keys: [] })),
  pollDeviceAuthorization: vi.fn(() => tokenResult),
  redeemAuthorizationCode: vi.fn(() => tokenResult),
  redeemRefreshToken: vi.fn(() => tokenResult),
  renderError: vi.fn((error: unknown) => {
    const semanticCode =
      error instanceof OAuthProtocolError ? error.semanticCode : "INVALID_REQUEST";
    const status = semanticCode === "BAD_CLIENT_SECRET" ? 401 : 400;
    const oauthError =
      semanticCode === "BAD_CLIENT_SECRET"
        ? "invalid_client"
        : semanticCode === "USER_DISABLED"
          ? "invalid_grant"
          : "invalid_request";
    return {
      status,
      headers: {
        "x-okta-request-id": "req_fake",
        ...(status === 401 ? { "www-authenticate": 'Basic realm="Okta"' } : {}),
      },
      body: {
        error: oauthError,
        error_description:
          error instanceof Error ? error.message : "The OAuth request is invalid.",
      },
    };
  }),
  revoke: vi.fn(),
  validateAuthorizationRequest: vi.fn(),
});

const withIssuer = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    "x-mockos-issuer-base": issuer,
    ...(init.headers ?? {}),
  },
});

const authorizationParams = () =>
  new URLSearchParams({
    client_id: "0oaMockClient",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: "openid profile",
    state: "state-02",
    nonce: "nonce-02",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });

describe("Okta HTTP adapter", () => {
  let engine: OktaHttpEngine;

  beforeEach(() => {
    engine = createFakeEngine();
  });

  it("derives discovery and JWKS calls from the trusted request issuer", async () => {
    const app = createOktaHttpApp({ engine });
    const discovery = await app.request(
      "https://do.internal/oauth2/default/.well-known/openid-configuration",
      withIssuer()
    );
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toEqual({
      issuer,
      jwks_uri: `${issuer}/v1/keys`,
    });
    expect(engine.discovery).toHaveBeenCalledWith(issuer);

    const keys = await app.request(
      "https://do.internal/oauth2/default/v1/keys",
      withIssuer()
    );
    expect(keys.status).toBe(200);
    expect(keys.headers.get("cache-control")).toBe("public, max-age=300");
    expect(engine.jwks).toHaveBeenCalledWith(issuer);
  });

  it("renders the Okta hosted login and carries required S256 PKCE fields", async () => {
    const app = createOktaHttpApp({ engine });
    const params = authorizationParams();
    const response = await app.request(
      `https://do.internal/oauth2/default/v1/authorize?${params}`,
      withIssuer({
        headers: {
          "x-mockos-issuer-base": issuer,
          "x-mockos-public-path": "/e/acme/oauth2/default/v1/authorize",
        },
      })
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Okta simulation");
    expect(html).toContain('action="/e/acme/oauth2/default/v1/authorize"');
    expect(html).toContain('name="code_challenge"');
    expect(html).toContain('name="code_challenge_method" value="S256"');
    expect(engine.validateAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "0oaMockClient",
        codeChallengeMethod: "S256",
        responseType: "code",
      })
    );
  });

  it("rejects authorization requests that do not use S256 PKCE", async () => {
    const app = createOktaHttpApp({ engine });
    const params = authorizationParams();
    params.set("code_challenge_method", "plain");
    const response = await app.request(
      `https://do.internal/oauth2/default/v1/authorize?${params}`,
      withIssuer()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
    expect(engine.authorize).not.toHaveBeenCalled();
  });

  it("submits credentials and returns query and form_post authorization responses", async () => {
    const app = createOktaHttpApp({ engine });
    const queryForm = authorizationParams();
    queryForm.set("username", "ada@example.com");
    queryForm.set("password", "correct horse");
    const query = await app.request(
      "https://do.internal/oauth2/default/v1/authorize",
      withIssuer({ method: "POST", body: queryForm, redirect: "manual" })
    );

    expect(query.status).toBe(302);
    expect(query.headers.get("location")).toBe(
      "https://client.example/callback?code=authorization-code&state=state-02"
    );
    expect(engine.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "ada@example.com",
        password: "correct horse",
        codeChallengeMethod: "S256",
      })
    );

    const formPost = authorizationParams();
    formPost.set("response_mode", "form_post");
    formPost.set("username", "ada@example.com");
    formPost.set("password", "correct horse");
    const posted = await app.request(
      "https://do.internal/oauth2/default/v1/authorize",
      withIssuer({ method: "POST", body: formPost })
    );
    const html = await posted.text();
    expect(posted.status).toBe(200);
    expect(html).toContain('method="post"');
    expect(html).toContain('name="code" value="authorization-code"');
    expect(html).toContain('name="state" value="state-02"');
  });

  it("dispatches authorization-code, refresh-token, and device-code grants", async () => {
    const app = createOktaHttpApp({ engine });
    const authorizationCode = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "0oaMockClient",
          client_secret: "okta-client-secret",
          code: "fixture-code",
          redirect_uri: "https://client.example/callback",
          code_verifier: "okta-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE",
        }),
      })
    );
    expect(authorizationCode.status).toBe(200);
    expect(await authorizationCode.json()).toEqual({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile offline_access",
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
    });
    expect(engine.redeemAuthorizationCode).toHaveBeenCalledWith({
      grantType: "authorization_code",
      issuerBase: issuer,
      clientId: "0oaMockClient",
      clientSecret: "okta-client-secret",
      code: "fixture-code",
      redirectUri: "https://client.example/callback",
      codeVerifier: "okta-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE",
    });

    const refresh = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "0oaMockClient",
          client_secret: "okta-client-secret",
          refresh_token: "current-refresh-token",
          scope: "openid profile",
        }),
      })
    );
    expect(refresh.status).toBe(200);
    expect(await refresh.json()).toMatchObject({
      token_type: "Bearer",
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(engine.redeemRefreshToken).toHaveBeenCalledWith({
      grantType: "refresh_token",
      issuerBase: issuer,
      clientId: "0oaMockClient",
      clientSecret: "okta-client-secret",
      refreshToken: "current-refresh-token",
      scope: "openid profile",
    });

    const deviceCode = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: "0oaMockClient",
          device_code: "device-code",
        }),
      })
    );
    expect(deviceCode.status).toBe(200);
    expect(engine.pollDeviceAuthorization).toHaveBeenCalledWith({
      grantType: "urn:ietf:params:oauth:grant-type:device_code",
      issuerBase: issuer,
      clientId: "0oaMockClient",
      deviceCode: "device-code",
    });
  });

  it("creates device authorizations and activates them through the hosted flow", async () => {
    const app = createOktaHttpApp({ engine });
    const authorization = await app.request(
      "https://do.internal/oauth2/default/v1/device/authorize",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          client_id: "0oaMockClient",
          scope: "openid profile offline_access",
        }),
      })
    );
    expect(await authorization.json()).toEqual({
      device_code: "device-code",
      user_code: "ABCD2345",
      verification_uri: "https://id.mockos.test/e/acme/activate",
      verification_uri_complete:
        "https://id.mockos.test/e/acme/activate?user_code=ABCD2345",
      expires_in: 600,
      interval: 5,
    });
    expect(engine.createDeviceAuthorization).toHaveBeenCalledWith({
      clientId: "0oaMockClient",
      issuerBase: issuer,
      scope: "openid profile offline_access",
    });

    const page = await app.request("https://do.internal/activate?user_code=ABCD2345");
    expect(await page.text()).toContain('name="user_code" type="text"');

    const activation = await app.request("https://do.internal/activate", {
      method: "POST",
      body: new URLSearchParams({
        user_code: "ABCD2345",
        username: "ada@example.com",
        password: "correct horse",
      }),
    });
    expect(activation.status).toBe(200);
    expect(await activation.text()).toContain("Device authorized");
    expect(engine.activateDeviceAuthorization).toHaveBeenCalledWith({
      userCode: "ABCD2345",
      username: "ada@example.com",
      password: "correct horse",
    });
  });

  it("passes introspection and revocation credentials, including Basic auth", async () => {
    const app = createOktaHttpApp({ engine });
    const credentials = btoa("0oaMockClient:okta-client-secret");
    const introspection = await app.request(
      "https://do.internal/oauth2/default/v1/introspect",
      withIssuer({
        method: "POST",
        headers: {
          "x-mockos-issuer-base": issuer,
          authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          token: "access-token",
          token_type_hint: "access_token",
        }),
      })
    );
    expect(await introspection.json()).toMatchObject({ active: true });
    expect(engine.introspect).toHaveBeenCalledWith({
      clientId: "0oaMockClient",
      clientSecret: "okta-client-secret",
      issuerBase: issuer,
      token: "access-token",
      tokenTypeHint: "access_token",
    });

    const revocation = await app.request(
      "https://do.internal/oauth2/default/v1/revoke",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          client_id: "0oaMockClient",
          client_secret: "okta-client-secret",
          token: "access-token",
          token_type_hint: "access_token",
        }),
      })
    );
    expect(revocation.status).toBe(200);
    expect(await revocation.text()).toBe("");
    expect(engine.revoke).toHaveBeenCalledWith({
      clientId: "0oaMockClient",
      clientSecret: "okta-client-secret",
      token: "access-token",
      tokenTypeHint: "access_token",
    });
  });

  it("uses the engine callback for provider-shaped OAuth errors", async () => {
    vi.mocked(engine.redeemAuthorizationCode).mockRejectedValueOnce(
      new OAuthProtocolError("BAD_CLIENT_SECRET", "Client authentication failed.")
    );
    const app = createOktaHttpApp({ engine });
    const response = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: "0oaMockClient",
          client_secret: "wrong-secret",
          code: "fixture-code",
          redirect_uri: "https://client.example/callback",
          code_verifier: "verifier",
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-okta-request-id")).toBe("req_fake");
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Okta"');
    expect(await response.json()).toEqual({
      error: "invalid_client",
      error_description: "Client authentication failed.",
    });
    expect(engine.renderError).toHaveBeenCalledTimes(1);
  });

  it("validates refresh input and renders disabled-user refresh errors", async () => {
    const app = createOktaHttpApp({ engine });
    const missingToken = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "0oaMockClient",
          client_secret: "okta-client-secret",
        }),
      })
    );
    expect(missingToken.status).toBe(400);
    expect(await missingToken.json()).toMatchObject({
      error: "invalid_request",
      error_description: expect.stringContaining("'refresh_token'"),
    });
    expect(engine.redeemRefreshToken).not.toHaveBeenCalled();

    vi.mocked(engine.redeemRefreshToken).mockRejectedValueOnce(
      new OAuthProtocolError("USER_DISABLED", "The resource owner account is disabled.")
    );
    const disabled = await app.request(
      "https://do.internal/oauth2/default/v1/token",
      withIssuer({
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "0oaMockClient",
          client_secret: "okta-client-secret",
          refresh_token: "current-refresh-token",
        }),
      })
    );
    expect(disabled.status).toBe(400);
    expect(disabled.headers.get("x-okta-request-id")).toBe("req_fake");
    expect(await disabled.json()).toEqual({
      error: "invalid_grant",
      error_description: "The resource owner account is disabled.",
    });
  });
});
