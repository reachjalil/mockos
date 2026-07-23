# F0 contract, client, and wrapper foundation

Status: Source-complete locally; hosted CI and merge pending
Last reviewed: 2026-07-23

F0 establishes checked seams for the F-series without enabling an experimental
runtime. The source candidate passes the complete local `pnpm check` gate. It has no
hosted-CI, merge, deployment, publication, Worker Loader, or paid-account evidence.

## One-source flow

The canonical management registry is
[`packages/contracts/src/operations/management.ts`](../../packages/contracts/src/operations/management.ts).
It owns operation IDs, descriptions, MCP schemas and annotations, required scopes,
effect/retry/secret metadata, and optional HTTP metadata.

```text
management operation registry
├── @mockos/mcp registration metadata
├── Worker paths and HTTP request schemas (five live routes only)
├── OpenAPI 3.0 document
├── @mockos/client generated authorization map and typed requests
└── human and machine management-reference artifacts
```

MCP session conveniences stay inside the MCP adapter. In particular,
`set_current_environment` is MCP-only, and HTTP operations require an explicit
`environmentId`. The MCP `get_wellknown_urls` tool returns mockOS endpoint summaries,
while the existing HTTP route is modeled separately as
`get_environment_discovery` because its live wire response is an OIDC discovery
document. Do not add an HTTP operation to the registry until its real handler and
authorization boundary exist.

The generated products are:

- [`packages/openapi/openapi/mockos-management.v1.json`](../../packages/openapi/openapi/mockos-management.v1.json);
- [`packages/client/src/generated.ts`](../../packages/client/src/generated.ts);
- [`docs/reference/management-operations.v1.json`](../reference/management-operations.v1.json);
- [`docs/reference/management-tools.md`](../reference/management-tools.md);
- [`docs/reference/self-hosted-http.md`](../reference/self-hosted-http.md); and
- the compact [`llms.txt`](../../llms.txt) plus curated
  [`llms-full.txt`](../../llms-full.txt) agent indexes.

Run `pnpm f0:generate` after an intentional registry change. `pnpm f0:drift:check`
performs a byte-for-byte comparison and is part of local and hosted CI gates.

## Package boundaries

| Package | F0 responsibility | Explicitly not yet claimed |
| --- | --- | --- |
| `@mockos/contracts/behavior` | Version-one `static`, `template`, `sequence`, `match`, `error`, and `script` schemas with seeded latency | Evaluator, template semantics, sequence storage, proxy, or script execution |
| `@mockos/contracts/operations` | Exhaustive metadata for all 15 existing MCP operations and HTTP metadata for five live routes | HTTP availability for MCP-only operations or enforced scoped Access Keys |
| `@mockos/openapi` | Deterministic OpenAPI, client-manifest, and management-documentation catalog generation | A deployed public API catalog |
| `@mockos/client` | Fetch injection, relative known paths, constructor-owned auth, Zod validation, abort/timeout handling, and typed problems | CLI migration, automatic retries, npm publication, or unsupported HTTP operations |
| `@mockos/codemode` | Explicit-enable wrapper around the exact experimental package | Worker wiring, `LOADER`, executor qualification, audit, or quotas |
| `@mockos/sandbox` | Provider contract and fail-closed `NoSandbox` | Worker Loader or Node VM implementation |

The client and wrappers remain private workspace packages until their separate
distribution/runtime qualifications pass. A successful TypeScript build is not an npm
release claim.

## Fail-closed rules

- Missing F-series flags mean false.
- The normal Worker and `worker-kit` cannot import `@mockos/codemode` or
  `@mockos/sandbox` during F0.
- Worker configuration cannot contain `LOADER`, `worker_loaders`, or experimental
  enable flags during F0.
- The Code Mode wrapper cannot call the upstream factory unless `enabled: true` is
  passed literally.
- `NoSandbox` cannot inspect or evaluate source/input and always rejects invocation.
- Generated requests cannot select an origin or supply an authorization header.
- `env:ro` and `env:rw` are metadata until F4 implements the shared authorization
  decision; do not market them as enforcement.

`pnpm f0:guards:check` verifies the exact dependency baseline and the disabled runtime
boundary. Upgrading `@cloudflare/codemode`, `agents`, the MCP SDK, or Wrangler requires
wrapper tests and a recorded canary before changing these pins.

## Extension checklist

When adding a management operation:

1. Add or reuse the authoritative Zod request and response schemas.
2. Add one operation registry entry and preserve explicit environment semantics.
3. Add HTTP metadata only when a real route exists.
4. Run `pnpm f0:generate`.
5. Review the generated human and machine references for accurate secret, retry,
   effect, and HTTP-availability labels.
6. Add focused contract, adapter, client, documentation, and security-boundary tests.
7. Run `pnpm f0:drift:check`, `pnpm f0:guards:check`, then the full `pnpm check`.
8. Update the evidence ledger without inheriting hosted, deployed, verified-live, or
   publication evidence.
