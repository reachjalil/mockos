<p align="center">
  <img src="./assets/brand/mockos-mark.svg" width="112" alt="">
</p>

<h1 align="center"><span aria-hidden="true">🥸</span> mockOS</h1>

<p align="center"><strong>MCP-first identity and agent-dependency infrastructure for integration tests.</strong></p>

<p align="center">Let agents build deterministic Entra ID, Okta, MCP, OpenAI, and Anthropic test environments, then run real integrations against their protocol surfaces.</p>

> **Project status:** M0 through M3 are accepted at exact revision
> `8645f405d5e3b922c30d51339b8b27f9fe30d93e`. M5 outbound provisioning is manually
> accepted for exact public runtime revision
> `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`: local/full gates, hosted CI, manual
> staging-before-production rollout, and source-paired controlled-target Workflow
> acceptance are green. The bounded M6 slice is accepted at exact public revision
> `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`: the full local gate, hosted CI, manual
> staging-before-production rollout, and exact-version smoke of Classic Authn, SCIM
> edges, signing-key rotation, token skew/broken tokens, and 200/201 group overage are
> green. This is sampled deployed mock evidence, not corpus-wide or verified-live
> parity. The F0 contract/client/OpenAPI foundation and bounded F1 mock-MCP runtime
> are locally source-qualified in the revision carrying this document: their focused
> suites and the complete repository `pnpm check` gate are green. F1 definition
> mutations now require explicit revision intent, preserve canonical put replay, and
> protect changed replacement/reset/delete from stale or delete/recreate ABA callers.
> Canonically identical content, including an identical recreated generation,
> deliberately converges before CAS without mutation. F1 also exposes a built-in,
> secret-free `salesforce/hosted-mcp/sobject-reads` server-definition preset through
> three MCP-only catalog/install tools. The
> mounted official MCP SDK `1.29.0` Worker flow qualifies that bounded management
> path through D/I/S/X/Q only; it is not actual-network or hosted evidence, V is not
> applicable to the generic synthetic runtime, the provider-derived preset's
> live-provider V remains unqualified, and P remains unqualified.
> Hosted CI/merge,
> F1/F2 deployment, private Cloud consumption, the remaining F2 runtime, and all
> experimental activation remain pending. F2 now adds four source-implemented,
> MCP-only mock-LLM definition operations with environment-local schema-v8 persistence
> and write-only provider keys plus bounded OpenAI Chat Completions JSON/SSE and
> Anthropic Messages/model JSON/SSE data planes. Package tests and local Worker
> integrations through pinned official OpenAI 6.49.0 and Anthropic 0.115.0 SDKs qualify
> that bounded source slice. Successfully parsed/planned provider POSTs that pass
> response preflight attempt one metadata-only request-log reservation within a
> 50-millisecond fail-open budget; prospective metadata/credential collisions skip
> it. The existing management MCP tools query and assert persisted lifecycle fields. Prompts,
> outputs, headers, credentials, tool inputs, stream frame/byte counts, `planId`, and
> `requestHash` are not captured. Configured midstream errors, the OpenAI Responses
> API, Anthropic betas, conversation state, actual-network/hosted qualification, and
> complete F2 remain unavailable. Separate local official-client
> candidates qualify `@azure/msal-node` 5.4.2 and `@okta/okta-auth-js` 8.0.1 through
> D/I/S/X/Q only; neither has H/V/P evidence. The guarded GitHub promotion workflows
> remain unqualified. This is not yet a stable npm release or a production-SLA
> service. See the
> [evidence ledger](./docs/IMPLEMENTATION_STATUS.md).

mockOS is an Apache-2.0 open-core project for testing OIDC/OAuth 2.0, SCIM 2.0,
directory lifecycle, RBAC, and failure handling without depending on a real enterprise
tenant. Provider expectations live as source-attributed fixtures; deterministic clock,
randomness, and SQLite seams make failures reproducible.

## MCP first

