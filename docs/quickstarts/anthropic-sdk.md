# Test an application with the mock Anthropic SDK surface

Status: Anthropic JSON/SSE source workflow; no hosted or deployed qualification
Last reviewed: 2026-07-25

This quickstart creates a deterministic model through management MCP, proves the
separate provider data plane with authenticated `GET /v1/models`, and calls
JSON and streaming Messages through the official Anthropic JavaScript SDK. It uses a
path-mode URL from a local source Worker.

The exact source evidence pins `@anthropic-ai/sdk@0.115.0`. A newer SDK may work, but
it is outside this qualification until its own tests pass. Read the
[canonical mock LLM guide](../mock-llm.md) for request bounds, provider errors,
replacement, security, and unsupported behavior. The
[machine-readable Anthropic manifest](../reference/mock-llm-anthropic.v1.json) is
generated from the executable adapter.

## Prerequisites

You need:

- Node 22.12 or newer and pnpm 10.30.2;
- a source Worker running at `http://127.0.0.1:8787`;
- a management MCP client connected to `http://127.0.0.1:8787/mcp`;
- the local platform management Access Key;
- the 27-tool registry, including `put_mock_llm_server`,
  `get_mock_llm_server`, and `delete_mock_llm_server`; and
- only synthetic provider credentials, model data, and prompts.

Keep the management and provider credentials different:

```sh
export MOCKOS_API_KEY='replace-with-the-local-management-key'
export MOCKOS_ANTHROPIC_MOCK_CREDENTIAL='synthetic-anthropic-mock-credential'
```

The first value authorizes management MCP. The second is the provider-scoped
`x-api-key` Mock Credential used by the application under test. Never send the
management Access Key to an Anthropic-shaped provider URL, and never use a real
Anthropic key in a definition or fixture.

## 1. Create a disposable environment

Through management MCP, call `create_environment`:

```json
{
  "name": "Mock Anthropic quickstart",
  "provider": "entra",
  "seed": "mock-anthropic-quickstart"
}
```

Retain the returned environment ID and pass it explicitly in every later management
call:

```sh
export MOCKOS_ENVIRONMENT_ID='env_replace_me'
```

Use a `try`/`finally` boundary in automation so cleanup still runs after a failed SDK
assertion.

## 2. Define one deterministic model through MCP

Call `put_mock_llm_server` with `expectedRevision: null`. Resolve the provider Mock
Credential from caller-owned secret storage before sending the call; the
`<resolved-synthetic-anthropic-credential>` marker below is not a literal on-wire
value.

```json
{
  "environmentId": "env_replace_me",
  "expectedRevision": null,
  "server": {
    "version": 1,
    "slug": "agent-tests",
    "name": "Anthropic agent integration tests",
    "dialects": {
      "openai": {
        "enabled": false
      },
      "anthropic": {
        "enabled": true,
        "authentication": {
          "mode": "strict",
          "apiKey": "<resolved-synthetic-anthropic-credential>"
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
      "inputTokens": 11,
      "outputTokens": 5
    },
    "defaultCadence": {
      "chunkDelayMilliseconds": 0,
      "chunkSize": 256,
      "maximumDurationMilliseconds": 60000
    }
  }
}
```

Require a positive returned revision and this safe Anthropic authentication view:

```json
{
  "mode": "strict",
  "configured": true
}
```

The result must not contain the plaintext credential or `apiKeySha256`. The
`configured: true` marker is read-only; it cannot preserve a secret in a later
replacement. Every changed full-definition put must resupply or rotate the raw key
from caller-owned secret storage. In `accept_any` mode there is no verifier to compare,
so every syntactically valid `x-api-key` Mock Credential is accepted; missing,
malformed, or alternate-channel credentials are still rejected.

The four definition tools prove that MCP configuration exists. They do not prove that
this checkout serves Anthropic provider traffic. Build and probe the provider base:

```sh
export MOCKOS_ORIGIN='http://127.0.0.1:8787'
export MOCKOS_LLM_SLUG='agent-tests'
export MOCKOS_ANTHROPIC_BASE_URL="${MOCKOS_ORIGIN}/e/${MOCKOS_ENVIRONMENT_ID}/llm-mock/${MOCKOS_LLM_SLUG}/anthropic"

curl --fail-with-body --silent --show-error \
  -H "x-api-key: ${MOCKOS_ANTHROPIC_MOCK_CREDENTIAL}" \
  -H "anthropic-version: 2023-06-01" \
  "${MOCKOS_ANTHROPIC_BASE_URL}/v1/models"
```

