# Environment-hosted mock MCP

Status: F1 locally source-qualified; no hosted or deployed acceptance
Last reviewed: 2026-07-25

Use a mock MCP server when the system under test is an agent or MCP client and needs
deterministic tools, resources, resource templates, prompts, errors, latency, and
state. An operator first configures the server through mockOS management MCP. The
agent under test then connects to the separate environment-hosted mock endpoint.

This is a public, reusable source capability. It does not require the private mockOS
Cloud control plane. The focused source suites and complete local `pnpm check` gate
are green in the revision carrying this document. That qualifies this bounded F1
source tranche locally; it does not imply hosted CI, merge, package publication,
private Cloud consumption, staging, production, or an external-client deployment
matrix.

## Choose the right MCP surface

| Surface | Caller | Purpose | Credential |
| --- | --- | --- | --- |
| Management MCP at `/mcp` | operator agent, automation, CI | Create, inspect, replace, reset, and delete mock MCP servers | Platform management Access Key |
| Environment mock MCP at `/e/{environmentId}/mcp-mock/{slug}` or `https://{environmentId}.{baseDomain}/mcp-mock/{slug}` | agent or MCP client under test | Exercise configured tools, resources, templates, prompts, errors, and state | No credential or a server-specific Bearer Mock Credential |
| Self-hosted HTTP under `/__mockos/v1` | narrow browser or operator integration | Five existing identity-management operations | Platform management Access Key |

The five F1 operations are MCP-only. They do not add routes to
`/__mockos/v1`, the OpenAPI document, or `@mockos/client`. The environment endpoint is
a synthetic dependency called by the application under test, not another management
API.

## Configure through management MCP

The management registry now contains 24 tools. The five F1 tools remain appended after the
15 accepted identity-management tools:

| Tool | Effect | Exact result data | State semantics |
| --- | --- | --- | --- |
| `put_mock_mcp_server` | idempotent mutation | A safe server view with specification, revision, and timestamps | Allocates the next environment revision for a new or changed definition; an identical normalized write is a no-op |
| `list_mock_mcp_servers` | safe read | `{ servers }` summaries | Orders the bounded environment catalog by most recently updated, then slug |
| `get_mock_mcp_server` | safe read | A safe server view | Returns no Bearer token or verifier |
| `delete_mock_mcp_server` | idempotent destructive mutation | `{ slug, deleted }` | Cascades current definition, application state, and revision-bound sessions |
| `reset_mock_mcp_state` | idempotent destructive mutation | `{ slug, cleared }` | Deletes application state only; the definition, revision, and active sessions remain |

Every input accepts an optional `environmentId`. Saved automation should provide it
explicitly. Omitting it uses the current management transport session's environment
cursor and therefore does not transfer to another MCP session.

`put_mock_mcp_server` takes `{ environmentId?, server }`. This minimal definition
creates a stateful, unauthenticated test server with one deterministic tool:

```json
{
  "environmentId": "test-env_01",
  "server": {
    "version": 1,
    "slug": "support-agent",
    "serverInfo": {
      "name": "Support agent dependency",
      "version": "1.0.0"
    },
    "transport": {
      "stateful": true,
      "enableGet": false,
      "sessionTtlSeconds": 3600
    },
    "pageSize": 25,
    "authentication": {
      "mode": "none"
    },
    "tools": [
      {
        "name": "lookup_ticket",
        "description": "Return a deterministic synthetic ticket.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          },
          "required": ["id"],
          "additionalProperties": false
        },
        "behavior": {
          "version": 1,
          "type": "static",
          "value": {
            "content": [
              {
                "type": "text",
                "text": "Synthetic ticket is open."
              }
            ]
          }
        }
      }
    ]
  }
}
```

