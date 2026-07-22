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

let environmentId;

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
    "seed_identities",
    "create_application",
    "set_scenario",
    "clear_scenario",
    "get_request_log",
    "assert_requests",
    "get_wellknown_urls",
    "mint_token",
    "delete_environment",
  ]) {
    if (!toolNames.has(name)) throw new Error(`MCP tool ${name} is missing.`);
  }

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const environment = await call("create_environment", {
    name: "M2 deployed smoke",
    provider: "entra",
    seed: `m2-smoke-${suffix}`,
  });
  environmentId = environment.id;
  if (typeof environmentId !== "string" || typeof environment.tenantId !== "string") {
    throw new Error("create_environment returned an invalid environment.");
  }

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
    groups: [],
  });
  const userId = seeded.users?.[0]?.id;
  if (typeof userId !== "string") throw new Error("The smoke user was not created.");

  const redirectUri = "https://client.example.test/mockos-smoke-callback";
  const application = await call("create_application", {
    environmentId,
    name: "M2 smoke client",
    redirectUris: [redirectUri],
    grantTypes: ["authorization_code"],
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
      tid: environment.tenantId,
      oid: userId,
    })
  );

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    )
  );
  const authorize = new URL(urls.authorizationEndpoint);
  authorize.search = new URLSearchParams({
    client_id: application.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile email",
    state: "m2-smoke-state",
    nonce: "m2-smoke-nonce",
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
        scope: "openid profile email",
        state: "m2-smoke-state",
        nonce: "m2-smoke-nonce",
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
  if (!code || callback.searchParams.get("state") !== "m2-smoke-state") {
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
    verifyJwt(tokens.id_token, jwks, {
      iss: urls.issuer,
      aud: application.clientId,
      tid: environment.tenantId,
      oid: userId,
      nonce: "m2-smoke-nonce",
    })
  );

  await call("set_scenario", {
    environmentId,
    id: "m2-mfa-required",
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
    method: "POST",
    path: new URL(urls.tokenEndpoint).pathname,
    status: 400,
    count: { exactly: 1 },
  });
  if (assertion.pass !== true)
    throw new Error("The deployed request assertion failed.");

  await call("clear_scenario", {
    environmentId,
    scenarioId: "m2-mfa-required",
  });

  process.stdout.write(
    "PASS  authenticated MCP, minted and OIDC JWT verification, AADSTS50076 injection, request log, and assertion.\n"
  );
} finally {
  if (environmentId) {
    try {
      await call("delete_environment", { environmentId });
      process.stdout.write("PASS  smoke environment cleanup.\n");
    } catch (error) {
      process.stderr.write(
        `WARN  smoke cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
  await client.close().catch(() => undefined);
}
