# F2 LLM kernel and provider source slice

Status: Partial source-qualified OpenAI and Anthropic JSON/SSE plus metadata-only observation/query/assertion; configured midstream errors, state, network, Cloud, and deployment remain open
Last reviewed: 2026-07-25

This slice establishes both a provider-neutral seam for deterministic mock LLM
responses and an MCP-first configuration substrate for environment-hosted servers.
One normalized behavior result becomes one validated response plan and then
provider-shaped OpenAI or Anthropic JSON/SSE frames. Strict server
definitions, four MCP-only operations, environment-local schema-v8 persistence,
mandatory revision compare-and-swap, and write-only provider credential views own
configuration. Separate bounded OpenAI and Anthropic request adapters plus the shared
environment runtime now serve model list/retrieve, OpenAI Chat Completions as JSON or
timed SSE, and Anthropic Messages as JSON or named-event timed SSE to applications or
SDKs. Successfully parsed/planned provider POSTs that pass response preflight attempt
one metadata-only request-log reservation within a 50-millisecond fail-open budget;
privacy collisions skip it, and successfully persisted rows can be queried or
asserted through the existing management MCP tools.

Read this page as a source-architecture and evidence record. The complete F2 target
remains in the [F-series roadmap](../F_SERIES_ROADMAP.md), and the current negative
product boundary remains in [known limitations](../known-limitations.md). Use
[MCP-managed mock OpenAI and Anthropic](../mock-llm.md) for the task contract and the
generated [OpenAI](../reference/mock-llm-openai.v1.json) and
[Anthropic](../reference/mock-llm-anthropic.v1.json) manifests for
machine-readable operation, limit, auth, planning, and evidence truth.

## What the source slice proves

- Public schemas validate the provider-neutral success/error response-plan
  vocabulary.
- The shared declarative behavior evaluator can be adapted into a deterministic,
  immutable plan without embedding an OpenAI or Anthropic response object in core.
- Pure provider modules render the same plan into OpenAI Chat Completions and
  Anthropic Messages JSON or immediate SSE-frame shapes.
- Pinned official `openai` and `@anthropic-ai/sdk` clients deserialize those rendered
  objects through an in-process injected Fetch seam.
- Strict, bounded server-definition contracts join models, provider dialect policy,
  shared declarative behavior, usage defaults, and cadence defaults without exposing
  persisted credential verifiers.
- Four management MCP operations create/list/get/delete definitions inside a named or
  session-selected environment.
- Schema v8 retains schema-v7 canonical definitions and monotonic revisions, then
  adds structured LLM metadata plus an append-once terminal overlay to the existing
  request log;
  changed replacements require the current revision while canonical retries are
  idempotent. Replacement is full-definition and requires every enabled strict key to
  be resupplied or rotated; delete requires positive revision CAS.
- An executable OpenAI adapter owns exact environment path/subdomain routing, model
  list/retrieve, strict bounded Chat Completions parsing, JSON or SSE negotiation,
  provider-shaped request errors, fresh transport identity, declared-tool enforcement,
  and response ceilings. `stream_options` is valid only with `stream: true` and accepts
  only optional Boolean `include_usage` and `include_obfuscation`.
- The OpenAI edge applies abort-aware initial delay before headers, paces payload
  deltas only, writes structural/terminal/optional-usage/`[DONE]` frames immediately,
  and enforces one absolute maximum duration across initial wait, pacing, and
  backpressure. It preflights the complete SSE body against a 2,097,152-byte UTF-8
  ceiling and truncates post-`200` cancellation/deadline without fabricated success.
- An executable Anthropic adapter owns exact routes, model list/retrieve, bounded
  Messages parsing, `x-api-key`, exact `anthropic-version: 2023-06-01`, beta rejection,
  provider-shaped errors, fresh IDs, declared custom tools, limits, and JSON/SSE
  negotiation. Its named event stream ends in `message_stop`, carries cumulative
  usage in `message_delta`, and has no `[DONE]` or mock-emitted `ping`; clients should
  still tolerate the upstream protocol's `ping`.
- The shared edge scheduler preflights either provider's complete SSE body against
  2,097,152 UTF-8 bytes, applies abort-aware initial delay before headers, paces only
  text/tool payload deltas, and enforces one absolute maximum duration across initial
  wait, pacing, and backpressure. Preflight failures remain generic JSON before
  `200`; post-`200` cancellation/deadline truncates without fabricated success.
- The environment runtime requires a valid dialect credential in both auth
  modes, hashes before selecting the current definition, compares strict verifiers
  without early exit, derives stateless turns from prior assistant messages, and
  rechecks the definition revision before committing the plan inside the Environment
  Durable Object and returning it to the edge.
