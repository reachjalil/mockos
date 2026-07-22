# Requirements traceability

Status: M0-M2 evidence map; M2 gate satisfied, later lifecycle features remain open
Last reviewed: 2026-07-22

States are Complete, Partial, Not started, Blocked, or Intentionally deferred.

| ID | Requirement | State | Evidence / next gate |
| --- | --- | --- | --- |
| IDP-ENTRA-001 | Tenant-scoped OIDC discovery | Complete for M1; live-reverified in M2 | [fixture](../packages/testkit/fixtures/entra/oidc/01-discovery.json), [Worker integration](../apps/worker/test/oidc.integration.test.ts), and [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| IDP-ENTRA-002 | Authorization code with PKCE S256 | Complete for M1; live-reverified in M2 | [fixture](../packages/testkit/fixtures/entra/oidc/10-authorize-pkce-s256.json), [core test](../packages/core/src/core.test.ts), [Worker integration](../apps/worker/test/oidc.integration.test.ts), and [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| IDP-ENTRA-003 | Provider-shaped AADSTS errors | Complete for M2 catalog slice | [Core error-catalog test](../packages/core/src/core.test.ts), documented fixtures, [Worker scenario integration](../apps/worker/test/mcp.integration.test.ts), and live AADSTS50076 evidence in the [deployed smoke](./evidence/m2-workers-dev-smoke.md); corpus-wide live-provider parity remains unverified |
| IDP-OKTA-001 | Okta OIDC profile and errors | Complete for M2 slice locally | 22 [source-reviewed fixtures](../packages/testkit/fixtures/okta/oidc), [core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts); live-tenant and deployed-smoke comparison remain open |
| SCIM-001 | RFC 7643 resource schemas | Not started | M3 |
| SCIM-002 | RFC 7644 CRUD, filter, PATCH, ETag | Not started | M3 |
| RBAC-001 | App roles and assignments | Partial | Storage contracts may exist; token-claim integration required |
| RBAC-002 | Group claims and overage | Not started | M6 |
| MAP-001 | Entra/Okta profile mapping without engine forks | Complete for M2 slice | Shared engine with provider profiles in [core](../packages/core/src/providers) and separate Entra/Okta Worker integrations |
| TOK-001 | RS256 signing and JWKS validation | Complete for M2 scope | [Core crypto test](../packages/core/src/core.test.ts), Worker round trips, and both minted-token and hosted-flow signature checks in the [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| TOK-002 | Hashed rotating refresh-token families | Partial | Refresh tokens are stored hashed and support Okta introspection/revocation in [core tests](../packages/core/src/okta.test.ts); refresh exchange, consumption, and family rotation are not implemented |
| TEN-001 | One isolated SQLite store per environment | Complete for M2 | [Node adapter test](../packages/testkit/src/testkit.test.ts), Durable Object [MCP isolation integration](../apps/worker/test/mcp.integration.test.ts), and empty-catalog cleanup in the [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| TEN-002 | Derive issuer per request; never persist absolute issuer | Complete for M2 | [Core persistence invariant](../packages/core/src/core.test.ts), request-host assertions in Worker integrations, and distinct staging/production issuer verification in the [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| TEN-003 | Path and subdomain host resolution | Complete in unit scope | [host resolver tests](../packages/worker-kit/src/host-resolver.test.ts); subdomain live TLS/routing verification remains M8 |
| SCN-001 | Deterministic delay/error/mutation injection | Complete for M2 | [Core deterministic/cap tests](../packages/core/src/scenario-log.test.ts), [Worker integration](../apps/worker/test/mcp.integration.test.ts), and one-shot live error injection in the [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| MCP-001 | Handler-agnostic tool registry | Complete for M2 | 13-tool [registry and tests](../packages/mcp/src/index.test.ts), authenticated Agents SDK [Worker integration](../apps/worker/test/mcp.integration.test.ts), and official-SDK-client [deployed smoke](./evidence/m2-workers-dev-smoke.md) |
| MCP-002 | Session current-environment cursor | Complete for M2 | [Registry cursor tests](../packages/mcp/src/index.test.ts) and mounted-session [Worker integration](../apps/worker/test/mcp.integration.test.ts) |
| AUDIT-001 | Inbound/outbound request log and assertions | Partial | The M2 engine supports inbound/control/outbound entries and filtering, pagination, retention, and assertions in [core tests](../packages/core/src/scenario-log.test.ts); the Worker captures inbound protocol traffic in [integration](../apps/worker/test/mcp.integration.test.ts) and live smoke tests, while outbound runtime evidence remains M5 |
| AUDIT-002 | Redact platform secrets, retain test protocol bodies | Complete for M2 boundary | API-key redaction and bounded test-protocol-body retention are covered by the [Worker integration](../apps/worker/test/mcp.integration.test.ts); later outbound and hosted-control boundaries require their own review |
| PROV-001 | Deterministic outbound SCIM planner | Not started | M5 |
| PROV-002 | SSRF guard at save and fetch time | Not started | M5 security suite |
| OPS-001 | CI format/types/test/build + Wrangler gates | Complete for M2 | The [CI workflow](../.github/workflows/ci.yml) is [green](https://github.com/reachjalil/mockos/actions/runs/29881568591) at exact candidate `358045b03161280bb3312e918130d148341104cf`, including both Wrangler dry runs |
| OPS-002 | workers.dev deploy and smoke | Complete for M2 manual acceptance | Exact candidate, staging/production version IDs, authenticated flow, and empty-catalog cleanup are recorded in the [deployed smoke evidence](./evidence/m2-workers-dev-smoke.md); the [deploy-workflow run](https://github.com/reachjalil/mockos/actions/runs/29881613905) was skipped and does not qualify automated deployment execution |
| CLI-001 | Non-interactive M2 operator loop | Complete for M2 implementation | Profiles, diagnostics, environment lifecycle, seeding, applications, scenarios, minting, log/assertion output, JUnit, well-known URLs, reports, and capability negotiation pass [CLI tests](../packages/cli/test/cli.test.ts); package publication and hosted command-matrix evidence remain open |
| OPS-003 | Custom-domain cutover | Blocked | Domain purchase and M8 runbook execution |
| SAML-001 | SAML protocol | Intentionally deferred | v2 product scope |
