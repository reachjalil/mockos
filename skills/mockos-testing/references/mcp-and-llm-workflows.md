# MCP and LLM workflows

## Contents

- [Connect to management MCP](#connect-to-management-mcp)
- [Create and wire an environment](#create-and-wire-an-environment)
- [Exercise an environment mock-MCP server](#exercise-the-bounded-environment-mock-mcp-flow)
- [Install the Salesforce SObject Reads preset](#exercise-the-built-in-salesforce-sobject-reads-preset)
- [Exercise mock OpenAI](#exercise-the-bounded-mock-openai-flow)
- [Exercise mock Anthropic](#exercise-the-bounded-mock-anthropic-flow)

Read the sections required by the selected management or data-plane workflow.

## Connect to management MCP

Connect an MCP client to `<origin>/mcp` with the configured mockOS key in
`Authorization: Bearer <key>`. Never print, persist in the repository, or place the key
in a URL. Stop if the operator has not supplied a key: the server intentionally returns
503 when `API_KEY` is not configured and 401 for a missing or incorrect key.

Treat `GET /mcp` returning 405 as the expected POST-only Streamable HTTP fallback. Keep
the issued session ID on later requests and close the client when finished so it sends
the authenticated session-termination DELETE.

Call `tools/list` before creating anything. The current source registry contains 27
management MCP tools. The accepted identity workflow uses these 15:

`create_environment`, `list_environments`, `delete_environment`,
`configure_environment`, `seed_identities`, `create_application`,
`run_provisioning_cycle`, `mint_token`, `set_scenario`, `clear_scenario`,
`get_request_log`, `assert_requests`, `simulate_lifecycle`, `get_wellknown_urls`, and
`set_current_environment`.

The bounded mock-LLM workflows additionally require
`put_mock_llm_server`, `list_mock_llm_servers`, `get_mock_llm_server`, and
`delete_mock_llm_server`. A bounded mock-MCP workflow instead requires
`put_mock_mcp_server`, `list_mock_mcp_servers`, `get_mock_mcp_server`,
`reset_mock_mcp_state`, and `delete_mock_mcp_server`. A built-in preset workflow also
requires `list_mock_mcp_blueprints`, `get_mock_mcp_blueprint`, and
`install_mock_mcp_blueprint`; those three complete F1's eight MCP-only management
operations. Require only the tools needed by the planned workflow and
tolerate additional tools from a newer compatible server. Report a capability
mismatch before any mutation; in particular, do not attempt the lifecycle cascade
unless `simulate_lifecycle` is advertised, provisioning unless
`run_provisioning_cycle` is advertised, custom mock-MCP configuration unless all five
definition/state tools expose their required revision schemas, blueprint installation
unless all three catalog/install tools expose their exact catalog and CAS schemas, or mock-OpenAI
configuration unless all four definition tools are advertised. Capability discovery
is evidence about the
connected server, not proof that the checkout under test is the source deployed
there.

## Create and wire an environment

Use a `try`/`finally` cleanup boundary and keep the returned environment ID:

1. Call `create_environment` with a descriptive name, the chosen provider, and a stable
   test seed. This also selects the environment in the current MCP session.
2. For an identity workflow, call `seed_identities` with explicit `users` and
   `groups`. Use the returned user ID in token tests; group members are seeded user
   names. A mock-MCP-only or mock-LLM-only workflow does not need identities.
3. For an identity workflow, call `create_application` with the exact callback URI,
   grants, and client type required by the test. `confidential` is the default: retain
   its returned synthetic `clientSecret` in memory or a test secret store and expect
   it only on creation.
   For `public`, pass `clientType: "public"`, omit `clientSecret`, reject
   `client_credentials`, and require the response to omit the secret. Never fabricate
   an empty placeholder secret. For a device-only Entra application, pass
   `redirectUris: []` and do not invent a callback URI. If the registration includes
   `authorization_code`, including a mixed code/device application, require at least
   one real, exact callback URI used by that flow.
   For SDK 1.29 discovery, require the strict tools-list input to keep defaulted fields
   optional and expose a Draft-7 `if`/`then` public branch that forbids `clientSecret`
   and narrows grants. Require exact public/confidential output branches, with no
   secret property in the public branch. A missing conditional is a capability
   mismatch even if runtime validation would later reject the input.
4. For an identity workflow, call `get_wellknown_urls` with the explicit environment
   ID. Configure the application from its returned issuer/endpoints and record
   `scimBaseUrl` plus `graphBaseUrl` for Entra or `oktaApiBaseUrl` plus
   `oktaAuthnEndpoint` for Okta. Never construct or persist an issuer or Authn endpoint
   from memory.
5. Verify discovery before login and require every absolute URL to use the active host.
   Treat a missing provider-specific directory URL as a capability mismatch.

Pass `environmentId` explicitly in saved automation. Use `set_current_environment`
only for interactive session convenience because its cursor is transport-session-local.

## Exercise the bounded environment mock-MCP flow

Read the [canonical mock MCP guide](../../../docs/mock-mcp.md) before configuring a
server. Management MCP is the control plane; the application or agent under test
connects to the separate environment mock MCP data plane.

1. Capability-negotiate all five F1 server-definition/state tools. Require
   `put_mock_mcp_server` to advertise
   mandatory `expectedRevision` accepting `null` or a positive integer, and require
   `reset_mock_mcp_state` and `delete_mock_mcp_server` to advertise a mandatory
   positive integer. Stop on an older or incompatible schema.
2. Resolve any synthetic Bearer Mock Credential from caller-owned secret storage.
   Keep it distinct from the platform management Access Key and never print, commit,
   or place it in a prompt.
3. Call `put_mock_mcp_server` with the explicit environment ID,
   `expectedRevision: null`, and a complete definition. Retain the returned positive
   revision. A safe Bearer view contains `configured: true` but no token or verifier;
   never copy that marker into a later write.
4. Connect the application or official MCP client to the operator-reported
   `/e/<environmentId>/mcp-mock/<slug>` or subdomain endpoint with the server's
   separate synthetic credential. Discover and exercise only the configured
   capabilities. The five management tools prove configuration support, not that an
   arbitrary connected deployment serves the data plane.
5. When deterministic sequence state must restart, call `reset_mock_mcp_state` with
   the positive current revision. Require the definition, revision, and sessions to
   remain; an exact retry succeeds with `cleared: 0`.
6. For a changed replacement, call `get_mock_mcp_server`, reconcile the current safe
   definition with the intended complete definition, and pass its positive revision
   to `put_mock_mcp_server`. Resupply or rotate the raw Bearer value from caller-owned
   storage. The raw value is allowed only at `authentication.token`; its exact value
   must be rejected from every other definition key or string value, and a dependency
   result that reflects it must fail closed. Do not increment the revision locally or
   treat the operation as a patch.
7. A canonical replay of an identical put succeeds before CAS, preserving revision,
   timestamps, state, and sessions even when its expectation is stale or still
   `null`. This includes convergence to an identical later delete/recreate
   generation. Only a changed stale or ABA put/reset/delete must return
   `MOCK_MCP_SERVER_REVISION_CONFLICT`; read and reconcile instead of overwriting.
8. In `finally`, read the latest generation and call `delete_mock_mcp_server` with
   that positive revision. Require literal `deleted: true`. A retry after successful
   delete returns `MOCK_MCP_SERVER_NOT_FOUND`, not replayed success. Then delete the
   disposable environment and close management MCP.

The current bounded evidence uses mounted `@modelcontextprotocol/sdk` `1.29.0` Worker
discovery and runtime calls. Report D/I/S/X/Q yes only for that named local path. It
is not actual-network evidence and establishes no H, P, hosted, Cloud-pin, deployment,
or broad ecosystem claim; V is not applicable to this generic synthetic-engine flow.

## Exercise the built-in Salesforce SObject Reads preset

Read the
[preset guide](../../../docs/blueprints/salesforce-sobject-reads.md) and generated
[machine catalog](../../../docs/reference/mock-mcp-blueprints.v1.json). This is a
built-in, secret-free server-definition preset, not the portable F5
export/import/apply/gallery system.

1. Capability-negotiate `list_mock_mcp_blueprints`,
   `get_mock_mcp_blueprint`, and `install_mock_mcp_blueprint` plus the five
   server-definition/state tools.
2. List and get `salesforce/hosted-mcp/sobject-reads`. Require documentation-derived
   provenance reviewed on 2026-07-25, `providerNetwork: false`,
   `outputWireParity: "unqualified"`, and authentication mode `none`.
3. Create a disposable environment and install with `expectedRevision: null`. A
   changed replacement requires the current positive revision and is destructive:
   it deletes application state and terminates revision-bound sessions. Canonically
   identical replay, including identical delete/recreate convergence, resolves before
   CAS; only changed stale or ABA intent returns typed `409`. Require the result to
   match the complete public blueprint server specification.
4. On the separate mock-MCP data plane, discover exactly these ordered tools:
   `getObjectSchema`, `soqlQuery`, `find`, `getUserInfo`,
   `listRecentSobjectRecords`, and `getRelatedRecords`. Exercise only the exact
   deterministic fixtures in the guide, then use management `get_request_log` and
   `assert_requests` to verify the calls.
5. Delete the current installed revision, delete the disposable environment, and
   close both MCP clients in `finally`.

Report D/I/S/X/Q only for the mounted official MCP SDK `1.29.0` Worker flow. The
Salesforce documentation review is provenance/design input, not V evidence. The
preset contacts no Salesforce network and does not implement or qualify REST, OAuth,
field-level security, sharing, or provider output-wire parity. Actual-network,
hosted, deployed, Cloud-pin, H, V, and P evidence remain unqualified.

## Exercise the bounded mock-OpenAI flow

Read the [canonical mock LLM guide](../../../docs/mock-llm.md), the
[OpenAI SDK quickstart](../../../docs/quickstarts/openai-sdk.md), and the
[machine-readable provider manifest](../../../docs/reference/mock-llm-openai.v1.json)
before configuring a server. The manifest owns the exact route, request limits, and
evidence state.

1. Resolve a synthetic provider Mock Credential from caller-owned secret storage. It
   must be distinct from the platform management Access Key and must never be printed,
   committed, or included in a prompt.
2. Call `put_mock_llm_server` with the explicit environment ID,
   `expectedRevision: null`, and the complete definition shape from the canonical
   guide. Enable OpenAI, disable Anthropic, and define at least one model. For `strict`,
   send the raw provider Mock Credential; for `accept_any`, omit a verifier but still
   require a syntactically valid provider Bearer credential on every request.
3. Require a positive revision and a secret-safe strict view containing
   `configured: true` but neither plaintext nor `apiKeySha256`. Never echo
   `configured: true` into a later put. A changed replacement is a complete write and
   must resupply or rotate every enabled strict credential from caller-owned storage.
4. Build the exact provider base URL reported by the operator:
   `<origin>/e/<environmentId>/llm-mock/<slug>/openai/v1` in path mode or
   `https://<environmentId>.<baseDomain>/llm-mock/<slug>/openai/v1` in subdomain
   mode. Do not send the management Access Key to this URL.
5. Probe authenticated `GET /models`. The four MCP tools prove configuration support,
   not that the connected deployment serves the provider route. Stop and report the
   evidence boundary if the probe fails.
6. Point the official OpenAI JavaScript SDK at that base URL, set `maxRetries: 0`, and
   exercise model list/retrieve plus one JSON `chat.completions.create` call. The
   locally qualified source pins `openai` 6.49.0; another version needs its own
   evidence. Multimodal content, the Responses API, and unknown top-level keys remain
   outside the bounded request surface.
7. Exercise `chat.completions.create` with `stream: true`. For stable assertions, send
   `stream_options: { include_usage: true, include_obfuscation: false }`, consume the
   result with `for await`, and require ordered role, payload, terminal, usage, and
   `[DONE]` semantics. Run a separate cancellation case after receiving a payload
   delta and do not require a fabricated terminal success.
8. Prove one bounded negative case: missing model, a wrong credential in `strict`
   mode, or `stream_options` without `stream: true`, which must return
   `400 invalid_request_error`. Do not expect an LLM request log or assertion result;
   this slice has no LLM-specific observation surface.
9. In `finally`, read the latest safe definition, delete it with that positive
   `expectedRevision`, then delete the disposable environment and close management
   MCP. A stale revision must be reconciled, not overwritten blindly.

The provider is stateless: prior `assistant` messages select the deterministic turn,
and the selected plan is committed in the Environment Durable Object before edge
return. `stream_options` is valid only with `stream: true` and accepts only optional
Boolean `include_usage` and `include_obfuscation`. Obfuscation defaults on and places
fresh opaque compatibility padding on regular delta chunks; it does not prove upstream
size normalization or security parity. Initial delay is abort-aware and pre-header.
Only payload deltas are paced; role, terminal, optional usage, and `[DONE]` frames are
immediate. One absolute maximum duration includes initial wait, pacing, and
backpressure, while the complete precomputed SSE body is capped at 2,097,152 UTF-8
bytes. Preflight failure returns generic JSON before HTTP `200`; cancellation or
deadline after HTTP `200` truncates without fabricated success. Do not claim
configured midstream errors, the Responses API, conversation state, LLM
observation/assertion, Wrangler/network qualification, Cloud pinning, deployment, or
live OpenAI parity.

Reject a definition/plan whose schedule does not satisfy
`initialDelayMilliseconds + Math.max(payloadFrameCount - 1, 0) * chunkDelayMilliseconds`
strictly less than `maximumDurationMilliseconds`; equality is invalid. Derive the
payload frame count from Unicode code-point chunks of text and canonical tool
arguments at `chunkSize`.

## Exercise the bounded mock-Anthropic flow

Read the [Anthropic SDK quickstart](../../../docs/quickstarts/anthropic-sdk.md) and
[machine-readable manifest](../../../docs/reference/mock-llm-anthropic.v1.json).

1. Capability-negotiate the same four MCP-only definition tools and call
   `put_mock_llm_server` with `expectedRevision: null`, an explicit environment ID,
   an Anthropic-enabled definition, and a synthetic write-only provider credential.
2. Require only `configured: true` in the safe strict view. Build
   `<origin>/e/<environmentId>/llm-mock/<slug>/anthropic`; do not append `/v1` to the
   SDK base.
3. Probe `GET /v1/models` using `x-api-key` and exactly
   `anthropic-version: 2023-06-01`. The MCP tools alone do not prove route support.
4. Use official `@anthropic-ai/sdk` 0.115.0 with `maxRetries: 0` for model
   list/retrieve and one JSON Message.
5. Call Messages again with `stream: true`, consume it with `for await`, and require
   named `message_start`, content-block, cumulative-usage `message_delta`, and
   `message_stop` ordering. A content block has zero or more payload deltas; text uses
   `text_delta` and canonical tool input uses `input_json_delta`. Require no `[DONE]`
   or mock-emitted `ping`, but tolerate upstream `ping`. Cancel a separate stream
   after a payload delta and do not require fabricated `message_stop`.
6. In `strict` mode, prove wrong-key `401 authentication_error`. `accept_any` accepts
   every syntactically valid `x-api-key` Mock Credential without verifier comparison.
   Alternatively, prove a version/beta, unknown-field, or non-Boolean-stream
   `400 invalid_request_error`. Beta APIs, broad parameters, and LLM observations are
   unsupported.
7. In `finally`, get the latest revision, call `delete_mock_llm_server`, reconcile
   `MOCK_LLM_SERVER_REVISION_CONFLICT`, delete the disposable environment, and close
   management MCP.

Anthropic uses the shared complete-body 2,097,152-byte preflight, strict schedule
inequality, payload-only pacing, and absolute initial/pacing/backpressure deadline.
Pre-header failure is generic JSON; post-header cancellation/deadline truncates
without success. Configured errors remain provider JSON before HTTP `200` even when
streaming is requested, and configured midstream errors are unsupported. The current
stateless selected plan is committed in the Environment Durable Object before edge
return; post-header cancellation does not roll that commit back.