The management MCP server at `/mcp` is the primary control interface for agents and
automation. Its current 27 tools create and configure environments, seed synthetic
identities, register applications, drive lifecycle and provisioning, inject
deterministic scenarios, configure environment-hosted mock MCP servers and mock-LLM
definitions, inspect and install built-in mock-MCP presets, inspect captured traffic,
and clean up. Start
with the
[MCP-first quickstart](./docs/getting-started/mcp-first.md) and use the
[generated tool reference](./docs/reference/management-tools.md) for the exact
registry in this source.

Applications under test do not call management MCP. They connect to the OIDC, OAuth,
SCIM, Graph-shaped, or Okta-shaped endpoints returned for an environment. The
[interface model](./docs/concepts/interface-model.md) separates those provider
surfaces from management MCP, the CLI, the operated console, and the narrower
five-route self-hosted HTTP API.

Environment-hosted mock MCP servers have a different product role: they simulate
tools, resources, resource templates, and prompts for an agent under test. The bounded
F1 source implements that data plane at an environment route while five
definition/state operations and three built-in blueprint operations remain part of
management MCP. Put and install use
`expectedRevision: null` for create or the positive current revision for a complete
replacement; reset and delete require the positive current revision. Canonical put
or install replay precedes CAS; only changed-definition stale/ABA mutation intent
returns typed `409`. A changed replacement deletes application state and terminates
revision-bound sessions. Bearer replacement must resupply or rotate the raw synthetic
credential because the safe `configured: true` view cannot be written back, and the
same raw value is rejected from every other definition key or string value. Start with
the [mock MCP guide](./docs/mock-mcp.md) or install the
[Salesforce SObject Reads built-in blueprint](./docs/blueprints/salesforce-sobject-reads.md).
Four
[mock-LLM definition operations](./docs/mock-llm.md) are source-implemented through
management MCP. The separate F2 data plane now source-qualifies OpenAI model
list/retrieve and Chat Completions as JSON or bounded SSE plus Anthropic model
list/retrieve and Messages as JSON or named-event bounded SSE at environment routes
through pinned official SDKs. Configured midstream errors, the OpenAI Responses API,
Anthropic betas, conversation state, script execution, enforced scoped keys, Cloud
integration, and deployment remain unavailable. Successfully parsed/planned provider
POSTs that pass response preflight do produce bounded metadata-only observations for
the existing `get_request_log` and `assert_requests` tools; delivery is fail-open and
not an audit guarantee. Start with
the [OpenAI SDK quickstart](./docs/quickstarts/openai-sdk.md) or
[Anthropic SDK quickstart](./docs/quickstarts/anthropic-sdk.md), and use the
[partial F2 LLM record](./docs/f-series/f2-llm-kernel.md) for architecture and exact
evidence boundaries.

The target deployment is Cloudflare-forward: Workers, SQLite Durable Objects,
Workflows, Queues, KV, and an Agents SDK MCP server. This public repository contains
the portable engine and a self-hostable Worker. Operated-service code lives separately
and may consume explicit public seams; this repository does not import or require that
private control plane, licensing, billing, or a hosted mockOS account.

## What exists now

- Workspace and package scaffolding
- Runtime-independent contracts, append-only migrations, versioned User/Group and
  application repositories, SCIM filter/PATCH behavior, and provider lifecycle policy
- An Okta OIDC profile covering discovery, hosted authorization code + S256 PKCE,
  refresh exchange, token introspection and revocation, and RFC 8628 device
  authorization in local tests
- Explicit confidential and public OAuth application registrations. Public clients
  have no stored or returned secret, cannot use `client_credentials`, can redeem code
  and refresh grants without a secret, and can revoke only their own tokens;
  introspection remains confidential-client-only
- Entra and Okta refresh-token rotation with scope narrowing, replay-family
  invalidation, and lifecycle-driven access/refresh revocation
