# Provider parity matrix

Status: M2 implementation ledger; provider fixtures remain source-reviewed, not live-captured
Last reviewed: 2026-07-22

“Implemented” below means the linked mockOS runtime path has automated coverage. It
does **not** mean byte-for-byte parity with a live Entra ID tenant or Okta organization.
The fixture corpora are source-reviewed expectations marked `documented`; they are not
live-provider captures and are not an engine-wide conformance result.

| Feature | Entra ID | Okta | Evidence / qualification |
| --- | --- | --- | --- |
| OIDC discovery | Implemented for the M1/M2 path-mode slice | Implemented for the M2 `default` custom authorization server | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/oidc.integration.test.ts); Okta [fixture](../../packages/testkit/fixtures/okta/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/okta.integration.test.ts) |
| JWKS and RS256 verification | Implemented for the tested signing key | Implemented for the tested signing key | Signature verification is exercised end to end in the Entra and Okta Worker tests; rotation and multi-key rollover are not claimed |
| Authorization code | Implemented for hosted login | Implemented for hosted login | Both Worker tests cover login, redirect, code redemption, and one-time code use at the core boundary |
| PKCE S256 | Required and implemented | Required and implemented | Positive Worker round trips and core/adapter rejection coverage; plain PKCE is intentionally unsupported |
| ID-token provider claims | Implemented for the tested scope set | Implemented for minimal and profile/email/group scope shapes | [Entra fixtures](../../packages/testkit/fixtures/entra/oidc) and [Okta fixtures](../../packages/testkit/fixtures/okta/oidc) are documented expectations; automated tests cover only linked subsets |
| Access token | Issued by authorization-code redemption | Issued by authorization-code and device-code redemption | Okta access-token introspection and revocation are implemented; this is not general resource-server or UserInfo coverage |
| Refresh tokens | Issued on the tested authorization-code path when `offline_access` is requested and the application permits the `refresh_token` grant | Issued when the tested flows request `offline_access` and the application permits the `refresh_token` grant | Refresh-token grant redemption is not exposed by either HTTP adapter; Okta introspection and revocation accept stored refresh tokens |
| Client credentials | Not exposed by the HTTP adapter | Not exposed by the HTTP adapter | Application contracts can record the grant, but that is not runtime support |
| Device authorization | Not exposed by the Entra HTTP adapter | Implemented for M2 | Okta covers authorization, pending/slow-down, activation, denial, expiry, one-time use, and invalid-client boundaries across [core](../../packages/core/src/okta.test.ts), [adapter](../../packages/engine-http/src/okta.test.ts), and [Worker](../../apps/worker/test/okta.integration.test.ts) tests |
| Token introspection | Not exposed | Implemented for access and refresh tokens | Active/inactive responses, client validation, and revoked tokens are covered; no claim is made for every Okta parameter combination |
| Token revocation | Not exposed | Implemented for access and refresh tokens | Unknown tokens are handled idempotently; client authentication remains required |
| UserInfo | Advertised URL only; route not implemented | Advertised URL only; route not implemented | Do not configure a client that requires UserInfo for this milestone |
| Provider error catalog | Partial Entra OAuth shapes | Partial Okta OAuth and API error shapes | The implemented Okta HTTP routes use OAuth-shaped errors. An API rate-limit fixture and core renderer exist, but `/api/v1/*` is not mounted |
| Deterministic scenarios | Implemented for routed identity requests | Implemented for routed identity requests | Exact and catch-all injection points support bounded delay, semantic error, and restricted JSON mutation actions |
| Request log and assertions | Implemented for inbound Worker protocol traffic | Implemented for inbound Worker protocol traffic | Newest-first pagination and exact request assertions are covered locally and in the deployed smoke |
| SCIM inbound | Not implemented | Not implemented | M3 scope; a returned SCIM base URL is reserved metadata, not an available endpoint |
| Directory lifecycle / Classic Authn | Not implemented | Not implemented | No `/api/v1/users`, `/api/v1/groups`, or `/api/v1/authn` runtime is claimed |
| Group overage | Not implemented | Not implemented | Later conformance scope |
| Outbound provisioning dialect | Not implemented | Not implemented | Later milestone scope |
| SAML | Intentionally deferred | Intentionally deferred | v2 scope, not part of v1 |

The [M2 workers.dev smoke record](../evidence/m2-workers-dev-smoke.md) proves that the
deployed mockOS Worker completed its own Entra/MCP scenario and request-assertion path.
It is deployment evidence, not live-provider parity evidence. The Okta runtime boundary
is qualified by the linked local Worker integration suite and the 22 documented Okta
fixtures.
