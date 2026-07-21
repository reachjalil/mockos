import { describe, expect, it } from "vitest";
import { renderEntraLoginPage } from "./login";

const request = {
  clientId: "client-id",
  redirectUri: "https://app.example/callback",
  responseType: "code",
  scope: "openid profile email",
  state: "state",
  nonce: "nonce",
  codeChallenge: "challenge",
  codeChallengeMethod: "S256",
};

describe("mockOS hosted login", () => {
  it("is clearly branded as a synthetic test environment", () => {
    const html = renderEntraLoginPage(request, { action: "/authorize" });

    expect(html).toContain("Sign in · mockOS test environment");
    expect(html).toContain('aria-label="mockOS"');
    expect(html).toContain("Microsoft Entra ID simulation");
    expect(html).toContain("Never enter production credentials");
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain('aria-hidden="true">🥸</span> mockOS');
    expect(html).not.toContain('aria-label="Microsoft"');
    expect(html).not.toContain("mockOS.live");
  });

  it("escapes form values, actions, and rendered errors", () => {
    const html = renderEntraLoginPage(
      {
        ...request,
        state: '"><script data-state="unsafe"></script>',
        loginHint: 'ada@example.test"><script data-user="unsafe"></script>',
      },
      {
        action: '/authorize"><script data-action="unsafe"></script>',
        error: '<script data-error="unsafe">Failed</script>',
      }
    );

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script data-state=&quot;unsafe&quot;&gt;");
    expect(html).toContain("&lt;script data-user=&quot;unsafe&quot;&gt;");
    expect(html).toContain("&lt;script data-action=&quot;unsafe&quot;&gt;");
    expect(html).toContain("&lt;script data-error=&quot;unsafe&quot;&gt;");
  });
});