- Successfully parsed/planned Chat Completions and Messages POSTs that pass JSON/SSE
  response preflight reserve one `pending`, metadata-only request-log entry before
  provider delay or response headers. Reservation wait is capped at 50 milliseconds;
  failure, timeout, or a prospective metadata/credential collision cannot delay or
  alter the provider response. A non-cancellable hook can still create a late
  `pending` row after timeout. Terminal completion overlays an in-budget reservation
  as `completed`, `cancelled`, `deadline_exceeded`, or `failed`, preserving its append
  sequence and exact selected server revision. Actual delivered status and monotonic
  elapsed duration enter only the terminal child; pending reads use explicit `102`
  and `0` compatibility sentinels for the legacy non-null columns.
- `get_request_log` and `assert_requests` support exact LLM dialect, operation, slug,
  revision, model, stream, turn, outcome, response ID, usage, stop-reason,
  ordered-tool-name, and configured-error matchers, including the existing
  greedy-earliest non-overlapping sequence semantics. Stream is accepted request
  intent, not proof of SSE delivery; configured errors can retain `true` while
  returning JSON. Response IDs are preallocated response-plan metadata and are
  omitted for configured errors.
- Observation storage is fail-open and metadata-only. It stores empty headers and
  null bodies, never prompts, outputs, credentials, tool inputs, `planId`, or
  `requestHash`. A request-local guard skips the whole observation when the presented
  Mock Credential or platform key collides with any prospective durable metadata,
  including routed path, operation, slug/model/IDs, revision, pending sentinels,
  terminal outcomes, status, or duration. Stream frame/byte counts remain internal
  test accounting and are not persisted or queryable.
- Local Worker integrations configure isolated environments through MCP and
  drive model, text, tool, usage, error, credential-rotation, and secret-safety cases
  through pinned official `openai` 6.49.0 and `@anthropic-ai/sdk` 0.115.0; the OpenAI
  lane also exercises streaming options, while both lanes exercise ordered delivery
  and cancellation.

Those are focused local source tests. They are not a Wrangler network round trip,
hosted CI, deployed, production, or live-provider evidence.

## What is not available

There is no mock-LLM management HTTP route, CLI command, console workflow,
conversation/evaluator state, reset operation, configured midstream error, OpenAI
Responses API, actual Wrangler-network qualification, Cloud pin, or deployed endpoint
in this slice.

In particular:

- `/e/{environmentId}/llm-mock/{slug}/openai/v1` and the corresponding environment
  subdomain form are source-implemented for exactly three operations; Chat
  Completions supports bounded JSON and SSE responses;
- `/e/{environmentId}/llm-mock/{slug}/anthropic` and the corresponding environment
  subdomain form are source-implemented for exactly three operations; Messages
  supports bounded JSON and named-event SSE responses;
- management MCP contains 27 tools, including four MCP-only LLM-definition
  operations; self-hosted management HTTP remains at five routes;
- the Access Key authenticates management MCP and is rejected from the provider data
  plane; both `accept_any` and `strict` require a valid dialect credential, while
  only `strict` compares the current hash-only verifier;
- the OpenAI route accepts `stream: true`; `stream_options` accepts only optional
  Boolean `include_usage` and `include_obfuscation`, and only while streaming.
  Obfuscation defaults on and adds fresh opaque compatibility padding to regular
  delta chunks, without claiming upstream size normalization or security parity;
- the Anthropic route accepts Boolean `stream: true`, emits no mock `ping` and no
  `[DONE]`, and keeps `anthropic-version: 2023-06-01`, beta rejection, and
  `x-api-key` as exact pre-dispatch boundaries;
- `turnIndex` is the stateless count of prior assistant messages; there is no response
  or conversation-state owner, retry-deduplication record, or implicit session;
- only successfully parsed/planned Chat Completions/Messages POSTs whose response
  preflight passes are observed; catalog/auth/version/parse/model-selection/planning
  and response-preflight failures are outside this bounded evidence contract; and
- the local official-SDK Worker integration proves the routed source composition,
  not a real socket, Wrangler dev server, hosted endpoint, or broad SDK matrix.

## Responsibility graph

