import { describe, expect, it } from "vitest";
import { provisioningRunIdForRequest } from "./provisioning-idempotency";

describe("provisioning run idempotency", () => {
  it("derives one opaque run id for an exact Environment/key retry", async () => {
    const first = await provisioningRunIdForRequest(
      "env_12345678",
      "checkout-sync-2026-07-27"
    );
    const retry = await provisioningRunIdForRequest(
      "env_12345678",
      "checkout-sync-2026-07-27"
    );
    const otherEnvironment = await provisioningRunIdForRequest(
      "env_87654321",
      "checkout-sync-2026-07-27"
    );

    expect(first).toBe(retry);
    expect(first).toMatch(/^run_[a-f0-9]{64}$/);
    expect(first).not.toContain("checkout");
    expect(otherEnvironment).not.toBe(first);
  });

  it("keeps an omitted key as a fresh non-idempotent request", async () => {
    const first = await provisioningRunIdForRequest("env_12345678", undefined);
    const second = await provisioningRunIdForRequest("env_12345678", undefined);

    expect(first).toMatch(/^run_[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });
});