- An accepted SCIM 2.0 Users/Groups surface at `/scim/v2`, bounded
  Microsoft Graph reads at `/graph/v1.0`, and an Okta Users/Groups lifecycle API at
  `/api/v1`
- A synchronous `node:sqlite` test store
- Deterministic test clock and RNG, persisted deterministic scenarios, bounded request
  logs, and request assertions
- Fixture schema, loader, and runner; 38 source-reviewed Entra OIDC fixtures (30
  documented and eight implemented M6 cases that execute through the local Worker);
  22 documented Okta OIDC fixtures; and a locally and hosted-CI green 113-case
  RFC/Entra/Okta SCIM corpus
- A bounded M6 implementation for deterministic signing-key rotation/JWKS overlap,
  plus/minus token-claim clock skew, five explicit broken-token variants, and Entra
  group claims inline through 200 with a trusted same-environment Graph fallback at
  201 and a 1,000-ID response ceiling
- A bounded M6 implementation for injection-locked SCIM `409` conflict and
  soft-delete race behavior plus two case-specific malformed-PATCH tolerances; strict
  parsing remains the default and unrelated defects are not repaired
- A bounded M6 Okta Classic Authn implementation for `SUCCESS`, `MFA_REQUIRED`,
  `PASSWORD_EXPIRED`, and explicit `LOCKED_OUT`, with state retrieval/cancellation and
  one-time session capabilities. State retrieval slides the five-minute state expiry;
  session expiry stays fixed at five minutes. Each table is capped at 10,000 retained
  rows, each User at 32 rows per capability kind, oldest-expiring rows are evicted, and each
  issuance prunes at most 256 expired rows per table through schema-v5-compatible
  operational indexes
- Same-origin Classic Authn CORS that allows only `POST` with `accept` and/or
  `content-type`, never enables credentialed CORS, and rejects cross-origin requests
  with `403`; provider-shaped responses use the singular `_embedded.factor` array and
  omit `passwordChanged`. Lifecycle and SCIM password changes revoke pending state and
  session capabilities, while Authn body fields and sensitive headers are recursively
  redacted from request logs
- Cloudflare path routing and a SQLite Durable Object integration that completes hosted
  login, S256 PKCE, code redemption, refresh/lifecycle failure, directory reads, Entra
  claims, and JWKS signature verification in focused local suites
- An accepted authenticated Agents SDK management MCP server whose current source
  registry contains 27 tools: the accepted 15-tool M5 set, eight MCP-only F1 mock-MCP
  definition/state/catalog/install operations, and four MCP-only F2 mock-LLM definition
  operations
- A bounded F1 source runtime for deterministic environment-hosted tools, resources,
  safe Level-1 resource templates, and prompts over MCP `2025-11-25`; definitions are
  revisioned with null-create/positive-current mutation CAS, canonical replay is
  retry-safe even for an identical recreated generation, changed replacement is a full
  credential-resupplying write that deletes state and sessions, and reset/delete reject
  stale or ABA generations atomically. Bearer Mock Credentials and transport sessions
  are stored hash-only; cross-field credential reuse is rejected; behavior state is bounded; both
  hosting routes are resolved, and MCP method/tool/argument evidence joins the
  existing request log and assertions. A documentation-derived, secret-free Salesforce
  SObject Reads preset supplies six deterministic read tools with no provider network
  or output-wire-parity claim. The 27-tool registry leaves the five-route HTTP surface
  unchanged. GET streaming,
  `listChanged`, scripts, proxy/record-replay, hosted qualification, and deployment
  remain open
- A source-complete local F0 foundation: one 27-operation metadata registry consumed
  by MCP, deterministic OpenAPI and typed-client artifacts for the five live HTTP
  control routes, generated human/machine management and built-in blueprint references
  plus agent indexes, a
  fetch-based `@mockos/client` workspace skeleton, all six locked version-one behavior
  contracts, and fail-closed Code Mode/`NoSandbox` wrapper packages. The F1 operations
  deliberately do not appear in HTTP/OpenAPI/client projections, nor do the four F2
  operations; the new packages
  are not yet distribution-qualified
