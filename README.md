<p align="center">
  <img src="./assets/brand/mockos-mark.svg" width="112" alt="">
</p>

<h1 align="center"><span aria-hidden="true">🥸</span> mockOS</h1>

<p align="center"><strong>Mock identity infrastructure for integration tests.</strong></p>

<p align="center">Deterministic Entra ID and Okta protocol surfaces for testing real integrations.</p>

> **Project status:** M0 through M3 are accepted at exact revision
> `8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 outbound provisioning is manually
> accepted for exact public runtime revision
> `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`: local/full gates, hosted CI, manual
> staging-before-production rollout, and source-paired controlled-target Workflow
> acceptance are green. The bounded M6 slice is accepted at exact public revision
> `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`: the full local gate, hosted CI, manual
> staging-before-production rollout, and exact-version smoke of Classic Authn, SCIM
> edges, signing-key rotation, token skew/broken tokens, and 200/201 group overage are
> green. This is sampled deployed mock evidence, not corpus-wide or verified-live
> parity. The guarded GitHub promotion workflows remain unqualified. This is not yet a
> stable npm release or a production-SLA service. Separate local official-client
> candidates qualify `@azure/msal-node` 5.4.2 and `@okta/okta-auth-js` 8.0.1 through
> D/I/S/X/Q only; neither has H/V/P evidence. See the
> [evidence ledger](./docs/IMPLEMENTATION_STATUS.md).

mockOS is an Apache-2.0 open-core project for testing OIDC/OAuth 2.0, SCIM 2.0,
directory lifecycle, RBAC, and failure handling without depending on a real enterprise
tenant. Provider expectations live as source-attributed fixtures; deterministic clock,
randomness, and SQLite seams make failures reproducible.

The target deployment is Cloudflare-forward: Workers, SQLite Durable Objects,
Workflows, Queues, KV, and an Agents SDK MCP server. This public repository contains
the portable engine and a self-hostable Worker. Operated-service code lives separately
and may consume explicit public seams; this repository does not import or require that
private control plane, licensing, billing, or a hosted mockOS account.

## What exists now

- Workspace and package scaffolding
- Runtime-independent contracts, append-only migrations, versioned User/Group and
  application repositories, SCIM filter/PATCH behavior, and provider lifecycle policy
- An Okta OIDC profile covering discovery, hosted authorization code + S256 PKCE,
  refresh exchange, token introspection and revocation, and RFC 8628 device
  authorization in local tests
- Explicit confidential and public OAuth application registrations. Public clients
  have no stored or returned secret, cannot use `client_credentials`, can redeem code
  and refresh grants without a secret, and can revoke only their own tokens;
  introspection remains confidential-client-only
- Entra and Okta refresh-token rotation with scope narrowing, replay-family
  invalidation, and lifecycle-driven access/refresh revocation
- An accepted SCIM 2.0 Users/Groups surface at `/scim/v2`, bounded
  Microsoft Graph reads at `/graph/v1.0`, and an Okta Users/Groups lifecycle API at
  `/api/v1`
- A synchronous `node:sqlite` test store
- Deterministic test clock and RNG, persisted deterministic scenarios, bounded request
  logs, and request assertions
- Fixture schema, loader, and runner; 38 source-reviewed Entra OIDC fixtures (30
  documented and eight implemented M6 cases that execute through the local Worker);
  22 documented Okta OIDC fixtures; and a locally and hosted-CI green 113-case
  RFC/Entra/Okta SCIM corpus
- A bounded M6 implementation for deterministic signing-key rotation/JWKS overlap,
  plus/minus token-claim clock skew, five explicit broken-token variants, and Entra
  group claims inline through 200 with a trusted same-environment Graph fallback at
  201 and a 1,000-ID response ceiling
- A bounded M6 implementation for injection-locked SCIM `409` conflict and
  soft-delete race behavior plus two case-specific malformed-PATCH tolerances; strict
  parsing remains the default and unrelated defects are not repaired
- A bounded M6 Okta Classic Authn implementation for `SUCCESS`, `MFA_REQUIRED`,
  `PASSWORD_EXPIRED`, and explicit `LOCKED_OUT`, with state retrieval/cancellation and
  one-time session capabilities. State retrieval slides the five-minute state expiry;
  session expiry stays fixed at five minutes. Each table is capped at 10,000 retained
  rows, each User at 32 rows per capability kind, oldest-expiring rows are evicted, and each
  issuance prunes at most 256 expired rows per table through schema-v5-compatible
  operational indexes
- Same-origin Classic Authn CORS that allows only `POST` with `accept` and/or
  `content-type`, never enables credentialed CORS, and rejects cross-origin requests
  with `403`; provider-shaped responses use the singular `_embedded.factor` array and
  omit `passwordChanged`. Lifecycle and SCIM password changes revoke pending state and
  session capabilities, while Authn body fields and sensitive headers are recursively
  redacted from request logs
- Cloudflare path routing and a SQLite Durable Object integration that completes hosted
  login, S256 PKCE, code redemption, refresh/lifecycle failure, directory reads, Entra
  claims, and JWKS signature verification in focused local suites
- An accepted authenticated Agents SDK MCP server whose M5 registry adds
  `run_provisioning_cycle` as tool 15
- Local actual-network official-client qualifications for MSAL Node 5.4.2 as an Entra
  confidential client and Okta Auth JS 8.0.1 as an Okta public client. Both use MCP
  for setup, observation, lifecycle, and cleanup and traverse an owned local Wrangler
  HTTPS process; each is D/I/S/X/Q evidence only
- The unpublished `@mockos/cli` 0.1.0 source command surface, including
  `lifecycle simulate`, the M5 candidate's secret-safe `provision run`, and capability
  negotiation
- A tested M5 implementation for deterministic Entra/Okta outbound SCIM planning and
  interpretation, batched Cloudflare Workflow execution, bounded/redacted HTTP
  capture, SSRF policy enforcement, and environment-scoped target credentials; the
  current local Worker, worker-kit, repository, and two-process e2e gates are green
- A local target-app example for exercising outbound SCIM sequences, plus ordered
  request assertions that count non-overlapping matches and can check response shapes
- Accepted M3 staging and production Worker deployments with exact-revision evidence,
  repeatable smoke, CI, documentation, and a repository testing skill

Management and protocol credentials are deliberately separate: MCP requires the
configured Access Key, while SCIM/Graph accept non-empty synthetic Bearer values and
the Okta API accepts a non-empty synthetic SSWS value. Those directory checks are mock
scheme/presence boundaries, not production authorization; never forward the management
key to them.

Thirty Entra and all 22 Okta OIDC fixtures remain `documented`; eight Entra M6
token/key/overage fixtures are `implemented` and execute through an authenticated local
Worker fixture runner. No OIDC fixture is `verified-live`. The 113 accepted SCIM
fixtures and the separate M6 SCIM-edge corpus record source-implemented behavior; none
is `verified-live`.
The accepted M3 and M5 records remain distinct. M5 passed its
[local full and two-process source gates](./docs/evidence/m5-local-source-qualification.md)
and [exact-pair manual deployment/hosted acceptance](./docs/evidence/m5-workers-dev-smoke.md).
That evidence does not qualify guarded promotion, standalone public Access-Key smoke,
npm publication, or live-provider parity. M6 has a separate
[sampled exact-version workers.dev acceptance](./docs/evidence/m6-workers-dev-smoke.md)
for all six bounded slices. It does not promote the generated case index or fixture
corpora to corpus-wide deployed or verified-live parity.

## Evidence levels

mockOS records designed (D), implemented (I), source-tested (S),
integration-tested (X), SDK/client-qualified (Q), hosted-smoke (H), verified-live (V),
and production-ready (P) independently. Local official-client execution can establish
X/Q without H. Hosted CI remains S; H requires an exact remote serving version and
recorded smoke. V requires sanitized, reviewed comparison with a real provider. No
current fixture or milestone is V or P. See the
[documentation index](./docs/README.md) for the exact definitions.

## Local verification

Requires Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The concrete [local curl walkthrough](./docs/quickstarts/curl.md) uses the implemented
control and protocol routes. The
[Entra MSAL Node](./docs/quickstarts/entra-msal-node.md) and
[Okta Auth JS](./docs/quickstarts/okta-auth-js-node.md) guides reproduce the two
bounded local official-client paths. Read [self-hosting](./docs/self-hosting.md) before
trying Wrangler and [known limitations](./docs/known-limitations.md) before choosing
an SDK.
The sanitized [M6 workers.dev smoke evidence](./docs/evidence/m6-workers-dev-smoke.md)
records the latest exact accepted candidate, version IDs, exercised flow, and cleanup result for
[staging](https://mockos-staging.workspaceagent.workers.dev) and
[production](https://mockos.workspaceagent.workers.dev).

## Architecture

```text
contracts <- core <- engine-http <- worker-kit <- apps/worker
                  \                  ^
                   \---- testkit     |
contracts ---------------- mcp ------+
```

The engine uses a synchronous `SqlStore` so SQLite Durable Objects and
`node:sqlite` tests can share logic. Provider profiles adapt URLs, claims, errors, and
dialects instead of forking the engine. Absolute issuer URLs must be derived per request
and never persisted.

## Documentation

Start at the [documentation index](./docs/README.md), then use
[requirements traceability](./docs/requirements-traceability.md) and the
[parity matrix](./docs/conformance/parity-matrix.md) to distinguish targets from
evidence. The [brand guide](./docs/brand.md) defines the restrained use of 🥸 and the
original vector assets.

## Contributing and security

Contributions are welcome under [CONTRIBUTING.md](./CONTRIBUTING.md). Do not use real
identities, passwords, production access tokens, or platform credentials in fixtures.
Report vulnerabilities through [SECURITY.md](./SECURITY.md).

Licensed under the Apache License 2.0.
