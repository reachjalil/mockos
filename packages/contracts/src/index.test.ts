import { describe, expect, it } from "vitest";
import {
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
  scenarioSpecSchema,
  SCIM_CORE_USER_SCHEMA,
  scimUserInputSchema,
  scimWeakEtag,
  seedIdentitiesToolInputSchema,
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
      users: [{ active: true, mfaState: "none", password: "Passw0rd!" }],
      groups: [],
    });
    expect(getRequestLogToolInputSchema.parse({}).limit).toBe(100);
    expect(assertRequestsToolInputSchema.parse({}).count).toEqual({ atLeast: 1 });
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
