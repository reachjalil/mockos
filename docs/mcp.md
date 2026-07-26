# Management MCP interface

Status: M5 authenticated management MCP accepted; bounded M6 paths sampled on exact
deployed versions; 23-tool F1 locally qualified; 27-tool F2 source registry with
separate partial OpenAI/Anthropic data planes; MSAL and Okta Auth JS local
official-client management qualified
Last reviewed: 2026-07-26

mockOS exposes an authenticated management server at `/mcp`. The Worker uses
Streamable HTTP through a Cloudflare Agents SDK `McpAgent`; the CLI uses the official
MCP TypeScript client. Automated integration tests cover `initialize`, `tools/list`,
authenticated `tools/call`, session-local environment selection, lifecycle cascades,
outbound provisioning startup, and cleanup. The 15-tool M5 registry is accepted for
the exact tested slice: public revision
`ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed the full local gate, hosted CI,
and source-paired manual controlled-target acceptance. That remote acceptance started
the provisioning tool; it did not re-exercise every tool or qualify npm distribution.
Separate local official-client candidates use the same MCP registry for environment
creation, seeding, application registration, URL discovery, request observation,
lifecycle, and cleanup. Those local results do not add hosted evidence.

The current source appends eight F1 and four F2 management tools without changing that
historical acceptance claim. Management MCP controls mockOS; it is not a simulated
MCP workload.
Environment-hosted mock MCP servers are separate dependencies for an agent under
test. See the [interface model](./concepts/interface-model.md), begin identity
workflows with the [MCP-first quickstart](./getting-started/mcp-first.md), and use the
[mock MCP guide](./mock-mcp.md) for F1 and the
[Salesforce SObject Reads blueprint guide](./blueprints/salesforce-sobject-reads.md)
for the first built-in preset. Use the
[mock LLM guide](./mock-llm.md) for the F2 MCP definition contract and separate
OpenAI/Anthropic provider data planes.

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

## Exact current tool registry

The current source exposes 27 tools: the accepted 15-tool M5 set, eight F1 operations
for creating/replacing, listing, reading, deleting, and resetting environment-hosted
mock MCP servers plus listing, reading, and installing built-in blueprints, and four
F2 operations for creating/replacing, listing, reading, and deleting mock-LLM
definitions. Their IDs, descriptions, input/output JSON Schemas, MCP annotations,
effects, retry policies, secret policies, and exact HTTP availability are generated
from the canonical registry in the
[management-tool reference](./reference/management-tools.md). The corresponding
[JSON catalog](./reference/management-operations.v1.json) is intended for machine
readers. The generated
[mock-MCP blueprint catalog](./reference/mock-mcp-blueprints.v1.json) describes the
versioned, secret-free built-in presets. The generated
[mock OpenAI](./reference/mock-llm-openai.v1.json) and
[mock Anthropic](./reference/mock-llm-anthropic.v1.json) manifests describe the
separate application-facing provider operations; those operations are not management
tools.

| Tool | Implemented behavior |
| --- | --- |
| `create_environment` | Create an isolated Entra ID or Okta environment and select it for this session |
| `list_environments` | List account environments and the session's selected ID |
| `delete_environment` | Purge one named or selected environment and clear the cursor when applicable |
| `configure_environment` | Update name, idle TTL, or request-log row limit |
| `seed_identities` | Create synthetic users and groups, including named group membership |
| `create_application` | Register a confidential or public OIDC/OAuth client; return a creation-only synthetic secret only for confidential clients |
| `run_provisioning_cycle` | Queue a deterministic outbound SCIM cycle against a saved or inline validated test target |
| `mint_token` | Mint an ID-token-shaped bearer JWT for a seeded subject, optionally broken |
| `set_scenario` | Create or completely replace a deterministic injected behavior by scenario ID |
| `clear_scenario` | Clear one scenario or all scenarios in an environment |
| `get_request_log` | Return a filtered, newest-first page of captured request entries |
| `assert_requests` | Count exact request matches and return matching request IDs |
| `simulate_lifecycle` | Apply a provider- and state-valid User lifecycle action and report state/version/ETag plus effective token revocations |
| `get_wellknown_urls` | Derive provider URLs from the active public origin and environment |
| `set_current_environment` | Set or clear the transport session's environment cursor |

All eight F1 and all four F2 operations are MCP-only. The self-hosted HTTP surface
remains exactly five routes, and the OpenAPI/typed client projections remain limited
to those routes.
`put_mock_mcp_server` is the only F1 operation that accepts a Bearer Mock Credential;
the handler redacts it and every read view omits both token and verifier. It requires
explicit `expectedRevision` intent: `null` is create-only and a positive current
revision is changed-replacement intent. Canonical replay is checked before CAS and
returns the existing record without changing revision, timestamps, state, or
sessions. A replacement is a complete definition write, so a Bearer Mock Credential
must be resupplied or rotated from caller-owned secret storage; the safe
`configured: true` marker is not a write shape.
`reset_mock_mcp_state` and `delete_mock_mcp_server` both require the positive current
revision. Reset atomically clears current-revision application state while preserving
the definition, revision, and sessions; an exact retry succeeds with `cleared: 0`.
Delete atomically removes the definition, state, and all sessions and succeeds only as
`deleted: true`; an absent row or retry after success returns
`404 MOCK_MCP_SERVER_NOT_FOUND`. A stale or delete/recreate ABA expectation on any
changed F1 mutation returns `409 MOCK_MCP_SERVER_REVISION_CONFLICT` without mutation.
Clients must read and reconcile the current definition rather than incrementing or
overwriting revisions blindly.
Both a changed direct put and a changed blueprint install are destructive. They
allocate a new revision, delete the prior revision's application state, and terminate
its revision-bound sessions. Canonically identical replay converges before CAS without
mutation, including an identical definition after delete/recreate; only a changed
definition with stale or ABA intent receives the typed `409`.

`list_mock_mcp_blueprints`, `get_mock_mcp_blueprint`, and
`install_mock_mcp_blueprint` expose the built-in preset catalog. The current entry is
`salesforce/hosted-mcp/sobject-reads`, a stateless, unauthenticated definition with
six deterministic tools. Install validates the complete public installed server
specification against the selected blueprint and slug, not only authentication or
slug. It accepts no Salesforce credential. The preset derives names and inputs from
Salesforce documentation reviewed on 2026-07-25; it performs no Salesforce network,
REST, OAuth, field-level security, or sharing work and makes no output-wire-parity
claim. It is not the F5 portable blueprint export/import/apply system.

For a Bearer-authenticated direct server definition, the exact raw value is accepted
only at `authentication.token`; the same value in every other definition key or
string value is rejected. If an MCP dependency result reflects the credential, the
operation fails closed before returning it.
`put_mock_llm_server` requires explicit `expectedRevision` compare-and-swap intent and
accepts independent strict OpenAI/Anthropic Mock Credentials as write-only fields.
They are hashed before persistence; safe put/get views expose only `configured: true`,
while list summaries omit authentication. That marker is read-only, not a write
shape. Every changed full-definition put must resupply or rotate the raw key for each
enabled strict provider from caller-owned secret storage. Canonical replay is an
idempotent success even when the supplied revision is stale.
`delete_mock_llm_server` requires a positive current `expectedRevision`, deletes
atomically on a match, returns the typed revision-conflict `409` on a stale/ABA
revision, and returns `deleted: false` when the row is already absent. There is no LLM
reset operation because the current provider runtimes are stateless and persist no
conversation, response, or evaluator state.

Successful calls return both text content and structured content shaped as an envelope
with `data` and `meta.requestId`. Failures after handler entry are normalized to an MCP
error result containing a problem document. SDK schema-validation failures occur before
handler entry and return the SDK's generic input-validation error instead.

## Application registration authentication

`create_application` accepts `clientType: "confidential" | "public"`.
`confidential` is the default for backward compatibility. A confidential registration
returns `clientSecret` exactly once; later application summaries contain neither that
plaintext nor its stored hash.

A public registration:

- requires `clientType: "public"`;
- rejects `clientSecret` rather than ignoring or storing it;
- rejects the `client_credentials` grant;
- accepts `redirectUris: []` only for a device-only registration that does not
  include `authorization_code`;
- requires at least one real, exact callback URI when `authorization_code` is
  present, including a mixed authorization-code/device registration;
- returns `clientType: "public"` with no `clientSecret`; and
- authenticates bounded code and refresh grants with a known client ID and no secret.

Do not invent or persist an empty placeholder secret for a public client. A spurious
secret makes token authentication fail. Do not invent a callback URI for a device-only
client either: send the required `redirectUris` field as an empty array. A client that
can run authorization code must instead register the callback it will actually use.

This conditional is machine-readable in the SDK 1.29 `tools/list` result using JSON
Schema Draft-7 conditionals. The input is a strict object with only `name` and
`redirectUris` unconditionally required; the array may be empty only for the bounded
public device-only shape.
`clientType`, `grantTypes`, `appRoles`, and `groupClaimsMode` retain advertised
defaults without being placed in `required`. An `allOf` `if`/`then` branch for
`clientType: "public"` forbids `clientSecret` and narrows `grantTypes` so
`client_credentials` is not an allowed item. The registration schema separately
requires a non-empty redirect list for every shape outside the bounded public
device-only case, including whenever `authorization_code` is present. The output
envelope's `data` uses exact confidential/public branches: the confidential branch
requires `clientSecret`, while the public branch has no such property. Runtime Zod
validation and discovery therefore describe the same bounded contract.

For the Okta profile, discovery advertises `none` for token and revocation endpoint
authentication. Introspection deliberately remains confidential and advertises only
`client_secret_basic` and `client_secret_post`. Public revocation is not anonymous:
the caller identifies its public client, and the core changes only tokens owned by that
client ID. The pinned Okta Auth JS 8.0.1 path sends a client-ID-only Basic compatibility
shape, which the adapter normalizes to public `none`. A core negative regression proves
an unrelated public client cannot change another application's active access token or
rotated refresh family.

## Returned protocol URLs and mock authentication

`get_wellknown_urls` returns request-derived OIDC/OAuth URLs and `scimBaseUrl`. Entra
environments also return `graphBaseUrl`; Okta environments return `oktaApiBaseUrl` and
the bounded M6 implementation's exact `oktaAuthnEndpoint`. Never construct or persist an
absolute issuer from an old host.

In Entra subdomain mode, OIDC/OAuth URLs use
`https://login.<base>/<tenant>/v2.0`, while SCIM and Graph remain environment-scoped at
`https://<environment>.<base>/scim/v2` and
`https://<environment>.<base>/graph/v1.0`. `mint_token` and
`get_wellknown_urls` derive those locations from operator-owned bindings and pass them
through typed Durable Object calls; they do not accept a caller-provided source URL.

