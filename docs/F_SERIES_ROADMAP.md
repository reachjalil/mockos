# 🥸 mockOS F-series roadmap

Status: Approved target design; F-series runtime implementation is gated on M2
Last reviewed: 2026-07-22

This document turns the approved F-series product direction into an executable
roadmap. It is a target design, not implementation evidence. The current evidence
ledger remains [Implementation status](./IMPLEMENTATION_STATUS.md): M0 and the M1
vertical slice pass locally, while M2 and every F-series runtime phase remain
unimplemented.

## Outcome

The F-series makes mockOS an end-to-end test platform for identity, MCP servers, and
LLM APIs. Teams and coding agents will be able to configure deterministic mocks,
exercise provider-accurate failure and streaming paths, assert on traffic, share
blueprints, and run the same workflows from MCP, a CLI, or CI.

The product outcome is unchanged. The execution sequence below corrects assumptions
that changed in MCP and Cloudflare during 2026, and makes cost, security, and
conformance gates explicit.

Traceability expands with `MCPMOCK-`, `LLMMOCK-`, `SBX-`, `CODE-`, `AUD-`, `IDEM-`,
`TEAM-`, `KEY-`, `CI-`, `BP-`, and `GAL-`. A requirement is not complete until its
trace row points to implementation evidence.

## Non-negotiable delivery rules

1. **M2 is the merge gate for all F-series code.** Before M2 is CI-green and its
   workers.dev smoke evidence is linked, F-series work may only land as design docs,
   ADRs, fixture research, or non-production spike evidence. No F0 contract module,
   client package, runtime route, catalog pin, migration, or feature flag may merge.
2. F-series work is additive. It does not modify an M-critical path until that
   milestone's exit evidence is green.
3. Every compatibility claim needs a real client test and a sourced wire fixture.
   Types or routes alone are not evidence.
4. Experimental dependencies are exact-pinned behind mockOS-owned interfaces. A
   package API is never a product architecture boundary.
5. Public open-core code never imports the private cloud. The dependency direction
   remains private to public only.
6. Security controls fail closed. A degraded runtime may disable scripts or Code
   Mode; it must never silently weaken isolation, authorization, or audit behavior.

## Locked product decisions

The user-approved decisions remain binding. The third column records the corrected
implementation interpretation.

| ID | Locked decision | Execution interpretation |
| --- | --- | --- |
| F-D1 | Mock both OpenAI Chat Completions and Anthropic Messages, including SSE | Build one neutral `ResponsePlan`, provider renderers, and real-SDK conformance tests. Stream cadence from the edge Worker, not the EnvironmentDO. |
| F-D2 | Declarative behaviors plus a user-JavaScript escape hatch | Declarative behavior is portable. JavaScript requires an enforcing sandbox and is rejected clearly by `NoSandbox`. |
| F-D3 | Scoped expiring Access Keys and OIDC federation for CI | Apply strict issuer-specific claim validation, replay resistance, scope intersection, and bounded token lifetime. |
| F-D4 | Org sharing, role ACLs, blueprints, and a moderated public gallery | Keep the portable blueprint core public and the hosted gallery, moderation, and listing data private. |
| F-D5 | Mock MCP servers live inside the existing EnvironmentDO | Keep mock data and application state there, but do not make a Durable Object session a protocol invariant. |
| F-D6 | Hand-roll the mock MCP JSON-RPC and Streamable HTTP layer | Put wire differences behind versioned adapters and use the official SDK as a dev dependency for black-box conformance. |
| F-D7 | Code Mode and classic MCP tools coexist; `@mockos/client` serves CLI and humans | Generate both the client and an OpenAPI 3.x document from the same contracts. Cloudflare's OpenAPI MCP integration consumes the OpenAPI document, not a `.d.ts` file. |
| F-D8 | `WorkerLoaderSandbox` to `NoSandbox` to test-only `NodeVmSandbox` degradation | Wrangler development support is real and must be tested. A deployed paid-account spike is still required for beta availability, billing, and enforcement evidence. |
| F-D9 | Call platform credentials Access Keys and provider-shaped in-environment values Mock Credentials | Access Keys, CI JWTs, and authorization headers are always redacted. Mock Credentials may appear in the isolated environment request log because observing them is part of the product. |
| F-D10 | Reserve audit hash-chain columns in F4; compute and sign in F9 | Do not market the log as tamper-evident until ordering, chain computation, export signing, and verification are implemented and tested. |
| F-D11 | Public blueprints may include reviewed scripts | Require plaintext source and a hash, show a manual script diff during moderation, and install every gallery script disabled until an org explicitly enables it. |
| F-D12 | Exact-pin Code Mode and Worker Loader integration behind wrappers; begin with a live spike | Pin the current packages only after M2, record the deployed-account result in an ADR, and keep classic tools fully functional if the spike is a no-go. |

