# Implementation status

Status: Accepted M0-M3/M5 and sampled M6 evidence retained; bounded Entra MSAL Node and Okta Auth JS local X/Q passed; M7 management reads remain source-only
Last reviewed: 2026-07-26

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not. The
accepted M3 baseline is exact revision
`8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 has a separate immutable public
runtime revision, hosted CI run, manual Worker rollout, and controlled-target
acceptance record; it does not inherit M3 evidence or qualify the guarded deployment
workflow. M6 has its own exact-source, CI, version, and sampled workers.dev acceptance
record; it does not inherit M3/M5 evidence or qualify the guarded Cloudflare-credential
deployment workflow. The additive M7 application/scenario management-read substrate is
source-complete in the repository revision carrying this document, but has no hosted CI,
deployed-version, or console acceptance evidence yet. The Entra MSAL Node and Okta Auth
JS tranches are separate local actual-network and official-client source candidates;
they do not inherit earlier hosted or deployed evidence.

Evidence levels are intentionally separate. The
[documentation index](./README.md) defines designed (D), implemented (I),
source-tested (S), integration-tested (X), pinned SDK/client-qualified (Q),
hosted-smoke (H), verified-live (V), and production-ready (P). Both official-client
tranches are D/I/S/X/Q yes and H/V/P no. Existing exact-version workers.dev records
may establish H for their raw-protocol samples without establishing Q, V, or P. No
current fixture or milestone is V or P.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI through M3 | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at exact M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e`; see [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480). |
| Contracts v0 | Accepted through the bounded M6 runtime slice; additive public-client source candidate | The accepted contract includes SCIM resources, directory lifecycle state/actions/results, and the M5 [provisioning contract](../packages/contracts/src/provisioning.ts) for safe target metadata, snapshots, watermarks, plans, operations, responses, and `run_provisioning_cycle` as tool 15. M6 adds seeded Authn `passwordState`, request-derived `oktaAuthnEndpoint`, and exact-only token rotation/clock-skew scenario actions. The current source candidate adds explicit `confidential`/`public` registrations: confidential remains the default and returns a creation-only secret, while public rejects any secret and `client_credentials` and returns none. Exact M6 revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` passed source and sampled deployed acceptance; packages remain unpublished, and the additive public-client contract has no H evidence. |
| Synchronous SQL store | Accepted through the tested M5 slice | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. M5 adds append-only provisioning target, staged-run target, run/step, and watermark state, including one active run per app/target; local gates and the controlled-target hosted run passed. |
| Core migrations and directory repositories | Accepted through M5; bounded M6 source suite and deployed sample green | The accepted [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) cover the M3 engine. The M5 [provisioning planner/interpreter](../packages/core/src/provisioning) passed focused/full and controlled-target gates. M6 focused tests cover the bounded [Classic Authn service](../packages/core/src/authn/okta-authn.ts), deterministic broken-token mutations, active/successor key handling, private-key scrubbing, bounded retention, and stale-instance/sign-rotate races. Authn state retrieval uses a sliding five-minute expiry while session capabilities retain their fixed five-minute issuance expiry. Each table is capped at 10,000 retained rows and each User at 32 retained rows per kind; ordered oldest-expiry eviction and a 256-row-per-table issuance GC pass are index-backed without advancing schema v5, preserving rollback compatibility. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises the externally observable slices, not every source-only retention/concurrency/security assertion. |
| Deterministic test seams | Complete through M3; bounded M6 token/key paths accepted | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. The M6 token stream adds exact-only rotation and claim-skew actions with fixed broken-token mutations; the deployed sample exercised rotation, skew, and every mutation. Production signing-key material remains cryptographically generated, and deeper deterministic assertions remain source evidence. |
| Fixture schema, loader, and runner | Complete for M3 SCIM; bounded M6 executors and sampled deployment green | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 38 Entra and 22 Okta source-reviewed OIDC fixtures, 113 SCIM fixtures, and five M6 Okta Authn fixtures. The [M6 Worker executor](../apps/worker/test/token-fixtures.integration.test.ts) supplies authenticated MCP/session, environment, client, subject, and Graph-bearer setup for Entra fixtures 31–38; the [Authn executor](../packages/engine-http/src/okta-authn-fixtures.test.ts) runs all five Authn cases against the core-backed HTTP composition. The M6 smoke sampled all six areas but was not a remote execution of this complete generated case index. The other OIDC fixtures remain documented targets, and no live-provider comparison is claimed. |
| Provider fixture corpora | Mixed evidence | The 38 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) fixtures contain 30 documented targets and eight implemented, locally Worker-executed M6 token/key/overage cases; all 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain documented. The SCIM corpus contains 113 source-implemented cases. Five [Okta Authn fixtures](../packages/testkit/fixtures/okta/authn) are source-reviewed, marked `implemented`, and execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | Accepted M3 slice; bounded M6 token/key/Graph slice sampled in deployment | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover the accepted M3 hosted-login, authorization-code, refresh/lifecycle, Entra-claim, and RS256/JWKS slice; the [M3 deployed smoke](./evidence/m3-workers-dev-smoke.md) exercised those principal paths. M6 source tests add deterministic broken tokens, skew, one-key rollover overlap, and group overage with trusted same-environment Graph fallback capped at 1,000 returned IDs. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises rotation/stale-JWKS verification, plus-300-second skew, all five broken variants, and the exact path-mode 200/201 boundary. The 1,001-ID ceiling, concurrency, private-key scrubbing, and subdomain routing remain source evidence; broader error fidelity and verified-live comparison remain open. |
| Entra MSAL Node client | Bounded local D/I/S/X/Q passed; H/V/P unqualified | Pinned `@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 traverse an actual local Wrangler HTTPS socket. The official MCP client creates and cleans up the environment; MSAL uses the request-derived custom authority with host-only `knownAuthorities` and `ProtocolMode.OIDC`, completes code + S256 PKCE and forced refresh, then receives `invalid_grant`/`AADSTS50057` after lifecycle disable. The exact six-request sequence and absence of password, secret, code, verifier, and token values from durable evidence pass. See the [quickstart](./quickstarts/entra-msal-node.md) and [local record](./evidence/entra-msal-node-local-qualification.md). No remote Worker, hosted Cloud, real Entra tenant, broad MSAL matrix, or production-readiness result is claimed. |
| Okta runtime | Accepted M3 implementation plus bounded M6 Classic Authn deployed sample | Existing [core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover the M3 OAuth/device/directory slice. M6 adds core/HTTP/Worker coverage for `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, state retrieval/cancellation, hash-only capabilities, replay denial, lifecycle and SCIM-password-change revocation, and issuance-race denial. Successful retrieval slides state expiry; session expiry remains fixed. The HTTP shape uses singular `_embedded.factor` (an array), omits `passwordChanged`, permits same-origin CORS only for `POST` with `accept`/`content-type`, emits no credentialed-CORS allowance, and returns `403` cross-origin. Request/response bodies are recursively secret-redacted, malformed bodies are wholly redacted, and sensitive Authn headers are redacted. The [M6 smoke](./evidence/m6-workers-dev-smoke.md) samples initial states, state retrieval, CORS, privacy, and redaction; factor verification, cancellation/replay and revocation details not sampled there, verified-live comparison, and the rest of the Classic machine remain open or source-only as stated. |
| Okta Auth JS public client | Bounded local D/I/S/X/Q passed; H/V/P unqualified | Pinned `@okta/okta-auth-js` 8.0.1 and `@modelcontextprotocol/sdk` 1.29.0 traverse an actual local Wrangler HTTPS socket. MCP discovery and runtime agree on strict conditional public/confidential registration. Auth JS uses `getWithRedirect`, S256 PKCE, `parseFromUrl` with the exact Node `_getLocation` seam, JWKS-backed ID-token verification, refresh rotation, and public access-token revocation. Lifecycle then revokes exactly one remaining access token and produces SDK `invalid_grant` after Okta `suspend`, proving the SDK revocation changed state. The exact eight-request sequence, token statuses `[200, 200, 400]`, raw/URI/form-encoded value absence, named-field structural redaction, normal cleanup, and focused ready-Worker `SIGTERM` cleanup pass. See the [quickstart](./quickstarts/okta-auth-js-node.md) and [local record](./evidence/okta-auth-js-local-qualification.md). A cross-client core regression protects owner-bound revocation; introspection remains confidential. No browser, hosted, real-Okta, broad SDK, or P result is claimed. |
| Scenario injection and request log | Accepted through the tested M5 assertion slice; M6 actions sampled in deployment | Accepted M3 [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic scenarios, filtering, retention, and assertions. M5 response-body predicates, repeated non-overlapping ordered counts, Worker capture/redaction, local process e2e, and both hosted four-request assertions passed. M6 key rotation and clock skew are restricted to exact internal `token.before_sign` evaluation rather than the generic catch-all; both were sampled by the exact-version M6 deployed smoke. |
| M7 application/scenario management reads | Source-complete; hosted CI, rollout, and console acceptance pending | Strict [contracts](../packages/contracts/src/index.ts) cap management pages at 25 records and bind cursors to the application or scenario resource kind. [Core](../packages/core/src/directory/applications.ts) and [scenario](../packages/core/src/scenario/scenario-service.ts) keyset pagination is covered by focused tests, and the [Durable Object integration](../apps/worker/test/management-rpc.integration.test.ts) exercises the additive `listApplications`/`listScenarios` RPCs. Application summaries are constructed field-by-field and exclude both the creation-only plaintext `clientSecret` and the persisted hash. No MCP tool, public HTTP route, CLI command, schema migration, hosted deployment, or private-console result is claimed by this source slice. |
| MCP runtime | Accepted 15-tool M5 runtime for the tested hosted slice; official-client local setup/observation added | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) exercise `run_provisioning_cycle` as tool 15 and inspect the SDK 1.29 `tools/list` schema for `create_application`: defaulted inputs remain optional, an explicit public `if`/`then` forbids a secret and narrows grants, and exact output branches expose a secret only for confidential registrations. Authenticated mounted Worker tests, the built-CLI process e2e, and staging/production hosted starts passed. The two local official-client harnesses use MCP for setup, discovery, observation, lifecycle, and cleanup; this is not a claim that every tool was re-exercised remotely or that npm distribution exists. |
| CLI Stage A | Accepted M5 source command; unpublished | The unpublished `@mockos/cli` 0.1.0 source includes secret-safe `provision run` and capability negotiation for `run_provisioning_cycle`; all 19 CLI tests and the built-CLI process e2e are green. Package publication and a complete deployed CLI command matrix remain open. |
| Cloudflare Worker / Durable Object | Bounded M6 exact-version deployment sample accepted | Exact M6 public revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` passed the full local gate and [CI run 29966667984](https://github.com/reachjalil/mockos/actions/runs/29966667984). Its staging version `9ea22805-e38e-4a1b-807f-f80646cbe298` and production version `0695adab-d162-4f01-a3cf-da9c1640acdc` were manually deployed with the existing Access Keys preserved, confirmed 100% active, and passed source-locked exact-serving-version smoke. See the [M6 deployment record](./evidence/m6-workers-dev-smoke.md). The guarded Cloudflare-credential promotion workflow and verified-live parity remain unqualified. |
| SCIM inbound and lifecycle APIs | Accepted for bounded M3; M6 edges sampled in deployment | Portable contracts, bounded filter/PATCH logic, versioned persistence/service behavior, the `/scim/v2` HTTP/Worker composition, provider dialects, Graph/Okta directory adapters, and lifecycle policy have focused local and hosted coverage. All 113 accepted SCIM fixtures execute green against the HTTP composition; Worker SCIM and lifecycle-cascade suites qualify the mounted runtime. The M6 corpus separately covers an injection-locked `409` conflict with no partial mutation, a soft-delete race with tombstone-only effects, and two exact malformed-PATCH tolerances (`missing_schemas` and `singleton_operations`) that leave strict parsing and all unrelated defects unchanged. Those central paths passed the M6 deployed sample; the full eight-case M6 fixture corpus, all 113 accepted fixtures, and verified-live comparison did not run remotely. |
| Outbound provisioning | Manually accepted for the tested M5 slice | [Contracts](../packages/contracts/src/provisioning.ts), the deterministic [planner/interpreter](../packages/core/src/provisioning), Workflow/HTTP composition in [worker-kit](../packages/worker-kit/src/provisioning-workflow.ts), SSRF controls, isolated target-credential storage, the [target app](../examples/target-app), tool 15, and the CLI command pass the [local source record](./evidence/m5-local-source-qualification.md). The exact source pair then passed staging and production Workflow execution with four matched target requests, terminal success, empty target state after cleanup, and deleted target infrastructure in the [deployment record](./evidence/m5-workers-dev-smoke.md). Live-provider parity and recurring scheduling remain open. |
| Hosted cloud control plane, billing, console | Not in this repository; no public dependency | A separately operated private composition consumed exact public M5 runtime revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` for the recorded manual acceptance. That evidence demonstrates use of the exported public seams, not a private runtime dependency: the Apache-2.0 Worker remains buildable and self-hostable without private code, licensing, billing, or call-home behavior. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | M6 manually rolled out and exact-version smoke accepted; guarded promotion unqualified | Exact public M6 source was manually deployed staging before production and confirmed 100% active. The existing standalone public Access Keys were preserved, and the source-locked GitHub smoke used their pre-existing masked secrets to exercise all six M6 slices plus accepted regressions on both exact serving versions. The separate guarded Cloudflare-credential deployment workflow was not executed or formally qualified. |
| Custom `mockos.live` zone | Blocked on domain purchase | M8 cutover-only dependency. |
| npm publishing | Blocked externally | The `@mockos` names remain the intended scope, but npm authentication is unavailable and the scope is not confirmed as registered. Source-build use remains the supported public path. |

## Milestone acceptance

The code-and-test portions of M0, M1, and M2 pass locally. The
[curl walkthrough](./quickstarts/curl.md) maps to the implemented control and protocol
routes and has an independent [local `wrangler dev` result](./evidence/m1-wrangler-dev-smoke.md).
The [M2 deployed smoke](./evidence/m2-workers-dev-smoke.md) passed create, discovery,
mint, JWKS verification, hosted PKCE, AADSTS50076 injection, request-log query,
assertion, deletion, and empty-catalog checks in staging and production. The exact
candidate also has a [green hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591),
so the M2 prerequisite and F0 merge gate are satisfied.

M3 is accepted at exact revision `8645f405d5e3b922c30d51339b8b27f9fe30d93e`.
Contracts, core, SCIM adapter/service, provider directory, refresh/lifecycle, MCP,
CLI, and Worker tests pass locally and in
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29886610480). The
[expanded deployed smoke](./evidence/m3-workers-dev-smoke.md) passed at staging and
production for that revision, including reverse cleanup and final empty-catalog
checks. This accepts the tested M3 emulator slice; source-reviewed provider fixtures
and the deployed smoke do not constitute comparison with a real Entra tenant or Okta
organization. Live-provider parity, automated deploy-workflow execution, npm
publication, and the listed capability gaps remain open.

M5 is manually accepted for the tested source-paired slice. Exact public runtime
revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed hosted CI, local source
qualification, manual staging-before-production rollout, and controlled-target hosted
Workflow acceptance. The two runs each finished platform/runtime success with four
matched requests; target state was cleared and the disposable target Worker was
deleted. See the [local qualification](./evidence/m5-local-source-qualification.md)
and [deployment record](./evidence/m5-workers-dev-smoke.md).

This acceptance does not qualify the guarded GitHub promotion workflows, an
authenticated M5 flow on the preserved standalone public Worker credentials, npm
publication, recurring scheduling, or live-provider parity.

M6 is accepted for the bounded source and sampled deployed slice at exact public
revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`. It contains all six bounded
slices: five executable Okta Classic Authn fixtures; injection-locked SCIM conflict,
soft-delete-race, and narrow PATCH-tolerance cases; signing-key rotation with JWKS
overlap; bounded token-claim clock skew; five deterministic broken-token variants; and
the exact 200-inline/201-overage boundary with trusted same-environment Graph fallback
and a 1,000-ID response ceiling. The Authn source additionally qualifies sliding state
versus fixed session expiry, caps/ordered eviction/256-row GC, schema-v5-compatible
indexes, lifecycle/password revocation, restricted same-origin non-credentialed CORS,
provider-shaped response omissions, and recursive secret redaction. The full local gate,
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29966667984), manual
staging-before-production rollout, and [exact-version smoke](./evidence/m6-workers-dev-smoke.md)
are green. The smoke sampled every slice plus accepted regressions, but did not execute
every fixture or source-only denial/concurrency/cap assertion remotely. This acceptance
does not qualify the guarded Cloudflare-credential deploy workflow, corpus-wide parity,
or verified-live provider comparison.

## Entra MSAL Node local client qualification

The source candidate carrying this document pins `@azure/msal-node` 5.4.2. Its thin
provider wrapper now configures the same shared official-client actual-network and
signal-cleanup harnesses used by the Okta qualification. An owned local Wrangler
process serves HTTPS. The
parent anchors the captured `localhost` leaf and validates its hostname plus ownership
nonce before the child adds that certificate as a process-local CA through
`NODE_EXTRA_CA_CERTS`, retaining standard Node trust. The child independently requires
an HTTPS `localhost` origin and the same nonce; no alternate-certificate rejection is
qualified. The shared parent rejects inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` and
strips it from child environments. It connects to management through the official MCP
SDK and configures the Entra application entirely through the discovered tool contract.
MSAL uses the returned issuer with
`knownAuthorities: [new URL(authority).host]` and
`system.protocolMode: ProtocolMode.OIDC`.

The client completes authorization code with S256 PKCE, validates account/tenant/token
claims, forces a successful token-endpoint refresh, disables the User through MCP, and
observes a rejected forced refresh with `invalid_grant` and `AADSTS50057`. It matches the exact
discovery/login/code/refresh/disabled-refresh sequence, proves durable credential
redaction, deletes the environment, closes MCP, and removes the temporary CA. The
focused lifecycle Worker test independently protects the persistent redaction
boundary. A separate `SIGTERM` cleanup probe observes parent exit `143`, releases the
provider and inspector ports, removes the detached Wrangler process group, and removes
temporary state. Distinct explicit inspector ports allow the Entra and Okta
qualifications and cleanup probes to pass concurrently.

`pnpm e2e:entra-msal` and `pnpm e2e:entra-msal-cleanup` were rerun successfully under
Node 24.18.0; focused source tests also passed. Exact output is in the
[qualification record](./evidence/entra-msal-node-local-qualification.md). This is
D/I/S/X/Q evidence for the named version and flow only. The signal probe covers a ready
Worker on this local platform, not `SIGKILL`, Windows, or every active-client
interruption point. No hosted-CI result is claimed by this local record, and there is no
H, V, or P evidence.

## Okta Auth JS local client qualification

The current source candidate pins `@okta/okta-auth-js` 8.0.1 and adds explicit public
application registrations. Public clients store and return no secret, reject a
supplied secret and `client_credentials`, and authenticate code/refresh redemption
without one. Okta discovery advertises `none` for token and revocation authentication;
introspection remains confidential. Public revocation requires the owning client ID
and cannot affect another application's token family.

The official MCP client creates, seeds, configures, observes, and deletes the
environment. Auth JS performs `getWithRedirect` plus S256 PKCE, and its `parseFromUrl`
path exchanges the code and verifies the RS256 ID token from discovery/JWKS. The Node
harness supplies the SDK-exposed `_getLocation` seam because the method otherwise
dereferences `window`; this is part of the exact 8.0.1 Node qualification, not a
browser or version-range claim. `renewTokens` rotates the refresh token,
`token.revoke` returns 200 for the refreshed access token through public
client-ID-only Basic compatibility. The following suspension revokes exactly one
remaining access token, proving the SDK call changed state; a later SDK refresh fails
with `invalid_grant` and `User account is disabled.`. A separate core regression proves
an unrelated public client cannot revoke another application's active access token or
rotated refresh family.

The final `pnpm check`, `pnpm e2e:okta-authjs`, and
`pnpm e2e:okta-authjs-cleanup` passed under Node 24.18.0.
The exact eight-request sequence, token statuses `[200, 200, 400]`, functional
revocation postcondition, raw/URI/form-encoded credential and token absence,
named-field structural redaction, environment deletion, process-group exit, released
provider/inspector ports, and temporary-state removal are in the
[qualification record](./evidence/okta-auth-js-local-qualification.md). This is
D/I/S/X/Q for the named version and flow only. No hosted-CI execution, remote Worker,
browser, real Okta organization, verified-live comparison, or P result is claimed.

## M7 management reads

The M7 application/scenario management-read substrate is source-complete but not
deployed. Its strict query contract defaults to and caps pages at 25 records with a
512-character cursor ceiling. Core reads use stable `(created_at, id)` keysets and
resource-kind-bound cursors. `ApplicationSummary` is deliberately distinct from the
creation response: `createApplication` returns a generated plaintext secret once only
for confidential registrations; public registrations return none. Every later list
result excludes both plaintext and stored hashes. The two new
Durable Object RPCs are additive and schema-v5 compatible. The full local `pnpm check`
gate, including the focused contract/core coverage and real Durable Object integration,
is green; hosted CI, exact-version staging/production rollout, private Edge/Control
integration, and console/browser acceptance remain pending and must not inherit the M6
evidence.
