# Requirements traceability

Status: M0/M1 evidence map; later provider and control features remain open  
Last reviewed: 2026-07-22

States are Complete, Partial, Not started, Blocked, or Intentionally deferred.

| ID | Requirement | State | Evidence / next gate |
| --- | --- | --- | --- |
| IDP-ENTRA-001 | Tenant-scoped OIDC discovery | Complete for M1 | [fixture](../packages/testkit/fixtures/entra/oidc/01-discovery.json) + [Worker integration](../apps/worker/test/oidc.integration.test.ts) |
| IDP-ENTRA-002 | Authorization code with PKCE S256 | Complete for M1 | [fixture](../packages/testkit/fixtures/entra/oidc/10-authorize-pkce-s256.json), [core test](../packages/core/src/core.test.ts), and full [hosted-login Worker integration](../apps/worker/test/oidc.integration.test.ts) |
| IDP-ENTRA-003 | Provider-shaped AADSTS errors | Partial | [core error-catalog test](../packages/core/src/core.test.ts) and documented fixtures; exact wire text and live parity remain unverified |
| IDP-OKTA-001 | Okta OIDC profile and errors | Not started | M2 |
| SCIM-001 | RFC 7643 resource schemas | Not started | M3 |
| SCIM-002 | RFC 7644 CRUD, filter, PATCH, ETag | Not started | M3 |
| RBAC-001 | App roles and assignments | Partial | Storage contracts may exist; token-claim integration required |
| RBAC-002 | Group claims and overage | Not started | M6 |
| MAP-001 | Entra/Okta profile mapping without engine forks | Partial | Provider-profile types; cross-provider tests required |
| TOK-001 | RS256 signing and JWKS validation | Complete for M1 | [core crypto test](../packages/core/src/core.test.ts) and live-in-runtime [Worker round trip](../apps/worker/test/oidc.integration.test.ts) |
| TOK-002 | Hashed rotating refresh-token families | Partial | Core storage/engine evidence required |
| TEN-001 | One isolated SQLite store per environment | Complete for M1 | [Node adapter test](../packages/testkit/src/testkit.test.ts) and [Durable Object integration](../apps/worker/test/oidc.integration.test.ts) |
| TEN-002 | Derive issuer per request; never persist absolute issuer | Complete for M1 | [core persistence invariant](../packages/core/src/core.test.ts) and request-host assertions in [Worker integration](../apps/worker/test/oidc.integration.test.ts) |
| TEN-003 | Path and subdomain host resolution | Complete in unit scope | [host resolver tests](../packages/worker-kit/src/host-resolver.test.ts); subdomain live TLS/routing verification remains M8 |
| SCN-001 | Deterministic delay/error/mutation injection | Not started | M2 |
| MCP-001 | Handler-agnostic tool registry | Partial | Package surface may exist; mounted authenticated MCP smoke is M2 |
| MCP-002 | Session current-environment cursor | Not started | M2 |
| AUDIT-001 | Inbound/outbound request log and assertions | Not started | M2/M5 |
| AUDIT-002 | Redact platform secrets, retain test protocol bodies | Not started | Threat-model test and edge boundary review |
| PROV-001 | Deterministic outbound SCIM planner | Not started | M5 |
| PROV-002 | SSRF guard at save and fetch time | Not started | M5 security suite |
| OPS-001 | CI format/types/test/build + Wrangler gates | Complete locally | [CI workflow](../.github/workflows/ci.yml); all equivalent local gates and both dry runs pass, while the first hosted run remains external evidence |
| OPS-002 | workers.dev deploy and smoke | Not started | M2 |
| OPS-003 | Custom-domain cutover | Blocked | Domain purchase and M8 runbook execution |
| SAML-001 | SAML protocol | Intentionally deferred | v2 product scope |