Omitted arrays default to empty. Omitted transport and pagination fields default to a
stateful server, disabled GET, a 3,600-second session TTL, and a page size of 25. Read
the generated [`put_mock_mcp_server` schema](./reference/management-tools.md#put_mock_mcp_server)
before generating definitions programmatically.

### Optional Bearer Mock Credential

Set `authentication` to `{ "mode": "bearer", "token": "..." }` only on the write
operation. The token must be 16–1,024 characters from the RFC 6750 `b64token`
character set. mockOS hashes it before persistence. Read and list results expose only
`{ "mode": "bearer", "configured": true }`; neither the token nor its SHA-256
verifier is returned.

Load the token from a secret store and inject it into the management tool call. Do not
put a real credential in a committed definition or example. The public Worker rejects
its own platform `API_KEY` as a mock Bearer value, so management authority cannot be
replayed against the data plane.

## Connect the agent under test

The exact endpoint depends on the configured hosting mode:

| Mode | Endpoint template | Current evidence |
| --- | --- | --- |
| Path | `<worker-origin>/e/{environmentId}/mcp-mock/{slug}` | Source-routed and locally tested |
| Subdomain | `https://{environmentId}.{baseDomain}/mcp-mock/{slug}` | Source-routed and locally tested; wildcard TLS and live custom-domain acceptance remain open |

Use the exact environment ID and configured slug. Slugs contain 1–64 lowercase
letters, digits, and single internal hyphens; they start and end with a letter or
digit. Nested paths, uppercase aliases, and percent-encoded path separators do not
resolve.

The F1 adapter implements MCP revision `2025-11-25` over Streamable HTTP. It is not
the legacy HTTP+SSE transport.

An omitted `Origin` header is accepted for non-browser clients. When `Origin` is
present, it must be a canonical origin exactly equal to the request URL's origin;
cross-origin browser calls return `403`.

### Stateful wire sequence

A stateful client follows this order:

1. Send `POST initialize` with `Content-Type: application/json`, an `Accept` header
   that permits both `application/json` and `text/event-stream`, and protocol version
   `2025-11-25` in the initialize parameters. Include `Origin` when the client runtime
   supplies one. Include `Authorization: Bearer <mock-credential>` only when the server
   definition requires it.
2. Read the negotiated server information and the `Mcp-Session-Id` response header.
   Treat that opaque value as a Bearer capability; do not log or persist it.
3. Send `POST notifications/initialized` with the issued `Mcp-Session-Id` and
   `MCP-Protocol-Version: 2025-11-25`.
4. Send requests such as `ping`, `tools/list`, `tools/call`, `resources/list`,
   `resources/templates/list`, `resources/read`, `prompts/list`, or `prompts/get`.
   Every subsequent POST carries both session and protocol-version headers.
5. Follow each opaque `nextCursor` only in the same transport/session scope, server
   revision, and list kind that created it. A changed replacement invalidates prior
   cursors and sessions.
6. Send `DELETE` to the same endpoint with the session and protocol-version headers
   when the test finishes. Success is `204` with no body. Repeating DELETE with that
   terminated session returns `404`; termination is not reported twice as success.

Every POST uses one JSON-RPC message. Batch input is outside the F1 source boundary.
`GET` returns `405`; the adapter does not offer a standalone Streamable HTTP event
stream. Do not fall back to the legacy HTTP+SSE transport. The server also does not
emit `listChanged` notifications in this tranche.

### Inbound message bounds

The POST body must be one JSON object no larger than 256 KiB. At the JSON-RPC
envelope, `jsonrpc` must be exactly `"2.0"`; `method` must be a string from 1
through 256 characters; `id` may be absent, a string from 0 through 128 characters
(including `""`), or a safe integer; and `params` may be absent or an object.
Only `jsonrpc`, `id`, `method`, and `params` are valid envelope members.

A method's parameter object may include the standard optional `_meta` member. The
adapter accepts and ignores `_meta`; every other member not declared for that method
is invalid params. An internal availability guard also rejects messages deeper than
32 levels or larger than 20,000 JSON nodes. These structural ceilings protect the
adapter; they are not a compatibility promise that every message below them is
accepted. The byte limit and each method's schema still apply.

The official MCP TypeScript client is the conformance client for both the in-process
adapter and the routed path-mode Worker endpoint. The
[Worker integration](../apps/worker/test/mock-mcp.integration.test.ts) configures the
server through management MCP, then exercises the separate data plane. A raw-wire
suite separately checks negotiation, headers, status mapping, session lifecycle,
method dispatch, and rejection paths. Passing those tests establishes source
behavior only.

The key raw messages are:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "synthetic-client",
      "version": "1.0.0"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "lookup_ticket",
    "arguments": {
      "id": "SYNTHETIC-42"
    }
  }
}
```

The initialize POST must not carry `Mcp-Session-Id`. Its
`MCP-Protocol-Version` header is optional, but when present must be `2025-11-25`.
Notifications and later requests require the protocol header. A stateful session
allows `ping` before `notifications/initialized`; other requests receive JSON-RPC
`-32002` until initialization is marked.

### Stateless wire sequence

When `transport.stateful` is `false`, initialize returns the same result without
`Mcp-Session-Id`. Send `notifications/initialized` and later POSTs with
`MCP-Protocol-Version: 2025-11-25` and no session header. A session header is a `400`
error. Stateless DELETE returns `405` with `Allow: POST`; there is no transport state
to terminate. Application sequence state can still persist at the server revision, so
stateless transport does not mean behavior is immutable.

## Supported protocol methods

| Method | Behavior |
| --- | --- |
| `initialize` | Negotiates exactly `2025-11-25`, returns the configured `serverInfo`, optional instructions, and tools/resources/prompts capability objects |
| `notifications/initialized` | Marks the negotiated stateful session initialized; it does not return a JSON-RPC result |
| `ping` | Returns an empty result after the required lifecycle and session checks |
| `tools/list` | Returns a bounded page of configured tool descriptors |
| `tools/call` | Resolves the tool and argument object, reports input-schema mismatch as a tool-level error result, otherwise evaluates behavior, validates the complete tool result, commits staged sequence state, and renders the result |
| `resources/list` | Returns a bounded page of fixed resource descriptors |
| `resources/templates/list` | Returns a bounded page of Level-1 resource-template descriptors |
| `resources/read` | Selects an exact fixed URI first, then a matching template; validates the configured read result |
| `prompts/list` | Returns a bounded page of prompt descriptors |
| `prompts/get` | Validates declared required arguments, evaluates behavior, and validates the configured prompt result |

Unknown methods receive the JSON-RPC method-not-found error. A missing tool, resource,
or prompt receives a method-appropriate invalid-params response; it does not become an
HTTP management lookup.

## Server definition contract

| Field | Contract |
| --- | --- |
| `version` | Literal `1` |
| `slug` | Unique environment-local route name; 1–64 canonical lowercase characters |
| `serverInfo` | Required name up to 128 characters and version up to 64 |
| `instructions` | Optional, at most 8 KiB |
| `transport.stateful` | Whether the `2025-11-25` adapter issues revision-bound transport sessions; defaults to `true` |
| `transport.enableGet` | Literal `false`; standalone GET is unavailable |
| `transport.sessionTtlSeconds` | 60–86,400 seconds; defaults to 3,600 |
| `pageSize` | Default 25, maximum 50 |
| `authentication` | `none` or write-only Bearer Mock Credential |
| `tools` | At most 64, unique by capability name |
| `resources` | At most 64, unique by exact URI |
| `resourceTemplates` | At most 64, unique by exact URI template |
| `prompts` | At most 64, unique by capability name; prompt argument names are unique within a prompt |
| `errorCodeMap` | At most 64 symbolic names mapped one-to-one to JSON-RPC server codes from `-32099` through `-32000`, excluding MockOS-reserved `-32050` |

An environment contains at most 64 mock MCP servers. A serialized server definition is
bounded to 256 KiB, 24 levels, and 10,000 JSON nodes before recursive validation.
Descriptions are at most 2,048 characters and URIs at most 1,024 characters.

### Tool results

A tool behavior returns the complete MCP call result:

- `content` contains at most 64 text, image, or audio blocks;
- text is at most 64,000 characters per block;
- image/audio data must use canonical standard base64, including correct padding and
  padding bits, and is at most 256,000 characters per block;
- `structuredContent` is an optional JSON object; and
- `isError` is an optional tool-level failure marker.

If a tool declares `outputSchema`, a successful adapter result must provide valid
`structuredContent`. A deliberate `isError: true` tool result may omit
`structuredContent`; it represents a tool execution failure, not successful output.
Adapter result-schema validation failure does not advance sequence state.

### Resources and templates

A resource behavior returns `{ contents }` with 1–64 entries. Each entry has a safe
absolute URI, optional MIME type, and exactly one of bounded `text` or canonical
standard-base64 `blob`. A string shorthand is shaped as one text entry at the URI the
client requested. Non-canonical encodings, including missing or incorrect padding and
non-zero padding bits, fail method-specific result validation and do not advance
sequence state.

Configured fixed resource URIs and every URI returned in resource contents must be
safe absolute URIs. Relative values, user information, whitespace, controls,
backslashes, and `data:`, `javascript:`, or `vbscript:` schemes are rejected.

Resource templates support only safe Level-1 `{variable}` substitution. They require
an absolute URI and at least one unique simple variable. Relative templates, user
information, whitespace, controls, backslashes, duplicate or prototype-related
variables, malformed braces, RFC 6570 operators/modifiers, and `data:`, `javascript:`,
or `vbscript:` schemes are rejected.

For `resources/read`, an exact fixed resource wins before templates are tried in
definition order. Reverse matching compares every literal segment exactly and lets a
simple expansion consume only unreserved ASCII characters or complete percent
triplets. Empty expansions are valid. Captures are decoded before they are exposed as
`variables`: for example, `%2F` becomes `/`, while the same slash written raw cannot
belong to a Level-1 expansion. Malformed percent encoding does not match.

Adjacent variables use deterministic leftmost-minimal captures. For
`mockos://item/{first}{second}` and `mockos://item/value`, `first` is `""` and
`second` is `"value"`; earlier variables remain empty whenever the remainder can
match. The matcher discovers literal boundaries without regex backtracking. With URIs
capped at 1,024 characters and templates capped at 20 variables, its work is bounded
and linear in the URI for the contract-bounded variable count.