## Target product surface

### Mock MCP servers

- Host each mock inside its environment at
  `/e/{env}/mcp-mock/{slug}` in path mode and
  `{env}.id.mockos.live/mcp-mock/{slug}` in subdomain mode.
- Support tools, resources, prompts, ping, list pagination, configurable JSON-RPC
  errors, configurable `isError: true` tool results, and list-change notifications
  where the selected protocol version and transport permit them.
- Share a versioned `BehaviorSpec` across MCP and LLM mocks: `static`, `template`,
  `sequence`, `match`, `error`, and `script`, each with seeded latency. `proxy` remains
  an F9 record/replay behavior behind the existing outbound SSRF policy.
- Keep deterministic sequence cursors and script state in `mock_state`; reset them on
  reseed and export them only when a blueprint explicitly requests state.
- Extend request assertions with MCP method, tool, argument, and cross-source ordering
  matchers. Scenario injection takes precedence over configured behavior.
- Expose CRUD and reset operations through typed EnvironmentDO RPC plus scoped classic
  management tools.

### Mock LLM APIs

- Serve OpenAI-compatible `/v1/chat/completions` and model discovery plus Anthropic
  `/v1/messages` and model discovery under each environment's LLM route prefix.
- Convert declarative behavior into a neutral `ResponsePlan` containing text and tool
  segments, stop reason, usage, cadence, and seed. Provider modules own request
  parsing, auth, error catalogs, token accounting, and wire rendering.
- Default to a stateless turn index derived from the request. Opt-in conversation state
  uses an explicit mockOS conversation handle and optimistic version, not an implicit
  transport session.
- Use provider-shaped Mock Credentials with accept-any and strict modes. Log dialect,
  model, stream flag, turn index, and usage, with LLM-specific assertion matchers.

### Versioned scripting

- `@mockos/sandbox` exposes one provider contract for capabilities, validation, and
  invocation. Production uses Worker Loader; non-Cloudflare runtimes are
  declarative-only; Node VM exists only for semantic tests.
- Store scripts as append-only versions with source, SHA-256, actor, and status.
  Behaviors pin an exact script ID and version and never follow “latest.”
- Give a script only input plus a frozen, deterministic context containing snapshot
  state, validated operations-out, seed/RNG, clock, call metadata, and captured log
  output. The EnvironmentDO applies state operations after a successful return, so
  scripts cannot re-enter it.
- Classify compile, runtime, timeout, blocked-egress, and invalid-output failures and
  apply the behavior's explicit propagate or fallback policy.

### Team, automation, and agent interfaces

- Preserve classic management tools for direct and fallback use. On eligible hosted
  plans, Code Mode `search`/`execute` becomes the primary agent interface for composed
  operations.
- Enforce owner/admin/developer/viewer roles, environment visibility and ACLs, Access
  Key scopes and environment bindings, expiration, rotation, and per-key rate limits
  at control, MCP, Code Mode, CLI, and DO actor boundaries.
- Make desired-state `ensure_*` operations and optimistic environment versions the
  common primitive for HTTP, MCP, CLI, blueprint install, and CI.
- Ship GitHub setup/teardown actions and a GitLab template after OIDC exchange, quotas,
  JSONL logs, and JUnit assertion reports pass staging dogfood.

## Architecture corrections

### MCP versions and application state

The production baseline is MCP `2025-11-25`. As of this review, `2026-07-28` is a
release candidate with a final specification planned for July 28, 2026. It is a
breaking revision: the protocol core becomes stateless and removes the
`initialize`/`initialized` handshake and `Mcp-Session-Id`.

