import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const controlOrigin = "https://mockos.test";
const publicOrigin = new URL(Reflect.get(env, "PUBLIC_ORIGIN") as string).origin;
const apiKey = "mockos-integration-test-key";
const clientId = "0oaOktaIntegrationClient";
const clientSecret = "okta-integration-secret";
const redirectUri = "https://client.example/callback";
const userName = "ada.okta@example.test";
const password = "Passw0rd!";
const worker = (exports as unknown as { default: Fetcher }).default;

type JsonRpcResponse = {
  id?: number | string;
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
};

type EnvironmentConfig = {
  id: string;
  provider: "okta";
  tenantId: string;
};

type WellKnownUrls = {
  authorizationEndpoint: string;
  deviceAuthorizationEndpoint: string;
  introspectionEndpoint: string;
  issuer: string;
  jwksUri: string;
  oktaApiBaseUrl: string;
  oktaAuthnEndpoint: string;
  openidConfiguration: string;
  revocationEndpoint: string;
  scimBaseUrl: string;
  tokenEndpoint: string;
};

const parseMessages = async (response: Response): Promise<JsonRpcResponse[]> => {
  const body = await response.text();
  if (!body) return [];
  if (response.headers.get("content-type")?.includes("application/json")) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
};

const mcpRequest = (
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<Response> => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return worker.fetch(`${controlOrigin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
};

const initializeMcp = async () => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mockos-okta-integration", version: "1.0.0" },
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const [message] = await parseMessages(response);
  expect(message?.result).toMatchObject({ protocolVersion: "2025-11-25" });

  const initialized = await mcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId ?? undefined
  );
  expect([200, 202, 204]).toContain(initialized.status);
  await initialized.body?.cancel();
  return sessionId ?? "";
};

let nextToolId = 10;

const callTool = async <T>(
  sessionId: string,
  name: string,
  args: Record<string, unknown>
): Promise<T> => {
  const response = await mcpRequest(
    {
      jsonrpc: "2.0",
      id: nextToolId++,
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const [message] = await parseMessages(response);
  expect(message?.error).toBeUndefined();
  const result = message?.result as
    | {
        isError?: boolean;
        structuredContent?: { data?: T };
      }
    | undefined;
  expect(result?.isError).not.toBe(true);
  expect(result?.structuredContent?.data).toBeDefined();
  return result?.structuredContent?.data as T;
};

const formRequest = (url: string, fields: Record<string, string>) =>
  worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

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
  expect(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    )
  ).toBe(true);
  return decodePart<Record<string, unknown>>(encodedPayload);
};

describe("Okta public identity surface", () => {
  it("runs bounded Classic Authn states without logging credentials or tokens", {
    timeout: 20_000,
  }, async () => {
    const sessionId = await initializeMcp();
    const environment = await callTool<EnvironmentConfig>(
      sessionId,
      "create_environment",
      {
        name: "Okta Classic Authn integration",
        provider: "okta",
        seed: "okta-authn-worker-integration",
      }
    );
    try {
      const authnPassword = "SyntheticAuthnPassw0rd!";
      const seeded = await callTool<{
        users: Array<{ id: string; userName: string }>;
      }>(sessionId, "seed_identities", {
        environmentId: environment.id,
        users: [
          {
            userName: "success.authn@example.test",
            displayName: "Success Authn",
            password: authnPassword,
            passwordState: "valid",
            active: true,
            mfaState: "none",
            roles: [],
          },
          {
            userName: "mfa.authn@example.test",
            displayName: "MFA Authn",
            password: authnPassword,
            passwordState: "expired",
            active: true,
            mfaState: "required",
            roles: [],
          },
          {
            userName: "expired.authn@example.test",
            displayName: "Expired Authn",
            password: authnPassword,
            passwordState: "expired",
            active: true,
            mfaState: "none",
            roles: [],
          },
          {
            userName: "locked.authn@example.test",
            displayName: "Locked Authn",
            password: authnPassword,
            passwordState: "valid",
            active: true,
            mfaState: "none",
            roles: [],
          },
        ],
        groups: [],
      });
      const lockedUser = seeded.users.find(
        ({ userName: value }) => value === "locked.authn@example.test"
      );
      if (!lockedUser) throw new Error("Expected the locked Authn fixture user.");
      await callTool(sessionId, "simulate_lifecycle", {
        environmentId: environment.id,
        userId: lockedUser.id,
        action: "suspend",
      });

      const urls = await callTool<WellKnownUrls>(sessionId, "get_wellknown_urls", {
        environmentId: environment.id,
      });
      expect(urls.oktaAuthnEndpoint).toBe(
        `${publicOrigin}/e/${environment.id}/api/v1/authn`
      );
      const authenticate = (
        body: Record<string, string>,
        headers: Record<string, string> = {}
      ) =>
        worker.fetch(urls.oktaAuthnEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });

      const preflight = await worker.fetch(urls.oktaAuthnEndpoint, {
        method: "OPTIONS",
        headers: {
          origin: publicOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(publicOrigin);
      expect(preflight.headers.get("access-control-allow-methods")).toBe("POST");
      expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
      const crossOrigin = await worker.fetch(urls.oktaAuthnEndpoint, {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(crossOrigin.status).toBe(403);
      expect(crossOrigin.headers.get("access-control-allow-origin")).toBeNull();

      for (const userName of [
        "mfa.authn@example.test",
        "expired.authn@example.test",
        "locked.authn@example.test",
        "unknown.authn@example.test",
      ]) {
        const invalid = await authenticate({
          username: userName,
          password: "WrongSyntheticPassword",
        });
        expect(invalid.status).toBe(401);
        expect(await invalid.json()).toMatchObject({
          errorCode: "E0000004",
          errorSummary: "Authentication failed",
          errorCauses: [],
        });
      }

      const mfaResponse = await authenticate({
        username: "mfa.authn@example.test",
        password: authnPassword,
      });
      expect(mfaResponse.status).toBe(200);
      const mfaBody = await mfaResponse.json<{
        stateToken: string;
        status: string;
      }>();
      expect(mfaBody.status).toBe("MFA_REQUIRED");
      expect(mfaBody.stateToken).toMatch(/^state_[a-f0-9]{48}$/);

      const currentState = await authenticate({ stateToken: mfaBody.stateToken });
      expect(await currentState.json()).toMatchObject({
        stateToken: mfaBody.stateToken,
        status: "MFA_REQUIRED",
      });
      const cancelled = await worker.fetch(`${urls.oktaAuthnEndpoint}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stateToken: mfaBody.stateToken }),
      });
      expect(cancelled.status).toBe(200);
      const replay = await authenticate({ stateToken: mfaBody.stateToken });
      expect(replay.status).toBe(401);
      expect(await replay.json()).toMatchObject({ errorCode: "E0000011" });

      const expiredResponse = await authenticate({
        username: "expired.authn@example.test",
        password: authnPassword,
      });
      expect(await expiredResponse.json()).toMatchObject({
        status: "PASSWORD_EXPIRED",
        _links: { next: { name: "changePassword" } },
      });

      const lockedResponse = await authenticate({
        username: "locked.authn@example.test",
        password: authnPassword,
      });
      expect(await lockedResponse.json()).toMatchObject({
        status: "LOCKED_OUT",
        _links: { next: { name: "unlock" } },
      });

      const cookieSecret = "AuthnCookieSecret";
      const proxySecret = "AuthnProxySecret";
      const headerTokenSecret = "AuthnHeaderTokenSecret";
      const preservedPasswordChanged = "2026-07-22T10:11:12.000Z";
      const successResponse = await authenticate(
        {
          username: "success.authn@example.test",
          password: authnPassword,
          passwordChanged: preservedPasswordChanged,
        },
        {
          origin: publicOrigin,
          cookie: `sid=${cookieSecret}`,
          "proxy-authorization": `Bearer ${proxySecret}`,
          "x-auth-token": headerTokenSecret,
        }
      );
      const successBody = await successResponse.json<{
        sessionToken: string;
        status: string;
      }>();
      expect(successBody.status).toBe("SUCCESS");
      expect(successBody.sessionToken).toMatch(/^session_[a-f0-9]{48}$/);
      expect(successResponse.headers.get("access-control-allow-origin")).toBe(
        publicOrigin
      );

      const malformedSecret = "MalformedAuthnSecret";
      const malformed = await worker.fetch(urls.oktaAuthnEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"password":"${malformedSecret}`,
      });
      expect(malformed.status).toBe(400);

      const primitiveSecret = "PrimitiveAuthnSecret";
      const primitive = await worker.fetch(urls.oktaAuthnEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(primitiveSecret),
      });
      expect(primitive.status).toBe(400);

      const log = await callTool<{
        entries: Array<{
          requestBody: string | null;
          requestHeaders: Record<string, string>;
          responseBody: string | null;
          responseHeaders: Record<string, string>;
        }>;
      }>(sessionId, "get_request_log", {
        environmentId: environment.id,
        source: "inbound",
        method: "POST",
        path: `/e/${environment.id}/api/v1/authn`,
        limit: 20,
      });
      expect(log.entries.length).toBeGreaterThanOrEqual(10);
      const captured = JSON.stringify(log.entries);
      expect(captured).not.toContain(authnPassword);
      expect(captured).not.toContain("WrongSyntheticPassword");
      expect(captured).not.toContain(malformedSecret);
      expect(captured).not.toContain(primitiveSecret);
      expect(captured).not.toContain(mfaBody.stateToken);
      expect(captured).not.toContain(successBody.sessionToken);
      expect(captured).not.toContain(cookieSecret);
      expect(captured).not.toContain(proxySecret);
      expect(captured).not.toContain(headerTokenSecret);
      expect(captured).toContain("E0000004");
      expect(captured).toContain(preservedPasswordChanged);
      expect(captured).toContain("[REDACTED]");
    } finally {
      await callTool(sessionId, "delete_environment", {
        environmentId: environment.id,
      });
    }
  });

  it("provisions through MCP and completes authorization-code and device flows", {
    timeout: 20_000,
  }, async () => {
    const sessionId = await initializeMcp();
    const environment = await callTool<EnvironmentConfig>(
      sessionId,
      "create_environment",
      {
        name: "Okta Worker integration",
        provider: "okta",
        seed: "okta-worker-integration",
      }
    );
    expect(environment.provider).toBe("okta");

    const seeded = await callTool<{
      users: Array<{ id: string; userName: string }>;
    }>(sessionId, "seed_identities", {
      users: [
        {
          userName,
          displayName: "Ada Lovelace",
          givenName: "Ada",
          familyName: "Lovelace",
          password,
          active: true,
          mfaState: "none",
          roles: [],
        },
      ],
      groups: [],
    });
    const userId = seeded.users[0]?.id;
    expect(userId).toBeTruthy();

    await callTool(sessionId, "create_application", {
      name: "Okta PKCE and device client",
      clientId,
      clientSecret,
      redirectUris: [redirectUri],
      grantTypes: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
      appRoles: [],
      groupClaimsMode: "none",
    });

    const urls = await callTool<WellKnownUrls>(sessionId, "get_wellknown_urls", {});
    const publicBase = `${publicOrigin}/e/${environment.id}`;
    const issuer = `${publicBase}/oauth2/default`;
    expect(urls).toMatchObject({
      issuer,
      openidConfiguration: `${issuer}/.well-known/openid-configuration`,
      authorizationEndpoint: `${issuer}/v1/authorize`,
      tokenEndpoint: `${issuer}/v1/token`,
      jwksUri: `${issuer}/v1/keys`,
      introspectionEndpoint: `${issuer}/v1/introspect`,
      revocationEndpoint: `${issuer}/v1/revoke`,
      deviceAuthorizationEndpoint: `${issuer}/v1/device/authorize`,
      scimBaseUrl: `${publicBase}/scim/v2`,
      oktaApiBaseUrl: `${publicBase}/api/v1`,
    });

    const discoveryResponse = await worker.fetch(urls.openidConfiguration);
    expect(discoveryResponse.status, await discoveryResponse.clone().text()).toBe(200);
    expect(await discoveryResponse.json()).toMatchObject({
      issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      jwks_uri: urls.jwksUri,
      introspection_endpoint: urls.introspectionEndpoint,
      revocation_endpoint: urls.revocationEndpoint,
      device_authorization_endpoint: urls.deviceAuthorizationEndpoint,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: [
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:device_code",
      ],
      code_challenge_methods_supported: ["S256"],
    });

    const verifier =
      "okta-worker-integration-verifier-with-more-than-forty-three-characters";
    const challenge = base64Url(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
      )
    );
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const authorizeUrl = new URL(urls.authorizationEndpoint);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: "openid profile email offline_access",
      state: "okta-integration-state",
      nonce: "okta-integration-nonce",
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: userName,
    }).toString();

    const loginPage = await worker.fetch(authorizeUrl);
    expect(loginPage.status).toBe(200);
    expect(loginPage.headers.get("content-type")).toContain("text/html");
    const loginHtml = await loginPage.text();
    expect(loginHtml).toContain("Okta simulation");
    expect(loginHtml).toContain("Never enter production credentials");
    expect(loginHtml).toContain('name="code_challenge"');
    expect(loginHtml).toContain('name="code_challenge_method" value="S256"');
    const loginAction = /<form method="post" action="([^"]+)">/.exec(loginHtml)?.[1];
    expect(loginAction).toBe(`/e/${environment.id}/oauth2/default/v1/authorize`);

    const login = await worker.fetch(new URL(loginAction ?? "", publicOrigin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: "openid profile email offline_access",
        state: "okta-integration-state",
        nonce: "okta-integration-nonce",
        code_challenge: challenge,
        code_challenge_method: "S256",
        username: userName,
        password,
      }).toString(),
      redirect: "manual",
    });
    expect(login.status, await login.clone().text()).toBe(302);
    const callback = new URL(login.headers.get("location") ?? "");
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("okta-integration-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const badClient = await formRequest(urls.tokenEndpoint, {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: "wrong-client-secret",
      code: code ?? "",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(badClient.status).toBe(401);
    expect(badClient.headers.get("www-authenticate")).toBe('Basic realm="Okta"');
    expect(badClient.headers.get("x-okta-request-id")).toBeTruthy();
    expect(await badClient.json()).toEqual({
      error: "invalid_client",
      error_description: "Client authentication failed.",
    });

    const tokenResponse = await formRequest(urls.tokenEndpoint, {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: code ?? "",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
    const token = await tokenResponse.json<{
      access_token: string;
      expires_in: number;
      id_token: string;
      refresh_token: string;
      scope: string;
      token_type: string;
    }>();
    expect(token).toMatchObject({
      expires_in: 3600,
      scope: "openid profile email offline_access",
      token_type: "Bearer",
    });
    expect(token.access_token).toBeTruthy();
    expect(token.id_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();

    const jwksResponse = await worker.fetch(urls.jwksUri);
    expect(jwksResponse.status).toBe(200);
    expect(jwksResponse.headers.get("cache-control")).toBe("public, max-age=300");
    const claims = await verifyJwt(
      token.id_token,
      await jwksResponse.json<{
        keys: Array<JsonWebKey & { kid?: string }>;
      }>()
    );
    expect(claims).toMatchObject({
      iss: issuer,
      aud: clientId,
      sub: userId,
      preferred_username: userName,
      email: userName,
      nonce: "okta-integration-nonce",
      ver: 1,
    });

    const active = await formRequest(urls.introspectionEndpoint, {
      token: token.access_token,
      token_type_hint: "access_token",
      client_id: clientId,
      client_secret: clientSecret,
    });
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({
      active: true,
      aud: clientId,
      client_id: clientId,
      iss: issuer,
      sub: userId,
      token_type: "Bearer",
      uid: userId,
      username: userName,
    });

    const revoked = await formRequest(urls.revocationEndpoint, {
      token: token.access_token,
      token_type_hint: "access_token",
      client_id: clientId,
      client_secret: clientSecret,
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.text()).toBe("");
    const inactive = await formRequest(urls.introspectionEndpoint, {
      token: token.access_token,
      client_id: clientId,
      client_secret: clientSecret,
    });
    expect(await inactive.json()).toEqual({ active: false });

    const pendingAuthorization = await formRequest(urls.deviceAuthorizationEndpoint, {
      client_id: clientId,
      scope: "openid profile offline_access",
    });
    expect(pendingAuthorization.status).toBe(200);
    const pendingDevice = await pendingAuthorization.json<{
      device_code: string;
      expires_in: number;
      interval: number;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
    }>();
    expect(pendingDevice).toMatchObject({
      expires_in: 600,
      interval: 5,
      verification_uri: `${publicBase}/activate`,
    });
    expect(pendingDevice.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{8}$/);

    const pendingPoll = await formRequest(urls.tokenEndpoint, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: pendingDevice.device_code,
    });
    expect(pendingPoll.status).toBe(400);
    expect(pendingPoll.headers.get("x-okta-request-id")).toBeTruthy();
    expect(await pendingPoll.json()).toEqual({
      error: "authorization_pending",
      error_description: "The device authorization is pending. Please try again later.",
    });

    const approvedAuthorization = await formRequest(urls.deviceAuthorizationEndpoint, {
      client_id: clientId,
      scope: "openid profile offline_access",
    });
    const approvedDevice = await approvedAuthorization.json<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
    }>();
    const activationPage = await worker.fetch(approvedDevice.verification_uri_complete);
    expect(activationPage.status).toBe(200);
    expect(await activationPage.text()).toContain("Activate a device");

    const activation = await formRequest(approvedDevice.verification_uri, {
      user_code: approvedDevice.user_code,
      username: userName,
      password,
    });
    expect(activation.status, await activation.clone().text()).toBe(200);
    expect(await activation.text()).toContain("Device authorized");

    const deviceTokenResponse = await formRequest(urls.tokenEndpoint, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: approvedDevice.device_code,
    });
    expect(deviceTokenResponse.status, await deviceTokenResponse.clone().text()).toBe(
      200
    );
    expect(await deviceTokenResponse.json()).toMatchObject({
      expires_in: 3600,
      scope: "openid profile offline_access",
      token_type: "Bearer",
    });

    const unknownServer = await worker.fetch(
      `${publicBase}/oauth2/not-default/.well-known/openid-configuration`
    );
    expect(unknownServer.status).toBe(404);
    expect(unknownServer.headers.get("x-okta-request-id")).toBeTruthy();
    expect(await unknownServer.json()).toMatchObject({
      error: "invalid_request",
      error_description: "The requested authorization server was not found.",
    });

    const deleted = await callTool<{ deleted: true; environmentId: string }>(
      sessionId,
      "delete_environment",
      {}
    );
    expect(deleted).toEqual({
      deleted: true,
      environmentId: environment.id,
    });
  });
});