### Prompts

A prompt declares zero or more named arguments and marks required arguments explicitly.
Its behavior returns an optional description plus at most 64 `user` or `assistant`
messages. Message content is bounded text, image, or audio.

## Supported JSON Schema subset

An omitted tool input schema defaults to `{ "type": "object" }`. Every explicitly
provided input or output schema must declare the literal root
`{ "type": "object", ... }`; a root whose object type is only implied or composed is
rejected. The supported bounded vocabulary is:

```text
$schema, type, title, description, default, examples, enum, const,
properties, required, additionalProperties, items,
minItems, maxItems, uniqueItems, minProperties, maxProperties,
minLength, maxLength, minimum, maximum,
exclusiveMinimum, exclusiveMaximum, multipleOf,
anyOf, oneOf, allOf, not, readOnly, writeOnly, deprecated
```

Draft 2020-12 and draft-07 identifiers are accepted. `$ref`, `pattern`, `format`,
unknown keywords, remote schemas, array type unions, unsafe property names, and other
vocabularies are rejected. Each schema is bounded to 32 KiB, 12 levels, and 1,000
nodes; branching and collection sizes have separate conservative ceilings. This is an
intentional deterministic subset, not a general JSON Schema service.

Each validation uses one sticky internal work budget. Speculative `anyOf`, `oneOf`,
`allOf`, and `not` branches share it rather than receiving fresh budgets. Property and
array traversal, issue-path construction, string scans, `uniqueItems`, and canonical
`const`/`enum` comparisons all consume from the same allowance; exhaustion stops
validation with one root issue, `$ validation work budget exceeded`. The numeric
allowance is an implementation guard, not a public compatibility limit.

