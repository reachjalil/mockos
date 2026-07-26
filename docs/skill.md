# mockOS testing skill

Status: Accepted identity workflow plus bounded M6, F1 mock-MCP, F2
mock-OpenAI/Anthropic, and MSAL authorization-code/public-device plus Okta Auth JS
local official-client guidance
Last reviewed: 2026-07-26

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to inventory an application's configuration, capability-negotiate
management MCP, create an isolated environment, and test the application against the
currently qualified identity, environment-hosted mock-MCP, or bounded
mock-OpenAI/Anthropic surface. For identity workflows it seeds synthetic identities,
registers a client, wires request-derived provider metadata, and distinguishes
confidential registrations with a creation-only secret from public registrations
with no secret.

The workflow covers the accepted M5 slice plus bounded M6 recipes:

- authorization code with required S256 PKCE for Entra ID or Okta;
- bounded local official-client recipes for `@azure/msal-node` 5.4.2 as one
  confidential authorization-code and one separate public device Entra client, plus
  `@okta/okta-auth-js` 8.0.1 as a public Okta client, all using MCP for setup,
  observation, lifecycle, and cleanup over owned Wrangler HTTPS;
- SDK 1.29 tools-list verification that the Draft-7 public/confidential input
  conditional and exact result branches match runtime validation;
- rotating refresh grants with scope narrowing, replay cautions, and provider-correct
  lifecycle revocation failures;
- public Okta access-token revocation that is owner-bound and discovery-advertised as
  `none`, with a cross-client negative regression and actual-client state-change
  postcondition, while introspection remains confidential-client-only;
- Okta device authorization, activation, introspection, and revocation within the
  implemented authorization-server boundary;
- Entra public device authorization with a 900-second/five-second policy, no complete
  verification URI, credential-gated approve and deny, MSAL's immediate pending poll,
  public refresh rotation, lifecycle rejection, and strict device evidence redaction;
- SCIM discovery and versioned synthetic User/Group CRUD/PATCH with weak ETags;
- bounded Entra Graph reads and Okta Users/Groups/lifecycle API checks using separate
  test-only credential schemes;
- bounded Okta Classic primary authentication with password-before-state privacy,
  deterministic initial states, sliding state versus fixed session expiry,
  transaction cancellation/replay checks, lifecycle/password revocation, bounded
  retention, restricted same-origin non-credentialed CORS, provider-shaped response
  omissions, and recursive Authn body/header redaction;
- capability discovery against the 27-tool current management registry, preserving
  `simulate_lifecycle` and `run_provisioning_cycle` and recognizing five F1
  mock-MCP definition/state operations, three F1 built-in-blueprint operations, and
  four F2 mock-LLM definition operations;
- revision-safe F1 mock-MCP create, canonical replay, reset, complete replacement,
  stale-conflict reconciliation, and delete through the five MCP-only tools, including
  raw Bearer resupply rather than safe-view round-tripping;
- built-in blueprint list/get/install for
  `salesforce/hosted-mcp/sobject-reads`, followed by deterministic exercise,
  observation, assertion, and cleanup of its six Salesforce-style tools without
  confusing source provenance with live-provider verification or the future F5
  portable blueprint system;
- MCP-managed OpenAI definitions, an authenticated model-discovery capability probe,
  official-SDK JSON and bounded SSE Chat Completions, stream-option and cancellation
  checks, one bounded negative case, and revision-safe cleanup without confusing
  provider traffic for management;
- MCP-managed Anthropic definitions, authenticated `GET /v1/models`, official
  `@anthropic-ai/sdk` 0.115.0 JSON and named-event SSE Messages with
  `maxRetries: 0`, exact `anthropic-version: 2023-06-01`, stream ordering/tool/
  cancellation checks, one auth/version negative, and the same revision-safe cleanup;
- deterministic Entra- and Okta-shaped outbound SCIM planning through a durable
  Workflow, with User-before-Group execution, explicit 429 waits/retries, saved or run-
  scoped targets, and the disposable target application;
- `mint_token` negative cases for expired, wrong-audience, not-yet-valid,
  bad-signature, and wrong-issuer tokens;
- one-key-at-a-time signing rotation with JWKS overlap, bounded claim-only clock skew,
  and the exact Entra 200-inline/201-overage boundary with trusted same-environment
  Graph fallback capped at 1,000 returned IDs;
- deterministic delay, semantic-error, and restricted JSON-mutation scenarios,
  including `scim.request`, `graph.request`, and `okta.api` error/delay routing;
- the M6 SCIM slice's injection-locked conflict, soft-delete race, and two
  explicit malformed-PATCH tolerance recipes, with strict parsing as the default; and
