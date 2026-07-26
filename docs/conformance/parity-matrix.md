# Provider parity matrix

Status: Accepted M3/M5 ledger plus sampled M6 deployment; bounded MSAL Node
authorization-code/public-device and Okta Auth JS Classic factor-to-OIDC local X/Q
added; live-provider parity remains unverified
Last reviewed: 2026-07-26

“Implemented” below means the linked runtime path has automated evidence at its stated
milestone. “Accepted for M3” means the exact revision passed its local repository gate,
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29886610480), and the
applicable focused [workers.dev smoke](../evidence/m3-workers-dev-smoke.md). It does
not mean that every local fixture ran remotely or that behavior is byte-for-byte
identical to a live Entra ID tenant or Okta organization.

This ledger uses the eight separate levels defined in the
[documentation index](../README.md): designed (D), implemented (I), source-tested (S),
integration-tested (X), pinned SDK/client-qualified (Q), hosted-smoke (H),
verified-live (V), and production-ready (P). A local actual-network official-client
run can establish X/Q without H; a workers.dev mock smoke can establish H without Q;
neither establishes V or P. No row currently has V or P.

M5 entries refer to exact public revision
`ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`. Its local/full gates, hosted CI, and
source-paired manual controlled-target acceptance are green. They remain separate from
M3 evidence and do not constitute comparison with a live provider.