For tool input, budget exhaustion follows the normal schema-mismatch contract: HTTP
`200`, `result.isError: true`, the stable first text block, and exactly one bounded
diagnostic block containing the root issue. Behavior does not run and state does not
advance. If a server-produced successful result exhausts output-schema validation,
the result is invalid server configuration instead: the adapter returns `-32603` and
does not commit state.

## Declarative behavior

Every capability owns one version-one behavior:

| Type | Exact behavior |
| --- | --- |
| `static` | Returns a detached JSON value |
| `template` | Replaces `{{dotted.path}}` from explicit behavior data and invocation input; missing values, helpers, evaluation, recursion, and prototype paths fail |
| `match` | Selects the first case whose dotted-path values are deeply equal; otherwise uses the explicit fallback or fails |
| `sequence` | `once` fails after the final committed step, `hold_last` repeats the final step, and `loop` wraps |
| `error` | Renders the symbolic error through the server's exact `errorCodeMap` entry |
| `script` | Uses an injected executor only; F1 has none, so it takes an explicit fallback or fails closed |

Within one behavior evaluation, `match` memoizes each repeated dotted input-path read
and each repeated canonical JSON value. The cache is request-local and preserves exact
first-match semantics; it does not become persisted state or carry between calls.

`proxy` is not a version-one behavior. Record/replay remains an F9 target.

