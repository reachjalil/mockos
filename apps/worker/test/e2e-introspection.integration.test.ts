import { describe, expect, it } from "vitest";
import { type CloudflareEnv, createWorkerApp } from "../src/app";

const url =
  "https://mockos.test/__mockos/e2e/environments/env_test01/provisioning-runs/run_test01";
const executionContext = {} as ExecutionContext;

const bindings = (enabled: boolean): CloudflareEnv =>
  ({
    API_KEY: "introspection-test-key",
    E2E_OWNER_NONCE: "owned-e2e-process",
    ...(enabled
      ? { E2E_INTROSPECTION_ENABLED: "true" }
      : { E2E_INTROSPECTION_ENABLED: "false" }),
  }) as CloudflareEnv;

describe("local E2E introspection seam", () => {
  it("exposes process ownership only when the local seam is enabled", async () => {
    const enabled = await createWorkerApp().fetch(
      new Request("https://mockos.test/health"),
      bindings(true),
      executionContext
    );
    expect(await enabled.json()).toMatchObject({
      service: "mockos",
      e2eOwnerNonce: "owned-e2e-process",
    });

    const disabled = await createWorkerApp().fetch(
      new Request("https://mockos.test/health"),
      bindings(false),
      executionContext
    );
    expect(await disabled.text()).not.toContain("owned-e2e-process");
  });

  it("is indistinguishable from a missing route when explicitly disabled", async () => {
    const response = await createWorkerApp().fetch(
      new Request(url, {
        headers: { authorization: "Bearer introspection-test-key" },
      }),
      bindings(false),
      executionContext
    );
    expect(response.status).toBe(404);
  });

  it("requires control authentication before touching a Durable Object", async () => {
    const response = await createWorkerApp().fetch(
      new Request(url),
      bindings(true),
      executionContext
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
