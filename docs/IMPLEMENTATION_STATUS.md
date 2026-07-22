# Implementation status

Status: M0-M2 pass locally and in hosted CI; staging/production smoke passed
Last reviewed: 2026-07-22

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at candidate `358045b03161280bb3312e918130d148341104cf`; see the [green hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591). |
| Contracts v0 | Complete for M2 | [contracts source and tests](../packages/contracts/src/index.test.ts) are consumed by the engine, MCP registry, Worker, and CLI. This is not a stable released API. |
| Synchronous SQL store | Complete for M2 adapters | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through the SQLite Durable Object [Worker integrations](../apps/worker/test/mcp.integration.test.ts). |
| Core migrations and directory repositories | Complete for M2 scope | [core tests](../packages/core/src/core.test.ts), [Okta tests](../packages/core/src/okta.test.ts), and [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover append-only migrations, deterministic IDs, directory/application state, OAuth state, scenarios, and bounded request logs. SCIM and later lifecycle scope remain open. |
| Deterministic test seams | Complete for M2 scope | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. Production signing-key generation uses cryptographic randomness. |
| Fixture schema, loader, and runner | Complete for metadata/subset runner | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 30 Entra and 22 Okta source-reviewed OIDC fixtures. There is no corpus-wide engine conformance run yet. |
| Provider fixture corpora | Documented target | The 30 [Entra fixtures](../packages/testkit/fixtures/entra/oidc) and 22 [Okta fixtures](../packages/testkit/fixtures/okta/oidc) are marked `documented`; none claims comparison with a live provider tenant. |
| Entra OIDC runtime | Complete for M1 vertical slice, reverified in M2 | [Core](../packages/core/src/core.test.ts) and [Worker](../apps/worker/test/oidc.integration.test.ts) tests cover hosted login, authorization code + S256 PKCE, one-time redemption, Entra claims, and RS256/JWKS verification. The deployed M2 smoke repeats discovery, hosted PKCE, token exchange, JWKS verification, and an injected AADSTS50076 response. Refresh, client credentials, device flow, and broader error fidelity remain later Entra work. |
| Okta runtime | Complete for M2 slice locally | [Core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover discovery/JWKS, hosted authorization code + S256 PKCE, refresh-token issuance, introspection, revocation, RFC 8628 device authorization/activation, and provider-shaped errors. This has not been compared with a live Okta tenant or exercised by the current deployed smoke. |
| Scenario injection and request log | Complete for M2 | [Scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic probability and remaining counts, delay/error/mutation actions, caps, pagination, filtering, retention, and assertions. The [Worker MCP integration](../apps/worker/test/mcp.integration.test.ts) covers injection, synchronous capture, bounded bodies, API-key redaction, and assertions. |
| MCP runtime | Complete for M2 | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) expose 13 typed tools. The authenticated Agents SDK mount, per-session current-environment cursor, catalog isolation, tool calls, and cleanup pass the [Worker integration](../apps/worker/test/mcp.integration.test.ts). The official client's POST-only fallback and authenticated DELETE session close pass the [CLI MCP-client test](../packages/cli/test/mcp-client.test.ts); the deployed smoke covers initialization and its required tool loop, but does not independently assert the close response. |
| CLI Stage A | Complete for M2 implementation | `@mockos/cli` 0.1.0 covers profiles, diagnostics, environment lifecycle/configuration, seeding, applications, scenarios, token minting, logs, assertions/JUnit, well-known URLs, reports, and capability negotiation. [Command tests](../packages/cli/test/cli.test.ts) and [MCP client tests](../packages/cli/test/mcp-client.test.ts) pass; package publication and a command-by-command hosted staging matrix remain open. |
| Cloudflare Worker / Durable Object | Complete for M2 candidate | Local and hosted Worker suites cover Entra, Okta, MCP, scenarios, request logs, catalog isolation, and bounded edge behavior. Exact candidate `358045b03161280bb3312e918130d148341104cf` is deployed as staging version `05467231-f965-4a19-b882-66e82912a911` and production version `8b077c46-3f74-4bd2-803a-65431e1adba1`; the [M2 smoke](./evidence/m2-workers-dev-smoke.md) passed both and removed its environments. |
| SCIM inbound and lifecycle APIs | Not started | M3 target. |
| Outbound provisioning | Not started | M5 target; no network calls are currently authorized by this design. |
| Hosted cloud control plane, billing, console | Not in this repository | Private `mockos-cloud` work begins at M4. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | Complete for M2 manual acceptance | The exact CI-green candidate passed the same authenticated smoke at [staging](https://mockos-staging.workspaceagent.workers.dev) and [production](https://mockos.workspaceagent.workers.dev), with both catalogs empty afterward. These are qualification targets, not a service-level commitment. The corresponding [deploy-workflow run](https://github.com/reachjalil/mockos/actions/runs/29881613905) was skipped by explicit opt-in, so automated deployment execution is not yet qualified. |
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