The hand-rolled core therefore exposes a small version boundary rather than embedding
session assumptions in the mock engine:

```ts
interface McpProtocolAdapter {
  readonly version: string;
  readonly sessionPolicy: "negotiated" | "stateless";
  parse(request: Request): Promise<ParsedMcpRequest>;
  route(request: ParsedMcpRequest, registry: MockMcpRegistry): Promise<McpResult>;
  render(result: McpResult): Response;
}
```

The names are illustrative; the boundary is required. Behavior selection, resources,
tools, prompts, scenarios, and `mock_state` remain version-independent.

| Track | Required behavior |
| --- | --- |
| `2025-11-25` | Ship first. Support initialization, protocol-version validation, optional issued `Mcp-Session-Id`, subsequent-session validation, POST, DELETE termination, and the configured Streamable HTTP GET behavior. A server that does not offer GET returns 405. |
| July 28 checkpoint | Re-read the final specification, schemas, and available SDK release. Do not implement final wire behavior from the release candidate alone. Record differences and a go/no-go ADR. |
| `2026-07-28` | Add only after the final documents and a compatible SDK are available. Negotiate through `MCP-Protocol-Version`, follow the final stateless shape, and never create a protocol-session row. |
| Dual-version window | Run the same tool/resource/prompt behavior corpus through both adapters. Version-specific lifecycle tests remain separate. Reject missing or unsupported versions with the exact required protocol behavior. |

Application state is still allowed. Server-scoped sequences remain in the
EnvironmentDO. A sequence that needs a conversational scope under the stateless
protocol must use an explicit mockOS application handle or tool argument. The
management server's “current environment” convenience follows the same rule; it may
use a 2025 protocol session, but the 2026 adapter requires an explicit environment or
application handle.

`McpAgent` remains the selected production mount because mockOS intentionally
showcases the stateful Agents SDK. The tool registry and protocol adapters remain
handler-agnostic so Cloudflare's stateless handler or a custom transport can be used
for parity tests or as a contained fallback. Streamable HTTP is primary. The legacy
HTTP+SSE transport is compatibility-only; SSE emitted inside Streamable HTTP is not
the legacy transport.

### Code Mode and Dynamic Workers

The reviewed package baseline on July 22, 2026 is:

- `@cloudflare/codemode` `0.4.3` (experimental);
- `agents` `0.17.4`;
- `@modelcontextprotocol/sdk` `1.29.0`;
- repository pin `wrangler` `4.112.0`, while `4.113.0` is published.

F0 records exact pins after M2. Upgrades require wrapper tests and a non-blocking
canary before the catalog changes.

`@mockos/codemode` wraps the official shape:

```ts
openApiMcpServer({
  spec: generatedOpenApiDocument,
  executor: wrappedExecutor,
  request: authorizedRelativeRequest,
});
```

The integration exposes Cloudflare's `search` and `execute` tools alongside the
classic mockOS tools. Its executor begins with a wrapped
`DynamicWorkerExecutor({ loader: env.LOADER, timeout, globalOutbound })`. Worker
configuration uses a `worker_loaders` binding named `LOADER` and `nodejs_compat`.

The API contract has one source and three generated or checked products:

1. Zod and operation metadata used by the server;
2. an OpenAPI 3.x document used by `openApiMcpServer`;
3. the fetch-based `@mockos/client` used by the CLI and human callers.

CI fails if operation IDs, request/response schemas, scopes, or generated artifacts
drift. A TypeScript declaration file may document the client, but it is not the input
to Cloudflare's OpenAPI connector.

The `request` callback is the authorization and effect-audit choke point. It accepts
only a relative path and a method present in the generated operation map, reconstructs
the caller from host-owned context, applies the same role/scope/env ACL checks as a
classic tool, and records the child effect. It cannot accept an arbitrary origin,
forward an `Authorization` header from generated code, or expose a caller secret to
the isolate.