- filtered request logs plus literal request/response-body matchers and complete non-
  overlapping ordered-sequence assertions before cleanup.

The skill treats capability discovery as connected-server evidence, not proof that
local source is deployed. Its evidence vocabulary has eight independent levels:
designed (D), implemented (I), source-tested (S), integration-tested (X),
SDK/client-qualified (Q), hosted-smoke (H), verified-live (V), and production-ready
(P). Hosted CI remains S; H requires an exact remote serving version and recorded
smoke; V requires sanitized reviewed real-provider comparison. The two official-client
recipes are D/I/S/X/Q yes and H/V/P no. A provisioning call returns a queued run; the
skill polls bounded outbound evidence and checks target state before reporting success.
It never places target credentials in command arguments, never reuses a platform `mk_`
Access Key or the exact active non-prefixed self-host Access Key as a mock SCIM
credential, and requires target Bearer redaction in captured evidence. A key-rotation
collision with a saved target must fail before outbound execution.

For application registration, the skill never fabricates an empty secret. It retains a
confidential client's returned secret only in memory or a test secret store and expects
it exactly once. For a public client it requires `clientType: "public"`, omits
`clientSecret`, rejects `client_credentials`, and requires the response to omit the
secret. It treats public refresh tokens as bearer credentials rather than as proof of
client authentication. For a device-only Entra public application the skill sends
`redirectUris: []` and does not invent a callback. If `authorization_code` is also
registered, the skill requires the real, exact callback URI used by that mixed flow.

For the MSAL and Auth JS log claims, it parses exact exercised fields as `[REDACTED]`
and checks raw, `encodeURIComponent`, and URL-form-encoded credential/token
representations. The MSAL path includes device/user codes, the repeated device
message, activation credentials, and device tokens. The skill does not promote that
bounded proof to arbitrary-encoding classification. The
shared official-client parent and cleanup verifier also reject inherited
`NODE_TLS_REJECT_UNAUTHORIZED=0`, use distinct provider/inspector ports, and require
both ports to be released.

The [M6 workers.dev record](./evidence/m6-workers-dev-smoke.md) is the immutable
deployed reference for the sampled six-slice acceptance. It does not turn an arbitrary
connected server, a local recipe run, the 21-case generated source index, or either
fixture corpus into deployed evidence, and it is never verified-live provider evidence.

All management calls require the fail-closed `API_KEY`; the skill never asks an agent
to print it. It keeps the management key out of SCIM/Graph/Okta, outbound target, and
mock-OpenAI/Anthropic provider calls, records explicit environment IDs for automation,
clears scenarios, deletes environments in a `finally`-style cleanup, and closes the
MCP client so its server session is terminated. Every identity, password, application
secret, directory Bearer/SSWS value, target credential, OpenAI Mock Credential, and
provider token used as test data must be synthetic.

Browser callback UX, other MSAL/Auth JS versions, the rest of the Okta Classic Authn
transaction machine, broad Graph/Okta API parity, SAML, unrecorded deployment
qualification, and npm publication remain outside the workflow. Use only immutable
CI/deployment records linked by the implementation ledger, and never present mockOS
source or deployment evidence as verified-live provider parity.

The checked skill remains primarily an identity-integration workflow. For an agent
under test, route directly to [Environment-hosted mock MCP](./mock-mcp.md), which owns
the management/data-plane distinction, server-definition contract, wire sequence,
state and revision semantics, observation matchers, and F1 limitations. The existence
of those source tools does not imply that the F1 route is deployed on an arbitrary
connected server; capability-negotiate management MCP and retain the endpoint/evidence
boundary returned by the operator.

## Bounded mock-MCP recipe

For a deterministic MCP dependency, the skill requires this exact control/data-plane
separation:

1. Capability-negotiate `put_mock_mcp_server`, `list_mock_mcp_servers`,
   `get_mock_mcp_server`, `reset_mock_mcp_state`, and
   `delete_mock_mcp_server`; verify the discovered required `expectedRevision`
   schemas before mutation.
2. Create a disposable environment, then create the server with an explicit
   environment ID, `expectedRevision: null`, and a complete definition. Keep a
   synthetic Bearer Mock Credential in caller-owned secret storage when strict
   authentication is needed.
3. Retain the returned positive revision and safe view. The Bearer
   `configured: true` marker proves configuration only; it is not replacement input.
4. Connect the application or agent under test to the operator-reported environment
   mock MCP route using the separate synthetic credential. The management tools alone
   do not prove that a connected deployment serves the data plane.
5. Reset deterministic application state with the current revision. Preserve the
   definition, revision, and sessions, and accept an exact retry as `cleared: 0`.
