<p align="center">
  <img src="./assets/brand/mockos-mark.svg" width="112" alt="">
</p>

<h1 align="center"><span aria-hidden="true">🥸</span> mockOS</h1>

<p align="center"><strong>Mock identity infrastructure for integration tests.</strong></p>

<p align="center">Deterministic Entra ID and Okta protocol surfaces for testing real integrations.</p>

> **Project status:** the M0 substrate and narrow M1 Entra authorization-code slice
> are implemented and tested locally. No hosted mockOS service, stable npm release,
> broad provider-parity claim, or live deployment is available yet. See the
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
- Runtime-independent contracts, migrations, directory/application repositories, and
  Entra OIDC core
- A synchronous `node:sqlite` test store
- Deterministic test clock and RNG
- Fixture schema, loader, runner, and 30 source-reviewed Entra OIDC fixtures
- Cloudflare path routing and a SQLite Durable Object integration that completes hosted
  login, S256 PKCE, code redemption, Entra claims, and JWKS signature verification
- Documentation, CI, and a repository testing skill

Every initial Entra fixture is marked `documented`, not `implemented` or
`verified-live`.

## Local verification

Requires Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The concrete [local curl walkthrough](./docs/quickstarts/curl.md) uses the implemented
control and protocol routes. Read [self-hosting](./docs/self-hosting.md) before trying
Wrangler and [known limitations](./docs/known-limitations.md) before choosing an SDK.
No workers.dev deployment is claimed.

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