Cloudflare Dynamic Workers are an open beta available only on the Workers Paid plan.
The current pricing model includes 1,000 unique Dynamic Workers per month and then
charges $0.002 per Dynamic Worker per day, with 10 million requests per month then
$0.30 per million, and 30 million CPU milliseconds per month then $0.02 per million.
Uniqueness is counted by Worker ID and code each day. Reusing the same ID and code
counts once that day; a new ID or code version counts again. Calling `.load(code)` or
omitting an ID counts once per invocation.

The reviewed `DynamicWorkerExecutor` calls `load()` for each execution. Therefore one
Code Mode execution can create one billable Dynamic Worker. Before Code Mode is
enabled by default, F6 must meter executions and Dynamic Worker creations, enforce an
org quota, expose usage, and model the paid-plan cost at expected traffic. User script
execution instead uses `.get(stableId, callback)` where the stable ID includes org,
environment, script ID, version, and source hash so identical code can be reused
safely.

The reviewed executor defaults `timeout` to 60 seconds. That timeout is a wall-clock
`Promise.race`, not proof of a hard CPU cap, and the reviewed Code Mode wrapper does
not expose Worker Loader `limits`. The F3 spike must prove CPU and subrequest
enforcement with hostile code. If the stock executor cannot apply Worker Loader
limits, `@mockos/sandbox` provides a custom executor that calls the loader with
explicit `cpuMs` and `subRequests` limits. The roadmap may target a 250 ms script CPU
ceiling and a five-second Code Mode wall ceiling, but neither is marked enforced until
deployed tests demonstrate it. Source, input, output, invocation, and daily-usage caps
are enforced outside the isolate too.

`globalOutbound: null` blocks direct network access. If a custom `ctx.exports`
capability is provided, it exposes only narrow mockOS RPC methods and records denied
egress attempts. No platform binding or secret is passed into generated code.

The official Workers SDK contains local Dynamic Worker fixtures, so Wrangler
development is a supported test target. Local success does not replace the deployed
paid-account spike: beta entitlement, billing identity, hard limits, and production
egress behavior need live evidence.

### LLM planning and streaming

The EnvironmentDO remains the source of deterministic behavior and state, but it does
not stay active to pace a stream for up to 60 seconds.

1. The edge authenticates and forwards the normalized request to the EnvironmentDO.
2. The DO selects behavior, computes usage and a fully deterministic immutable
   `ResponsePlan`, commits any sequence/conversation state, and returns the plan with a
   `planId`, sequence/version, and request hash.
3. The edge owns the `ReadableStream`, SSE serialization, cadence timers, maximum
   duration, cancellation, and client-disconnect handling.
4. Completion or abort telemetry is delivered asynchronously with `planId` dedupe. It
   cannot change the already committed mock turn.

For a stateful conversation, creating the plan and advancing state is one serialized
DO operation. A retry with the same conversation version and canonical request hash
reuses the existing plan; a conflicting request receives a version conflict. This
prevents a dropped edge connection from advancing a sequence twice.

The edge enforces provider-specific wire rules from sourced fixtures:

- Anthropic Messages requires `anthropic-version`. Accepted values come from a
  configuration allowlist reviewed against Anthropic's version page. Missing and
  unsupported values return provider-shaped errors. Streaming tests include a named
  `error` event after HTTP 200, including `overloaded_error`, plus normal message and
  tool-use event sequences.
- OpenAI Chat Completions emits `data: [DONE]`. When
  `stream_options.include_usage` is true, it emits the additional chunk immediately
  before `[DONE]` with `choices: []` and complete `usage`; preceding chunks carry null
  usage. Clients must tolerate that usage chunk being absent when a stream is
  interrupted.
- Both dialects enforce a cadence floor, maximum stream duration, request and output
  caps, abort cleanup, and streamed-second quotas at the edge.

Moving cadence to the edge is both an architecture and cost gate. Workers do not have
a general wall-duration limit while a client remains connected, whereas an active
Durable Object can accrue duration and cannot hibernate while work keeps it active.

### Audit and idempotency

Audit and protocol request logs have different trust boundaries:

- `request_log` records mock protocol traffic and may intentionally contain generated
  Mock Credentials inside the isolated test environment.
