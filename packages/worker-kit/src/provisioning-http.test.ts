import {
  provisioningHttpOperationSchema,
  provisioningTargetSchema,
} from "@mockos/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_PROVISIONING_HTTP_BODY_BYTES,
  performProvisioningHttpOperation,
  UnsafeProvisioningHeaderError,
} from "./provisioning-http";

const target = provisioningTargetSchema.parse({
  ref: "target-app",
  baseUrl: "https://target.example.com/scim/v2",
  auth: { kind: "bearer", credentialRef: "credential_test" },
  behavior: {},
});

const operation = (headers: Record<string, string> = {}) =>
  provisioningHttpOperationSchema.parse({
    type: "http",
    id: "op-1",
    sequence: 1,
    provider: "entra",
    resourceType: "User",
    action: "create",
    sourceId: "user-1",
    sourceVersion: 1,
    source: {
      resourceType: "User",
      id: "user-1",
      userName: "ada@example.com",
      displayName: "Ada Lovelace",
      active: true,
      deleted: false,
      version: 1,
    },
    behavior: {},
    attempt: 1,
    request: {
      method: "POST",
      path: "/Users?excludedAttributes=none",
      headers: {
        accept: "application/scim+json",
        "content-type": "application/scim+json",
        ...headers,
      },
      body: { userName: "ada@example.com" },
    },
  });

describe("performProvisioningHttpOperation", () => {
  it("scopes Bearer auth, preserves the fetch query, and redacts an echoed secret", async () => {
    const secret = "synthetic-target-secret";
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://target.example.com/scim/v2/Users?excludedAttributes=none"
      );
      expect(request.headers.get("authorization")).toBe(`Bearer ${secret}`);
      expect([...request.headers.keys()].sort()).toEqual([
        "accept",
        "authorization",
        "content-type",
      ]);
      return Response.json(
        { id: "target-user-1", reflected: secret },
        { headers: { "request-id": secret, "x-target-echo": secret } }
      );
    });

    const result = await performProvisioningHttpOperation({
      target,
      bearerToken: secret,
      operation: operation(),
      fetch: fetchMock,
      now: () => Date.parse("2026-07-22T12:00:00.000Z"),
      randomId: () => "request-log-id",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.log.path).toBe("/scim/v2/Users");
    expect(result.log.requestHeaders.authorization).toBe("[REDACTED]");
    expect(result.log.correlationId).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.response.body).toMatchObject({
      id: "target-user-1",
      reflected: "[REDACTED]",
    });
  });

  it.each(["cookie", "host", "forwarded", "x-forwarded-host"])(
    "rejects caller-controlled %s before fetch",
    async (name) => {
      const fetchMock = vi.fn();
      await expect(
        performProvisioningHttpOperation({
          target,
          bearerToken: "synthetic-target-secret",
          operation: operation({ [name]: "attacker-controlled" }),
          fetch: fetchMock,
        })
      ).rejects.toBeInstanceOf(UnsafeProvisioningHeaderError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["authorization", "proxy-authorization"])(
    "rejects persisted %s credentials at the contract boundary",
    (name) => {
      expect(() => operation({ [name]: "attacker-controlled" })).toThrow(
        "must be injected at execution"
      );
    }
  );

  it("fails closed when credential metadata and secret presence disagree", async () => {
    const fetchMock = vi.fn();
    await expect(
      performProvisioningHttpOperation({
        target,
        operation: operation(),
        fetch: fetchMock,
      })
    ).rejects.toThrow("credential metadata is inconsistent");

    await expect(
      performProvisioningHttpOperation({
        target: { ...target, auth: { kind: "none" } },
        bearerToken: "unexpected-secret",
        operation: operation(),
        fetch: fetchMock,
      })
    ).rejects.toThrow("credential metadata is inconsistent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a target secret embedded in an otherwise allowed header", async () => {
    const secret = "synthetic-target-secret";
    const fetchMock = vi.fn();
    await expect(
      performProvisioningHttpOperation({
        target,
        bearerToken: secret,
        operation: operation({ accept: `application/scim+json; secret=${secret}` }),
        fetch: fetchMock,
      })
    ).rejects.toThrow("header contained its target credential");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps Workflow/DO response bodies below the secure-fetch global maximum", async () => {
    await expect(
      performProvisioningHttpOperation({
        target: { ...target, auth: { kind: "none" } },
        operation: operation(),
        fetch: async () =>
          new Response("x".repeat(MAX_PROVISIONING_HTTP_BODY_BYTES + 1)),
      })
    ).rejects.toMatchObject({ code: "RESPONSE_BODY_TOO_LARGE" });
  });
});
