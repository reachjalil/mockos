import { describe, expect, it, vi } from "vitest";
import {
  OutboundTargetPolicyError,
  parseOutboundBlockedHostnames,
  secureOutboundFetch,
  validateOutboundTarget,
} from "./secure-fetch";

describe("outbound target policy", () => {
  it.each([
    "https://localhost/scim/v2",
    "https://target.internal/scim/v2",
    "https://target.home.arpa/scim/v2",
    "https://target.test/scim/v2",
    "https://target/scim/v2",
    "https://127.1/scim/v2",
    "https://2130706433/scim/v2",
    "https://10.1.2.3/scim/v2",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/scim/v2",
    "https://[fc00::1]/scim/v2",
    "https://[2001:db8::1]/scim/v2",
  ])("blocks non-public target %s", (target) => {
    expect(() => validateOutboundTarget(target)).toThrow(OutboundTargetPolicyError);
  });

  it("requires HTTPS even when a private literal is supplied", () => {
    expect(() => validateOutboundTarget("http://example.com/scim/v2")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_PROTOCOL" })
    );
    expect(() =>
      validateOutboundTarget("http://127.0.0.1/scim/v2", {
        allowInsecureTargets: true,
      })
    ).toThrow(expect.objectContaining({ code: "NON_PUBLIC_IP" }));
  });

  it("allows self-host HTTP only through the explicit policy switch", () => {
    expect(
      validateOutboundTarget("http://target.example.com/scim/v2", {
        allowInsecureTargets: true,
      }).href
    ).toBe("http://target.example.com/scim/v2");
  });

  it("blocks control hosts and their subdomains", () => {
    expect(() =>
      validateOutboundTarget("https://api.mockos.live/scim/v2", {
        blockedHostnames: ["mockos.live"],
      })
    ).toThrow(expect.objectContaining({ code: "BLOCKED_HOSTNAME" }));
  });

  it("normalizes and deduplicates the blocked-host deployment binding", () => {
    expect(
      parseOutboundBlockedHostnames(" MockOS.Live.,id.mockos.live,mockos.live ")
    ).toEqual(["mockos.live", "id.mockos.live"]);
  });

  it.each([
    "mockos.live,,id.mockos.live",
    "https://mockos.live",
    "mockos.live:443",
    "*.mockos.live",
    "mockos.live/path",
    "mockos_live",
  ])("rejects invalid blocked-host configuration %s", (value) => {
    expect(() => parseOutboundBlockedHostnames(value)).toThrow(
      expect.objectContaining({ code: "INVALID_BLOCKED_HOSTNAME" })
    );
  });

  it("rejects URL userinfo without reflecting it in the error", () => {
    let thrown: unknown;
    try {
      validateOutboundTarget("https://sensitive:secret@target.example.com/scim/v2");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "USERINFO_NOT_ALLOWED" });
    expect(String(thrown)).not.toContain("sensitive");
    expect(String(thrown)).not.toContain("secret");
  });
});

describe("secure outbound fetch", () => {
  it("revalidates the URL and forces manual redirects with a timeout signal", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.redirect).toBe("manual");
      expect(request.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true });
    });
    const response = await secureOutboundFetch(
      "https://target.example.com/scim/v2/Users",
      { method: "POST", body: JSON.stringify({ userName: "ada@example.com" }) },
      { fetch: fetchMock }
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects every redirect response without following it", async () => {
    await expect(
      secureOutboundFetch(
        "https://target.example.com/scim/v2/Users",
        {},
        {
          fetch: async () =>
            new Response(null, {
              status: 307,
              headers: { location: "https://redirect.example.com/private" },
            }),
        }
      )
    ).rejects.toMatchObject({ code: "REDIRECT_NOT_ALLOWED" });
  });

  it("rejects oversized request bodies before network I/O", async () => {
    const fetchMock = vi.fn();
    await expect(
      secureOutboundFetch(
        "https://target.example.com/scim/v2/Users",
        { method: "POST", body: "12345" },
        { maxBodyBytes: 4, fetch: fetchMock }
      )
    ).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed responses", async () => {
    const fetchMock = vi.fn(async () => new Response("12345"));
    await expect(
      secureOutboundFetch(
        "https://target.example.com/scim/v2/Users",
        {},
        {
          maxBodyBytes: 4,
          fetch: fetchMock,
        }
      )
    ).rejects.toMatchObject({ code: "RESPONSE_BODY_TOO_LARGE" });
  });

  it("rejects an announced oversized response before consuming it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("ok", {
          headers: { "content-length": "999" },
        })
    );
    await expect(
      secureOutboundFetch(
        "https://target.example.com/scim/v2/Users",
        {},
        {
          maxBodyBytes: 4,
          fetch: fetchMock,
        }
      )
    ).rejects.toMatchObject({ code: "RESPONSE_BODY_TOO_LARGE" });
  });
});
