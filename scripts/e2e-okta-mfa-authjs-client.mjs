#!/usr/bin/env node

import { OktaAuth } from "@okta/okta-auth-js";
import oktaAuthPackage from "@okta/okta-auth-js/package.json" with { type: "json" };
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  classicMfaOidcProviderSequence,
  EXPECTED_OKTA_AUTH_JS_VERSION,
  requireOwnedFactorVerifyUrl,
  SYNTHETIC_TOTP_PASS_CODE,
} from "./e2e-okta-mfa-authjs-contract.mjs";

const origin = process.env.MOCKOS_OKTA_MFA_AUTHJS_E2E_ORIGIN;
const apiKey = process.env.MOCKOS_OKTA_MFA_AUTHJS_E2E_API_KEY;
const ownerNonce = process.env.MOCKOS_OKTA_MFA_AUTHJS_E2E_OWNER_NONCE;
const oktaAuthJsVersion = oktaAuthPackage.version;
const requestTimeoutMs = 10_000;

if (!origin || !apiKey || !ownerNonce) {
  throw new Error(
    "The Okta Auth JS Classic MFA E2E child process is missing its bounded input."
  );
}
if (oktaAuthJsVersion !== EXPECTED_OKTA_AUTH_JS_VERSION) {
  throw new Error(
    `Expected @okta/okta-auth-js ${EXPECTED_OKTA_AUTH_JS_VERSION}, received ${oktaAuthJsVersion}.`
  );
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
    "The Okta Auth JS Classic MFA E2E origin must be a clean HTTPS localhost origin."
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

const requireArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array.`);
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
  "sessionToken",
  "stateToken",
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

const requireJsonBody = (body, label) => {
  try {
    return requireObject(JSON.parse(requireString(body, label)), label);
  } catch (cause) {
    throw new Error(`Expected ${label} to contain a JSON object.`, { cause });
  }
};

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
  "The Okta Auth JS Classic MFA child did not connect to its owned Worker."
);

const headers = new Headers({
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${apiKey}`,
  "User-Agent": `mockos-okta-mfa-authjs-conformance/${oktaAuthJsVersion}`,
});
const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
  requestInit: { headers },
});
const mcp = new Client({
  name: "mockos-okta-mfa-authjs-conformance",
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
    name: `Okta Auth JS Classic MFA conformance ${suffix}`,
    provider: "okta",
    seed: `okta-mfa-authjs-${suffix}`,
  });
  environmentId = requireString(environment.id, "environment id");

  const userName = `ada-mfa-authjs-${suffix}@example.test`;
  const password = "Synthetic-MFA-AuthJS-Passw0rd!";
  const seeded = await call("seed_identities", {
    environmentId,
    users: [
      {
        userName,
        displayName: "Ada MFA Auth JS",
        givenName: "Ada",
        familyName: "MFA Auth JS",
        password,
        passwordState: "valid",
        active: true,
        mfaState: "required",
        roles: [],
      },
    ],
    groups: [],
  });
  const users = requireArray(seeded.users, "seeded users");
  const userId = requireString(users[0]?.id, "seeded user id");

  const redirectUri = "https://client.example.test/mockos-okta-mfa-callback";
  const application = await call("create_application", {
    environmentId,
    name: "Pinned Okta Auth JS Classic MFA public PKCE client",
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
  const authnEndpoint = requireString(
    urls.oktaAuthnEndpoint,
    "Okta Classic Authn endpoint"
  );
  assert(
    new URL(issuer).origin === origin &&
      authnEndpoint === `${origin}/e/${environmentId}/api/v1/authn`,
    "Returned Okta endpoints do not use the owned Wrangler environment."
  );

  let authorizationLocation;
  const scopes = ["openid", "profile", "email", "offline_access"];
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

  const mfaTransaction = await authClient.signInWithCredentials({
    username: userName,
    password,
  });
  assert(
    mfaTransaction.status === "MFA_REQUIRED" &&
      !Object.hasOwn(mfaTransaction, "sessionToken"),
    "Okta Auth JS did not surface the expected MFA_REQUIRED transaction."
  );
  const factors = requireArray(
    mfaTransaction.factor,
    "Okta Auth JS singular factor collection"
  );
  assert(
    !Object.hasOwn(mfaTransaction, "factors") && factors.length === 1,
    "Okta Auth JS did not preserve the singular bounded factor collection."
  );
  const factor = requireObject(factors[0], "Okta Auth JS factor");
  assert(
    factor.id === `mfa_${userId}` &&
      factor.factorType === "token:software:totp" &&
      factor.provider === "OKTA" &&
      typeof factor.verify === "function",
    "Okta Auth JS did not materialize the expected synthetic TOTP factor."
  );
  const rawMfaTransaction = requireObject(
    mfaTransaction.data,
    "raw Okta MFA transaction"
  );
  const rawFactors = requireArray(
    requireObject(rawMfaTransaction._embedded, "raw Okta MFA embedded body").factor,
    "raw Okta MFA factor collection"
  );
  const rawFactor = requireObject(rawFactors[0], "raw Okta MFA factor");
  const verifyUrl = requireOwnedFactorVerifyUrl({
    authnEndpoint,
    href: requireString(
      requireObject(
        requireObject(rawFactor._links, "raw Okta factor links").verify,
        "raw Okta factor verify link"
      ).href,
      "raw Okta factor verify href"
    ),
    origin,
    userId,
  });
  const stateToken = requireString(
    rawMfaTransaction.stateToken,
    "Okta MFA state token"
  );

  const successTransaction = await factor.verify({
    passCode: SYNTHETIC_TOTP_PASS_CODE,
  });
  assert(
    successTransaction.status === "SUCCESS" &&
      !Object.hasOwn(successTransaction, "stateToken"),
    "Okta Auth JS did not surface SUCCESS after factor verification."
  );
  const sessionToken = requireString(
    successTransaction.sessionToken,
    "Okta Auth JS session token"
  );
  assert(
    successTransaction.user?.id === userId,
    "Okta Auth JS SUCCESS transaction changed the authenticated subject."
  );

  const state = `authjs-mfa-state-${crypto.randomUUID()}`;
  const nonce = `authjs-mfa-nonce-${crypto.randomUUID()}`;
  await authClient.token.getWithRedirect({
    state,
    nonce,
    sessionToken,
    scopes,
  });
  const authorization = new URL(
    requireString(authorizationLocation, "Auth JS authorization redirect")
  );
  assert(
    authorization.href.startsWith(
      `${requireString(urls.authorizationEndpoint, "authorization endpoint")}?`
    ) && authorization.searchParams.get("sessionToken") === sessionToken,
    "Okta Auth JS did not hand the Classic session token to MockOS authorization."
  );
  assert(
    authorization.searchParams.get("code_challenge_method") === "S256",
    "Okta Auth JS did not bind the authorization request to S256 PKCE."
  );
  const oauthTransaction = requireObject(
    authClient.transactionManager.load({ state }),
    "Auth JS OAuth transaction"
  );
  const verifier = requireString(
    oauthTransaction.codeVerifier,
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

  const authorizationResponse = await fetchWithTimeout(authorization, {
    redirect: "manual",
  });
  assert(
    authorizationResponse.status === 302,
    `Session-token authorization returned ${authorizationResponse.status}.`
  );
  const callback = new URL(
    requireString(authorizationResponse.headers.get("location"), "callback")
  );
  assert(
    callback.origin + callback.pathname === redirectUri,
    "Session-token authorization redirected to an unregistered callback."
  );
  assert(
    callback.searchParams.get("state") === state,
    "Session-token authorization did not preserve OAuth state."
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
  const accessClaims = requireObject(
    requireObject(
      authClient.token.decode(initialAccessToken),
      "decoded access-token object"
    ).payload,
    "decoded access-token payload"
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
  assert(
    accessClaims.acr === "urn:okta:loa:1fa:any" &&
      JSON.stringify(claims.amr) === JSON.stringify(["pwd"]),
    "The bounded handoff changed the currently qualified Okta acr/amr claims."
  );

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

  const authnPath = new URL(authnEndpoint).pathname;
  const authorizationPath = new URL(urls.authorizationEndpoint).pathname;
  const discoveryPath = new URL(urls.openidConfiguration).pathname;
  const factorVerifyPath = verifyUrl.pathname;
  const tokenPath = new URL(urls.tokenEndpoint).pathname;
  const jwksPath = new URL(urls.jwksUri).pathname;
  const revocationPath = new URL(urls.revocationEndpoint).pathname;
  const expectedSequence = classicMfaOidcProviderSequence({
    authnPath,
    authorizationPath,
    discoveryPath,
    factorVerifyPath,
    jwksPath,
    revocationPath,
    tokenPath,
  });
  const assertion = await call("assert_requests", {
    environmentId,
    sequence: expectedSequence,
    count: { exactly: 1 },
  });
  assert(
    assertion.pass === true && assertion.matched === 1,
    "The exact Okta Auth JS Classic MFA provider sequence was not observable."
  );

  const providerLog = await call("get_request_log", {
    environmentId,
    source: "inbound",
    provider: "okta",
    limit: 50,
  });
  const providerEntries = requireArray(
    providerLog.entries,
    "Okta provider log entries"
  );
  assert(
    providerEntries.length === expectedSequence.length,
    "The Okta Classic MFA qualification observed unexpected provider traffic."
  );

  const authnEntries = providerEntries.filter(
    (entry) => entry.method === "POST" && entry.path === authnPath
  );
  assert(authnEntries.length === 1, "Expected exactly one primary Authn request.");
  const authnRequest = requireJsonBody(
    authnEntries[0].requestBody,
    "primary Authn request body"
  );
  const authnResponse = requireJsonBody(
    authnEntries[0].responseBody,
    "primary Authn response body"
  );
  assert(
    authnRequest.username === userName &&
      authnRequest.password === REDACTED &&
      authnResponse.status === "MFA_REQUIRED" &&
      authnResponse.stateToken === REDACTED,
    "Primary Authn evidence did not preserve safe fields and redact credentials."
  );

  const factorEntries = providerEntries.filter(
    (entry) => entry.method === "POST" && entry.path === factorVerifyPath
  );
  assert(
    factorEntries.length === 1,
    "Expected exactly one factor verification request."
  );
  const factorRequest = requireJsonBody(
    factorEntries[0].requestBody,
    "factor verification request body"
  );
  const factorResponse = requireJsonBody(
    factorEntries[0].responseBody,
    "factor verification response body"
  );
  assert(
    factorRequest.stateToken === REDACTED &&
      factorRequest.passCode === REDACTED &&
      factorResponse.status === "SUCCESS" &&
      factorResponse.sessionToken === REDACTED,
    "Factor verification evidence did not structurally redact its capabilities."
  );

  const authorizationEntries = providerEntries.filter(
    (entry) =>
      entry.method === "GET" &&
      entry.path === authorizationPath &&
      entry.responseStatus === 302
  );
  assert(
    authorizationEntries.length === 1,
    "Expected exactly one session-token authorization request."
  );
  const redactedLocation = new URL(
    requireString(
      authorizationEntries[0].responseHeaders?.location,
      "authorization response location"
    )
  );
  assert(
    redactedLocation.searchParams.get("code") === REDACTED,
    "Authorization response code was not structurally redacted."
  );

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
    authorizationCodeEntries.length === 1 &&
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
    const response = requireJsonBody(entry.responseBody, "token response body");
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
    ["synthetic factor passcode", SYNTHETIC_TOTP_PASS_CODE],
    ["MFA state token", stateToken],
    ["Classic session token", sessionToken],
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
    "Okta Auth JS Classic MFA E2E environment cleanup was not confirmed."
  );
  environmentId = undefined;

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      claim: "okta-authjs-classic-mfa-session-token-authorization-code-pkce",
      oktaAuthJsVersion,
      clientType: "public",
      networkBoundary: "wrangler-dev-https",
      managementInterface: "mcp-streamable-http",
      environmentDeleted: true,
      providerSequenceMatched: assertion.matched,
      providerRequestCount: providerEntries.length,
      tokenStatuses: statuses,
      factorType: factor.factorType,
      lifecycleAction: "suspend",
      lifecycleErrorCode: suspendedRefreshError.errorCode,
      mfaProvenanceClaim: "not-qualified-existing-1fa-claims-preserved",
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
      `Okta Auth JS Classic MFA E2E cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error"
      }\n`
    );
    process.exitCode = 1;
  }
}
