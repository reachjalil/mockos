import { McpToolClient, unwrapToolResult } from "../packages/cli/dist/index.js";
import {
  jwtParts,
  requireNoSecretLeak,
  requireTrustedGroupFallback,
  verifyJwtSignature,
} from "./smoke-worker-helpers.mjs";

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
let cleanupSuffix;

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

const scimRequest = async ({ baseUrl, path, method, body, expectedStatus, label }) => {
  const response = await jsonRequest({
    url: endpoint(baseUrl, path, `${label} scimBaseUrl`),
    method,
    headers: scimHeaders,
    body,
    label,
  });
  await expectStatus(response, expectedStatus, label);
  const parsedBody =
    expectedStatus === 204
      ? undefined
      : requireObject(await response.json(), `${label} response body`);
  return { response, body: parsedBody };
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

const verifyJwt = async (token, jwks, expected) => {
  const { header, claims } = jwtParts(token);
  if (!(await verifyJwtSignature(token, jwks))) {
    throw new Error("The smoke ID token signature did not verify.");
  }
  for (const [name, value] of Object.entries(expected)) {
    if (claims[name] !== value) {
      throw new Error(`The smoke ID token has an unexpected ${name} claim.`);
    }
  }
  return { header, claims };
};

const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
};

const requireNumber = (value, label) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number.`);
  }
  return value;
};

const jsonRequest = async ({ url, method = "GET", headers = {}, body, label }) => {
  const response = await timed(label, () =>
    fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  return response;
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
  cleanupSuffix = suffix;
  const environment = await call("create_environment", {
    name: `M6 Entra deployed smoke ${suffix}`,
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

  const jwksResponse = await timed("pre-rotation JWKS fetch", () =>
    fetch(urls.jwksUri, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  );
  await expectStatus(jwksResponse, 200, "Pre-rotation JWKS");
  const beforeRotationJwks = requireObject(
    await jwksResponse.json(),
    "pre-rotation JWKS body"
  );
  const preRotationKeys = requireArray(
    beforeRotationJwks.keys,
    "pre-rotation JWKS keys"
  );
  if (preRotationKeys.length !== 2) {
    throw new Error(
      "Pre-rotation JWKS did not publish exactly one active and one successor key."
    );
  }

  const minted = await call("mint_token", {
    environmentId,
    clientId: application.clientId,
    subject: userId,
    audience: application.clientId,
  });
  if (typeof minted.token !== "string") {
    throw new Error("mint_token did not return a JWT.");
  }
  const preRotationJwt = await timed("minted JWT signature verification", () =>
    verifyJwt(minted.token, beforeRotationJwks, {
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

  await call("set_scenario", {
    environmentId,
    id: "m6-rotate-mid-authorization-session",
    injectionPoint: "token.before_sign",
    action: { type: "rotate_signing_key" },
    probability: 1,
    remaining: 1,
    enabled: true,
  });

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
  const tokens = requireObject(await tokenResponse.json(), "OIDC token response");
  const afterRotationJwksResponse = await timed("post-rotation JWKS fetch", () =>
    fetch(urls.jwksUri, { signal: AbortSignal.timeout(requestTimeoutMs) })
  );
  await expectStatus(afterRotationJwksResponse, 200, "Post-rotation JWKS");
  const afterRotationJwks = requireObject(
    await afterRotationJwksResponse.json(),
    "post-rotation JWKS body"
  );
  const postRotationKeys = requireArray(
    afterRotationJwks.keys,
    "post-rotation JWKS keys"
  );
  const postRotationToken = requireString(
    tokens.id_token,
    "authorization-code ID token"
  );
  const postRotationExpectedClaims = {
    iss: urls.issuer,
    aud: application.clientId,
    tid: tenantId,
    oid: userId,
    nonce: authorizationNonce,
  };
  const postRotationJwt = await timed("OIDC ID token signature verification", () =>
    verifyJwt(postRotationToken, afterRotationJwks, postRotationExpectedClaims)
  );
  if (preRotationJwt.header.kid === postRotationJwt.header.kid) {
    throw new Error("Mid-session rotation did not promote a new signing kid.");
  }
  const publishedKids = new Set(postRotationKeys.map(({ kid }) => kid));
  const prePublishedKids = new Set(preRotationKeys.map(({ kid }) => kid));
  if (
    !publishedKids.has(preRotationJwt.header.kid) ||
    !publishedKids.has(postRotationJwt.header.kid) ||
    !prePublishedKids.has(postRotationJwt.header.kid) ||
    postRotationKeys.length !== 3
  ) {
    throw new Error(
      "Post-rotation JWKS did not promote the pre-published successor with an exact old/new overlap."
    );
  }
  await timed("pre-published successor stale JWKS verification", () =>
    verifyJwt(postRotationToken, beforeRotationJwks, postRotationExpectedClaims)
  );
  await timed("pre-rotation JWT overlap verification", () =>
    verifyJwt(minted.token, afterRotationJwks, {
      iss: urls.issuer,
      aud: application.clientId,
      tid: tenantId,
      oid: userId,
    })
  );
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-rotate-mid-authorization-session",
  });

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
      afterRotationJwks,
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
    id: "m6-clock-forward-once",
    injectionPoint: "token.before_sign",
    action: { type: "token_clock_skew", seconds: 300 },
    probability: 1,
    remaining: 1,
    enabled: true,
  });
  const clockSampledAt = Math.floor(Date.now() / 1_000);
  const skewed = await call("mint_token", {
    environmentId,
    clientId: application.clientId,
    subject: userId,
    audience: application.clientId,
  });
  const skewedClaims = (
    await timed("clock-skew JWT verification", () =>
      verifyJwt(
        requireString(skewed.token, "clock-skew signed token"),
        afterRotationJwks,
        {
          iss: urls.issuer,
          aud: application.clientId,
          sub: userId,
          tid: tenantId,
          oid: userId,
        }
      )
    )
  ).claims;
  const skewedIat = requireNumber(skewedClaims.iat, "clock-skew iat");
  const skewedNbf = requireNumber(skewedClaims.nbf, "clock-skew nbf");
  const skewedExp = requireNumber(skewedClaims.exp, "clock-skew exp");
  const baselineClaims = preRotationJwt.claims;
  const baselineIat = requireNumber(baselineClaims.iat, "baseline iat");
  const baselineExp = requireNumber(baselineClaims.exp, "baseline exp");
  if (
    skewedIat < clockSampledAt + 295 ||
    skewedIat > Math.floor(Date.now() / 1_000) + 305 ||
    skewedNbf !== skewedIat ||
    skewedExp - skewedIat !== baselineExp - baselineIat
  ) {
    throw new Error("The one-shot token clock skew did not move temporal claims only.");
  }
  for (const claim of ["iss", "aud", "sub", "tid", "oid"]) {
    if (skewedClaims[claim] !== baselineClaims[claim]) {
      throw new Error(`Token clock skew unexpectedly changed the ${claim} claim.`);
    }
  }
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-clock-forward-once",
  });

  const brokenVariants = [
    "expired",
    "wrong_audience",
    "not_yet_valid",
    "bad_signature",
    "wrong_issuer",
  ];
  const brokenTokens = new Map();
  for (const variant of brokenVariants) {
    const broken = await call("mint_token", {
      environmentId,
      clientId: application.clientId,
      subject: userId,
      audience: application.clientId,
      broken: variant,
    });
    const brokenToken = requireString(broken.token, `${variant} token`);
    if (broken.broken !== variant) {
      throw new Error(`mint_token did not identify the ${variant} variant.`);
    }
    const details = jwtParts(brokenToken);
    const validSignature = await timed(`${variant} token signature check`, () =>
      verifyJwtSignature(brokenToken, afterRotationJwks)
    );
    if (validSignature !== (variant !== "bad_signature")) {
      throw new Error(`The ${variant} token had an unexpected signature outcome.`);
    }
    brokenTokens.set(variant, details.claims);
  }
  const brokenSampledAt = Math.floor(Date.now() / 1_000);
  const expectedWrongAudience = `https://wrong-audience.mockos.invalid/${encodeURIComponent(
    application.clientId
  )}`;
  if (
    requireNumber(brokenTokens.get("expired")?.exp, "expired exp") >= brokenSampledAt ||
    brokenTokens.get("wrong_audience")?.aud !== expectedWrongAudience ||
    requireNumber(brokenTokens.get("not_yet_valid")?.nbf, "not-yet-valid nbf") <=
      brokenSampledAt ||
    brokenTokens.get("wrong_issuer")?.iss !== "https://wrong-issuer.mockos.invalid"
  ) {
    throw new Error("One or more deterministic broken-token claims were not broken.");
  }

  const overageUserName = `groups-${suffix}@example.test`;
  const overageSeed = await call("seed_identities", {
    environmentId,
    users: [
      {
        userName: overageUserName,
        displayName: "M6 Group Overage",
        password: "Synthetic-Overage-Passw0rd!",
        active: true,
        mfaState: "none",
        roles: [],
      },
    ],
    groups: Array.from({ length: 200 }, (_, index) => ({
      displayName: `M6 Security Group ${String(index + 1).padStart(3, "0")}`,
      members: [overageUserName],
    })),
  });
  const overageUserId = requireString(
    overageSeed.users?.[0]?.id,
    "group-overage user id"
  );
  const inlineGroupIds = requireArray(
    overageSeed.groups,
    "group-overage seed groups"
  ).map(({ id }) => requireString(id, "group-overage group id"));
  if (inlineGroupIds.length !== 200) {
    throw new Error(
      "The inline group-overage setup did not create exactly 200 groups."
    );
  }
  const overageApplication = await call("create_application", {
    environmentId,
    name: "M6 group-overage client",
    redirectUris: [redirectUri],
    grantTypes: ["authorization_code"],
    appRoles: [],
    groupClaimsMode: "all",
  });
  const inlineGroupsToken = await call("mint_token", {
    environmentId,
    clientId: overageApplication.clientId,
    subject: overageUserId,
    audience: overageApplication.clientId,
  });
  const inlineBearer = requireString(inlineGroupsToken.token, "200-group signed token");
  const inlineClaims = (
    await timed("200-group JWT verification", () =>
      verifyJwt(inlineBearer, afterRotationJwks, {
        iss: urls.issuer,
        aud: overageApplication.clientId,
        sub: overageUserId,
        tid: tenantId,
        oid: overageUserId,
      })
    )
  ).claims;
  const inlineClaimGroups = requireArray(inlineClaims.groups, "200-group inline claim");
  const actualInlineGroupIds = new Set(inlineClaimGroups);
  if (
    inlineClaimGroups.length !== 200 ||
    actualInlineGroupIds.size !== inlineGroupIds.length ||
    !inlineGroupIds.every((id) => actualInlineGroupIds.has(id)) ||
    Object.hasOwn(inlineClaims, "_claim_names") ||
    Object.hasOwn(inlineClaims, "_claim_sources")
  ) {
    throw new Error("The Entra 200-group boundary did not remain inline.");
  }

  const group201 = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: "Groups",
    method: "POST",
    body: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: "M6 Security Group 201",
      members: [{ value: overageUserId }],
    },
    expectedStatus: 201,
    label: "Entra SCIM group-overage boundary create",
  });
  const group201Id = requireString(group201.body?.id, "group 201 id");
  const overageToken = await call("mint_token", {
    environmentId,
    clientId: overageApplication.clientId,
    subject: overageUserId,
    audience: overageApplication.clientId,
  });
  const overageBearer = requireString(overageToken.token, "group-overage token");
  const overageClaims = (
    await timed("201-group JWT verification", () =>
      verifyJwt(overageBearer, afterRotationJwks, {
        iss: urls.issuer,
        aud: overageApplication.clientId,
        sub: overageUserId,
        tid: tenantId,
        oid: overageUserId,
      })
    )
  ).claims;
  const fallbackEndpoint = requireTrustedGroupFallback({
    claims: overageClaims,
    graphBaseUrl: requireString(urls.graphBaseUrl, "Entra graphBaseUrl"),
    userId: overageUserId,
  });
  const invalidFallback = await jsonRequest({
    url: fallbackEndpoint,
    method: "POST",
    headers: {
      authorization: `Bearer ${overageBearer}`,
      "content-type": "application/json",
    },
    body: { securityEnabledOnly: true, unexpected: true },
    label: "strict Graph getMemberObjects rejection",
  });
  await expectStatus(invalidFallback, 400, "Strict Graph getMemberObjects rejection");
  const fallback = await jsonRequest({
    url: fallbackEndpoint,
    method: "POST",
    headers: {
      authorization: `Bearer ${overageBearer}`,
      "content-type": "Application/JSON; Charset=UTF-8",
    },
    body: { securityEnabledOnly: true },
    label: "strict Graph getMemberObjects fallback",
  });
  await expectStatus(fallback, 200, "Strict Graph getMemberObjects fallback");
  const fallbackBody = requireObject(
    await fallback.json(),
    "Graph getMemberObjects response"
  );
  const resolvedGroupIds = requireArray(
    fallbackBody.value,
    "Graph getMemberObjects values"
  );
  if (
    resolvedGroupIds.length !== 201 ||
    new Set(resolvedGroupIds).size !== 201 ||
    !resolvedGroupIds.includes(group201Id) ||
    inlineGroupIds.some((id) => !resolvedGroupIds.includes(id))
  ) {
    throw new Error("Graph fallback did not resolve the exact 201 group memberships.");
  }
  const graphFallbackLog = await call("get_request_log", {
    environmentId,
    source: "inbound",
    method: "POST",
    path: new URL(fallbackEndpoint).pathname,
    limit: 10,
  });
  const graphFallbackEntries = requireArray(
    graphFallbackLog.entries,
    "Graph fallback request log entries"
  );
  if (
    graphFallbackEntries.length !== 2 ||
    !graphFallbackEntries.some(({ responseStatus }) => responseStatus === 200) ||
    !graphFallbackEntries.some(({ responseStatus }) => responseStatus === 400)
  ) {
    throw new Error("The strict Graph fallback requests were not captured exactly.");
  }

  const patchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
  await call("set_scenario", {
    environmentId,
    id: "m6-scim-conflict-once",
    injectionPoint: "scim.before_commit",
    action: { type: "scim_conflict" },
    probability: 1,
    remaining: 1,
    enabled: true,
  });
  const conflict = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: {
      schemas: [patchSchema],
      Operations: [
        { op: "replace", path: "displayName", value: "Must not persist" },
        { op: "replace", path: "active", value: false },
      ],
    },
    expectedStatus: 409,
    label: "injected SCIM uniqueness conflict",
  });
  if (conflict.body?.status !== "409" || conflict.body?.scimType !== "uniqueness") {
    throw new Error("Injected SCIM conflict did not return a uniqueness 409.");
  }
  const afterConflict = await jsonRequest({
    url: endpoint(
      urls.scimBaseUrl,
      `Users/${encodeURIComponent(userId)}`,
      "Entra scimBaseUrl"
    ),
    headers: { authorization: scimHeaders.authorization },
    label: "SCIM conflict atomicity read",
  });
  await expectStatus(afterConflict, 200, "SCIM conflict atomicity read");
  const afterConflictBody = requireObject(
    await afterConflict.json(),
    "SCIM conflict atomicity body"
  );
  if (
    afterConflictBody.displayName !== "Ada Smoke" ||
    afterConflictBody.active !== true
  ) {
    throw new Error("The SCIM conflict partially changed the User.");
  }
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-scim-conflict-once",
  });

  const missingSchemasPatch = {
    Operations: [
      {
        op: "replace",
        path: "displayName",
        value: "M6 tolerated missing schema",
      },
    ],
  };
  const singletonPatch = {
    schemas: [patchSchema],
    Operations: {
      op: "replace",
      path: "displayName",
      value: "M6 tolerated singleton",
    },
  };
  const strictMissingSchemas = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: missingSchemasPatch,
    expectedStatus: 400,
    label: "strict SCIM missing-schemas rejection",
  });
  if (strictMissingSchemas.body?.scimType !== "invalidValue") {
    throw new Error("Missing SCIM schemas did not fail strict parsing.");
  }
  await call("set_scenario", {
    environmentId,
    id: "m6-scim-tolerate-missing-schemas-once",
    injectionPoint: "scim.patch_parse",
    action: { type: "scim_patch_tolerance", malformedCase: "missing_schemas" },
    probability: 1,
    remaining: 2,
    enabled: true,
  });
  const caseSpecificRejection = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: singletonPatch,
    expectedStatus: 400,
    label: "missing-schemas tolerance remains case-specific",
  });
  if (caseSpecificRejection.body?.scimType !== "invalidValue") {
    throw new Error("Missing-schemas tolerance also accepted singleton Operations.");
  }
  const toleratedMissingSchemas = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: missingSchemasPatch,
    expectedStatus: 200,
    label: "narrow SCIM missing-schemas tolerance",
  });
  if (toleratedMissingSchemas.body?.displayName !== "M6 tolerated missing schema") {
    throw new Error("The missing-schemas tolerance did not apply its one PATCH.");
  }
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-scim-tolerate-missing-schemas-once",
  });

  const strictSingleton = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: singletonPatch,
    expectedStatus: 400,
    label: "strict SCIM singleton-operations rejection",
  });
  if (strictSingleton.body?.scimType !== "invalidValue") {
    throw new Error("Singleton SCIM Operations did not fail strict parsing.");
  }
  await call("set_scenario", {
    environmentId,
    id: "m6-scim-tolerate-singleton-once",
    injectionPoint: "scim.patch_parse",
    action: { type: "scim_patch_tolerance", malformedCase: "singleton_operations" },
    probability: 1,
    remaining: 2,
    enabled: true,
  });
  const reverseCaseSpecificRejection = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: missingSchemasPatch,
    expectedStatus: 400,
    label: "singleton tolerance remains case-specific",
  });
  if (reverseCaseSpecificRejection.body?.scimType !== "invalidValue") {
    throw new Error("Singleton tolerance also accepted a missing schemas field.");
  }
  const toleratedSingleton = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Users/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: singletonPatch,
    expectedStatus: 200,
    label: "narrow SCIM singleton-operations tolerance",
  });
  if (toleratedSingleton.body?.displayName !== "M6 tolerated singleton") {
    throw new Error("The singleton-operations tolerance did not apply its one PATCH.");
  }
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-scim-tolerate-singleton-once",
  });

  const raceGroup = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: "Groups",
    method: "POST",
    body: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      displayName: "M6 disposable race group",
      members: [{ value: userId }],
    },
    expectedStatus: 201,
    label: "SCIM race group setup",
  });
  const raceGroupId = requireString(raceGroup.body?.id, "SCIM race group id");
  const racePatch = {
    schemas: [patchSchema],
    Operations: [{ op: "replace", path: "displayName", value: "Must not persist" }],
  };
  await call("set_scenario", {
    environmentId,
    id: "m6-scim-soft-delete-race-once",
    injectionPoint: "scim.before_commit",
    action: { type: "scim_soft_delete_race" },
    probability: 1,
    remaining: 1,
    enabled: true,
  });
  const race = await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Groups/${encodeURIComponent(raceGroupId)}`,
    method: "PATCH",
    body: racePatch,
    expectedStatus: 404,
    label: "injected SCIM soft-delete race",
  });
  if (race.body?.status !== "404") {
    throw new Error("The SCIM soft-delete race did not return 404.");
  }
  await call("clear_scenario", {
    environmentId,
    scenarioId: "m6-scim-soft-delete-race-once",
  });
  const hiddenRaceGroup = await jsonRequest({
    url: endpoint(
      urls.scimBaseUrl,
      `Groups/${encodeURIComponent(raceGroupId)}`,
      "Entra scimBaseUrl"
    ),
    headers: { authorization: scimHeaders.authorization },
    label: "SCIM raced group tombstone read",
  });
  await expectStatus(hiddenRaceGroup, 404, "SCIM raced group tombstone read");
  await scimRequest({
    baseUrl: urls.scimBaseUrl,
    path: `Groups/${encodeURIComponent(raceGroupId)}`,
    method: "PATCH",
    body: racePatch,
    expectedStatus: 404,
    label: "SCIM raced group replay",
  });

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
    name: `M6 Okta deployed smoke ${suffix}`,
    provider: "okta",
    seed: `m3-okta-smoke-${suffix}`,
  });
  const oktaEnvironmentId = requireString(oktaEnvironment.id, "Okta environment id");
  environmentIds.push(oktaEnvironmentId);

  const oktaUserName = `grace-${suffix}@example.test`;
  const oktaMfaUserName = `mfa-${suffix}@example.test`;
  const oktaExpiredUserName = `expired-${suffix}@example.test`;
  const oktaLockedUserName = `locked-${suffix}@example.test`;
  const oktaPassword = "Synthetic-Okta-Passw0rd!";
  const oktaSeeded = await call("seed_identities", {
    environmentId: oktaEnvironmentId,
    users: [
      {
        userName: oktaUserName,
        displayName: "Grace Smoke",
        password: oktaPassword,
        passwordState: "valid",
        active: true,
        mfaState: "none",
        roles: [],
      },
      {
        userName: oktaMfaUserName,
        displayName: "M6 MFA Authn",
        password: oktaPassword,
        passwordState: "expired",
        active: true,
        mfaState: "required",
        roles: [],
      },
      {
        userName: oktaExpiredUserName,
        displayName: "M6 Expired Authn",
        password: oktaPassword,
        passwordState: "expired",
        active: true,
        mfaState: "none",
        roles: [],
      },
      {
        userName: oktaLockedUserName,
        displayName: "M6 Locked Authn",
        password: oktaPassword,
        passwordState: "valid",
        active: true,
        mfaState: "none",
        roles: [],
      },
    ],
    groups: [{ displayName: "M3 Okta Smoke Engineering", members: [oktaUserName] }],
  });
  const oktaUserId = requireString(oktaSeeded.users?.[0]?.id, "Okta User id");
  const oktaLockedUserId = requireString(
    oktaSeeded.users?.find(({ userName: value }) => value === oktaLockedUserName)?.id,
    "locked Okta User id"
  );
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

  await call("simulate_lifecycle", {
    environmentId: oktaEnvironmentId,
    userId: oktaLockedUserId,
    action: "suspend",
  });
  const oktaAuthnEndpoint = requireString(
    oktaUrls.oktaAuthnEndpoint,
    "Okta Authn endpoint"
  );
  const authenticate = (body, label, headers = {}) =>
    jsonRequest({
      url: oktaAuthnEndpoint,
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      label,
    });
  const sameOriginPreflight = await jsonRequest({
    url: oktaAuthnEndpoint,
    method: "OPTIONS",
    headers: {
      origin: publicOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
    label: "Okta Authn same-origin preflight",
  });
  await expectStatus(sameOriginPreflight, 204, "Okta Authn same-origin preflight");
  const preflightVary = new Set(
    (sameOriginPreflight.headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    sameOriginPreflight.headers.get("access-control-allow-origin") !== publicOrigin ||
    sameOriginPreflight.headers.get("access-control-allow-methods") !== "POST" ||
    sameOriginPreflight.headers.get("access-control-allow-headers") !==
      "content-type" ||
    sameOriginPreflight.headers.get("access-control-max-age") !== "600" ||
    !preflightVary.has("origin") ||
    !preflightVary.has("access-control-request-headers") ||
    sameOriginPreflight.headers.get("access-control-allow-credentials") !== null
  ) {
    throw new Error("Okta Authn did not apply its same-origin-only CORS policy.");
  }
  const crossOriginPreflight = await jsonRequest({
    url: oktaAuthnEndpoint,
    method: "OPTIONS",
    headers: {
      origin: "https://cross-origin.invalid",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
    label: "Okta Authn cross-origin preflight",
  });
  await expectStatus(crossOriginPreflight, 403, "Okta Authn cross-origin preflight");
  if (crossOriginPreflight.headers.has("access-control-allow-origin")) {
    throw new Error("Okta Authn exposed CORS headers to a cross-origin request.");
  }
  const wrongAuthnPassword = "Wrong-Synthetic-Authn-Passw0rd!";
  for (const candidate of [
    oktaMfaUserName,
    oktaExpiredUserName,
    oktaLockedUserName,
    `unknown-${suffix}@example.test`,
  ]) {
    const invalid = await authenticate(
      { username: candidate, password: wrongAuthnPassword },
      "Okta Authn invalid-credentials privacy"
    );
    await expectStatus(invalid, 401, "Okta Authn invalid credentials");
    const invalidBody = requireObject(
      await invalid.json(),
      "Okta Authn invalid-credentials body"
    );
    if (
      invalidBody.errorCode !== "E0000004" ||
      invalidBody.errorSummary !== "Authentication failed" ||
      requireArray(invalidBody.errorCauses, "Okta Authn error causes").length !== 0
    ) {
      throw new Error("Okta Authn invalid credentials leaked account state.");
    }
  }

  const mfaAuthn = await authenticate(
    { username: oktaMfaUserName, password: oktaPassword },
    "Okta Authn MFA_REQUIRED"
  );
  await expectStatus(mfaAuthn, 200, "Okta Authn MFA_REQUIRED");
  const mfaAuthnBody = requireObject(
    await mfaAuthn.json(),
    "Okta Authn MFA_REQUIRED body"
  );
  const mfaEmbedded = requireObject(
    mfaAuthnBody._embedded,
    "Okta Authn MFA_REQUIRED embedded body"
  );
  const mfaFactors = requireArray(
    mfaEmbedded.factor,
    "Okta Authn singular embedded factor"
  );
  if (
    mfaAuthnBody.status !== "MFA_REQUIRED" ||
    Object.hasOwn(mfaEmbedded, "factors") ||
    mfaFactors.length !== 1 ||
    mfaFactors[0]?.factorType !== "token:software:totp" ||
    mfaFactors[0]?.provider !== "OKTA"
  ) {
    throw new Error("Okta Authn did not render the singular MFA factor collection.");
  }
  const mfaStateToken = requireString(mfaAuthnBody.stateToken, "Okta MFA state token");
  const currentMfaState = await authenticate(
    { stateToken: mfaStateToken },
    "Okta Authn state-token read"
  );
  await expectStatus(currentMfaState, 200, "Okta Authn state-token read");
  const currentMfaBody = requireObject(
    await currentMfaState.json(),
    "Okta Authn current state body"
  );
  if (
    currentMfaBody.status !== "MFA_REQUIRED" ||
    currentMfaBody.stateToken !== mfaStateToken
  ) {
    throw new Error("Okta Authn state token did not recover the MFA transaction.");
  }

  const expiredAuthn = await authenticate(
    { username: oktaExpiredUserName, password: oktaPassword },
    "Okta Authn PASSWORD_EXPIRED"
  );
  await expectStatus(expiredAuthn, 200, "Okta Authn PASSWORD_EXPIRED");
  const expiredAuthnBody = requireObject(
    await expiredAuthn.json(),
    "Okta Authn PASSWORD_EXPIRED body"
  );
  if (
    expiredAuthnBody.status !== "PASSWORD_EXPIRED" ||
    expiredAuthnBody._links?.next?.name !== "changePassword"
  ) {
    throw new Error("Okta Authn did not render PASSWORD_EXPIRED.");
  }
  const expiredStateToken = requireString(
    expiredAuthnBody.stateToken,
    "Okta expired-password state token"
  );

  const lockedAuthn = await authenticate(
    { username: oktaLockedUserName, password: oktaPassword },
    "Okta Authn LOCKED_OUT"
  );
  await expectStatus(lockedAuthn, 200, "Okta Authn LOCKED_OUT");
  const lockedAuthnBody = requireObject(
    await lockedAuthn.json(),
    "Okta Authn LOCKED_OUT body"
  );
  if (
    lockedAuthnBody.status !== "LOCKED_OUT" ||
    lockedAuthnBody._links?.next?.name !== "unlock"
  ) {
    throw new Error("Okta Authn did not render LOCKED_OUT.");
  }

  const cookieSecret = `M6Cookie-${suffix}`;
  const proxySecret = `M6Proxy-${suffix}`;
  const headerTokenSecret = `M6HeaderToken-${suffix}`;
  const preservedSafeField = "2026-07-23T00:00:00.000Z";
  const successAuthn = await authenticate(
    {
      username: oktaUserName,
      password: oktaPassword,
      passwordChanged: preservedSafeField,
    },
    "Okta Authn SUCCESS",
    {
      origin: publicOrigin,
      cookie: `sid=${cookieSecret}`,
      "proxy-authorization": `Bearer ${proxySecret}`,
      "x-auth-token": headerTokenSecret,
    }
  );
  await expectStatus(successAuthn, 200, "Okta Authn SUCCESS");
  const successAuthnBody = requireObject(
    await successAuthn.json(),
    "Okta Authn SUCCESS body"
  );
  if (
    successAuthnBody.status !== "SUCCESS" ||
    successAuthn.headers.get("cache-control") !== "no-store" ||
    successAuthn.headers.get("access-control-allow-origin") !== publicOrigin
  ) {
    throw new Error(
      "Okta Authn did not render SUCCESS with no-store and same-origin CORS semantics."
    );
  }
  const sessionToken = requireString(
    successAuthnBody.sessionToken,
    "Okta Authn session token"
  );

  const authnLog = await call("get_request_log", {
    environmentId: oktaEnvironmentId,
    source: "inbound",
    method: "POST",
    path: new URL(oktaAuthnEndpoint).pathname,
    limit: 50,
  });
  const authnEntries = requireArray(authnLog.entries, "Okta Authn request log entries");
  if (authnEntries.length < 9) {
    throw new Error("The deployed Okta Authn sample was not logged synchronously.");
  }
  const successLogEntry = authnEntries.find(({ requestBody }) =>
    String(requestBody).includes(preservedSafeField)
  );
  if (!successLogEntry) {
    throw new Error("The logged Okta Authn SUCCESS request was not found.");
  }
  const successRequestHeaders = requireObject(
    successLogEntry.requestHeaders,
    "logged Okta Authn SUCCESS request headers"
  );
  if (
    successRequestHeaders.cookie !== "[REDACTED]" ||
    successRequestHeaders["proxy-authorization"] !== "[REDACTED]" ||
    successRequestHeaders["x-auth-token"] !== "[REDACTED]" ||
    successRequestHeaders.origin !== publicOrigin
  ) {
    throw new Error("Okta Authn did not redact each captured credential header.");
  }
  const serializedAuthnLog = JSON.stringify(authnEntries);
  requireNoSecretLeak(
    serializedAuthnLog,
    [
      oktaPassword,
      wrongAuthnPassword,
      mfaStateToken,
      expiredStateToken,
      sessionToken,
      cookieSecret,
      proxySecret,
      headerTokenSecret,
    ],
    "Okta Authn request log"
  );
  if (
    !serializedAuthnLog.includes("[REDACTED]") ||
    !serializedAuthnLog.includes(preservedSafeField) ||
    !serializedAuthnLog.includes("E0000004")
  ) {
    throw new Error("Okta Authn logs did not retain safe evidence around redaction.");
  }

  process.stdout.write(
    "PASS  M6 sampled deployed acceptance: accepted M3 regressions plus key rotation, token edges, group overage, SCIM races/tolerance, and Okta Authn/redaction. M5 outbound provisioning is requalified separately through the hosted controlled target; this is not a broad provider-parity claim.\n"
  );
} finally {
  const cleanupFailures = [];
  if (cleanupSuffix) {
    try {
      const catalog = await call("list_environments", {});
      for (const environment of Array.isArray(catalog.environments)
        ? catalog.environments
        : []) {
        if (
          typeof environment?.id === "string" &&
          (String(environment.name).endsWith(cleanupSuffix) ||
            String(environment.seed).endsWith(cleanupSuffix)) &&
          !environmentIds.includes(environment.id)
        ) {
          environmentIds.push(environment.id);
        }
      }
    } catch (error) {
      cleanupFailures.push(error);
      process.stderr.write(
        `WARN  smoke orphan discovery failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
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