```text
normalized request + BehaviorSpec
              │
              ▼
    shared behavior evaluator
              │
              ▼
 provider-neutral ResponsePlan
          ┌───┴───┐
          ▼       ▼
  OpenAI wire  Anthropic wire
      │           │
      ▼           ▼
bounded OpenAI  bounded Anthropic
 HTTP adapter     HTTP adapter
      └──────┬──────┘
             ▼
environment path/subdomain router
      │
      ▼
official OpenAI/Anthropic SDK Worker tests
             │
             ▼
 one attempted metadata-only request-log row
 get_request_log / assert_requests

management agent
       │
       ▼
 four MCP-only definition tools
       │
       ▼
 schema-v8 environment repository
```

The management branch is composed through the Environment Durable Object and persists
configuration, not responses. The provider branch authenticates and plans in the same
environment, commits the plan there after its final revision check, then lets the edge
own initial delay, rendering, and timed streaming for both dialects. The pure
serializers remain in-process projection seams; both HTTP adapters pass their
payload/immediate cadence metadata to the same edge scheduler. After response
preflight, the edge uses the exact revision returned with that plan to reserve the
observation in the same Environment Durable Object and later best-effort finalizes its
terminal status and duration.

## Source ownership

| Source | Responsibility | Deliberately absent |
| --- | --- | --- |
| [`packages/contracts/src/mock-llm.ts`](../../packages/contracts/src/mock-llm.ts) | Provider-neutral segment, stop, usage, cadence, error, and response-plan validation | Provider JSON, request parsing, routing, storage, or private policy |
| [`packages/contracts/src/mock-llm-server.ts`](../../packages/contracts/src/mock-llm-server.ts) | Strict write/persisted/safe-view server definitions, model/dialect bounds, and provider-key separation | Provider routing |
| [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts) | Structured LLM request-log entries, terminal outcomes, exact query/count/sequence matcher schemas, and privacy invariants | Provider rendering or durable storage |
| [`packages/contracts/src/operations/management.ts`](../../packages/contracts/src/operations/management.ts) | Four MCP-only definition operations and exact effect/retry/secret metadata | Self-hosted HTTP routes |
| [`packages/core/src/behavior/evaluator.ts`](../../packages/core/src/behavior/evaluator.ts) | Deterministic `BehaviorSpec` evaluation and staged sequence semantics | LLM dialect decisions |
| [`packages/core/src/mock-llm/repository.ts`](../../packages/core/src/mock-llm/repository.ts) | Canonical definition writes, monotonic revision allocation, compare-and-swap, replay, and limits | Conversation, response-plan, or evaluator state |
| [`packages/core/src/store/migrations.ts`](../../packages/core/src/store/migrations.ts) | Append-only schema-v7 definition/revision tables plus schema-v8 structured observation columns and terminal child table | A rollback/downgrade migration |
| [`packages/core/src/log/request-log.ts`](../../packages/core/src/log/request-log.ts) | One-row pending reservation, append-once terminal overlay, exact LLM query/assertion matching, retention, and stable sequence | Guaranteed audit delivery |
| [`packages/llm-mock/src/planner.ts`](../../packages/llm-mock/src/planner.ts) | Convert credential-free normalized request material and a behavior result into a validated neutral plan | Persistence ownership or request authentication |
| [`packages/llm-mock/src/openai.ts`](../../packages/llm-mock/src/openai.ts) | Pure Chat Completions JSON/error rendering plus complete SSE-frame serialization with payload/immediate cadence metadata | HTTP request parsing, authentication, timed network delivery, or backpressure |
| [`packages/llm-mock/src/edge-stream.ts`](../../packages/llm-mock/src/edge-stream.ts) | Provider-neutral precomputed SSE byte validation, pre-header initial wait, payload-only pacing, one absolute deadline, backpressure-aware writes, and cancellation truncation | Provider parsing, fabricated terminal recovery, or configured midstream errors |
| [`packages/llm-mock/src/observation.ts`](../../packages/llm-mock/src/observation.ts) | Metadata-only reserve/finalize event contract plus fail-open Worker-lifetime scheduling | Persistence, retries, or audit guarantees |
| [`packages/llm-mock/src/openai-http.ts`](../../packages/llm-mock/src/openai-http.ts) | Executable OpenAI operation manifest, bounded JSON/SSE request/model adapter, strict stream options, local provider errors, declared-tool check, fresh transport identity, response ceiling, edge-stream composition, and observation lifecycle emission | Anthropic, state, Responses API, or broad OpenAI parameters |
| [`packages/llm-mock/src/anthropic.ts`](../../packages/llm-mock/src/anthropic.ts) | Pure Messages JSON/error rendering and named SSE-frame serialization with payload/immediate cadence metadata | Version-header enforcement, authentication, timed network delivery, or backpressure |
| [`packages/llm-mock/src/anthropic-http.ts`](../../packages/llm-mock/src/anthropic-http.ts) | Executable Anthropic operation manifest, exact version/auth boundary, bounded request/model adapter, local provider errors, declared-tool check, fresh IDs, response ceiling, edge-stream composition, and observation lifecycle emission | Betas, state, or broad Anthropic parameters |
| [`packages/mcp/src/index.ts`](../../packages/mcp/src/index.ts) and management worker-kit seams | Management registration, environment existence/isolation, provider-key hashing, safe views, and stable problem mapping | Provider HTTP as a configuration interface |
| [`packages/worker-kit/src/mock-llm-runtime.ts`](../../packages/worker-kit/src/mock-llm-runtime.ts) | Current-definition auth, stateless planning, secret rejection, revision recheck, exact selected-revision return, and plan commit inside the Environment Durable Object before edge return | Conversation state or retries across invocations |
| [`packages/worker-kit/src/host-resolver.ts`](../../packages/worker-kit/src/host-resolver.ts), [`edge-router.ts`](../../packages/worker-kit/src/edge-router.ts), and [`environment-do.ts`](../../packages/worker-kit/src/environment-do.ts) | Exact environment route classification, trusted metadata replacement, provider-handler composition, revision-bound observation reservation, and terminal persistence | Wildcard TLS, hosted policy, guaranteed audit delivery, or provider stream policy |
| Official-SDK source tests | Exercise pure OpenAI/Anthropic deserialization and both bounded local Worker routes with inert test credentials | Wrangler network routing, real sockets, remote providers, or broad SDK conformance |

