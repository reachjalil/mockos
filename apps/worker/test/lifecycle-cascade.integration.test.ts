import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const controlOrigin = "https://mockos.test";
const publicOrigin = new URL(Reflect.get(env, "PUBLIC_ORIGIN") as string).origin;
const worker = (exports as unknown as { default: Fetcher }).default;

type JsonRpcResponse = {
  error?: { code: number; message: string };
  result?: Record<string, unknown>;
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

const initializeMcp = async (): Promise<string> => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "mockos-lifecycle-cascade", version: "1.0.0" },
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const [message] = await parseMessages(response);
  expect(message?.error).toBeUndefined();

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
    | { isError?: boolean; structuredContent?: { data?: T } }
    | undefined;
  expect(result?.isError).not.toBe(true);
  expect(result?.structuredContent?.data).toBeDefined();
  return result?.structuredContent?.data as T;
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const formRequest = (url: string, fields: Record<string, string>) =>
  worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });

describe("hosted OAuth lifecycle cascade", () => {
  it("revokes an Entra refresh family through the authenticated lifecycle tool", {
    timeout: 14_000,
  }, async () => {
    const sessionId = await initializeMcp();
    let environmentId: string | undefined;
    try {
      const environment = await callTool<{
        id: string;
        provider: "entra";
        tenantId: string;
      }>(sessionId, "create_environment", {
        name: "Entra lifecycle cascade",
        provider: "entra",
        seed: "worker-lifecycle-cascade",
      });
      environmentId = environment.id;

      const userName = "lifecycle@example.test";
      const password = "Passw0rd!";
      const seeded = await callTool<{
        users: Array<{ id: string; userName: string }>;
      }>(sessionId, "seed_identities", {
        environmentId,
        users: [
          {
            userName,
            displayName: "Lifecycle User",
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

      const clientId = "lifecycle-cascade-client";
      const clientSecret = "lifecycle-cascade-secret";
      const redirectUri = "https://client.example/lifecycle-callback";
      await callTool(sessionId, "create_application", {
        environmentId,
        name: "Lifecycle cascade client",
        clientId,
        clientSecret,
        redirectUris: [redirectUri],
        grantTypes: ["authorization_code", "refresh_token"],
        appRoles: [],
        groupClaimsMode: "none",
      });
      const urls = await callTool<{
        authorizationEndpoint: string;
        tokenEndpoint: string;
      }>(sessionId, "get_wellknown_urls", { environmentId });

      const verifier =
        "lifecycle-cascade-pkce-verifier-with-more-than-forty-three-characters";
      const challenge = base64Url(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
        )
      );
      const scope = "openid profile offline_access";
      const authorizeUrl = new URL(urls.authorizationEndpoint);
      authorizeUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope,
        state: "lifecycle-state",
        code_challenge: challenge,
        code_challenge_method: "S256",
        login_hint: userName,
      }).toString();
      const loginPage = await worker.fetch(authorizeUrl);
      expect(loginPage.status).toBe(200);
      const loginHtml = await loginPage.text();
      const loginAction = /<form method="post" action="([^"]+)">/.exec(loginHtml)?.[1];
      expect(loginAction).toBeTruthy();

      const login = await formRequest(new URL(loginAction ?? "", publicOrigin).href, {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        response_mode: "query",
        scope,
        state: "lifecycle-state",
        code_challenge: challenge,
        code_challenge_method: "S256",
        username: userName,
        password,
      });
      expect(login.status, await login.clone().text()).toBe(302);
      const callback = new URL(login.headers.get("location") ?? "");
      expect(callback.searchParams.get("state")).toBe("lifecycle-state");
      const code = callback.searchParams.get("code");
      expect(code).toBeTruthy();

      const issuedResponse = await formRequest(urls.tokenEndpoint, {
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code: code ?? "",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      expect(issuedResponse.status, await issuedResponse.clone().text()).toBe(200);
      const issued = await issuedResponse.json<{ refresh_token: string }>();
      expect(issued.refresh_token).toBeTruthy();

      const lifecycle = await callTool<{
        action: string;
        changed: boolean;
        currentState: string;
        previousState: string;
        revoked: { accessTokens: number; refreshTokens: number };
      }>(sessionId, "simulate_lifecycle", {
        environmentId,
        userId,
        action: "disable",
      });
      expect(lifecycle).toMatchObject({
        action: "disable",
        previousState: "active",
        currentState: "disabled",
        changed: true,
        revoked: { accessTokens: 1, refreshTokens: 1 },
      });

      const disabledRefresh = await formRequest(urls.tokenEndpoint, {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: issued.refresh_token,
      });
      expect(disabledRefresh.status).toBe(400);
      expect(await disabledRefresh.json()).toMatchObject({
        error: "invalid_grant",
        error_codes: [50057],
        error_description: expect.stringContaining("AADSTS50057"),
      });

      const authorizePath = new URL(urls.authorizationEndpoint).pathname;
      const tokenPath = new URL(urls.tokenEndpoint).pathname;
      const requestLog = await callTool<{
        entries: Array<{
          method: string;
          path: string;
          responseStatus: number;
        }>;
      }>(sessionId, "get_request_log", {
        environmentId,
        source: "inbound",
        provider: "entra",
        method: "POST",
        limit: 20,
      });
      expect(requestLog.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            path: authorizePath,
            responseStatus: 302,
          }),
          expect.objectContaining({
            method: "POST",
            path: tokenPath,
            responseStatus: 200,
          }),
          expect.objectContaining({
            method: "POST",
            path: tokenPath,
            responseStatus: 400,
          }),
        ])
      );

      await expect(
        callTool<{ matched: number; pass: boolean }>(sessionId, "assert_requests", {
          environmentId,
          source: "inbound",
          method: "POST",
          path: authorizePath,
          status: 302,
          count: { exactly: 1 },
        })
      ).resolves.toMatchObject({ pass: true, matched: 1 });
      await expect(
        callTool<{ matched: number; pass: boolean }>(sessionId, "assert_requests", {
          environmentId,
          source: "inbound",
          method: "POST",
          path: tokenPath,
          status: 400,
          bodyIncludes: "grant_type=refresh_token",
          count: { exactly: 1 },
        })
      ).resolves.toMatchObject({ pass: true, matched: 1 });
    } finally {
      if (environmentId) {
        const deleted = await callTool<{
          deleted: true;
          environmentId: string;
        }>(sessionId, "delete_environment", { environmentId });
        expect(deleted).toEqual({ deleted: true, environmentId });
      }
    }
  });
});
