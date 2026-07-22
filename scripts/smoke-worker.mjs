import { McpToolClient, unwrapToolResult } from "../packages/cli/dist/index.js";

const origin = process.env.MOCKOS_SMOKE_ORIGIN;
const apiKey = process.env.MOCKOS_SMOKE_API_KEY;
const requestTimeoutMs = Number.parseInt(
  process.env.MOCKOS_SMOKE_TIMEOUT_MS ?? "30000",
  10
);

if (!origin || !apiKey) {
  throw new Error("MOCKOS_SMOKE_ORIGIN and MOCKOS_SMOKE_API_KEY are required.");
}
if (
  !Number.isSafeInteger(requestTimeoutMs) ||
  requestTimeoutMs < 1_000 ||
  requestTimeoutMs > 300_000
) {
  throw new Error(
    "MOCKOS_SMOKE_TIMEOUT_MS must be an integer between 1000 and 300000."
  );
}

const publicOrigin = new URL(origin).origin;
const client = new McpToolClient({
  endpoint: `${publicOrigin}/mcp`,
  apiKey,
  timeoutMs: requestTimeoutMs,
});

const environmentIds = [];

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
};

const timed = async (label, operation) => {
  const startedAt = performance.now();
  process.stdout.write(`RUN   ${label}.\n`);
  const result = await operation();
  process.stdout.write(
    `PASS  ${label} (${Math.round(performance.now() - startedAt)} ms).\n`
  );
  return result;
};

const call = async (name, input) => {
  return timed(`MCP ${name}`, async () => {
    const result = unwrapToolResult(await client.callTool(name, input));
    const envelope = requireObject(result, `${name} result`);
    return requireObject(envelope.data, `${name} data`);
  });
};

const expectStatus = async (response, status, label) => {
  if (response.status !== status) {
    throw new Error(`${label} returned HTTP ${response.status}; expected ${status}.`);
  }
};

const requireString = (value, label) => {
  if (typeof value !== "string" || !value) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value;
};

const endpoint = (baseUrl, path, label) => {
  const base = new URL(requireString(baseUrl, label));
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return base;
};

const scimHeaders = {
  authorization: "Bearer synthetic-m3-scim-credential",
  "content-type": "application/scim+json",
};