The public repository owns these reusable contracts and pure provider dialects. The
private Cloud product may later consume qualified public exports and add hosted
account, entitlement, quota, and operational policy. Public code must not import or
require the private service.

## Frozen neutral contract

`parseMockLlmPlan` is the trust-boundary parser. It bounds the untrusted object before
recursive Zod parsing, detaches the accepted value from caller-owned input, and
deep-freezes the complete plan before a provider renderer sees it.

| Plan element | Bounded source semantics |
| --- | --- |
| Common identity | Version is exactly `1`; `planId` is `llmp_` plus 43 base64url characters; `requestHash` is 64 lowercase hexadecimal characters; model is 1–256 visible ASCII characters excluding the exact path-special values `.` and `..`; creation time and turn index are non-negative safe integers; seed is 1–256 characters. |
| Success segments | One to 64 segments. Text string length is capped at 64,000 UTF-16 code units. Tool-call IDs are opaque strings capped at 128 characters. Names use the OpenAI/Anthropic intersection `[A-Za-z0-9_-]` and are capped at 64 characters. Input is a bounded JSON object. Text must precede tool calls, tool-call IDs are unique, and a plan containing tools must stop with `tool_use`. |
| Stop | The neutral reasons are `end_turn`, `max_tokens`, `stop_sequence`, and `tool_use`. A matched stop sequence is required only for `stop_sequence` and is capped at 1,024 characters. |
| Usage | Non-negative integer input/output token counts are capped at one billion each. The contract transports counts; this slice does not parse requests or claim provider-accurate tokenization. |
| Cadence | Initial delay is capped at 30 seconds, per-chunk delay at 10 seconds, chunk size at 4,096 Unicode code points, and maximum duration at 60 seconds. Delay values cannot exceed that duration, and one plan can expand to at most 4,096 payload chunks. Both JSON dialects honor initial delay. Both SSE dialects apply it before headers, pace only text/tool payload deltas, emit structural and terminal frames immediately, and treat maximum duration as one absolute budget covering initial wait, pacing, and backpressure. |
| Error | Neutral kinds are `invalid_request`, `authentication`, `permission_denied`, `not_found`, `request_too_large`, `rate_limit`, `timeout`, `internal`, and `overloaded`. Error plans carry the same bounded initial-delay metadata as responses. `retryAfterSeconds` is valid only for rate-limit or overloaded plans and is capped at one day. |
| Whole value | The plan is capped at 256 KiB of UTF-8, depth 16, and 5,000 JSON nodes. Each tool input is separately capped at 64 KiB, depth 16, 2,000 nodes, and 128 top-level keys. Cycles, unsafe keys, non-finite numbers, and provider-specific fields fail closed. |

For response plans, payload frame count is the sum of Unicode code-point chunks of
each text segment and canonical provider tool-argument/input JSON string at
`chunkSize`. The schedule is
valid only when
`initialDelayMilliseconds + Math.max(payloadFrameCount - 1, 0) * chunkDelayMilliseconds`
is strictly less than `maximumDurationMilliseconds`; equality is rejected so the last
planned payload cannot race the absolute deadline. Both neutral-plan validation and
edge-stream preflight enforce this rule.

