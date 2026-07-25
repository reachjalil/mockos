# F2 LLM response-kernel source slice

Status: Partial source implementation with management-only definitions; no mock-LLM data plane or F2 qualification
Last reviewed: 2026-07-25

This slice establishes both a provider-neutral seam for deterministic mock LLM
responses and an MCP-first configuration substrate for future environment-hosted
servers. It proves that one normalized behavior result can become one validated
response plan and then provider-shaped OpenAI or Anthropic JSON/immediate SSE frames.
It also source-implements strict server definitions, four MCP-only operations,
environment-local schema-v7 persistence, mandatory revision compare-and-swap, and
write-only provider credential views. It does **not** make a mock LLM endpoint
available to an application, agent, or SDK.

Read this page as a source-architecture and evidence record. The complete F2 target
remains in the [F-series roadmap](../F_SERIES_ROADMAP.md), and the current negative
product boundary remains in [known limitations](../known-limitations.md).

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
- Schema v7 persists canonical definitions and monotonic revisions transactionally;
  changed replacements require the current revision while canonical retries are
  idempotent. Replacement is full-definition and requires every enabled strict key to
  be resupplied or rotated; delete requires positive revision CAS.

Those are focused local source tests. They are not Wrangler, network, hosted-CI,
deployed, production, or live-provider evidence.

## What is not available

There is no management HTTP route, CLI command, public provider route, provider
request parser or authentication enforcement, model renderer/catalog, conversation
or evaluator state, reset operation, stream timer, observation entry, assertion
matcher, Wrangler round trip, Cloud pin, or deployed endpoint in this slice.

In particular:

- `/e/{environmentId}/llm-mock/{slug}/openai/v1` is a target route, not a route in
  this source;
- `/e/{environmentId}/llm-mock/{slug}/anthropic/v1` is a target route, not a route in
  this source;
- management MCP contains 24 tools, including four MCP-only LLM-definition
  operations; self-hosted management HTTP remains at five routes;
- the Access Key authenticates management MCP, and strict provider Mock Credentials
  are hashed before definition persistence, but no provider route evaluates them;
- no listener emits Server-Sent Events and cadence metadata does not cause a timer;
- the planner has an injectable staged-state seam and a stateless turn-index default,
  but no response/conversation-state owner proves runtime contention, retry, or
  conversation semantics; and
- official-SDK deserialization does not prove an SDK can connect to a real URL.

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
          │       │
          └───┬───┘
              ▼
 official SDK deserialization tests

management agent
       │
       ▼
 four MCP-only definition tools
       │
       ▼
 schema-v7 definition repository