- `audit_log` records control-plane mutations and security decisions. Its
  `details_json` is produced from action-specific allowlists, capped, and redacted. It
  never contains Access Keys, authorization headers, CI JWTs, refresh tokens, or
  script source. Script audit events store an ID, version, and SHA-256 only.

Key, role, ACL, trust-rule, script-enable, and token-exchange audit records are
security-critical: the control response is not successful until their audit row is
persisted. High-volume Code Mode child effects may use a queue with at-least-once
delivery, stable event IDs, deduplication, and per-execution child sequence numbers.
The parent execution is synchronous and records its expected child count and outcome.

F4 reserves `prev_hash` and `entry_hash` but leaves them unset. In F9, chain ordering
must be assigned through a strongly consistent per-org sequence, or explicitly chain
independent documented partitions. Queue arrival order is not a valid global order.
Only after canonicalization, gap detection, signed export, and an independent verifier
pass may mockOS claim tamper evidence.

Idempotency records use the identity:

`org_id + operation/endpoint + SHA-256(Idempotency-Key)`.

The record also stores a canonical request hash, exact status, replay-safe headers,
exact body, creation/expiry, and state. Stored response fields are action-allowlisted
and bounded; any sensitive replayable body uses envelope encryption. A unique insert
or serialized transaction chooses one concurrent first writer. The same key and
request replays byte-for-byte; the same key with a different request returns 409.
In-progress duplicates wait or return a documented retry response; they never execute
the mutation twice.

Streaming bodies and failures that occur before mutation ownership are not cached.
Secret-bearing Access Key creation uses a short-lived envelope-encrypted replay blob;
the durable key record remains hash-only. If encrypted replay is unavailable, key
creation fails closed rather than issuing a second plaintext secret. Expired records
purge both response data and encryption metadata.

### OIDC federation

`POST /v1/ci/token` trusts no issuer or repository by default. Each org registers an
issuer-specific trust rule. Exchange processing must:

1. load metadata and JWKS only for the exact allowlisted issuer URL;
2. allow only configured signature algorithms and matching key types, reject
   `alg: none`, and refresh once on an unknown `kid` before failing closed;
3. validate the signature plus exact `iss`, exact configured `aud` value or array
   membership with no fallback, `exp`, `nbf`, `iat`, maximum token age, and bounded
   clock skew;
4. use issuer-specific claim validators for GitHub Actions and GitLab, including their
   documented `sub` shapes; match anchored templates or structured fields, never a
   user-supplied regular expression;
5. consume `jti` once when present, otherwise consume a one-time hash of the compact
   token until its expiry;
6. intersect requested scopes with the trust rule, actor/org ceiling, and environment
   pattern, and cap the issued TTL at the least of provider validity and rule maximum;
7. audit the issuer, subject hash, rule, decision, scopes, and reason without storing
   the JWT or raw sensitive claims.

### Public blueprints and hosted gallery

The public `mockos` repository owns the portable blueprint system: schema,
canonicalization and content hashing, no-secrets validation, semantic validation,
export, import planning, CLI validation/apply commands, fixtures, and tests. Script
source is plaintext plus a hash and imports disabled by default.

The private `mockos-cloud` repository owns D1 listings, moderation state, reports,
install counters, public gallery pages and API, org ACL enforcement, hosted install
transactions, script-enable approval, and reviewer tooling. The community gallery
remains a product commitment, but no hosted moderation or popularity logic leaks into
the open-core package.

## Phase roadmap

