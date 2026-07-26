#!/usr/bin/env node

import { OktaAuth } from "@okta/okta-auth-js";
import oktaAuthPackage from "@okta/okta-auth-js/package.json" with { type: "json" };
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.env.MOCKOS_OKTA_AUTHJS_E2E_ORIGIN;
const apiKey = process.env.MOCKOS_OKTA_AUTHJS_E2E_API_KEY;
const ownerNonce = process.env.MOCKOS_OKTA_AUTHJS_E2E_OWNER_NONCE;
const oktaAuthJsVersion = oktaAuthPackage.version;
const requestTimeoutMs = 10_000;

if (!origin || !apiKey || !ownerNonce) {
  throw new Error("The Okta Auth JS E2E child process is missing its bounded input.");
}
const parsedOrigin = new URL(origin);
if (
  parsedOrigin.protocol !== "https:" ||
  parsedOrigin.hostname !== "localhost" ||
  parsedOrigin.username ||
  parsedOrigin.password ||
  parsedOrigin.pathname !== "/" ||
  parsedOrigin.search ||
  parsedOrigin.hash
) {
  throw new Error(
    "The Okta Auth JS E2E origin must be a clean HTTPS localhost origin."
  );
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
};

const requireString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value;
};

const REDACTED = "[REDACTED]";
const sensitiveFormFields = [
  "access_token",
  "authorization_code",
  "client_assertion",
  "client_secret",
  "code",
  "code_verifier",
  "device_code",
  "id_token",
  "password",
  "refresh_token",
  "token",
  "user_code",
];

const formEncodedValue = (value) => {
  const encoded = new URLSearchParams({ value }).toString();
  return encoded.slice(encoded.indexOf("=") + 1);
};

const credentialRepresentations = (value) =>
  new Set([value, encodeURIComponent(value), formEncodedValue(value)]);

const requireFormBody = (entry, label) =>
  new URLSearchParams(requireString(entry.requestBody, `${label} request body`));

const assertSensitiveFormFieldsRedacted = (form, label) => {
  for (const field of sensitiveFormFields) {
    assert(
      form.getAll(field).every((value) => value === REDACTED),
      `${label} retained an unredacted ${field} field.`
    );
  }
};

const base64Url = (bytes) =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const pkceChallenge = async (verifier) =>
  base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );

const fetchWithTimeout = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(requestTimeoutMs)])
      : AbortSignal.timeout(requestTimeoutMs),
  });

const health = await fetchWithTimeout(`${origin}/health`);
assert(health.status === 200, `Worker health returned ${health.status}.`);
const healthBody = requireObject(await health.json(), "Worker health response");
assert(
  healthBody.service === "mockos" && healthBody.e2eOwnerNonce === ownerNonce,
  "The Okta Auth JS child did not connect to its owned Worker."
);