The corresponding
[`mock-llm.test.ts`](../../packages/contracts/src/mock-llm.test.ts) exercises both
semantic invariants and adversarial structure/size cases. These limits are a versioned
public source contract, not an assertion that a route currently accepts this JSON.

## Planner semantics

`planMockLlmResponse` accepts a shared `BehaviorSpec` plus normalized,
credential-free request material, model, creation time, explicit turn index, seed,
default usage, and default cadence. The request material is capped at 256 KiB, depth
24, and 10,000 nodes before canonical hashing. Before the first asynchronous hash,
the planner synchronously parses, detaches, and freezes the request JSON and
`BehaviorSpec`; it also validates, copies, and freezes model metadata, usage, and cadence
defaults and binds injected state/script methods. Later caller mutation therefore
cannot pair a pre-mutation hash with post-mutation behavior or metadata. Non-finite
numbers, `undefined`, cycles, unsafe keys, and non-object fingerprint roots fail
closed.

Credential-field checks normalize case, camel case, and separators before comparison.
Keys that look like authorization, authentication, cookies, passwords, secrets, API
keys, credentials, private keys, or Bearer values are rejected recursively, as are
singular token fields, credential-token families, JWTs, and assertions. Ordinary
token-count fields such as `max_tokens` and `input_tokens` remain valid fingerprint
material. This is a defense-in-depth constraint on already normalized protocol
input. The current OpenAI adapter supplies normalized message/tool material and omits
transport/internal headers; it also rejects credential reflection before planning
rather than relying on the planner alone.

The planner:

1. snapshots the complete caller-owned planning input synchronously;
2. hashes canonical normalized request material into `requestHash`;
3. evaluates `static`, `template`, `match`, `sequence`, configured `error`, or the
   shared fail-closed script/fallback seam;
4. adapts a string to one text segment or validates an explicit neutral response
   directive. A directive can contain only `segments`, `stopReason`, `stopSequence`,
   `usage`, and `cadence`; its cadence can override chunk delay, chunk size, and
   maximum duration, while evaluator latency alone owns initial delay;
5. carries evaluator latency into response or error
   `initialDelayMilliseconds` metadata without sleeping;
6. rejects configured-error HTTP status/details so provider policy cannot leak into
   the neutral plan;
7. derives a stable `planId` from the complete plan content other than the ID itself;
   and
8. returns the frozen plan, staged writes, and the evaluator's explicit idempotent
   commit callback.

F2 canonical JSON sorts keys with a locale-independent UTF-16 code-unit total order.
This avoids insertion-order-dependent hashes when distinct valid keys collate equally
under a locale, such as composed and decomposed Unicode forms. The older shared core
canonicalizer is deliberately unchanged because altering it could invalidate existing
persisted hashes; F2 keeps this compatibility-sensitive rule local until a separately
reviewed migration can version all existing hash owners.
The detached request and parsed behavior are both normalized into that order before
the shared evaluator runs, so exact `match` selection also remains insertion-order
independent even though the compatibility-sensitive evaluator retains its legacy
canonicalizer.

By default, sequence selection is stateless: `turnIndex` acts as the sequence cursor
and the synthetic state adapter discards its staged write. A caller can inject the
shared behavior-state interface; focused tests prove validation happens before that
explicit commit and that calling the commit twice does not advance twice. No
response-plan/evaluator-state repository, runtime transaction owner, retry record, or
conversation handle exists, so this remains a compositional seam rather than durable
response-state qualification. The separate definition repository does not advance or
persist a turn.

## Pure provider projections

Both renderers accept an already validated neutral plan. They return a plain
description of either one JSON response or a complete array of SSE frame objects.
They never parse a request, read a header, open a stream, sleep, authenticate, log, or
commit state. This includes error-plan initial delay: a renderer preserves the
provider error shape but does not sleep before returning it.

| Behavior | OpenAI projection | Anthropic projection |
| --- | --- | --- |
| Text | Assistant Chat Completions content; adjacent neutral text segments are joined | Ordered Messages text content blocks |
| Tool call | `function` tool call with canonical, key-sorted JSON argument string | Direct `tool_use` block with structured input |
| Stop | `stop`, `length`, or `tool_calls` finish reason | `end_turn`, `max_tokens`, `stop_sequence`, or `tool_use` |
| Usage | Prompt, completion, and derived total token counts | Input/output counts plus the selected nullable/current usage fields |
| Request identity | `x-request-id` response header | `request-id` response header and `request_id` in error envelopes |
| Error | Provider envelope/status mapping for all nine neutral error kinds; overloaded maps to `503` | Provider envelope/status mapping for all nine neutral error kinds; overloaded maps to `529` |
| Retry hint | `Retry-After` only when present on eligible rate-limit/overloaded neutral errors | Same neutral restriction |