Success returns an Anthropic-shaped single-page list containing `mock-agent-1`.
A `404` means the server is absent or Anthropic is disabled. A `401
authentication_error` means the provider Mock Credential failed. A `400
invalid_request_error` before dispatch usually means the exact
`anthropic-version: 2023-06-01` header is absent/wrong or beta headers were sent.
Do not fall back to the management key.

## 3. Call the official Anthropic SDK

Install the exact source-qualified client:

```sh
pnpm add @anthropic-ai/sdk@0.115.0
```

Create `mock-anthropic.mjs`:

```js
import Anthropic from "@anthropic-ai/sdk";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const client = new Anthropic({
  apiKey: required("MOCKOS_ANTHROPIC_MOCK_CREDENTIAL"),
  baseURL: required("MOCKOS_ANTHROPIC_BASE_URL"),
  maxRetries: 0,
});

const models = await client.models.list();
if (!models.data.some((model) => model.id === "mock-agent-1")) {
  throw new Error("mock-agent-1 is not available");
}

const model = await client.models.retrieve("mock-agent-1");
if (model.display_name !== "Mock agent model") {
  throw new Error("unexpected model metadata");
}

const message = await client.messages.create({
  model: "mock-agent-1",
  max_tokens: 64,
  messages: [{ role: "user", content: "Hello" }],
});

const text = message.content.find((block) => block.type === "text")?.text;
if (text !== "This response is deterministic.") {
  throw new Error(`unexpected response: ${JSON.stringify(text)}`);
}

console.log({
  messageId: message.id,
  requestId: message._request_id,
  text,
  usage: message.usage,
});
```

Run it without shell tracing:

```sh
node mock-anthropic.mjs
```

Expect:

- a fresh message ID matching `msg_` plus 32 lowercase hexadecimal characters;
- a fresh `request-id` surfaced by the SDK as `_request_id`, matching `req_` plus
  32 lowercase hexadecimal characters;
- exactly `This response is deterministic.`;
- synthetic usage with `input_tokens: 11` and `output_tokens: 5`; and
- no provider credential, stored verifier, or internal deterministic `planId`.

The SDK supplies `x-api-key` and the supported stable Anthropic version header.
mockOS accepts exactly `anthropic-version: 2023-06-01`; it does not negotiate a
different version. Definition-controlled usage is not calculated by tokenizing the
prompt.

## 4. Stream a Message through the SDK

Set `stream: true` and consume the official SDK's raw async iterator:

```js
const stream = await client.messages.create({
  model: "mock-agent-1",
  max_tokens: 64,
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

const eventTypes = [];
let streamedText = "";
for await (const event of stream) {
  eventTypes.push(event.type);
  if (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta"
  ) {
    streamedText += event.delta.text;
  }
}

if (streamedText !== "This response is deterministic.") {
  throw new Error(`unexpected streamed response: ${JSON.stringify(streamedText)}`);
}
if (eventTypes.at(0) !== "message_start" || eventTypes.at(-1) !== "message_stop") {
  throw new Error(`unexpected event order: ${JSON.stringify(eventTypes)}`);
}
```

The wire uses named SSE events with a JSON `data` line. The exact successful order is
`message_start`, then `content_block_start`, zero or more
`content_block_delta` events, `content_block_stop`, `message_delta`, and
`message_stop`. Each text payload delta has type `text_delta`; streamed custom-tool
arguments use `input_json_delta`. `message_delta` carries cumulative usage. Anthropic
Messages does not use an OpenAI-style `[DONE]` sentinel. mockOS emits no `ping`
event, although a reusable client should tolerate the upstream protocol's `ping`.

Only text and canonical tool-input JSON payload deltas consume configured chunk
cadence. Message/content-block structural events are immediate. Initial delay happens
before response headers, and one absolute `maximumDurationMilliseconds` covers that
initial wait, payload pacing, and reader backpressure. The complete precomputed SSE
body is capped at 2,097,152 UTF-8 bytes.

Preflight requires
`initialDelayMilliseconds + Math.max(payloadFrameCount - 1, 0) * chunkDelayMilliseconds`
to be strictly less than `maximumDurationMilliseconds`; equality fails generically
before HTTP `200`. An abort during the pre-header delay returns an empty `499`.
Cancellation, reader close, or deadline after HTTP `200` truncates the stream without
fabricating `message_stop`.

