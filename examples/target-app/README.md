# Target application example

Status: implemented (M5 local application-under-test)
Last reviewed: 2026-07-22

This disposable Hono Worker is the SCIM target used by mockOS outbound-
provisioning end-to-end tests. A singleton Durable Object owns its bounded users,
groups, and request captures, so a deployed smoke run remains deterministic even
when Worker isolates change. It is a test harness, not a production SCIM server.
The repository's fresh two-process `pnpm e2e:provisioning` result is recorded in the
[M5 local source evidence](../../docs/evidence/m5-local-source-qualification.md); no
hosted or deployed target-app result is claimed there.

## Run it

From the repository root:

```bash
pnpm --filter @mockos/target-app dev
```

The Worker listens on `http://127.0.0.1:8792`. Its local-only credentials are
declared only in `wrangler.local.jsonc`:

- SCIM base URL: `http://127.0.0.1:8792/scim/v2`
- SCIM bearer token: `target-app-scim-token`
- harness header: `x-target-control-token: target-app-control-token`

These values are intentionally public local fixtures. The deployable
`wrangler.jsonc` contains no credential values and requires
`TARGET_SCIM_TOKEN` and `TARGET_CONTROL_TOKEN` as Worker secrets. Generate fresh
values for every remote smoke deployment and remove the disposable Worker after
the run. Never reuse the local values remotely or in a real application.

The SCIM bearer token is an in-environment **Mock Credential**: it imitates the
protocol credential that a real provisioning client would send to an
application. It is not a mockOS platform **Access Key** (`mk_…`) and cannot call
the mockOS control API or MCP server. The separate harness token only protects
the local reset/snapshot endpoints from accidental requests.
Self-hosted Access Keys need not start with `mk_`, so the target credential must also
be distinct from the exact configured mockOS `API_KEY`. The CLI and runtime reject an
exact collision, including one caused by later key rotation, before outbound use.

Check readiness before an end-to-end run:

```bash
curl --fail http://127.0.0.1:8792/health
```

Reset all users, groups, request captures, deterministic IDs, and the logical
clock before each run:

```bash
curl --fail --request POST \
  --header 'x-target-control-token: target-app-control-token' \
  http://127.0.0.1:8792/__test/reset
```

After mockOS runs a provisioning cycle, inspect the exact ordered requests:

```bash
curl --fail \
  --header 'x-target-control-token: target-app-control-token' \
  http://127.0.0.1:8792/__test/requests
```

`/__test/state` returns the resulting users and groups. Captures contain only
stable fields: a one-based sequence number, method, path, sorted query values,
selected headers, parsed request body, and response status. Bearer values are
always replaced with `<redacted>`. Authentication happens before body capture;
request bodies and the capture ring are explicitly bounded.

## Supported SCIM surface

- Bearer authentication and RFC 7644-style error documents
- `ServiceProviderConfig` and `ResourceTypes` discovery
- filtered `Users` and `Groups` lists
- create, read, replace, patch, and delete for users and groups
- deterministic IDs (`usr-0001`, `grp-0001`) and logical timestamps
- ETags, `If-Match`, uniqueness conflicts, and common provisioning PATCH paths

The example is intentionally a minimal receiving system. Provider fidelity lives
in mockOS; this target exists to prove what mockOS sent and what state resulted.
