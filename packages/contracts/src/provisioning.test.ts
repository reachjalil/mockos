import { describe, expect, it } from "vitest";
import {
  MAX_PROVISIONING_TARGET_BASE_URL_LENGTH,
  provisioningHttpOperationSchema,
  provisioningHttpRequestSchema,
  provisioningPlanSchema,
  provisioningRunSchema,
  provisioningSummarySchema,
  provisioningTargetInputSchema,
  provisioningTargetSchema,
  provisioningWorkflowParamsSchema,
  runProvisioningCycleToolInputSchema,
} from "./provisioning";

describe("outbound provisioning contracts", () => {
  it("separates ingress credentials from persisted target metadata", () => {
    expect(
      provisioningTargetInputSchema.parse({
        ref: "local-target",
        baseUrl: "http://127.0.0.1:8788/scim/v2",
        auth: { kind: "bearer", token: "scim_example_secret" },
      })
    ).toMatchObject({
      ref: "local-target",
      auth: { kind: "bearer", token: "scim_example_secret" },
      behavior: {},
    });

    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "bad-target",
        baseUrl: "https://target.example/scim/v2",
        auth: { kind: "bearer", token: "mk_platform_key_is_not_scim" },
      })
    ).toThrow("Platform API keys cannot be used");

    expect(() =>
      provisioningTargetSchema.parse({
        ref: "leaky-target",
        baseUrl: "https://target.example/scim/v2",
        auth: { kind: "bearer", token: "scim_example_secret" },
      })
    ).toThrow();
  });

  it("rejects target URL credentials and fragments before SSRF resolution", () => {
    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "bad-target",
        baseUrl: "https://user:secret@target.example/scim/v2",
      })
    ).toThrow("cannot contain credentials");
    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "bad-target",
        baseUrl: "https://target.example/scim/v2#fragment",
      })
    ).toThrow("cannot contain queries or fragments");
    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "bad-target",
        baseUrl: "https://target.example/scim/v2?access_token=secret",
      })
    ).toThrow("cannot contain queries or fragments");
    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "oversized-target",
        baseUrl: `https://target.example/${"x".repeat(
          MAX_PROVISIONING_TARGET_BASE_URL_LENGTH
        )}`,
      })
    ).toThrow();
  });

  it("normalizes file-backed bearer tokens and rejects unsafe token text", () => {
    expect(
      provisioningTargetInputSchema.parse({
        ref: "target",
        baseUrl: "https://target.example/scim/v2",
        auth: { kind: "bearer", token: "  synthetic-token  " },
      }).auth
    ).toEqual({ kind: "bearer", token: "synthetic-token" });
    expect(() =>
      provisioningTargetInputSchema.parse({
        ref: "target",
        baseUrl: "https://target.example/scim/v2",
        auth: { kind: "bearer", token: "synthetic\ntoken" },
      })
    ).toThrow("cannot contain whitespace or controls");
  });

  it("locks exact workflow parameters and MCP saved/inline target strategies", () => {
    expect(
      provisioningWorkflowParamsSchema.parse({
        envId: "environment_123",
        appId: "app_123",
        runId: "run_123",
        mode: "incremental",
        targetRef: "local-target",
      })
    ).toEqual({
      envId: "environment_123",
      appId: "app_123",
      runId: "run_123",
      mode: "incremental",
      targetRef: "local-target",
    });
    expect(
      runProvisioningCycleToolInputSchema.parse({
        appId: "app_123",
        target: { kind: "saved", targetRef: "local-target" },
      })
    ).toMatchObject({ mode: "incremental", target: { kind: "saved" } });
    expect(
      runProvisioningCycleToolInputSchema.parse({
        appId: "app_123",
        target: {
          kind: "inline",
          target: {
            ref: "ephemeral",
            baseUrl: "https://target.example/scim/v2",
          },
        },
      }).target
    ).toMatchObject({ kind: "inline", save: false });
  });

  it("allows only origin-relative HTTP operation paths", () => {
    const base = {
      type: "http" as const,
      id: "op-1",
      sequence: 1,
      provider: "entra" as const,
      resourceType: "User" as const,
      action: "lookup" as const,
      sourceId: "usr_1",
      sourceVersion: 1,
      behavior: {},
      request: { method: "GET" as const, headers: {} },
    };
    expect(() =>
      provisioningHttpOperationSchema.parse({
        ...base,
        request: { ...base.request, path: "https://attacker.invalid/Users" },
      })
    ).toThrow();
    expect(() =>
      provisioningHttpOperationSchema.parse({
        ...base,
        request: { ...base.request, path: "//attacker.invalid/Users" },
      })
    ).toThrow("origin-relative");
    expect(() =>
      provisioningHttpRequestSchema.parse({
        method: "GET",
        path: "/Users",
        headers: { Authorization: "Bearer do-not-persist" },
      })
    ).toThrow("must be injected at execution");
  });

  it("fails malformed operation identities and plan counts closed", () => {
    const source = {
      resourceType: "User" as const,
      id: "usr_1",
      userName: "ada@example.test",
      displayName: "Ada",
      active: true,
      deleted: false,
      version: 1,
    };
    const operation = {
      type: "http" as const,
      id: "op-1",
      sequence: 1,
      provider: "entra" as const,
      resourceType: "User" as const,
      action: "lookup" as const,
      sourceId: source.id,
      sourceVersion: source.version,
      source,
      behavior: {},
      request: { method: "GET" as const, path: "/Users", headers: {} },
    };
    expect(() =>
      provisioningHttpOperationSchema.parse({
        ...operation,
        action: "update",
        request: { method: "PATCH", path: "/Users/target", headers: {} },
      })
    ).toThrow("require a resolved target ID");
    expect(() =>
      provisioningHttpOperationSchema.parse({
        ...operation,
        sourceId: "usr_other",
      })
    ).toThrow("identity must match");
    expect(() =>
      provisioningHttpOperationSchema.parse({
        ...operation,
        request: { method: "DELETE", path: "/Users", headers: {} },
      })
    ).toThrow("is not valid for a entra lookup operation");
    expect(() =>
      provisioningPlanSchema.parse({
        version: 1,
        provider: "entra",
        mode: "incremental",
        snapshotCursor: "snapshot-1",
        behavior: {},
        operations: [operation],
        counts: { users: 0, groups: 0, total: 0 },
      })
    ).toThrow("counts must match");
  });

  it("validates bounded run summaries", () => {
    expect(
      provisioningSummarySchema.parse({
        runId: "run_123",
        status: "succeeded",
        operations: { total: 2, succeeded: 2, failed: 0, retried: 0 },
        resources: { users: 1, groups: 1 },
        startedAt: "2026-07-22T08:00:00.000Z",
        completedAt: "2026-07-22T08:00:01.000Z",
      }).operations
    ).toEqual({ total: 2, succeeded: 2, failed: 0, retried: 0 });
    expect(() =>
      provisioningSummarySchema.parse({
        runId: "run_123",
        status: "partial",
        operations: { total: 3, succeeded: 2, failed: 0, retried: 0 },
        resources: { users: 1, groups: 1 },
        startedAt: "2026-07-22T08:00:00.000Z",
        completedAt: "2026-07-22T08:00:01.000Z",
      })
    ).toThrow("totals must equal");
    expect(() =>
      provisioningRunSchema.parse({
        id: "run_123",
        envId: "environment_123",
        appId: "app_123",
        provider: "entra",
        mode: "incremental",
        targetRef: "target-app",
        status: "queued",
        createdAt: "2026-07-22T08:00:00.000Z",
        startedAt: "2026-07-22T08:00:01.000Z",
      })
    ).toThrow("queued provisioning run cannot have execution timestamps");
  });
});
