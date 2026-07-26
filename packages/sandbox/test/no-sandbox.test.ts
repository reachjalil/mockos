import { describe, expect, it } from "vitest";
import { NoSandbox, SandboxUnavailableError, type SandboxScript } from "../src/index";

const script: SandboxScript = {
  id: "script_test",
  version: 1,
  sha256: "a".repeat(64),
  source: "throw new Error('must never execute')",
};

describe("NoSandbox", () => {
  it("reports no security capabilities and rejects validation", async () => {
    const sandbox = new NoSandbox();
    expect(sandbox.capabilities()).toEqual({
      provider: "none",
      available: false,
      evaluatesJavaScript: false,
      enforcesCpuLimit: false,
      enforcesSubrequestLimit: false,
      blocksOutboundNetwork: false,
    });
    await expect(sandbox.validate(script)).resolves.toMatchObject({
      ok: false,
      code: "SANDBOX_UNAVAILABLE",
    });
  });

  it("fails before evaluating source or reading invocation input", async () => {
    const sandbox = new NoSandbox();
    const input = new Proxy(
      {},
      {
        get() {
          throw new Error("NoSandbox inspected invocation input.");
        },
      }
    );
    await expect(
      sandbox.invoke({
        script,
        input,
        seed: "sandbox-test",
        now: "2026-07-23T12:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});