- A partial F2 source slice with bounded provider-neutral response-plan schemas,
  behavior-to-plan adaptation, pure OpenAI Chat Completions and Anthropic Messages
  JSON/SSE-frame renderers, pinned official-SDK consumption through injected
  in-process Fetch, strict server-definition contracts, four MCP-only management
  operations, schema-v8 environment persistence, mandatory revision
  compare-and-swap, safe credential views, and bounded OpenAI and Anthropic provider
  request adapters. Local Worker integrations configure through MCP and exercise
  official SDK model list/retrieve, JSON text/tool/error calls, bounded OpenAI and
  Anthropic SSE ordering/tools/cancellation, OpenAI usage/obfuscation,
  provider-specific authentication/versioning, isolation, rotation, and fresh
  transport identity. Both streams perform a complete 2 MiB UTF-8/schedule preflight,
  pace payload deltas only, and enforce one absolute initial-wait/pacing/backpressure
  deadline. Anthropic uses named events ending in `message_stop`, with no `[DONE]`.
  Successfully parsed/planned provider POSTs that pass response preflight attempt one
  metadata-only reservation within a 50-millisecond fail-open budget; prospective
  metadata/credential collisions skip it. In-budget rows append-once finalize as
  `completed`, `cancelled`, `deadline_exceeded`, or `failed`; exact
  query/count/ordered-sequence matchers run through existing management MCP. This is fail-open evidence, excludes provider
  payloads and internal stream frame/byte counts, and is not an audit trail.
  Configured midstream errors, OpenAI Responses, Anthropic betas,
  runtime/conversation state, reset, Wrangler-network or deployed conformance, and
  Cloud pinning remain unavailable
- Local actual-network official-client qualifications for MSAL Node 5.4.2 as an Entra
  confidential client and Okta Auth JS 8.0.1 as an Okta public client. Both use MCP
  for setup, observation, lifecycle, and cleanup and traverse an owned local Wrangler
  HTTPS process; each is D/I/S/X/Q evidence only
- The unpublished `@mockos/cli` 0.1.0 source command surface, including
  `lifecycle simulate`, the M5 candidate's secret-safe `provision run`, and capability
  negotiation
- A tested M5 implementation for deterministic Entra/Okta outbound SCIM planning and
  interpretation, batched Cloudflare Workflow execution, bounded/redacted HTTP
  capture, SSRF policy enforcement, and environment-scoped target credentials; the
  current local Worker, worker-kit, repository, and two-process e2e gates are green
- A local target-app example for exercising outbound SCIM sequences, plus ordered
  request assertions that count non-overlapping matches and can check response shapes
- Accepted M3 staging and production Worker deployments with exact-revision evidence,
  repeatable smoke, CI, documentation, and a repository testing skill

Management and protocol credentials are deliberately separate: MCP requires the
configured Access Key, while SCIM/Graph accept non-empty synthetic Bearer values and
the Okta API accepts a non-empty synthetic SSWS value. An environment-hosted mock MCP
server accepts no credential or its own write-only Bearer Mock Credential. A mock-LLM
definition independently configures write-only OpenAI and Anthropic Mock Credentials.
The OpenAI data plane requires a valid provider Bearer value. The Anthropic data plane
requires a valid `x-api-key` Mock Credential plus exactly
`anthropic-version: 2023-06-01`. For both dialects, `accept_any` skips verifier
comparison but is not unauthenticated, while `strict` compares only the dialect's
current verifier. Those are synthetic protocol boundaries, not production
authorization; never forward the management key to them.

