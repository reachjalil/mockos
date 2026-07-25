# MCP-managed mock OpenAI and Anthropic

Status: Bounded OpenAI and Anthropic JSON/SSE plus metadata-only observation/query/assertion source-qualified locally; F2 remains partial
Last reviewed: 2026-07-25

mockOS is MCP-first. Agents and automation create, inspect, replace, and delete mock
LLM definitions through management MCP. An application under test then calls a
separate, environment-hosted OpenAI- or Anthropic-shaped data plane. Configuration
never moves to provider HTTP, and application traffic never becomes a management API.

The current source-qualified slice supports model list/retrieve plus JSON and SSE
OpenAI Chat Completions and Anthropic Messages through pinned official
JavaScript SDKs. Successfully parsed and planned provider POSTs that pass response
preflight also enter the existing management request log as bounded metadata-only
observations that agents can query and assert through MCP. This is a pair of bounded
compatibility subsets, not a general OpenAI or Anthropic API, deployed service,
complete audit trail, live-provider comparison, or complete F2 runtime.
Start with the [OpenAI SDK quickstart](./quickstarts/openai-sdk.md) or
[Anthropic SDK quickstart](./quickstarts/anthropic-sdk.md). The generated
[OpenAI](./reference/mock-llm-openai.v1.json) and
[Anthropic](./reference/mock-llm-anthropic.v1.json) manifests are the
machine-readable authorities for routes, limits, and evidence state.

## Product boundary

```text
agent, automation, or CI
          │
          │ platform management Access Key
          ▼
management MCP /mcp
          │
          ├── put_mock_llm_server
          ├── list_mock_llm_servers
          ├── get_mock_llm_server
          └── delete_mock_llm_server
                     │
                     ▼
          environment-local definition
          schema v8 + monotonic revision

application or provider SDK
          │
          ├── Bearer Mock Credential
          │     └── /llm-mock/{slug}/openai/v1
          │           ├── GET  /models
          │           ├── GET  /models/{model}
          │           └── POST /chat/completions
          │
          └── x-api-key Mock Credential
                + anthropic-version: 2023-06-01
                └── /llm-mock/{slug}/anthropic
                      ├── GET  /v1/models
                      ├── GET  /v1/models/{model}
                      └── POST /v1/messages
                               │
                               ▼
          same environment definition
          deterministic stateless plan
                      │
                      ▼
          one attempted metadata-only request-log row
          get_request_log / assert_requests
```

The source contains exactly **24 management MCP tools**. The four mock-LLM
definition tools are MCP-only. The separate self-hosted management HTTP API remains
exactly **five routes** under `/__mockos/v1`; neither the provider routes above nor
the four definition tools are part of that management HTTP count or its OpenAPI and
typed-client projection.

The provider route is the synthetic dependency called by the application under test.
It is not an alternative way to configure mockOS.

## What this slice supports

| Capability | Current source contract |
| --- | --- |
| Configuration | Four MCP-only definition tools with explicit revision compare-and-swap |
| OpenAI Models | Ordered list and exact retrieve |
| OpenAI Chat Completions | One JSON or SSE choice with text, function tool calls, optional stream usage, deterministic behavior, and provider-shaped configured errors |
| Anthropic Models | Ordered single-page list and exact retrieve |
| Anthropic Messages | One JSON or named-event SSE message with text/custom `tool_use`, usage, deterministic behavior, and provider-shaped configured errors before streaming starts |
| Authentication | Provider-scoped Bearer for OpenAI and `x-api-key` for Anthropic in both `accept_any` and `strict` modes |
| Version contract | Anthropic requires exactly `anthropic-version: 2023-06-01`; beta headers fail closed |
| Hosting forms | Environment path mode and environment subdomain mode |
| SDK evidence | Pinned `openai` 6.49.0 and `@anthropic-ai/sdk` 0.115.0 through local Worker integrations using injected Fetch |
| Runtime state | Stateless; the prior `assistant` message count selects the turn |
| Timing | Shared pre-header initial delay, payload-only SSE pacing, absolute duration/backpressure deadline, 2 MiB preflight, and abort/cancel cleanup |
| Observation | One metadata-only reservation attempt, capped at 50 milliseconds, for each successfully parsed/planned provider POST that passes response preflight; privacy collisions skip the row, and existing MCP tools exact-match persisted rows |
| Evidence | Package and local Worker source qualification only |

Anthropic betas, the OpenAI Responses API, configured mid-stream errors,
conversation state, actual-network qualification, Cloud pinning, and deployment remain
unavailable or unqualified.

## Prerequisites

You need:

- a source build whose management `tools/list` contains the four definition tools;
- a Streamable HTTP MCP client connected to `/mcp`;
- the configured platform management Access Key;
- an existing environment ID;
- a provider-scoped synthetic Mock Credential of 16–1,024 RFC 6750 `b64token`
  characters; and
- an application or official SDK that can set a custom provider `baseURL`.

Use distinct values for the management Access Key and every provider Mock Credential.
Never use a real OpenAI or Anthropic key, customer credential, or production token.

Capability-negotiate before mutation, but do not treat the four management tools as
proof that a provider route is present: those tools existed in the earlier
management-only F2 slice. After configuration, use authenticated `GET /models` as the
non-mutating provider capability probe.

Pass `environmentId` explicitly in saved automation. Omitting it uses the current MCP
transport session's environment cursor; when neither exists, the tool returns
`400 CURRENT_ENVIRONMENT_REQUIRED`.

## Configure through management MCP

The exact operations are:

| Tool | Input | Result | State semantics |
| --- | --- | --- | --- |
| `put_mock_llm_server` | Optional `environmentId`, mandatory `expectedRevision`, and a complete `server` | Safe `{ spec, revision, createdAt, updatedAt }` view | Create or full replacement; canonical replay is idempotent |
| `list_mock_llm_servers` | Optional `environmentId` | `{ servers }` summaries | Safe read |
| `get_mock_llm_server` | Optional `environmentId` and `slug` | Safe full definition view | Safe read |
| `delete_mock_llm_server` | Optional `environmentId`, `slug`, and mandatory positive `expectedRevision` | `{ slug, deleted }` | Atomic compare-and-swap delete |

