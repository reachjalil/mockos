# F1 mock-MCP source implementation

Status: Locally source-qualified; no hosted or deployed acceptance
Last reviewed: 2026-07-26

F1 makes a deterministic MCP server a first-class synthetic dependency inside an
existing mockOS environment. Operators configure it through the primary management
MCP surface; an agent or MCP client under test connects to the separate
environment-hosted endpoint.

The task guide and exact behavior reference are in
[Environment-hosted mock MCP](../mock-mcp.md). This record explains the delivered
architecture, responsibilities, and qualification boundary.

## Delivered vertical slice

- F1 added five operations after the accepted 15-tool registry. The current combined
  F1/F2 source registry contains 24 tools; F1 compare-and-swap semantics add no new
  tool. The
  `put_mock_mcp_server`, `list_mock_mcp_servers`, `get_mock_mcp_server`,
  `delete_mock_mcp_server`, and `reset_mock_mcp_state` operations are generated from
  the shared operation registry and are deliberately MCP-only. The existing
  self-hosted HTTP surface remains five routes.
- All F1 definition mutations are revision-safe. Put requires `null` create intent or
  the positive current revision for changed replacement, while reset and delete
  require the positive current revision. Stale and delete/recreate ABA expectations
  return a typed `409`; missing reset/delete and delete replay return typed `404`.
- Strict version-one contracts cover server identity, transport and hash-only Bearer
  policy, bounded pagination, tools, fixed resources, safe Level-1 resource
  templates, prompts, declarative behavior, method-specific results, and configured
  server-range JSON-RPC errors.
- A hand-written `@mockos/mcp-mock` package implements the stable `2025-11-25`
  Streamable HTTP boundary without using the official SDK at runtime. The official
  SDK remains a black-box conformance client.
- Path mode resolves `/e/{environmentId}/mcp-mock/{slug}`. Subdomain mode resolves
  `https://{environmentId}.{baseDomain}/mcp-mock/{slug}`. Mock-MCP routing is a
  discriminated data-plane route and does not acquire identity-provider issuer or
  Graph metadata.
- One existing Environment Durable Object owns each environment's server definitions,
  revisions, sessions, behavior state, and MCP request observations. F1 does not add a
  second Durable Object binding or another management ingress.
- Schema migration v6 adds revisioned `mock_mcp_servers`, one bounded environment
  revision-allocator row, revision-bound `mock_state`, hash-only session storage,
  expiry indexes, and nullable MCP request-log metadata.
- The protocol-independent behavior evaluator implements static, restricted
  template, first-match, once/hold-last/loop sequence, configured error, and
  fail-closed script semantics with deterministic seeded latency.
- Request logs represent MCP protocol method, tool, canonical argument object,
  top-level JSON-RPC error code, and tool-level `isError`. Filters, exact assertions,
  and ordered cross-source sequences match their supported subset: log reads filter by
  method/tool, while assertions match method/tool/arguments. Error code and tool
  `isError` remain diagnostic fields on returned entries, not assertion matchers.

## Responsibility graph

| Node | Responsibility | Must not own |
| --- | --- | --- |
| `packages/contracts/src/mock-mcp.ts` | Versioned public server/capability/result contracts, safe read views, validation limits | Transport I/O or database state |
| `packages/contracts/src/operations/management.ts` | Five F1 management operation schemas and metadata | HTTP routes |
| `packages/core/src/behavior/evaluator.ts` | Portable deterministic behavior plans and staged state | MCP wire rendering |
| `packages/core/src/mock-mcp/repository.ts` | Environment-local revisions, state, sessions, pruning | Public routing |
| `packages/mcp-mock` | `2025-11-25` parsing, lifecycle, dispatch, pagination, result validation, errors | Platform tenancy or private Cloud policy |
| `packages/mcp/src/index.ts` | Handler-agnostic management tool registration | Direct Durable Object imports |
| `packages/worker-kit/src/mcp-agent.ts` | Management dependency adapter and typed EnvironmentDO calls | A second MCP product model |
| `packages/worker-kit/src/host-resolver.ts` and `edge-router.ts` | Exact public route classification and trusted metadata | Caller-controlled internal headers |
| `packages/worker-kit/src/environment-do.ts` | Bind adapter, repository, behavior, observation, and RPCs to one environment | Account, billing, or entitlement policy |
| `apps/worker/src/app.ts` | Self-hosted management authentication and route entry | Secret persistence or mock-MCP behavior |

The private operated product may consume these public exports and add hosted account,
tenant, quota, and entitlement policy. The public implementation never imports or
requires that private service.

## Locked source semantics