6. For a changed replacement, read and reconcile the current server, pass that
   positive revision, resend the complete definition, and resupply or rotate the raw
   Bearer credential. The raw value is valid only at `authentication.token`; its exact
   value must be rejected from every other definition key or string value, and a
   dependency response that reflects it must fail closed. Canonical replay may
   succeed with a stale or `null` expectation, including an identical definition in a
   later delete/recreate generation, but changed stale or ABA intent must return
   `MOCK_MCP_SERVER_REVISION_CONFLICT`.
7. In `finally`, read the latest generation and delete it with that positive
   revision. Require `deleted: true`; a repeated delete returns
   `MOCK_MCP_SERVER_NOT_FOUND`, not replayed success.
8. Delete the disposable environment and close management MCP. Report the bounded
   mounted `@modelcontextprotocol/sdk` `1.29.0` Worker path as D/I/S/X/Q only, never
   broader than the named flow and as not actual-network, hosted, deployed, or
   broad-client evidence. H and P remain unqualified; V is not applicable to this
   generic synthetic-engine recipe.

## Bounded Salesforce SObject Reads blueprint recipe

Use the
[Salesforce Hosted MCP SObject Reads preset guide](./blueprints/salesforce-sobject-reads.md)
and generated
[blueprint catalog](./reference/mock-mcp-blueprints.v1.json) for the exact fixture
contract. This is a built-in, secret-free server-definition preset, not the portable
F5 export/import/apply/gallery system.

1. Capability-negotiate `list_mock_mcp_blueprints`,
   `get_mock_mcp_blueprint`, and `install_mock_mcp_blueprint` in addition to the five
   server-definition/state tools. Require the connected registry to expose the exact
   install CAS schema; the current source registry has 27 MCP tools and five companion
   HTTP routes.
2. List and get `salesforce/hosted-mcp/sobject-reads`. Confirm its provenance is
   documentation-derived, its source review date is 2026-07-25, its provider network
   flag is false, its output-wire-parity status is unqualified, and its authentication
   mode is `none`.
3. Create a disposable environment and install with `expectedRevision: null`. A
   changed replacement requires the positive current revision and is destructive:
   it deletes prior application state and terminates revision-bound sessions.
   Canonically identical replay, including identical delete/recreate convergence,
   succeeds before CAS; only changed stale or ABA intent returns typed `409`.
4. Require the install result to match the complete public blueprint server
   specification. Discover exactly these ordered data-plane tools:
   `getObjectSchema`, `soqlQuery`, `find`, `getUserInfo`,
   `listRecentSobjectRecords`, and `getRelatedRecords`.
5. Exercise only the exact deterministic fixtures documented by the guide, then use
   management `get_request_log` and `assert_requests` to verify the ordered calls.
   Keep the management plane and the installed mock-MCP data plane distinct.
6. Delete the installed server at its current positive revision, delete the
   disposable environment, and close both MCP clients in `finally`.

Report D/I/S/X/Q only for the mounted official MCP SDK `1.29.0` Worker flow. The
Salesforce documentation review is provenance/design input, not verified-live
evidence. The preset performs no Salesforce network or REST calls and does not
implement or qualify OAuth, field-level security, sharing, or provider output-wire
parity. Actual-network, hosted, deployed, Cloud-pin, H, V, and P evidence remain
unqualified.

## Bounded mock-OpenAI recipe

For an OpenAI-shaped dependency, use the skill's bounded mock-OpenAI workflow and the
[canonical mock LLM guide](./mock-llm.md). MCP remains the only management interface:
the application calls the separate environment-hosted provider data plane with its
own synthetic Bearer Mock Credential.

1. Capability-negotiate
   `put_mock_llm_server`, `list_mock_llm_servers`, `get_mock_llm_server`, and
   `delete_mock_llm_server`, then create a disposable environment.
2. Call `put_mock_llm_server` with the explicit environment ID,
   `expectedRevision: null`, a complete OpenAI-enabled/Anthropic-disabled definition,
   at least one model, and a synthetic provider credential resolved from caller-owned
   secret storage.
3. Use the operator-reported path or subdomain base URL and the separate provider
   Bearer credential to probe `GET /models`. The four management tools do not prove
   that the connected deployment serves the provider route.
4. Point the official OpenAI JavaScript SDK at that base URL, set `maxRetries: 0`, and
   call model list/retrieve plus one JSON Chat Completion. The exact local source
   evidence pins `openai` 6.49.0.
5. Call Chat Completions again with `stream: true`. For a stable fixture, send
   `stream_options: { include_usage: true, include_obfuscation: false }`, consume it
   with `for await`, and require ordered role, payload, terminal, usage, and `[DONE]`
   semantics. Also exercise cancellation after a payload delta and do not require a
   fabricated terminal success.
