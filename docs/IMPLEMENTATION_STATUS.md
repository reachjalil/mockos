# Implementation status

Status: Accepted M0-M3/M5 and sampled M6 evidence retained; M7/F0 are
source-complete, F1 is locally source-qualified, F2 has a partial OpenAI/Anthropic
source and metadata-observation slice, and bounded Entra MSAL Node local X/Q passed
Last reviewed: 2026-07-26

This is an evidence ledger, not a roadmap completion claim. “Partial” can mean that
types, fixtures, or a narrow slice exist while the complete behavior does not. The
accepted M3 baseline is exact revision
`8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 has a separate immutable public
runtime revision, hosted CI run, manual Worker rollout, and controlled-target
acceptance record; it does not inherit M3 evidence or qualify the guarded deployment
workflow. M6 has its own exact-source, CI, version, and sampled workers.dev acceptance
record; it does not inherit M3/M5 evidence or qualify the guarded Cloudflare-credential
deployment workflow. The additive M7 application/scenario management-read substrate is
source-complete in the repository revision carrying this document, but has no hosted
CI, deployed-version, or console acceptance evidence yet. The additive Entra MSAL Node
tranche is a separate source candidate with local actual-network and official-client
evidence only. The F0 contracts, management operation registry, checked OpenAPI/client
artifacts, and disabled wrapper boundaries also pass the full local repository gate in
the revision carrying this document. F0 has no hosted CI, deployment, or distribution
evidence yet and does not activate an experimental runtime. The
[locally source-qualified F1 implementation](./f-series/f1-mcp-foundation.md) adds the
hand-written `2025-11-25` adapter, five management tools, revisioned state/hash-only
sessions, declarative evaluation, path/subdomain routing, and MCP-aware request
assertions. Its source availability guards include request-local repeated-work caches,
incremental 256-KiB UTF-8 template rendering, and a sticky JSON Schema work budget
whose tool-input exhaustion is a bounded `isError` result rather than behavior
execution. Its focused layer suites and complete repository `pnpm check` gate are green
in the revision carrying this document. Hosted CI, merge, package publication,
deployment, private Cloud consumption, and broader ecosystem compatibility remain
separate claims until recorded. The
[partial F2 LLM slice](./f-series/f2-llm-kernel.md) combines provider-neutral
response-plan schemas, a behavior-to-plan adapter, pure OpenAI/Anthropic JSON/SSE-frame
renderers, in-process pinned-SDK consumption, strict server-definition contracts, four
MCP-only operations, schema-v8 environment persistence, mandatory revision
compare-and-swap, and write-only provider-key views. Bounded OpenAI and Anthropic
request adapters, the shared environment runtime, route composition, generated
provider manifests, and local Worker integrations now source-qualify ordered model
list/retrieve, OpenAI JSON/SSE Chat Completions, and Anthropic JSON/SSE Messages through
pinned official SDKs. Both auth modes require the dialect's valid provider credential;
strict mode checks only its current hash-only verifier. Anthropic additionally requires
exactly `anthropic-version: 2023-06-01` and rejects beta headers. Configured midstream
errors, OpenAI Responses, Anthropic betas, and runtime/conversation state or reset
remain unavailable. Successfully parsed/planned provider POSTs that pass response
preflight now attempt one metadata-only reservation within a 50-millisecond fail-open
budget; prospective metadata/credential collisions skip it. In-budget rows finalize in
place, and the existing MCP log query/count/ordered-sequence tools accept exact
lifecycle matchers. This bounded observation path is source- and mounted-Worker-tested
and is not an audit guarantee. Wrangler-network/deployed conformance and private Cloud
pinning remain unavailable. F2 therefore remains incomplete.

Evidence levels are intentionally separate. The
[documentation index](./README.md) defines designed (D), implemented (I),
source-tested (S), integration-tested (X), pinned SDK/client-qualified (Q),
hosted-smoke (H), verified-live (V), and production-ready (P). The MSAL tranche is
D/I/S/X/Q yes and H/V/P no. Existing exact-version workers.dev records may establish H
for their raw-protocol samples without establishing Q, V, or P. No current fixture or
milestone is V or P.

| Area | State | Evidence and boundary |
| --- | --- | --- |
| M0 workspace substrate | Complete locally and in hosted CI through M3 | The repository-wide format, types, tests, build, Wrangler-shape, and production/staging dry-run gates pass at exact M3 candidate `8645f405d5e3b922c30d51339b8b27f9fe30d93e`; see [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480). |
| Contracts v0 | Accepted through the bounded M6 runtime slice | The accepted contract includes SCIM resources, directory lifecycle state/actions/results, and the M5 [provisioning contract](../packages/contracts/src/provisioning.ts) for safe target metadata, snapshots, watermarks, plans, operations, responses, and `run_provisioning_cycle` as tool 15. M6 adds seeded Authn `passwordState`, request-derived `oktaAuthnEndpoint`, and exact-only token rotation/clock-skew scenario actions. Exact M6 revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` passed source and sampled deployed acceptance; packages remain unpublished. |
| F0 contract, OpenAPI, client, and documentation foundation | Source-complete locally; hosted CI and merge pending | The version-one [shared behavior contract](../packages/contracts/src/behavior.ts) freezes `static`, `template`, `sequence`, `match`, `error`, and exact-version `script` variants with seeded latency while rejecting `proxy`. The canonical [management operation registry](../packages/contracts/src/operations/management.ts) now covers all 24 source MCP operations; MCP consumes that metadata, while only the five implemented HTTP routes enter the checked [OpenAPI document](../packages/openapi/openapi/mockos-management.v1.json) and generated [client operation map](../packages/client/src/generated.ts). The same generation step produces the [human tool reference](./reference/management-tools.md), [machine operation catalog](./reference/management-operations.v1.json), [product capability index](./reference/product-capabilities.v1.json), self-hosted HTTP reference, [mock OpenAI](./reference/mock-llm-openai.v1.json) and [mock Anthropic](./reference/mock-llm-anthropic.v1.json) provider manifests, and agent-readable indexes with exact-count, repository-reference, JSON-Pointer/Markdown-anchor, evidence-reference, executable-export, drift, and inert-secret checks. The capability index explicitly declares a partial F0-F2 interface slice containing management MCP, companion management HTTP, mock-MCP, bounded OpenAI/Anthropic, and disabled Code Mode. It names identity-provider, SCIM/provisioning-outcome, and private Cloud product rows as unindexed, so absence never means unsupported; their existing management operations remain covered inside the MCP/HTTP rows. Public provider/outcome rows await exact public contracts, while private Cloud remains a private evidence/policy overlay on an immutable public revision. Each included row identifies executable authorities and anchored limitations. Support describes the referenced bounded contract; source, hosted CI, private Cloud pin, deployment, and verified-live evidence independently record qualification, coverage, and current-versus-historical revision relation. The historical M6 bundle did not remotely exercise the five companion HTTP routes, so that deployed claim remains unqualified even though its context is retained. Each provider manifest is generated from its executable operation table and remains separate from management OpenAPI. The fetch-based [client](../packages/client/src/client.ts), fail-closed [Code Mode wrapper](../packages/codemode/src/index.ts), and [`NoSandbox`](../packages/sandbox/src/index.ts) pass focused tests. Exact package pins and generated drift are root/CI gates. Code Mode and scripts remain unwired, and the workspace packages remain private pending distribution/runtime qualification. |
| F1 environment-hosted mock MCP | Locally source-qualified; hosted CI/merge/deployment unqualified | Strict [mock-MCP contracts](../packages/contracts/src/mock-mcp.ts), bounded JSON Schema/templates/results, [declarative evaluation](../packages/core/src/behavior/evaluator.ts), schema-v6 revision/state/hash-only-session tables, the atomic [repository](../packages/core/src/mock-mcp/repository.ts), five MCP-only management operations, and the hand-written [`@mockos/mcp-mock`](../packages/mcp-mock) `2025-11-25` adapter pass their focused suites and the complete repository gate. The [path-mode Worker integration](../apps/worker/test/mock-mcp.integration.test.ts) configures through management MCP and exercises the routed official SDK, separate credential/session boundary, pagination and all capability kinds, reset, idempotent/revision-changing writes, delete, and redacted MCP observations; host-resolver tests separately cover both endpoint forms. State is capped per value and at 256 rows/2 MiB in aggregate. Identical writes preserve revision/state/sessions; changed replacements and in-flight revision checks prevent stale results; result validation and HTTP-abort handling during configured latency happen before staged sequence commit; scripts fail closed. Resource-template reverse matching is bounded/linear and deterministic for empty, percent-encoded, and adjacent-variable captures. Message-level `notifications/cancelled` remains deliberately unenforced. The [F1 guide](./mock-mcp.md) records exact limits and gaps. Hosted CI, merge, package publication, deployment, wildcard TLS, private hosted integration, GET/list-change streaming, a second protocol version, scripts, proxy, and broader client/ecosystem conformance remain unqualified or unavailable. |
| F2 mock-LLM kernel, management definitions, provider data planes, and observation | Partial source-qualified implementation; hosted/deployed provider evidence unqualified | The [F2 kernel record](./f-series/f2-llm-kernel.md) maps the bounded/deep-frozen plan, behavior adapter, pure OpenAI/Anthropic projections, and exact provider boundary. The [task guide](./mock-llm.md) maps strict bounded definitions, four MCP-only operations, schema-v8 persistence, monotonic revisions, mandatory put/delete CAS with idempotent put replay, full strict-key resupply, hash-only provider credentials, secret-safe validation, and non-round-trippable safe views. Executable OpenAI and Anthropic adapters add exact path/subdomain routes, model list/retrieve, bounded Chat Completions/Messages parsing, provider-shaped local/configured errors, fresh transport IDs, alternate/platform-key rejection, credential non-reflection, response limits, and abort-aware initial delay. Both dialects own bounded SSE for `stream: true`, payload-delta-only cadence, one absolute initial-wait/pacing/backpressure duration, strict preflight rejection when planned initial-plus-payload delay is not less than that duration, precomputed 2 MiB body enforcement, and cancel/deadline truncation without fabricated success. OpenAI additionally accepts Boolean-only `include_usage`/`include_obfuscation` and default-on opaque compatibility padding. Anthropic emits named message/content-block events with cumulative `message_delta` usage and no `[DONE]` or mock-emitted `ping`; clients should still tolerate upstream `ping`. It owns exact `x-api-key`, `anthropic-version: 2023-06-01`, and beta-header rejection. Configured errors remain provider JSON before HTTP `200` even when streaming is requested; configured mid-stream injection is unavailable. The environment runtime hashes before reading the current definition, compares strict verifiers without early exit, derives stateless turns from prior assistant messages, and rechecks the revision before committing the plan inside the Durable Object and returning it to the edge. Successfully parsed/planned POSTs that pass response preflight reserve one metadata-only `pending` row before delay/headers and append-once finalize that same sequence as `completed`, `cancelled`, `deadline_exceeded`, or `failed`; actual delivered status/duration enter only the terminal child, while pending reads use explicit `102`/`0` legacy-column sentinels. Configured errors use `llmErrorKind` and are `completed` when delivered. Existing `get_request_log` and `assert_requests` schemas perform exact count/query/ordered-sequence matching over dialect, operation, slug, exact selected revision, model, stream, turn, outcome, response ID, usage, stop reason, ordered tool names, and error kind. Empty headers/null bodies exclude prompts, outputs, credentials, tool inputs, `planId`, and `requestHash`; stream frame/byte counts are internal test evidence only. Reservation/finalization are fail-open, so missing or pending evidence remains possible. Package suites plus [OpenAI](../apps/worker/test/mock-llm.integration.test.ts) and [Anthropic](../apps/worker/test/mock-llm-anthropic.integration.test.ts) local Worker integrations configure through MCP, exercise pinned official-SDK provider flows, and query/assert completed/configured-error observations through the official MCP client. Direct adapter/edge-router tests, rather than the Worker-pool service binding, prove persisted `cancelled` outcomes. Generated [OpenAI](./reference/mock-llm-openai.v1.json), [Anthropic](./reference/mock-llm-anthropic.v1.json), and [product capability](./reference/product-capabilities.v1.json) manifests record the exact bounded contracts and evidence boundary. Management remains 24 MCP tools and five management HTTP routes. Designed, implemented, source-tested, and mounted-Worker integration-tested are yes for this bounded observation slice; provider SDK qualification remains provider-behavior-specific. Actual network, hosted smoke, Cloud pinning, deployment, production readiness, and live-provider parity remain no/unqualified. OpenAI Responses/configured mid-stream errors, Anthropic betas, conversation/evaluator state, and reset remain unavailable, so the F2 exit gate is not satisfied. |
| Synchronous SQL store | Accepted through the tested M5 slice | The Node [adapter](../packages/testkit/src/sql-store.ts) and [unit test](../packages/testkit/src/testkit.test.ts) share the synchronous store contract exercised through SQLite Durable Object Worker integrations. M5 adds append-only provisioning target, staged-run target, run/step, and watermark state, including one active run per app/target; local gates and the controlled-target hosted run passed. |
| Core migrations and directory repositories | Accepted through M5; bounded M6 source suite and deployed sample green | The accepted [core substrate](../packages/core/src/core.test.ts), [directory/lifecycle](../packages/core/src/directory-lifecycle.test.ts), [Okta OAuth](../packages/core/src/okta.test.ts), and [scenario/log](../packages/core/src/scenario-log.test.ts) cover the M3 engine. The M5 [provisioning planner/interpreter](../packages/core/src/provisioning) passed focused/full and controlled-target gates. M6 focused tests cover the bounded [Classic Authn service](../packages/core/src/authn/okta-authn.ts), deterministic broken-token mutations, active/successor key handling, private-key scrubbing, bounded retention, and stale-instance/sign-rotate races. Authn state retrieval uses a sliding five-minute expiry while session capabilities retain their fixed five-minute issuance expiry. Each table is capped at 10,000 retained rows and each User at 32 retained rows per kind; ordered oldest-expiry eviction and a 256-row-per-table issuance GC pass are index-backed without advancing schema v5, preserving rollback compatibility. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises the externally observable slices, not every source-only retention/concurrency/security assertion. |
| Deterministic test seams | Complete through M3; bounded M6 token/key paths accepted | The [clock/RNG](../packages/testkit/src/determinism.ts) and persisted [scenario service](../packages/core/src/scenario/scenario-service.ts) have deterministic unit coverage. The M6 token stream adds exact-only rotation and claim-skew actions with fixed broken-token mutations; the deployed sample exercised rotation, skew, and every mutation. Production signing-key material remains cryptographically generated, and deeper deterministic assertions remain source evidence. |
| Fixture schema, loader, and runner | Complete for M3 SCIM; bounded M6 executors and sampled deployment green | The [schema](../packages/testkit/fixtures/fixture.schema.json), [loader](../packages/testkit/src/fixtures.ts), and [runner](../packages/testkit/src/runner.ts) load 38 Entra and 22 Okta source-reviewed OIDC fixtures, 113 SCIM fixtures, and five M6 Okta Authn fixtures. The [M6 Worker executor](../apps/worker/test/token-fixtures.integration.test.ts) supplies authenticated MCP/session, environment, client, subject, and Graph-bearer setup for Entra fixtures 31–38; the [Authn executor](../packages/engine-http/src/okta-authn-fixtures.test.ts) runs all five Authn cases against the core-backed HTTP composition. The M6 smoke sampled all six areas but was not a remote execution of this complete generated case index. The other OIDC fixtures remain documented targets, and no live-provider comparison is claimed. |
| Provider fixture corpora | Mixed evidence | The 38 [Entra OIDC](../packages/testkit/fixtures/entra/oidc) fixtures contain 30 documented targets and eight implemented, locally Worker-executed M6 token/key/overage cases; all 22 [Okta OIDC](../packages/testkit/fixtures/okta/oidc) fixtures remain documented. The SCIM corpus contains 113 source-implemented cases. Five [Okta Authn fixtures](../packages/testkit/fixtures/okta/authn) are source-reviewed, marked `implemented`, and execute green locally. None claims comparison with a live provider tenant. |
| Entra OIDC runtime | Accepted M3 slice; bounded M6 token/key/Graph slice sampled in deployment | [Core](../packages/core/src/core.test.ts), [Worker OIDC](../apps/worker/test/oidc.integration.test.ts), and [lifecycle cascade](../apps/worker/test/lifecycle-cascade.integration.test.ts) tests cover the accepted M3 hosted-login, authorization-code, refresh/lifecycle, Entra-claim, and RS256/JWKS slice; the [M3 deployed smoke](./evidence/m3-workers-dev-smoke.md) exercised those principal paths. M6 source tests add deterministic broken tokens, skew, one-key rollover overlap, and group overage with trusted same-environment Graph fallback capped at 1,000 returned IDs. The [M6 deployed sample](./evidence/m6-workers-dev-smoke.md) exercises rotation/stale-JWKS verification, plus-300-second skew, all five broken variants, and the exact path-mode 200/201 boundary. The 1,001-ID ceiling, concurrency, private-key scrubbing, and subdomain routing remain source evidence; broader error fidelity and verified-live comparison remain open. |
| Entra MSAL Node client | Bounded local D/I/S/X/Q passed; H/V/P unqualified | Pinned `@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 traverse an actual local Wrangler HTTPS socket. The official MCP client creates and cleans up the environment; MSAL uses the request-derived custom authority with host-only `knownAuthorities` and `ProtocolMode.OIDC`, completes code + S256 PKCE and forced refresh, then receives `invalid_grant`/`AADSTS50057` after lifecycle disable. The exact six-request sequence and absence of password, secret, code, verifier, and token values from durable evidence pass. See the [quickstart](./quickstarts/entra-msal-node.md) and [local record](./evidence/entra-msal-node-local-qualification.md). No remote Worker, hosted Cloud, real Entra tenant, broad MSAL matrix, or production-readiness result is claimed. |
| Okta runtime | Accepted M3 implementation plus bounded M6 Classic Authn deployed sample | Existing [core](../packages/core/src/okta.test.ts), [HTTP adapter](../packages/engine-http/src/okta.test.ts), and [Worker integration](../apps/worker/test/okta.integration.test.ts) cover the M3 OAuth/device/directory slice. M6 adds core/HTTP/Worker coverage for `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, state retrieval/cancellation, hash-only capabilities, replay denial, lifecycle and SCIM-password-change revocation, and issuance-race denial. Successful retrieval slides state expiry; session expiry remains fixed. The HTTP shape uses singular `_embedded.factor` (an array), omits `passwordChanged`, permits same-origin CORS only for `POST` with `accept`/`content-type`, emits no credentialed-CORS allowance, and returns `403` cross-origin. Request/response bodies are recursively secret-redacted, malformed bodies are wholly redacted, and sensitive Authn headers are redacted. The [M6 smoke](./evidence/m6-workers-dev-smoke.md) samples initial states, state retrieval, CORS, privacy, and redaction; factor verification, cancellation/replay and revocation details not sampled there, verified-live comparison, and the rest of the Classic machine remain open or source-only as stated. |
| Scenario injection and request log | Accepted through the tested M5 assertion slice; M6 actions sampled in deployment; bounded F1/F2 metadata source-qualified | Accepted M3 [scenario/log tests](../packages/core/src/scenario-log.test.ts) cover deterministic scenarios, filtering, retention, and assertions. M5 response-body predicates, repeated non-overlapping ordered counts, Worker capture/redaction, local process e2e, and both hosted four-request assertions passed. M6 key rotation and clock skew are restricted to exact internal `token.before_sign` evaluation rather than the generic catch-all; both were sampled by the exact-version M6 deployed smoke. F1 adds exact MCP metadata. F2 schema v8 adds metadata-only OpenAI/Anthropic pending/terminal lifecycle rows plus exact query/count/sequence matchers, tested in core and mounted Worker/MCP integration. F1/F2 additions inherit no M5/M6 hosted or deployed evidence, and F2 observation is fail-open rather than an audit guarantee. |
| M7 application/scenario management reads | Source-complete; hosted CI, rollout, and console acceptance pending | Strict [contracts](../packages/contracts/src/index.ts) cap management pages at 25 records and bind cursors to the application or scenario resource kind. [Core](../packages/core/src/directory/applications.ts) and [scenario](../packages/core/src/scenario/scenario-service.ts) keyset pagination is covered by focused tests, and the [Durable Object integration](../apps/worker/test/management-rpc.integration.test.ts) exercises the additive `listApplications`/`listScenarios` RPCs. Application summaries are constructed field-by-field and exclude both the creation-only plaintext `clientSecret` and the persisted hash. No MCP tool, public HTTP route, CLI command, schema migration, hosted deployment, or private-console result is claimed by this source slice. |
| MCP runtime | Accepted 15-tool M5 hosted slice; 20-tool F1 registry locally qualified; 24-tool F2 source registry | The handler-agnostic [registry and tests](../packages/mcp/src/index.test.ts) preserve `run_provisioning_cycle` as tool 15, append five locally source-qualified F1 operations, and append four source-implemented F2 definition operations. Authenticated mounted Worker tests, the built-CLI process e2e, and staging/production hosted starts passed for the historical M5 set only. No F1/F2 addition inherits that deployed evidence, and npm distribution remains open. |
| CLI Stage A | Accepted M5 source command; unpublished | The unpublished `@mockos/cli` 0.1.0 source includes secret-safe `provision run` and capability negotiation for `run_provisioning_cycle`; all 19 CLI tests and the built-CLI process e2e are green. Package publication and a complete deployed CLI command matrix remain open. |
| Cloudflare Worker / Durable Object | Bounded M6 exact-version deployment sample accepted | Exact M6 public revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` passed the full local gate and [CI run 29966667984](https://github.com/reachjalil/mockos/actions/runs/29966667984). Its staging version `9ea22805-e38e-4a1b-807f-f80646cbe298` and production version `0695adab-d162-4f01-a3cf-da9c1640acdc` were manually deployed with the existing Access Keys preserved, confirmed 100% active, and passed source-locked exact-serving-version smoke. See the [M6 deployment record](./evidence/m6-workers-dev-smoke.md). The guarded Cloudflare-credential promotion workflow and verified-live parity remain unqualified. |
| SCIM inbound and lifecycle APIs | Accepted for bounded M3; M6 edges sampled in deployment | Portable contracts, bounded filter/PATCH logic, versioned persistence/service behavior, the `/scim/v2` HTTP/Worker composition, provider dialects, Graph/Okta directory adapters, and lifecycle policy have focused local and hosted coverage. All 113 accepted SCIM fixtures execute green against the HTTP composition; Worker SCIM and lifecycle-cascade suites qualify the mounted runtime. The M6 corpus separately covers an injection-locked `409` conflict with no partial mutation, a soft-delete race with tombstone-only effects, and two exact malformed-PATCH tolerances (`missing_schemas` and `singleton_operations`) that leave strict parsing and all unrelated defects unchanged. Those central paths passed the M6 deployed sample; the full eight-case M6 fixture corpus, all 113 accepted fixtures, and verified-live comparison did not run remotely. |
| Outbound provisioning | Manually accepted for the tested M5 slice | [Contracts](../packages/contracts/src/provisioning.ts), the deterministic [planner/interpreter](../packages/core/src/provisioning), Workflow/HTTP composition in [worker-kit](../packages/worker-kit/src/provisioning-workflow.ts), SSRF controls, isolated target-credential storage, the [target app](../examples/target-app), tool 15, and the CLI command pass the [local source record](./evidence/m5-local-source-qualification.md). The exact source pair then passed staging and production Workflow execution with four matched target requests, terminal success, empty target state after cleanup, and deleted target infrastructure in the [deployment record](./evidence/m5-workers-dev-smoke.md). Live-provider parity and recurring scheduling remain open. |
| Hosted cloud control plane, billing, console | Not in this repository; no public dependency | A separately operated private composition consumed exact public M5 runtime revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` for the recorded manual acceptance. That evidence demonstrates use of the exported public seams, not a private runtime dependency: the Apache-2.0 Worker remains buildable and self-hostable without private code, licensing, billing, or call-home behavior. |
| SAML | Intentionally deferred | v2 product scope, after the listed milestones. |
| workers.dev deployment | M6 manually rolled out and exact-version smoke accepted; guarded promotion unqualified | Exact public M6 source was manually deployed staging before production and confirmed 100% active. The existing standalone public Access Keys were preserved, and the source-locked GitHub smoke used their pre-existing masked secrets to exercise all six M6 slices plus accepted regressions on both exact serving versions. The separate guarded Cloudflare-credential deployment workflow was not executed or formally qualified. |
| Custom `mockos.live` zone | Blocked on domain purchase | M8 cutover-only dependency. |
| npm publishing | Blocked externally | The `@mockos` names remain the intended scope, but npm authentication is unavailable and the scope is not confirmed as registered. Source-build use remains the supported public path. |