The bounded M6 runtime is tied separately to exact revision
`a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`, green
[CI run 29966667984](https://github.com/reachjalil/mockos/actions/runs/29966667984),
and the [staging/production exact-version smoke](../evidence/m6-workers-dev-smoke.md).
That smoke sampled all six M6 slices; it did not remotely execute every generated case
or fixture and is not verified-live provider evidence.

The Entra MSAL Node candidate is bound separately to the
[local qualification record](../evidence/entra-msal-node-local-qualification.md).
Pinned `@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 traverse a real
local Wrangler HTTPS socket for one custom-authority confidential authorization-code +
S256 PKCE client and one separate public device client. The combined path covers
forced refresh, lifecycle disable, observable request sequence, structural plus
raw/URI/form redaction, normal cleanup, and a focused ready-Worker `SIGTERM` cleanup
probe. That row is D/I/S/X/Q yes and H/V/P no; it does not inherit M3/M6 deployment
evidence.

The Okta Auth JS qualification is bound separately to the
[local qualification record](../evidence/okta-auth-js-local-qualification.md). Pinned
`@okta/okta-auth-js` 8.0.1 and `@modelcontextprotocol/sdk` 1.29.0 traverse the same
shared owned local Wrangler HTTPS and signal-cleanup boundaries. Auth JS starts Classic
Authn, follows the returned synthetic factor with fixed passcode `000000`, hands the
one-use `sessionToken` into one public-client authorization-code + S256 PKCE flow, then
performs JWKS-backed ID-token verification, refresh rotation, owner-bound public
access-token revocation, lifecycle suspend, exact nine-request observation, redaction,
normal cleanup, and ready-Worker `SIGTERM` cleanup. That row is D/I/S/X/Q yes and H/V/P
no; it does not inherit M3/M6 deployment evidence. The passcode is not RFC 6238/TOTP,
and tokens retain one-factor `acr` and password-only `amr`, so MFA-assurance claims
remain unqualified.

The OIDC fixtures remain source-reviewed expectations rather than live captures.
Thirteen Entra cases are implemented: five device fixtures execute against a
core-backed HTTP composition, with mounted Worker coverage for the non-expiry flow,
and eight M6 fixtures execute against the authenticated local Worker. The other 25
Entra and all 22 Okta OIDC fixtures remain documented targets. The SCIM corpus contains 113
source-reviewed fixtures: 91 RFC, 10 Entra, and 12 Okta.
All 113 are source-implemented and execute green against the HTTP composition locally
and in hosted CI. The deployed M3 smoke samples both provider discovery/PATCH shapes;
it is not a 113-case remote run or a live-provider conformance result.

The [generated M6 executable-evidence matrix](./m6-generated-parity.md) is the
manifest-checked index for the rotation, skew, broken-token, group-overage, SCIM edge,
and Classic Authn source cases. The separate smoke samples those six areas but does not
promote every indexed case to corpus-wide deployed or verified-live acceptance.
The two additive factor-verification fixtures and Classic-factor Auth JS journey are
not historical M6 evidence; their exact local record is independent.

| Feature | Entra ID | Okta | Evidence / qualification |
| --- | --- | --- | --- |
| OIDC discovery | Implemented for the M1/M2 path-mode slice | Implemented for the M2 `default` custom authorization server | Entra [fixture](../../packages/testkit/fixtures/entra/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/oidc.integration.test.ts); Okta [fixture](../../packages/testkit/fixtures/okta/oidc/01-discovery.json) and [Worker test](../../apps/worker/test/okta.integration.test.ts) |
| Pinned official identity client | `@azure/msal-node` 5.4.2 custom-authority confidential-code and public-device flow: D/I/S/X/Q yes; H/V/P no | `@okta/okta-auth-js` 8.0.1 Classic factor → one-use session → public code/PKCE flow: D/I/S/X/Q yes; H/V/P no | Thin provider wrappers configure the shared [actual-network harness](../../scripts/e2e-local-official-client.mjs) and [signal cleanup probe](../../scripts/e2e-local-official-client-cleanup.mjs). Entra uses host-only `knownAuthorities`, `ProtocolMode.OIDC`, code + S256 PKCE with a real callback URI, a separate secret-free public device registration with `redirectUris: []`, one callback/immediate pending poll, credential-gated activation, forced refresh for both accounts, and lifecycle disable/`invalid_grant`; the confidential error also asserts `AADSTS50057`. Okta uses `signInWithCredentials`, follows the exact returned factor with synthetic `000000`, gives the one-use `sessionToken` to `getWithRedirect`, then uses `parseFromUrl` plus the exact Node `_getLocation` seam, code + S256 PKCE, JWKS ID-token verification, refresh rotation, functional owner-bound public revocation, and lifecycle suspend/`invalid_grant`. The static passcode is not RFC 6238, and retained `acr`/`amr` do not qualify MFA assurance. MCP discovery/runtime agree on public registration. Both client records use exact request assertions, bounded credential evidence, normal cleanup, and focused ready-Worker `SIGTERM` cleanup. They are not broad SDK, browser, hosted, or live-provider parity. |
| JWKS and RS256 verification | M6 tested slice adds one-key rollover overlap | M6 shares the same key ring; bounded Auth JS 8.0.1 local X/Q verifies an ID token through discovery/JWKS | Schema v5 is unchanged. Core tests cover active plus pre-published successor, legacy-visible metadata-only overlap, private-key scrubbing, the exact 26-hour rotation gate qualified for fixed-lifetime, bounded-skew Worker/MCP issuance, stale-service and sign/rotate races, and verification by `kid`; longer claims from trusted public-core test seams are outside that guarantee. The M6 smoke rotates between authorization and redemption and verifies both stale and fresh JWKS. Separately, Auth JS `parseFromUrl` fetches JWKS and verifies one RS256 ID token over local HTTPS; it does not qualify access-token signature validation, rotation, hosted, or live Okta behavior. |
| Authorization code | Implemented for hosted login; bounded MSAL Node 5.4.2 local X/Q | Implemented for hosted login and validated one-use Classic `sessionToken`; bounded Okta Auth JS 8.0.1 public-client local X/Q | Worker tests cover login, direct session-token redirect, code redemption, and one-time code/session use. Application, redirect, scope, response type, and S256 validation precede session consume; invalid input preserves it, replay and one concurrent loser return `invalid_grant`. MSAL uses `getAuthCodeUrl` and `acquireTokenByCode`; Auth JS uses `getWithRedirect` and `parseFromUrl` through real local HTTPS sockets. Both client records remain H/V/P no. |
| PKCE S256 | Required and implemented; bounded MSAL Node 5.4.2 local X/Q | Required and implemented; bounded Okta Auth JS 8.0.1 local X/Q | Positive Worker round trips and core/adapter rejection coverage; plain PKCE is intentionally unsupported. Each pinned client generates and redeems its own S256 challenge/verifier over actual-network local Wrangler. |
| ID-token provider claims | Implemented for the tested authorization-code and device scope sets | Implemented for minimal and profile/email/group scope shapes; factor handoff retains `amr: [pwd]` and access-token `acr: urn:okta:loa:1fa:any` | The Entra corpus has 25 documented targets and 13 implemented cases. Device core tests require distinct Entra `uti` claims on access and ID tokens; M6 cases cover their named token edges. All Okta OIDC fixtures remain documented expectations. The Auth JS factor journey asserts the unchanged one-factor/password claims so transaction chaining cannot be mistaken for MFA-assurance-token parity. Automated tests cover only linked subsets. |
| Access token | Issued by authorization-code and public device-code redemption | Issued by authorization-code and device-code redemption | Entra device tokens participate in trusted Graph-overage claim construction, public refresh rotation, and lifecycle revocation. Okta access-token introspection and revocation are implemented. This is not general resource-server or UserInfo coverage. |
| Deterministic broken tokens | M6 tested slice for five explicit mutations | Shared minting seam; Okta HTTP-grant equivalence is not claimed | The authenticated Worker/fixture executor and deployed smoke cover `expired`, exact wrong audience, `not_yet_valid`, `bad_signature`, and exact wrong issuer. Each mutation is independently selected and the emitted JWT is inspected; mock minting does not prove that a live provider grant emits the same token |
| Token-claim clock skew | M6 tested slice for bounded claim-only skew | Shared signing seam; no Okta fixture claim | An exact-only `token.before_sign` action shifts temporal claims by an integer within plus/minus 86,400 seconds without moving the environment clock or stored authorization/device/refresh timestamps. The deployed smoke consumes and verifies the plus-300-second signed token exactly once; other bounds and verified-live behavior are not remotely qualified |
| Refresh tokens | Accepted for M3 HTTP redemption/family rotation; deployed raw-protocol sample plus bounded MSAL forced-refresh local X/Q | Accepted for M3 HTTP redemption/family rotation; bounded Auth JS `renewTokens` public-client local X/Q | [Core tests](../../packages/core/src/okta.test.ts) cover hashed storage, rotation, bounded scopes, atomic replacement, concurrent redemption, replay-family revocation, and lifecycle revocation. Entra and Okta adapter tests plus focused Worker round trips cover the refresh grant; the deployed M3 sample exercises raw Entra rotation, narrowing, signed identity, and lifecycle revocation. Separately, pinned MSAL receives `200` then `invalid_grant`/`AADSTS50057` around disable. Pinned Auth JS requires a replacement refresh token, then receives `invalid_grant`/`User account is disabled.` after suspend. Both client results are local only. |
| Client credentials | Not exposed by the HTTP adapter | Not exposed by the HTTP adapter | Application contracts can record the grant, but that is not runtime support |
| Device authorization | Bounded public-client local D/I/S/X/Q; H/V/P no | Implemented for M2 | Entra exposes `POST /<tenant>/oauth2/v2.0/devicecode` and `GET`/`POST /devicelogin`, with 900-second lifetime, five-second interval, no `verification_uri_complete`, credential-gated approve and deny, canonical RFC registration plus MSAL's short wire grant, pending/slow-down/declined/invalid/expired names, atomic one-winner consumption with token persistence, public refresh/lifecycle handling, and strict evidence redaction. [Core](../../packages/core/src/device-authorization.test.ts), [HTTP fixtures](../../packages/engine-http/src/entra-device-fixtures.test.ts), [mounted Worker](../../apps/worker/test/entra-device.integration.test.ts), and pinned MSAL Node 5.4.2 cover the bounded slice. Fixture 27 expiry is deterministic HTTP-only, not mounted; MSAL 5.4.2 does not retry implemented `slow_down`; H/V/P remain open. Okta covers authorization, pending/slow-down, activation, denial, expiry, one-time use, and invalid-client boundaries across [core](../../packages/core/src/okta.test.ts), [adapter](../../packages/engine-http/src/okta.test.ts), and [Worker](../../apps/worker/test/okta.integration.test.ts) tests. |
| Classic authentication and factor handoff | Not applicable | M6 bounded initial states sampled deployed; additive synthetic factor/session bridge local D/I/S/X/Q | Seven executable [fixtures](../../packages/testkit/fixtures/okta/authn), [core tests](../../packages/core/src/authn/okta-authn.test.ts), [adapter tests](../../packages/engine-http/src/okta-authn.test.ts), [Worker integration](../../apps/worker/test/okta.integration.test.ts), and the pinned Auth JS actual-network run cover `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, password-before-state privacy, retrieval/cancellation, factor success/invalid passcode, replay, lifecycle/SCIM-password-change revocation, direct session-token authorization, and concurrency/validation order. The TOTP-shaped factor accepts fixed synthetic `000000`; wrong factor/passcode is `E0000068` without consume, while invalid/replayed state is `E0000011`. Authorization consumes the resulting session once only after client/redirect/scope/response type/S256 validation; replay is `invalid_grant`. Retrieval slides five-minute state expiry; session expiry remains fixed. Same-origin CORS remains restricted. Responses use singular `_embedded.factor`; password-change/unlock links are omitted until mounted. The M6 smoke sampled only the original initial states/retrieval/privacy/CORS/redaction. RFC 6238, password change, recovery, Sessions API/cookies, MFA-assurance claims, H for the bridge, V, and P remain open. |
| Token introspection | Not exposed | Implemented for confidential clients only | Active/inactive access- and refresh-token responses, confidential-client validation, and revoked tokens are covered. Discovery advertises only `client_secret_basic` and `client_secret_post`; public clients are denied. No claim is made for every Okta parameter combination. |
| Token revocation | Not exposed | Implemented for confidential clients; owner-bound public revocation has bounded Auth JS 8.0.1 local X/Q | Unknown or already-revoked tokens are idempotent. Confidential clients use a secret. Public clients identify themselves without a secret and can affect only their own token or refresh family; discovery advertises `none`. A core negative regression preserves another application's active access token and rotated refresh family. In the pinned Auth JS flow, lifecycle revokes exactly one remaining access token after SDK revocation, proving the 200 changed the refreshed token's state. This is not anonymous revocation or broad SDK/live-provider evidence. |
| UserInfo | Not implemented or advertised; Entra fixtures 28 and 29 remain documented-only | Not implemented or advertised | OIDC discovery and `get_wellknown_urls` omit UserInfo until a route exists. This removes a false capability signal; it does not add UserInfo support or promote any evidence level. |
| Provider error catalog | Partial Entra OAuth shapes; deployed samples include AADSTS50076 and AADSTS50057 | Partial Okta OAuth shapes; accepted M3 directory errors include deployed `E0000047` | The adapters render bounded provider-shaped errors and request identifiers. Local/hosted suites cover the broader linked subset; deployed evidence is limited to the named Entra and Okta examples, and corpus-wide live-provider comparison remains open |
| Deterministic scenarios | Accepted for the bounded M3 injection scope | Accepted for the bounded M3 injection scope | Exact and catch-all injection points support bounded delay and semantic errors. Focused Worker integrations exercise SCIM, Graph, and Okta API routing; the deployed M3 smoke exercised one-shot `oauth.token` and `okta.api` failures |
| Request log and assertions | Accepted for M3 inbound and the tested M5 outbound sequence; combined MSAL code/device sequence and redaction source-qualified | Accepted for M3 inbound and the tested M5 outbound sequence; nine-request Classic-factor Auth JS sequence and redaction local X/Q | M5 adds response-body predicates, repeated non-overlapping ordered counts, and bounded/redacted outbound records. The MSAL local actual-network test matches its combined discovery/login/code/device/activation/refresh/lifecycle sequence once, requires token statuses `[200, 200, 200, 200, 400, 400, 400]`, parses exercised fields as `[REDACTED]`, and rejects raw, URI-encoded, or form-encoded password/secret/code/message/verifier/token representations. The Auth JS test matches Authn/factor/discovery/authorize/code/JWKS/refresh/revoke/suspended-refresh once, requires token statuses `[200, 200, 400]`, structurally redacts password/state/passcode/session/code/verifier/token fields, and rejects each exercised raw/URI/form representation. This does not classify arbitrary encodings or unknown fields. Neither client record has hosted or live-provider evidence. |
| SCIM inbound | Accepted for the bounded M3 scope | Accepted for the bounded M3 scope | The [SCIM behavior ledger](../identity/scim.md), [HTTP adapter](../../packages/engine-http/src/scim.ts), core filter/PATCH tests, [Worker integration](../../apps/worker/test/scim.integration.test.ts), and 113 [fixtures](../../packages/testkit/fixtures) cover the advertised discovery, User, and Group route surface. All accepted fixtures execute green locally and in hosted CI; deployed discovery and provider-shaped Group PATCH passed for Entra and Okta. Verified-live comparison remains open |
| Deterministic SCIM edges | M6 tested slice: conflict, race, and missing-schema tolerance | M6 tested slice: conflict, race, and singleton-Operations tolerance | The separate [M6 edge fixtures](../../packages/testkit/fixtures/m6/scim) and [HTTP suite](../../packages/engine-http/src/scim-edge-cases.test.ts) cover an injection-locked `409` without partial mutation, a soft-delete race with only tombstone-side effects, strict rejection before tolerance, and two exact case-specific repairs. The deployed smoke sampled those central paths. A selected tolerance does not repair the other case, combined defects, unknown fields, invalid paths, missing values, or coercions; the full eight-case corpus did not run remotely |
| Microsoft Graph directory reads | Accepted for the bounded M3 read scope | Not applicable | The [Graph adapter](../../packages/engine-http/src/graph.ts) and [focused tests](../../packages/engine-http/src/graph.test.ts) cover User/Group reads, membership reads, bounded selection/filtering, and cursor pages. The deployed smoke sampled a projected User read. No Graph writes or broad Microsoft Graph compatibility is claimed |
| Okta Users/Groups API | Not applicable | Accepted for the bounded M3 scope | The [Okta directory adapter](../../packages/engine-http/src/okta-api.ts) and [focused tests](../../packages/engine-http/src/okta-api.test.ts) cover bounded Users, Groups, membership, pagination, and lifecycle routes. The deployed smoke sampled an active User read and rate-limit shape; the separate bounded Classic Authn slice does not establish broad provider parity. |
| Directory lifecycle and cascade | Accepted for M3 activate/disable/reactivate/delete | Accepted for M3 activate/reactivate, suspend/unsuspend, deprovision/delete; bounded Auth JS suspend local X/Q | [Lifecycle policy](../../packages/core/src/directory/lifecycle.ts), [core tests](../../packages/core/src/directory-lifecycle.test.ts), and the [Worker cascade integration](../../apps/worker/test/lifecycle-cascade.integration.test.ts) cover provider-specific transitions, ETag/version no-ops, transactional token revocation, and deletion membership/version cascades. The deployed M3 smoke sampled Entra disable, version advance, access/refresh revocation, and rejected refresh. Separately, the local Auth JS client observes `invalid_grant` after Okta suspend; no Okta lifecycle H/V/P evidence is added. |
| Group overage | M6 tested slice: inline through 200, claim source at 201 | Not implemented | Focused core, Worker, and fixture-executor tests cover the exact boundary, the 201-ID token probe, the trusted same-environment Graph `getMemberObjects` URL in path and subdomain shapes, and the fallback's 1,000-ID response ceiling backed by a 1,001-ID probe. The deployed smoke exercised path-mode tokens and the exact 201-ID fallback; subdomain routing, the 1,001-ID denial, broad Graph parity, and verified-live comparison remain outside that sample |
| Outbound provisioning dialect | M5 tested slice: deterministic lookup/create/update, filtered email PATCH, group push, deactivate/delete, and explicit 429 follow-ups | M5 source-tested slice: deterministic lookup/create, PUT-heavy updates, optional group push, terminal lifecycle work, and explicit 429 follow-ups | [Planner/interpreter tests](../../packages/core/src/provisioning/provisioning.test.ts) exercise both provider shapes. Workflow, SSRF, target app, tool 15, and CLI pass local/full gates; the controlled hosted acceptance exercised an Entra-shaped four-request flow on both targets. Live-provider and hosted Okta-shaped comparison remain pending |
| SAML | Intentionally deferred | Intentionally deferred | v2 scope, not part of v1 |

The [M3 workers.dev smoke record](../evidence/m3-workers-dev-smoke.md) ties exact
revision `8645f405d5e3b922c30d51339b8b27f9fe30d93e` to green hosted CI, final staging and
production version IDs, the expanded acceptance sequence, reverse cleanup, and empty
catalogs. It accepts the exercised emulator surface but does not turn source-reviewed
fixtures into provider captures, prove every fixture through the deployed Worker, or
compare results with a real tenant. The [known limitations](../known-limitations.md)
remain controlling.

The M5 outbound rows remain outside that accepted M3 paragraph. Their
[local source qualification](../evidence/m5-local-source-qualification.md) and
[exact-pair manual deployment acceptance](../evidence/m5-workers-dev-smoke.md) are
green. The latter did not execute the guarded GitHub promotion workflows or compare
against a live provider.

The M6 rows are bounded by the separate
[sampled deployment record](../evidence/m6-workers-dev-smoke.md). Passing that smoke
does not convert the 21-case generated source index into a remote corpus run or qualify
the guarded Cloudflare-credential deployment path.