### Authoring patterns

Behavior templates and match cases receive a small method-specific input object:

| Capability | Available dotted paths |
| --- | --- |
| Tool | `arguments.<name>` |
| Fixed resource | `uri` |
| Resource template | `uri` and `variables.<name>` |
| Prompt | `arguments.<name>` |

Optional behavior `data` is merged first and invocation input wins on a top-level
name collision. A template string substitutes only `{{dotted.path}}`. String values
are inserted directly; other JSON values use canonical JSON. Missing paths,
prototype-related paths, helpers, code evaluation, and recursive template expansion
fail closed.

Template rendering is incremental and capped at exactly 256 KiB of UTF-8 output.
Canonical rendering and UTF-8 byte lengths are reused within one evaluation. Output
at the byte boundary is accepted; an additional byte fails before it is appended,
with internal behavior code `template_output_limit`. Through mock MCP this becomes
HTTP `200` with JSON-RPC `-32603`, and staged sequence state does not commit.
Method-specific result limits still apply afterward, so the template ceiling is an
availability guard rather than a promise that every 256-KiB string is a valid tool,
resource, or prompt result.

This tool selects the first exact match and uses string-result shaping:

```json
{
  "name": "classify_ticket",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "priority": { "enum": ["normal", "urgent"] }
    },
    "required": ["id", "priority"],
    "additionalProperties": false
  },
  "behavior": {
    "version": 1,
    "type": "match",
    "cases": [
      {
        "when": { "arguments.priority": "urgent" },
        "behavior": {
          "version": 1,
          "type": "template",
          "template": "Escalate {{arguments.id}}"
        }
      }
    ],
    "fallback": {
      "version": 1,
      "type": "static",
      "value": "Queue normally."
    }
  }
}
```

For a tool, a behavior string becomes one text content block. For a resource it
becomes one text content entry at the requested URI. For a prompt it becomes one
`user` text message. An object value must already be the complete method-specific
result.

Use a sequence when calls must advance through deterministic outcomes:

```json
{
  "version": 1,
  "type": "sequence",
  "mode": "loop",
  "latency": {
    "minimumMilliseconds": 20,
    "maximumMilliseconds": 50,
    "seed": "ticket-cycle-v1"
  },
  "steps": [
    { "version": 1, "type": "static", "value": "first" },
    { "version": 1, "type": "static", "value": "second" }
  ]
}
```

The latency seed is mixed with the capability state key, JSON-RPC request ID, and
nested behavior path. Sequence state is server-revision application state, not
transport-session state: tool and prompt sequences are shared by capability name,
fixed-resource sequences by URI, and template-resource sequences by template plus
requested URI. Concurrent clients therefore consume the same committed sequence.
Use `reset_mock_mcp_state` when a test needs the configured server back at its initial
behavior state.

To return a top-level configured JSON-RPC error, declare both the behavior and its
one-to-one server mapping:

