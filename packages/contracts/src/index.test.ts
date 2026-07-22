import { describe, expect, it } from "vitest";
import {
  assertionSpecSchema,
  assertRequestsToolInputSchema,
  brokenTokenVariantSchema,
  configureEnvironmentToolInputSchema,
  environmentConfigSchema,
  getRequestLogToolInputSchema,
  identitySeedSchema,
  lifecycleResultSchema,
  mockosMcpToolNames,
  problemSchema,
  providerIdSchema,
  SCIM_BEFORE_COMMIT_INJECTION_POINT,
  SCIM_CORE_USER_SCHEMA,
  SCIM_PATCH_PARSE_INJECTION_POINT,
  scenarioSpecSchema,
  scimUserInputSchema,
  scimWeakEtag,
  seedIdentitiesToolInputSchema,
  setScenarioToolInputSchema,
} from "./index";

describe("wire contracts", () => {
  it("accepts the two locked provider identifiers", () => {
    expect(providerIdSchema.options).toEqual(["entra", "okta"]);
  });

  it("applies safe seed defaults", () => {
    const seed = identitySeedSchema.parse({
      users: [{ userName: "ada@example.com", displayName: "Ada Lovelace" }],
    });
    expect(seed.users[0]).toMatchObject({
      active: true,
      mfaState: "none",
      password: "Passw0rd!",
      passwordState: "valid",
    });
    expect(seed.groups).toEqual([]);
  });

  it("rejects persisted issuer URLs in environment configuration", () => {
    expect(() =>
      environmentConfigSchema.parse({
        id: "environment_123",
        name: "test",
        provider: "entra",
        seed: "fixed",
        tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
        createdAt: "2026-07-22T00:00:00.000Z",
        issuer: "https://example.invalid/tenant/v2.0",
      })
    ).toThrow();
  });

  it("validates RFC 7807 problem documents", () => {
    expect(
      problemSchema.parse({
        type: "https://mockos.live/problems/not-found",
        title: "Not found",
        status: 404,
        requestId: "req_123",
      }).status
    ).toBe(404);
  });

  it("keeps MCP defaults deterministic", () => {
    expect(
      seedIdentitiesToolInputSchema.parse({
        users: [{ userName: "ada@example.com", displayName: "Ada Lovelace" }],
      })
    ).toMatchObject({
      users: [
        {
          active: true,
          mfaState: "none",
          password: "Passw0rd!",
          passwordState: "valid",
        },
      ],
      groups: [],
    });
    expect(getRequestLogToolInputSchema.parse({}).limit).toBe(100);
    expect(assertRequestsToolInputSchema.parse({}).count).toEqual({ atLeast: 1 });
  });

  it("rejects ambiguous or empty assertion count contracts", () => {
    expect(() => assertionSpecSchema.parse({ count: {} })).toThrow(
      "must contain atLeast, atMost, or exactly"
    );
    expect(() =>
      assertionSpecSchema.parse({ count: { atLeast: 2, atMost: 1 } })
    ).toThrow("atLeast cannot be greater than atMost");
    expect(() =>
      assertionSpecSchema.parse({ count: { exactly: 1, atLeast: 1 } })
    ).toThrow("exactly cannot be combined");
    expect(() =>
      assertionSpecSchema.parse({ sequence: [{ path: "/one" }, {}] })
    ).toThrow("must contain at least one matcher");
  });

  it("requires a mutable setting when configuring an environment", () => {
    expect(() => configureEnvironmentToolInputSchema.parse({})).toThrow(
      "At least one environment setting is required."
    );
    expect(() =>
      configureEnvironmentToolInputSchema.parse({ provider: "okta" })
    ).toThrow();
  });

  it("caps injected latency at thirty seconds", () => {
    expect(() =>
      scenarioSpecSchema.parse({
        id: "too-slow",
        injectionPoint: "*",
        action: { type: "delay", milliseconds: 30_001 },
      })
    ).toThrow();
    expect(() =>
      setScenarioToolInputSchema.parse({
        environmentId: "environment_123",
        id: "misrouted-tool-action",
        injectionPoint: "scim.request",
        action: { type: "scim_patch_tolerance", malformedCase: "missing_schemas" },
      })
    ).toThrow(/locked to scim\.patch_parse/);
  });

  it("locks typed SCIM edge actions to reserved internal injection points", () => {
    expect(
      scenarioSpecSchema.parse({
        id: "conflict-once",
        injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
        action: { type: "scim_conflict" },
        remaining: 1,
      })
    ).toMatchObject({
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_conflict" },
    });
    expect(
      scenarioSpecSchema.parse({
        id: "tolerate-singleton",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: {
          type: "scim_patch_tolerance",
          malformedCase: "singleton_operations",
        },
      })
    ).toMatchObject({
      action: { malformedCase: "singleton_operations" },
    });

    expect(() =>
      scenarioSpecSchema.parse({
        id: "public-conflict",
        injectionPoint: "scim.request",
        action: { type: "scim_conflict" },
      })
    ).toThrow(/locked to scim\.before_commit/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "catch-all-race",
        injectionPoint: "*",
        action: { type: "scim_soft_delete_race" },
      })
    ).toThrow(/locked to scim\.before_commit/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "generic-internal",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: { type: "delay", milliseconds: 1 },
      })
    ).toThrow(/accepts only its typed SCIM action/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "broad-tolerance",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: {
          type: "scim_patch_tolerance",
          malformedCase: "any_invalid_patch",
        },
      })
    ).toThrow();
  });

  it("locks the broken-token variants and management tool names", () => {
    expect(brokenTokenVariantSchema.options).toEqual([
      "expired",
      "wrong_audience",
      "not_yet_valid",
      "bad_signature",
      "wrong_issuer",
    ]);
    expect(mockosMcpToolNames).toEqual([
      "create_environment",
      "list_environments",
      "delete_environment",
      "configure_environment",
      "seed_identities",
      "create_application",
      "mint_token",
      "run_provisioning_cycle",
      "set_scenario",
      "clear_scenario",
      "get_request_log",
      "assert_requests",
      "simulate_lifecycle",
      "get_wellknown_urls",
      "set_current_environment",
    ]);
  });

  it("locks M3 SCIM and lifecycle wire shapes", () => {
    expect(scimWeakEtag(7)).toBe('W/"7"');
    expect(
      scimUserInputSchema.parse({
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "ada@example.test",
        active: true,
      })
    ).toMatchObject({ userName: "ada@example.test", active: true });
    expect(
      lifecycleResultSchema.parse({
        userId: "usr_12345678",
        provider: "okta",
        action: "suspend",
        previousState: "active",
        currentState: "suspended",
        changed: true,
        version: 2,
        etag: 'W/"2"',
        revoked: { accessTokens: 1, refreshTokens: 1 },
      })
    ).toMatchObject({ currentState: "suspended", version: 2 });
  });
});