`env:ro` and `env:rw` are operation metadata until F4 implements and qualifies shared
scoped-key enforcement. Current public management authentication, environment
existence, and environment isolation checks still apply.

### Create a dual-provider definition

Use `expectedRevision: null` for create-only intent. Each enabled dialect has its own
provider-scoped policy and raw write-only Mock Credential:

```json
{
  "environmentId": "env_replace_me",
  "expectedRevision": null,
  "server": {
    "version": 1,
    "slug": "agent-tests",
    "name": "Agent integration tests",
    "dialects": {
      "openai": {
        "enabled": true,
        "authentication": {
          "mode": "strict",
          "apiKey": "synthetic-openai-mock-credential"
        }
      },
      "anthropic": {
        "enabled": true,
        "authentication": {
          "mode": "strict",
          "apiKey": "synthetic-anthropic-mock-credential"
        }
      }
    },
    "models": [
      {
        "id": "mock-agent-1",
        "displayName": "Mock agent model",
        "createdAtEpochSeconds": 0,
        "behavior": {
          "version": 1,
          "type": "static",
          "value": "This response is deterministic."
        }
      }
    ],
    "defaultUsage": {
      "inputTokens": 0,
      "outputTokens": 0
    },
    "defaultCadence": {
      "chunkDelayMilliseconds": 0,
      "chunkSize": 256,
      "maximumDurationMilliseconds": 60000
    }
  }
}
```

The first changed definition in a new environment normally receives revision `1`;
the environment-wide monotonic allocator may return another positive safe integer
when earlier definitions have changed. A safe result represents a strict credential
only as:

```json
{
  "enabled": true,
  "authentication": {
    "mode": "strict",
    "configured": true
  }
}
```

Neither plaintext nor the SHA-256 verifier is returned. List summaries omit
authentication entirely.

An enabled dialect chooses one policy:

- `strict` compares the presented dialect-specific Mock Credential with the current
  stored SHA-256 verifier; or
- `accept_any` stores no verifier and accepts any syntactically valid provider
  Mock Credential through that dialect's required authentication channel.

`accept_any` does **not** make the route unauthenticated. A missing, malformed, or
alternate-header credential still receives a provider-shaped `401`.

### Replace without losing credentials

Every put requires explicit compare-and-swap intent:

- use `null` only when the slug must not exist;
- use the current positive revision for a changed replacement; and
- never infer or increment a revision in the client.

Replacement is a complete write, not a patch. A safe-view
`{ "mode": "strict", "configured": true }` value is intentionally not a write shape.
For every strict provider that remains enabled, load the raw synthetic value from
caller-owned secret storage and resupply or rotate it in the complete replacement.
There is no preserve-existing sentinel and no credential-recovery operation.

The repository checks canonical replay before compare-and-swap. Retrying the exact
same normalized definition is therefore an idempotent success even if the supplied
revision became stale after the first successful call. It returns the current record
without consuming another revision.

A different definition with a missing or stale expectation returns
`409 MOCK_LLM_SERVER_REVISION_CONFLICT`. Read the current safe view, compare it with
the intended change, resolve concurrent edits, and retry against the returned
revision. Do not blindly overwrite.

### Delete with the current revision

Deletion also requires compare-and-swap:

```json
{
  "environmentId": "env_replace_me",
  "slug": "agent-tests",
  "expectedRevision": 7
}
```

A matching current revision returns `deleted: true`. A missing row or exact retry
after a successful delete returns `deleted: false`. A stale revision, including an
old delete retried after delete/recreate, returns
`409 MOCK_LLM_SERVER_REVISION_CONFLICT` and does not remove the replacement.
The lookup, revision comparison, and delete are one atomic compare-and-swap operation.

There is no mock-LLM reset operation. This provider slice has no persisted
conversation, response, or evaluator state.

## Build the provider base URL

Choose the hosting form reported by the operator:

| Dialect | Path-mode base URL | Subdomain-mode base URL |
| --- | --- | --- |
| OpenAI | `<origin>/e/<environmentId>/llm-mock/<slug>/openai/v1` | `https://<environmentId>.<baseDomain>/llm-mock/<slug>/openai/v1` |
| Anthropic | `<origin>/e/<environmentId>/llm-mock/<slug>/anthropic` | `https://<environmentId>.<baseDomain>/llm-mock/<slug>/anthropic` |

For example, a local path-mode definition named `agent-tests` in environment
`env_replace_me` uses these SDK bases:

```text
http://127.0.0.1:8787/e/env_replace_me/llm-mock/agent-tests/openai/v1
http://127.0.0.1:8787/e/env_replace_me/llm-mock/agent-tests/anthropic
```

The resolver percent-decodes the slug once and validates the decoded value. The
request body cannot select an environment, slug, or dialect. Caller-supplied
`x-mockos-*` routing headers are stripped before mockOS adds trusted routing metadata.

Only the six generated provider operations are supported:

| Dialect | Method | Relative path | Outcome |
| --- | --- | --- | --- |
| OpenAI | `GET` | `/models` | Ordered configured model list |
| OpenAI | `GET` | `/models/{model}` | One exact configured model |
| OpenAI | `POST` | `/chat/completions` | One JSON or SSE Chat Completion |
| Anthropic | `GET` | `/v1/models` | Ordered configured model list |
| Anthropic | `GET` | `/v1/models/{model}` | One exact configured model |
| Anthropic | `POST` | `/v1/messages` | One JSON or named-event SSE Message |

Use each SDK base exactly as shown. OpenAI's base already ends in `/v1`; Anthropic's
base intentionally does not because the SDK appends `/v1`.

## Authenticate provider traffic

OpenAI sends:

```http
Authorization: Bearer <provider-scoped-mock-credential>
```