### Definition and revisions

- At most 64 servers exist in one environment and 64 capabilities exist per kind.
- Definitions are bounded before recursive validation. Tool schemas use a documented,
  deterministic JSON Schema subset. Omitted input schemas default to
  `{ "type": "object" }`; explicit input and output schemas must declare that literal
  object root. `$ref`, `pattern`, `format`, unsafe keys, and unsupported vocabularies
  fail creation.
- Binary resource blobs and tool/prompt image or audio blocks accept canonical
  standard base64 only, including correct padding and padding bits.
- Put requires explicit compare-and-swap intent: `expectedRevision: null` is
  create-only, while a positive safe integer selects the current generation for a
  changed replacement. Canonical replay is evaluated before CAS, so an ambiguous
  successful retry preserves revision, timestamps, state, and sessions even when its
  expectation is now stale or remains `null`. Every new or changed definition
  atomically consumes the next environment-wide safe positive-integer revision,
  deletes old application state when replacing a slug, and terminates old-revision
  sessions. Per-slug values may skip, but they increase strictly.
- A changed replacement is a complete definition write. Bearer authentication must
  resupply or rotate the raw synthetic token from caller-owned secret storage; the
  safe `configured: true` view is deliberately not accepted as replacement input.
- In-flight initialize, notification, request, configured-error, and DELETE paths
  recheck the resolved revision before commit/response. A racing replacement or
  deletion returns transport `409`, not an old-revision result.
- Reset and delete require the positive current revision and validate it inside their
  mutation transaction. Reset deletes only current-revision state and preserves the
  definition, revision, current sessions, and allocator; an exact retry returns
  `cleared: 0`. Delete explicitly removes definition, state, and sessions even without
  SQLite foreign key enforcement and returns literal `deleted: true`. A missing
  reset/delete or repeated delete returns `404 MOCK_MCP_SERVER_NOT_FOUND`; stale or
  ABA state returns `409 MOCK_MCP_SERVER_REVISION_CONFLICT` without mutation.
- The single allocator row survives even when every server is deleted, so
  delete/recreate cannot reuse an old revision without an unbounded tombstone ledger.
- Bearer Mock Credentials are accepted only on the write contract. Persistence stores
  a SHA-256 verifier; reads expose only `configured: true`. The platform management
  credential is rejected as a mock Bearer value.
- User-authored configured errors map one-to-one into `-32099` through `-32000`,
  excluding MockOS-reserved state-capacity code `-32050`.

### Transport and sessions

- F1 negotiates exactly MCP `2025-11-25`.
- Streamable HTTP is POST-only. Stateful initialize issues one opaque 32-byte
  base64url session ID and persists only its SHA-256 hash.
- Sessions bind slug, server revision, protocol version, initialization state, TTL,
  and termination. A server allows at most 100 active sessions and prunes bounded
  expired/terminated rows before enforcing the cap.
- Subsequent requests validate protocol and session headers. DELETE terminates the
  session. GET returns `405`; F1 does not emit `listChanged`.
- Opaque pagination cursors encode capability kind, slug, revision,
  transport/session scope, and offset. Malformed, naively modified, cross-kind,
  cross-session, or stale-revision cursors fail. Their checksum is unkeyed, so cursors
  provide pagination correctness, not authorization or tamper-proof security.
- Resource-template reverse matching compares literals exactly, accepts empty simple
  expansions, percent-decodes encoded reserved characters, and uses deterministic
  leftmost-minimal captures for adjacent variables. The implementation avoids regex
  backtracking and remains linear in the URI for the contract-bounded maximum of 20
  variables and 1,024 URI characters.

### Behavior and state

| Variant | F1 behavior |
| --- | --- |
| `static` | Returns a detached JSON value. |
| `template` | Replaces `{{dotted.path}}` from explicit behavior data and invocation input. Prototype paths, helpers, evaluation, recursion, and missing values fail. |
| `match` | Selects the first deeply equal dotted-path case; otherwise uses the explicit fallback or fails. |
| `sequence` | `once` fails after the final committed step, `hold_last` repeats the final step, and `loop` wraps. |
| `error` | Maps one symbolic name through the server's exact, own-property `errorCodeMap` entry. |
| `script` | Uses an injected executor only. F1 provides none, so the explicit fallback runs or evaluation fails closed. |

Behavior evaluation stages sequence movement with its expected read. The adapter
validates a method-specific value, waits for seeded latency outside a SQLite
transaction while observing the HTTP Fetch request's abort signal, then calls
`commit()`. Invalid output and an HTTP abort/disconnect observed during latency do not
advance state. If an interleaved request commits first, the stale plan fails instead
of overwriting the newer cursor. A configured-error step also waits and commits its
staged sequence movement before the mapped JSON-RPC error is returned; the same
latency-abort guard prevents that movement.

