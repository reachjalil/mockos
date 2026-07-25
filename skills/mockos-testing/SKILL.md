---
name: mockos-testing
description: >-
  Run accepted mockOS identity-integration tests and bounded mock-OpenAI/Anthropic
  workflows through authenticated management MCP: create isolated Entra ID or Okta
  environments, seed identities, register public or confidential OIDC clients,
  configure MCP-managed mock LLM definitions, call model discovery, run OpenAI Chat
  Completions and Anthropic Messages as JSON or bounded SSE, exercise
  PKCE/refresh/lifecycle flows, exercise SCIM and bounded provider directory APIs, run
  outbound SCIM provisioning, mint broken tokens, rotate signing keys, apply clock
  skew, test group overage, inject deterministic scenarios, assert ordered
  request/response shapes, qualify pinned MSAL Node or Okta Auth JS paths, and clean
  up. Use when wiring or testing an application's enterprise identity or
  OpenAI/Anthropic-shaped integration, or reproducing provider-shaped failures; do
  not claim unrecorded deployment qualification, Anthropic betas, configured
  midstream errors, the complete Okta Classic Authn transaction machine, or broad
  provider parity.
---

# Test with mockOS

Use synthetic identities, passwords, client secrets, and tokens only. Read
`docs/IMPLEMENTATION_STATUS.md`, `docs/known-limitations.md`, and `docs/mcp.md` before
running a repository checkout. Treat a returned URL, fixture, contract, or provider
profile as metadata unless the status ledger names its runtime evidence.

Keep all eight evidence levels explicit in every report:

- designed (D): a reviewed target or contract exists;
- implemented (I): executable code exists;
- source-tested (S): named source tests pass; hosted CI remains S;
- integration-tested (X): a named composed-runtime or actual-network boundary passes;
- SDK/client-qualified (Q): a pinned official client passes the exact stated flow;
- hosted-smoke (H): an exact remote serving version passes a recorded mockOS smoke;
- verified-live (V): sanitized, reviewed evidence compares with a real provider; and
- production-ready (P): distribution, operations, security, rollback, support, and
  release gates for the claim are complete.

A local official-client run can establish X/Q without H. A connected server or
workers.dev run is not verified-live evidence. The immutable
[M6 workers.dev record](../../docs/evidence/m6-workers-dev-smoke.md) supplies sampled
deployed evidence for all six bounded slices on its exact versions; it does not qualify
an arbitrary server, every indexed case or fixture, or verified-live provider parity.

## Inventory the application

1. Record the application's issuer or authority, discovery behavior, callback URIs,
   client-authentication method, scopes, claim mapping, PKCE support, and token
   validation rules.
2. Choose `entra` or `okta`. Define one happy-path result and the exact application
   behavior expected for each negative case.
3. Separate implemented surfaces from gaps. The accepted M3/M5 source contains SCIM,
   bounded Entra Graph reads, tested Okta Users/Groups lifecycle APIs, refresh rotation,
   and deterministic outbound SCIM provisioning. The bounded M6 implementation adds
   Okta Classic `/api/v1/authn` primary states; injection-locked SCIM conflict, delete
   race, and narrow PATCH tolerances; signing-key rotation/JWKS overlap; claim-only
   clock skew; five broken-token variants; and Entra group claims inline through 200
   with same-environment Graph fallback at 201. Broad Graph/Okta parity, the remaining
   Classic transitions, Entra UserInfo/client credentials/device flow, and SAML remain
   unavailable; never invent routes for them.
4. When an official client matters, choose only a documented qualified path:
   `@azure/msal-node` 5.4.2 confidential Entra or `@okta/okta-auth-js` 8.0.1 public
   Okta. Both are local D/I/S/X/Q evidence with H/V/P no. Other versions and browser
   paths require a new qualification record.

## Connect to management MCP

Connect an MCP client to `<origin>/mcp` with the configured mockOS key in
`Authorization: Bearer <key>`. Never print, persist in the repository, or place the key
in a URL. Stop if the operator has not supplied a key: the server intentionally returns
503 when `API_KEY` is not configured and 401 for a missing or incorrect key.

Treat `GET /mcp` returning 405 as the expected POST-only Streamable HTTP fallback. Keep
the issued session ID on later requests and close the client when finished so it sends
the authenticated session-termination DELETE.

