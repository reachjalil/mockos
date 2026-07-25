import { describe, expect, it } from "vitest";
import {
  forwardEnvironmentRequest,
  graphBaseUrlForEnvironment,
  resolveEnvironmentRequest,
} from "./host-resolver";

const environmentId = "test-env_01";
const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";

describe("resolveEnvironmentRequest", () => {
  it("resolves locked path-mode Entra traffic", () => {
    const result = resolveEnvironmentRequest(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/authorize`,
      { hostingMode: "path" }
    );
    expect(result).toMatchObject({
      environmentId,
      forwardedPath: `/${tenantId}/oauth2/v2.0/authorize`,
      graphBaseUrl: `https://mockos.example/e/${environmentId}/graph/v1.0`,
      issuerBase: `https://mockos.example/e/${environmentId}/${tenantId}/v2.0`,
      provider: "entra",
    });
  });

  it("does not silently accept subdomain traffic in path mode", () => {
    expect(
      resolveEnvironmentRequest(
        `https://${environmentId}.id.mockos.live/oauth2/default/v1/authorize`,
        { hostingMode: "path" }
      )
    ).toBeUndefined();
  });

  it("resolves an Okta environment subdomain", () => {
    const result = resolveEnvironmentRequest(
      `https://${environmentId}.id.mockos.live/oauth2/default/v1/authorize`,
      { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
    );
    expect(result).toMatchObject({
      environmentId,
      issuerBase: `https://${environmentId}.id.mockos.live/oauth2/default`,
      provider: "okta",
    });
  });

  it("routes the Okta device activation page in path mode", () => {
    const result = resolveEnvironmentRequest(
      `https://mockos.example/e/${environmentId}/activate?user_code=ABCD2345`,
      { hostingMode: "path" }
    );

    expect(result).toMatchObject({
      environmentId,
      forwardedPath: "/activate",
      issuerBase: `https://mockos.example/e/${environmentId}/oauth2/default`,
      provider: "okta",
    });
  });

  it("routes SCIM and Graph surfaces to the named environment", () => {
    expect(
      resolveEnvironmentRequest(
        `https://mockos.example/e/${environmentId}/scim/v2/Users`,
        { hostingMode: "path" }
      )
    ).toMatchObject({
      environmentId,
      forwardedPath: "/scim/v2/Users",
      issuerBase: `https://mockos.example/e/${environmentId}`,
      provider: "scim",
    });
    expect(
      resolveEnvironmentRequest(
        `https://mockos.example/e/${environmentId}/graph/v1.0/users`,
        { hostingMode: "path" }
      )
    ).toMatchObject({
      environmentId,
      forwardedPath: "/graph/v1.0/users",
      issuerBase: `https://mockos.example/e/${environmentId}`,
      provider: "graph",
    });
    expect(
      resolveEnvironmentRequest(`https://mockos.example/e/${environmentId}/api/v1`, {
        hostingMode: "path",
      })
    ).toMatchObject({
      environmentId,
      forwardedPath: "/api/v1",
      provider: "okta",
    });
  });

  it("returns a tenant locator for the Entra login host", () => {
    const result = resolveEnvironmentRequest(
      `https://login.id.mockos.live/${tenantId}/v2.0/.well-known/openid-configuration`,
      { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
    );
    expect(result).toMatchObject({
      issuerBase: `https://login.id.mockos.live/${tenantId}/v2.0`,
      locator: { type: "tenant", tenantId },
      provider: "entra",
    });
    expect(result?.environmentId).toBeUndefined();
    if (!result) throw new Error("Expected Entra tenant route.");
    expect(
      graphBaseUrlForEnvironment(result, environmentId, {
        hostingMode: "subdomain",
        baseDomain: "id.mockos.live",
      })
    ).toBe(`https://${environmentId}.id.mockos.live/graph/v1.0`);
  });

  it("resolves mock MCP endpoints without identity-provider metadata", () => {
    expect(
      resolveEnvironmentRequest(
        `https://mockos.example/e/${environmentId}/mcp-mock/recruiting-agent`,
        { hostingMode: "path" }
      )
    ).toEqual({
      kind: "mock-mcp",
      environmentId,
      forwardedPath: "/mcp-mock/recruiting-agent",
      locator: { type: "environment", environmentId },
      publicBase: `https://mockos.example/e/${environmentId}`,
      slug: "recruiting-agent",
    });

    expect(
      resolveEnvironmentRequest(
        `https://${environmentId}.id.mockos.live/mcp-mock/recruiting-agent`,
        { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
      )
    ).toEqual({
      kind: "mock-mcp",
      environmentId,
      forwardedPath: "/mcp-mock/recruiting-agent",
      locator: { type: "environment", environmentId },
      publicBase: `https://${environmentId}.id.mockos.live`,
      slug: "recruiting-agent",
    });
  });

  it("resolves OpenAI mock LLM endpoints in both hosting modes", () => {
    expect(
      resolveEnvironmentRequest(
        `https://mockos.example/e/${environmentId}/llm-mock/agent-tests/openai/v1/chat/completions`,
        { hostingMode: "path" }
      )
    ).toEqual({
      kind: "mock-llm",
      dialect: "openai",
      environmentId,
      forwardedPath: "/llm-mock/agent-tests/openai/v1/chat/completions",
      locator: { type: "environment", environmentId },
      providerPath: "/chat/completions",
      publicBase: `https://mockos.example/e/${environmentId}`,
      slug: "agent-tests",
    });

    expect(
      resolveEnvironmentRequest(
        `https://${environmentId}.id.mockos.live/llm-mock/agent-tests/openai/v1/models/mockos-text-1`,
        { hostingMode: "subdomain", baseDomain: "id.mockos.live" }
      )
    ).toEqual({
      kind: "mock-llm",
      dialect: "openai",
      environmentId,
      forwardedPath: "/llm-mock/agent-tests/openai/v1/models/mockos-text-1",
      locator: { type: "environment", environmentId },
      providerPath: "/models/mockos-text-1",
      publicBase: `https://${environmentId}.id.mockos.live`,
      slug: "agent-tests",
    });
  });

  it("rejects malformed, nested, or unsupported mock LLM roots", () => {
    for (const path of [
      "/llm-mock/UPPERCASE/openai/v1/models",
      "/llm-mock/a/extra/openai/v1/models",
      "/llm-mock/%2Fescaped/openai/v1/models",
      "/llm-mock/demo/anthropic/v1/messages",
      "/llm-mock/demo/openai/v2/models",
      "/llm-mock//openai/v1/models",
    ]) {
      expect(
        resolveEnvironmentRequest(`https://mockos.example/e/${environmentId}${path}`, {
          hostingMode: "path",
        })
      ).toBeUndefined();
    }
  });

  it("rejects malformed or nested mock MCP endpoint paths", () => {
    for (const path of [
      "/mcp-mock/UPPERCASE",
      "/mcp-mock/a/extra",
      "/mcp-mock/%2Fescaped",
      "/mcp-mock/",
    ]) {
      expect(
        resolveEnvironmentRequest(`https://mockos.example/e/${environmentId}${path}`, {
          hostingMode: "path",
        })
      ).toBeUndefined();
    }
  });

  it("removes caller-supplied internal routing headers before forwarding", () => {
    const request = new Request(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "x-mockos-env": "attacker-env",
          "x-mockos-graph-base": "https://attacker.example/graph/v1.0",
          "x-mockos-issuer-base": "https://attacker.example",
          "x-mockos-public-path": "/spoofed",
          "x-mockos-private-future": "spoofed",
        },
      }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (!resolution?.environmentId) throw new Error("Expected environment route.");

    const forwarded = forwardEnvironmentRequest(request, {
      ...resolution,
      environmentId: resolution.environmentId,
    });

    expect(forwarded.headers.get("x-mockos-env")).toBe(environmentId);
    expect(forwarded.headers.get("x-mockos-route-kind")).toBe("identity");
    expect(forwarded.headers.get("x-mockos-issuer-base")).toBe(
      `https://mockos.example/e/${environmentId}/${tenantId}/v2.0`
    );
    expect(forwarded.headers.get("x-mockos-public-path")).toBe(
      `/e/${environmentId}/${tenantId}/oauth2/v2.0/token`
    );
    expect(forwarded.headers.get("x-mockos-graph-base")).toBe(
      `https://mockos.example/e/${environmentId}/graph/v1.0`
    );
    expect(forwarded.headers.has("x-mockos-private-future")).toBe(false);
  });

  it("replaces caller-supplied mock MCP routing metadata", () => {
    const request = new Request(
      `https://mockos.example/e/${environmentId}/mcp-mock/recruiting-agent`,
      {
        method: "POST",
        headers: {
          "x-mockos-mcp-slug": "spoofed",
          "x-mockos-route-kind": "identity",
        },
      }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (resolution?.kind !== "mock-mcp") {
      throw new Error("Expected mock MCP route.");
    }

    const forwarded = forwardEnvironmentRequest(request, resolution);

    expect(new URL(forwarded.url).pathname).toBe("/mcp-mock/recruiting-agent");
    expect(forwarded.headers.get("x-mockos-env")).toBe(environmentId);
    expect(forwarded.headers.get("x-mockos-route-kind")).toBe("mock-mcp");
    expect(forwarded.headers.get("x-mockos-mcp-slug")).toBe("recruiting-agent");
    expect(forwarded.headers.has("x-mockos-issuer-base")).toBe(false);
  });

  it("replaces caller-supplied mock LLM routing metadata", () => {
    const request = new Request(
      `https://mockos.example/e/${environmentId}/llm-mock/agent-tests/openai/v1/models`,
      {
        headers: {
          "x-mockos-llm-dialect": "anthropic",
          "x-mockos-llm-slug": "spoofed",
          "x-mockos-route-kind": "identity",
        },
      }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (resolution?.kind !== "mock-llm") {
      throw new Error("Expected mock LLM route.");
    }

    const forwarded = forwardEnvironmentRequest(request, resolution);

    expect(new URL(forwarded.url).pathname).toBe(
      "/llm-mock/agent-tests/openai/v1/models"
    );
    expect(forwarded.headers.get("x-mockos-env")).toBe(environmentId);
    expect(forwarded.headers.get("x-mockos-route-kind")).toBe("mock-llm");
    expect(forwarded.headers.get("x-mockos-llm-dialect")).toBe("openai");
    expect(forwarded.headers.get("x-mockos-llm-slug")).toBe("agent-tests");
    expect(forwarded.headers.has("x-mockos-issuer-base")).toBe(false);
  });

  it("marks matching control authorization for log redaction without altering it", () => {
    const authorization = "Bearer self-host-control-secret";
    const request = new Request(
      `https://mockos.example/e/${environmentId}/${tenantId}/oauth2/v2.0/token`,
      { headers: { authorization } }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (!resolution?.environmentId) throw new Error("Expected environment route.");

    const forwarded = forwardEnvironmentRequest(
      request,
      { ...resolution, environmentId: resolution.environmentId },
      { redactAuthorization: true }
    );

    expect(forwarded.headers.get("authorization")).toBe(authorization);
    expect(forwarded.headers.get("x-mockos-redact-authorization")).toBe("true");
  });

  it("preserves abort propagation when forwarding into the environment object", () => {
    const controller = new AbortController();
    const request = new Request(
      `https://mockos.example/e/${environmentId}/mcp-mock/recruiting-agent`,
      { method: "POST", signal: controller.signal }
    );
    const resolution = resolveEnvironmentRequest(request, { hostingMode: "path" });
    if (resolution?.kind !== "mock-mcp") {
      throw new Error("Expected mock MCP route.");
    }

    const forwarded = forwardEnvironmentRequest(request, resolution);
    expect(forwarded.signal.aborted).toBe(false);
    controller.abort("client disconnected");
    expect(forwarded.signal.aborted).toBe(true);
    expect(forwarded.signal.reason).toBe("client disconnected");
  });
});
