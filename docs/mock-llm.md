# MCP-managed mock OpenAI and Anthropic

Status: Bounded OpenAI and Anthropic non-streaming provider data planes source-qualified locally; F2 remains partial
Last reviewed: 2026-07-25

mockOS is MCP-first. Agents and automation create, inspect, replace, and delete mock
LLM definitions through management MCP. An application under test then calls a
separate, environment-hosted OpenAI- or Anthropic-shaped data plane. Configuration
never moves to provider HTTP, and application traffic never becomes a management API.

The current source-qualified slice supports model list/retrieve plus non-streaming
OpenAI Chat Completions and Anthropic Messages through pinned official JavaScript
SDKs. It is a pair of bounded compatibility subsets, not a general OpenAI or Anthropic API,
deployed service, live-provider comparison, or complete F2 runtime.
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
          schema v7 + monotonic revision

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
| OpenAI Chat Completions | One non-streaming choice with text, function tool calls, usage, deterministic behavior, and provider-shaped configured errors |
| Anthropic Models | Ordered single-page list and exact retrieve |
| Anthropic Messages | One non-streaming message with text/custom `tool_use`, usage, deterministic behavior, and provider-shaped configured errors |
| Authentication | Provider-scoped Bearer for OpenAI and `x-api-key` for Anthropic in both `accept_any` and `strict` modes |
| Version contract | Anthropic requires exactly `anthropic-version: 2023-06-01`; beta headers fail closed |
| Hosting forms | Environment path mode and environment subdomain mode |
| SDK evidence | Pinned `openai` 6.49.0 and `@anthropic-ai/sdk` 0.115.0 through local Worker integrations using injected Fetch |
| Runtime state | Stateless; the prior `assistant` message count selects the turn |
| Timing | Bounded initial response/error delay with abort-aware edge waiting |
| Evidence | Package and local Worker source qualification only |

Streaming, Anthropic beta APIs, the OpenAI Responses API, conversation state, LLM
observations/assertions, Cloud pinning, and deployment remain unavailable.

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
| OpenAI | `POST` | `/chat/completions` | One non-streaming Chat Completion |
| Anthropic | `GET` | `/v1/models` | Ordered configured model list |
| Anthropic | `GET` | `/v1/models/{model}` | One exact configured model |
| Anthropic | `POST` | `/v1/messages` | One non-streaming Message |

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
| `stream` | Absent or `false` |
| `tools` | Optional array of at most 64 unique function definitions |
| `tool_choice` | Absent or exactly `"auto"` |

Unknown top-level fields fail closed. In particular, `response_format`,
`stream_options`, multimodal input, and sampling/token-control fields are not
silently ignored. `stream: true` returns `400 streaming_not_supported`;
`stream_options` is rejected even when `stream` is false. `tool_choice` values
`"none"`, `"required"`, and named-tool objects are unavailable.

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
| Response body | 2,097,152 UTF-8 bytes |

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

Initial response or error delay is honored outside the Environment Durable Object
with abort-aware waiting. With no streaming, chunk delay, chunk size, and maximum
stream duration remain inert cadence metadata. An observed local Fetch abort during
the initial wait returns an empty `499`; this is not SSE or message-level
cancellation support.

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
| `stream` | Absent or `false` |
| `tools` | Optional array of at most 64 unique custom tool definitions |
| `tool_choice` | Absent or exactly `{ "type": "auto" }` |

Unknown top-level fields fail closed. Sampling controls, `stop_sequences`, `metadata`,
`thinking`, service tiers, beta fields, and other broad Messages parameters are
rejected rather than ignored. `stream: true` returns an Anthropic
`400 invalid_request_error`. Required `max_tokens` enters the deterministic request
fingerprint, but this first slice does not synthesize tokenization or truncate a
configured plan: `max_tokens` does not truncate output.

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
each message or tool-result block array is capped at 256 blocks. Response JSON is
capped at 2,097,152 UTF-8 bytes.

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

## Diagnose provider failures

OpenAI local request failures use a bounded OpenAI-shaped envelope and fresh
`x-request-id`:

```json
{
  "error": {
    "message": "The request is not valid for this mock OpenAI endpoint.",
    "type": "invalid_request_error",
    "param": "stream",
    "code": "streaming_not_supported"
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
| `400 streaming_not_supported` | `stream: true` was supplied | Use non-streaming completion |
| `400 credential_reflection_not_allowed` | Body contains a presented provider or platform credential | Remove the credential from all body keys and string values |
| `401 invalid_api_key` | Bearer syntax/policy/verifier failed | Present the provider-scoped Mock Credential; never substitute the management key |
| `404 mock_llm_server_not_found` | Slug is absent or OpenAI is disabled | Inspect the definition through MCP; the provider error deliberately does not distinguish those cases |
| `404 model_not_found` | Configured server has no exact model ID | Probe `/models` and use one returned ID |
| `404 route_not_found` | Relative provider path is unsupported | Use one of the three generated operations |
| `405 method_not_allowed` | Known path used the wrong method | Follow the response `Allow` header |
| `413 request_too_large` | Body, depth, node, or structural budget was exceeded | Reduce the request; do not retry unchanged |
| `500 internal_error` | Runtime failed, definition changed repeatedly, output was invalid/oversized, or a tool call was undeclared | Treat as failed source behavior and inspect non-secret local diagnostics |

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
| `400 invalid_request_error` | Version/beta header, media type, JSON, request field, role/block, tool, or streaming contract failed | Send only the exact stable non-streaming subset |
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

Opening this runtime applies append-only environment **schema v7** for canonical
definition rows and the monotonic LLM revision allocator. It adds no provider-request
log, conversation, response, or evaluator-state table. A v6 store upgrades without
changing F1 rows, while an older v6 bundle refuses a store already touched by schema
v7. Recovery must roll forward to a v7-aware build or use a separately reviewed
migration/export bridge; a source rollback is not a SQLite downgrade.

## Verify and clean up

After the management put:

1. get the definition through MCP and confirm the intended revision, model, and
   provider policies;
2. confirm strict auth appears only as `configured: true`;
3. call OpenAI `GET /models` with Bearer or Anthropic `GET /v1/models` with
   `x-api-key` plus the exact stable version;
4. run one non-streaming text or declared-tool completion/message with SDK retries
   disabled;
5. record only source evidence unless an exact deployment record exists; and
6. delete the definition with the latest positive revision in `finally`.

The general request log does not yet provide LLM-specific observations or assertions.
Do not claim that a successful `get_request_log` call proves a provider invocation,
and do not place provider credentials in prompts to test logging.

Deleting the containing environment also removes its Durable Object state. Prefer
definition-level cleanup when the environment belongs to a larger test, and
environment cleanup when the whole environment is disposable.

## What remains unavailable

This partial slice does not provide:

- OpenAI Responses, Assistants, stored/listed Chat Completions, legacy Completions,
  embeddings, audio, images, or other OpenAI APIs;
- Anthropic beta APIs, legacy Text Completions, Message Batches, token counting,
  Files, Skills, or other Anthropic APIs;
- SSE, timed chunk delivery, `stream_options`, mid-stream errors, or stream
  cancellation for either dialect;
- multimodal messages, JSON response format, sampling/token-control parameters,
  parallel choice counts, named/required/no-tool selection, or general Chat
  Completions compatibility;
- Anthropic multimodal input, thinking, sampling controls, stop sequences, metadata,
  built-in/server tools, non-auto tool choice, turn-alternation validation,
  `tool_use`↔`tool_result` correlation, or real model pagination;
- implicit sessions, conversation handles, persisted sequence/evaluator state,
  reset, or retry deduplication;
- LLM-specific request observations, assertions, or provider request-log capture;
- a mock-LLM management HTTP route, CLI workflow, or console workflow;
- Cloud pinning, private hosted composition, hosted CI qualification, Wrangler
  network qualification, staging, production, or service-level guarantees; or
- verified-live comparison with OpenAI or Anthropic.

Do not call F2 complete. The strongest current wording is:

> MCP-managed definitions plus bounded OpenAI Chat Completions and Anthropic Messages
> non-streaming provider data planes are source-qualified locally through package
> tests and pinned official SDK Worker integrations. Streaming/betas, state,
> observations, Cloud integration, deployment, and live-provider parity remain
> unqualified or unavailable.

## Source ownership and exact reference

| Source | Responsibility |
| --- | --- |
| [`packages/contracts/src/mock-llm-server.ts`](../packages/contracts/src/mock-llm-server.ts) | Strict write/persisted/safe-view definition contracts and bounds |
| [`packages/contracts/src/operations/management.ts`](../packages/contracts/src/operations/management.ts) | Four MCP-only management operations |
| [`packages/core/src/mock-llm/repository.ts`](../packages/core/src/mock-llm/repository.ts) | Canonical definition persistence, revision allocation, replay, and compare-and-swap |
| [`packages/llm-mock/src/planner.ts`](../packages/llm-mock/src/planner.ts) | Provider-neutral deterministic response planning |
| [`packages/llm-mock/src/openai.ts`](../packages/llm-mock/src/openai.ts) | OpenAI JSON and pure SSE-frame projection |
| [`packages/llm-mock/src/openai-http.ts`](../packages/llm-mock/src/openai-http.ts) | Executable OpenAI operation manifest, bounded request adapter, auth-safe errors, model projection, timing, and transport IDs |
| [`packages/llm-mock/src/anthropic.ts`](../packages/llm-mock/src/anthropic.ts) | Anthropic JSON and pure SSE-frame projection |
| [`packages/llm-mock/src/anthropic-http.ts`](../packages/llm-mock/src/anthropic-http.ts) | Executable Anthropic operation manifest, version/auth boundary, bounded Messages adapter, model projection, timing, and fresh transport IDs |
| [`packages/worker-kit/src/mock-llm-runtime.ts`](../packages/worker-kit/src/mock-llm-runtime.ts) | Current-definition authentication, stateless planning, and revision recheck |
| [`packages/worker-kit/src/edge-router.ts`](../packages/worker-kit/src/edge-router.ts) | Environment route composition and edge-owned provider response |
| [`apps/worker/test/mock-llm.integration.test.ts`](../apps/worker/test/mock-llm.integration.test.ts) | MCP-to-Worker official OpenAI SDK source qualification |
| [`apps/worker/test/mock-llm-anthropic.integration.test.ts`](../apps/worker/test/mock-llm-anthropic.integration.test.ts) | MCP-to-Worker official Anthropic SDK 0.115.0 source qualification |
| [`docs/reference/mock-llm-openai.v1.json`](./reference/mock-llm-openai.v1.json) | Generated machine-readable operation, limit, planning, authentication, and evidence contract |
| [`docs/reference/mock-llm-anthropic.v1.json`](./reference/mock-llm-anthropic.v1.json) | Generated machine-readable Anthropic operation, header, limit, planning, authentication, and evidence contract |

The public repository owns this reusable runtime. Private Cloud may consume only a
merged and independently qualified public revision, then add account, entitlement,
quota, console, deployment, and go-to-market policy without making the public runtime
call home.
