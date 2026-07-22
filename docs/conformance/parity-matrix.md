# Provider parity matrix

Status: Accepted M3 emulator ledger; hosted CI and both workers.dev targets are green, while live-provider parity remains unverified
Last reviewed: 2026-07-22

“Implemented” below means the linked runtime path has automated evidence at its stated
milestone. “Accepted for M3” means the exact revision passed its local repository gate,
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29886610480), and the
applicable focused [workers.dev smoke](../evidence/m3-workers-dev-smoke.md). It does
not mean that every local fixture ran remotely or that behavior is byte-for-byte
identical to a live Entra ID tenant or Okta organization.

The OIDC fixtures remain source-reviewed expectations rather than live captures. The
new SCIM corpus contains 113 source-reviewed fixtures: 91 RFC, 10 Entra, and 12 Okta.
All 113 are source-implemented and execute green against the HTTP composition locally
and in hosted CI. The deployed M3 smoke samples both provider discovery/PATCH shapes;
it is not a 113-case remote run or a live-provider conformance result.

| Feature | Entra ID | Okta | Evidence / qualification |
| --- | --- | --- | --- |
| OIDC discovery | Implemented for the M1/M2 path-mode slice | Implemented for the M2 `default` custom authorization server | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/oidc.integration.test.ts); Okta [fixture](../../packages/testkit/fixtures/okta/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/okta.integration.test.ts) |
| JWKS and RS256 verification | Implemented for the tested signing key | Implemented for the tested signing key | Signature verification is exercised end to end in the Entra and Okta Worker tests; rotation and multi-key rollover are not claimed |
| Authorization code | Implemented for hosted login | Implemented for hosted login | Both Worker tests cover login, redirect, code redemption, and one-time code use at the core boundary |
| PKCE S256 | Required and implemented | Required and implemented | Positive Worker round trips and core/adapter rejection coverage; plain PKCE is intentionally unsupported |
| ID-token provider claims | Implemented for the tested scope set | Implemented for minimal and profile/email/group scope shapes | [Entra fixtures](../../packages/testkit/fixtures/entra/oidc) and [Okta fixtures](../../packages/testkit/fixtures/okta/oidc) are documented expectations; automated tests cover only linked subsets |
| Access token | Issued by authorization-code redemption | Issued by authorization-code and device-code redemption | Okta access-token introspection and revocation are implemented; this is not general resource-server or UserInfo coverage |
| Refresh tokens | Accepted for M3 HTTP redemption and family rotation; Entra rotation/revocation passed deployed smoke | Accepted for M3 HTTP redemption and family rotation in the local/hosted suite; introspection/revocation remains implemented | [Core tests](../../packages/core/src/okta.test.ts) cover hashed storage, rotation, bounded scopes, atomic replacement, concurrent redemption, replay-family revocation, and lifecycle revocation. Entra and Okta adapter tests plus focused Worker round trips cover the refresh grant; the deployed M3 sample exercises Entra rotation, scope narrowing, signed refreshed identity, and lifecycle revocation, not the Okta refresh path |
| Client credentials | Not exposed by the HTTP adapter | Not exposed by the HTTP adapter | Application contracts can record the grant, but that is not runtime support |
| Device authorization | Not exposed by the Entra HTTP adapter | Implemented for M2 | Okta covers authorization, pending/slow-down, activation, denial, expiry, one-time use, and invalid-client boundaries across [core](../../packages/core/src/okta.test.ts), [adapter](../../packages/engine-http/src/okta.test.ts), and [Worker](../../apps/worker/test/okta.integration.test.ts) tests |
| Token introspection | Not exposed | Implemented for access and refresh tokens | Active/inactive responses, client validation, and revoked tokens are covered; no claim is made for every Okta parameter combination |
| Token revocation | Not exposed | Implemented for access and refresh tokens | Unknown tokens are handled idempotently; client authentication remains required |
| UserInfo | Advertised URL only; route not implemented | Advertised URL only; route not implemented | Do not configure a client that requires UserInfo for this milestone |
| Provider error catalog | Partial Entra OAuth shapes; deployed samples include AADSTS50076 and AADSTS50057 | Partial Okta OAuth shapes; accepted M3 directory errors include deployed `E0000047` | The adapters render bounded provider-shaped errors and request identifiers. Local/hosted suites cover the broader linked subset; deployed evidence is limited to the named Entra and Okta examples, and corpus-wide live-provider comparison remains open |
| Deterministic scenarios | Accepted for the bounded M3 injection scope | Accepted for the bounded M3 injection scope | Exact and catch-all injection points support bounded delay and semantic errors. Focused Worker integrations exercise SCIM, Graph, and Okta API routing; the deployed M3 smoke exercised one-shot `oauth.token` and `okta.api` failures |
| Request log and assertions | Accepted for M3 inbound Worker protocol traffic | Accepted for M3 inbound Worker protocol traffic | The environment source captures routed protocol requests generically, and focused Worker integrations cover SCIM/Graph/Okta-API request paths. The deployed smoke synchronously queried and asserted the Entra injected-error and lifecycle-revocation requests; it did not remotely sample every directory log path |
| SCIM inbound | Accepted for the bounded M3 scope | Accepted for the bounded M3 scope | The [SCIM behavior ledger](../identity/scim.md), [HTTP adapter](../../packages/engine-http/src/scim.ts), core filter/PATCH tests, [Worker integration](../../apps/worker/test/scim.integration.test.ts), and 113 [fixtures](../../packages/testkit/fixtures) cover the advertised discovery, User, and Group route surface. All fixtures execute green locally and in hosted CI; deployed discovery and provider-shaped Group PATCH passed for Entra and Okta. Live-provider comparison remains open |
| Microsoft Graph directory reads | Accepted for the bounded M3 read scope | Not applicable | The [Graph adapter](../../packages/engine-http/src/graph.ts) and [focused tests](../../packages/engine-http/src/graph.test.ts) cover User/Group reads, membership reads, bounded selection/filtering, and cursor pages. The deployed smoke sampled a projected User read. No Graph writes or broad Microsoft Graph compatibility is claimed |
| Okta Users/Groups API | Not applicable | Accepted for the bounded M3 scope | The [Okta directory adapter](../../packages/engine-http/src/okta-api.ts) and [focused tests](../../packages/engine-http/src/okta-api.test.ts) cover bounded Users, Groups, membership, pagination, and lifecycle routes. The deployed smoke sampled an active User read and rate-limit shape; Classic `/api/v1/authn` and broad provider parity are not claimed |
| Directory lifecycle and cascade | Accepted for M3 activate/disable/reactivate/delete | Accepted for M3 activate/reactivate, suspend/unsuspend, deprovision/delete | [Lifecycle policy](../../packages/core/src/directory/lifecycle.ts), [core tests](../../packages/core/src/directory-lifecycle.test.ts), and the [Worker cascade integration](../../apps/worker/test/lifecycle-cascade.integration.test.ts) cover provider-specific transitions, ETag/version no-ops, transactional token revocation, and deletion membership/version cascades. The deployed M3 smoke sampled Entra disable, version advance, access/refresh revocation, and rejected refresh; Okta transitions remain local/hosted evidence |
| Group overage | Not implemented | Not implemented | Later conformance scope |
| Outbound provisioning dialect | Not implemented | Not implemented | M5 scope. The M3 inbound dialect handling does not constitute an outbound planner or delivery runtime |
| SAML | Intentionally deferred | Intentionally deferred | v2 scope, not part of v1 |

The [M3 workers.dev smoke record](../evidence/m3-workers-dev-smoke.md) ties exact
revision `8645f405d5e3b922c30d51339b8b27f9fe30d93e` to green hosted CI, final staging and
production version IDs, the expanded acceptance sequence, reverse cleanup, and empty
catalogs. It accepts the exercised emulator surface but does not turn source-reviewed
fixtures into provider captures, prove every fixture through the deployed Worker, or
compare results with a real tenant. The [known limitations](../known-limitations.md)
remain controlling.
