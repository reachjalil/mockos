# Provider parity matrix

Status: M3 source-candidate ledger; the M2 deployment remains the last accepted runtime gate
Last reviewed: 2026-07-22

“Implemented” below means the linked runtime path has automated evidence at its stated
milestone. “M3 source candidate” means contracts, core behavior, adapters, and focused
local tests are present in the working candidate. M3 Worker integration, lifecycle
cascade, all 113 SCIM fixtures, and the full repository `pnpm check` execute green
locally, while hosted CI, deployment smoke, and live-provider comparison remain
pending. Neither term means byte-for-byte parity with a live Entra ID tenant or Okta
organization.

The OIDC fixtures remain source-reviewed expectations rather than live captures. The
new SCIM corpus contains 113 source-reviewed fixtures: 91 RFC, 10 Entra, and 12 Okta.
All 113 are source-implemented and execute green against the local HTTP composition.
That is local protocol evidence, not a deployed or live-provider conformance result.

| Feature | Entra ID | Okta | Evidence / qualification |
| --- | --- | --- | --- |
| OIDC discovery | Implemented for the M1/M2 path-mode slice | Implemented for the M2 `default` custom authorization server | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/oidc.integration.test.ts); Okta [fixture](../../packages/testkit/fixtures/okta/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/okta.integration.test.ts) |
| JWKS and RS256 verification | Implemented for the tested signing key | Implemented for the tested signing key | Signature verification is exercised end to end in the Entra and Okta Worker tests; rotation and multi-key rollover are not claimed |
| Authorization code | Implemented for hosted login | Implemented for hosted login | Both Worker tests cover login, redirect, code redemption, and one-time code use at the core boundary |
| PKCE S256 | Required and implemented | Required and implemented | Positive Worker round trips and core/adapter rejection coverage; plain PKCE is intentionally unsupported |
| ID-token provider claims | Implemented for the tested scope set | Implemented for minimal and profile/email/group scope shapes | [Entra fixtures](../../packages/testkit/fixtures/entra/oidc) and [Okta fixtures](../../packages/testkit/fixtures/okta/oidc) are documented expectations; automated tests cover only linked subsets |
| Access token | Issued by authorization-code redemption | Issued by authorization-code and device-code redemption | Okta access-token introspection and revocation are implemented; this is not general resource-server or UserInfo coverage |
| Refresh tokens | M3 source candidate for HTTP redemption and family rotation | M3 source candidate for HTTP redemption and family rotation; M2 introspection/revocation remains implemented | [Core tests](../../packages/core/src/okta.test.ts) cover hashed storage, rotation, bounded scopes, atomic replacement, concurrent redemption, replay-family revocation, and lifecycle revocation. Entra and Okta adapter tests plus focused Worker round trips cover the refresh grant locally; hosted CI and deployment evidence remain pending |
| Client credentials | Not exposed by the HTTP adapter | Not exposed by the HTTP adapter | Application contracts can record the grant, but that is not runtime support |
| Device authorization | Not exposed by the Entra HTTP adapter | Implemented for M2 | Okta covers authorization, pending/slow-down, activation, denial, expiry, one-time use, and invalid-client boundaries across [core](../../packages/core/src/okta.test.ts), [adapter](../../packages/engine-http/src/okta.test.ts), and [Worker](../../apps/worker/test/okta.integration.test.ts) tests |
| Token introspection | Not exposed | Implemented for access and refresh tokens | Active/inactive responses, client validation, and revoked tokens are covered; no claim is made for every Okta parameter combination |
| Token revocation | Not exposed | Implemented for access and refresh tokens | Unknown tokens are handled idempotently; client authentication remains required |
| UserInfo | Advertised URL only; route not implemented | Advertised URL only; route not implemented | Do not configure a client that requires UserInfo for this milestone |
| Provider error catalog | Partial Entra OAuth shapes | Partial Okta OAuth shapes; Okta API errors are an M3 source candidate | The Okta directory adapter renders bounded API errors and request ids, and focused Worker integration covers the mounted directory routes locally; hosted CI and deployment evidence remain pending |
| Deterministic scenarios | Implemented for M2 routes; M3 directory injection points are source candidates | Implemented for M2 routes; M3 directory injection points are source candidates | Exact and catch-all injection points support bounded delay and semantic errors. Focused Worker integrations exercise M3 SCIM, Graph, and Okta API routing; hosted CI and deployment evidence remain pending |
| Request log and assertions | Implemented for M2 inbound Worker protocol traffic; M3 directory paths locally integrated | Implemented for M2 inbound Worker protocol traffic; M3 directory paths locally integrated | The environment source captures routed protocol requests generically, and focused Worker integrations cover SCIM/Graph/Okta-API request paths. No deployed M3 evidence is claimed |
| SCIM inbound | M3 source candidate locally integrated | M3 source candidate locally integrated | The [SCIM behavior ledger](../identity/scim.md), [HTTP adapter](../../packages/engine-http/src/scim.ts), core filter/PATCH tests, [Worker integration](../../apps/worker/test/scim.integration.test.ts), and 113 [fixtures](../../packages/testkit/fixtures) cover the advertised discovery, User, and Group route surface. All 113 fixtures and the full repository gate execute green locally; hosted CI, deployed smoke, and live-provider comparison remain pending |
| Microsoft Graph directory reads | M3 source candidate | Not applicable | The [Graph adapter](../../packages/engine-http/src/graph.ts) and [focused tests](../../packages/engine-http/src/graph.test.ts) cover User/Group reads, membership reads, bounded selection/filtering, and cursor pages. No Graph writes or broad Microsoft Graph compatibility is claimed |
| Okta Users/Groups API | Not applicable | M3 source candidate | The [Okta directory adapter](../../packages/engine-http/src/okta-api.ts) and [focused tests](../../packages/engine-http/src/okta-api.test.ts) cover bounded Users, Groups, membership, pagination, and lifecycle routes. Classic `/api/v1/authn` is not implemented |
| Directory lifecycle and cascade | M3 source candidate for activate/disable/reactivate/delete | M3 source candidate for activate/reactivate, suspend/unsuspend, deprovision/delete | [Lifecycle policy](../../packages/core/src/directory/lifecycle.ts), [core tests](../../packages/core/src/directory-lifecycle.test.ts), and the [Worker cascade integration](../../apps/worker/test/lifecycle-cascade.integration.test.ts) cover provider-specific transitions, ETag/version no-ops, transactional token revocation, and deletion membership/version cascades locally. Hosted CI and deployment qualification remain pending |
| Group overage | Not implemented | Not implemented | Later conformance scope |
| Outbound provisioning dialect | Not implemented | Not implemented | M5 scope. The M3 inbound dialect handling does not constitute an outbound planner or delivery runtime |
| SAML | Intentionally deferred | Intentionally deferred | v2 scope, not part of v1 |

The [M2 workers.dev smoke record](../evidence/m2-workers-dev-smoke.md) proves that the
deployed mockOS Worker completed its Entra/MCP scenario and request-assertion path. It
does not prove any M3 SCIM, Graph, Okta directory, refresh-rotation, or lifecycle route.
Those routes now have focused local integration evidence and pass the full local M3
gate, but remain source-candidate claims until hosted CI and deployment evidence are
recorded. Live-provider parity remains unverified. The
[known limitations](../known-limitations.md) remain controlling where older deployed
behavior differs from this candidate.
