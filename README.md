<p align="center">
  <img src="./assets/brand/mockos-mark.svg" width="112" alt="">
</p>

<h1 align="center"><span aria-hidden="true">🥸</span> mockOS</h1>

<p align="center"><strong>Mock identity infrastructure for integration tests.</strong></p>

<p align="center">Deterministic Entra ID and Okta protocol surfaces for testing real integrations.</p>

> **Project status:** M0 through M2 passed the local, hosted-CI, and deployed acceptance
> gates recorded in the evidence ledger. M3 now has focused local evidence for its
> Worker integration, lifecycle cascades, provider directory APIs, refresh-token
> rotation, and all 113 SCIM fixtures. The full local M3 `pnpm check` is green;
> hosted CI, deployed smoke, and live-provider parity are still pending. The live
> workers.dev targets remain M2 qualification surfaces.
> This is not yet a stable npm release, a broad provider-parity claim, or a
> production-SLA service. See the
> [evidence ledger](./docs/IMPLEMENTATION_STATUS.md).

mockOS is an Apache-2.0 open-core project for testing OIDC/OAuth 2.0, SCIM 2.0,
directory lifecycle, RBAC, and failure handling without depending on a real enterprise
tenant. Provider expectations live as source-attributed fixtures; deterministic clock,
randomness, and SQLite seams make failures reproducible.

The target deployment is Cloudflare-forward: Workers, SQLite Durable Objects,
Workflows, Queues, KV, and an Agents SDK MCP server. The public repository contains the
portable engine and a self-hostable Worker. A separate private repository will contain
the hosted control plane, authentication, billing, and console; private code may depend
on public packages, never the reverse.

## What exists now

- Workspace and package scaffolding
- Runtime-independent contracts, append-only migrations, versioned User/Group and
  application repositories, SCIM filter/PATCH behavior, and provider lifecycle policy
- An Okta OIDC profile covering discovery, hosted authorization code + S256 PKCE,
  refresh exchange, token introspection and revocation, and RFC 8628 device
  authorization in local tests
- Entra and Okta refresh-token rotation with scope narrowing, replay-family
  invalidation, and lifecycle-driven access/refresh revocation
- A locally exercised SCIM 2.0 Users/Groups source candidate at `/scim/v2`, bounded
  Microsoft Graph reads at `/graph/v1.0`, and an Okta Users/Groups lifecycle API at
  `/api/v1`
- A synchronous `node:sqlite` test store
- Deterministic test clock and RNG, persisted deterministic scenarios, bounded request
  logs, and request assertions
- Fixture schema, loader, runner, 30 source-reviewed Entra OIDC fixtures, and 22
  source-reviewed Okta OIDC fixtures, plus a locally green 113-case RFC/Entra/Okta
  SCIM corpus
- Cloudflare path routing and a SQLite Durable Object integration that completes hosted
  login, S256 PKCE, code redemption, refresh/lifecycle failure, directory reads, Entra
  claims, and JWKS signature verification in focused local suites
- An authenticated Agents SDK MCP server with 14 typed management tools, including
  `simulate_lifecycle`
- The unpublished `@mockos/cli` 0.1.0 source command surface, including
  `lifecycle simulate` and capability negotiation
- Historical M2 staging and production Worker deployments with a repeatable acceptance
  smoke, deployment workflow, documentation, CI, and a repository testing skill

Management and protocol credentials are deliberately separate: MCP requires the
configured Access Key, while SCIM/Graph accept non-empty synthetic Bearer values and
the Okta API accepts a non-empty synthetic SSWS value. Those directory checks are mock
scheme/presence boundaries, not production authorization; never forward the management
key to them.

Every OIDC provider fixture is marked `documented`, not `implemented` or
`verified-live`; all 113 SCIM fixtures separately record locally executed
source-candidate behavior. Local runtime tests and the historical M2 deployed smoke
remain distinct evidence.

## Local verification

Requires Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The concrete [local curl walkthrough](./docs/quickstarts/curl.md) uses the implemented
control and protocol routes. Read [self-hosting](./docs/self-hosting.md) before trying
Wrangler and [known limitations](./docs/known-limitations.md) before choosing an SDK.
The sanitized [M2 workers.dev smoke evidence](./docs/evidence/m2-workers-dev-smoke.md)
records the deployed candidate, version IDs, exercised flow, and cleanup result for
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
