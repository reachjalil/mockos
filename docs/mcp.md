# MCP interface

Status: M5 authenticated management MCP source candidate; deployed evidence is tracked by exact revision
Last reviewed: 2026-07-22

mockOS exposes an authenticated management server at `/mcp`. The Worker uses
Streamable HTTP through a Cloudflare Agents SDK `McpAgent`; the CLI uses the official
MCP TypeScript client. Automated integration tests cover `initialize`, `tools/list`,
authenticated `tools/call`, session-local environment selection, lifecycle cascades,
outbound provisioning startup, and cleanup. The 15-tool M5 registry is a source-
candidate claim until the exact-revision CI and deployment records accept it. Its
Worker suite, full repository gate, and two-process target-app e2e are green locally.

## Authentication fails closed

Self-hosted MCP access requires the Worker `API_KEY` secret. There is no implicit public
mode:

- a missing or blank configured secret returns `503 CONTROL_API_UNAVAILABLE`, and
- a missing or incorrect presented key returns `401 UNAUTHORIZED` with a Bearer
  challenge.

Pass the key as `Authorization: Bearer <key>`; `X-API-Key` is also accepted for direct
clients. The outer Worker compares the configured key before dispatching to the Agent
and removes management credentials from the forwarded request. Do not place the key in
URLs, fixtures, logs, or reports.

## Transport and session behavior

The current source is deliberately POST-only Streamable HTTP. `POST /mcp` carries
initialization, notifications, and requests. `GET /mcp` returns `405` with
`Allow: POST, DELETE, OPTIONS`, which declares the optional standalone server-sent
event stream unsupported. A standards-compliant client falls back to POST-only
operation, and the CLI keeps each response attached to its originating POST.

Initialization issues an `Mcp-Session-Id`. Later requests present that ID, and closing
the CLI transport sends authenticated `DELETE /mcp` to terminate the server session.
The integration suite negotiates protocol revision `2025-11-25`; no broader revision
matrix is claimed here.

Each transport session owns a `currentEnvironmentId` cursor. Creating an environment
selects it, `set_current_environment` changes or clears it, and deleting the selected
environment clears it. Most tools accept an explicit `environmentId` and otherwise
resolve the session cursor. Prefer the explicit ID in saved automation because the
cursor does not cross sessions.

## Exact M5 source-candidate tool registry

The source candidate exposes these 15 tools:

| Tool | Implemented behavior |
| --- | --- |
| `create_environment` | Create an isolated Entra ID or Okta environment and select it for this session |
| `list_environments` | List account environments and the session's selected ID |
| `delete_environment` | Purge one named or selected environment and clear the cursor when applicable |
| `configure_environment` | Update name, idle TTL, or request-log row limit |
| `seed_identities` | Create synthetic users and groups, including named group membership |
| `create_application` | Register an OIDC/OAuth client and return its synthetic client credentials |
| `run_provisioning_cycle` | Queue a deterministic outbound SCIM cycle against a saved or inline validated test target |
| `mint_token` | Mint an ID-token-shaped bearer JWT for a seeded subject, optionally broken |
| `set_scenario` | Create or completely replace a deterministic injected behavior by scenario ID |
| `clear_scenario` | Clear one scenario or all scenarios in an environment |
| `get_request_log` | Return a filtered, newest-first page of captured request entries |
| `assert_requests` | Count exact request matches and return matching request IDs |
| `simulate_lifecycle` | Apply a provider- and state-valid User lifecycle action and report state/version/ETag plus effective token revocations |
| `get_wellknown_urls` | Derive provider URLs from the active public origin and environment |
| `set_current_environment` | Set or clear the transport session's environment cursor |

Successful calls return both text content and structured content shaped as an envelope
with `data` and `meta.requestId`. Failures after handler entry are normalized to an MCP
error result containing a problem document. SDK schema-validation failures occur before
handler entry and return the SDK's generic input-validation error instead.

## Returned protocol URLs and mock authentication

`get_wellknown_urls` returns request-derived OIDC/OAuth URLs and `scimBaseUrl`. Entra
environments also return `graphBaseUrl`; Okta environments return `oktaApiBaseUrl`.
Never construct or persist an absolute issuer from an old host.

These are deliberately separate trust boundaries:

- `/mcp` requires the configured management Access Key.
- `/scim/v2` requires a non-empty synthetic `Authorization: Bearer ...` credential.
- Entra `/graph/v1.0` requires a non-empty synthetic Bearer credential.
- Okta `/api/v1` requires a non-empty synthetic `Authorization: SSWS ...` credential.

The three directory credentials check the expected scheme and presence for protocol
testing; they do not validate a real provider token and are not production
authorization. Never reuse or forward the MCP Access Key as a directory credential.
The SCIM source candidate provides ServiceProviderConfig, ResourceTypes, Schemas, and
versioned Users/Groups CRUD, filter, pagination, ETag, and PATCH behavior. Graph is a
bounded read surface for Users, Groups, and direct memberships. The Okta API covers
the tested Users/Groups CRUD, direct membership, and lifecycle routes; Classic
`/api/v1/authn` is not implemented.

## Lifecycle and refresh-token families

Lifecycle actions are provider- and state-specific. Entra supports `activate`,
`disable`, `reactivate`, and `delete`; Okta supports `activate`, `reactivate`,
`suspend`, `unsuspend`, `deprovision`, and `delete`, with deletion requiring a
deprovisioned User. Invalid transitions fail closed.

