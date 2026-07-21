# Implementation status

Status: M0 substrate and M1 Entra vertical slice pass locally; no live deployment  
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass locally. A hosted GitHub Actions run remains external evidence. |
| Contracts v0 | Complete for M0 | [contracts source and tests](../packages/contracts/src/index.test.ts) are consumed by the M1 engine and Worker. This is not a stable released API. |
| Synchronous SQL store | Complete for Node adapter | [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts). Durable Object equivalence is not yet proven. |
| Core migrations and directory repositories | Complete for M0/M1 scope | [core tests](../packages/core/src/core.test.ts) cover migrations, deterministic IDs, directory/application state, and the authorization-code slice. SCIM and later lifecycle scope remain open. |
| Deterministic test seams | Complete for testkit | [clock/RNG](../packages/testkit/src/determinism.ts) has unit coverage. Core-wide use is not yet established. |
| Fixture schema, loader, and runner | Complete for metadata/subset runner | [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts). There is no engine-wide conformance run yet. |
| Entra OIDC fixture corpus | Documented target | 30 individual [fixtures](../packages/testkit/fixtures/entra/oidc), all marked `documented`; none claims live verification. |
| Entra OIDC runtime | Complete for M1 vertical slice | [core test](../packages/core/src/core.test.ts) and [Worker integration test](../apps/worker/test/oidc.integration.test.ts) cover hosted login, authorization code + S256 PKCE, one-time redemption, Entra claims, and RS256/JWKS verification. Refresh, client credentials, device flow, and broader error fidelity are later work. |
| Cloudflare Worker / Durable Object | Complete for M1 local scope | [Worker integration test](../apps/worker/test/oidc.integration.test.ts) drives control RPC, isolated DO SQLite, path routing, login, token, and JWKS under the Workers test runtime. Production/staging bundles dry-run, and the [raw Wrangler smoke](./evidence/m1-wrangler-dev-smoke.md) passes. No deployed Worker is claimed. |
| Okta runtime | Not started | M2 target. |
| Scenario injection and request log | Not started | M2 target. |
| MCP runtime | Not started | M2 target. The repository skill is guidance only. |
| SCIM inbound and lifecycle APIs | Not started | M3 target. |
| Outbound provisioning | Not started | M5 target; no network calls are currently authorized by this design. |
| Hosted cloud control plane, billing, console | Not in this repository | Private `mockos-cloud` work begins at M4. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | Not deployed | M2 target; no live URL is published here. |
| Custom `mockos.live` zone | Blocked on domain purchase | M8 cutover-only dependency. |
| npm publishing | Blocked externally | The `@mockos` names remain the intended scope, but npm authentication is unavailable and the scope is not confirmed as registered. Publishing is an M4 boundary. |

## Milestone acceptance

The code-and-test portions of M0 and the defined M1 Entra vertical slice pass locally.
The [curl walkthrough](./quickstarts/curl.md) maps to the implemented control and
protocol routes and has an independent [local `wrangler dev` result](./evidence/m1-wrangler-dev-smoke.md).
Repository creation/push and the first hosted CI run are operational evidence owned
outside this source tree. M2 is the earliest milestone that claims a deployed
workers.dev smoke test.
