# Implementation status

Status: M0-M2 gates satisfied; M3 local gate is green, while hosted, deployed, and live-provider gates remain open
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at candidate `358045b03161280bb3312e918130d148341104cf`; see the [green hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591). |
| Contracts v0 | M3 source candidate | [contracts source and tests](../packages/contracts/src/index.test.ts) include SCIM resources, directory lifecycle state/actions/results, 14 MCP tools, and provider directory URLs consumed by the engine, MCP registry, Worker, and CLI. This is not a stable released API. |
| Synchronous SQL store | M3 source candidate | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. Migration v4 adds directory versions/SCIM state and refresh-family lineage without changing the portability boundary. |
| Core migrations and directory repositories | M3 source candidate locally | [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) tests cover append-only migrations, deterministic IDs, versioned Users/Groups, lifecycle state and atomic credential revocation, rotating refresh families, scenarios, and bounded request logs. The full local M3 `pnpm check` is green. |
| Deterministic test seams | Complete for M2; reused by the M3 source candidate | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. M3 refresh/lifecycle and directory scenario paths retain those seams. Production signing-key generation uses cryptographic randomness. |
| Fixture schema, loader, and runner | Complete for local SCIM HTTP execution | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 30 Entra and 22 Okta source-reviewed OIDC fixtures plus 113 SCIM fixtures. The dedicated [SCIM executor](../packages/engine-http/src/scim-fixtures.test.ts) runs all 113 cases against the local HTTP composition and is green; focused [Worker integration](../apps/worker/test/scim.integration.test.ts) separately qualifies the Durable Object mount. This is not deployed or live-provider evidence. |
| Provider fixture corpora | Mixed evidence | The 30 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) and 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain `documented` targets. The SCIM corpus contains 91 RFC, 10 Entra, and 12 Okta cases; its lock records 113 source-implemented and zero documented, and all 113 execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | M3 source candidate locally; M2 deployed | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover hosted login, authorization code + S256 PKCE, rotating refresh redemption, lifecycle revocation, AADSTS50057 disabled-user failure, Entra claims, and RS256/JWKS verification. The deployed M2 smoke covers the earlier code/JWKS/AADSTS50076 slice only. Client credentials, device flow, and broader error fidelity remain open. |
| Okta runtime | M3 source candidate locally | [Core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover discovery/JWKS, hosted authorization code + S256 PKCE, refresh issuance plus core/HTTP rotation and replay handling, introspection, revocation, RFC 8628 device authorization/activation, and provider-shaped errors. This has not been compared with a live Okta tenant or exercised by the current deployed smoke. |
| Scenario injection and request log | M3 source candidate locally | [Scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic probability and remaining counts, delay/error/mutation actions, caps, pagination, filtering, retention, and assertions. Worker integrations cover OIDC plus `scim.request`, `graph.request`, and `okta.api` routing, synchronous capture, bounded bodies, API-key redaction, and assertions. |
| MCP runtime | M3 source candidate locally; M2 deployed | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) expose 14 typed tools, including `simulate_lifecycle`. The authenticated Agents SDK mount, session cursor, catalog isolation, tool calls, an Entra lifecycle cascade, and cleanup pass focused Worker integrations. The official client's POST-only fallback and authenticated DELETE pass the [CLI MCP-client test](../packages/cli/test/mcp-client.test.ts). The deployed M2 smoke covers its earlier required tool loop, not the 14-tool M3 registry. |
| CLI Stage A | M3 source candidate locally | The unpublished `@mockos/cli` 0.1.0 source covers profiles, diagnostics, environments/configuration, seeding, applications, `lifecycle simulate`, scenarios, token minting, logs, assertions/JUnit, well-known URLs, reports, and capability negotiation. [Command tests](../packages/cli/test/cli.test.ts) and [MCP client tests](../packages/cli/test/mcp-client.test.ts) provide local evidence; package publication and a command-by-command hosted M3 matrix remain open. |
| Cloudflare Worker / Durable Object | M3 source candidate locally; M2 deployed | Focused local Worker suites cover Entra/Okta OIDC, authenticated MCP, SCIM, Graph/Okta directory APIs, lifecycle cascades, scenarios, request logs, catalog isolation, and bounded edge behavior. The deployed evidence remains exact M2 candidate `358045b03161280bb3312e918130d148341104cf`, staging version `05467231-f965-4a19-b882-66e82912a911`, and production version `8b077c46-3f74-4bd2-803a-65431e1adba1`; the [M2 smoke](./evidence/m2-workers-dev-smoke.md) passed both and removed its environments. |
| SCIM inbound and lifecycle APIs | M3 source candidate locally integrated | Portable contracts, bounded filter/PATCH logic, versioned persistence/service behavior, the `/scim/v2` HTTP/Worker composition, provider dialects, Graph/Okta directory adapters, and lifecycle policy have focused local coverage. All 113 SCIM fixtures execute green against the local HTTP composition; [Worker SCIM](../apps/worker/test/scim.integration.test.ts) and [lifecycle-cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) suites qualify the mounted runtime and credential/membership cascade locally. The full local M3 gate is green; hosted CI, deployed smoke, and live-provider comparison remain pending. |
| Outbound provisioning | Not started | M5 target; no network calls are currently authorized by this design. |
| Hosted cloud control plane, billing, console | Not in this repository | Private `mockos-cloud` work begins at M4. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | Complete for M2 manual acceptance; M3 not deployed | The exact M2 CI-green candidate passed the same authenticated smoke at [staging](https://mockos-staging.workspaceagent.workers.dev) and [production](https://mockos.workspaceagent.workers.dev), with both catalogs empty afterward. These are qualification targets, not a service-level commitment or M3 evidence. The corresponding [deploy-workflow run](https://github.com/reachjalil/mockos/actions/runs/29881613905) was skipped by explicit opt-in, so automated deployment execution is not yet qualified. |
| Custom `mockos.live` zone | Blocked on domain purchase | M8 cutover-only dependency. |
| npm publishing | Blocked externally | The `@mockos` names remain the intended scope, but npm authentication is unavailable and the scope is not confirmed as registered. Publishing is an M4 boundary. |

## Milestone acceptance

The code-and-test portions of M0, M1, and M2 pass locally. The
[curl walkthrough](./quickstarts/curl.md) maps to the implemented control and protocol
routes and has an independent [local `wrangler dev` result](./evidence/m1-wrangler-dev-smoke.md).
The [M2 deployed smoke](./evidence/m2-workers-dev-smoke.md) passed create, discovery,
mint, JWKS verification, hosted PKCE, AADSTS50076 injection, request-log query,
assertion, deletion, and empty-catalog checks in staging and production. The exact
candidate also has a [green hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591),
so the M2 prerequisite and F0 merge gate are satisfied.

M3 is presently a source candidate with focused local runtime evidence. Contracts,
core, SCIM adapter/service, provider directory, refresh/lifecycle, MCP, CLI, and Worker
tests exist; all 113 SCIM fixtures execute green locally, focused Worker SCIM and
lifecycle-cascade integrations pass, and the full repository `pnpm check` is green.
This ledger does not mark M3 accepted until hosted CI and an explicit deployed
acceptance smoke pass for the same revision. Live-provider parity also remains
unverified. No current workers.dev or npm claim should be read as M3 deployment
evidence.