Disabling, suspending, deprovisioning, or deleting a User revokes effective access and
refresh tokens in the same transaction as the state change. Refresh grants authenticate
the client, reject scope escalation, rotate the token within its family, preserve the
original authentication time and absolute family expiry, and detect replay. Replaying
or concurrently redeeming an already consumed token invalidates its refresh family and
associated access tokens. A known token belonging to a newly disabled User returns the
provider-shaped disabled-account error: Entra `invalid_grant` with `AADSTS50057`, or
Okta `invalid_grant` with `The resource owner account is disabled.`

## Token minting

`mint_token` requires `clientId` and `subject`; `subject` may be a seeded user ID or
user name. `audience` optionally overrides the audience. The supported `broken`
variants are exactly:

- `expired`
- `wrong_audience`
- `not_yet_valid`
- `bad_signature`
- `wrong_issuer`

Use minted tokens only as synthetic application-test inputs. A broken token is a
purposeful negative-case artifact, not a complete simulation of a provider token
endpoint.

## Deterministic scenarios

A scenario has an ID, injection point, action, probability, optional remaining-fire
count, and enabled flag. Evaluation uses the environment seed, scenario ID, and durable
evaluation count, so the same stored state produces a reproducible sequence. Exact
injection points take priority over the literal `*` catch-all.

Routed Worker requests map to these injection points:

| Injection point | Routed surface |
| --- | --- |
| `oidc.discovery` | OIDC discovery |
| `oidc.jwks` | JWKS |
| `oauth.authorize` | Authorization endpoint |
| `oauth.token` | Token endpoint |
| `oauth.device` | Device authorization endpoint |
| `oauth.device.activate` | Hosted device activation |
| `oauth.introspect` | Introspection endpoint |
| `oauth.revoke` | Revocation endpoint |
| `scim.request` | SCIM discovery and Users/Groups requests |
| `graph.request` | Microsoft Graph directory requests |
| `okta.api` | Okta Users/Groups and lifecycle API requests |
| `http.request` | Any other routed environment request |
| `*` | Catch-all considered after an exact match |

Actions are a bounded delay of at most 30 seconds, a provider-rendered semantic error,
or a shallow JSON-object mutation. Mutation is restricted to
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, and
`oauth.introspect`; selecting mutation for another point fails instead of attempting to
rewrite HTML, redirects, or empty bodies. Scenario specifications and mutation patches
are bounded to 64 KiB when serialized.

## Request logs and assertions

The Worker records inbound environment protocol requests after routing. Entries
include method, exact public path, selected request/response headers and bounded bodies,
status, duration, provider, timestamp, correlation ID, and request ID. Pagination is
newest-first and cursor-bound to its filters. The row ring and byte budget are bounded;
capturing a log is fail-open for protocol availability.

`get_request_log` filters by `source`, `provider`, normalized method, exact path, and
exact status. `assert_requests` supports:

- exact `source`, method, path, and status matching (method is normalized to uppercase),
- case-sensitive literal `bodyIncludes` and `responseBodyIncludes` substrings of the
  stored request and response bodies,
- an optional two-to-100-step ordered `sequence`; top-level filters constrain every
  step, unrelated requests may appear between steps, and complete non-overlapping
  sequences are counted in append order, and
- `count.atLeast`, `count.atMost`, or `count.exactly` constraints.

It does not currently assert headers, parsed JSON/JSONPath, or regular expressions.
Use synthetic identities and tokens: captured protocol bodies can contain test
credentials or tokens even though management API keys and outbound target Bearer
values are redacted.

## Outbound provisioning

`run_provisioning_cycle` requires an application `id`, `full` or `incremental` mode,
and either a saved target reference or an inline target. An inline target contains a
reference, base SCIM URL, optional synthetic Bearer credential, and optional provider
behavior flags. Setting `save: true` retains it inside the environment; otherwise its
credential is scoped to that run. The raw token is ingress-only and never appears in a
run record, Workflow parameter, MCP result, or request log. Platform `mk_` Access Keys
and the exact active configured self-host Access Key are rejected as target credentials.
The runtime repeats that exact comparison at the Environment Durable Object boundary,
so a later `API_KEY` rotation that collides with a saved target fails before an
outbound request.

The result is the queued run record. Execution is asynchronous: resolving and
revalidating the target, snapshotting the environment directory, planning deterministic
User-before-Group operations, executing them, interpreting explicit 429 waits/retries,
updating the watermark, and summarizing happen in `ProvisioningWorkflow`. Use bounded
polling of `get_request_log` and `assert_requests` for completion evidence. There is no
claim that a queued result means every target operation has completed.

Every target is checked at acceptance and again per fetch. HTTPS, private-address and
special-host denial, own-host denial, redirect errors, timeout, body limits, scoped
headers, and credential redaction are described in
[outbound provisioning security](./security/outbound-provisioning.md). The public
self-hosted Worker performs this loop without a private service dependency. The hosted
composition adds tenant-bound strong quota reservation before Workflow creation.

Start reconciliation is fixed-ID and secret-safe while the exact run remains active.
It is not request-level idempotency after terminal completion: M5 accepts no caller
idempotency key, so a later call is a new cycle and may provision and consume quota
again. Retain returned run IDs and do not blindly replay a whole cycle after an
ambiguous terminal outcome; terminal response replay is deferred to F4.

## Evidence

The evidence ledger links immutable public and hosted candidates to their CI and
workers.dev smoke records. Treat the newest listed deployment record as authoritative;
the [M5 local source record](./evidence/m5-local-source-qualification.md) establishes
only the local source gate and two-process flow. It does not establish that a
connected endpoint contains the M5 registry or Workflow. Deployed provisioning
qualification must include an actual public-HTTPS target, ordered outbound assertion,
terminal Workflow state, credential-safe evidence, and cleanup. None of these source
or deployed tests constitute comparison with a live Entra tenant or Okta organization.
