---
"@mockos/core": minor
"@mockos/engine-http": minor
"@mockos/testkit": minor
"@mockos/worker-kit": minor
---

Add a bounded Okta Classic factor-verification transaction that atomically
issues a one-use session token and bridges that token into the existing public
authorization-code and PKCE flow. Mount every advertised action, omit
unsupported password-change and unlock links, preserve secret-safe evidence,
and add executable conformance fixtures plus an actual-network Okta Auth JS
qualification path without claiming MFA assurance in the resulting tokens.
