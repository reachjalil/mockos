# Implementation status

Status: M0-M3 accepted; M5 is locally qualified source pending immutable-revision, hosted-CI, and deployment acceptance
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not. The
accepted deployed baseline is M3 at exact revision
`8645f405d5e3b922c30d51339b8b27f9fe30d93e`; the locally qualified M5 source
does not inherit that revision's hosted or deployed evidence.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI through M3 | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at exact M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e`; see [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480). |
| Contracts v0 | Accepted for M3; M5 source candidate locally green | The accepted contract includes SCIM resources, directory lifecycle state/actions/results, 14 M3 MCP tools, and provider directory URLs. The M5 [provisioning contract](../packages/contracts/src/provisioning.ts) and tests add safe target metadata, snapshots, watermarks, plans, operations, responses, and `run_provisioning_cycle` as tool 15. The full local gate is green; this remains an unreleased API pending an immutable revision and hosted/deployed qualification. |
| Synchronous SQL store | Accepted for M3; additive M5 migration candidate locally green | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. Accepted migration v4 adds directory versions/SCIM state and refresh-family lineage. The M5 candidate adds append-only provisioning target, staged-run target, run/step, and watermark state, including one active run per app/target; Worker and process-e2e qualification are green locally. |
| Core migrations and directory repositories | Accepted for M3; M5 planner locally green | The accepted [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) cover the M3 engine. The M5 [provisioning planner/interpreter](../packages/core/src/provisioning) deterministically orders provider-specific SCIM work, updates watermarks, and represents rate-limit waits/retries; its focused and full local gates are green. |
| Deterministic test seams | Complete through M3 | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. M3 refresh/lifecycle and directory scenario paths retain those seams. Production signing-key generation uses cryptographic randomness. |
| Fixture schema, loader, and runner | Complete for M3 local and hosted SCIM HTTP execution | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 30 Entra and 22 Okta source-reviewed OIDC fixtures plus 113 SCIM fixtures. The dedicated [SCIM executor](../packages/engine-http/src/scim-fixtures.test.ts) runs all 113 cases against the HTTP composition and is green locally and in hosted CI; focused [Worker integration](../apps/worker/test/scim.integration.test.ts) separately qualifies the Durable Object mount. The deployed M3 smoke samples SCIM discovery and Group PATCH, not the entire corpus, and no live-provider comparison is claimed. |
| Provider fixture corpora | Mixed evidence | The 30 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) and 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain `documented` targets. The SCIM corpus contains 91 RFC, 10 Entra, and 12 Okta cases; its lock records 113 source-implemented and zero documented, and all 113 execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | Accepted M3 slice locally, in hosted CI, and deployed | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover hosted login, authorization code + S256 PKCE, rotating refresh redemption, lifecycle revocation, AADSTS50057 disabled-user failure, Entra claims, and RS256/JWKS verification. The [M3 deployed smoke](./evidence/m3-workers-dev-smoke.md) exercised those principal paths at staging and production. Client credentials, device flow, broader error fidelity, and live-provider comparison remain open. |
| Okta runtime | Accepted M3 implementation; deployed directory subset | [Core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover discovery/JWKS, hosted authorization code + S256 PKCE, refresh issuance plus core/HTTP rotation and replay handling, introspection, revocation, RFC 8628 device authorization/activation, and provider-shaped errors. The M3 deployed smoke exercised Okta SCIM discovery/PATCH, a bounded User read, and an injected rate-limit response; it did not exercise Okta OIDC or compare with a live tenant. |
| Scenario injection and request log | Accepted for M3; M5 ordered assertion candidate locally green | Accepted M3 [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic scenarios, filtering, retention, and assertions. The M5 candidate adds response-body predicates and repeated, non-overlapping ordered request-sequence counts. Worker capture/redaction, the full gate, and the four-step process-e2e assertion are green locally. |
| MCP runtime | Accepted 14-tool M3 runtime; locally green 15-tool M5 source candidate | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) accept the 14 M3 tools and now exercise the M5 `run_provisioning_cycle` contract as tool 15. Authenticated mounted Worker tests and the built-CLI process e2e exercise tool 15 locally. The deployed M3 smoke did not exercise outbound provisioning; M5 hosted/deployed qualification remains pending. |
| CLI Stage A | Accepted M3 scope; M5 `provision run` source candidate locally green; unpublished | The unpublished `@mockos/cli` 0.1.0 source covers the accepted operator loop. The M5 candidate adds `provision run` with target credentials accepted only from a file or standard input, plus capability negotiation for `run_provisioning_cycle`; all 19 CLI tests and the built-CLI process e2e are green locally. Package publication, hosted qualification, and a deployed command matrix remain open. |
| Cloudflare Worker / Durable Object | Accepted and deployed for M3; M5 Worker source locally qualified | Exact candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e` passed the [M3 smoke](./evidence/m3-workers-dev-smoke.md) at staging version `75a782c3-c61d-4558-87ed-34b3054e3e2f` and production version `8392519b-e75c-47b1-81aa-a846021155c3`; reverse cleanup and final empty-catalog checks passed. The M5 source candidate adds Workflow and environment-Durable-Object provisioning composition. Its Worker suite (23/23), worker-kit suite (79/79), production/staging dry runs, full repository gate, and fresh two-process e2e are green locally; CI and deployed smoke are pending. |
| SCIM inbound and lifecycle APIs | Accepted for the bounded M3 scope | Portable contracts, bounded filter/PATCH logic, versioned persistence/service behavior, the `/scim/v2` HTTP/Worker composition, provider dialects, Graph/Okta directory adapters, and lifecycle policy have focused local and hosted coverage. All 113 SCIM fixtures execute green against the HTTP composition; Worker SCIM and lifecycle-cascade suites qualify the mounted runtime. The deployed smoke exercised both provider discovery/PATCH shapes and the Entra credential cascade. It does not establish corpus-wide deployed execution or live-provider parity. |
| Outbound provisioning | Partial M5 source candidate; local source qualification passed | [Contracts](../packages/contracts/src/provisioning.ts), the deterministic [planner/interpreter](../packages/core/src/provisioning), Workflow/HTTP composition in [worker-kit](../packages/worker-kit/src/provisioning-workflow.ts), SSRF controls, isolated target-credential storage, the [target app](../examples/target-app), tool 15, and the CLI command are present. Worker/worker-kit tests, full `pnpm check`, and the two-process target-app e2e are green in the [local source record](./evidence/m5-local-source-qualification.md). An immutable revision, hosted CI, and exact-candidate staging/production acceptance remain required before this row can be accepted. |
| Hosted cloud control plane, billing, console | Not in this repository; no public dependency | A separately qualified private M4 composition consumed public docs-close revision `e446eeda357b5e765401b97b892128fd70ac9ab8`. Its hosted acceptance is recorded privately and is not evidence for this M5 source candidate. The Apache-2.0 Worker remains buildable and self-hostable without private code, licensing, billing, or call-home behavior. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | Complete for M3 manual acceptance | Exact CI-green M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e` passed the expanded authenticated smoke at [staging](https://mockos-staging.workspaceagent.workers.dev) and [production](https://mockos.workspaceagent.workers.dev), with reverse cleanup and empty catalogs afterward; see the [M3 evidence](./evidence/m3-workers-dev-smoke.md). These are qualification targets, not a service-level commitment. The corresponding [deploy-workflow run](https://github.com/reachjalil/mockos/actions/runs/29886659744) was skipped by explicit opt-in, so automated deployment execution remains unqualified. |
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

M5 is not accepted yet. The current source candidate contains the outbound provisioning
contracts, deterministic Entra/Okta planner and interpreter, Workflow orchestration,
SSRF/bounded-fetch policy, isolated target credential handling, target-app example,
ordered response-aware assertions, fifteenth MCP tool, and CLI command. The Worker and
worker-kit suites, full repository gate, independent source review, and fresh
two-process `wrangler dev` e2e are green in the
[local M5 record](./evidence/m5-local-source-qualification.md). An immutable revision,
hosted CI, and staging/production controlled-target smoke evidence do not yet exist;
no M3 or private M4 evidence should be reused to fill those gaps.