const verifyScimDiscovery = async (baseUrl, label) => {
  const response = await timed(`${label} SCIM discovery`, () =>
    fetch(endpoint(baseUrl, "ServiceProviderConfig", `${label} scimBaseUrl`), {
      headers: { authorization: scimHeaders.authorization },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(response, 200, `${label} SCIM discovery`);
  const body = requireObject(await response.json(), `${label} SCIM discovery body`);
  if (body.patch?.supported !== true || body.filter?.supported !== true) {
    throw new Error(`${label} SCIM discovery did not advertise PATCH and filter.`);
  }
};

const patchScimGroup = async ({
  baseUrl,
  groupId,
  displayName,
  expectedStatus,
  label,
}) => {
  const response = await timed(`${label} SCIM Group PATCH`, () =>
    fetch(
      endpoint(
        baseUrl,
        `Groups/${encodeURIComponent(groupId)}`,
        `${label} scimBaseUrl`
      ),
      {
        method: "PATCH",
        headers: scimHeaders,
        body: JSON.stringify({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "displayName", value: displayName }],
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      }
    )
  );
  await expectStatus(response, expectedStatus, `${label} SCIM Group PATCH`);
  if (response.headers.get("etag") !== 'W/"2"') {
    throw new Error(`${label} SCIM Group PATCH did not return the expected ETag.`);
  }
  if (expectedStatus === 200) {
    const body = requireObject(await response.json(), `${label} Group PATCH body`);
    if (body.displayName !== displayName) {
      throw new Error(`${label} SCIM Group PATCH did not persist the display name.`);
    }
  }
};

const base64Url = (bytes) =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const decodeJwtPart = (value) =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

const verifyJwt = async (token, jwks, expected) => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("The smoke flow did not receive a JWT.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedPayload);
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("The token signing key was absent from JWKS.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(encodedSignature, "base64url"),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  if (!verified) throw new Error("The smoke ID token signature did not verify.");
  for (const [name, value] of Object.entries(expected)) {
    if (claims[name] !== value) {
      throw new Error(`The smoke ID token has an unexpected ${name} claim.`);
    }
  }
};

try {
  const health = await timed("health probe", () =>
    fetch(`${publicOrigin}/health`, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(health, 200, "Health probe");

  await timed("authenticated MCP initialization", () => client.connect());
  const toolNames = new Set(
    (await timed("MCP tool discovery", () => client.listTools())).map(
      ({ name }) => name
    )
  );
  for (const name of [
    "create_environment",
    "list_environments",
    "seed_identities",
    "create_application",
    "set_scenario",
    "clear_scenario",
    "get_request_log",
    "assert_requests",
    "get_wellknown_urls",
    "mint_token",
    "simulate_lifecycle",
    "delete_environment",
  ]) {
    if (!toolNames.has(name)) throw new Error(`MCP tool ${name} is missing.`);
  }

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const environment = await call("create_environment", {
    name: "M3 Entra deployed smoke",
    provider: "entra",
    seed: `m3-entra-smoke-${suffix}`,
  });
  const environmentId = requireString(environment.id, "Entra environment id");
  environmentIds.push(environmentId);
  const tenantId = requireString(environment.tenantId, "Entra tenant id");

  const userName = `ada-${suffix}@example.test`;
  const password = "Synthetic-Passw0rd!";
  const seeded = await call("seed_identities", {
    environmentId,
    users: [
      {
        userName,
        displayName: "Ada Smoke",
        password,
        active: true,
        mfaState: "none",
        roles: [],
      },
    ],
    groups: [{ displayName: "M3 Smoke Engineering", members: [userName] }],
  });
  const userId = seeded.users?.[0]?.id;
  const groupId = seeded.groups?.[0]?.id;
  if (typeof userId !== "string") throw new Error("The smoke user was not created.");
  if (typeof groupId !== "string") throw new Error("The smoke group was not created.");

  const redirectUri = "https://client.example.test/mockos-smoke-callback";
  const application = await call("create_application", {
    environmentId,
    name: "M3 smoke client",
    redirectUris: [redirectUri],
    grantTypes: ["authorization_code", "refresh_token"],
    appRoles: [],
    groupClaimsMode: "none",
  });
  if (
    typeof application.clientId !== "string" ||
    typeof application.clientSecret !== "string"
  ) {
    throw new Error("The smoke application was not created.");
  }

  const urls = await call("get_wellknown_urls", { environmentId });
  await verifyScimDiscovery(urls.scimBaseUrl, "Entra");
  await patchScimGroup({
    baseUrl: urls.scimBaseUrl,
    groupId,
    displayName: "M3 Smoke Platform Engineering",
    expectedStatus: 204,
    label: "Entra",
  });

  const graphUserUrl = endpoint(
    urls.graphBaseUrl,
    `users/${encodeURIComponent(userId)}`,
    "Entra graphBaseUrl"
  );
  graphUserUrl.searchParams.set("$select", "id,userPrincipalName,accountEnabled");
  const graphUserResponse = await timed("Entra Graph User read", () =>
    fetch(graphUserUrl, {
      headers: { authorization: "Bearer synthetic-m3-graph-credential" },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(graphUserResponse, 200, "Entra Graph User read");
  const graphUser = requireObject(
    await graphUserResponse.json(),
    "Entra Graph User body"
  );
  if (
    graphUser.id !== userId ||
    graphUser.userPrincipalName !== userName ||
    graphUser.accountEnabled !== true
  ) {
    throw new Error("Entra Graph did not return the seeded active User.");
  }

  const discoveryResponse = await timed("OIDC discovery", () =>
    fetch(urls.openidConfiguration, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(discoveryResponse, 200, "OIDC discovery");
  const discovery = await discoveryResponse.json();
  if (
    discovery.issuer !== urls.issuer ||
    discovery.authorization_endpoint !== urls.authorizationEndpoint ||
    discovery.token_endpoint !== urls.tokenEndpoint ||
    discovery.jwks_uri !== urls.jwksUri
  ) {
    throw new Error("OIDC discovery does not match the MCP well-known URLs.");
  }

  const jwksResponse = await timed("JWKS fetch", () =>
    fetch(urls.jwksUri, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(jwksResponse, 200, "JWKS");
  const jwks = await jwksResponse.json();

  const minted = await call("mint_token", {
    environmentId,
    clientId: application.clientId,
    subject: userId,
    audience: application.clientId,
  });
  if (typeof minted.token !== "string") {
    throw new Error("mint_token did not return a JWT.");
  }
  await timed("minted JWT signature verification", () =>
    verifyJwt(minted.token, jwks, {
      iss: urls.issuer,
      aud: application.clientId,
      tid: tenantId,
      oid: userId,
    })
  );

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );
  const authorizationScope = "openid profile email offline_access";
  const authorizationState = "m3-smoke-state";
  const authorizationNonce = "m3-smoke-nonce";
  const authorize = new URL(urls.authorizationEndpoint);
  authorize.search = new URLSearchParams({
    client_id: application.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: authorizationScope,
    state: authorizationState,
    nonce: authorizationNonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    login_hint: userName,
  }).toString();
  const loginPage = await timed("hosted login page", () =>
    fetch(authorize, { signal: AbortSignal.timeout(requestTimeoutMs) })
  );
  await expectStatus(loginPage, 200, "Hosted login page");
  if (!(await loginPage.text()).includes("Synthetic identities only")) {
    throw new Error("Hosted login did not identify itself as a mockOS test surface.");
  }

  const login = await timed("hosted login submission", () =>
    fetch(urls.authorizationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: application.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope: authorizationScope,
        state: authorizationState,
        nonce: authorizationNonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        username: userName,
        password,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(login, 302, "Hosted login submission");
  const callback = new URL(login.headers.get("location") ?? "", redirectUri);
  const code = callback.searchParams.get("code");
  if (!code || callback.searchParams.get("state") !== authorizationState) {
    throw new Error("Hosted login did not return the expected code and state.");
  }

  const tokenResponse = await timed("OIDC token exchange", () =>
    fetch(urls.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: application.clientId,
        client_secret: application.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(tokenResponse, 200, "OIDC token exchange");
  const tokens = await tokenResponse.json();
  await timed("OIDC ID token signature verification", () =>
    verifyJwt(requireString(tokens.id_token, "authorization-code ID token"), jwks, {
      iss: urls.issuer,
      aud: application.clientId,
      tid: tenantId,
      oid: userId,
      nonce: authorizationNonce,
    })
  );

  const initialRefreshToken = requireString(
    tokens.refresh_token,
    "authorization-code refresh token"
  );
  const refreshResponse = await timed("Entra refresh-token rotation", () =>
    fetch(urls.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: application.clientId,
        client_secret: application.clientSecret,
        refresh_token: initialRefreshToken,
        scope: "openid profile email",
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(refreshResponse, 200, "Entra refresh-token rotation");
  const refreshedTokens = requireObject(
    await refreshResponse.json(),
    "Entra refresh-token response"
  );
  const ownedRefreshToken = requireString(
    refreshedTokens.refresh_token,
    "rotated Entra refresh token"
  );
  if (ownedRefreshToken === initialRefreshToken) {
    throw new Error("The Entra refresh grant did not rotate the refresh token.");
  }
  if (refreshedTokens.scope !== "openid profile email") {
    throw new Error("The Entra refresh grant did not preserve the narrowed scope.");
  }
  await timed("refreshed Entra ID token signature verification", () =>
    verifyJwt(
      requireString(refreshedTokens.id_token, "refreshed Entra ID token"),
      jwks,
      {
        iss: urls.issuer,
        aud: application.clientId,
        tid: tenantId,
        oid: userId,
      }
    )
  );

  await call("set_scenario", {
    environmentId,
    id: "m3-mfa-required",
    injectionPoint: "oauth.token",
    action: { type: "error", code: "MFA_REQUIRED" },
    probability: 1,
    remaining: 1,
    enabled: true,
  });
  const injected = await timed("injected Entra MFA failure", () =>
    fetch(urls.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: application.clientId,
        client_secret: application.clientSecret,
        code: "scenario-intercepts-before-validation",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(injected, 400, "Injected MFA requirement");
  const injectedBody = await injected.json();
  if (
    injectedBody.error !== "interaction_required" ||
    !Array.isArray(injectedBody.error_codes) ||
    !injectedBody.error_codes.includes(50076) ||
    !String(injectedBody.error_description).includes("AADSTS50076")
  ) {
    throw new Error("Injected error was not the expected Entra AADSTS50076 body.");
  }

  const log = await call("get_request_log", {
    environmentId,
    source: "inbound",
    method: "POST",
    path: new URL(urls.tokenEndpoint).pathname,
    status: 400,
    limit: 10,
  });
  if (!Array.isArray(log.entries) || log.entries.length !== 1) {
    throw new Error("The injected protocol request was not captured synchronously.");
  }
  const assertion = await call("assert_requests", {
    environmentId,
    source: "inbound",
    method: "POST",
    path: new URL(urls.tokenEndpoint).pathname,
    status: 400,
    count: { exactly: 1 },
  });
  if (assertion.pass !== true)
    throw new Error("The deployed request assertion failed.");

  await call("clear_scenario", {
    environmentId,
    scenarioId: "m3-mfa-required",
  });

  const lifecycle = await call("simulate_lifecycle", {
    environmentId,
    userId,
    action: "disable",
  });
  const revoked = requireObject(lifecycle.revoked, "lifecycle revocation counts");
  if (
    lifecycle.provider !== "entra" ||
    lifecycle.action !== "disable" ||
    lifecycle.previousState !== "active" ||
    lifecycle.currentState !== "disabled" ||
    lifecycle.changed !== true ||
    !/^W\/"[1-9][0-9]*"$/.test(lifecycle.etag) ||
    !Number.isInteger(revoked.accessTokens) ||
    revoked.accessTokens < 1 ||
    !Number.isInteger(revoked.refreshTokens) ||
    revoked.refreshTokens < 1
  ) {
    throw new Error("simulate_lifecycle did not return the Entra revocation cascade.");
  }

  const disabledRefresh = await timed("disabled Entra refresh-token failure", () =>
    fetch(urls.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: application.clientId,
        client_secret: application.clientSecret,
        refresh_token: ownedRefreshToken,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(disabledRefresh, 400, "Disabled Entra refresh token");
  const disabledRefreshBody = requireObject(
    await disabledRefresh.json(),
    "disabled Entra refresh response"
  );
  if (
    disabledRefreshBody.error !== "invalid_grant" ||
    !Array.isArray(disabledRefreshBody.error_codes) ||
    !disabledRefreshBody.error_codes.includes(50057) ||
    !String(disabledRefreshBody.error_description).includes("AADSTS50057")
  ) {
    throw new Error("Disabled refresh did not return Entra AADSTS50057.");
  }

  const tokenPath = new URL(urls.tokenEndpoint).pathname;
  const lifecycleLog = await call("get_request_log", {
    environmentId,
    source: "inbound",
    method: "POST",
    path: tokenPath,
    status: 400,
    limit: 10,
  });
  const lifecycleLogEntries = Array.isArray(lifecycleLog.entries)
    ? lifecycleLog.entries.filter((entry) =>
        String(entry?.requestBody).includes("grant_type=refresh_token")
      )
    : [];
  if (lifecycleLogEntries.length !== 1) {
    throw new Error("The disabled refresh request was not captured synchronously.");
  }
  const lifecycleAssertion = await call("assert_requests", {
    environmentId,
    source: "inbound",
    method: "POST",
    path: tokenPath,
    status: 400,
    bodyIncludes: "grant_type=refresh_token",
    count: { exactly: 1 },
  });
  if (lifecycleAssertion.pass !== true) {
    throw new Error("The disabled refresh request assertion failed.");
  }

  const oktaEnvironment = await call("create_environment", {
    name: "M3 Okta deployed smoke",
    provider: "okta",
    seed: `m3-okta-smoke-${suffix}`,
  });
  const oktaEnvironmentId = requireString(oktaEnvironment.id, "Okta environment id");
  environmentIds.push(oktaEnvironmentId);

  const oktaUserName = `grace-${suffix}@example.test`;
  const oktaSeeded = await call("seed_identities", {
    environmentId: oktaEnvironmentId,
    users: [
      {
        userName: oktaUserName,
        displayName: "Grace Smoke",
        password: "Synthetic-Okta-Passw0rd!",
        active: true,
        mfaState: "none",
        roles: [],
      },
    ],
    groups: [{ displayName: "M3 Okta Smoke Engineering", members: [oktaUserName] }],
  });
  const oktaUserId = requireString(oktaSeeded.users?.[0]?.id, "Okta User id");
  const oktaGroupId = requireString(oktaSeeded.groups?.[0]?.id, "Okta Group id");
  const oktaUrls = await call("get_wellknown_urls", {
    environmentId: oktaEnvironmentId,
  });

  await verifyScimDiscovery(oktaUrls.scimBaseUrl, "Okta");
  await patchScimGroup({
    baseUrl: oktaUrls.scimBaseUrl,
    groupId: oktaGroupId,
    displayName: "M3 Okta Smoke Platform Engineering",
    expectedStatus: 200,
    label: "Okta",
  });

  const oktaUserUrl = endpoint(
    oktaUrls.oktaApiBaseUrl,
    `users/${encodeURIComponent(oktaUserId)}`,
    "Okta oktaApiBaseUrl"
  );
  const oktaHeaders = { authorization: "SSWS synthetic-m3-okta-credential" };
  const oktaUserResponse = await timed("Okta API User read", () =>
    fetch(oktaUserUrl, {
      headers: oktaHeaders,
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(oktaUserResponse, 200, "Okta API User read");
  const oktaUser = requireObject(await oktaUserResponse.json(), "Okta API User body");
  const oktaProfile = requireObject(oktaUser.profile, "Okta API User profile");
  if (
    oktaUser.id !== oktaUserId ||
    oktaUser.status !== "ACTIVE" ||
    oktaProfile.login !== oktaUserName
  ) {
    throw new Error("The Okta API did not return the seeded active User.");
  }

  await call("set_scenario", {
    environmentId: oktaEnvironmentId,
    id: "m3-okta-rate-limit",
    injectionPoint: "okta.api",
    action: { type: "error", code: "RATE_LIMITED" },
    probability: 1,
    remaining: 1,
    enabled: true,
  });
  const oktaRateLimited = await timed("injected Okta API rate limit", () =>
    fetch(oktaUserUrl, {
      headers: oktaHeaders,
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(oktaRateLimited, 429, "Injected Okta API rate limit");
  const oktaRateLimitedBody = requireObject(
    await oktaRateLimited.json(),
    "Okta API rate-limit body"
  );
  if (
    oktaRateLimitedBody.errorCode !== "E0000047" ||
    !oktaRateLimited.headers.get("x-okta-request-id")
  ) {
    throw new Error("Injected Okta rate limit was not an E0000047 response.");
  }
  await call("clear_scenario", {
    environmentId: oktaEnvironmentId,
    scenarioId: "m3-okta-rate-limit",
  });

  process.stdout.write(
    "PASS  M3 MCP, OIDC/refresh, SCIM, Graph, lifecycle cascade, request evidence, and Okta directory acceptance.\n"
  );
} finally {
  const cleanupFailures = [];
  for (const trackedEnvironmentId of [...environmentIds].reverse()) {
    try {
      await call("delete_environment", { environmentId: trackedEnvironmentId });
      process.stdout.write("PASS  smoke environment cleanup.\n");
    } catch (error) {
      cleanupFailures.push(error);
      process.stderr.write(
        `WARN  smoke cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
  if (environmentIds.length > 0) {
    try {
      const catalog = await call("list_environments", {});
      if (!Array.isArray(catalog.environments)) {
        const error = new Error(
          "list_environments did not return an environment catalog."
        );
        cleanupFailures.push(error);
        process.stderr.write(
          `WARN  smoke catalog verification failed: ${error.message}\n`
        );
      } else if (
        environmentIds.some((id) =>
          catalog.environments.some((environment) => environment?.id === id)
        )
      ) {
        const error = new Error(
          "A smoke environment remained in the catalog after cleanup."
        );
        cleanupFailures.push(error);
        process.stderr.write(
          `WARN  smoke catalog verification failed: ${error.message}\n`
        );
      } else {
        process.stdout.write("PASS  smoke catalog cleanup verification.\n");
      }
    } catch (error) {
      cleanupFailures.push(error);
      process.stderr.write(
        `WARN  smoke catalog verification failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
  try {
    await client.close();
  } catch (error) {
    cleanupFailures.push(error);
    process.stderr.write(
      `WARN  MCP session cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  if (cleanupFailures.length > 0) process.exitCode = 1;
}