## Milestone acceptance

The code-and-test portions of M0, M1, and M2 pass locally. The
[curl walkthrough](./quickstarts/curl.md) maps to the implemented control and protocol
routes and has an independent [local `wrangler dev` result](./evidence/m1-wrangler-dev-smoke.md).
The [M2 deployed smoke](./evidence/m2-workers-dev-smoke.md) passed create, discovery,
mint, JWKS verification, hosted PKCE, AADSTS50076 injection, request-log query,
assertion, deletion, and empty-catalog checks in staging and production. The exact
candidate also has a [green hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591),
so the M2 prerequisite and F0 merge gate are satisfied.

M3 is accepted at exact revision `8645f405d5e3b922c30d51339b8b27f9fe30d93e`.
Contracts, core, SCIM adapter/service, provider directory, refresh/lifecycle, MCP,
CLI, and Worker tests pass locally and in
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29886610480). The
[expanded deployed smoke](./evidence/m3-workers-dev-smoke.md) passed at staging and
production for that revision, including reverse cleanup and final empty-catalog
checks. This accepts the tested M3 emulator slice; source-reviewed provider fixtures
and the deployed smoke do not constitute comparison with a real Entra tenant or Okta
organization. Live-provider parity, automated deploy-workflow execution, npm
publication, and the listed capability gaps remain open.

