# mockOS testing skill

Status: Accepted identity workflow plus bounded F1 mock-MCP and F2 mock-OpenAI/Anthropic guidance
Last reviewed: 2026-07-25

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to capability-negotiate management MCP, create an isolated
environment, and test an application against the currently qualified identity,
environment-hosted mock-MCP, or bounded mock-OpenAI/Anthropic surface.

The workflow covers the accepted M5 slice plus bounded M6 recipes:

- authorization code with required S256 PKCE for Entra ID or Okta;
- rotating refresh grants with scope narrowing, replay cautions, and provider-correct
  lifecycle revocation failures;
- Okta device authorization, activation, introspection, and revocation within the
  implemented authorization-server boundary;
- SCIM discovery and versioned synthetic User/Group CRUD/PATCH with weak ETags;
- bounded Entra Graph reads and Okta Users/Groups/lifecycle API checks using separate
  test-only credential schemes;
- bounded Okta Classic primary authentication with password-before-state privacy,
  deterministic initial states, sliding state versus fixed session expiry,
  transaction cancellation/replay checks, lifecycle/password revocation, bounded
  retention, restricted same-origin non-credentialed CORS, provider-shaped response
  omissions, and recursive Authn body/header redaction;
- capability discovery against the 24-tool current management registry, preserving
  `simulate_lifecycle` and `run_provisioning_cycle` and recognizing the five F1
  mock-MCP definition/state operations plus four F2 mock-LLM definition operations;
- MCP-managed OpenAI definitions, an authenticated model-discovery capability probe,
  official-SDK JSON and bounded SSE Chat Completions, stream-option and cancellation
  checks, one bounded negative case, and revision-safe cleanup without confusing
  provider traffic for management;
- MCP-managed Anthropic definitions, authenticated `GET /v1/models`, official
  `@anthropic-ai/sdk` 0.115.0 non-streaming Messages with `maxRetries: 0`, exact
  `anthropic-version: 2023-06-01`, one auth/version/stream negative, and the same
  revision-safe cleanup;
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
local source is deployed. Its evidence vocabulary is strict: source means exact-
revision local/hosted-CI execution; deployed additionally requires an exact mockOS
deployment/version and recorded acceptance; verified-live is reserved for sanitized,
reviewed evidence from a real provider. A provisioning call returns a queued run; the
skill polls bounded outbound evidence and checks target state before reporting success.
It never places target credentials in command arguments, never reuses a platform `mk_`
Access Key or the exact active non-prefixed self-host Access Key as a mock SCIM
credential, and requires target Bearer redaction in captured evidence. A key-rotation
collision with a saved target must fail before outbound execution.

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

The rest of the Okta Classic Authn transaction machine, broad Graph/Okta API parity,
SAML, unrecorded deployment qualification, and npm publication remain outside the
workflow. Use only immutable CI/deployment records linked by the implementation
ledger, and never present mockOS source or deployment evidence as verified-live
provider parity.

The checked skill remains primarily an identity-integration workflow. For an agent
under test, route directly to [Environment-hosted mock MCP](./mock-mcp.md), which owns
the management/data-plane distinction, server-definition contract, wire sequence,
state and revision semantics, observation matchers, and F1 limitations. The existence
of those source tools does not imply that the F1 route is deployed on an arbitrary
connected server; capability-negotiate management MCP and retain the endpoint/evidence
boundary returned by the operator.

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
   Do not expect an LLM observation because no LLM-specific request-log/assertion
   surface exists.
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
Configured midstream errors, the Responses API, conversation state, LLM
observations/assertions, Cloud pinning, and deployment remain outside that evidence
boundary. A passing local source workflow must never be reported as deployed or
verified-live OpenAI parity.

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
   `/v1`, set `maxRetries: 0`, and call model list/retrieve plus one non-streaming
   Message.
5. In `strict` mode, prove `401 authentication_error` for a wrong key. `accept_any`
   accepts every syntactically valid `x-api-key` Mock Credential without verifier
   comparison. Alternatively, prove `400 invalid_request_error` for a version/beta
   header or `stream: true`. Streaming is unsupported on this Anthropic route.
6. Read the latest revision and call `delete_mock_llm_server` in `finally`; reconcile
   `MOCK_LLM_SERVER_REVISION_CONFLICT` rather than deleting another agent's
   replacement.

The source contract does not qualify Anthropic betas, broad parameters, streaming,
state, observations, deployment, or live-provider parity.