These are deliberately separate trust boundaries:

- `/mcp` requires the configured management Access Key.
- `/mcp-mock/{slug}` under an environment accepts no credential or its configured
  server-specific Bearer Mock Credential.
- `/llm-mock/{slug}/openai/v1` under an environment requires a syntactically valid
  provider Bearer Mock Credential. `accept_any` skips verifier comparison but is not
  unauthenticated; `strict` compares the current stored verifier. The route supports
  only model list/retrieve and bounded JSON/SSE Chat Completions.
- `/llm-mock/{slug}/anthropic` under an environment requires a syntactically valid
  provider `x-api-key` Mock Credential plus exactly
  `anthropic-version: 2023-06-01`. It supports model list/retrieve and bounded
  JSON/named-event SSE Messages; authorization aliases and beta headers fail closed.
- `/scim/v2` requires a non-empty synthetic `Authorization: Bearer ...` credential.
- Entra `/graph/v1.0` requires a non-empty synthetic Bearer credential.
- Okta `/api/v1` requires a non-empty synthetic `Authorization: SSWS ...` credential.
- Okta `POST /api/v1/authn` is a public synthetic sign-in boundary and accepts only a
  bounded JSON primary-authentication or state-token request; it does not use the
  management `SSWS` credential.

The three directory credentials check the expected scheme and presence for protocol
testing; they do not validate a real provider token and are not production
authorization. Never reuse or forward the MCP Access Key as a directory, mock-MCP,
or mock-LLM credential. For mock-LLM puts, any definition JSON key or string value
containing the complete active platform key as a substring is rejected before
persistence. Provider requests also reject that platform key, alternate API-key
headers, and credential reflection in Chat Completions JSON.
The accepted bounded M3 inbound SCIM surface provides ServiceProviderConfig,
ResourceTypes, Schemas, and versioned Users/Groups CRUD, filter, pagination, ETag, and
PATCH behavior. Graph is a bounded read surface for Users, Groups, and direct
memberships. The Okta management API covers the tested Users/Groups CRUD, direct
membership, and lifecycle routes. The separate bounded M6 Classic Authn implementation
covers primary `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, and explicit
`LOCKED_OUT` responses plus state retrieval/cancellation; it is not the complete
Classic transaction API.

Classic Authn state reads slide the state capability's expiry to five minutes from
each valid read; a one-time session capability retains its fixed five-minute issuance
expiry. Each User is capped at 32 retained rows per kind and each state/session table
at 10,000 retained rows, with oldest-expiring eviction and an issuance-time GC pass bounded
to 256 expired rows per table. Operational indexes live outside CORE_MIGRATIONS and preserve baseline
rollback compatibility. Browser CORS admits same-origin `POST` with only `accept` and
`content-type`, never enables credentials, and returns 403 cross-origin. Responses use
the singular `_embedded.factor` property and omit `passwordChanged`. Deactivating
lifecycle transitions and SCIM password changes revoke both capability kinds. Log
capture recursively redacts secret body keys, replaces malformed/non-object Authn
bodies wholesale, and redacts sensitive authorization, cookie, credential, key,
password, secret, and token header families. The M6 workers.dev smoke samples the
public states, state retrieval, CORS, privacy, and redaction. Retention, cancellation,
revocation, and issuance-race details not exercised there remain source evidence; no
verified-live evidence is claimed.

## Lifecycle and refresh-token families

Lifecycle actions are provider- and state-specific. Entra supports `activate`,
`disable`, `reactivate`, and `delete`; Okta supports `activate`, `reactivate`,
`suspend`, `unsuspend`, `deprovision`, and `delete`, with deletion requiring a
deprovisioned User. Invalid transitions fail closed.

Disabling, suspending, deprovisioning, or deleting a User revokes effective access and
refresh tokens in the same transaction as the state change. The bounded M6 implementation
also removes outstanding Classic Authn state and one-time session capabilities in that
transaction, and a SCIM password change revokes both Authn capability kinds. Refresh
grants authenticate the client, reject scope escalation, rotate the token within its
family, preserve the original authentication time and absolute family expiry, and
detect replay. Replaying
or concurrently redeeming an already consumed token invalidates its refresh family and
associated access tokens. A known token belonging to a newly disabled User returns the
provider-shaped disabled-account error: Entra `invalid_grant` with `AADSTS50057`, or
Okta `invalid_grant` with `The resource owner account is disabled.`

The same family rules apply to confidential and public registrations. Public refresh
tokens are still bearer credentials; client type does not add DPoP, sender constraint,
or browser-storage protection.

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

Routed Worker requests and the reserved internal SCIM seams use these injection points:

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
| `scim.patch_parse` | Reserved internal SCIM PATCH parser boundary |
| `scim.before_commit` | Reserved internal SCIM write boundary |
| `graph.request` | Microsoft Graph directory requests |
| `okta.api` | Okta Users/Groups and lifecycle API requests |
| `http.request` | Any other routed environment request |
| `*` | Catch-all considered after an exact match |
| `token.before_sign` | Internal token-signing boundary; exact-only, not matched by `*` |

Actions are a bounded delay of at most 30 seconds, a provider-rendered semantic error,
or a shallow JSON-object mutation. `rotate_signing_key` and
`token_clock_skew` are restricted to `token.before_sign`; skew is bounded to plus or
minus 86,400 seconds and changes only JWT temporal claims, not the environment clock or
stored grant timestamps. Rotation promotes a pre-published successor and stores the
previous public key as a metadata-only overlap row after scrubbing
its private JWK. A subsequent rotation is gated for exactly 26 hours, the maximum
rollback/verification-overlap window qualified for the built-in Worker OIDC and MCP
`mint_token` paths with their fixed one-hour lifetime and bounded skew. Public core
`expiresInSeconds` and `additionalClaims` inputs are trusted test seams; longer custom
lifetimes or temporal overrides are outside that guarantee. Mutation is restricted to
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, and
`oauth.introspect`; selecting mutation for another point fails instead of attempting to
rewrite HTML, redirects, or empty bodies. Scenario specifications and mutation patches
are bounded to 64 KiB when serialized.

The M6 SCIM source slice also defines injection-locked typed actions. `scim_conflict`
and `scim_soft_delete_race` are valid only at `scim.before_commit`.
`scim_patch_tolerance` is valid only at `scim.patch_parse` and requires
`malformedCase: "missing_schemas"` or `"singleton_operations"`. Generic actions are
rejected at those reserved points, and the SCIM actions are rejected at every public
request point and at `*`. Internal evaluation is exact-only and does not execute or
consume a `*` catch-all. These controls are synthetic deterministic test cases, not
provider-parity evidence.

## Request logs and assertions

The Worker records inbound environment protocol requests after routing. Entries
include method, exact public path, selected request/response headers and bounded bodies,
status, duration, provider, timestamp, correlation ID, and request ID. Pagination is
newest-first and cursor-bound to its filters. The row ring and byte budget are bounded;
capturing a log is fail-open for protocol availability.

Environment-hosted mock MCP uses a stricter F1 capture shape: it stores bounded,
redacted request headers and MCP method/tool/argument/error metadata, but leaves raw
JSON-RPC request bodies, response headers, and response bodies empty. See the
[mock MCP guide](./mock-mcp.md#observe-and-assert-what-the-agent-did).

`get_request_log` filters by `source`, `provider`, protocol, normalized method, exact
path, exact status, MCP method, and MCP tool. `assert_requests` supports:

- exact `source`, method, path, and status matching (method is normalized to uppercase),
- case-sensitive literal `bodyIncludes` and `responseBodyIncludes` substrings of the
  stored request and response bodies,
- exact `mcpMethod`, `mcpTool`, and canonical-JSON `mcpArguments` matching for
  environment-hosted mock MCP traffic,
- an optional two-to-100-step ordered `sequence`; top-level filters constrain every
  step, unrelated requests may appear between steps, and complete non-overlapping
  sequences are counted in append order, and
- `count.atLeast`, `count.atMost`, or `count.exactly` constraints.

It does not currently assert headers, parsed JSON/JSONPath, or regular expressions.
Use synthetic identities and tokens. Structured secret-bearing form/JSON fields,
token response values, sensitive headers, and redirect `Location` secrets are redacted
before durable insertion, while safe request structure remains assertable. This
key/media-type policy is not general content classification: non-secret fields and
some non-JSON bodies may still be retained. Never use production credentials or real
personal data.

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

Supply `idempotencyKey` when a transport retry must resolve to the same run. Reuse the
key only for the exact same Environment, application, mode, and target. The runtime
derives an opaque fixed run ID from the Environment and key; the raw key does not enter
Workflow parameters or results. A changed request under that run ID fails closed.
Omitting the key preserves the self-hosted behavior of starting a new cycle. The hosted
composition requires it so an ambiguous terminal response can be replayed without
provisioning twice or consuming quota twice.

## Evidence

The evidence ledger links immutable public and hosted candidates to their CI and
workers.dev smoke records. Treat the newest listed deployment record as authoritative;
the [M5 local source record](./evidence/m5-local-source-qualification.md) establishes
the local source gate and two-process flow. The separate
[M5 deployment record](./evidence/m5-workers-dev-smoke.md) binds exact source/CI to a
public-HTTPS target, ordered outbound assertion, terminal Workflow state,
credential-safe evidence, and cleanup. Always verify the connected endpoint's tool
registry; none of these tests constitute comparison with a live Entra tenant or Okta
organization.

The [M6 deployment record](./evidence/m6-workers-dev-smoke.md) separately binds exact
public source, CI, staging/production versions, the sampled six-slice acceptance, and
cleanup. It does not qualify every tool or fixture, the guarded Cloudflare-credential
deployment workflow, or verified-live parity.

The [Entra MSAL Node](./evidence/entra-msal-node-local-qualification.md) and
[Okta Auth JS](./evidence/okta-auth-js-local-qualification.md) records separately bind
the official MCP SDK to exact local client versions and actual-network Wrangler HTTPS
flows. They qualify only the tools and provider sequences each record names. Neither
is a hosted MCP command matrix, remote Worker smoke, verified-live comparison, or
production-readiness result.

The F1 Worker integration separately uses `@modelcontextprotocol/sdk` `1.29.0` against
the mounted Worker to discover the 27-tool registry and invoke create, canonical
replay, reset, concurrent changed replacement, stale put/reset/delete, and delete
through management MCP before exercising the environment data plane. That bounded
management-CAS slice is D/I/S/X/Q locally. It is not an actual-network run and adds no
H, P, hosted, Cloud-pin, deployment, or broad-client claim; V is not applicable.

The same pinned mounted-Worker path qualifies the exact built-in
`salesforce/hosted-mcp/sobject-reads` catalog, install, six-tool discovery and
deterministic fixtures, observation, assertion, reset, and cleanup through D/I/S/X/Q
locally. H, V, and P are unqualified: there is no actual-network run, hosted smoke,
private Cloud pin, deployed acceptance, live Salesforce organization comparison, or
production-readiness evidence. The 2026-07-25 Salesforce documentation review is
design provenance, not V evidence.

Source evidence means exact-revision local or hosted-CI execution. Deployed acceptance
additionally binds that revision to an exact mockOS deployment/version and recorded
acceptance run. Verified-live is reserved for sanitized, independently reviewed
comparison with a real provider; neither workers.dev smoke nor hosted mockOS acceptance
can satisfy that tier.