```

The response arrows above remain pure function and in-process test boundaries. The
management branch is composed through the Environment Durable Object and persists
configuration, not responses. There is no provider network listener or edge streamer.

## Source ownership

| Source | Responsibility | Deliberately absent |
| --- | --- | --- |
| [`packages/contracts/src/mock-llm.ts`](../../packages/contracts/src/mock-llm.ts) | Provider-neutral segment, stop, usage, cadence, error, and response-plan validation | Provider JSON, request parsing, routing, storage, or private policy |
| [`packages/contracts/src/mock-llm-server.ts`](../../packages/contracts/src/mock-llm-server.ts) | Strict write/persisted/safe-view server definitions, model/dialect bounds, and provider-key separation | Provider routing or runtime auth enforcement |
| [`packages/contracts/src/operations/management.ts`](../../packages/contracts/src/operations/management.ts) | Four MCP-only definition operations and exact effect/retry/secret metadata | Self-hosted HTTP routes |
| [`packages/core/src/behavior/evaluator.ts`](../../packages/core/src/behavior/evaluator.ts) | Deterministic `BehaviorSpec` evaluation and staged sequence semantics | LLM dialect decisions |
| [`packages/core/src/mock-llm/repository.ts`](../../packages/core/src/mock-llm/repository.ts) | Canonical definition writes, monotonic revision allocation, compare-and-swap, replay, and limits | Conversation, response-plan, or evaluator state |
| [`packages/core/src/store/migrations.ts`](../../packages/core/src/store/migrations.ts) | Append-only schema-v7 definition and revision tables | A rollback/downgrade migration |
| [`packages/llm-mock/src/planner.ts`](../../packages/llm-mock/src/planner.ts) | Convert credential-free normalized request material and a behavior result into a validated neutral plan | Persistence ownership or request authentication |
| [`packages/llm-mock/src/openai.ts`](../../packages/llm-mock/src/openai.ts) | Pure Chat Completions JSON/error rendering and immediate SSE-frame serialization | HTTP request parsing, authentication, a network stream, or edge timing |
| [`packages/llm-mock/src/anthropic.ts`](../../packages/llm-mock/src/anthropic.ts) | Pure Messages JSON/error rendering and immediate SSE-frame serialization | Version-header enforcement, authentication, a network stream, or edge timing |
| [`packages/mcp/src/index.ts`](../../packages/mcp/src/index.ts) and [`packages/worker-kit`](../../packages/worker-kit) | Management registration, environment ownership, provider-key hashing, safe views, and stable problem mapping | Provider data-plane request handling |
| Official-SDK source tests | Exercise client deserialization through injected Fetch using inert test credentials | Wrangler routing, real sockets, remote provider calls, or broad SDK conformance |

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
| Common identity | Version is exactly `1`; `planId` is `llmp_` plus 43 base64url characters; `requestHash` is 64 lowercase hexadecimal characters; model is 1–256 visible ASCII characters; creation time and turn index are non-negative safe integers; seed is 1–256 characters. |
| Success segments | One to 64 segments. Text string length is capped at 64,000 UTF-16 code units. Tool-call IDs are opaque strings capped at 128 characters. Names use the OpenAI/Anthropic intersection `[A-Za-z0-9_-]` and are capped at 64 characters. Input is a bounded JSON object. Text must precede tool calls, tool-call IDs are unique, and a plan containing tools must stop with `tool_use`. |
| Stop | The neutral reasons are `end_turn`, `max_tokens`, `stop_sequence`, and `tool_use`. A matched stop sequence is required only for `stop_sequence` and is capped at 1,024 characters. |
| Usage | Non-negative integer input/output token counts are capped at one billion each. The contract transports counts; this slice does not parse requests or claim provider-accurate tokenization. |
| Cadence | Initial delay is capped at 30 seconds, per-chunk delay at 10 seconds, chunk size at 4,096 Unicode code points, and maximum duration at 60 seconds. Delay values cannot exceed that duration, and one plan can expand to at most 4,096 payload chunks. These fields are inert metadata until an edge streamer exists. |
| Error | Neutral kinds are `invalid_request`, `authentication`, `permission_denied`, `not_found`, `request_too_large`, `rate_limit`, `timeout`, `internal`, and `overloaded`. Error plans carry the same bounded initial-delay metadata as responses. `retryAfterSeconds` is valid only for rate-limit or overloaded plans and is capped at one day. |
| Whole value | The plan is capped at 256 KiB of UTF-8, depth 16, and 5,000 JSON nodes. Each tool input is separately capped at 64 KiB, depth 16, 2,000 nodes, and 128 top-level keys. Cycles, unsafe keys, non-finite numbers, and provider-specific fields fail closed. |

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
input; the future HTTP adapter must still omit transport headers and credentials
rather than relying on this rejection.

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
description of either one JSON response or a complete array of SSE frame strings.
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
repeat it; this is not a per-invocation uniqueness claim. The future edge adapter must
inject unique request and provider-object IDs for each invocation before service
qualification while retaining the plan ID as an internal correlation field.

OpenAI SSE begins with the assistant-role delta, chunks text and canonical tool
arguments by Unicode code point, emits a terminal finish-reason chunk, optionally
emits the requested empty-choices usage chunk, then emits `data: [DONE]`. If usage was
not requested, neither null-usage fields nor the empty-choices usage chunk are added.

Anthropic SSE serializes the named `message_start`, content-block
start/delta/stop, `message_delta`, and `message_stop` order. Tool input uses
`input_json_delta`; text uses `text_delta`. The current slice emits no ping and cannot
inject a mid-stream error after HTTP `200`: an error plan always renders one JSON
error response.

The [OpenAI renderer tests](../../packages/llm-mock/src/openai.test.ts),
[Anthropic renderer tests](../../packages/llm-mock/src/anthropic.test.ts), and
[source-attributed fixture note](../../packages/llm-mock/fixtures/README.md) freeze
these exact shapes. The frame arrays are serialization evidence only. An edge
adapter must still own timed delivery, cancellation, duration/resource enforcement,
and disconnect cleanup.

## Official SDK source-conformance lane

The workspace pins `openai` `6.49.0` and `@anthropic-ai/sdk` `0.115.0` as development
clients. The
[`sdk-conformance.test.ts`](../../packages/llm-mock/src/sdk-conformance.test.ts) test
injects a custom Fetch implementation into each official SDK and uses inert,
obviously synthetic credentials.

The focused test proves that these exact clients:

- construct the expected Chat Completions/Messages and model-list/retrieve paths;
- present the expected OpenAI Bearer header or Anthropic API-key/version headers to
  the injected seam;
- consume JSON text, tool calls, usage, request IDs, immediate text SSE, and
  provider-shaped error objects; and
- make one error request when client retries are explicitly disabled.

The OpenAI test base ends in `/openai/v1`. The Anthropic test base ends in
`/anthropic` because that SDK appends `/v1`; the test explicitly rejects a doubled
`/v1/v1/` path. These are path-construction assertions against a fake
`https://mockos.test` origin, not implemented routing.