Call `tools/list` before creating anything. The current source registry contains 24
management MCP tools. The accepted identity workflow uses these 15:

`create_environment`, `list_environments`, `delete_environment`,
`configure_environment`, `seed_identities`, `create_application`,
`run_provisioning_cycle`, `mint_token`, `set_scenario`, `clear_scenario`,
`get_request_log`, `assert_requests`, `simulate_lifecycle`, `get_wellknown_urls`, and
`set_current_environment`.

The bounded mock-LLM workflows additionally require
`put_mock_llm_server`, `list_mock_llm_servers`, `get_mock_llm_server`, and
`delete_mock_llm_server`. Require only the tools needed by the planned workflow and
tolerate additional tools from a newer compatible server. Report a capability
mismatch before any mutation; in particular, do not attempt the lifecycle cascade
unless `simulate_lifecycle` is advertised, provisioning unless
`run_provisioning_cycle` is advertised, or mock-OpenAI configuration unless all four
definition tools are advertised. Capability discovery is evidence about the
connected server, not proof that the checkout under test is the source deployed
there.

## Create and wire an environment

Use a `try`/`finally` cleanup boundary and keep the returned environment ID:

1. Call `create_environment` with a descriptive name, the chosen provider, and a stable
   test seed. This also selects the environment in the current MCP session.
2. For an identity workflow, call `seed_identities` with explicit `users` and
   `groups`. Use the returned user ID in token tests; group members are seeded user
   names. A mock-LLM-only workflow does not need identities.
3. For an identity workflow, call `create_application` with the exact callback URI,
   grants, and client type required by the test. `confidential` is the default: retain
   its returned synthetic `clientSecret` in memory or a test secret store and expect
   it only on creation.
   For `public`, pass `clientType: "public"`, omit `clientSecret`, reject
   `client_credentials`, and require the response to omit the secret. Never fabricate
   an empty placeholder secret.
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

## Exercise the bounded mock-OpenAI flow

Read the [canonical mock LLM guide](../../docs/mock-llm.md), the
[OpenAI SDK quickstart](../../docs/quickstarts/openai-sdk.md), and the
[machine-readable provider manifest](../../docs/reference/mock-llm-openai.v1.json)
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

Read the [Anthropic SDK quickstart](../../docs/quickstarts/anthropic-sdk.md) and
[machine-readable manifest](../../docs/reference/mock-llm-anthropic.v1.json).

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

## Exercise the provider flow

For both providers, run authorization code with S256 PKCE first. Preserve `state`,
verify `nonce`, redeem the code once, fetch JWKS through discovery, and validate the
signature, issuer, audience, timestamps, subject, and provider-specific claims.

For Okta, use only the `/oauth2/default` custom-authorization-server surface. Exercise
the implemented flow as needed:

1. Start device authorization at the returned device endpoint.
2. Verify an early token poll returns `authorization_pending`.
3. Open the returned verification URL and activate with a seeded synthetic identity.
4. Poll after the advertised interval and validate the returned tokens.
5. For a confidential registration, introspect an access or refresh token with its
   synthetic secret.
6. Revoke it, then verify confidential introspection returns `{ "active": false }`.

Public Okta clients cannot introspect. They can revoke only their own access or refresh
tokens by identifying the public client without a secret; discovery advertises
revocation `none`. The pinned Auth JS client uses a client-ID-only Basic compatibility
shape that the adapter normalizes to public `none`. Do not treat that as anonymous or
cross-client revocation.

<a id="official-client-recipes"></a>

## Qualify a pinned official client

Prefer the repository commands when the application path matches an existing claim:

```sh
pnpm e2e:entra-msal
pnpm e2e:entra-msal-cleanup
pnpm e2e:okta-authjs
pnpm e2e:okta-authjs-cleanup
```

