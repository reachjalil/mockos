# F1 mock-MCP foundation

Status: Foundation source-complete locally; full workspace gate green
Last reviewed: 2026-07-23

This is the first implementation tranche of the F1 mock-MCP runtime. It establishes
the protocol-independent contract, persistence, behavior, and observation boundaries.
It does **not** yet expose a mock-MCP HTTP endpoint.

The repository revision carrying this document passes the complete local
`pnpm check` gate. It has no hosted-CI, merge, deployment, or live-client evidence.

## Delivered in this tranche

- A strict version-one mock-MCP server contract covers server identity, transport and
  bearer-hash policy, bounded page size, tools, fixed resources, resource templates,
  prompts, declarative behavior, and configured server-range JSON-RPC error codes.
  Capability schemas use a bounded, locally validated JSON Schema subset; remote
  references and unsupported keywords fail creation.
- Untrusted server documents are bounded before recursive Zod parsing. Behavior
  documents have explicit serialized-byte, depth, and node ceilings.
- Schema migration v6 adds revisioned `mock_mcp_servers`, revision-bound
  `mock_state`, hashed-session storage, expiry indexes, and nullable MCP request-log
  metadata.
- Replacing a server atomically increments its revision, deletes its application
  state, and terminates sessions for the old revision. Deleting a server cascades its
  state and sessions. A state-only reset leaves the server specification intact.
  Individual state values are bounded JSON on both write and persisted read.
- The runtime-independent behavior evaluator implements static, restricted template,
  first-match, once/hold-last/loop sequence, configured error, and fail-closed script
  semantics. Seeded latency is returned as a plan instead of sleeping in a database
  transaction.
- Sequence movement is staged with an expected-state check. The future protocol
  adapter must validate the method-specific result and only then call `commit()`.
  A scenario short-circuit or invalid output can therefore leave the sequence cursor
  unchanged. If an interleaved invocation commits first, the stale plan fails before
  any write or response rendering and the caller must re-evaluate.
- Request logs can represent MCP protocol method, tool, canonical argument object,
  JSON-RPC error code, and tool-level `isError`. Top-level and ordered-sequence
  assertions support exact method, tool, and canonical-argument matching.

## Locked behavior semantics

| Variant | F1 foundation behavior |
| --- | --- |
| `static` | Returns a detached JSON value. The protocol adapter still validates the method-specific result. |
| `template` | Replaces `{{dotted.path}}` from explicit behavior data and invocation input. Prototype paths, helpers, evaluation, recursion, and missing values are rejected. |
| `match` | Selects the first case whose dotted-path values are deeply equal; otherwise uses the explicit fallback or fails. |
| `sequence` | `once` fails after the final committed step, `hold_last` repeats the final step, and `loop` wraps. Cursor writes are staged and compare their expected read before commit. |
| `error` | Produces a protocol-independent error plan. F1 maps its symbolic code through the server's validated `errorCodeMap`. |
| `script` | Uses an injected executor only. Without one, it takes an explicit fallback or fails closed; this tranche never evaluates JavaScript. |

## Explicitly still open

- the runtime `@mockos/mcp-mock` package and versioned `2025-11-25` adapter;
- initialize/initialized lifecycle, protocol headers, session issuance and
  termination, Origin and Mock Credential checks, POST/DELETE/GET handling;
- tools/resources/prompts dispatch, output-schema validation, opaque pagination, and
  configured error rendering;
- Environment Durable Object CRUD/reset RPCs, management tools, path/subdomain
  routing, scenario integration, latency scheduling, and universal Authorization
  redaction;
- official MCP SDK clients against both the in-process adapter and the Worker route;
- sourced wire fixtures, GET list-change delivery, hosted CI, deployment, and the
  2026-07-28 final-protocol checkpoint.

The public management MCP remains the product control interface. A future mock-MCP
endpoint is a provider-shaped dependency exposed to the application under test; it is
not a second management surface.
