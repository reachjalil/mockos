# Salesforce SObject Reads built-in mock MCP blueprint

Status: Built-in deterministic source fixture qualified locally through D/I/S/X/Q; H/V/P are unqualified
Last reviewed: 2026-07-25

Use this blueprint when an agent or MCP client must discover and call a small,
repeatable Salesforce-shaped read surface without a Salesforce organization, OAuth
credential, provider network request, or REST proxy. Operators inspect and install the
blueprint through mockOS management MCP. The system under test then calls the separate
environment-hosted mock MCP endpoint.

The exact blueprint ID is:

```text
salesforce/hosted-mcp/sobject-reads
```

The canonical machine-readable definition is generated in
[`mock-mcp-blueprints.v1.json`](../reference/mock-mcp-blueprints.v1.json). The
executable source is
[`packages/core/src/mock-mcp/blueprints.ts`](../../packages/core/src/mock-mcp/blueprints.ts).

## What this models

The blueprint is documentation-derived from Salesforce's
[SObject Reads reference](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html)
as reviewed on 2026-07-25. That reference identifies the upstream server as
`platform/sobject-reads`, describes it as read-only, and documents the six tool names
and their inputs. Salesforce's
[general best practices](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/general-best-practices.html)
also explain the hosted service's authentication, authorization, field-level security,
object access, sharing, and observability boundary.

mockOS models only the documented tool names, required/optional input fields, and a
small set of deterministic synthetic `.test` fixtures. It does not:

- connect to a Salesforce organization or any provider network;
- implement a Salesforce REST adapter, SOQL parser, or SOSL parser;
- perform Salesforce OAuth, authorization, field-level security, object-access,
  sharing, or hosted observability checks;
- claim exact Salesforce output-wire parity, error parity, record coverage, or live
  provider behavior; or
- send the management Access Key or another credential to the mock data plane.

The source definition uses `authentication: { "mode": "none" }`. No Salesforce token,
Mock Credential, client secret, or hidden verifier is accepted or persisted by the
three blueprint management tools.

## Discover before installing

The current management registry contains 27 tools. These three are MCP-only and add no
self-hosted HTTP route:

| Tool | Purpose | Scope metadata | Effect |
| --- | --- | --- | --- |
| `list_mock_mcp_blueprints` | List safe, versioned summaries and provenance | `env:ro` | read |
| `get_mock_mcp_blueprint` | Return the complete secret-free server definition | `env:ro` | read |
| `install_mock_mcp_blueprint` | Create or CAS-replace one environment-local server | `env:rw` | destructive |

Call `list_mock_mcp_blueprints` with `{}`. Confirm that the returned entry has:

- `id: "salesforce/hosted-mcp/sobject-reads"`;
- `blueprintVersion: 1`;
- `defaultSlug: "salesforce-sobject-reads"`;
- `credentialMode: "none"`;
- `provenance.kind: "documentation-derived"`;
- `fidelity.behavior: "deterministic-synthetic"`;
- `fidelity.providerNetwork: false`; and
- `fidelity.outputWireParity: "unqualified"`.

Then call `get_mock_mcp_blueprint`:

```json
{
  "blueprintId": "salesforce/hosted-mcp/sobject-reads"
}
```

An unknown but well-formed ID returns
`404 MOCK_MCP_BLUEPRINT_NOT_FOUND`. Catalog discovery proves what this source or
connected server advertises; it does not prove deployment, Cloud pinning, or provider
parity.

## Install with explicit revision intent

For a new default slug, call:

```json
{
  "environmentId": "test-env_01",
  "blueprintId": "salesforce/hosted-mcp/sobject-reads",
  "expectedRevision": null
}
```

To select another valid environment-local slug, add for example:

```json
{
  "slug": "salesforce-reader"
}
```

`install_mock_mcp_blueprint` returns
`{ schemaVersion, blueprintId, blueprintVersion, server }`. The handler validates the
complete returned public server specification against the selected blueprint and slug;
matching only authentication or slug is insufficient. A mismatched dependency result
fails closed.

Installation uses the same compare-and-swap repository operation as
`put_mock_mcp_server`:

1. Use `expectedRevision: null` only for create intent.
2. Use the current positive revision for a changed replacement.
3. A canonical replay of the same installed definition converges before CAS and returns
   the current record without changing timestamps, revision, application state, or
   sessions. This includes an identical delete/recreate generation.
4. A changed definition with a stale or changed-definition ABA expectation returns
   `409 MOCK_MCP_SERVER_REVISION_CONFLICT`.

