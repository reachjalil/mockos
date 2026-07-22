# MCP interface

Status: M2 authenticated management MCP implemented and workers.dev-smoke-tested
Last reviewed: 2026-07-22

mockOS exposes an authenticated management server at `/mcp`. The M2 Worker uses
Streamable HTTP through a Cloudflare Agents SDK `McpAgent`; the CLI uses the official
MCP TypeScript client. Automated integration tests cover `initialize`, `tools/list`,
authenticated `tools/call`, session-local environment selection, and cleanup.

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

M2 is deliberately POST-only Streamable HTTP. `POST /mcp` carries initialization,
notifications, and requests. `GET /mcp` returns `405` with
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

## Exact M2 tool registry

The server exposes these 13 tools—no provisioning or lifecycle tools are mounted in
M2:

| Tool | Implemented behavior |
| --- | --- |
| `create_environment` | Create an isolated Entra ID or Okta environment and select it for this session |
| `list_environments` | List account environments and the session's selected ID |
| `delete_environment` | Purge one named or selected environment and clear the cursor when applicable |
| `configure_environment` | Update name, idle TTL, or request-log row limit |
| `seed_identities` | Create synthetic users and groups, including named group membership |
| `create_application` | Register an OIDC/OAuth client and return its synthetic client credentials |
| `mint_token` | Mint an ID-token-shaped bearer JWT for a seeded subject, optionally broken |
| `set_scenario` | Create or completely replace a deterministic injected behavior by scenario ID |
| `clear_scenario` | Clear one scenario or all scenarios in an environment |
| `get_request_log` | Return a filtered, newest-first page of captured request entries |
| `assert_requests` | Count exact request matches and return matching request IDs |
| `get_wellknown_urls` | Derive provider URLs from the active public origin and environment |
| `set_current_environment` | Set or clear the transport session's environment cursor |

Successful calls return both text content and structured content shaped as an envelope
with `data` and `meta.requestId`. Failures after handler entry are normalized to an MCP
error result containing a problem document. SDK schema-validation failures occur before
handler entry and return the SDK's generic input-validation error instead. A returned
`scimBaseUrl` is reserved endpoint metadata; it does not claim that SCIM is implemented.

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
| `http.request` | Any other routed environment request |
| `*` | Catch-all considered after an exact match |

Actions are a bounded delay of at most 30 seconds, a provider-rendered semantic error,
or a shallow JSON-object mutation. Mutation is restricted to
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, and
`oauth.introspect`; selecting mutation for another point fails instead of attempting to
rewrite HTML, redirects, or empty bodies. Scenario specifications and mutation patches
are bounded to 64 KiB when serialized.

## Request logs and assertions

The M2 Worker records inbound environment protocol requests after routing. Entries
include method, exact public path, selected request/response headers and bounded bodies,
status, duration, provider, timestamp, correlation ID, and request ID. Pagination is
newest-first and cursor-bound to its filters. The row ring and byte budget are bounded;
capturing a log is fail-open for protocol availability.

`get_request_log` filters by `source`, `provider`, normalized method, exact path, and
exact status. `assert_requests` supports only:

- exact `source`, method, path, and status matching (method is normalized to uppercase),
- a case-sensitive literal `bodyIncludes` substring of the stored **request** body, and
- `count.atLeast`, `count.atMost`, or `count.exactly` constraints.

It does not currently assert headers, response-body subsets, ordering, or regular
expressions. Use synthetic identities and tokens: captured protocol bodies can contain
test credentials or tokens even though management API keys are redacted.

## Evidence

The [M2 workers.dev smoke record](./evidence/m2-workers-dev-smoke.md) covers health,
authenticated MCP initialization and tool discovery, environment creation, identity and
application seeding, discovery, hosted Entra PKCE login, token/JWKS verification, a
one-shot MFA-required scenario, request-log query/assertion, scenario clearing, and
environment cleanup against staging and production Worker targets. This proves the
deployed mockOS loop, not parity with a live Entra or Okta provider.