```json
{
  "errorCodeMap": {
    "rate_limited": -32042
  },
  "behavior": {
    "version": 1,
    "type": "error",
    "code": "rate_limited",
    "message": "Try later.",
    "details": {
      "retryAfterSeconds": 5
    }
  }
}
```

The fragment shows the two fields that live at different levels; `errorCodeMap` is a
server field and `behavior` belongs to a capability. The optional behavior `status`
is useful to future HTTP adapters but does not override HTTP status in mock MCP.

Each behavior may add deterministic seeded latency from 0 through 30,000 milliseconds.
Nested latency is capped at 30 seconds. The adapter validates a value result, waits
outside the SQLite transaction while observing the HTTP Fetch request's abort signal,
then commits staged sequence movement. If another invocation commits first, the adapter
re-evaluates and retries the expected-state commit up to three total attempts; it
never overwrites newer state. A configured-error step also waits and commits its
staged sequence movement before returning the mapped JSON-RPC error. An HTTP client
abort or disconnect observed during latency returns request-cancelled `-32800` if a
response can still be rendered and prevents that commit.

This transport guard is not message-level MCP cancellation. F1 has no in-flight
request-ID registry and deliberately accepts `notifications/cancelled` with HTTP `202`
without cancelling the referenced request. MCP specifies that cancellation behavior
as a SHOULD rather than a MUST, but clients must treat its absence as an explicit F1
limitation. A call without latency can complete before a transport disconnect becomes
observable.

Result documents and behavior values are bounded to 256 KiB, 16 levels, and 5,000
nodes. Each persisted application-state value is separately bounded to 64 KiB, 16
levels, and 5,000 nodes. One server revision may hold at most 256 current-revision
state rows and 2 MiB of serialized state in aggregate. A write that would exceed
either aggregate ceiling fails deterministically with HTTP `200`, JSON-RPC `-32050`,
and exact message `Mock MCP application state capacity reached.` It does not partially
commit.

## Revision, session, state, and pagination rules

- Every successful new or changed definition receives the next environment-wide safe
  positive-integer revision. One slug's revisions therefore increase strictly but may
  skip values used by other slugs.
- Repeating the same normalized definition is a true no-op: revision, timestamps,
  application state, and sessions are preserved.
- Changing a slug's definition advances its revision atomically, removes prior
  application state, and terminates sessions for the old revision.
- The one-row revision allocator survives deletion, including deletion of every
  server, so recreating a slug cannot reuse an old revision. Reset, delete, invalid
  input, and rejected capacity writes do not consume revisions. If the safe-integer
  space were exhausted, a new or changed definition would fail before changing the
  current specification, state, or sessions.
- Initialize, notification, request, configured-error, and DELETE paths recheck the
  resolved server revision before committing or returning. A replacement or deletion
  racing an in-flight operation returns transport `409` rather than an old-revision
  success or error.
- A raw session ID contains 32 random bytes encoded as 43 base64url characters. It is
  returned once; only its SHA-256 hash is persisted.
- A stateful server allows at most 100 active sessions. Issuance prunes at most 100
  expired or terminated rows for that server before enforcing the cap.
- Session IDs are bound to the server slug, current revision, negotiated protocol
  version, initialization state, and expiry.
- Resetting application state does not terminate a valid current-revision session.
- Deleting a server explicitly removes its state and sessions even when SQLite foreign
  key enforcement is unavailable; it does not reset the revision allocator.
- List cursors are opaque and capped at 512 characters. They encode list kind, server
  slug, revision, transport/session scope, and offset; malformed, naively modified,
  cross-kind, cross-session, and cross-revision values fail rather than silently
  changing the page. Their checksum is public and unkeyed: a determined caller can
  recompute it, so a cursor is a pagination-correctness token, never an authorization
  boundary or security credential.

## Errors and response commitment

The adapter keeps HTTP transport failures separate from JSON-RPC application errors.
Malformed content negotiation, method, protocol, credential, origin, or session state
fails before configured behavior runs. Once a valid JSON-RPC call reaches a capability:

