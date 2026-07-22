import { exports } from "cloudflare:workers";
import {
  assertFixtureResults,
  type ConformanceFixture,
  parseFixture,
  runFixtures,
} from "@mockos/testkit";
import { describe, expect, it } from "vitest";
import expiredJson from "../../../packages/testkit/fixtures/entra/oidc/31-mint-token-expired.json";
import wrongAudienceJson from "../../../packages/testkit/fixtures/entra/oidc/32-mint-token-wrong-audience.json";
import notYetValidJson from "../../../packages/testkit/fixtures/entra/oidc/33-mint-token-not-yet-valid.json";
import badSignatureJson from "../../../packages/testkit/fixtures/entra/oidc/34-mint-token-bad-signature.json";
import wrongIssuerJson from "../../../packages/testkit/fixtures/entra/oidc/35-mint-token-wrong-issuer.json";
import rotateJson from "../../../packages/testkit/fixtures/entra/oidc/36-scenario-rotate-signing-key.json";
import skewJson from "../../../packages/testkit/fixtures/entra/oidc/37-scenario-token-clock-skew.json";
import overageJson from "../../../packages/testkit/fixtures/entra/oidc/38-group-overage-get-member-objects.json";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const environmentId = "fixture-tokens-01";
const tenantId = "49a814c6-c006-47bd-90d6-81510b3c3904";
const clientId = "fixture-token-client";
const userName = "fixture-user@example.test";
const worker = (exports as unknown as { default: Fetcher }).default;

const rawFixtures: ReadonlyArray<{ readonly file: string; readonly value: unknown }> = [
  { file: "31-mint-token-expired.json", value: expiredJson },
  { file: "32-mint-token-wrong-audience.json", value: wrongAudienceJson },
  { file: "33-mint-token-not-yet-valid.json", value: notYetValidJson },
  { file: "34-mint-token-bad-signature.json", value: badSignatureJson },
  { file: "35-mint-token-wrong-issuer.json", value: wrongIssuerJson },
  { file: "36-scenario-rotate-signing-key.json", value: rotateJson },
  { file: "37-scenario-token-clock-skew.json", value: skewJson },
  { file: "38-group-overage-get-member-objects.json", value: overageJson },
];

type JsonRpcResponse = {
  id?: number | string;
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
};

type MintedToken = {
  token: string;
  claims: Record<string, unknown>;
  broken?: string;
};

type Jwks = { keys: Array<JsonWebKey & { kid?: string }> };

const decode = <T>(encoded: string): T => {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
  ) as T;
};

const signatureValid = async (token: string, jwks: Jwks): Promise<boolean> => {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) return false;
  const header = decode<{ alg?: string; kid?: string }>(encodedHeader);
  const jwk = jwks.keys.find(({ kid }) => kid === header.kid);
  if (!jwk || header.alg !== "RS256") return false;
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
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
};

const parseMessages = (body: string, contentType: string | null): JsonRpcResponse[] => {
  if (!body) return [];
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
};