const headers = new Headers({
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${apiKey}`,
  "User-Agent": `mockos-okta-authjs-conformance/${oktaAuthJsVersion}`,
});
const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
  requestInit: { headers },
});
const mcp = new Client({
  name: "mockos-okta-authjs-conformance",
  version: oktaAuthJsVersion,
});

let connected = false;
let environmentId;
let authClient;
let cleanupError;

const call = async (name, input) => {
  const result = await mcp.callTool({ name, arguments: input }, undefined, {
    timeout: requestTimeoutMs,
  });
  if (result.isError) {
    const text = Array.isArray(result.content)
      ? result.content
          .filter(
            (item) =>
              item &&
              typeof item === "object" &&
              item.type === "text" &&
              typeof item.text === "string"
          )
          .map((item) => item.text)
          .join("\n")
      : "";
    throw new Error(`MCP ${name} failed${text ? `: ${text}` : "."}`);
  }
  const envelope = requireObject(result.structuredContent, `${name} result`);
  return requireObject(envelope.data, `${name} data`);
};

try {
  await mcp.connect(transport, { timeout: requestTimeoutMs });
  connected = true;
  const listed = await mcp.listTools(undefined, { timeout: requestTimeoutMs });
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  for (const name of [
    "create_environment",
    "seed_identities",
    "create_application",
    "get_wellknown_urls",
    "get_request_log",
    "assert_requests",
    "simulate_lifecycle",
    "delete_environment",
  ]) {
    assert(toolNames.has(name), `Management MCP tool ${name} is missing.`);
  }

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const environment = await call("create_environment", {
    name: `Okta Auth JS conformance ${suffix}`,
    provider: "okta",
    seed: `okta-authjs-${suffix}`,
  });
  environmentId = requireString(environment.id, "environment id");

  const userName = `ada-authjs-${suffix}@example.test`;
  const password = "Synthetic-AuthJS-Passw0rd!";
  const seeded = await call("seed_identities", {
    environmentId,
    users: [
      {
        userName,
        displayName: "Ada Auth JS",
        givenName: "Ada",
        familyName: "Auth JS",
        password,
        active: true,
        mfaState: "none",
        roles: [],
      },
    ],
    groups: [],
  });
  const users = Array.isArray(seeded.users) ? seeded.users : [];
  const userId = requireString(users[0]?.id, "seeded user id");

  const redirectUri = "https://client.example.test/mockos-okta-callback";
  const application = await call("create_application", {
    environmentId,
    name: "Pinned Okta Auth JS public PKCE client",
    clientType: "public",
    redirectUris: [redirectUri],
    grantTypes: ["authorization_code", "refresh_token"],
    appRoles: [],
    groupClaimsMode: "none",
  });
  assert(
    application.clientType === "public" && !Object.hasOwn(application, "clientSecret"),
    "Public application registration returned confidential credentials."
  );
  const clientId = requireString(application.clientId, "generated client id");
  const urls = await call("get_wellknown_urls", { environmentId });
  const issuer = requireString(urls.issuer, "Okta issuer");
  assert(
    new URL(issuer).origin === origin,
    "The returned Okta issuer does not use the owned Wrangler origin."
  );

  let authorizationLocation;
  const scopes = ["openid", "profile", "email", "offline_access"];
  const state = `authjs-state-${crypto.randomUUID()}`;
  const nonce = `authjs-nonce-${crypto.randomUUID()}`;
  authClient = new OktaAuth({
    issuer,
    clientId,
    redirectUri,
    scopes,
    pkce: true,
    responseMode: "query",
    setLocation: (location) => {
      authorizationLocation = location;
    },
    tokenManager: {
      storage: "memory",
      autoRenew: false,
      autoRemove: false,
      syncStorage: false,
    },
    transactionManager: {
      storage: "memory",
    },
  });
  authClient.token.parseFromUrl._getLocation = () => new URL(redirectUri);

  await authClient.token.getWithRedirect({
    state,
    nonce,
    loginHint: userName,
    scopes,
  });
  const authorization = new URL(
    requireString(authorizationLocation, "Auth JS authorization redirect")
  );
  assert(
    authorization.href.startsWith(
      `${requireString(urls.authorizationEndpoint, "authorization endpoint")}?`
    ),
    "Okta Auth JS did not use MockOS's authorization endpoint."
  );
  assert(
    authorization.searchParams.get("code_challenge_method") === "S256",
    "Okta Auth JS did not bind the authorization request to S256 PKCE."
  );
  const transaction = requireObject(
    authClient.transactionManager.load({ state }),
    "Auth JS transaction"
  );
  const verifier = requireString(
    transaction.codeVerifier,
    "Auth JS PKCE code verifier"
  );
  assert(
    authorization.searchParams.get("code_challenge") ===
      (await pkceChallenge(verifier)),
    "Okta Auth JS's persisted verifier did not match its S256 challenge."
  );
  const requestedScopes = new Set(
    (authorization.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean)
  );
  for (const scope of scopes) {
    assert(requestedScopes.has(scope), `Okta Auth JS omitted ${scope}.`);
  }

  const loginPage = await fetchWithTimeout(authorization);
  assert(loginPage.status === 200, `Hosted login returned ${loginPage.status}.`);
  const loginHtml = await loginPage.text();
  assert(
    loginHtml.includes("Okta simulation") &&
      loginHtml.includes("Never enter production credentials") &&
      loginHtml.includes('name="code_challenge"'),
    "Hosted login did not retain the Okta and synthetic-credential safeguards."
  );

  const loginForm = new URLSearchParams(authorization.searchParams);
  loginForm.set("username", userName);
  loginForm.set("password", password);
  const login = await fetchWithTimeout(authorization, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: loginForm,
    redirect: "manual",
  });
  assert(login.status === 302, `Hosted login submit returned ${login.status}.`);
  const callback = new URL(requireString(login.headers.get("location"), "callback"));
  assert(
    callback.origin + callback.pathname === redirectUri,
    "Hosted login redirected to an unregistered callback."
  );
  assert(
    callback.searchParams.get("state") === state,
    "OAuth state was not preserved."
  );
  const code = requireString(callback.searchParams.get("code"), "authorization code");

  const initial = await authClient.token.parseFromUrl({ url: callback.href });
  assert(initial.state === state, "Okta Auth JS parseFromUrl lost OAuth state.");
  const initialAccess = requireObject(
    initial.tokens.accessToken,
    "initial access-token object"
  );
  const initialId = requireObject(initial.tokens.idToken, "initial ID-token object");
  const initialRefresh = requireObject(
    initial.tokens.refreshToken,
    "initial refresh-token object"
  );
  const initialAccessToken = requireString(
    initialAccess.accessToken,
    "initial access token"
  );
  const initialIdToken = requireString(initialId.idToken, "initial ID token");
  const initialRefreshToken = requireString(
    initialRefresh.refreshToken,
    "initial refresh token"
  );
  const claims = requireObject(initialId.claims, "verified ID-token claims");
  assert(claims.iss === issuer, "Okta Auth JS ID-token issuer did not match.");
  assert(claims.aud === clientId, "Okta Auth JS ID-token audience did not match.");
  assert(claims.sub === userId, "Okta Auth JS ID-token subject did not match.");
  assert(
    claims.preferred_username === userName && claims.email === userName,
    "Okta Auth JS ID-token identity claims did not match."
  );
  assert(claims.nonce === nonce, "Okta Auth JS ID-token nonce did not match.");

  const refreshed = await authClient.token.renewTokens({
    tokens: initial.tokens,
  });
  const refreshedAccess = requireObject(
    refreshed.accessToken,
    "refreshed access-token object"
  );
  const refreshedRefresh = requireObject(
    refreshed.refreshToken,
    "rotated refresh-token object"
  );
  const refreshedAccessToken = requireString(
    refreshedAccess.accessToken,
    "refreshed access token"
  );
  const refreshedRefreshToken = requireString(
    refreshedRefresh.refreshToken,
    "rotated refresh token"
  );
  assert(
    refreshedAccessToken !== initialAccessToken &&
      refreshedRefreshToken !== initialRefreshToken,
    "Okta Auth JS refresh did not rotate the token family."
  );

  await authClient.token.revoke(refreshedAccess);

  const lifecycle = await call("simulate_lifecycle", {
    environmentId,
    userId,
    action: "suspend",
  });
  assert(
    lifecycle.currentState === "suspended" &&
      lifecycle.revoked?.refreshTokens >= 1 &&
      lifecycle.revoked?.accessTokens === 1,
    "SDK revocation did not leave exactly one access token for lifecycle suspension."
  );

  let suspendedRefreshError;
  try {
    await authClient.token.renewTokens({ tokens: refreshed });
  } catch (error) {
    suspendedRefreshError = error;
  }
  assert(
    suspendedRefreshError,
    "Okta Auth JS refresh unexpectedly succeeded after suspension."
  );
  assert(
    suspendedRefreshError.name === "OAuthError" &&
      suspendedRefreshError.errorCode === "invalid_grant" &&
      suspendedRefreshError.errorSummary === "User account is disabled.",
    "Okta Auth JS did not surface the expected suspended-user OAuth error."
  );

  const authorizationPath = new URL(urls.authorizationEndpoint).pathname;
  const discoveryPath = new URL(urls.openidConfiguration).pathname;
  const tokenPath = new URL(urls.tokenEndpoint).pathname;
  const jwksPath = new URL(urls.jwksUri).pathname;
  const revocationPath = new URL(urls.revocationEndpoint).pathname;
  const assertion = await call("assert_requests", {
    environmentId,
    sequence: [
      { source: "inbound", method: "GET", path: discoveryPath, status: 200 },
      { source: "inbound", method: "GET", path: authorizationPath, status: 200 },
      { source: "inbound", method: "POST", path: authorizationPath, status: 302 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "GET", path: jwksPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: revocationPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 400 },
    ],
    count: { exactly: 1 },
  });
  assert(
    assertion.pass === true && assertion.matched === 1,
    "The exact Okta Auth JS provider request sequence was not observable."
  );

  const providerLog = await call("get_request_log", {
    environmentId,
    source: "inbound",
    provider: "okta",
    limit: 50,
  });
  const providerEntries = Array.isArray(providerLog.entries) ? providerLog.entries : [];
  const tokenEntries = providerEntries.filter(
    (entry) => entry.method === "POST" && entry.path === tokenPath
  );
  assert(
    tokenEntries.length === 3,
    "Expected exactly three Okta Auth JS token requests."
  );
  const statuses = tokenEntries.map((entry) => entry.responseStatus).sort();
  assert(
    JSON.stringify(statuses) === JSON.stringify([200, 200, 400]),
    "Okta Auth JS token statuses did not match code, refresh, and suspended refresh."
  );

  const authorizationEntries = providerEntries.filter(
    (entry) =>
      entry.method === "POST" &&
      entry.path === authorizationPath &&
      entry.responseStatus === 302
  );
  assert(
    authorizationEntries.length === 1,
    "Expected exactly one successful hosted-login submission."
  );
  const authorizationEntry = authorizationEntries[0];
  const authorizationForm = requireFormBody(authorizationEntry, "authorization");
  assertSensitiveFormFieldsRedacted(authorizationForm, "Authorization request");
  assert(
    authorizationForm.get("password") === REDACTED,
    "Authorization request password was not structurally redacted."
  );
  const redactedLocation = new URL(
    requireString(
      authorizationEntry.responseHeaders?.location,
      "authorization response location"
    )
  );
  assert(
    redactedLocation.searchParams.get("code") === REDACTED,
    "Authorization response code was not structurally redacted."
  );

  const parsedTokenEntries = tokenEntries.map((entry) => ({
    entry,
    form: requireFormBody(entry, "token"),
  }));
  for (const { form } of parsedTokenEntries) {
    assertSensitiveFormFieldsRedacted(form, "Token request");
  }
  const authorizationCodeEntries = parsedTokenEntries.filter(
    ({ form }) => form.get("grant_type") === "authorization_code"
  );
  assert(
    authorizationCodeEntries.length === 1,
    "Expected exactly one authorization-code token request."
  );
  assert(
    authorizationCodeEntries[0].form.get("code") === REDACTED &&
      authorizationCodeEntries[0].form.get("code_verifier") === REDACTED,
    "Authorization-code exchange fields were not structurally redacted."
  );
  const refreshEntries = parsedTokenEntries.filter(
    ({ form }) => form.get("grant_type") === "refresh_token"
  );
  assert(
    refreshEntries.length === 2 &&
      refreshEntries.every(({ form }) => form.get("refresh_token") === REDACTED),
    "Refresh-token request fields were not structurally redacted."
  );

  const revocationEntries = providerEntries.filter(
    (entry) =>
      entry.method === "POST" &&
      entry.path === revocationPath &&
      entry.responseStatus === 200
  );
  assert(
    revocationEntries.length === 1,
    "Expected exactly one successful Okta Auth JS revocation request."
  );
  const revocationForm = requireFormBody(revocationEntries[0], "revocation");
  assertSensitiveFormFieldsRedacted(revocationForm, "Revocation request");
  assert(
    revocationForm.get("token") === REDACTED,
    "Revocation token was not structurally redacted."
  );

  const successfulTokenEntries = tokenEntries.filter(
    (entry) => entry.responseStatus === 200
  );
  assert(
    successfulTokenEntries.length === 2,
    "Expected exactly two successful token responses."
  );
  for (const entry of successfulTokenEntries) {
    const response = requireObject(
      JSON.parse(requireString(entry.responseBody, "token response body")),
      "token response"
    );
    for (const field of ["access_token", "id_token", "refresh_token"]) {
      assert(
        response[field] === REDACTED,
        `Successful token response did not redact ${field}.`
      );
    }
  }

  const serializedLog = JSON.stringify(providerEntries);
  const credentials = [
    ["password", password],
    ["authorization code", code],
    ["PKCE verifier", verifier],
    ["initial access token", initialAccessToken],
    ["initial ID token", initialIdToken],
    ["initial refresh token", initialRefreshToken],
    ["refreshed access token", refreshedAccessToken],
    ["refreshed refresh token", refreshedRefreshToken],
  ];
  for (const [label, credential] of credentials) {
    for (const representation of credentialRepresentations(credential)) {
      assert(
        !serializedLog.includes(representation),
        `Request-log evidence exposed the ${label} in raw or encoded form.`
      );
    }
  }

  const deleted = await call("delete_environment", { environmentId });
  assert(
    deleted.deleted === true && deleted.environmentId === environmentId,
    "Okta Auth JS E2E environment cleanup was not confirmed."
  );
  environmentId = undefined;

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      claim: "okta-authjs-public-authorization-code-pkce",
      oktaAuthJsVersion,
      clientType: "public",
      networkBoundary: "wrangler-dev-https",
      managementInterface: "mcp-streamable-http",
      environmentDeleted: true,
      providerSequenceMatched: assertion.matched,
      tokenStatuses: statuses,
      revocationStatus: 200,
      lifecycleAction: "suspend",
      lifecycleErrorCode: suspendedRefreshError.errorCode,
      logRedaction: "raw-url-form-encoded-and-structural-sensitive-field-verification",
    })}\n`
  );
} finally {
  if (authClient) {
    try {
      await authClient.stop();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (connected && environmentId) {
    try {
      await call("delete_environment", { environmentId });
      environmentId = undefined;
    } catch (error) {
      cleanupError ??= error;
    }
  }
  try {
    if (transport.sessionId) await transport.terminateSession();
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    await mcp.close();
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError) {
    process.stderr.write(
      `Okta Auth JS E2E cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error"
      }\n`
    );
    process.exitCode = 1;
  }
}