The model list/retrieve objects are hand-supplied by the test Fetch harness. There is
no model renderer, catalog, parser, or route. The header assertions observe SDK
request construction; there is no server-side authentication or
`anthropic-version` enforcement. Because no socket, listener, router, Wrangler
runtime, or deployment participates, call this “in-process official-SDK source
conformance,” never endpoint or hosted SDK compatibility.

Anthropic's response `anthropic-organization-id` is deliberately absent and
unqualified. The pure kernel has no authenticated account or organization context;
the future HTTP/auth adapter, not a renderer fixture, must own and qualify that
header.

## MCP-first integration boundary

mockOS management remains MCP-first. The current source adds
`put_mock_llm_server`, `list_mock_llm_servers`, `get_mock_llm_server`, and
`delete_mock_llm_server` to the management registry. They are MCP-only and operate on
environment-local definitions. The [task guide](../mock-llm.md) documents their exact
inputs, full strict-key resupply, put replay, atomic delete compare-and-swap, safe
reads, secret-safe validation, platform-key-substring rejection, schema-v7 rollback
warning, cleanup, and failures.

There is no reset operation because this slice has no LLM runtime state. It must not
be presented as a console-only or hidden HTTP configuration path. Applications under
test will eventually call a separate provider-shaped LLM data plane; they must never
send the management Access Key to that endpoint.

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
versions when the HTTP and streaming adapters are implemented.

## Evidence matrix

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Contract parsing tests | Neutral plan fields and invalid-shape rejection | Persistence or wire behavior |
| Server-definition contract tests | Strict write/persisted/safe views, provider-key non-reflection, secret-safe top-level rejection, bounded static-plan compatibility, and mandatory put/delete revisions | A provider route or runtime auth enforcement |
| Repository and migration tests | Schema-v7 persistence, canonical put replay, put/delete CAS including ABA denial, monotonic revisions, limits, corruption failure, v6 upgrade, and older-v6 refusal of v7 | Hosted rollback or response/conversation state |
| Management MCP/Worker tests | Four tools, environment selection/ownership, full strict-key writes, hashing/safe views, stable conflicts, and platform-key-substring rejection in definition keys/values | HTTP management projection or provider data plane |
| Planner tests | Behavior-to-plan adaptation, deterministic identifiers/metadata, stateless turns, and validation-before-explicit staged-interface commit | Durable/revision-bound state, runtime transaction ownership, retries, or conversations |
| Pure renderer tests | Selected provider success/error JSON and immediate text/tool/usage SSE-frame sequences | Request parsing, version-header/auth enforcement, timed streaming, or network behavior |
| Official SDK tests | Pinned clients deserialize the selected in-process responses | Connectability, Wrangler compatibility, cancellation, or ecosystem-wide compatibility |
| Repository checks | Formatting, links, types, focused tests, and builds for the candidate when recorded green | Hosted CI, merge, publication, Cloud consumption, or deployment |

The original response-kernel candidate passed its focused contract/LLM package suites
and a complete forced repository gate locally on 2026-07-25. The management-definition
tranche adds focused contract, repository/migration, MCP, worker-kit, and Worker
coverage; its strongest exact candidate evidence belongs in the implementation ledger
only after the complete changed-worktree gate is recorded. Neither tranche implies
hosted CI, merge, publication, Cloud consumption, or deployment.

## Required next vertical slice

Before any provider-data-plane F2 claim, the public implementation still needs:

1. provider request parsing, explicit authentication policy, and provider-shaped
   request errors;
2. model list/retrieve rendering and a bounded model catalog projection;
3. exact environment routing and Worker/Durable Object composition;
4. edge-owned SSE cadence, abort behavior, and stream-duration/resource limits;
5. request observation and LLM-specific assertions;
6. real official SDK clients against Wrangler for normal, error, usage, tool-call,
   streaming, and cancellation cases;
7. Cloud pinning only after the public candidate is merged and independently
   qualified; and
8. exact-revision hosted CI, staging, production, and documentation evidence kept as
   separate gates.

Until those steps pass, say “F2 definitions are source-implemented through management
MCP and the response kernel is source-tested,” not “mockOS supports mock
OpenAI/Anthropic APIs” and not “F2 is complete.”
