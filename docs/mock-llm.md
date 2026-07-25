# Mock LLM management definitions

Status: Four management-only F2 operations are source-implemented; the provider data plane remains unavailable
Last reviewed: 2026-07-25

mockOS is MCP-first. The current source can create, list, inspect, and delete a
bounded mock LLM server definition inside an environment through management MCP.
This is the configuration plane for a future OpenAI- and Anthropic-shaped test
dependency. It is not yet a mock LLM service, and no application or SDK can call the
definition.

Use this guide to understand the exact source contract, safe credential handling,
revision rules, persistence boundary, cleanup, and remaining work. Use the
[F2 kernel record](./f-series/f2-llm-kernel.md) for the neutral plan and pure renderer
architecture, and [implementation status](./IMPLEMENTATION_STATUS.md) before making
an evidence or deployment claim.

## Capability boundary

```text
agent or automation
       │
       │ management Access Key
       ▼
management MCP /mcp
       │
       ├── put_mock_llm_server
       ├── list_mock_llm_servers
       ├── get_mock_llm_server
       └── delete_mock_llm_server
                │
                ▼
        Environment Durable Object
                │
                ▼
    schema-v7 definition + revision rows

application or official SDK
       │
       └── OpenAI/Anthropic provider route ── unavailable
```

The management registry contains **24 MCP tools**. The four operations on this page
are MCP-only, so the self-hosted HTTP projection remains exactly **five routes**. Do
not invent a management HTTP path for them. The machine-readable catalog deliberately
keeps `future.mockLlmApis.status` and `providerDataPlane` set to `unavailable` while
recording the four source-implemented definition operations.

## Prerequisites

You need:

- a source build containing the four operations;
- a Streamable HTTP MCP client connected to `/mcp`;
- the configured management Access Key;
- an existing environment ID; and
- only synthetic definition material and Mock Credentials.

Run `tools/list` and require the exact operations before creating state. Pass
`environmentId` explicitly in automation. If it is omitted, the MCP transport
session's current-environment cursor is used; when neither exists, the tool returns
`400 CURRENT_ENVIRONMENT_REQUIRED`.

The placeholders `$MOCKOS_OPENAI_MOCK_CREDENTIAL` and
`$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL` mean “load a synthetic provider-specific value
from the caller's secret store.” They are not valid on-wire credentials and must not
be copied literally into tool arguments. A real tool call contains the resolved
synthetic value, such as the obviously inert examples below.

## Management operations

| Tool | Input | Result | Effect and retry |
| --- | --- | --- | --- |
| `put_mock_llm_server` | Optional `environmentId`, mandatory `expectedRevision`, and `server` | Safe `{ spec, revision, createdAt, updatedAt }` view | `env:rw`; idempotent mutation |
| `list_mock_llm_servers` | Optional `environmentId` | `{ servers }` summaries | `env:ro`; safe read |
| `get_mock_llm_server` | Optional `environmentId` and `slug` | Safe full definition view | `env:ro`; safe read |
| `delete_mock_llm_server` | Optional `environmentId`, `slug`, and mandatory positive `expectedRevision` | `{ slug, deleted }` | `env:rw`; idempotent atomic-CAS delete |

`env:ro` and `env:rw` are contract metadata until F4 supplies and qualifies shared
scoped-key enforcement. Current management authentication and environment-existence
checks still apply.

There is no reset operation. This slice persists definitions and a revision
allocator, but it has no conversation, response-plan, sequence, or evaluator-state
rows to reset.

## Create a definition

Call `put_mock_llm_server` with `expectedRevision: null` to state create-only intent:

```json
{
  "environmentId": "env_test01",
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

A successful result returns revision `1` for the first changed definition in a new
environment, or another positive safe integer when the environment's LLM revision
allocator has already advanced. Success means only that the definition was validated
and persisted. It does not create a provider route.

Both dialect properties are mandatory, and at least one must be enabled. An enabled
dialect chooses either:

- `accept_any`, which stores no provider key; or
- `strict`, which accepts a provider-scoped Mock Credential only on the write.

Because provider auth enforcement does not exist yet, neither mode affects incoming
traffic in this tranche. Define distinct synthetic OpenAI and Anthropic credentials
now so future route tests do not accidentally blur their trust boundaries.

## Compare-and-swap replacement and retry

`expectedRevision` is mandatory on every put:

- use `null` only when the slug must not exist;
- use the current positive revision when changing an existing definition; and
- never infer or auto-increment a revision in the client.

Read the current safe view, reconstruct the full desired definition, then send that
returned revision. A changed replacement atomically compares the revision and consumes
the next environment-wide monotonic LLM revision. A create/delete/recreate sequence
never reuses an earlier revision.

Replacement is not a patch. The safe view deliberately is not round-trippable:
`configured: true` is not a write shape, and there is no preserve-existing sentinel
or credential-recovery operation. For every enabled provider that should remain
`strict`, the caller must resupply or rotate its complete `apiKey` from caller-owned
secret storage. Reconstruct the replacement as follows:

1. read the safe view and retain its revision;
2. construct the full desired version-one server, including every model, behavior,
   default, and both provider dialects;
3. replace each strict safe-view marker with
   `{ "mode": "strict", "apiKey": "<resolved synthetic value>" }` loaded from the
   caller's secret store;
4. use `{ "mode": "accept_any" }` only when intentionally removing strict checking,
   or `{ "enabled": false }` when intentionally disabling that provider; and
5. call `put_mock_llm_server` with the complete server and the revision read in step
   one.

Sending a get result back unchanged fails schema validation. Omitting an enabled
strict provider's key is not interpreted as “keep the old key.” Resupplying the same
key retains the same stored verifier; rotating it is a real definition change and
consumes a new revision.

The repository checks a canonical replay before compare-and-swap. Retrying the exact
same normalized definition is therefore an idempotent success, even when the supplied
expectation is now stale; it returns the existing record and consumes no revision.
This canonical replay rule makes a timed-out successful write safe to retry.

A different definition with a missing or stale expectation fails with:

- status `409`;
- code `MOCK_LLM_SERVER_REVISION_CONFLICT`; and
- recovery guidance to read the current revision and retry the changed mutation
  against it.

Do not blindly overwrite after this conflict. Compare the current definition with
the intended change and resolve concurrent edits explicitly.

Deletion requires the current positive `expectedRevision`.
Delete uses atomic compare-and-swap. A different current revision returns
`409 MOCK_LLM_SERVER_REVISION_CONFLICT` without deleting anything. A matching
revision returns `deleted: true`. A missing or retried delete returns
`deleted: false`, which makes retry after a successful deletion safe. If the slug was
deleted and recreated at a newer revision, retrying an old delete conflicts instead
of removing the replacement.

For example, after a get returns revision `7`, delete with:

```json
{
  "environmentId": "env_test01",
  "slug": "agent-tests",
  "expectedRevision": 7
}
```

## Safe credential views

The management Access Key authenticates `/mcp`; it is never a provider Mock
Credential. The public Worker rejects any bounded submitted mock-LLM definition that
contains the full active platform Access Key as a substring. It scans JSON keys or string values,
including either strict provider-key field or behavior/model material.
The Environment Durable Object repeats that whole-definition defense after parsing and
before persistence. A value such as `prefix-<active-key>-suffix` is rejected; this is
broader than exact equality.

For each enabled strict dialect:

1. `put_mock_llm_server` accepts `apiKey` as a write-only request field;
2. the Environment Durable Object computes SHA-256 before calling the repository;
3. only `apiKeySha256` is present in the private persisted definition; and
4. put/get results expose neither plaintext nor verifier, only
   `authentication: { mode: "strict", configured: true }`; list summaries omit
   authentication entirely.

Strict keys and their verifiers are also rejected if copied into names, model
metadata, behaviors, or other returned definition material. Request-secret metadata
marks the put arguments for redaction. Treat all synthetic provider traffic as
potentially observable test data anyway and never use a real OpenAI, Anthropic,
mockOS, or customer credential.

Put accepts only the top-level `environmentId`, `expectedRevision`, and `server`
fields. Unknown top-level fields receive one generic, secret-safe validation issue;
their names and values are not reflected. Nested server objects are strict too.
Focused MCP tests place a strict credential in duplicate model IDs, malformed nested
objects, and an unknown top-level JSON key and prove the pre-handler error never
serializes it.

## Definition contract and bounds

| Area | Source contract |
| --- | --- |
| Servers | At most 64 definitions per environment; slug is 1–64 lowercase letters, digits, or internal hyphens |
| Whole definition | Version exactly `1`; at most 256 KiB UTF-8, depth 24, and 10,000 JSON nodes |
| Dialects | Exact `openai` and `anthropic` properties; at least one enabled |
| Strict Mock Credential | 16–1,024 RFC 6750 `b64token` characters |
| Models | 1–64 models with unique 1–256-character visible-ASCII IDs |
| Model metadata | Trimmed display name of 1–128 characters and a non-negative safe-integer creation time |
| Defaults | Usage defaults to zero input/output tokens; cadence defaults to 0 ms chunk delay, 256 code points, and 60 seconds maximum |
| Behavior | Shared bounded `static`, `template`, `sequence`, `match`, `error`, or exact-version `script` contract |

Every static definition goes through bounded neutral-plan validation before
persistence. Static text or a neutral response directive must fit the neutral
response-plan bounds. Configured errors use only neutral LLM error kinds and cannot
contain provider-specific HTTP status/detail fields. Until F3 supplies a sandbox,
`script` requires an explicit declarative fallback. These validation rules make stored
definitions compatible with the pure F2 planner seam; they do not execute a request.

## Persistence and rollback warning

Opening the current Environment Durable Object applies append-only **schema v7**.
That migration adds:

- `mock_llm_servers`, holding canonical definition JSON, revision, and timestamps;
- an updated-time index; and
- `mock_llm_revision_allocator`, holding the monotonic environment-wide counter.

The migration adds no provider-response, conversation, observation, or evaluator-state
table. Writes are transactional and accepted definitions are serialized canonically.
Persisted rows and the allocator fail closed when their identity, canonical JSON,
parsed contract/bounds, or monotonicity are inconsistent.

Schema version is a runtime compatibility boundary. Focused migration tests prove a
v6 store upgrades to v7 without changing its F1 mock-MCP rows. They also prove an
older v6 bundle refuses a store already touched by the newer schema v7 with “database
schema version 7 is newer than supported version 6,” while leaving the store at v7.
The safe operational posture is forward-recovery: roll forward to a v7-aware build or
use a separately reviewed migration/export bridge. Do not assume a source rollback
can downgrade SQLite state, and do not cite a local migration test as hosted rollback
evidence.

## Diagnose failures

| Symptom | Meaning | Safe response |
| --- | --- | --- |
| `400 CURRENT_ENVIRONMENT_REQUIRED` | No explicit environment and no valid session cursor | Pass the intended `environmentId` |
| SDK input-schema error | Missing `expectedRevision`, a safe-view `configured` marker was sent as a write, an unknown top-level argument was rejected secret-safely, or a slug/key/model/behavior/bound is invalid | Reconstruct the full strict write shape and correct arguments before handler entry |
| `404 MOCK_LLM_SERVER_NOT_FOUND` | `get_mock_llm_server` cannot find that slug | Re-list the selected environment; do not guess |
| `409 MOCK_LLM_SERVER_REVISION_CONFLICT` | Create-only intent found a row, a changed replacement used a stale revision, or delete no longer matches the current revision | Read, compare, and retry the intended mutation with the current revision |
| `409 MOCK_LLM_SERVER_LIMIT` | The environment already has 64 definitions | Delete an unused definition before creating another |
| `409 MOCK_LLM_SERVER_REVISION_LIMIT` | The safe-integer revision allocator is exhausted | Stop mutations and recover the environment deliberately |
| `deleted: false` | The positive-revision delete found no row, normally because it was already completed | Treat cleanup as complete after confirming the environment; a recreated row would conflict |

An authenticated connected source build is still not deployment evidence. If the four
tools are absent, do not route around capability negotiation with SQL, an invented
HTTP endpoint, or a console-only operation.

## Verify and clean up

After a put:

1. call `get_mock_llm_server` with the same explicit environment and slug;
2. confirm the intended model/dialects and returned revision;
3. confirm every strict dialect reads as `configured: true`;
4. confirm no plaintext credential or SHA-256 verifier appears in the result; and
5. record only the minimum non-secret source evidence needed by the test.

When finished, retain the revision returned by get/put and call
`delete_mock_llm_server` with that positive `expectedRevision`. On a conflict, re-read
before deciding whether the newer definition should be deleted. Deleting the whole
environment also removes its Durable Object state through the existing environment
lifecycle. There is no reset operation because no LLM runtime state exists.

## What remains unavailable

The `mockLlmApis` data plane remains unavailable. The current management-only slice
has:

- no provider route for OpenAI Chat Completions, OpenAI Models, Anthropic Messages,
  or Anthropic Models;
- no provider request parser, version-header validation, or auth enforcement;
- no model renderer or model catalog;
- no state/reset operation, no conversation handle, and no persisted plan or
  evaluator state;
- no observation or LLM-specific request assertion;
- no paced stream, network timer, abort cleanup, or edge duration enforcement;
- no Wrangler round trip or official SDK client connected to a real local URL;
- no hosted CI qualification for this tranche, no deployment, and no production
  acceptance; and
- no Cloud pin or private hosted integration.

The pure kernel can render selected JSON and immediate SSE frame arrays in process.
That is source architecture, not a listener. Do not configure the roadmap route
`/e/{environmentId}/llm-mock/{slug}/{provider}/v1`, report that OpenAI or Anthropic
SDKs can connect, or call F2 complete.

## Source ownership and next work

| Source | Responsibility |
| --- | --- |
| [`packages/contracts/src/mock-llm-server.ts`](../packages/contracts/src/mock-llm-server.ts) | Strict write/persisted/safe-view server contracts and bounds |
| [`packages/contracts/src/operations/management.ts`](../packages/contracts/src/operations/management.ts) | Four MCP-only operation contracts and secret/effect/retry metadata |
| [`packages/mcp/src/index.ts`](../packages/mcp/src/index.ts) | Handler-agnostic tool registration, cursor selection, and safe output parsing |
| [`packages/core/src/mock-llm/repository.ts`](../packages/core/src/mock-llm/repository.ts) | Canonical writes, mandatory put/delete compare-and-swap, replay, list/get/delete, limits, and monotonic revisions |
| [`packages/core/src/store/migrations.ts`](../packages/core/src/store/migrations.ts) | Append-only schema-v7 tables and rollback compatibility check |
| [`packages/worker-kit/src/environment-do.ts`](../packages/worker-kit/src/environment-do.ts) | Platform-key separation, provider-key hashing, environment-local RPC composition, and safe views |
| [`packages/worker-kit/src/mcp-agent.ts`](../packages/worker-kit/src/mcp-agent.ts) | Environment ownership checks and stable MCP problem mapping |
| [`apps/worker/src/app.ts`](../apps/worker/src/app.ts) | Mounted management authentication, bounded secret scanning, and early platform-key-substring rejection |
| [`packages/llm-mock`](../packages/llm-mock) | Provider-neutral planner and pure provider projections; not a network service |

The next public vertical slice is provider request parsing, provider-shaped Mock
Credential enforcement, exact routing and Worker composition, model rendering,
edge-paced streaming/cancellation, observation/assertion support, and real official
SDK clients against Wrangler. Cloud may pin only a merged, independently qualified
public revision; private account, entitlement, quota, console, and go-to-market policy
stay private.