Both provider wrappers configure a shared parent that owns an actual local Wrangler
HTTPS process, validates its `localhost` certificate and ownership nonce, adds the
captured leaf to process-local Node trust, bounds time/output, and cleans up the
process group and temporary state. The wrappers use distinct provider and inspector
ports (`8794`/`18794` for Entra and `8795`/`18795` for Okta), so both flows can run
concurrently. Their cleanup wrappers configure one shared ready-Worker `SIGTERM`
verifier that requires both ports to be reusable. The parent and cleanup verifier
reject inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` and strip it from children. Added
trust is not exclusive certificate pinning.

For Entra, require the exact
[MSAL Node recipe](../../docs/quickstarts/entra-msal-node.md): host-only
`knownAuthorities`, `ProtocolMode.OIDC`, code + S256 PKCE, forced refresh, MCP disable,
and `invalid_grant`/`AADSTS50057`.

For Okta, require the exact
[Okta Auth JS recipe](../../docs/quickstarts/okta-auth-js-node.md):

1. create `clientType: "public"` with code/refresh grants and no secret;
2. use `getWithRedirect` with `state`, `nonce`, login hint, `offline_access`, and S256;
3. in the exact Node harness, supply the SDK-exposed `parseFromUrl._getLocation` seam
   plus the callback URL because the method otherwise dereferences `window`;
4. require `parseFromUrl` code exchange and JWKS-backed RS256 ID-token verification;
5. call `renewTokens` and require refresh rotation;
6. call public `token.revoke` and require HTTP 200; because that status is idempotent,
   require the following lifecycle result to revoke exactly one remaining access token
   rather than two;
7. apply Okta `suspend` through MCP, call `renewTokens` again, and require Auth JS
   `OAuthError`, `invalid_grant`, and `User account is disabled.`; and
8. assert the exact discovery, login GET/POST, code, JWKS, refresh, revoke, and failed
   refresh sequence. Parse the exercised password, callback code, exchange
   code/verifier, refresh, revoke-token, and successful token-response fields and
   require `[REDACTED]`. Also reject the raw, `encodeURIComponent`, and
   `URLSearchParams`-encoded representations of all exercised password, code, verifier,
   and initial/refreshed token values.

The `_getLocation` seam is an exact 8.0.1 Node-test boundary, not browser guidance or a
version-range promise. Auth JS verifies the ID token in this flow; do not promote that
to access-token signature validation, UserInfo, browser callback UX, Sign-In Widget,
IDX, Classic Authn, device flow, hosted, live-provider, or P evidence.

Do not claim the complete Okta Classic transaction machine, client-credentials
redemption, or live-provider parity. Use the bounded primary-authentication recipe
below and the provider-specific directory workflow for the organization API surface.

<a id="m6-okta-authn-recipe"></a>

## Exercise bounded Okta Classic primary authentication

Use only the returned `oktaAuthnEndpoint` and synthetic credentials. This endpoint is a
public mock sign-in boundary; do not attach the MCP Access Key or the directory `SSWS`
credential.

1. Seed separate active Users for `SUCCESS`, `MFA_REQUIRED`, and
   `PASSWORD_EXPIRED`. Set `mfaState: "required"` for MFA and
   `passwordState: "expired"` for expiry. To test `LOCKED_OUT`, seed an active User and
   apply Okta `suspend` through `simulate_lifecycle` before authenticating it.
2. Send a wrong password to the MFA, expired, and suspended Users before each positive
   case. Require the same HTTP 401 `E0000004` body returned for an unknown User; any
   state-specific response before password verification is a privacy failure.
3. Send the valid synthetic password. Require `MFA_REQUIRED` to win when both MFA and
   expiry are configured, `PASSWORD_EXPIRED` only without required MFA, and
   `LOCKED_OUT` only for the suspended User. The bounded lockout case models Okta's
   explicit show-lockout-failures policy. For MFA require the singular
   `_embedded.factor` key containing an array, not `_embedded.factors`. Embedded User
   profiles must omit `passwordChanged`.
4. Keep a returned `stateToken` in memory, post it to `oktaAuthnEndpoint` to retrieve
   the same current state, then post it to `<oktaAuthnEndpoint>/cancel`. Reusing it must
   return HTTP 401 `E0000011`. In a separate disposable state transaction, suspend the
   User and then unsuspend it; the pre-suspension token must still return `E0000011`
   after reactivation. Each successful state retrieval renews expiry to five minutes
   from that read; inactivity still expires the state. Never print or persist the token.
5. A valid active User without required MFA returns `SUCCESS` and a five-minute
   one-time `sessionToken`. Unlike state retrieval, its expiry remains fixed from
   issuance. The source has an atomic consume-once core seam, but no Sessions API
   exchange route; do not invent one or claim an application cookie.
6. Prove revocation in disposable transactions. Suspend/deprovision/delete a User, or
   change its password through SCIM, then require both pending state and session
   capabilities issued before the mutation to fail after reactivation. A lifecycle or
   password change racing after credential verification must not issue a capability.
7. For browser use, preflight only from the exact Authn origin. Require `POST`, only
   `accept` and/or `content-type`, no `Access-Control-Allow-Credentials`, and `403`
   without an allow-origin header for a different origin. Do not treat Authn as a
   cross-origin credential endpoint.
8. Query the inbound request log for the exact Authn path. Recursively nested
   password/passcode/secret/token/credential-like fields and sensitive headers such as
   Authorization, Proxy-Authorization, Cookie, and token-like headers must appear as
   `[REDACTED]`; malformed or primitive Authn bodies must be wholly replaced. Require a
   benign `passwordChanged` value to remain visible so over-redaction is detectable,
   but do not quote raw protocol bodies in the report.

The default source limits each Authn table to 10,000 retained rows and each User to 32
retained rows per capability kind. Issuance evicts oldest-expiring rows, prunes no more than 256
expired rows from each table per pass, and uses schema-v5-compatible operational
indexes. Treat an evicted capability exactly like any other invalid state/session token;
do not design a load test that assumes unlimited retention.

Factor verification, password change, unlock/recovery execution, warnings, enrollment,
and other Classic states are deliberately unavailable even when a response includes a
provider-shaped next-operation link.

## Rotate refresh tokens and test the lifecycle cascade

Run this after a successful authorization-code flow when the application under test
uses refresh tokens:

1. Register `refresh_token` in the application's grant types and request
   `offline_access`. Keep the returned access and refresh tokens in memory only.
2. Redeem the initial refresh token once. Confidential clients provide their synthetic
   secret; public clients identify the known client and omit a secret. If a narrower
   scope is supplied, require it to be a subset of the originally granted scope;
   otherwise omit `scope`. Assert that redemption succeeds, returns a different
   replacement refresh token, and does not widen scope.
3. Keep the replacement for the lifecycle check. Do not replay the consumed initial
   token in this environment: replay or concurrent double redemption revokes the whole
   refresh family and its associated access tokens. Test replay only in a disposable
   second environment or token family whose invalidation is the expected result.
4. Call `simulate_lifecycle` with the explicit environment and seeded User IDs. For an
   active Entra User use `disable`; for an active Okta User use `suspend` or
   `deprovision`. Assert the returned provider, action, previous/current state,
   `changed`, positive resource `version`, weak `etag`, and access/refresh counts in
   `revoked`. Choose subsequent transitions from the provider/state matrix rather than
   sending an action from the other provider.
5. Redeem the replacement refresh token again. Require HTTP 400 `invalid_grant` and
   the provider's disabled-account shape: Entra includes `error_codes: [50057]` and
   `AADSTS50057`; Okta returns `The resource owner account is disabled.` Reactivation
   does not restore already revoked credentials, so obtain a new authorization grant
   before any post-reactivation token test.
6. Use request logs and `assert_requests` to prove the token endpoint received the
   expected POST and, for the failure, a request body containing
   `grant_type=refresh_token`. Never print or quote the refresh-token value from the
   captured body.

The current source preserves the original authentication time and absolute family
expiry across rotation. Public refresh tokens remain bearer credentials without DPoP
or sender constraint. Treat those as focused source behaviors, not live-provider or
unrecorded deployed evidence.

## Exercise SCIM and provider directory surfaces

Use separate, synthetic protocol credentials for these requests. SCIM and Graph accept
a non-empty mock Bearer value; the Okta API accepts a non-empty mock SSWS value. These
checks validate the scheme/presence boundary only. Never send the MCP management Access
Key, a real tenant token, or one protocol's mock credential to another protocol.

For SCIM at the returned `scimBaseUrl`:

1. Read `ServiceProviderConfig`, `ResourceTypes`, and `Schemas` with
   `Accept: application/scim+json` and a synthetic Bearer credential.
2. Create a uniquely named synthetic User with
   `Content-Type: application/scim+json`, retain its returned ID, location, and weak
   ETag, then GET and filter it by `userName`.
3. PATCH that User with the SCIM PatchOp schema and `If-Match`. Assert the ETag advances
   after a real change, stays stable after an exact no-op, and a deliberately stale
   precondition returns 412. Add a disposable Group/direct membership case only when
   the application needs it; account for provider-specific response differences such
   as Entra Group PATCH returning 204.
4. Let the environment-level `finally` cleanup remove test data. Delete individual
   resources only when deletion semantics are themselves under test.

For Entra, use the returned `graphBaseUrl` and a synthetic Bearer credential to read
seeded Users, Groups, User `memberOf`, and Group `members`. Exercise only the supported
single-property string `eq` filters, `$select`, and bounded pagination. Graph writes,
nested/transitive membership, and broad Microsoft Graph semantics are unavailable.

For Okta, use the returned `oktaApiBaseUrl` and a synthetic SSWS credential to exercise
the tested Users/Groups CRUD, direct membership, filter/paging, and lifecycle routes.
Use a separate directory-only User for mutating lifecycle tests so it cannot invalidate
the refresh-family case. Prefer MCP `simulate_lifecycle` for the token-bearing User
because its result reports the coordinated revocation counts. Keep this SSWS-protected
management workflow separate from the public `oktaAuthnEndpoint`, and do not infer
other Okta organization APIs.

## Run the outbound provisioning loop

Use a disposable SCIM receiver at a policy-accepted URL. Prefer the repository's
`examples/target-app` harness for source qualification. A literal loopback/private URL
is rejected even when self-host HTTP is enabled; use the e2e harness or an operator-
controlled HTTPS test origin instead of weakening SSRF validation.

When qualifying a repository checkout, run `pnpm e2e:provisioning` first. It boots the
mockOS and Durable Object-backed target app as separate `wrangler dev` processes and
drives the authenticated MCP/CLI/Workflow/service-binding/assertion loop. A passing
unit or Miniflare test is not a substitute for this process-level gate.

1. Keep the application registration's returned `id`; provisioning uses that ID, not
   its OAuth `clientId`.
2. Reset the disposable target and retain its synthetic SCIM Bearer value without
   printing it. Never use a platform `mk_` Access Key or the exact active non-prefixed
   self-host `API_KEY` as the target credential. The CLI and runtime reject that exact
   reuse, and a later key-rotation collision with a saved target fails before outbound
   execution.
3. Call `run_provisioning_cycle` with the explicit environment ID, application ID,
   `full` mode, and an inline target `{ref, baseUrl, auth}`. Set `save: false` unless a
   later cycle deliberately tests saved-target reuse. The raw credential must not
   appear in the returned run or any Workflow parameter/log evidence.
4. Require a queued run with the same environment, application, provider, mode, and
   target reference. This acknowledges Workflow creation only; it is not terminal
   success.
5. Poll `get_request_log` with `source: "outbound"` and a bounded deadline. A full
   cycle must perform all User operations before Group operations. Let unrelated log
   entries exist between expected steps.
6. Call `assert_requests` with an ordered sequence that proves at least User lookup,
   User create/update, Group lookup, and Group create/update. Match the synthetic user
   name and Group display name with `bodyIncludes`, and target result fields with
   `responseBodyIncludes`. Require exactly one complete sequence for a reset target.
7. Inspect the target's protected request and state snapshots. Require its captured
   Authorization value to be redacted, the User to exist before Group membership is
   materialized, and the final member reference to use the target User ID.
8. Run `incremental` against the saved target only when the first run used `save:
   true`; otherwise resend a fresh inline target. Assert unchanged source versions do
   not produce duplicate writes. Mutate one source resource, rerun, and require only
   its provider-shaped update plus any dependent Group reconciliation.

For a deployed acceptance run, inspect the platform Workflow instance as well as the
request log. Platform status `complete` is necessary but not sufficient because the
Workflow can return a failed or partial application run. Require its output to contain
the exact retained run ID with `status: "succeeded"`, and reject rollback-failure
metadata if present.

Treat HTTP responses, including 4xx, 429, and 5xx, as recorded outcomes. A 429 may
produce an explicit bounded wait and retry; it is not an invisible infrastructure
retry. Report a partial or failed sequence as a failed test. Do not retry a whole run
with changed inputs after an ambiguous client timeout. If the server returns its stable
Workflow-reconciliation failure, retry the exact same environment, application, mode,
target reference, target metadata, and synthetic credential. The server revalidates
the frozen target in constant time and resumes or returns the existing fixed Workflow
run; a mismatched retry remains a conflict and must not reveal stored metadata or
credentials.

This recovery rule applies only while the exact run remains queued or running. If the
original run can already be terminal, do not submit another whole-cycle call: M5 has
no caller idempotency key or terminal replay record, so that call is a new run and may
write and consume hosted quota again. Resolve the outcome from the retained run ID,
outbound request log, and disposable target state. Terminal request replay is deferred
to F4.

If a same-input retry returns a terminal failed run, treat it as reconciliation of a
platform Workflow failure and do not expect its hosted quota unit to be released.
M5 performs this cleanup on retry rather than through a background orphan sweep; keep
the retry bounded and preserve the returned failure evidence.

<a id="m6-broken-token-recipes"></a>

## Mint focused token failures

Call `mint_token` with the application `clientId` and a seeded user ID or user name in
`subject`. Supply `audience` only when the test requires an explicit audience. Run the
valid token first, then choose exactly one supported `broken` variant per negative case:

- `expired`
- `wrong_audience`
- `not_yet_valid`
- `bad_signature`
- `wrong_issuer`

Assert the application's validation outcome. Do not treat `mint_token` as evidence that
the same token can be obtained from a provider HTTP grant.

<a id="m6-signing-key-rotation-recipe"></a>

## Rotate a signing key with overlap

Use a disposable Entra environment and keep all JWTs in memory. Read JWKS before the
flow and require one active key plus its pre-published successor. Complete authorization
through code issuance, then set a one-shot scenario at `token.before_sign` with
`action: { "type": "rotate_signing_key" }` before redeeming the code. Require redemption
to succeed, read JWKS again, and verify the returned token by `kid`. The former active
key, promoted active key, and new successor must all be published during the overlap.
Do not treat a fresh execution of this recipe as deployed rollover evidence unless it
is tied to an exact serving version and recorded acceptance. The immutable M6 smoke
record is the deployed reference for its sampled rotation path.

<a id="m6-token-clock-skew-recipe"></a>

## Apply bounded token clock skew

Set a one-shot `token.before_sign` scenario with
`action: { "type": "token_clock_skew", "seconds": <integer> }`; the integer must remain
within plus or minus 86,400 seconds. Mint one token and assert only its temporal claims
move by the selected offset. The environment clock and stored authorization, device,
and refresh-grant timestamps must remain unchanged. Clear the scenario before testing a
different offset, and validate the token with the application's intended clock tolerance.

<a id="m6-group-overage-graph-fallback-recipe"></a>

## Exercise group overage and Graph fallback

Create an Entra application with group claims enabled and one User in exactly 200
Groups. Mint an in-memory token and require all 200 IDs inline with no claim-source
metadata. Add membership in Group 201 and mint again: `groups` must be absent, while
`_claim_names.groups` selects a same-environment `_claim_sources` endpoint ending in
`/graph/v1.0/users/<id>/getMemberObjects`. POST the strict body
`{ "securityEnabledOnly": true }` to that returned endpoint with the synthetic bearer
and require the 201 Group IDs. Never follow a caller-supplied fallback URL.

## Inject deterministic scenarios

Call `set_scenario` with a stable scenario ID and one implemented injection point:

- `oidc.discovery`
- `oidc.jwks`
- `oauth.authorize`
- `oauth.token`
- `oauth.device`
- `oauth.device.activate`
- `oauth.introspect`
- `oauth.revoke`
- `scim.request`
- `scim.patch_parse` (reserved for its typed PATCH-tolerance action)
- `scim.before_commit` (reserved for typed SCIM conflict/race actions)
- `graph.request`
- `okta.api`
- `http.request`
- `*` as a lower-priority catch-all

Choose one action: `delay` (1–30,000 milliseconds), `error` with a supported semantic
error code, or `mutate` with a shallow JSON patch. Use mutation only at
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, or `oauth.introspect`;
other mutation points fail closed. Use only delay or error actions at `scim.request`,
`graph.request`, and `okta.api`; the Worker renders their protocol-shaped errors. Set
`probability` and, for a bounded case, `remaining`. Preserve the environment seed,
scenario ID, parameters, and evaluation order in the report so the sequence is
reproducible.

Clear one scenario before enabling the next unless interaction between scenarios is
the test subject. Prefer `remaining: 1` for a one-shot failure.

<a id="m6-scim-edge-recipes"></a>

For the M6 SCIM slice, use only these injection-locked recipes:

1. To prove conflict handling, set `injectionPoint: "scim.before_commit"`,
   `action: { "type": "scim_conflict" }`, and `remaining: 1`. Send one create,
   replace, PATCH, or delete request. Require `409` with `scimType: "uniqueness"`,
   then read the resource and prove that requested fields, lifecycle, membership, and
   ETag did not partially change. A deliberate replay occurs after the one-shot action
   is consumed and should follow the normal current-state rules.
2. To reproduce a delete race, create an isolated disposable User or Group first, then
   set `injectionPoint: "scim.before_commit"`,
   `action: { "type": "scim_soft_delete_race" }`, and `remaining: 1`. The losing
   write returns `404`; require the resource to be hidden and only the tombstone-side
   effects to exist. For a User, verify direct memberships were removed and affected
   Group ETags advanced. Concurrent or later replay writes must also return `404`.
   Do not use this action on create: that combination fails with `409` and inserts
   nothing.
3. Keep malformed PATCH strict unless the application explicitly needs a compatibility
   case. At `scim.patch_parse`, select
   `{ "type": "scim_patch_tolerance", "malformedCase": "missing_schemas" }` to
   add only the missing PatchOp schema field, or use `"singleton_operations"` to wrap
   exactly one operation object in an array. Set `remaining: 1`, test the same payload
   without the scenario first and require `400`, then enable the selected case. Do not
   expect one selection to repair the other case, combined defects, unknown fields,
   invalid paths, missing values, or type coercions.

Generic delay/error/mutate actions are invalid at the two reserved internal SCIM
points. The three typed actions are invalid at `scim.request`, `*`, and all non-SCIM
points. Reserved internal evaluation does not execute or consume a `*` catch-all. Treat
schema rejection as a failed test setup rather than weakening the point or switching
to a generic action.

## Diagnose and assert requests

Use `get_request_log` to inspect newest-first inbound or outbound protocol entries. Filter only by
supported fields: source, provider, normalized method, exact path, exact status, limit,
and cursor.

Use `assert_requests` for stable machine assertions. Supply:

- `source` for an exact source match;
- `method`, normalized to uppercase and then matched exactly;
- `path` for the exact public request path;
- `status` for the exact response status;
- `bodyIncludes` or `responseBodyIncludes` for case-sensitive literal substrings of
  the respective stored body;
- `sequence` with two to 100 non-empty step matchers when append order matters; top-
  level matchers apply to every step and unrelated requests may appear between them;
  and
- `count.atLeast`, `count.atMost`, or `count.exactly`.

Ordered matching greedily counts complete, non-overlapping subsequences from oldest to
newest and returns IDs from complete matches only. Do not ask `assert_requests` to
match headers, parsed JSON/JSONPath, regular expressions, or partial-field semantics.
Check the returned `pass`, `matched`, `message`, and request IDs. Treat a failed
assertion as a failed test, not merely a diagnostic note.

## Clean up and report

In `finally`, clear every scenario created by the run, call `delete_environment` with
the explicit environment ID, and close the MCP client. Do not delete an environment
selected only through an inherited cursor, and do not rely on idle TTL as normal test
cleanup.

Report every case as passed, failed, or unavailable. Redact the management key,
Authorization headers, cookies, client secrets, full tokens, and synthetic passwords.
Structured secret-bearing request/response fields and redirect locations are redacted,
but non-secret fields and some non-JSON bodies can remain. For the Auth JS recipe,
report only the exact named-field plus raw/URI/form-encoded representations the harness
checks; do not promote them to arbitrary-encoding classification. Quote only the
minimum safe evidence. Confirm that outbound target Bearer values remain redacted.
Report D/I/S/X/Q/H/V/P independently.

Use only the exact-revision records linked by the implementation ledger as deployed
evidence. Do not present an older workers.dev smoke as M5/M6 qualification, promote
the sampled M6 run to corpus-wide parity, or present any source or deployed result as
verified-live comparison against an Entra ID tenant or Okta organization.