F1 does not implement message-level MCP cancellation. It has no in-flight request-ID
registry, and `notifications/cancelled` is accepted with HTTP `202` and deliberately
ignored. Cancellation is a protocol SHOULD rather than a MUST, so this is an explicit
client limitation rather than a claim that notification cancellation is enforced.

Each state value is bounded to 64 KiB/16 levels/5,000 nodes. A server revision is
additionally capped at 256 current-revision rows and 2 MiB of serialized state;
capacity failure returns HTTP `200` with reserved JSON-RPC `-32050` and exact message
`Mock MCP application state capacity reached.`, and does not partially commit.

`proxy` is intentionally absent. Record/replay remains F9.

A syntactically valid `tools/call` whose argument object fails the selected tool's
input schema returns an HTTP-`200` JSON-RPC result with bounded text and
`isError: true`; it does not expose input values or run behavior. Unknown tools and
malformed call parameters remain top-level invalid params. A deliberate tool-error
result may omit output-schema `structuredContent`, while invalid successful output
remains an adapter error and never commits state. The schema-mismatch result starts
with one exact stable sentence and may add one bounded diagnostics block containing
issue paths/messages only.

### Observation

The adapter appends bounded inbound entries with `provider: "mcp"` and
`protocol: "mcp"`. Management log reads can filter by MCP method or tool. Assertions
can match exact method, tool, and canonical argument object, including in
non-overlapping ordered sequences with other environment traffic.

Authentication and transport capability headers are redacted. Synthetic arguments
and results may remain because observable test traffic is the product.

## Qualification matrix

| Evidence | F1 requirement |
| --- | --- |
| Contract tests | Strict bounds/defaults, schema subset, safe template grammar, write-only credentials, mandatory null/positive mutation intent, 24-tool current registry, five HTTP routes |
| Core tests | Atomic create/replay/replace/reset/delete CAS, stale and delete/recreate ABA denial, hash-only sessions, cap/pruning, staged sequence conflict behavior, request-log assertions |
| Adapter tests | Raw-wire negotiation, lifecycle, method dispatch, cursors, schemas, configured errors, bounded/linear resource-template reverse matching, HTTP-abort state protection during latency, deliberately ignored `notifications/cancelled`, output validation, in-flight revision races, and real-repository sequential/concurrent state capacity |
| Management tests | Five tool registration, discovered/runtime schema identity, explicit/current environment resolution, safe results, typed 404/409 failures, pre-handler secret non-reflection, and redaction |
| Worker and routing tests | Host-resolver coverage for both route modes and trusted headers; [`mock-mcp.integration.test.ts`](../../apps/worker/test/mock-mcp.integration.test.ts) for mounted `@modelcontextprotocol/sdk` `1.29.0` discovery and management create/replay/reset/concurrent replace/stale/delete calls plus path-mode auth/session, capabilities, revision invalidation, cleanup, and redacted observations |
| Documentation checks | Generated catalog/reference drift, exact counts, links/anchors, inert examples, supported/unsupported claims |
| Full local source gate | `pnpm check` |

Every applicable focused suite and the complete `pnpm check` gate are green in the
revision carrying this record, so the bounded F1 implementation is locally
source-qualified. D/I/S/X/Q are yes for the bounded management-CAS and mounted
official-SDK Worker path. Q does not extend beyond the named SDK `1.29.0` flow, and
the mounted fetch seam is not actual-network evidence. H and P remain unqualified,
while V is not applicable to this synthetic flow. F1 does not yet have hosted CI,
merge, package publication, staging, production, private Cloud consumption, or broader
ecosystem evidence.

## Still open

- standalone GET event streaming and `listChanged` notifications;
- JSON-RPC batch requests;
- message-level request cancellation; `notifications/cancelled` is accepted but does
  not cancel an in-flight request;
- script execution and Worker Loader enforcement;
- `proxy` record/replay;
- any LLM provider surface in this F1 mock-MCP runtime; bounded OpenAI and Anthropic
  JSON/SSE routes are separate partial F2 capabilities;
- enforced shared Access Key scopes and team policy;
- the final post-July-2026 MCP protocol checkpoint and a second version adapter;
- npm distribution, hosted qualification, deployment, wildcard TLS, load/cost
  envelopes, and broader client/ecosystem conformance.

Those gaps are explicit [known limitations](../known-limitations.md), not implied
parts of the F1 source slice.
