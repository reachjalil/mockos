# Test an application with the mock OpenAI SDK surface

Status: OpenAI-only non-streaming source workflow; no hosted or deployed qualification
Last reviewed: 2026-07-25

This quickstart creates a deterministic model through management MCP, proves the
separate provider data plane with `GET /models`, and calls non-streaming Chat
Completions through the official OpenAI JavaScript SDK. It uses path-mode URLs from a
local source Worker.

The exact source evidence pins `openai` 6.49.0. A newer SDK may work, but it is outside
this qualification until its own tests pass. Read the
[canonical mock LLM guide](../mock-llm.md) for request bounds, errors, replacement,
security, and unsupported behavior.

## Prerequisites

You need:

- Node 22.12 or newer and pnpm 10.30.2;
- a source Worker running at `http://127.0.0.1:8787`;
- a management MCP client connected to `http://127.0.0.1:8787/mcp`;
- the local platform management Access Key;
- the 24-tool registry, including `put_mock_llm_server`,
  `get_mock_llm_server`, and `delete_mock_llm_server`; and
- only synthetic provider credentials and prompts.

Keep these two credentials different:

```sh
export MOCKOS_API_KEY='replace-with-the-local-management-key'
export MOCKOS_OPENAI_MOCK_CREDENTIAL='synthetic-openai-mock-credential'
```

The first value authorizes management MCP. The second value is the provider-scoped
Bearer Mock Credential used by the application under test. Never send the management
key to the provider URL.

## 1. Create a disposable environment

Through management MCP, call `create_environment`:

```json
{
  "name": "Mock OpenAI quickstart",
  "provider": "entra",
  "seed": "mock-openai-quickstart"
}
```

Retain the returned environment ID and pass it explicitly in every later management
call:

```sh
export MOCKOS_ENVIRONMENT_ID='env_replace_me'
```

Use a `try`/`finally` boundary in automation so the environment is deleted even when
an SDK assertion fails.

## 2. Define one deterministic model through MCP

Call `put_mock_llm_server` with `expectedRevision: null`. Resolve the provider Mock
Credential from caller-owned secret storage before sending the call; the
`<resolved-synthetic-openai-credential>` marker below is not a literal on-wire value.

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
          "apiKey": "<resolved-synthetic-openai-credential>"
        }
      },
      "anthropic": {
        "enabled": false
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

Require a positive returned revision and:

```json
{
  "mode": "strict",
  "configured": true
}
```

for the safe OpenAI authentication view. The result must not contain the plaintext
credential or `apiKeySha256`.

The four definition tools prove that configuration is available; they do not prove
that this checkout contains the provider route. Build the provider base and probe it
next:

```sh
export MOCKOS_ORIGIN='http://127.0.0.1:8787'
export MOCKOS_LLM_SLUG='agent-tests'
export MOCKOS_OPENAI_BASE_URL="${MOCKOS_ORIGIN}/e/${MOCKOS_ENVIRONMENT_ID}/llm-mock/${MOCKOS_LLM_SLUG}/openai/v1"

curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${MOCKOS_OPENAI_MOCK_CREDENTIAL}" \
  "${MOCKOS_OPENAI_BASE_URL}/models"
```

Success returns an OpenAI-shaped list containing `mock-agent-1`. A `404` means the
server is absent or OpenAI is disabled; a `401` means the provider Bearer credential
failed. Do not fall back to the management key.

## 3. Call the official OpenAI SDK

For the exact source-qualified client:

```sh
pnpm add openai@6.49.0
```

Create `mock-openai.mjs`:

```js
import OpenAI from "openai";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const client = new OpenAI({
  apiKey: required("MOCKOS_OPENAI_MOCK_CREDENTIAL"),
  baseURL: required("MOCKOS_OPENAI_BASE_URL"),
  maxRetries: 0,
});

const models = await client.models.list();
if (!models.data.some((model) => model.id === "mock-agent-1")) {
  throw new Error("mock-agent-1 is not available");
}

const model = await client.models.retrieve("mock-agent-1");
if (model.owned_by !== "mockos") {
  throw new Error("unexpected model owner");
}

const completion = await client.chat.completions.create({
  model: "mock-agent-1",
  messages: [{ role: "user", content: "Hello" }],
});

const text = completion.choices[0]?.message.content;
if (text !== "This response is deterministic.") {
  throw new Error(`unexpected response: ${JSON.stringify(text)}`);
}

console.log({
  completionId: completion.id,
  requestId: completion._request_id,
  text,
  usage: completion.usage,
});
```

Run it without shell tracing:

```sh
node mock-openai.mjs
```

Expect:

- a fresh completion ID beginning `chatcmpl-`;
- a fresh request ID beginning `req_`;
- exactly `This response is deterministic.`;
- prompt usage `11`, completion usage `5`, and total usage `16`; and
- no credential or internal deterministic `planId` in output.

The usage values are definition-controlled synthetic values. They are not calculated
by tokenizing the prompt.

## 4. Prove one negative case

Keep `maxRetries: 0`, then choose one bounded negative case:

- call a missing model and require `404 model_not_found`;
- present a different provider Mock Credential and require `401 invalid_api_key`; or
- set `stream: true` and require `400 streaming_not_supported`.

Do not submit the credential inside a prompt. The adapter rejects credential
reflection, and request-log observation is not part of this LLM slice.

## 5. Clean up with the latest revision

In `finally`:

1. call `get_mock_llm_server` with the explicit environment ID and `agent-tests`;
2. pass its current positive revision to `delete_mock_llm_server`;
3. accept `deleted: true`, or `deleted: false` only for an exact cleanup retry;
4. on `409 MOCK_LLM_SERVER_REVISION_CONFLICT`, re-read before deciding whether a
   concurrent replacement belongs to this test; and
5. delete the disposable environment and close the MCP transport.

Never echo the safe-view `configured: true` marker into a replacement put. A strict
replacement must resupply or rotate the raw provider Mock Credential from
caller-owned secret storage.

## Evidence and limitations

This workflow is source-qualified through package tests and the local Worker
integration using the official OpenAI JavaScript SDK with injected Fetch. It does not
prove a Wrangler network round trip, hosted CI, Cloud consumption, staging,
production, or live OpenAI parity.

This OpenAI workflow does not exercise the separately source-qualified bounded
Anthropic route. The current F2 slice still has no SSE, Responses API, multimodal
content, persisted conversation state, reset, LLM observations/assertions, or broad
Chat Completions parameter support. Use the
[machine-readable provider manifest](../reference/mock-llm-openai.v1.json) instead of
guessing from OpenAI's broader API.
