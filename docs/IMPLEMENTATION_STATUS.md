# Implementation status

Status: M0-M3 and tested M5 slice accepted; M6 integration is source-qualified only
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not. The
accepted M3 baseline is exact revision
`8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 has a separate immutable public
runtime revision, hosted CI run, manual Worker rollout, and controlled-target
acceptance record; it does not inherit M3 evidence or qualify the guarded deployment
workflow. M6 evidence is still source-only and does not inherit either deployment
record.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI through M3 | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at exact M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e`; see [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480). |
| Contracts v0 | Accepted through tested M5; additive M6 source in qualification | The accepted contract includes SCIM resources, directory lifecycle state/actions/results, and the M5 [provisioning contract](../packages/contracts/src/provisioning.ts) for safe target metadata, snapshots, watermarks, plans, operations, responses, and `run_provisioning_cycle` as tool 15. Exact public revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed hosted CI and the source-paired manual acceptance. The M6 Authn source adds seeded `passwordState` and request-derived `oktaAuthnEndpoint`; packages remain unpublished. |
| Synchronous SQL store | Accepted through the tested M5 slice | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. M5 adds append-only provisioning target, staged-run target, run/step, and watermark state, including one active run per app/target; local gates and the controlled-target hosted run passed. |
| Core migrations and directory repositories | Accepted through M5; bounded M6 Authn source green | The accepted [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) cover the M3 engine. The M5 [provisioning planner/interpreter](../packages/core/src/provisioning) passed focused/full and controlled-target gates. The M6 [Classic Authn service](../packages/core/src/authn/okta-authn.ts) reuses the existing `authn_transactions`/`web_sessions` tables and has focused password-before-state, hash-only storage, expiry, cancellation, lifecycle revocation, and concurrent one-time-session tests. |
| Deterministic test seams | Complete through M3 | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. M3 refresh/lifecycle and directory scenario paths retain those seams. Production signing-key generation uses cryptographic randomness. |
| Fixture schema, loader, and runner | Complete for M3 SCIM; bounded M6 Authn executor locally green | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 30 Entra and 22 Okta source-reviewed OIDC fixtures, 113 SCIM fixtures, and five M6 Okta Authn fixtures. The SCIM executor remains green locally/hosted, and the new [Authn executor](../packages/engine-http/src/okta-authn-fixtures.test.ts) runs all five Authn cases against the core-backed HTTP composition locally. No live-provider comparison is claimed. |
| Provider fixture corpora | Mixed evidence | The 30 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) and 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain `documented` targets. The SCIM corpus contains 113 source-implemented cases. Five [Okta Authn fixtures](../packages/testkit/fixtures/okta/authn) are source-reviewed, marked `implemented`, and execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | Accepted M3 slice locally, in hosted CI, and deployed | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover hosted login, authorization code + S256 PKCE, rotating refresh redemption, lifecycle revocation, AADSTS50057 disabled-user failure, Entra claims, and RS256/JWKS verification. The [M3 deployed smoke](./evidence/m3-workers-dev-smoke.md) exercised those principal paths at staging and production. Client credentials, device flow, broader error fidelity, and live-provider comparison remain open. |
| Okta runtime | Accepted M3 implementation plus bounded M6 Classic Authn source; deployed directory subset | Existing [core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover the M3 OAuth/device/directory slice. M6 adds core/HTTP/Worker coverage for `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, state retrieval/cancellation, five-minute hashed capabilities, replay denial, lifecycle invalidation, privacy, and Authn log redaction. Factor verification and the rest of the Classic machine remain absent; the deployed M3 smoke is not M6 evidence. |
| Scenario injection and request log | Accepted through the tested M5 assertion slice | Accepted M3 [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic scenarios, filtering, retention, and assertions. M5 adds response-body predicates and repeated, non-overlapping ordered request-sequence counts. Worker capture/redaction, the full gate, local process e2e, and both four-request hosted assertions passed. |
| MCP runtime | Accepted 15-tool M5 runtime for the tested hosted slice | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) exercise `run_provisioning_cycle` as tool 15. Authenticated mounted Worker tests, the built-CLI process e2e, and staging/production hosted starts passed. This is not a claim that every tool was re-exercised remotely or that npm distribution exists. |
| CLI Stage A | Accepted M5 source command; unpublished | The unpublished `@mockos/cli` 0.1.0 source includes secret-safe `provision run` and capability negotiation for `run_provisioning_cycle`; all 19 CLI tests and the built-CLI process e2e are green. Package publication and a complete deployed CLI command matrix remain open. |
| Cloudflare Worker / Durable Object | M5 source deployed; additive M6 Authn source green | Exact M5 public revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed [CI run 29957994237](https://github.com/reachjalil/mockos/actions/runs/29957994237). Its public staging and production versions and exact-pinned hosted composition passed recorded M5 acceptance. The M6 source mounts Authn separately from SSWS-protected management routes and redacts Authn credentials/capabilities; its expanded Worker suite is green locally, with no M6 hosted/deployed claim yet. |
| SCIM inbound and lifecycle APIs | Accepted for the bounded M3 scope | Portable contracts, bounded filter/PATCH logic, versioned persistence/service behavior, the `/scim/v2` HTTP/Worker composition, provider dialects, Graph/Okta directory adapters, and lifecycle policy have focused local and hosted coverage. All 113 SCIM fixtures execute green against the HTTP composition; Worker SCIM and lifecycle-cascade suites qualify the mounted runtime. The deployed smoke exercised both provider discovery/PATCH shapes and the Entra credential cascade. It does not establish corpus-wide deployed execution or live-provider parity. |
| Outbound provisioning | Manually accepted for the tested M5 slice | [Contracts](../packages/contracts/src/provisioning.ts), the deterministic [planner/interpreter](../packages/core/src/provisioning), Workflow/HTTP composition in [worker-kit](../packages/worker-kit/src/provisioning-workflow.ts), SSRF controls, isolated target-credential storage, the [target app](../examples/target-app), tool 15, and the CLI command pass the [local source record](./evidence/m5-local-source-qualification.md). The exact source pair then passed staging and production Workflow execution with four matched target requests, terminal success, empty target state after cleanup, and deleted target infrastructure in the [deployment record](./evidence/m5-workers-dev-smoke.md). Live-provider parity and recurring scheduling remain open. |
| Hosted cloud control plane, billing, console | Not in this repository; no public dependency | A separately operated private composition consumed exact public M5 runtime revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` for the recorded manual acceptance. That evidence demonstrates use of the exported public seams, not a private runtime dependency: the Apache-2.0 Worker remains buildable and self-hostable without private code, licensing, billing, or call-home behavior. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | M5 manually rolled out; guarded promotion unqualified | Exact public M5 source was manually deployed to isolated staging and production and confirmed 100% active; the paired hosted composition passed controlled-target provisioning and cleanup. The existing standalone public Access Keys were preserved, so only version/health—not an authenticated M5 tool flow—was verified on those two standalone Workers. Neither repository's guarded GitHub deployment workflow was executed or formally qualified. |
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

M6 is not accepted. This source branch contains only its bounded Okta Classic Authn
stream: five executable fixtures, core/HTTP/Worker behavior, request-derived discovery,
privacy and replay coverage, Authn log redaction, and a skill recipe. JWKS rotation,
broken-token variants, clock skew, group overage, SCIM race/tolerance cases, generated
parity output, hosted CI, and deployed acceptance remain separate gates. Passing this
stream cannot be presented as completion of the M6 milestone.
