import { describe, expect, it, vi } from "vitest";
import { MockosApiError, MockosClient, MockosProtocolError } from "../src/index";

const environment = {
  id: "env_client_test",
  name: "Client test",
  provider: "entra" as const,
  seed: "client-test",
  tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
  createdAt: "2026-07-23T12:00:00.000Z",
  idleTtlHours: 168,
  requestLogLimit: 10_000,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("MockosClient", () => {
  it("encodes known paths, queries, bodies, and constructor-owned authorization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          issuer: "https://issuer.example/tenant/v2.0",
          authorization_endpoint: "https://issuer.example/tenant/oauth2/v2.0/authorize",
          token_endpoint: "https://issuer.example/tenant/oauth2/v2.0/token",
          jwks_uri: "https://issuer.example/tenant/discovery/v2.0/keys",
          userinfo_endpoint: "https://issuer.example/tenant/openid/userinfo",
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          subject_types_supported: ["pairwise"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          claims_supported: ["sub"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
        },
        meta: { requestId: "req_client_1" },
      })
    );
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      accessKey: "test-access-key",
      fetch,
    });

    await client.getEnvironmentDiscovery(
      "env_client_test",
      "https://issuer.example/base?shape=one two"
    );

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://mockos.example/__mockos/v1/environments/env_client_test/well-known?issuer_base=https%3A%2F%2Fissuer.example%2Fbase%3Fshape%3Done+two"
    );
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-access-key"
    );
  });

  it("validates request defaults and response envelopes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: {
            users: [{ id: "usr_1", userName: "ada@example.test" }],
            groups: [],
          },
          meta: { requestId: "req_client_2" },
        },
        200
      )
    );
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1/",
      fetch,
    });

    await client.seedIdentities("env_client_test", {
      users: [
        {
          userName: "ada@example.test",
          displayName: "Ada",
        },
      ],
      groups: [],
    });

    const [, init] = fetch.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      users: [
        {
          userName: "ada@example.test",
          password: "Passw0rd!",
          active: true,
          roles: [],
        },
      ],
      groups: [],
    });

    fetch.mockResolvedValueOnce(
      jsonResponse({ data: { id: "wrong-shape" }, meta: { requestId: "req" } })
    );
    await expect(
      client.configureEnvironment("env_client_test", environment)
    ).rejects.toBeInstanceOf(MockosProtocolError);
  });

  it("raises typed validated problems without reflecting the Access Key", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          type: "https://mockos.live/problems/forbidden",
          title: "Forbidden",
          status: 403,
          detail: "The requested environment is not available.",
          requestId: "req_problem_1",
          code: "FORBIDDEN",
        },
        403
      )
    );
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      accessKey: "never-reflect-this",
      fetch,
    });

    const error = await client
      .deleteEnvironment("env_client_test")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MockosApiError);
    expect(error).toMatchObject({
      status: 403,
      problem: { code: "FORBIDDEN", requestId: "req_problem_1" },
    });
    expect(JSON.stringify(error)).not.toContain("never-reflect-this");
  });

  it("forwards aborts and rejects unsafe endpoints or unexpected success codes", async () => {
    expect(
      () =>
        new MockosClient({
          endpoint: "https://user:secret@mockos.example/__mockos/v1",
        })
    ).toThrow(/credentials/);
    expect(
      () =>
        new MockosClient({
          endpoint: "file:///tmp/mockos",
        })
    ).toThrow(/http or https/);

    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        })
    );
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      fetch,
    });
    const pending = client.deleteEnvironment("env_client_test", {
      signal: controller.signal,
    });
    controller.abort(new Error("caller stopped"));
    await expect(pending).rejects.toThrow("caller stopped");

    const wrongStatusClient = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });
    await expect(
      wrongStatusClient.deleteEnvironment("env_client_test")
    ).rejects.toBeInstanceOf(MockosProtocolError);
  });

  it("keeps timeout cancellation active while consuming the response body", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          if (!requestSignal?.aborted) {
            throw new Error("request timeout was cleared before body consumption");
          }
          throw requestSignal.reason;
        },
      } as Response;
    });
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      fetch,
      timeoutMs: 5,
    });

    const error = await client
      .configureEnvironment("env_client_test", environment)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ name: "TimeoutError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("never fetches an unknown or MCP-only operation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new MockosClient({
      endpoint: "https://mockos.example/__mockos/v1",
      fetch,
    });

    await expect(
      client.request(
        "set_current_environment" as never,
        { path: { environmentId: "env_client_test" } } as never
      )
    ).rejects.toBeInstanceOf(MockosProtocolError);
    await expect(
      client.request("https://attacker.example/collect" as never, { path: {} } as never)
    ).rejects.toBeInstanceOf(MockosProtocolError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
