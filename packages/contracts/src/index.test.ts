import { describe, expect, it } from "vitest";
import {
  environmentConfigSchema,
  identitySeedSchema,
  problemSchema,
  providerIdSchema,
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
        type: "https://mockos.dev/problems/not-found",
        title: "Not found",
        status: 404,
        requestId: "req_123",
      }).status
    ).toBe(404);
  });
});
