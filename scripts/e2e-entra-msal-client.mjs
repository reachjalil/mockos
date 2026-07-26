#!/usr/bin/env node

import {
  ConfidentialClientApplication,
  CryptoProvider,
  version as msalVersion,
  ProtocolMode,
  PublicClientApplication,
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

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  const deviceApplication = await call("create_application", {
    environmentId,
    name: "Pinned MSAL Node public device client",
    clientType: "public",
    redirectUris: [],
    grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    appRoles: [],
    groupClaimsMode: "none",
  });
  assert(
    deviceApplication.clientType === "public" &&
      deviceApplication.clientSecret === undefined &&
      Array.isArray(deviceApplication.redirectUris) &&
      deviceApplication.redirectUris.length === 0,
    "The MSAL device application was not a redirect-free, secret-free public client."
  );
  const deviceClientId = requireString(
    deviceApplication.clientId,
    "generated public device client id"
  );
  const urls = await call("get_wellknown_urls", { environmentId });
  const authority = requireString(urls.issuer, "Entra issuer");
  assert(
    new URL(authority).origin === origin,
    "The returned Entra issuer does not use the owned Wrangler origin."
  );
  const authorizationPath = new URL(
    requireString(urls.authorizationEndpoint, "authorization endpoint")
  ).pathname;
  const discoveryPath = new URL(
    requireString(urls.openidConfiguration, "OpenID configuration endpoint")
  ).pathname;
  const tokenPath = new URL(requireString(urls.tokenEndpoint, "token endpoint"))
    .pathname;
  const deviceAuthorizationEndpoint = requireString(
    urls.deviceAuthorizationEndpoint,
    "device authorization endpoint"
  );
  const deviceAuthorizationPath = new URL(deviceAuthorizationEndpoint).pathname;

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
  const initialTokenId = requireString(initial.idTokenClaims?.uti, "MSAL ID-token uti");
  assert(initial.accessToken.length > 100, "MSAL returned no usable access token.");
  assert(initial.idToken.length > 100, "MSAL returned no usable ID token.");

  const refreshed = await app.acquireTokenSilent({
    account: initial.account,
    forceRefresh: true,
    scopes,
  });
  assert(refreshed.account?.username === userName, "MSAL refresh lost the account.");
  assert(refreshed.accessToken.length > 100, "MSAL refresh returned no access token.");
  assert(
    requireString(refreshed.idTokenClaims?.uti, "refreshed MSAL ID-token uti") !==
      initialTokenId,
    "MSAL refresh did not rotate the Microsoft token identifier."
  );

  const deviceClient = new PublicClientApplication({
    auth: {
      authority,
      clientId: deviceClientId,
      knownAuthorities: [new URL(authority).host],
    },
    system: { protocolMode: ProtocolMode.OIDC },
  });
  const deviceScopes = ["openid", "profile", "email", "offline_access"];
  let deviceCodeCallbackCount = 0;
  let resolveDeviceCodeResponse;
  let rejectDeviceCodeResponse;
  const deviceCodeResponsePromise = new Promise((resolve, reject) => {
    resolveDeviceCodeResponse = resolve;
    rejectDeviceCodeResponse = reject;
  });
  const deviceRequest = {
    scopes: deviceScopes,
    timeout: 30,
    deviceCodeCallback(response) {
      deviceCodeCallbackCount += 1;
      try {
        const candidate = requireObject(response, "MSAL device-code callback");
        assert(
          deviceCodeCallbackCount === 1,
          "MSAL invoked the device-code callback more than once."
        );
        const userCode = requireString(candidate.userCode, "device user code");
        const deviceCode = requireString(candidate.deviceCode, "device code");
        const verificationUri = requireString(
          candidate.verificationUri,
          "device verification URI"
        );
        const message = requireString(candidate.message, "device-code message");
        assert(
          candidate.expiresIn === 900 && candidate.interval === 5,
          "MSAL did not receive the Entra 900-second, five-second device policy."
        );
        assert(
          /^[BCDFGHJKLMNPQRSTVWXYZ2-9]{8}$/.test(userCode),
          "The returned device user code did not match the bounded MockOS alphabet."
        );
        const verification = new URL(verificationUri);
        assert(
          verification.origin === origin &&
            verification.pathname.endsWith("/devicelogin") &&
            !verification.username &&
            !verification.password &&
            !verification.search &&
            !verification.hash,
          "The device verification URI was not a clean owned /devicelogin URL."
        );
        assert(
          message.includes(userCode) && message.includes(verificationUri),
          "The device-code message did not contain its code and verification URI."
        );
        resolveDeviceCodeResponse({
          deviceCode,
          expiresIn: candidate.expiresIn,
          interval: candidate.interval,
          message,
          userCode,
          verificationUri,
        });
      } catch (error) {
        deviceRequest.cancel = true;
        rejectDeviceCodeResponse(error);
      }
    },
  };

  const deviceTokenPromise = deviceClient.acquireTokenByDeviceCode(deviceRequest);
  const activationPromise = (async () => {
    const deviceCodeResponse = await deviceCodeResponsePromise;
    assert(
      deviceAuthorizationPath.endsWith("/oauth2/v2.0/devicecode"),
      "Management did not return the Entra /devicecode endpoint."
    );

    const pendingDeadline = Date.now() + 5_000;
    let pendingObserved = false;
    while (Date.now() < pendingDeadline && !pendingObserved) {
      const log = await call("get_request_log", {
        environmentId,
        source: "inbound",
        provider: "entra",
        limit: 50,
      });
      const entries = Array.isArray(log.entries) ? log.entries : [];
      pendingObserved = entries.some(
        (entry) =>
          entry.method === "POST" &&
          entry.path === tokenPath &&
          entry.responseStatus === 400 &&
          typeof entry.responseBody === "string" &&
          entry.responseBody.includes('"authorization_pending"')
      );
      if (!pendingObserved) await delay(25);
    }
    assert(
      pendingObserved,
      "MSAL's immediate authorization_pending device poll was not observable."
    );

    const activationUrl = new URL(deviceCodeResponse.verificationUri);
    activationUrl.searchParams.set("user_code", deviceCodeResponse.userCode);
    const activationPage = await fetchWithTimeout(activationUrl);
    assert(
      activationPage.status === 200,
      `Device activation page returned ${activationPage.status}.`
    );
    const activationHtml = await activationPage.text();
    assert(
      activationHtml.includes("Never enter production credentials") &&
        activationHtml.includes('name="user_code"') &&
        activationHtml.includes('name="decision"'),
      "Device activation did not retain the synthetic-credential and decision safeguards."
    );

    const activationForm = new URLSearchParams({
      decision: "approve",
      password,
      user_code: deviceCodeResponse.userCode,
      username: userName,
    });
    const activation = await fetchWithTimeout(deviceCodeResponse.verificationUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: activationForm,
    });
    const activationBody = await activation.text();
    assert(
      activation.status === 200 && activationBody.includes("Device authorized"),
      `Device activation failed with ${activation.status}.`
    );
    // Wrangler proxies local traffic to a separately managed user Worker. Keep
    // that loopback active while MSAL honors Entra's five-second polling floor,
    // so a local proxy idle disconnect cannot masquerade as provider behavior.
    await delay(2_500);
    const loopbackHealth = await fetchWithTimeout(`${origin}/health`);
    assert(
      loopbackHealth.status === 200,
      `Wrangler loopback health returned ${loopbackHealth.status}.`
    );
    const loopbackHealthBody = requireObject(
      await loopbackHealth.json(),
      "Wrangler loopback health response"
    );
    assert(
      loopbackHealthBody.service === "mockos" &&
        loopbackHealthBody.e2eOwnerNonce === ownerNonce,
      "The device wait crossed into a different local Worker."
    );
    return {
      ...deviceCodeResponse,
      activationPath: activationUrl.pathname,
      activationStatus: activation.status,
    };
  })();

  const [deviceResult, deviceActivation] = await Promise.all([
    deviceTokenPromise,
    activationPromise,
  ]);
  assert(deviceResult, "MSAL returned no public device-code result.");
  assert(
    deviceResult.fromCache === false,
    "MSAL device acquisition did not use the network."
  );
  assert(deviceResult.account, "MSAL device acquisition returned no account.");
  assert(
    deviceResult.account.username === userName &&
      deviceResult.account.tenantId === tenantId &&
      deviceResult.tenantId === tenantId,
    "MSAL device account identity did not match the seeded User and tenant."
  );
  assert(
    deviceResult.idTokenClaims?.tid === tenantId &&
      deviceResult.idTokenClaims?.oid === userId,
    "MSAL device ID-token identity claims did not match."
  );
  const deviceTokenId = requireString(
    deviceResult.idTokenClaims?.uti,
    "MSAL device ID-token uti"
  );
  assert(
    deviceResult.accessToken.length > 100 && deviceResult.idToken.length > 100,
    "MSAL device acquisition returned unusable access or ID tokens."
  );

  const deviceRefreshed = await deviceClient.acquireTokenSilent({
    account: deviceResult.account,
    forceRefresh: true,
    scopes: deviceScopes,
  });
  assert(
    deviceRefreshed.account?.username === userName &&
      deviceRefreshed.accessToken.length > 100 &&
      deviceRefreshed.accessToken !== deviceResult.accessToken,
    "MSAL public-client refresh did not rotate to a usable access token."
  );
  assert(
    requireString(
      deviceRefreshed.idTokenClaims?.uti,
      "refreshed MSAL device ID-token uti"
    ) !== deviceTokenId,
    "MSAL public-client refresh did not rotate the Microsoft token identifier."
  );

  const lifecycle = await call("simulate_lifecycle", {
    environmentId,
    userId,
    action: "disable",
  });
  assert(
    lifecycle.currentState === "disabled" &&
      lifecycle.revoked?.refreshTokens >= 2 &&
      lifecycle.revoked?.accessTokens >= 2,
    "Lifecycle disable did not revoke both MSAL token families."
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

  let disabledDeviceRefreshError;
  try {
    await deviceClient.acquireTokenSilent({
      account: deviceResult.account,
      forceRefresh: true,
      scopes: deviceScopes,
    });
  } catch (error) {
    disabledDeviceRefreshError = error;
  }
  assert(
    disabledDeviceRefreshError,
    "MSAL public-client refresh unexpectedly succeeded after disable."
  );
  assert(
    disabledDeviceRefreshError.errorCode === "invalid_grant" &&
      String(disabledDeviceRefreshError.message).includes("AADSTS50057"),
    "MSAL public client did not surface the expected disabled-user refresh error."
  );

  const assertion = await call("assert_requests", {
    environmentId,
    sequence: [
      { source: "inbound", method: "GET", path: discoveryPath, status: 200 },
      { source: "inbound", method: "GET", path: authorizationPath, status: 200 },
      { source: "inbound", method: "POST", path: authorizationPath, status: 302 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "GET", path: discoveryPath, status: 200 },
      {
        source: "inbound",
        method: "POST",
        path: deviceAuthorizationPath,
        status: 200,
      },
      { source: "inbound", method: "POST", path: tokenPath, status: 400 },
      {
        source: "inbound",
        method: "GET",
        path: deviceActivation.activationPath,
        status: 200,
      },
      {
        source: "inbound",
        method: "POST",
        path: deviceActivation.activationPath,
        status: 200,
      },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 200 },
      { source: "inbound", method: "POST", path: tokenPath, status: 400 },
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
  const actualProviderSequence = providerEntries
    .toReversed()
    .map((entry) => [entry.method, entry.path, entry.responseStatus]);
  const expectedProviderSequence = [
    ["GET", discoveryPath, 200],
    ["GET", authorizationPath, 200],
    ["POST", authorizationPath, 302],
    ["POST", tokenPath, 200],
    ["POST", tokenPath, 200],
    ["GET", discoveryPath, 200],
    ["POST", deviceAuthorizationPath, 200],
    ["POST", tokenPath, 400],
    ["GET", deviceActivation.activationPath, 200],
    ["POST", deviceActivation.activationPath, 200],
    ["POST", tokenPath, 200],
    ["POST", tokenPath, 200],
    ["POST", tokenPath, 400],
    ["POST", tokenPath, 400],
  ];
  assert(
    JSON.stringify(actualProviderSequence) === JSON.stringify(expectedProviderSequence),
    `MSAL emitted an unexpected provider request sequence: ${JSON.stringify(
      actualProviderSequence
    )}`
  );
  const tokenEntries = providerEntries.filter(
    (entry) => entry.method === "POST" && entry.path === tokenPath
  );
  assert(tokenEntries.length === 7, "Expected exactly seven MSAL token requests.");
  const statuses = tokenEntries.map((entry) => entry.responseStatus).sort();
  assert(
    JSON.stringify(statuses) === JSON.stringify([200, 200, 200, 200, 400, 400, 400]),
    "MSAL token statuses did not match code, device, refresh, and lifecycle flows."
  );

  const deviceAuthorizationEntries = providerEntries.filter(
    (entry) =>
      entry.method === "POST" &&
      entry.path === deviceAuthorizationPath &&
      entry.responseStatus === 200
  );
  assert(
    deviceAuthorizationEntries.length === 1,
    "Expected exactly one successful device-authorization request."
  );
  const deviceAuthorizationForm = requireFormBody(
    deviceAuthorizationEntries[0],
    "device authorization"
  );
  assertSensitiveFormFieldsRedacted(
    deviceAuthorizationForm,
    "Device authorization request"
  );
  assert(
    deviceAuthorizationForm.get("client_id") === deviceClientId &&
      !deviceAuthorizationForm.has("client_secret"),
    "MSAL device authorization was not a secret-free public-client request."
  );
  const deviceAuthorizationResponse = requireObject(
    JSON.parse(
      requireString(
        deviceAuthorizationEntries[0].responseBody,
        "device authorization response body"
      )
    ),
    "device authorization response"
  );
  assert(
    deviceAuthorizationResponse.device_code === REDACTED &&
      deviceAuthorizationResponse.user_code === REDACTED &&
      deviceAuthorizationResponse.message === REDACTED &&
      !Object.hasOwn(deviceAuthorizationResponse, "verification_uri_complete"),
    "Device authorization response did not redact secrets or omit the complete URI."
  );

  const parsedTokenEntries = tokenEntries.map((entry) => ({
    entry,
    form: requireFormBody(entry, "token"),
  }));
  for (const { form } of parsedTokenEntries) {
    assertSensitiveFormFieldsRedacted(form, "Token request");
  }
  const devicePollEntries = parsedTokenEntries.filter(
    ({ form }) => form.get("grant_type") === "device_code"
  );
  assert(
    devicePollEntries.length === 2 &&
      devicePollEntries.every(({ form }) => form.get("device_code") === REDACTED),
    "MSAL device polling was not normalized and structurally redacted."
  );
  const refreshEntries = parsedTokenEntries.filter(
    ({ form }) => form.get("grant_type") === "refresh_token"
  );
  assert(
    refreshEntries.length === 4 &&
      refreshEntries.every(({ form }) => form.get("refresh_token") === REDACTED),
    "MSAL refresh-token request fields were not structurally redacted."
  );

  const activationEntries = providerEntries.filter(
    (entry) => entry.path === deviceActivation.activationPath
  );
  assert(
    activationEntries.length === 2 &&
      activationEntries.some(
        (entry) => entry.method === "GET" && entry.responseStatus === 200
      ) &&
      activationEntries.some(
        (entry) => entry.method === "POST" && entry.responseStatus === 200
      ),
    "The device activation GET/POST pair was not observed."
  );
  const activationPost = activationEntries.find((entry) => entry.method === "POST");
  const activationForm = requireFormBody(activationPost, "device activation");
  assertSensitiveFormFieldsRedacted(activationForm, "Device activation request");
  assert(
    activationForm.get("user_code") === REDACTED &&
      activationForm.get("password") === REDACTED &&
      activationForm.get("decision") === "approve",
    "Device activation credentials or decision were not retained safely."
  );

  const successfulTokenEntries = tokenEntries.filter(
    (entry) => entry.responseStatus === 200
  );
  assert(
    successfulTokenEntries.length === 4,
    "Expected exactly four successful MSAL token responses."
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
    ["client secret", clientSecret],
    ["authorization code", code],
    ["PKCE verifier", pkce.verifier],
    ["authorization-code access token", initial.accessToken],
    ["authorization-code ID token", initial.idToken],
    ["authorization-code refreshed access token", refreshed.accessToken],
    ["device code", deviceActivation.deviceCode],
    ["device user code", deviceActivation.userCode],
    ["device message", deviceActivation.message],
    ["device access token", deviceResult.accessToken],
    ["device ID token", deviceResult.idToken],
    ["device refreshed access token", deviceRefreshed.accessToken],
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
    "MSAL E2E environment cleanup was not confirmed."
  );
  environmentId = undefined;

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      claim:
        "msal-node-custom-authority-authorization-code-pkce-and-public-device-code",
      msalVersion,
      protocolMode: "OIDC",
      networkBoundary: "wrangler-dev-https",
      managementInterface: "mcp-streamable-http",
      environmentDeleted: true,
      providerSequenceMatched: assertion.matched,
      providerRequestCount: expectedProviderSequence.length,
      tokenStatuses: statuses,
      lifecycleErrorCode: disabledRefreshError.errorCode,
      deviceCallbackCount: deviceCodeCallbackCount,
      devicePendingPolls: 1,
      deviceActivationStatus: deviceActivation.activationStatus,
      deviceRefreshStatus: 200,
      deviceLifecycleErrorCode: disabledDeviceRefreshError.errorCode,
      wranglerLoopbackHealthProbes: 1,
      logRedaction: "raw-url-form-encoded-and-structural-sensitive-field-verification",
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