const interpolate = (
  value: unknown,
  variables: Readonly<Record<string, string>>
): unknown => {
  if (typeof value === "string") {
    return Object.entries(variables).reduce(
      (result, [name, replacement]) => result.replaceAll(`{{${name}}}`, replacement),
      value
    );
  }
  if (Array.isArray(value)) return value.map((entry) => interpolate(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        interpolate(entry, variables),
      ])
    );
  }
  return value;
};

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${origin}${path}`, { ...init, headers });
};

const mcpHeaders = (sessionId?: string): Headers => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
};

const mcpRequest = (
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<Response> =>
  worker.fetch(`${origin}/mcp`, {
    method: "POST",
    headers: mcpHeaders(sessionId),
    body: JSON.stringify(payload),
  });

const initializeMcp = async (): Promise<string> => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mockos-fixture-executor", version: "1.0.0" },
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await response.body?.cancel();

  const initialized = await mcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId ?? ""
  );
  expect([200, 202, 204]).toContain(initialized.status);
  await initialized.body?.cancel();
  return sessionId ?? "";
};

const toolData = <T>(message: unknown): T => {
  if (!message || typeof message !== "object") {
    throw new Error("Expected an MCP JSON-RPC response object.");
  }
  const error = Reflect.get(message, "error");
  if (error !== undefined) {
    throw new Error(`MCP tool returned an error: ${JSON.stringify(error)}`);
  }
  const result = Reflect.get(message, "result");
  const structuredContent =
    result && typeof result === "object"
      ? Reflect.get(result, "structuredContent")
      : undefined;
  const data =
    structuredContent && typeof structuredContent === "object"
      ? Reflect.get(structuredContent, "data")
      : undefined;
  if (!data || typeof data !== "object") {
    throw new Error("MCP tool response did not contain structured data.");
  }
  return data as T;
};

const mintThroughMcp = async (sessionId: string, id: number): Promise<MintedToken> => {
  const response = await mcpRequest(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "mint_token",
        arguments: { environmentId, clientId, subject: userName },
      },
    },
    sessionId
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const [message] = parseMessages(text, response.headers.get("content-type"));
  return toolData<MintedToken>(message);
};

const fixtureRequest = (fixture: ConformanceFixture, exactUrl?: string): Request => {
  const providerPath =
    fixture.request.path === "/mcp"
      ? fixture.request.path
      : `/e/${environmentId}${fixture.request.path}`;
  const url = exactUrl ? new URL(exactUrl) : new URL(providerPath, origin);
  for (const [name, value] of Object.entries(fixture.request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const headers = new Headers(fixture.request.headers);
  let body: BodyInit | undefined;
  if (fixture.request.form) {
    body = new URLSearchParams(fixture.request.form);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
  } else if (fixture.request.body !== undefined) {
    body = JSON.stringify(fixture.request.body);
  }
  return new Request(url, {
    method: fixture.request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
};

const responseBody = async (
  fixture: ConformanceFixture,
  response: Response
): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  if (fixture.request.path === "/mcp") {
    return parseMessages(text, response.headers.get("content-type"))[0];
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

describe("M6 token fixture executor", () => {
  it("executes fixtures 31-38 through authenticated Worker MCP and Graph routes", {
    timeout: 30_000,
  }, async () => {
    const configure = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        id: environmentId,
        name: "M6 token fixture environment",
        provider: "entra",
        seed: "m6-token-fixture-executor",
        tenantId,
        createdAt: "2026-07-22T12:00:00.000Z",
        idleTtlHours: 168,
        requestLogLimit: 10_000,
      }),
    });
    expect(configure.status, await configure.clone().text()).toBe(200);

    const groupIds = Array.from({ length: 201 }, (_, index) =>
      index === 0 ? "grp_fixture" : `grp_fixture_${String(index + 1).padStart(3, "0")}`
    );
    const seed = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/identities:seed`,
      {
        method: "POST",
        body: JSON.stringify({
          users: [
            {
              userName,
              displayName: "Fixture User",
              password: "Passw0rd!",
              active: true,
              mfaState: "none",
              roles: [],
            },
          ],
          groups: groupIds.map((id, index) => ({
            id,
            displayName: `Fixture Group ${String(index + 1).padStart(3, "0")}`,
            members: [userName],
          })),
        }),
      }
    );
    expect(seed.status, await seed.clone().text()).toBe(200);
    const seeded = await seed.json<{ data: { users: Array<{ id: string }> } }>();
    const subjectId = seeded.data.users[0]?.id;
    expect(subjectId).toBeTruthy();

    const application = await controlFetch(
      `/__mockos/v1/environments/${environmentId}/applications`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Fixture token client",
          clientId,
          clientSecret: "fixture-token-secret",
          redirectUris: ["https://client.example/callback"],
          grantTypes: ["authorization_code"],
          appRoles: [],
          groupClaimsMode: "all",
        }),
      }
    );
    expect(application.status, await application.clone().text()).toBe(201);

    const sessionId = await initializeMcp();
    const jwksUrl = `${origin}/e/${environmentId}/${tenantId}/discovery/v2.0/keys`;
    const beforeRotationJwks = await (await worker.fetch(jwksUrl)).json<Jwks>();
    expect(beforeRotationJwks.keys).toHaveLength(2);

    const accessToken = await mintThroughMcp(sessionId, 900);
    expect(accessToken.claims.sub).toBe(subjectId);
    expect(accessToken.claims).not.toHaveProperty("groups");
    const claimSources = Reflect.get(accessToken.claims, "_claim_sources");
    const source =
      claimSources && typeof claimSources === "object"
        ? Reflect.get(claimSources, "src1")
        : undefined;
    const claimSourceEndpoint =
      source && typeof source === "object"
        ? Reflect.get(source, "endpoint")
        : undefined;
    if (typeof claimSourceEndpoint !== "string") {
      throw new Error("Expected an overage claim-source endpoint.");
    }
    const claimSourceUrl = new URL(claimSourceEndpoint);
    const routedPrefix = `/e/${environmentId}`;
    expect(claimSourceUrl.protocol).toBe("https:");
    expect(claimSourceUrl.pathname).toBe(
      `${routedPrefix}/graph/v1.0/users/${subjectId}/getMemberObjects`
    );
    const claimSourcePath = claimSourceUrl.pathname.slice(routedPrefix.length + 1);

    const variables = {
      accessToken: accessToken.token,
      apiKey,
      claimSourcePath,
      sessionId,
    };
    const fixtures = rawFixtures.map(({ file, value }) =>
      parseFixture(interpolate(value, variables), file)
    );
    let rotatedToken: MintedToken | undefined;
    let rotationJwks: Jwks | undefined;
    let skewedToken: MintedToken | undefined;
    let skewStartedAt = 0;
    let skewFinishedAt = 0;
    const results = await runFixtures(fixtures, async (fixture) => {
      const exactUrl =
        fixture.name === "Resolve group overage with getMemberObjects"
          ? claimSourceEndpoint
          : undefined;
      const request = fixtureRequest(fixture, exactUrl);
      if (fixture.name === "Resolve group overage with getMemberObjects") {
        expect(request.url).toBe(claimSourceEndpoint);
      }
      const response = await worker.fetch(request);
      const body = await responseBody(fixture, response);
      if (fixture.name === "Rotate signing key before token signing") {
        rotatedToken = await mintThroughMcp(sessionId, 936);
        rotationJwks = await (await worker.fetch(jwksUrl)).json<Jwks>();
      }
      if (fixture.name === "Skew token claims before signing") {
        skewStartedAt = Math.floor(Date.now() / 1_000);
        skewedToken = await mintThroughMcp(sessionId, 937);
        skewFinishedAt = Math.floor(Date.now() / 1_000);
      }
      return {
        status: response.status,
        headers: response.headers,
        body,
      };
    });

    expect(results).toHaveLength(8);
    assertFixtureResults(results);

    const brokenByVariant = new Map<string, MintedToken>();
    for (const result of results.slice(0, 5)) {
      const minted = toolData<MintedToken>(result.response.body);
      expect(minted.token.split(".")).toHaveLength(3);
      expect(decode<Record<string, unknown>>(minted.token.split(".")[1] ?? "")).toEqual(
        minted.claims
      );
      expect(minted.broken).toBeTruthy();
      brokenByVariant.set(minted.broken ?? "", minted);
    }

    expect(brokenByVariant.get("expired")?.claims).toMatchObject({
      nbf: brokenByVariant.get("expired")?.claims.iat,
    });
    expect(Number(brokenByVariant.get("expired")?.claims.exp)).toBeLessThan(
      Math.floor(Date.now() / 1_000)
    );
    expect(
      Number(brokenByVariant.get("expired")?.claims.exp) -
        Number(brokenByVariant.get("expired")?.claims.iat)
    ).toBe(3_540);
    expect(brokenByVariant.get("wrong_audience")?.claims.aud).toBe(
      "https://wrong-audience.mockos.invalid/fixture-token-client"
    );
    expect(Number(brokenByVariant.get("not_yet_valid")?.claims.nbf)).toBeGreaterThan(
      Math.floor(Date.now() / 1_000)
    );
    expect(
      Number(brokenByVariant.get("not_yet_valid")?.claims.exp) -
        Number(brokenByVariant.get("not_yet_valid")?.claims.nbf)
    ).toBe(3_600);
    expect(brokenByVariant.get("wrong_issuer")?.claims.iss).toBe(
      "https://wrong-issuer.mockos.invalid"
    );

    const postRotationJwks = rotationJwks;
    expect(postRotationJwks?.keys).toHaveLength(3);
    if (!postRotationJwks || !rotatedToken || !skewedToken) {
      throw new Error("Expected rotation and skew fixtures to be consumed.");
    }
    const originalKid = decode<{ kid: string }>(
      accessToken.token.split(".")[0] ?? ""
    ).kid;
    const rotatedKid = decode<{ kid: string }>(
      rotatedToken.token.split(".")[0] ?? ""
    ).kid;
    expect(rotatedKid).not.toBe(originalKid);
    expect(beforeRotationJwks.keys.map(({ kid }) => kid)).toContain(rotatedKid);
    expect(postRotationJwks.keys.map(({ kid }) => kid)).toEqual(
      expect.arrayContaining([originalKid, rotatedKid])
    );
    await expect(signatureValid(accessToken.token, postRotationJwks)).resolves.toBe(
      true
    );
    await expect(signatureValid(rotatedToken.token, postRotationJwks)).resolves.toBe(
      true
    );

    expect(Number(skewedToken.claims.iat)).toBeGreaterThanOrEqual(skewStartedAt + 300);
    expect(Number(skewedToken.claims.iat)).toBeLessThanOrEqual(skewFinishedAt + 300);
    expect(skewedToken.claims.nbf).toBe(skewedToken.claims.iat);
    expect(Number(skewedToken.claims.exp) - Number(skewedToken.claims.iat)).toBe(3_600);
    await expect(signatureValid(skewedToken.token, postRotationJwks)).resolves.toBe(
      true
    );

    for (const [variant, minted] of brokenByVariant) {
      expect(minted.claims).not.toHaveProperty("groups");
      expect(minted.claims).toMatchObject({
        _claim_sources: { src1: { endpoint: claimSourceEndpoint } },
      });
      await expect(signatureValid(minted.token, postRotationJwks)).resolves.toBe(
        variant !== "bad_signature"
      );
    }

    const graphResult = results.at(-1)?.response.body;
    if (!graphResult || typeof graphResult !== "object") {
      throw new Error("Expected the Graph fixture response body.");
    }
    const returnedGroupIds = Reflect.get(graphResult, "value");
    expect(returnedGroupIds).toHaveLength(201);
    expect(new Set(returnedGroupIds as string[])).toEqual(new Set(groupIds));
  });
});