| Phase | Scope | Hard gate | Exit evidence |
| --- | --- | --- | --- |
| Design-0 | This roadmap, ADRs, sourced fixture research, spike plans | Current M0/M1 state | Docs checks pass; no F-series runtime or dependency change is merged. |
| F0 | Additive contracts modules, operation metadata, `@mockos/client` skeleton, OpenAPI generation, wrapper package shells, exact dependency pins behind disabled flags | **M2 green with deployed smoke evidence** | Contract/client/OpenAPI drift tests pass; existing M suites are unchanged and green. |
| F-CLI-A | First public CLI with only capabilities that exist after M2 | F0 plus M2 server capabilities | CLI Stage A matrix passes against local Wrangler and deployed staging. |
| F1 | Declarative mock MCP engine in EnvironmentDO, `2025-11-25` adapter, management tools, fixtures | F0 and M2 | Official SDK client passes in-process and Worker tests; July 28 version checkpoint recorded. |
| F2 | Neutral LLM planner, OpenAI and Anthropic dialects, edge streaming, tools and errors | F0 and M2 | Real OpenAI and Anthropic SDK clients pass normal, error, usage, abort, and streaming fixtures under Wrangler. |
| F3 | Sandbox provider, deployed Worker Loader spike, versioned scripts, F1/F2 script seam | F0 and M2 deployed environment | ADR records go/no-go; local and paid-account tests prove egress, hard limits, output validation, and cost IDs. |
| F4 | Audit, idempotency, `ensure_*`, scoped keys, roles/ACLs, KV entitlement record v2 | M4 green | Security-critical audit, concurrency, scope matrix, migration, and dual-read tests pass in cloud staging. |
| F5 | Public blueprint core, export/import planner, hosted install integration | F1/F2 schema freeze; hosted apply also gates on F4 slugs/idempotency | Public no-secrets and deterministic hash corpus passes; hosted installs are idempotent and scripts remain disabled. |
| F6 | Code Mode `search`/`execute`, OpenAPI connector, authorized request gateway, org tools | F3 go, F4, M4, and paid-account cost review | Classic and Code Mode clients coexist; child effects authorize/audit identically; quotas and cost telemetry are visible. |
| F7 | CLI Stages B/C, OIDC federation, GitHub Action, GitLab template, CI quotas and reports | F4 and F5; OIDC issuer tests before Stage C | Keyless staging dogfood creates, tests, reports, and tears down an ephemeral environment. |
| F8 | Hosted gallery, moderation, reports, public pages, install flows | F5 and M7 | Submit/review/install/report/delist flows pass; abuse and disabled-script gates are demonstrated. |
| F9 | Audit chains and signed export, MCP proxy record/replay, sandbox review, cost and launch hardening | F1-F8 complete | Independent audit verifier, security checklist, load/cost envelope, and launch conformance matrices are green. |

F1, F2, and F3 may run in parallel after F0. F4 may run in the private cloud lane
after M4. Per-area contract files, append-only migration ownership, and table-driven
route registration remain the merge choke-point rules.

### July 28 MCP checkpoint

This checkpoint is not permission to replace the stable adapter. Its deliverables are:

- archive the final specification URL and schema commit;
- record whether the final differs from the release candidate;
- identify the first compatible official TypeScript SDK release;
- add a version matrix and fixture provenance;
- keep `2025-11-25` green while the new adapter is built;
- ship dual-version support only when both adapters pass their own lifecycle and a
  shared behavior corpus.

If the final specification or SDK slips, F1 ships the stable adapter and the checkpoint
remains open without blocking mock MCP value.

## CLI delivery matrix

The CLI begins immediately after M2 instead of waiting for the original F7 bundle. It
uses capability discovery and produces a clear unsupported-capability error; a command
is never advertised as working before its server operation exists.

| Stage | Gate | Commands delivered | Boundary |
| --- | --- | --- | --- |
| A: operator loop | M2 + F0 | `doctor`; `env create`; `env list`; `env delete`; `seed`; `scenario set`; `scenario clear`; `mint-token`; `logs dump`; `wait` | Access Key or self-host API key; existing M2 capabilities only. `doctor` reports server/version/capability mismatches. |
| B1: governed desired state | F4 | `env ensure`; version preconditions; scoped-key diagnostics | Uses the same idempotency records, slug rules, and ACL checks as MCP and HTTP. |
| B2: reusable tests | F5, plus M3 assertion capability | `blueprint validate`; `blueprint export`; `blueprint apply`; `assert --junit`; `report` | Validation is local where possible; apply/assert/report verify server capabilities and emit machine-readable failures. |
| C: keyless CI | F7 OIDC | `login` or `auth exchange`; CI token handling; GitHub setup/teardown; GitLab template | No long-lived key in CI. Tokens are short-lived, scope-intersected, never printed, and torn down with uploaded JSONL/JUnit evidence. |

Every stage tests non-interactive exit codes, JSON output, redaction, retries, partial
failure, and server-version mismatch. Stage A is a public package and is not held back
for hosted governance.

