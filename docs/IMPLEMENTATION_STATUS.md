# Implementation status

Status: M0-M3 and tested M5 slice accepted; bounded M6 slice accepted with sampled deployed evidence
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not. The
accepted M3 baseline is exact revision
`8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 has a separate immutable public
runtime revision, hosted CI run, manual Worker rollout, and controlled-target
acceptance record; it does not inherit M3 evidence or qualify the guarded deployment
workflow. M6 has its own exact-source, CI, version, and sampled workers.dev acceptance
record; it does not inherit M3/M5 evidence or qualify the guarded Cloudflare-credential
deployment workflow.

Evidence tiers are intentionally separate. **Source** means exact-revision local or
hosted-CI execution; **deployed** additionally binds that revision to an exact mockOS
deployment/version and recorded acceptance; **verified-live** is reserved for
sanitized, independently reviewed evidence from a real Entra ID tenant or Okta
organization. No current fixture or milestone is verified-live.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI through M3 | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at exact M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e`; see [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480). |
| Contracts v0 | Accepted through the bounded M6 runtime slice | The accepted contract includes SCIM resources, directory lifecycle state/actions/results, and the M5 [provisioning contract](../packages/contracts/src/provisioning.ts) for safe target metadata, snapshots, watermarks, plans, operations, responses, and `run_provisioning_cycle` as tool 15. M6 adds seeded Authn `passwordState`, request-derived `oktaAuthnEndpoint`, and exact-only token rotation/clock-skew scenario actions. Exact M6 revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` passed source and sampled deployed acceptance; packages remain unpublished. |
| Synchronous SQL store | Accepted through the tested M5 slice | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. M5 adds append-only provisioning target, staged-run target, run/step, and watermark state, including one active run per app/target; local gates and the controlled-target hosted run passed. |
| Core migrations and directory repositories | Accepted through M5; bounded M6 source suite and deployed sample green | The accepted [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) cover the M3 engine. The M5 [provisioning planner/interpreter](../packages/core/src/provisioning) passed focused/full and controlled-target gates. M6 focused tests cover the bounded [Classic Authn service](../packages/core/src/authn/okta-authn.ts), deterministic broken-token mutations, active/successor key handling, private-key scrubbing, bounded retention, and stale-instance/sign-rotate races. Authn state retrieval uses a sliding five-minute expiry while session capabilities retain their fixed five-minute issuance expiry. Each table is capped at 10,000 retained rows and each User at 32 retained rows per kind; ordered oldest-expiry eviction and a 256-row-per-table issuance GC pass are index-backed without advancing schema v5, preserving rollback compatibility. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises the externally observable slices, not every source-only retention/concurrency/security assertion. |
| Deterministic test seams | Complete through M3; bounded M6 token/key paths accepted | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. The M6 token stream adds exact-only rotation and claim-skew actions with fixed broken-token mutations; the deployed sample exercised rotation, skew, and every mutation. Production signing-key material remains cryptographically generated, and deeper deterministic assertions remain source evidence. |
| Fixture schema, loader, and runner | Complete for M3 SCIM; bounded M6 executors and sampled deployment green | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 38 Entra and 22 Okta source-reviewed OIDC fixtures, 113 SCIM fixtures, and five M6 Okta Authn fixtures. The [M6 Worker executor](../apps/worker/test/token-fixtures.integration.test.ts) supplies authenticated MCP/session, environment, client, subject, and Graph-bearer setup for Entra fixtures 31–38; the [Authn executor](../packages/engine-http/src/okta-authn-fixtures.test.ts) runs all five Authn cases against the core-backed HTTP composition. The M6 smoke sampled all six areas but was not a remote execution of this complete generated case index. The other OIDC fixtures remain documented targets, and no live-provider comparison is claimed. |
| Provider fixture corpora | Mixed evidence | The 38 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) fixtures contain 30 documented targets and eight implemented, locally Worker-executed M6 token/key/overage cases; all 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain documented. The SCIM corpus contains 113 source-implemented cases. Five [Okta Authn fixtures](../packages/testkit/fixtures/okta/authn) are source-reviewed, marked `implemented`, and execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | Accepted M3 slice; bounded M6 token/key/Graph slice sampled in deployment | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover the accepted M3 hosted-login, authorization-code, refresh/lifecycle, Entra-claim, and RS256/JWKS slice; the [M3 deployed smoke](./evidence/m3-workers-dev-smoke.md) exercised those principal paths. M6 source tests add deterministic broken tokens, skew, one-key rollover overlap, and group overage with trusted same-environment Graph fallback capped at 1,000 returned IDs. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises rotation/stale-JWKS verification, plus-300-second skew, all five broken variants, and the exact path-mode 200/201 boundary. The 1,001-ID ceiling, concurrency, private-key scrubbing, and subdomain routing remain source evidence; broader error fidelity and verified-live comparison remain open. |
| Okta runtime | Accepted M3 implementation plus bounded M6 Classic Authn deployed sample | Existing [core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover the M3 OAuth/device/directory slice. M6 adds core/HTTP/Worker coverage for `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, state retrieval/cancellation, hash-only capabilities, replay denial, lifecycle and SCIM-password-change revocation, and issuance-race denial. Successful retrieval slides state expiry; session expiry remains fixed. The HTTP shape uses singular `_embedded.factor` (an array), omits `passwordChanged`, permits same-origin CORS only for `POST` with `accept`/`content-type`, emits no credentialed-CORS allowance, and returns `403` cross-origin. Request/response bodies are recursively secret-redacted, malformed bodies are wholly redacted, and sensitive Authn headers are redacted. The [M6 smoke](./evidence/m6-workers-dev-smoke.md) samples initial states, state retrieval, CORS, privacy, and redaction; factor verification, cancellation/replay and revocation details not sampled there, verified-live comparison, and the rest of the Classic machine remain open or source-only as stated. |
| Scenario injection and request log | Accepted through the tested M5 assertion slice; M6 actions sampled in deployment | Accepted M3 [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic scenarios, filtering, retention, and assertions. M5 response-body predicates, repeated non-overlapping ordered counts, Worker capture/redaction, local process e2e, and both hosted four-request assertions passed. M6 key rotation and clock skew are restricted to exact internal `token.before_sign` evaluation rather than the generic catch-all; both were sampled by the exact-version M6 deployed smoke. |
| MCP runtime | Accepted 15-tool M5 runtime for the tested hosted slice | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) exercise `run_provisioning_cycle` as tool 15. Authenticated mounted Worker tests, the built-CLI process e2e, and staging/production hosted starts passed. This is not a claim that every tool was re-exercised remotely or that npm distribution exists. |
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