Thirty Entra and all 22 Okta OIDC fixtures remain `documented`; eight Entra M6
token/key/overage fixtures are `implemented` and execute through an authenticated local
Worker fixture runner. No OIDC fixture is `verified-live`. The 113 accepted SCIM
fixtures and the separate M6 SCIM-edge corpus record source-implemented behavior; none
is `verified-live`.
The accepted M3 and M5 records remain distinct. M5 passed its
[local full and two-process source gates](./docs/evidence/m5-local-source-qualification.md)
and [exact-pair manual deployment/hosted acceptance](./docs/evidence/m5-workers-dev-smoke.md).
That evidence does not qualify guarded promotion, standalone public Access-Key smoke,
npm publication, or live-provider parity. M6 has a separate
[sampled exact-version workers.dev acceptance](./docs/evidence/m6-workers-dev-smoke.md)
for all six bounded slices. It does not promote the generated case index or fixture
corpora to corpus-wide deployed or verified-live parity.

## Evidence levels

mockOS records designed (D), implemented (I), source-tested (S),
integration-tested (X), SDK/client-qualified (Q), hosted-smoke (H), verified-live (V),
and production-ready (P) independently. Local official-client execution can establish
X/Q without H. Hosted CI remains S; H requires an exact remote serving version and
recorded smoke. V requires sanitized, reviewed comparison with a real provider. No
current fixture or milestone is V or P. See the
[documentation index](./docs/README.md) for the exact definitions.

## Local verification

Requires Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The concrete [local curl walkthrough](./docs/quickstarts/curl.md) uses the implemented
control and identity-protocol routes. The
[Entra MSAL Node](./docs/quickstarts/entra-msal-node.md) and
[Okta Auth JS](./docs/quickstarts/okta-auth-js-node.md) guides reproduce the two
bounded local official-client paths. The
[OpenAI SDK quickstart](./docs/quickstarts/openai-sdk.md) configures a mock LLM
through MCP and calls its bounded provider data plane; the
[Anthropic SDK quickstart](./docs/quickstarts/anthropic-sdk.md) does the same for the
stable JSON/SSE Messages subset. Read
[self-hosting](./docs/self-hosting.md) before trying Wrangler and
[known limitations](./docs/known-limitations.md) before choosing an SDK.
The sanitized [M6 workers.dev smoke evidence](./docs/evidence/m6-workers-dev-smoke.md)
records the latest exact accepted candidate, version IDs, exercised flow, and cleanup result for
[staging](https://mockos-staging.workspaceagent.workers.dev) and
[production](https://mockos.workspaceagent.workers.dev).

## Architecture

```text
contracts <- core <- engine-http ---------- worker-kit <- apps/worker
     |          |                               ^
     |          +---- behavior/state ----------+
     +---- mcp-mock (mock data plane) ----------+
     +---- llm-mock (partial OpenAI/Anthropic F2 data plane)
     +---- mcp (management plane) --------------+
                testkit
```

The engine uses a synchronous `SqlStore` so SQLite Durable Objects and
`node:sqlite` tests can share logic. Provider profiles adapt URLs, claims, errors, and
dialects instead of forking the engine. Absolute issuer URLs must be derived per request
and never persisted.

## Documentation

Start at the [documentation index](./docs/README.md). It routes agents and humans by
task, distinguishes the 27-tool management MCP interface, the environment-hosted mock
MCP data plane, the MCP-managed OpenAI/Anthropic data planes, and the five-route
management HTTP subset, and
links support claims to their evidence. Use
[requirements traceability](./docs/requirements-traceability.md) and the
[parity matrix](./docs/conformance/parity-matrix.md) to distinguish targets from
evidence. Machine readers can begin with [`llms.txt`](./llms.txt) or the curated
[`llms-full.txt`](./llms-full.txt). The [brand guide](./docs/brand.md) defines the
restrained use of 🥸 and the original vector assets.

## Contributing and security

Contributions are welcome under [CONTRIBUTING.md](./CONTRIBUTING.md). Do not use real
identities, passwords, production access tokens, or platform credentials in fixtures.
Report vulnerabilities through [SECURITY.md](./SECURITY.md).

Licensed under the Apache License 2.0.