The pure fixtures reuse deterministic `planId` as provider object identity and
request-ID correlation. Because `planId` is content-derived, identical plans can
repeat it; this is not a per-invocation uniqueness claim. Both executable HTTP
adapters override transport identity on every invocation and never expose the plan
ID. OpenAI emits fresh random `req_...` and `chatcmpl-...` identities; Anthropic emits
fresh random `req_...` and `msg_...` identities.

OpenAI SSE begins with the assistant-role delta, chunks text and canonical tool
arguments by Unicode code point, emits a terminal finish-reason chunk, optionally
emits the requested empty-choices usage chunk, then emits `data: [DONE]`. If usage was
not requested, neither null-usage fields nor the empty-choices usage chunk are added.
Role, terminal, usage, and `[DONE]` frames are marked immediate; only content and tool
argument deltas are marked as payload cadence. When obfuscation is enabled, regular
delta chunks carry fresh opaque compatibility padding. It defaults on at the HTTP
boundary but is not qualified as upstream size normalization or a security control.

Anthropic SSE serializes the named `message_start`, content-block
start/delta/stop, `message_delta`, and `message_stop` order. Tool input uses
`input_json_delta`; text uses `text_delta`; `message_delta` carries cumulative usage.
The current slice emits no `ping` and no `[DONE]`; clients should still tolerate
upstream `ping`. It cannot inject a mid-stream error after HTTP `200`: an error plan
always renders one provider JSON error before headers, even when `stream: true` was
requested.

The [OpenAI renderer tests](../../packages/llm-mock/src/openai.test.ts),
[Anthropic renderer tests](../../packages/llm-mock/src/anthropic.test.ts), and
[source-attributed fixture note](../../packages/llm-mock/fixtures/README.md) freeze
these exact shapes. The frame arrays are serialization evidence only. The OpenAI HTTP
and Anthropic HTTP adapters compose them with the shared edge-stream helper, which
owns timed delivery, cancellation, the absolute duration/resource budget,
backpressure, and disconnect cleanup.

## Official SDK source-conformance lanes

The workspace pins `openai` `6.49.0` and `@anthropic-ai/sdk` `0.115.0` as development
clients.

The pure
[`sdk-conformance.test.ts`](../../packages/llm-mock/src/sdk-conformance.test.ts) test
injects a custom Fetch implementation into each official SDK and uses inert,
obviously synthetic credentials.

That focused projection test proves that these exact clients:

- construct the expected Chat Completions/Messages and model-list/retrieve paths;
- present the expected OpenAI Bearer header or Anthropic API-key/version headers to
  the injected seam;
- consume JSON text, tool calls, usage, request IDs, immediate text SSE, and
  provider-shaped error objects; OpenAI also consumes default-on compatibility
  padding and an explicitly unpadded stream, while Anthropic consumes named
  text/tool events through its raw iterator; and
- make one error request when client retries are explicitly disabled.

The OpenAI test base ends in `/openai/v1`. The Anthropic test base ends in
`/anthropic` because that SDK appends `/v1`; the test explicitly rejects a doubled
`/v1/v1/` path. These are path-construction assertions against a fake
`https://mockos.test` origin. Model objects in this pure suite remain hand-supplied.

The separate
[`mock-llm.integration.test.ts`](../../apps/worker/test/mock-llm.integration.test.ts)
uses the Cloudflare Worker integration, the official MCP client, and official OpenAI
client with injected routed Fetch. It:

- creates two environments and strict/accept-any definitions through management MCP;
- lists and retrieves ordered model objects through the real bounded provider
  adapter;
- consumes deterministic text, usage, stateless sequence turns, declared function
  tool calls, configured rate limits, missing-model errors, bounded OpenAI streams
  with usage/default-on compatibility padding, and an aborted stream without a
  fabricated terminal success;
- proves environment isolation, fresh request/completion identity, strict credential
  rotation, platform-key denial, and no credential/verifier appearance in returned
  management/log material; and
- disables SDK retries so one configured error remains one invocation.