## Acceptance gates

### Merge and compatibility

- Before M2, a review of changed paths proves no F-series package, migration, catalog
  pin, route, or runtime flag landed. Design documents identify themselves as target
  design.
- Every phase starts with an additive contract freeze and ends with existing M tests,
  format, types, tests, builds, Wrangler dry-run, and documentation honesty gates
  green.
- A “Complete” conformance row links at least one sourced fixture and one executable
  test.

### Mock MCP

- A real official SDK client completes the `2025-11-25` initialize, negotiated version,
  session-header, POST, optional GET, and DELETE matrix.
- Missing, stale, foreign, and terminated session IDs take exact protocol paths;
  JSON-RPC protocol errors remain distinct from `isError: true` tool results.
- After the July checkpoint, both adapters negotiate from
  `MCP-Protocol-Version`; the 2026 adapter proves no hidden protocol-session storage.
- The shared behavior corpus covers pagination, tools, resources, prompts, latency,
  scenarios, seeded sequences, state reset, and list-change notifications where the
  selected transport supports them.

### Mock LLM

- Real `openai` and `@anthropic-ai/sdk` clients run against `wrangler dev` and deployed
  staging for non-streaming, streaming, tool calls, provider errors, and cancellation.
- OpenAI tests assert the empty-choices usage chunk only when requested and allow its
  absence after interruption.
- Anthropic tests assert required version-header behavior, exact normal event order,
  tool JSON deltas, ping tolerance, and a mid-stream named error after HTTP 200.
- DO instrumentation proves the response plan and state are committed before edge
  streaming, and that the EnvironmentDO is not retained solely for cadence.
- Disconnect and retry tests prove a stateful turn is not advanced twice.
- The flagship `examples/agent-under-test` flow receives scripted Anthropic
  `tool_use`, calls a mock MCP tool in the same environment, and asserts the complete
  cross-source sequence.

### Sandbox and Code Mode

- Test-only `NodeVmSandbox` passes semantic parity but is labeled and documented as no
  security boundary. `NoSandbox` rejects script configuration with RFC 7807.
- Wrangler local and deployed paid-account tests cover infinite loops, CPU and
  subrequest caps, direct and indirect egress, dynamic import attempts, source/input/
  output limits, state operation validation, and deterministic time/RNG.
- Billing tests demonstrate the difference between `.load()` and stable-ID `.get()`;
  usage telemetry attributes Dynamic Worker creation, requests, CPU, org, execution,
  and script version.
- A real MCP client sees classic tools and `search`/`execute`. An `env:ro` caller cannot
  discover or invoke mutations through either path.
- Generated code receives no secret. Every allowed child effect traverses the host
  request callback, the standard authorization path, and a deduplicated audit event.

### Governance and CI security

- Parallel identical idempotent mutations execute once and replay exactly. A changed
  request returns 409. Expired, failed-before-ownership, streaming, and encrypted
  secret-response cases have separate tests.
- Audit tests cover synchronous security mutations, queued child-effect redelivery,
  dedupe, sequence reconstruction, redaction, retention, and request/correlation IDs.
- OIDC adversarial tests cover unknown issuer, attacker JWKS, unknown `kid` rotation,
  wrong audience, `alg: none`, wrong key type, expired/not-yet-valid/too-old tokens,
  malformed GitHub/GitLab subjects, unanchored claim attempts, replay, excess scope,
  and TTL escalation.
- GitHub and GitLab happy paths use their issuer-specific fixtures; the staging
  keyless dogfood path is the live evidence.
- Role by scope by environment visibility matrices run at HTTP, classic MCP, Code
  Mode, CLI, and DO actor boundaries.

### Blueprints and gallery

- Canonicalization yields one stable content hash across property ordering and
  runtime implementations.
- Validators reject platform secrets, Access Keys, CI tokens, oversized inputs,
  unknown behavior versions, and script hash mismatches.
- Export/import is deterministic and idempotent. Credentials marked `generate` are
  created at install time and are never serialized.
- A gallery blueprint with a script exposes plaintext and a moderation diff, installs
  disabled, and cannot execute until a permitted org actor enables that exact hash.
