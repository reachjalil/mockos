# Provider parity matrix

Status: M1 evidence ledger; fixtures remain source-reviewed rather than live-captured  
Last reviewed: 2026-07-22

A fixture link proves that an expectation is recorded. It does **not** prove the runtime
passes that expectation. Generation and the “Complete requires fixture + test” gate are
planned for M6.

| Feature | Entra ID | Okta | Evidence / qualification |
| --- | --- | --- | --- |
| OIDC discovery | Complete for M1 | Not started | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/01-discovery.json) + [Worker integration](../../apps/worker/test/oidc.integration.test.ts) |
| JWKS | Complete for M1 | Not started | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/02-jwks.json) + signature verification in [Worker integration](../../apps/worker/test/oidc.integration.test.ts) |
| Authorization code | Complete for M1 | Not started | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/03-authorize-code.json) + hosted-login [Worker integration](../../apps/worker/test/oidc.integration.test.ts) |
| PKCE S256 | Complete for M1 happy path | Not started | Entra [documented authorize](../../packages/testkit/fixtures/entra/oidc/10-authorize-pkce-s256.json), [mismatch target](../../packages/testkit/fixtures/entra/oidc/13-token-pkce-mismatch.json), [core rejection test](../../packages/core/src/core.test.ts), and [Worker round trip](../../apps/worker/test/oidc.integration.test.ts) |
| Refresh tokens | Partial | Not started | Entra [documented fixture](../../packages/testkit/fixtures/entra/oidc/19-refresh-token.json) |
| Client credentials | Partial | Not started | Entra [documented fixture](../../packages/testkit/fixtures/entra/oidc/21-client-credentials.json) |
| Device flow | Not started | Not started | Entra expectations are documented; engine support is later than the M1 slice |
| UserInfo | Not started | Not started | Entra [documented fixture](../../packages/testkit/fixtures/entra/oidc/28-userinfo.json) |
| Provider error catalog | Partial | Not started | AADSTS source expectations recorded; exact live captures absent |
| SCIM inbound | Not started | Not started | M3 |
| Directory lifecycle | Not started | Not started | M3 |
| Group overage | Not started | Not started | M6 |
| Request-rate scenarios | Not started | Not started | M2 |
| Outbound provisioning dialect | Not started | Not started | M5 |
| SAML | Intentionally different | Intentionally different | Deferred to v2, not part of v1 |