1. input is validated;
2. behavior is evaluated into a value or configured error plus deterministic latency;
3. a value is validated as the method-specific result;
4. latency completes unless the HTTP Fetch request aborts or disconnects;
5. staged sequence state commits with an expected-state check; and
6. the value result or configured error is rendered and observed.

Configured symbolic errors must have exactly one own-property entry in
`errorCodeMap`, and every mapping must be used by a configured behavior. Two names
cannot share one JSON-RPC number. This closes implicit prototype-name lookups and
prevents silently unrenderable definitions. `-32050` is reserved for the MockOS state
capacity error and cannot be assigned to user-authored behavior.

An `isError: true` tool result is a successful JSON-RPC response whose tool result
reports failure. In particular, valid `tools/call` parameters whose argument object
does not satisfy the selected tool's `inputSchema` return HTTP `200` with:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Tool arguments do not match inputSchema."
      }
    ],
    "isError": true
  }
}
```

The first text block is always exactly the sentence shown. The adapter may append one
diagnostic text block, capped at 8,192 characters, containing bounded schema issue
paths/messages but never input values; the complete tool-error result is parsed
through the result contract. This response does not evaluate behavior or advance
state. An unknown tool, missing/non-object tool arguments, or malformed tool name
remains top-level invalid params `-32602`. A configured behavior result that fails the
complete result or output schema remains internal adapter/configuration error `-32603`
and does not commit. Request observations record top-level JSON-RPC errors and
tool-level failures separately.

When the internal schema work budget is exhausted, the optional second block is
present exactly once as `$ validation work budget exceeded`; it is the single root
diagnostic and does not expose input values.

### HTTP and JSON-RPC mapping

| Condition | HTTP | JSON-RPC |
| --- | --- | --- |
| Successful initialize or request | `200` | Result with the caller's ID |
| Application-state capacity reached | `200` | `-32050`, `Mock MCP application state capacity reached.` |
| Accepted notification, including ignored `notifications/cancelled` | `202` | No body |
| Successful stateful DELETE | `204` | No body |
| Malformed JSON | `400` | Parse error `-32700`, ID `null` |
| Invalid single message, batch input, or protocol/session header state | `400` | Invalid request `-32600`, ID `null` |
| Missing or wrong Bearer Mock Credential | `401` | `-32001`, plus `WWW-Authenticate: Bearer` |
| Cross-origin `Origin` | `403` | `-32003` |
| Missing, expired, stale, or terminated session | `404` | `-32001` |
| GET, unsupported method, or stateless DELETE | `405` | `-32601`, plus exact `Allow` |
| POST does not accept both JSON and event stream | `406` | `-32600` |
| Definition changed during initialize, request, or DELETE | `409` | `-32001` |
| Message exceeds 256 KiB | `413` | `-32600` |
| POST is not `application/json` | `415` | `-32600` |
| Adapter/authentication dependency failure | `500` | `-32603` |
| Active-session cap reached | `503` | `-32603`, plus `Retry-After: 1` |

Transport errors use JSON-RPC ID `null`. A valid JSON-RPC request normally keeps HTTP
`200` even when its body contains method-not-found `-32601`, invalid-params `-32602`,
server-not-initialized/resource-not-found `-32002`, HTTP-Fetch-abort
request-cancelled `-32800`, state-capacity `-32050`, internal `-32603`, or a
configured `-32099` through `-32000` server error other than reserved `-32050`.
`ErrorBehavior.status` is not an MCP HTTP-status override; the MCP adapter uses the
configured JSON-RPC code, message, and details.

## Observe and assert what the agent did

Traffic handled by a resolved mock MCP server enters the existing environment request log with
`provider: "mcp"` and `protocol: "mcp"`. F1 retains the bounded, redacted request
header map, transport method, public path, response status, duration, and these
MCP-aware fields:

- `mcpMethod`;
- `mcpTool` for `tools/call`;
- canonical JSON `mcpArguments`;
- top-level `mcpErrorCode`; and
- `mcpToolIsError`.

Use `get_request_log` with `protocol`, `mcpMethod`, or `mcpTool` filters for diagnosis.
Use `assert_requests` with exact `mcpMethod`, `mcpTool`, and canonical `mcpArguments`
matchers for stable tests. Ordered sequences can mix MCP matches with other inbound or
outbound environment traffic, preserving non-overlapping request order.

Authorization and `Mcp-Session-Id` are redacted, and trusted internal routing headers
are omitted. F1 does not store raw JSON-RPC request bodies, response headers, or
response bodies in these entries. Observed tool arguments are capped at 64 KiB/16
levels/2,000 nodes; values under secret-like keys are replaced, long strings are
truncated, and an oversized redacted object is replaced wholesale. Top-level argument
keys must contain 1–256 characters; otherwise the observation stores only
`{ "_mockos": "[REDACTED:UNSUPPORTED_KEY]" }`. The request-log schema accepts the
adapter's exact `-32800` HTTP-abort error code. Remaining synthetic argument values are
deliberately observable because test evidence is the product; never place real
personal data or production credentials in a mock environment.

## Code graph and ownership

```text
packages/contracts/src/mock-mcp.ts
  ├─ strict server, capability, schema, result, and view contracts
  └─ packages/contracts/src/operations/management.ts
       └─ five MCP-only management operations