6. In `strict` mode, prove wrong authentication, or send `stream_options` without
   `stream: true` and require `400 invalid_request_error`. `accept_any` accepts every
   syntactically valid provider Bearer Mock Credential without verifier comparison.
   These pre-plan failures are intentionally unobserved; query/assert the earlier
   successfully planned calls through the existing request-log MCP tools instead.
7. In `finally`, read the current definition, pass its latest positive revision to
   `delete_mock_llm_server`, reconcile a typed stale conflict rather than overwriting,
   delete the disposable environment, and close management MCP.

The source-qualified contract includes model list/retrieve and Chat Completions as JSON
or bounded SSE. `stream_options` accepts only optional Boolean `include_usage` and
`include_obfuscation`, and only with `stream: true`. Obfuscation defaults on and adds
fresh opaque compatibility padding to regular delta chunks; it is not evidence of
upstream size normalization or security parity. Initial delay is pre-header, only
payload deltas are paced, structural/terminal/optional-usage/`[DONE]` frames are
immediate, and one absolute maximum duration covers initial wait, pacing, and
backpressure. The complete precomputed SSE is capped at 2,097,152 UTF-8 bytes.
The schedule is valid only when
`initialDelayMilliseconds + Math.max(payloadFrameCount - 1, 0) * chunkDelayMilliseconds`
is strictly less than `maximumDurationMilliseconds`; equality is rejected. The
payload frame count comes from Unicode code-point chunks of text and canonical tool
arguments.
Preflight failure is generic JSON before HTTP `200`; cancellation or deadline after
HTTP `200` truncates without fabricated success. Current turn selection is stateless;
the selected plan is committed in the Environment Durable Object before edge return.
Successfully parsed/planned provider POSTs that pass response preflight attempt one
metadata-only request-log reservation within a 50-millisecond fail-open budget;
prospective metadata/credential collisions skip it. Use the existing
`get_request_log` and `assert_requests` MCP tools for exact LLM matchers; never expect
prompts, outputs, headers, credentials, tool inputs, frame/byte counts, `planId`, or
`requestHash` in the log. Configured midstream errors, the Responses API,
conversation state, actual-network qualification, Cloud pinning, and deployment
remain outside that evidence boundary. A passing local source workflow must never be
reported as deployed or verified-live OpenAI parity.

## Bounded mock-Anthropic recipe

For an Anthropic-shaped dependency, use the
[Anthropic SDK quickstart](./quickstarts/anthropic-sdk.md). MCP remains the sole
management interface; `/v1/messages` is the application-under-test data plane.

1. Capability-negotiate the same four mock-LLM tools and create a disposable
   environment.
2. Call `put_mock_llm_server` with the explicit environment ID,
   `expectedRevision: null`, an Anthropic-enabled definition, and a synthetic
   write-only Mock Credential from caller-owned storage.
3. Probe authenticated `GET /v1/models` with `x-api-key` and exactly
   `anthropic-version: 2023-06-01`.
4. Point official `@anthropic-ai/sdk` 0.115.0 at the provider base without a trailing
   `/v1`, set `maxRetries: 0`, and call model list/retrieve plus one JSON Message.
5. Call Messages again with `stream: true` and consume it with `for await`. Require
   named `message_start`, content-block, cumulative-usage `message_delta`, and
   `message_stop` ordering. Each content block may contain zero or more
   `content_block_delta` events. Text uses `text_delta`; canonical tool-input JSON
   uses `input_json_delta`. Require no `[DONE]` and no mock-emitted `ping`, while
   keeping the client tolerant of upstream `ping`. Cancel a separate stream after one
   payload delta and do not require fabricated `message_stop`.
6. In `strict` mode, prove `401 authentication_error` for a wrong key. `accept_any`
   accepts every syntactically valid `x-api-key` Mock Credential without verifier
   comparison. Alternatively, prove `400 invalid_request_error` for a version/beta
   header, unknown top-level field, or non-Boolean `stream`.
7. Read the latest revision and call `delete_mock_llm_server` in `finally`; reconcile
   `MOCK_LLM_SERVER_REVISION_CONFLICT` rather than deleting another agent's
   replacement.

Anthropic shares the 2,097,152-byte complete-SSE preflight, payload-only pacing,
strict schedule inequality, absolute initial/pacing/backpressure deadline, and
pre-header versus post-header failure boundary described for OpenAI. Configured
errors remain provider JSON before HTTP `200` even when `stream: true`; configured midstream errors
are unsupported. The selected plan is committed in the Environment
Durable Object before edge streaming. Current state is stateless, and cancellation
does not roll back that commit.

The source contract does not qualify Anthropic betas, broad parameters, configured
midstream errors, state, audit-grade observation delivery, deployment, or
live-provider parity.