The companion
[`mock-llm-anthropic.integration.test.ts`](../../apps/worker/test/mock-llm-anthropic.integration.test.ts)
uses the same MCP-configured Worker boundary and official Anthropic client. It
qualifies routed text and tool-input streams, cumulative usage/event order, and SDK
cancellation without a fabricated `message_stop`. Its fixture uses zero configured
chunk delay, so timing and reader-backpressure mechanics remain qualified by the
shared edge-stream package tests rather than by that Worker route test.

This is local Worker source qualification, not a real socket or Wrangler dev-server
round trip. It does not qualify hosted routing, deployment, a broad openai-node
version matrix, or OpenAI parity.

Anthropic's response `anthropic-organization-id` is deliberately absent and
unqualified. The pure kernel has no authenticated account or organization context;
the bounded adapter does not emit or qualify that account-specific header.

## MCP-first integration boundary

mockOS management remains MCP-first. The current source adds
`put_mock_llm_server`, `list_mock_llm_servers`, `get_mock_llm_server`, and
`delete_mock_llm_server` to the management registry. They are MCP-only and operate on
environment-local definitions. The [task guide](../mock-llm.md) documents their exact
inputs, full strict-key resupply, put replay, atomic delete compare-and-swap, safe
reads, secret-safe validation, platform-key-substring rejection, schema-v7 rollback
history plus the current schema-v8 forward-recovery warning, cleanup, and failures.

Observation adds no fifth LLM-definition tool. The existing `get_request_log` and
`assert_requests` schemas now accept the bounded LLM metadata matchers documented in
the task guide. Provider handlers reserve/finalize through the Environment Durable
Object; callers continue to inspect and assert only through management MCP.

There is no reset operation because this slice has no LLM runtime state. It must not
be presented as a console-only or hidden HTTP configuration path. Applications under
test call the separate bounded OpenAI/Anthropic data planes documented in the task
guide and must never send the management Access Key to them. `accept_any` still
requires a valid provider Mock Credential through the dialect's required channel.

## Provider reference baseline

The renderer fixtures are reviewed against primary provider references:

- [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat)
  and [Models reference](https://developers.openai.com/api/reference/resources/models);
- the official [OpenAI TypeScript/JavaScript SDK](https://github.com/openai/openai-node);
- [Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages),
  [Models reference](https://platform.claude.com/docs/en/api/models),
  [API versioning](https://platform.claude.com/docs/en/api/versioning), and
  [API errors](https://platform.claude.com/docs/en/api/errors); and
- the official
  [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

These references bound the tested shapes; they do not turn a local fixture into
provider parity or verified-live evidence. Recheck provider documentation and SDK
versions whenever the bounded request adapter, supported SDK version, Anthropic
target, or streaming target changes.

## Evidence matrix

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Contract parsing tests | Neutral plan fields and invalid-shape rejection | Persistence or wire behavior |
| Server-definition contract tests | Strict write/persisted/safe views, provider-key non-reflection, secret-safe top-level rejection, bounded static-plan compatibility, and mandatory put/delete revisions | Provider routing by themselves |
| Repository and migration tests | Schema-v7 definition persistence plus v7→v8 structured-observation upgrade, canonical put replay, put/delete CAS including ABA denial, monotonic revisions, limits, corruption failure, and older-v7 refusal of v8 | Hosted rollback, audit delivery, or response/conversation state |
| Management MCP/Worker tests | Four tools, environment selection/existence, isolation, full strict-key writes, hashing/safe views, stable conflicts, and platform-key-substring rejection in definition keys/values | HTTP management projection or provider behavior by themselves |
| Planner tests | Behavior-to-plan adaptation, deterministic identifiers/metadata, stateless turns, and validation-before-explicit staged-interface commit | Durable/revision-bound state, runtime transaction ownership, retries, or conversations |
| Pure renderer tests | Selected provider success/error JSON, complete text/tool/usage SSE-frame sequences, and both dialects' payload/immediate cadence labels | Request parsing, version-header/auth enforcement, timed delivery, backpressure, or network behavior |
| Request-log contract/core tests | Complete metadata or configured-error shapes, empty headers/null bodies, enforced pending `102`/`0` compatibility sentinels, actual status/duration only in the append-once terminal child, idempotent terminal replay, conflicting-finalization rejection, retention cleanup, exact false/zero/ordered-array matchers, and cross-source sequences without reorder | Fail-closed delivery, hosted durability, or audit-grade completeness |
| Edge-stream tests | Precomputed UTF-8/body bounds, pre-header initial delay, payload-only pacing, immediate structural/terminal frames, one absolute duration including backpressure, abort/deadline truncation, cleanup, and internal emitted frame/byte accounting | Persisted/queryable frame or byte metadata, provider parsing, configured midstream errors, hosted sockets, or deployment |
| OpenAI HTTP-adapter tests | Exact operation manifest, strict request/tool/auth/body/response limits and stream options, JSON/SSE model projection, provider errors, fresh identity, default-on/disabled obfuscation, preflight failures, initial-delay abort, metadata-only reserve-before-delay without provisional status/duration, completed/cancelled terminal events, configured-error observation, fail-open storage, and no reflection | Environment persistence, upstream size/security parity, or hosted routing |
| Anthropic HTTP-adapter tests | Exact operation manifest, `x-api-key`/stable-version/beta rejection, bounded Messages/tool/model parsing, JSON/named-event SSE, provider-error-before-headers, fresh identity, 2 MiB/timing preflight, metadata-only reservation without provisional status/duration, cancellation/deadline terminal events, initial-delay abort, and no reflection | Broad Anthropic API, configured midstream errors, or hosted routing |
| Environment-runtime tests | Current-definition auth, accept-any/strict separation, rotation linearization, stateless planning, revision recheck, commit inside the Environment Durable Object before edge return, and secret rejection | Stateful conversations or multi-tenant hosted authorization |
| Host-resolution tests | Exact path/subdomain OpenAI/Anthropic classification and trusted internal metadata replacement | Live wildcard TLS or custom-domain routing |
| Edge-router observation integration | Exact selected revision reaches reservation; direct reader cancellation finalizes once as `cancelled` while keeping accepted `200`; reservation failure leaves a valid provider response unchanged | Mounted Worker-pool cancellation propagation, real sockets, or hosted durability |
| Official SDK and mounted Worker/MCP tests | Pinned provider clients deserialize pure projections and exercise both bounded local Worker routes configured through MCP; OpenAI consumes usage/obfuscation streams, Anthropic consumes named text/tool streams with cumulative usage, both abort without fabricated terminal success, and the official MCP client queries/asserts metadata-only completed/configured-error observations | `cancelled` persistence through the Worker-pool service binding, Wrangler network compatibility, hosted connectability, upstream parity, or ecosystem-wide compatibility |
| Generated provider manifest/drift tests | Machine-readable route, auth, limit, planning, unsupported, and evidence contract remains derived from executable source | Deployment or live-provider parity |
| Repository checks | Formatting, links, types, focused tests, and builds for the candidate when recorded green | Hosted CI, merge, publication, Cloud consumption, or deployment |

The original response-kernel and management-definition candidates passed their
focused suites and complete local gates on 2026-07-25. The provider tranches add
focused adapter/runtime/routing/generation coverage and official-SDK local Worker
integrations. Their exact source evidence belongs in the implementation ledger
with the revision carrying the final green gate. None of these tranches implies hosted
CI, merge, publication, Cloud consumption, or deployment.

### Observation evidence levels

| Level | Current bounded claim |
| --- | --- |
| Designed | Yes |
| Implemented | Yes |
| Source-tested | Yes |
| Integration-tested | Yes, at the mounted local Worker/MCP seam |
| SDK/client-qualified | Provider behavior uses pinned OpenAI/Anthropic SDKs; observation query/assertion uses the mounted official MCP client |
| Actual-network-qualified | No |
| Hosted-smoke-verified | No |
| Verified-live | No |
| Production-ready | No |

Cancellation is the narrower edge in that matrix. Direct HTTP-adapter and edge-router
tests prove `cancelled` terminal persistence. The mounted Worker-pool service binding
does not propagate downstream stream reader cancellation through the binding, so its
SDK test proves only that no fabricated terminal provider success appears; it does
not promote mounted cancellation observation to integration-tested.

## Remaining F2 exit work

Before a complete F2 claim, the public implementation still needs:

1. any configured midstream-error semantics only after their provider event,
   cancellation, and resource boundaries are explicitly designed;
2. explicit conversation/version/retry semantics if stateful behavior is added;
3. official SDK clients against Wrangler network routes for normal, error, usage,
   tool-call, streaming, and cancellation cases;
4. broader parameter/version/client conformance only when explicitly chosen;
5. Cloud pinning only after the public candidate is merged and independently
   qualified; and
6. exact-revision hosted CI, staging, production, and documentation evidence kept as
   separate gates.

Until those steps pass, say “MCP-managed definitions plus bounded OpenAI and
Anthropic JSON/SSE provider data planes plus metadata-only request-log
query/assertion are source-qualified locally,” not
“mockOS is generally OpenAI/Anthropic-compatible” and not “F2 is complete.”