Both a changed direct put and a changed blueprint install are destructive operations.
They allocate a new revision, delete the previous revision's application state, and
terminate its revision-bound sessions. Read the current server, reconcile the desired
definition, and use its exact revision; never increment or overwrite a revision
blindly.

## Connect the system under test

Use the installed server's actual slug in one of the environment routes:

```text
/e/{environmentId}/mcp-mock/{slug}
https://{environmentId}.{baseDomain}/mcp-mock/{slug}
```

The blueprint is stateless and requires no Authorization header. Do not send the
management Access Key. The current source qualification uses the official
`@modelcontextprotocol/sdk` client at version `1.29.0` against the mounted Worker Fetch
seam; it is not actual-network qualification.

Call `tools/list` and require exactly these six tools in this order:

| Tool | Strict input | Supported deterministic fixture |
| --- | --- | --- |
| `getObjectSchema` | optional `object-name` string; no other fields | Index mode with `{}`; Detail mode with `{ "object-name": "Account" }` |
| `soqlQuery` | required `query` string | `SELECT Id, Name, Industry FROM Account WHERE Name = 'Acme Test Industries' LIMIT 1` |
| `find` | required `search` string | `FIND {Acme Test} IN NAME FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)` |
| `getUserInfo` | `{}` only | one synthetic user and organization |
| `listRecentSobjectRecords` | required `sobject-name` string | `{ "sobject-name": "Account" }` |
| `getRelatedRecords` | required `sobject-name`, `id`, and `relationship-path` strings | Account `001MockOS0000001` and relationship `Contacts` |

All input objects reject unknown fields. `getObjectSchema` has two deliberately
distinct modes:

- **Index mode:** omit `object-name`; the result contains a compact `objects` list and
  no field detail.
- **Detail mode:** pass `{ "object-name": "Account" }`; the result contains the
  synthetic Account `fields` list.

Another schema name, query, search, object, record ID, or relationship can satisfy the
input schema but has no configured fixture. It returns a deterministic MCP tool result
with `isError: true`; mockOS does not guess, parse, or contact Salesforce.

Every supported fixture returns both a JSON text content block and an object
`structuredContent` wrapper with a `fixtureSource` under
`https://salesforce.mockos.test/`. The local wrappers include keys such as `objects`,
`object`, `records`, `searchRecords`, or user fields. The blueprint deliberately does
not declare an output schema because the reviewed provider page describes outputs
semantically rather than publishing an exact MCP output wire contract. These wrappers
are mockOS fixture shapes, not Salesforce output-wire parity.

Each tool advertises `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, and `openWorldHint: false`. The first two values align with the
reviewed read-only provider guidance. The closed-world and deterministic idempotency
values describe this local fixture. MCP annotations are hints, not enforcement.

## Observe, assert, and clean up

Use management MCP `get_request_log` or `assert_requests` with
`provider: "mcp"`, `protocol: "mcp"`, `mcpMethod: "tools/call"`, and the exact
`mcpTool`. The mounted source integration qualifies installation, discovery, all six
successful calls, one unsupported fixture, observation, assertion, reset, and delete.

For cleanup:

1. call `get_mock_mcp_server` for each installed slug;
2. retain its current positive revision; and
3. call `delete_mock_mcp_server` with that slug and `expectedRevision`.

Delete removes the definition, application state, and sessions. A repeated delete
returns `404 MOCK_MCP_SERVER_NOT_FOUND`; it does not replay success.

## Evidence and product boundary

For this exact local tranche:

- **D/I/S/X/Q:** yes for the reviewed contract, executable catalog and fixture,
  focused source tests, mounted management-to-data-plane Worker integration, and pinned
  official MCP SDK `1.29.0` client flow.
- **H/V/P:** no. There is no hosted smoke for this revision, no private Cloud pin, no
  deployed acceptance, no live Salesforce organization comparison, and no production
  readiness claim.

Q means MCP client interoperability for the named mounted flow. It does not mean
Salesforce SDK qualification, live-provider fidelity, or output parity. The official
documentation link is provenance for design; it is not V evidence.

This built-in entry is a versioned, secret-free mock MCP server-definition preset. It
is not the F5 portable blueprint system: environment export/import/apply, validation
CLI commands, scripts, sharing, and the hosted gallery remain future work. Do not
invent `blueprint validate`, `blueprint export`, or `blueprint apply` commands from
this catalog.

Salesforce is a trademark of Salesforce, Inc. Names are used only for compatibility
identification. mockOS is independent and is not affiliated with, sponsored by, or
endorsed by Salesforce, Inc.