Anthropic sends both:

```http
x-api-key: <provider-scoped-mock-credential>
anthropic-version: 2023-06-01
```

OpenAI accepts only the Bearer channel. Anthropic accepts only `x-api-key` and
requires exactly `anthropic-version: 2023-06-01`; a missing/different version or any
`anthropic-beta`/`anthropic-beta-*` header returns a generic Anthropic
`400 invalid_request_error` before runtime dispatch. The source slice has no beta
allowlist.

Provider requests are rejected before runtime dispatch when they:

- omit or malform the dialect's required credential;
- mix provider channels: OpenAI rejects `X-API-Key`/`X-Anthropic-API-Key`, while
  Anthropic rejects `Authorization`/`X-Anthropic-API-Key`;
- present the active platform management Access Key, including as a substring; or
- place the presented provider credential or active platform key anywhere in the
  Messages or Chat Completions JSON keys or string values.

Strict verification hashes the presented credential before selecting the current
definition and compares the fixed-length SHA-256 verifier without early exit. A
completion/message rechecks the definition revision before committing its plan; a
concurrent replacement causes bounded re-authentication and replanning or a generic
internal failure. Each dialect verifies only its own current credential. Rotation
does not promise to cancel a request that has already passed its final
current-revision check.

Do not send the management Access Key to the provider route. Mock Credentials are
synthetic protocol inputs, not tenant or end-user authorization.

## Discover models

Use authenticated OpenAI `GET /models` or Anthropic `GET /v1/models` as the
dialect-specific capability probe. Each preserves model order from the MCP definition.
OpenAI returns:

```json
{
  "object": "list",
  "data": [
    {
      "id": "mock-agent-1",
      "object": "model",
      "created": 0,
      "owned_by": "mockos"
    }
  ]
}
```

Anthropic returns a single page:

```json
{
  "data": [
    {
      "id": "mock-agent-1",
      "type": "model",
      "display_name": "Mock agent model",
      "created_at": "1970-01-01T00:00:00.000Z",
      "capabilities": null,
      "max_input_tokens": null,
      "max_tokens": null
    }
  ],
  "first_id": "mock-agent-1",
  "last_id": "mock-agent-1",
  "has_more": false
}
```

OpenAI `GET /models/mock-agent-1` and Anthropic
`GET /v1/models/mock-agent-1` return their respective exact model object. Model IDs
are exact, case-sensitive, visible-ASCII strings other than the path-special values
`.` and `..`. A missing model returns the dialect's provider-shaped `404`.

Anthropic model-list pagination query parameters are unsupported/ignored: the adapter
returns the complete bounded catalog as one page with `has_more: false`. Do not claim
cursor, `limit`, `before_id`, or `after_id` semantics from the broader API.

Every OpenAI success receives a fresh `x-request-id`; every Anthropic success receives
a fresh `request-id`. A successful Chat Completion receives a fresh `chatcmpl-...`
body ID and a successful Anthropic Message receives a fresh `msg_...` body ID.
Deterministic internal `planId` values are never exposed as transport identity.

## Call the bounded Chat Completions subset

The request body accepts only these top-level fields:

| Field | Supported form |
| --- | --- |
| `model` | Required configured model ID |
| `messages` | Required array of 1–256 bounded messages |
| `n` | Absent or exactly `1` |
| `stream` | Absent/`false` for JSON; `true` for SSE |
| `stream_options` | Only with `stream: true`; optional Boolean `include_usage` and `include_obfuscation` fields only |
| `tools` | Optional array of at most 64 unique function definitions |
| `tool_choice` | Absent or exactly `"auto"` |

Unknown top-level fields fail closed. In particular, `response_format`, multimodal
input, and sampling/token-control fields are not silently ignored. `stream_options`
is rejected when `stream` is absent or false, when it is not an object, when either
supported value is not Boolean, or when it contains another field. `tool_choice`
values `"none"`, `"required"`, and named-tool objects are unavailable.

### Message forms

| Role | Current form |
| --- | --- |
| `developer`, `system`, `user` | String `content`; optional 1–64-character `[A-Za-z0-9_-]` name |
| `assistant` | String content, or null/omitted content with at least one bounded function `tool_call`; optional valid name |
| `tool` | String content and required 1–256-character `tool_call_id` |

Legacy `function` messages and array/multimodal content are rejected. Each text value
is capped at 65,536 UTF-8 bytes. Assistant tool calls require an ID, literal
`type: "function"`, a valid function name, and an arguments string capped at 65,536
UTF-8 bytes.

Function definitions accept only:

- `type: "function"`;
- `function.name`, unique and matching `[A-Za-z0-9_-]{1,64}`;
- optional string `description`;
- optional JSON-object `parameters`; and
- optional Boolean `strict`.

Each tool value is capped at 65,536 bytes, depth 16, and 2,000 JSON nodes.

### Whole-request and response limits

| Boundary | Limit |
| --- | --- |
| Request body | 262,144 UTF-8 bytes |
| Request JSON | Depth 24 and 10,000 nodes |
| Messages | 256 |
| Tools | 64 |
| Text/tool value | 65,536 UTF-8 bytes |
| JSON or complete precomputed SSE response body | 2,097,152 UTF-8 bytes |

`POST /chat/completions` requires `Content-Type: application/json`; an optional
parameter must be exactly `charset=utf-8`. Missing/other media types and other charset
parameters are rejected. `Content-Encoding` must be absent or `identity`. The adapter
enforces the body ceiling while streaming input even when `Content-Length` is absent,
and invalid UTF-8 or malformed JSON fails before planning.

These limits come from the generated
[provider manifest](./reference/mock-llm-openai.v1.json) and executable request
adapter. Do not copy them into a client without versioning the assumption.

## Understand deterministic behavior

The selected model's declarative behavior produces a provider-neutral immutable plan,
which is then rendered into the selected bounded OpenAI or Anthropic response:

- `static` returns fixed text or a fixed neutral response directive;
- `template` renders bounded request-derived values;
- `match` selects a deterministic branch;
- `sequence` selects a step from the stateless turn index;
- `error` returns the configured provider-shaped error; and
- `script` requires an explicit declarative fallback until F3 supplies a sandbox.

The runtime is stateless. It derives `turnIndex` by counting prior messages whose role
is `assistant`; other accepted roles do not increment it. A first user-only call is
turn zero. To select the next sequence step, include the prior assistant response in
the next request. There is no implicit session, conversation handle,
retry-deduplication record, or resettable LLM state.

Normalized messages, declared tool names and definitions, dialect, operation, and
model enter the deterministic request fingerprint. Authorization and internal routing
headers do not. OpenAI returns configured default usage as `prompt_tokens`,
`completion_tokens`, and derived `total_tokens`; Anthropic returns it as
`input_tokens` and `output_tokens`. mockOS does not tokenize request text or claim
provider-accurate accounting.

Planning and its staged behavior commit complete inside the Environment Durable
Object after the current definition revision is rechecked and before the plan returns
to the edge. The current default remains stateless: `sequence` selection comes only
from `turnIndex`, so this commit writes no conversation or evaluator cursor.

For either dialect, initial response or configured-error delay is honored before
response headers with abort-aware waiting. An observed Fetch abort during that wait
returns an empty `499`. For a successful SSE response, `chunkSize` splits text and
canonical tool arguments/input JSON by Unicode code point.
`chunkDelayMilliseconds` paces only payload deltas. OpenAI role, terminal, optional
usage, and `data: [DONE]` frames are immediate. Anthropic message/content-block
structural events are immediate; only `text_delta` and `input_json_delta` frames are
paced.

One absolute maximum duration, `maximumDurationMilliseconds`, covers the initial
wait, payload pacing, and backpressure. A schedule is admissible only when
`initialDelayMilliseconds + Math.max(payloadFrameCount - 1, 0) * chunkDelayMilliseconds`
is strictly less than `maximumDurationMilliseconds`; equality is rejected so the
last planned payload does not race the deadline. The payload frame count is derived
by Unicode code-point chunking of every text segment and canonical tool-argument
string/tool-input JSON at `chunkSize`.

Before returning HTTP `200`, the edge precomputes the whole SSE body, enforces the
2,097,152-byte UTF-8 ceiling, and rejects an inadmissible schedule or other preflight
failure with generic JSON. After `200`, client cancellation or expiry of that absolute
deadline truncates the stream, clears pending work, and does not fabricate a terminal
chunk, usage chunk, OpenAI `[DONE]`, or Anthropic `message_stop`.

The Durable Object has already rechecked the definition and completed the selected
plan commit before the edge receives the plan. In the current stateless slice that
commit writes no conversation/evaluator cursor. A future stateful implementation
must separately qualify plan reuse, retries, and abort semantics; post-header stream
cancellation cannot roll back the already completed Durable Object commit.

### Stream OpenAI output

With `stream: true`, OpenAI emits an assistant-role chunk, zero or more text or
function-argument payload deltas, a terminal finish-reason chunk, an optional usage
chunk, then `data: [DONE]`. Tool-call identity, index, type, and function name appear
on the first delta for that call; later deltas continue its canonical JSON argument
string.

`include_usage` defaults to false. When true, regular chunks carry `usage: null` and
one empty-choices usage chunk appears immediately before `[DONE]`. If cancellation or
the deadline interrupts the stream, that final usage chunk is not guaranteed.

`include_obfuscation` defaults to true. Regular delta chunks receive fresh,
response-scoped opaque compatibility padding; set it to false to omit that field.
mockOS does not claim to reproduce OpenAI's undisclosed padding distribution,
payload-size normalization, or security properties. Padding counts toward the
complete response-byte ceiling.

## Use function tools

A behavior-selected tool call is served only when the request declares a function
with the same name. Otherwise mockOS fails closed with a generic `500 internal_error`
instead of returning an undeclared tool.