## 5. Exercise a custom tool

The bounded Messages subset accepts only custom client tools. A tool definition needs
a unique `[A-Za-z0-9_-]{1,64}` name and an `input_schema` object whose `type` is
`"object"`. When a configured behavior returns a `tool_use` block, the same tool name
must be declared in the request or mockOS fails closed.

```js
const toolMessage = await client.messages.create({
  model: "mock-tool-1",
  max_tokens: 64,
  messages: [{ role: "user", content: "Check Berlin" }],
  tools: [
    {
      name: "get_weather",
      description: "Return synthetic weather.",
      input_schema: {
        type: "object",
        properties: { location: { type: "string" } },
      },
    },
  ],
});
```

Use `stream: true` on the same request to exercise incremental
`input_json_delta.partial_json` frames. Concatenate them before parsing; structural
`content_block_start` and `content_block_stop` events remain immediate.

Supported history blocks are:

- `text` in either `user` or `assistant` content;
- `tool_use` only in `assistant` content; and
- `tool_result` only in `user` content, with string content or an array of text
  blocks.

This structural acceptance is intentionally narrower and looser than broad Anthropic
semantics: the first slice does not enforce user/assistant turn alternation or verify
that a `tool_result.tool_use_id` corresponds to an earlier `tool_use.id`.

## 6. Prove bounded negative cases

Keep `maxRetries: 0`, then require the exact failure:

- with the strict definition above, use a different provider Mock Credential and
  require `401 authentication_error`;
- omit or change `anthropic-version: 2023-06-01` on a direct Fetch and require
  `400 invalid_request_error`;
- send any `anthropic-beta` or `anthropic-beta-*` header and require
  `400 invalid_request_error`;
- send an unknown top-level field or a non-Boolean `stream` and require
  `400 invalid_request_error`; or
- call a missing model and require `404 not_found_error`.

The provider accepts only `x-api-key`. `Authorization`, `x-anthropic-api-key`, an
OpenAI Bearer Mock Credential, and the platform management Access Key are rejected.
Do not place either accepted credential in request JSON: request and response
credential reflection fail closed.

Configured error plans are still provider-shaped JSON failures before HTTP `200`;
configured midstream error events after `200` are unsupported.

## 7. Clean up with the latest revision

In `finally`:

1. call `get_mock_llm_server` with the explicit environment ID and `agent-tests`;
2. pass its current positive revision to `delete_mock_llm_server`;
3. accept `deleted: true`, or `deleted: false` only for an exact cleanup retry;
4. on `409 MOCK_LLM_SERVER_REVISION_CONFLICT`, re-read before deciding whether a
   concurrent replacement belongs to this test;
5. confirm the removed provider route returns stable `404 not_found_error`; and
6. delete the disposable environment and close the MCP transport.

Never echo the safe-view `configured: true` marker into a replacement put. A strict
replacement must resupply or rotate the raw Anthropic Mock Credential.

## Evidence and limitations

This workflow is source-qualified through package tests and the local Worker
integration using official `@anthropic-ai/sdk@0.115.0` with injected Fetch. It gives
no hosted or deployed qualification and does not prove a Wrangler network round trip,
Cloud consumption, staging, production, service availability, or live Anthropic
parity.

The selected response plan is revision-rechecked and committed in the
Environment Durable Object before it returns to the edge for streaming. The current planner is
stateless, so that commit does not advance conversation/evaluator state. Future
persisted state needs a separate, explicitly qualified plan-reuse and abort design;
post-header cancellation does not roll back the already completed plan commit.

The current provider slice has no beta APIs, multimodal input, thinking, sampling
controls, stop sequences, metadata, built-in/server tools, non-auto tool choice,
configured midstream errors, durable conversation/evaluator state, or reset.
Successfully parsed/planned calls that pass response preflight attempt a metadata-only
request-log reservation within a 50-millisecond fail-open budget; prospective
metadata/credential collisions skip it. Use the
[`get_request_log`/`assert_requests` guide](../mock-llm.md#observe-and-assert-provider-calls)
for exact matchers and its privacy/evidence boundary. Model-list pagination query
parameters are ignored and the response is always one page. Required `max_tokens` is validated from
`1` through `1,000,000,000` and enters the deterministic fingerprint; `max_tokens`
does not truncate a configured response plan.

Use the generated [Anthropic provider manifest](../reference/mock-llm-anthropic.v1.json)
instead of guessing from Anthropic's broader API.