- Submission throttling, manual approval, reporting, auto-delist, moderator override,
  and audit trails pass before public launch.

## Risk register

| Risk | Control | Stop or fallback condition |
| --- | --- | --- |
| MCP final differs from the release candidate | Stable adapter first; version boundary; July checkpoint | Ship `2025-11-25` only until final schemas and SDK tests are ready. |
| Code Mode package churn | Exact pins, wrapper packages, weekly canary | Disable Code Mode flag; classic tools remain the supported interface. |
| Dynamic Workers cost surprises | Paid-plan spike, stable IDs for scripts, per-execution metering, quotas | Do not enable Code Mode by default until a reviewed cost envelope exists. |
| Timeout mistaken for isolation | Hostile deployed tests and explicit loader limits | No user scripts if hard CPU/subrequest enforcement cannot be proven. |
| Sandbox escape or secret exposure | Empty env, blocked outbound, capability RPC, strict output/state validation | Disable scripts and Code Mode; declarative mocks remain available. |
| Durable Object stream cost | Immutable plan handoff and edge-owned cadence | Reject F2 exit if DO duration tracks configured stream delay. |
| Audit gaps or ambiguous order | Synchronous security rows, event IDs, dedupe, explicit sequences | Do not claim complete audit or tamper evidence; block sensitive mutations on audit failure. |
| Idempotent secret replay leaks | Envelope-encrypted short-lived response; hash-only key record | Fail closed for Access Key creation if secure replay storage is unavailable. |
| OIDC confused-deputy or replay | Exact issuer/audience, issuer validators, one-time token identity, scope intersection | Keep OIDC federation disabled; scoped expiring Access Keys remain available. |
| Gallery abuse or malicious scripts | Manual review, source diff, disabled installs, reports and delist | Keep listings private or declarative-only until moderation gates pass. |
| Parallel-lane migration conflicts | Named migration ownership, append-only order, table-driven routes | Serialize the conflicting migration or router PR before either lane continues. |
| F-series distracts from v1 | M2 and later hard gates; evidence ledger remains authoritative | Pause F code whenever its gating M milestone regresses. |

## Authoritative references

These links are the review baseline, not a substitute for re-checking versioned
behavior when a phase begins.

### MCP

- [MCP `2025-11-25` Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP `2026-07-28` release-candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP development roadmap](https://modelcontextprotocol.io/development/roadmap)
- [Official TypeScript SDK repository](https://github.com/modelcontextprotocol/typescript-sdk)

### Cloudflare Agents, Code Mode, and Dynamic Workers

- [Code Mode overview and experimental status](https://developers.cloudflare.com/agents/tools/codemode/)
- [Code Mode MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)
- [OpenAPI search-and-execute MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/)
- [Code Mode Dynamic Worker example](https://developers.cloudflare.com/dynamic-workers/examples/codemode/)
- [`McpAgent` API](https://developers.cloudflare.com/agents/model-context-protocol/apis/agent-api/)
- [Cloudflare MCP transport guidance](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/)
- [Dynamic Workers open-beta announcement](https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/)
- [Dynamic Workers getting started and `.get()`/`.load()`](https://developers.cloudflare.com/dynamic-workers/getting-started/)
- [Dynamic Workers API and bindings](https://developers.cloudflare.com/dynamic-workers/api-reference/)
- [Dynamic Workers egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
- [Dynamic Workers custom limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/)
- [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
- [Official Wrangler local Dynamic Worker fixture](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/dynamic-worker-loading)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [`@cloudflare/codemode` package](https://www.npmjs.com/package/@cloudflare/codemode)
- [`agents` package](https://www.npmjs.com/package/agents)

### Provider wire behavior

- [Anthropic API version header and version history](https://platform.claude.com/docs/en/api/versioning)
- [Anthropic streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic API errors, including streaming errors](https://platform.claude.com/docs/en/api/errors)
- [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat)

### OIDC federation

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [JSON Web Token Best Current Practices, RFC 8725](https://www.rfc-editor.org/rfc/rfc8725)
- [GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
- [GitLab ID token authentication](https://docs.gitlab.com/ci/secrets/id_token_authentication/)