packages/core/src/behavior/evaluator.ts
  └─ protocol-independent declarative evaluation and staged state
packages/core/src/mock-mcp/repository.ts
  └─ revisions, hash-only sessions, bounded state, and cleanup

packages/mcp/src/index.ts
  └─ management tool registration
packages/worker-kit/src/mcp-agent.ts
  └─ management dependencies and typed EnvironmentDO RPC mapping

packages/mcp-mock/
  └─ hand-written 2025-11-25 transport, pagination, schema, template,
     method dispatch, and wire rendering

packages/worker-kit/src/host-resolver.ts
packages/worker-kit/src/edge-router.ts
  └─ path/subdomain route classification and trusted forwarding metadata
packages/worker-kit/src/environment-do.ts
  └─ environment-local mock MCP data plane and request observation
apps/worker/src/app.ts
  └─ self-hosted management authentication plus environment route entry
```

Reusable protocol behavior stays public. A private operator may compose accounts,
tenancy, entitlements, quotas, and hosted authentication around these exports, but the
public runtime never imports that policy or calls home.

## Local validation

From the repository root:

```sh
pnpm --filter @mockos/contracts test
pnpm --filter @mockos/core test
pnpm --filter @mockos/mcp-mock test
pnpm --filter @mockos/mcp test
pnpm --filter @mockos/worker-kit test
pnpm --filter @mockos/worker test
pnpm docs:check
pnpm f0:drift:check
pnpm check
```

Use the complete gate before reporting F1 source qualification. The revision carrying
this document passed that local gate. Local source qualification does not qualify
package publication, hosted CI, merge, staging, production, wildcard TLS, operated
Cloud composition, a future MCP protocol revision, or external ecosystem compatibility
beyond the tested clients.

## Current limitations

- Protocol revision `2025-11-25` only; the post-July-2026 protocol checkpoint remains
  open.
- POST-only Streamable HTTP; `GET` returns `405`.
- No `listChanged` notifications.
- No JSON-RPC batch requests.
- No message-level cancellation registry; `notifications/cancelled` is accepted and
  ignored. Only an HTTP Fetch abort/disconnect observed during configured latency
  protects staged sequence state.
- No script execution; `script` falls back explicitly or fails closed.
- No `proxy` or record/replay behavior.
- This F1 mock-MCP route exposes no LLM API. The separate partial F2 surface supports
  bounded OpenAI and Anthropic non-streaming provider routes.
- No enforced `env:ro` or `env:rw` Access Key scopes before F4.
- No direct HTTP management routes for the five F1 operations.
- No npm publication, hosted acceptance, deployment acceptance, load envelope, or
  production SLA claim.

See [implementation status](./IMPLEMENTATION_STATUS.md),
[known limitations](./known-limitations.md), and the
[F1 implementation record](./f-series/f1-mcp-foundation.md) for the current evidence
boundary.