A supported response uses the normal Chat Completions function-call shape:

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "refusal": null,
        "tool_calls": [
          {
            "id": "call_weather_1",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\":\"Berlin\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

The application may append that assistant message and a matching `tool` result to a
later request. Only the assistant message advances `turnIndex`.

## Call the bounded Anthropic Messages subset

`POST /v1/messages` accepts only:

| Field | Supported form |
| --- | --- |
| `model` | Required configured model ID |
| `max_tokens` | Required safe integer from 1 through 1,000,000,000 |
| `messages` | Required array of 1–256 bounded `user`/`assistant` messages |
| `system` | Optional bounded string; an array of system blocks is rejected |
| `stream` | Absent/`false` for JSON; `true` for named-event SSE |
| `tools` | Optional array of at most 64 unique custom tool definitions |
| `tool_choice` | Absent or exactly `{ "type": "auto" }` |

Unknown top-level fields fail closed. Sampling controls, `stop_sequences`, `metadata`,
`thinking`, service tiers, beta fields, and other broad Messages parameters are
rejected rather than ignored. `stream` must be Boolean when present; this subset has
no Anthropic `stream_options` field. Required `max_tokens` enters the deterministic
request fingerprint, but this first slice does not synthesize tokenization or
truncate a configured plan: `max_tokens` does not truncate output.

Each message has exactly `role` and `content`. Content may be a bounded string or an
array of 1–256 supported blocks:

| Message role | Supported content blocks |
| --- | --- |
| `user` | `text` and `tool_result` |
| `assistant` | `text` and `tool_use` |

A `text` block contains only `type: "text"` and a string. An assistant `tool_use`
block contains only `type`, a 1–256-character `id`, a valid tool `name`, and an
object `input`. A user `tool_result` contains only `type`, a 1–256-character
`tool_use_id`, optional string or non-empty text-block-array `content`, and optional
Boolean `is_error`.

The parser enforces those shapes and bounds but not the broader conversation grammar:
it does not require user/assistant turn alternation, and it does not correlate a
`tool_use`↔`tool_result` ID pair. Tests that need those semantics must assert them in
the application under test; mockOS does not currently reject an unmatched history ID.

Custom tool definitions accept only:

- unique `[A-Za-z0-9_-]{1,64}` `name`;
- optional bounded string `description`;
- required `input_schema` object with `type: "object"`; and
- optional literal `type: "custom"`.

Built-in/server tools and named/any/none tool choice are unsupported. A
behavior-selected `tool_use` is served only when its name appears in the request's
declared tools; otherwise mockOS fails closed with a generic Anthropic `500
api_error`.

Anthropic uses the same whole-request limits as the OpenAI adapter: 262,144 UTF-8
bytes, depth 24, 10,000 JSON nodes, 256 messages, 64 tools, and 65,536 UTF-8 bytes per
text/tool value. Each tool value is additionally bounded to depth 16 and 2,000 nodes;
each message or tool-result block array is capped at 256 blocks. Response JSON or the
complete precomputed SSE body is capped at 2,097,152 UTF-8 bytes.

A successful text plan returns a provider-shaped Message:

```json
{
  "id": "msg_fresh_transport_identity",
  "type": "message",
  "role": "assistant",
  "model": "mock-agent-1",
  "content": [
    {
      "type": "text",
      "text": "This response is deterministic.",
      "citations": null
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 11,
    "output_tokens": 5,
    "service_tier": "standard"
  }
}
```

The complete exact response fields and limits are generated in the
[Anthropic provider manifest](./reference/mock-llm-anthropic.v1.json).

### Stream Anthropic output

With `stream: true`, Anthropic uses named SSE events and JSON `data` values in this
successful order:

1. `message_start`;
2. for each response segment, `content_block_start`, zero or more
   `content_block_delta` payloads, and `content_block_stop`;
3. `message_delta`; and
4. `message_stop`.

Text payloads use `delta.type: "text_delta"`. Tool-input payloads use
`delta.type: "input_json_delta"` and carry a canonical JSON substring in
`partial_json`; clients concatenate the substrings before parsing. There is no
`[DONE]` sentinel on the Anthropic wire. The final `message_delta` reports cumulative
usage. mockOS emits no `ping` event; clients intended to work against Anthropic
upstream should still tolerate that upstream event.

Only those two payload-delta kinds consume configured cadence. The named
message/content-block structural events are immediate. The shared preflight, 2 MiB
UTF-8 cap, absolute initial/pacing/backpressure deadline, and pre-header versus
post-header failure boundary described above apply unchanged.

## Observe and assert provider calls

The existing management MCP tools `get_request_log` and `assert_requests` now
understand bounded OpenAI and Anthropic lifecycle metadata. No new LLM-only
management tool or provider-side inspection route is added.

An observation is reserved only after a Chat Completions or Messages `POST` is
successfully parsed and planned and its JSON serialization or complete SSE preflight
has passed. Model catalog reads, unsupported routes or methods, authentication and
Anthropic version failures, invalid content/JSON/request shapes, missing models,
planning failures, and response serialization/preflight failures do not create an
LLM observation. A configured provider error is a successful plan and is observed.

Reservation happens before provider delay and before response headers, but the edge
waits at most 50 milliseconds for it. Failure, timeout, or a credential collision in
any prospective durable metadata serves the valid provider response without treating
the row as reserved. A storage hook which cannot be cancelled can still finish after
the edge timeout; that late row remains `pending` because no terminal finalization is
scheduled. A successful in-budget reservation creates one logical request-log row with
`llmOutcome: "pending"`. Terminal finalization overlays the same row rather than
appending a second entry, so its request ID and append sequence do not change. The
terminal outcomes are:

| Outcome | Meaning |
| --- | --- |
| `completed` | The selected JSON response or complete SSE stream was delivered. A configured error that was delivered as provider JSON is also `completed`; use `llmErrorKind` and `responseStatus` to distinguish it from a success plan. |
| `cancelled` | The request signal or stream reader cancelled before completion. An accepted stream retains its selected HTTP status, normally `200`; a pre-header abort can finalize with `499`. |
| `deadline_exceeded` | The absolute provider delivery deadline expired. A pre-header deadline failure is returned as generic `500`; a post-header deadline truncates the accepted stream. |
| `failed` | A non-deadline provider delay, response construction, or stream delivery failure terminated the planned call. |

Exact terminal replay is idempotent. A conflicting second terminal result is rejected,
and finalization after retention has already trimmed the reservation is a no-op. A
query sees the actual delivered `responseStatus` and elapsed `durationMs` only after
terminal finalization. Because the legacy request-log columns are non-null, a
still-`pending` row exposes the explicit compatibility sentinels
`responseStatus: 102` and `durationMs: 0`. Those values mean only “terminal metadata
not persisted”; they are not a planned or delivered status/duration.

### Metadata contract

Every LLM entry uses `source: "inbound"`, `protocol: "http"`, method `POST`, the
actual environment request path, the fresh provider request ID as both `id` and
`correlationId`, and the exact server revision returned by the runtime's final
definition recheck. The LLM-specific fields are:

| Field | Meaning |
| --- | --- |
| `llmDialect` | Exact `openai` or `anthropic` provider dialect; it also matches `provider` |
| `llmOperation` | Exact `chat.completions.create` or `messages.create` operation for that dialect |
| `llmServerSlug`, `llmServerRevision` | Selected definition identity and exact positive revision |
| `llmModel`, `llmStream`, `llmTurnIndex` | Requested model, accepted request's Boolean streaming intent, and stateless prior-assistant count. A configured error can have `llmStream: true` while being returned as pre-header JSON. |
| `llmOutcome`, `llmResponseId` | Pending/terminal lifecycle and preallocated provider response/message ID. `llmResponseId` exists only for response plans and is omitted for configured errors. |
| `llmInputTokens`, `llmOutputTokens`, `llmStopReason`, `llmToolNames` | Complete response-plan metadata. Tool names preserve plan order and duplicates; tool inputs are excluded. |
| `llmErrorKind` | Configured neutral error kind, mutually exclusive with the four response-plan fields |
| `responseStatus`, `durationMs` | Actual delivered HTTP status and monotonic elapsed integer milliseconds after terminal finalization; pending rows expose only the `102`/`0` compatibility sentinels |

The existing request-log fields `requestHeaders` and `responseHeaders` are always
empty objects for LLM entries; `requestBody` and `responseBody` are always `null`.
mockOS does not persist prompts, provider outputs, credentials, headers, tool inputs,
`planId`, or `requestHash` in this contract.

Before reservation, a request-local privacy guard checks the complete observation,
the actual routed path, exact server revision, pending sentinels, every possible
terminal outcome, and candidate response statuses against the presented Mock
Credential and platform key. Final status and duration are checked again before
terminal persistence. If any value would disclose a credential—including an
`accept_any` credential deliberately chosen to equal an operation, path component,
or terminal outcome—the entire observation is skipped while the provider response
continues.

The edge stream helper internally counts emitted frames and UTF-8 bytes so direct
stream tests can prove terminal accounting.
Frame and byte counts are internal test accounting only.
They are not persisted or queryable, are not returned by `get_request_log`, and
cannot be used by `assert_requests`.

### Query exact metadata

`get_request_log` accepts every LLM field in the table above as an exact filter in
addition to the existing source/provider/protocol/method/path/status filters. Boolean
`false`, integer zero, and an empty `llmToolNames` array are real exact values rather
than omitted filters. `llmToolNames` matches the complete ordered array, including
duplicates.

For example, after resolving the current definition revision through MCP:

```json
{
  "environmentId": "env_replace_me",
  "llmDialect": "openai",
  "llmOperation": "chat.completions.create",
  "llmServerSlug": "agent-tests",
  "llmServerRevision": 7,
  "llmModel": "mock-agent-1",
  "llmStream": false,
  "llmOutcome": "completed",
  "limit": 100
}
```

The result contains one entry per provider invocation, not one row for reservation
and another for finalization. A configured `rate_limit` plan that was successfully
delivered can be selected exactly with `llmErrorKind: "rate_limit"`,
`llmOutcome: "completed"`, and `status: 429`.

### Assert counts and ordered sequences

`assert_requests` accepts the same exact matchers at the top level and inside each
ordered `sequence` step. Count assertions retain the existing `atLeast`, `atMost`, or
`exactly` contract. Sequence assertions remain greedy-earliest, non-overlapping
subsequences in append order; finalization never reorders an observation.

```json
{
  "environmentId": "env_replace_me",
  "sequence": [
    {
      "llmDialect": "openai",
      "llmOperation": "chat.completions.create",
      "llmTurnIndex": 0,
      "llmOutcome": "completed"
    },
    {
      "llmDialect": "openai",
      "llmOperation": "chat.completions.create",
      "llmTurnIndex": 1,
      "llmStopReason": "tool_use",
      "llmToolNames": ["get_weather"],
      "llmOutcome": "completed"
    }
  ],
  "count": {
    "exactly": 1
  }
}
```

### Observation evidence boundary

Observation is deliberately fail-open and best-effort. Reservation failure or a
privacy collision cannot change the provider response, and reservation waiting is
bounded to 50 milliseconds. A failed reservation creates no entry; a timed-out
non-cancellable storage attempt can still create a late `pending` entry. If terminal
persistence fails, the provider response still proceeds and the reserved row can
remain `pending`. The completion hook is scheduled through the Worker lifetime when
available, but it is not a retrying audit queue. Do not use this slice as a complete,
tamper-evident, billing, security-audit, or compliance record.

| Evidence level | Status for this bounded observation slice |
| --- | --- |
| Designed | Yes: strict metadata, lifecycle, privacy, query, assertion, and append-order contracts are explicit. |
| Implemented | Yes: schema v8, provider hooks, Environment Durable Object reservation/finalization, and existing MCP query/assertion projections are wired. |
| Source-tested | Yes: contracts, v7→v8 migration, append-once terminal persistence, exact matchers, fail-open behavior, terminal stream accounting, and privacy are covered. |
| Integration-tested | Yes: mounted local Worker tests drive official provider SDK calls, then query and assert observations through the official MCP client. |
| SDK/client-qualified | Bounded: the pinned OpenAI/Anthropic SDK claim applies to provider behavior. Observation query/assertion itself is qualified through the mounted Worker and MCP-client tests, not a separate provider-SDK contract. |
| Actual-network-qualified | No: no real socket or `wrangler dev` observation journey is recorded. |
| Hosted-smoke-verified | No. |
| Verified-live | No provider account or tenant was contacted. |
| Production-ready | No: Cloud pinning, rollout, durability/load, and operated audit guarantees are unqualified. |

Direct HTTP-adapter and edge-router tests prove a reader cancellation finalizes as
`cancelled` without rewriting an already accepted `200`. The local Worker-pool
service binding used by the mounted SDK suite does not propagate downstream stream
reader cancellation back through that binding, so the mounted Worker observation
assertions do not claim `cancelled` persistence. They do separately prove SDK
cancellation omits fabricated OpenAI/Anthropic terminal success.

## Diagnose provider failures

OpenAI local request failures use a bounded OpenAI-shaped envelope and fresh
`x-request-id`:

```json
{
  "error": {
    "message": "The request is not valid for this mock OpenAI endpoint.",
    "type": "invalid_request_error",
    "param": "stream_options",
    "code": "invalid_request"
  }
}
```

The adapter does not reflect malformed request values, credentials, verifier
material, runtime exceptions, or validation-library details.

| Status/code | Meaning | Recovery |
| --- | --- | --- |
| `400 invalid_json` | Body is missing, malformed JSON, or invalid UTF-8 | Send bounded UTF-8 JSON |
| `400 invalid_content_type` | Media type or charset is unsupported | Use `application/json` with optional UTF-8 charset |
| `400 unsupported_content_encoding` | Compressed/other content encoding was supplied | Send identity/unencoded JSON |
| `400 invalid_request` | Shape, role, field, model syntax, choice count, or tool contract is invalid | Use only the documented subset and inspect `param` when present |
| `400 credential_reflection_not_allowed` | Body contains a presented provider or platform credential | Remove the credential from all body keys and string values |
| `401 invalid_api_key` | Bearer syntax/policy/verifier failed | Present the provider-scoped Mock Credential; never substitute the management key |
| `404 mock_llm_server_not_found` | Slug is absent or OpenAI is disabled | Inspect the definition through MCP; the provider error deliberately does not distinguish those cases |
| `404 model_not_found` | Configured server has no exact model ID | Probe `/models` and use one returned ID |
| `404 route_not_found` | Relative provider path is unsupported | Use one of the three generated operations |
| `405 method_not_allowed` | Known path used the wrong method | Follow the response `Allow` header |
| `413 request_too_large` | Body, depth, node, or structural budget was exceeded | Reduce the request; do not retry unchanged |
| `500 internal_error` | Runtime failed, definition changed repeatedly, output was invalid/oversized, a tool call was undeclared, or SSE preflight could not satisfy its byte/timing contract | Treat as failed source behavior and inspect non-secret local diagnostics |

Configured neutral errors always remain provider-shaped JSON responses after their
pre-header delay and before HTTP `200`, even when the request asked for streaming.
This slice cannot inject
a configured error after SSE has started. Post-`200` cancellation, deadline, or
delivery failure is an incomplete stream without OpenAI `[DONE]` or Anthropic
`message_stop`, not a fabricated provider-error event or successful completion.

Anthropic local failures use a bounded envelope and put the same fresh ID in the
`request-id` header and `request_id` body field:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "The request is not valid for this mock Anthropic endpoint."
  },
  "request_id": "req_fresh_transport_identity"
}
```

| Status/type | Meaning | Recovery |
| --- | --- | --- |
| `400 invalid_request_error` | Version/beta header, media type, JSON, request field, role/block, tool, or streaming contract failed | Send only the exact stable JSON/SSE subset |
| `401 authentication_error` | `x-api-key` syntax/policy/current verifier failed | Present the Anthropic-scoped Mock Credential; never substitute an Authorization or management key |
| `404 not_found_error` | Server/dialect, model, or route is unavailable | Probe `/v1/models` and inspect the definition through MCP |
| `405 invalid_request_error` | A known route used the wrong method | Follow the response `Allow` header |
| `413 request_too_large` | Body, depth, node, or structural budget was exceeded | Reduce the request; do not retry unchanged |
| `500 api_error` | Runtime failed, definition changed repeatedly, output was invalid/oversized, or a tool call was undeclared | Treat as failed source behavior and inspect non-secret local diagnostics |

Neither adapter reflects malformed values, credentials, verifier material, runtime
exceptions, or validation-library details.

Configured neutral behavior errors map to provider-specific status/type tables:

| Neutral error | OpenAI status | Anthropic status/type |
| --- | --- | --- |
| `invalid_request` | 400 | `400 invalid_request_error` |
| `authentication` | 401 | `401 authentication_error` |
| `permission_denied` | 403 | `403 permission_error` |
| `not_found` | 404 | `404 not_found_error` |
| `request_too_large` | 413 | `413 request_too_large` |
| `rate_limit` | 429 | `429 rate_limit_error` |
| `timeout` | 408 | `504 timeout_error` |
| `internal` | 500 | `500 api_error` |
| `overloaded` | 503 | `529 overloaded_error` |

`Retry-After` appears only when an eligible configured `rate_limit` or `overloaded`
plan supplies it. Set `maxRetries: 0` during deterministic tests so an SDK does not
turn one planned error into multiple provider calls.

## Safe credential and persistence boundary

The platform management Access Key authenticates `/mcp`; it is never a provider Mock
Credential. The public Worker rejects the complete active platform key as a substring
anywhere in bounded submitted definition JSON, and the Environment Durable Object
repeats that defense before persistence.

For every enabled strict dialect:

1. `put_mock_llm_server` accepts `apiKey` only on the write;
2. the Environment Durable Object computes SHA-256 before repository entry;
3. only `apiKeySha256` appears in the private persisted definition; and
4. safe put/get results expose only `configured: true`.

Put accepts only the top-level `environmentId`, `expectedRevision`, and `server`
fields. Unknown top-level arguments collapse to one generic, secret-safe validation
issue so neither their name nor value is echoed. Nested definition objects are strict.
Never use a real credential merely because mockOS tests non-reflection.

Opening this runtime applies append-only environment **schema v8**. Schema v7 already
owns canonical definition rows and the monotonic LLM revision allocator; v8 adds
nullable structured LLM columns to the existing request log plus an append-once
terminal child table keyed by request ID. Reads join that terminal state back into
one logical row. No prompt/output table, conversation, response, or evaluator-state
table is added.

A v7 store upgrades without rewriting existing request-log rows. An older v7 bundle
refuses a store already touched by schema v8. Recovery must roll forward to a v8-aware
build or use a separately reviewed migration/export bridge; a source rollback is not
a SQLite downgrade.

## Verify and clean up

After the management put:

1. get the definition through MCP and confirm the intended revision, model, and
   provider policies;
2. confirm strict auth appears only as `configured: true`;
3. call OpenAI `GET /models` with Bearer or Anthropic `GET /v1/models` with
   `x-api-key` plus the exact stable version;
4. run one JSON or SSE OpenAI completion or Anthropic message with
   SDK retries disabled;
5. poll `get_request_log` for the fresh provider response/request ID and a terminal
   `llmOutcome`, then use `assert_requests` for the exact count or ordered sequence;
6. treat an absent or still-`pending` entry as inconclusive because observation is
   fail-open, not as proof that the provider call did not occur;
7. record only source evidence unless an exact deployment record exists; and
8. delete the definition with the latest positive revision in `finally`.

Never place a provider credential in a prompt to test logging. Credential reflection
is rejected before planning, so that invalid request is intentionally unobserved.

Deleting the containing environment also removes its Durable Object state. Prefer
definition-level cleanup when the environment belongs to a larger test, and
environment cleanup when the whole environment is disposable.

## What remains unavailable

This partial slice does not provide:

- OpenAI Responses, Assistants, stored/listed Chat Completions, legacy Completions,
  embeddings, audio, images, or other OpenAI APIs;
- Anthropic beta APIs, legacy Text Completions, Message Batches, token counting,
  Files, Skills, or other Anthropic APIs;
- configured OpenAI or Anthropic mid-stream error injection, or guaranteed provider
  terminal events after cancellation;
- multimodal messages, JSON response format, sampling/token-control parameters,
  parallel choice counts, named/required/no-tool selection, or general Chat
  Completions compatibility;
- Anthropic multimodal input, thinking, sampling controls, stop sequences, metadata,
  built-in/server tools, non-auto tool choice, turn-alternation validation,
  `tool_use`↔`tool_result` correlation, or real model pagination;
- implicit sessions, conversation handles, persisted sequence/evaluator state,
  reset, or retry deduplication;
- prompt/output/header/body capture, tool-input capture, frame/byte telemetry,
  guaranteed observation delivery, or an audit-grade retry queue;
- LLM observations for model reads, authentication/version/parse/model-selection
  failures, or response preflight failures;
- a mock-LLM management HTTP route, CLI workflow, or console workflow;
- Cloud pinning, private hosted composition, hosted CI qualification, Wrangler
  network qualification, staging, production, or service-level guarantees; or
- verified-live comparison with OpenAI or Anthropic.

Do not call F2 complete. The strongest current wording is:

> MCP-managed definitions plus bounded JSON/SSE OpenAI Chat Completions and
> Anthropic Messages plus metadata-only request-log query/assertion are
> source-qualified locally through package tests and pinned official SDK Worker/MCP
> integrations. Anthropic betas, configured mid-stream errors, state, actual-network
> qualification, Cloud integration, deployment, and live-provider parity remain
> unqualified or unavailable.

## Source ownership and exact reference

| Source | Responsibility |
| --- | --- |
| [`packages/contracts/src/mock-llm-server.ts`](../packages/contracts/src/mock-llm-server.ts) | Strict write/persisted/safe-view definition contracts and bounds |
| [`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts) | Structured LLM request-log entry, terminal, query, count, and sequence matcher contracts |
| [`packages/contracts/src/operations/management.ts`](../packages/contracts/src/operations/management.ts) | Four MCP-only management operations |
| [`packages/core/src/mock-llm/repository.ts`](../packages/core/src/mock-llm/repository.ts) | Canonical definition persistence, revision allocation, replay, and compare-and-swap |
| [`packages/core/src/log/request-log.ts`](../packages/core/src/log/request-log.ts) | One-row reservation, append-once terminal overlay, exact query/assertion matching, retention, and pagination |
| [`packages/llm-mock/src/planner.ts`](../packages/llm-mock/src/planner.ts) | Provider-neutral deterministic response planning |
| [`packages/llm-mock/src/observation.ts`](../packages/llm-mock/src/observation.ts) | Fail-open provider reservation/finalization hook and Worker-lifetime scheduling |
| [`packages/llm-mock/src/openai.ts`](../packages/llm-mock/src/openai.ts) | OpenAI JSON and pure SSE-frame projection |
| [`packages/llm-mock/src/openai-http.ts`](../packages/llm-mock/src/openai-http.ts) | Executable OpenAI operation manifest, bounded request adapter, auth-safe errors, model projection, edge-stream integration, and transport IDs |
| [`packages/llm-mock/src/anthropic.ts`](../packages/llm-mock/src/anthropic.ts) | Anthropic JSON and pure SSE-frame projection |
| [`packages/llm-mock/src/anthropic-http.ts`](../packages/llm-mock/src/anthropic-http.ts) | Executable Anthropic operation manifest, version/auth boundary, bounded Messages adapter, model projection, edge-stream integration, and fresh transport IDs |
| [`packages/llm-mock/src/edge-stream.ts`](../packages/llm-mock/src/edge-stream.ts) | Shared complete-body/schedule preflight, edge-owned cadence, backpressure/deadline enforcement, and cancellation cleanup |
| [`packages/worker-kit/src/mock-llm-runtime.ts`](../packages/worker-kit/src/mock-llm-runtime.ts) | Current-definition authentication, stateless planning, and revision recheck |
| [`packages/worker-kit/src/edge-router.ts`](../packages/worker-kit/src/edge-router.ts) | Environment route composition, exact selected-revision handoff, and observation lifecycle bridge |
| [`packages/worker-kit/src/environment-do.ts`](../packages/worker-kit/src/environment-do.ts) | Metadata-only request-log reservation and terminal persistence |
| [`apps/worker/test/mock-llm.integration.test.ts`](../apps/worker/test/mock-llm.integration.test.ts) | MCP-to-Worker official OpenAI SDK source qualification plus mounted observation query/assertion |
| [`apps/worker/test/mock-llm-anthropic.integration.test.ts`](../apps/worker/test/mock-llm-anthropic.integration.test.ts) | MCP-to-Worker official Anthropic SDK 0.115.0 source qualification plus mounted observation query/assertion |
| [`docs/reference/mock-llm-openai.v1.json`](./reference/mock-llm-openai.v1.json) | Generated machine-readable operation, limit, planning, authentication, and evidence contract |
| [`docs/reference/mock-llm-anthropic.v1.json`](./reference/mock-llm-anthropic.v1.json) | Generated machine-readable Anthropic operation, header, limit, planning, authentication, and evidence contract |

The public repository owns this reusable runtime. Private Cloud may consume only a
merged and independently qualified public revision, then add account, entitlement,
quota, console, deployment, and go-to-market policy without making the public runtime
call home.
