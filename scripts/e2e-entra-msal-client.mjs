#!/usr/bin/env node

import {
  ConfidentialClientApplication,
  CryptoProvider,
  version as msalVersion,
  ProtocolMode,
} from "@azure/msal-node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.env.MOCKOS_ENTRA_MSAL_E2E_ORIGIN;
const apiKey = process.env.MOCKOS_ENTRA_MSAL_E2E_API_KEY;
const ownerNonce = process.env.MOCKOS_ENTRA_MSAL_E2E_OWNER_NONCE;
const requestTimeoutMs = 10_000;

if (!origin || !apiKey || !ownerNonce) {
  throw new Error("The MSAL E2E child process is missing its bounded input.");
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
  throw new Error("The MSAL E2E origin must be a clean HTTPS localhost origin.");
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
  "The MSAL child did not connect to its owned Worker."
);

const headers = new Headers({
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${apiKey}`,
  "User-Agent": `mockos-msal-node-conformance/${msalVersion}`,
});
const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
  requestInit: { headers },
});
const mcp = new Client({
  name: "mockos-msal-node-conformance",
  version: msalVersion,
});

let connected = false;
let environmentId;
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
    name: `MSAL Node conformance ${suffix}`,
    provider: "entra",
    seed: `msal-node-${suffix}`,
  });
  environmentId = requireString(environment.id, "environment id");
  const tenantId = requireString(environment.tenantId, "tenant id");

  const userName = `ada-msal-${suffix}@example.test`;
  const password = "Synthetic-MSAL-Passw0rd!";
  const seeded = await call("seed_identities", {
    environmentId,
    users: [
      {
        userName,
        displayName: "Ada MSAL",
        givenName: "Ada",
        familyName: "MSAL",
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

  const redirectUri = "https://client.example.test/mockos-msal-callback";
  const application = await call("create_application", {
    environmentId,
    name: "Pinned MSAL Node confidential client",
    redirectUris: [redirectUri],
    grantTypes: ["authorization_code", "refresh_token"],
    appRoles: [],
    groupClaimsMode: "none",
  });
  const clientId = requireString(application.clientId, "generated client id");
  const clientSecret = requireString(
    application.clientSecret,
    "display-once generated client secret"
  );
  const urls = await call("get_wellknown_urls", { environmentId });
  const authority = requireString(urls.issuer, "Entra issuer");
  assert(
    new URL(authority).origin === origin,
    "The returned Entra issuer does not use the owned Wrangler origin."
  );

  const app = new ConfidentialClientApplication({
    auth: {
      authority,
      clientId,
      clientSecret,
      knownAuthorities: [new URL(authority).host],
    },
    system: { protocolMode: ProtocolMode.OIDC },
  });
  const scopes = ["openid", "profile", "email"];
  const state = `msal-state-${crypto.randomUUID()}`;
  const nonce = `msal-nonce-${crypto.randomUUID()}`;
  const pkce = await new CryptoProvider().generatePkceCodes();
  const authorizationUrl = await app.getAuthCodeUrl({
    scopes,
    redirectUri,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: "S256",
    loginHint: userName,
    nonce,
    state,
  });
  const authorization = new URL(authorizationUrl);
  assert(
    authorization.href.startsWith(
      `${requireString(urls.authorizationEndpoint, "authorization endpoint")}?`
    ),
    "MSAL did not use MockOS's discovered authorization endpoint."
  );
  assert(
    authorization.searchParams.get("code_challenge_method") === "S256" &&
      authorization.searchParams.get("code_challenge") === pkce.challenge,
    "MSAL did not bind the authorization request to S256 PKCE."
  );
  const requestedScopes = new Set(
    (authorization.searchParams.get("scope") ?? "").split(/\s+/).filter(Boolean)
  );
  for (const scope of [...scopes, "offline_access"]) {
    assert(requestedScopes.has(scope), `MSAL authorization omitted ${scope}.`);
  }

  const loginPage = await fetchWithTimeout(authorization);
  assert(loginPage.status === 200, `Hosted login returned ${loginPage.status}.`);
  const loginHtml = await loginPage.text();
  assert(
    loginHtml.includes("Never enter production credentials") &&
      loginHtml.includes('name="code_challenge"'),
    "Hosted login did not retain the synthetic-credential and PKCE safeguards."
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

  const initial = await app.acquireTokenByCode({
    code,
    codeVerifier: pkce.verifier,
    redirectUri,
    scopes,
    state,
  });
  assert(initial.account, "MSAL returned no account.");
  assert(initial.account.username === userName, "MSAL account username did not match.");
  assert(initial.account.tenantId === tenantId, "MSAL account tenant did not match.");
  assert(initial.tenantId === tenantId, "MSAL result tenant did not match.");
  assert(initial.idTokenClaims?.nonce === nonce, "MSAL ID-token nonce did not match.");
  assert(initial.idTokenClaims?.tid === tenantId, "MSAL ID-token tid did not match.");
  assert(initial.idTokenClaims?.oid === userId, "MSAL ID-token oid did not match.");
  assert(initial.accessToken.length > 100, "MSAL returned no usable access token.");
  assert(initial.idToken.length > 100, "MSAL returned no usable ID token.");

  const refreshed = await app.acquireTokenSilent({
    account: initial.account,
    forceRefresh: true,
    scopes,
  });
  assert(refreshed.account?.username === userName, "MSAL refresh lost the account.");
  assert(refreshed.accessToken.length > 100, "MSAL refresh returned no access token.");

  const lifecycle = await call("simulate_lifecycle", {
    environmentId,
    userId,
    action: "disable",
  });
  assert(
    lifecycle.currentState === "disabled" &&
      lifecycle.revoked?.refreshTokens >= 1 &&
      lifecycle.revoked?.accessTokens >= 1,
    "Lifecycle disable did not revoke the MSAL token family."
  );

  let disabledRefreshError;
  try {
    await app.acquireTokenSilent({
      account: initial.account,
      forceRefresh: true,
      scopes,
    });
  } catch (error) {
    disabledRefreshError = error;
  }
  assert(disabledRefreshError, "MSAL refresh unexpectedly succeeded after disable.");
  assert(
    disabledRefreshError.errorCode === "invalid_grant" &&
      String(disabledRefreshError.message).includes("AADSTS50057"),
    "MSAL did not surface the expected disabled-user refresh error."
  );

  const authorizationPath = new URL(urls.authorizationEndpoint).pathname;
  const discoveryPath = new URL(urls.openidConfiguration).pathname;
  const tokenPath = new URL(urls.tokenEndpoint).pathname;
  const assertion = await call("assert_requests", {
    environmentId,
    sequence: [
      { source: "inbound", method: "GET", path: discoveryPath, status: 200 },
      { source: "inbound", method: "GET", path: authorizationPath, status: 200 },
      { source: "inbound", method: "POST", path: authorizationPath, status: 302 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 400 },
    ],
    count: { exactly: 1 },
  });
  assert(
    assertion.pass === true && assertion.matched === 1,
    "The exact MSAL provider request sequence was not observable."
  );

  const providerLog = await call("get_request_log", {
    environmentId,
    source: "inbound",
    provider: "entra",
    limit: 50,
  });
  const providerEntries = Array.isArray(providerLog.entries) ? providerLog.entries : [];
  const tokenEntries = providerEntries.filter(
    (entry) => entry.method === "POST" && entry.path === tokenPath
  );
  assert(tokenEntries.length === 3, "Expected exactly three MSAL token requests.");
  const statuses = tokenEntries.map((entry) => entry.responseStatus).sort();
  assert(
    JSON.stringify(statuses) === JSON.stringify([200, 200, 400]),
    "MSAL token request statuses did not match code, refresh, and disabled refresh."
  );
  const serializedLog = JSON.stringify(providerEntries);
  for (const secret of [
    password,
    clientSecret,
    code,
    pkce.verifier,
    initial.accessToken,
    initial.idToken,
    refreshed.accessToken,
  ]) {
    assert(
      !serializedLog.includes(secret),
      "Request-log evidence exposed a credential."
    );
  }

  const deleted = await call("delete_environment", { environmentId });
  assert(
    deleted.deleted === true && deleted.environmentId === environmentId,
    "MSAL E2E environment cleanup was not confirmed."
  );
  environmentId = undefined;

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      claim: "msal-node-custom-authority-authorization-code-pkce",
      msalVersion,
      protocolMode: "OIDC",
      networkBoundary: "wrangler-dev-https",
      managementInterface: "mcp-streamable-http",
      environmentDeleted: true,
      providerSequenceMatched: assertion.matched,
      tokenStatuses: statuses,
      lifecycleErrorCode: disabledRefreshError.errorCode,
    })}\n`
  );
} finally {
  if (connected && environmentId) {
    try {
      await call("delete_environment", { environmentId });
      environmentId = undefined;
    } catch (error) {
      cleanupError = error;
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
      `MSAL E2E cleanup failed: ${
        cleanupError instanceof Error ? cleanupError.message : "unknown cleanup error"
      }\n`
    );
    process.exitCode = 1;
  }
}