M5 is manually accepted for the tested source-paired slice. Exact public runtime
revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed hosted CI, local source
qualification, manual staging-before-production rollout, and controlled-target hosted
Workflow acceptance. The two runs each finished platform/runtime success with four
matched requests; target state was cleared and the disposable target Worker was
deleted. See the [local qualification](./evidence/m5-local-source-qualification.md)
and [deployment record](./evidence/m5-workers-dev-smoke.md).

This acceptance does not qualify the guarded GitHub promotion workflows, an
authenticated M5 flow on the preserved standalone public Worker credentials, npm
publication, recurring scheduling, or live-provider parity.

M6 is accepted for the bounded source and sampled deployed slice at exact public
revision `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`. It contains all six bounded
slices: five executable Okta Classic Authn fixtures; injection-locked SCIM conflict,
soft-delete-race, and narrow PATCH-tolerance cases; signing-key rotation with JWKS
overlap; bounded token-claim clock skew; five deterministic broken-token variants; and
the exact 200-inline/201-overage boundary with trusted same-environment Graph fallback
and a 1,000-ID response ceiling. The Authn source additionally qualifies sliding state
versus fixed session expiry, caps/ordered eviction/256-row GC, schema-v5-compatible
indexes, lifecycle/password revocation, restricted same-origin non-credentialed CORS,
provider-shaped response omissions, and recursive secret redaction. The full local gate,
[hosted CI](https://github.com/reachjalil/mockos/actions/runs/29966667984), manual
staging-before-production rollout, and [exact-version smoke](./evidence/m6-workers-dev-smoke.md)
are green. The smoke sampled every slice plus accepted regressions, but did not execute
every fixture or source-only denial/concurrency/cap assertion remotely. This acceptance
does not qualify the guarded Cloudflare-credential deploy workflow, corpus-wide parity,
or verified-live provider comparison.

## Entra MSAL Node local client qualification

The source candidate carrying this document pins `@azure/msal-node` 5.4.2 and adds a
dedicated actual-network harness. An owned local Wrangler process serves HTTPS. The
parent anchors the captured `localhost` leaf and validates its hostname plus ownership
nonce before the child adds that certificate as a process-local CA through
`NODE_EXTRA_CA_CERTS`, retaining standard Node trust. The child independently requires
an HTTPS `localhost` origin and the same nonce; no alternate-certificate rejection is
qualified. It connects to management through the official MCP SDK and configures the
Entra application entirely through the discovered tool contract. MSAL uses the returned
issuer with
`knownAuthorities: [new URL(authority).host]` and
`system.protocolMode: ProtocolMode.OIDC`.

The client completes authorization code with S256 PKCE, validates account/tenant/token
claims, forces a successful token-endpoint refresh, disables the User through MCP, and
observes a rejected forced refresh with `invalid_grant` and `AADSTS50057`. It matches the exact
discovery/login/code/refresh/disabled-refresh sequence, proves durable credential
redaction, deletes the environment, closes MCP, and removes the temporary CA. The
focused lifecycle Worker test independently protects the persistent redaction
boundary. A separate `SIGTERM` cleanup probe observes parent exit `143`, releases the
port, removes the detached Wrangler process group, and removes temporary state.

`pnpm e2e:entra-msal`, `pnpm e2e:entra-msal-cleanup`, and the focused Worker tests
passed locally; exact output is in the
[qualification record](./evidence/entra-msal-node-local-qualification.md). This is
D/I/S/X/Q evidence for the named version and flow only. The signal probe covers a ready
Worker on this local platform, not `SIGKILL`, Windows, or every active-client
interruption point. No hosted-CI result is claimed by this local record, and there is no
H, V, or P evidence.

The M7 application/scenario management-read substrate is source-complete but not
deployed. Its strict query contract defaults to and caps pages at 25 records with a
512-character cursor ceiling. Core reads use stable `(created_at, id)` keysets and
resource-kind-bound cursors. `ApplicationSummary` is deliberately distinct from the
creation response: `createApplication` still returns the generated plaintext secret
once, while every later list result excludes it and the stored hash. The two new
Durable Object RPCs are additive and schema-v5 compatible. The full local `pnpm check`
gate, including the focused contract/core coverage and real Durable Object integration,
is green; hosted CI, exact-version staging/production rollout, private Edge/Control
integration, and console/browser acceptance remain pending and must not inherit the M6
evidence.

F0 is source-complete for its bounded foundation in the repository revision carrying
this document. One registry now owns operation IDs, descriptions, Zod request/response
schemas, scopes, effects, retry/secret policy, MCP annotations, and the five live HTTP
route shapes. Deterministic generation checks the OpenAPI document and client
authorization map byte-for-byte; focused tests cover typed requests, path/query/body
encoding, response/problem validation, abort forwarding, exact route/scope agreement,
all six behavior variants, disabled Code Mode, and fail-closed `NoSandbox`. The full
local `pnpm check` gate, including all existing Worker/M suites and Wrangler dry-run,
is green. Hosted CI, merge, deployment, package publication, Worker Loader evidence,
and F-series runtime activation remain pending.

The bounded F1 transport/runtime is locally source-qualified in the revision carrying
this document: the focused suites and complete repository gate are green. F2 adds
focused kernel/definition tests and bounded routed OpenAI/Anthropic provider runtimes that are
source-qualified locally through the official SDK Worker integration. It is not a
hosted or deployed provider runtime. Hosted CI, merge, package publication,
deployment, private Cloud integration, Anthropic beta/configured-midstream/state/
observation work, F3 runtime, F4 authorization/audit, broader client/ecosystem
conformance, and F6 Code Mode activation remain pending.
