---
name: mockos-testing
description: >-
  Run mockOS integration workflows through authenticated management MCP: create
  disposable Entra or Okta environments, seed identities, register public or
  confidential OIDC clients, exercise PKCE, refresh/lifecycle, Entra public-device,
  Okta Classic factor-to-session OIDC, SCIM/directory/outbound provisioning, fault
  injection, request assertions, and pinned MSAL Node or Okta Auth JS qualification;
  configure revision-safe custom mock MCP and the built-in Salesforce SObject Reads
  preset; configure and test mock OpenAI Chat Completions or Anthropic Messages as
  JSON or SSE; then clean up and report D/I/S/X/Q/H/V/P. Use when wiring or testing
  enterprise identity, MCP-shaped, Salesforce-style MCP, OpenAI/Anthropic-shaped
  integrations, or provider failure handling. Do not use to claim unrecorded
  deployment or live-provider qualification, Anthropic betas, configured midstream
  errors, RFC 6238/TOTP behavior, MFA assurance, complete Okta Classic Authn, or broad
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
   Okta Classic `/api/v1/authn` primary states; the additive local slice adds one
   synthetic TOTP-shaped factor verification and direct one-use `sessionToken` OIDC
   authorization; injection-locked SCIM conflict, delete
   race, and narrow PATCH tolerances; signing-key rotation/JWKS overlap; claim-only
   clock skew; five broken-token variants; and Entra group claims inline through 200
   with same-environment Graph fallback at 201. Broad Graph/Okta parity, RFC 6238,
   password change, unlock/recovery, Sessions API/cookies, MFA-assurance claims, the
   remaining Classic transitions, Entra UserInfo/client credentials, and SAML remain
   unavailable; never invent routes for them.
4. When an official client matters, choose only a documented qualified path:
   `@azure/msal-node` 5.4.2 for the combined confidential-code/public-device Entra
   path or `@okta/okta-auth-js` 8.0.1 for the public Okta
   Classic-factor-to-code/PKCE path. Both records are local D/I/S/X/Q evidence with
   H/V/P no. Other versions and browser paths require a new qualification record.

## Route the workflow

Load only the direct references needed for the task, but read every selected reference
section completely before mutation:

- Read [MCP and LLM workflows](references/mcp-and-llm-workflows.md) for management
  MCP connection and environment setup, custom mock-MCP servers, the Salesforce
  blueprint, or mock OpenAI/Anthropic data planes.
- Read [identity protocol and official-client workflows](references/identity-protocol-and-client-workflows.md)
  for OAuth/device flows, pinned MSAL Node or Okta Auth JS qualification, Okta Classic
  Authn, refresh lifecycle, SCIM/directory APIs, or outbound provisioning.
- Read [fault injection and observability workflows](references/fault-injection-and-observability.md)
  for broken tokens, signing-key rotation, clock skew, group overage, deterministic
  scenarios, request logs, or ordered assertions.

For a cross-cutting test, load every applicable reference. Keep management MCP as the
control plane and provider, mock-MCP, and mock-LLM routes as separate data planes.

## Preserve compatibility-critical contracts

For custom mock MCP, capability-negotiate `put_mock_mcp_server`,
`reset_mock_mcp_state`, and `delete_mock_mcp_server`. Create with
`expectedRevision: null` and a complete definition; `configured: true` is a safe
marker, never replacement secret input, so resupply or rotate credentials on changed
writes. Preserve canonical replay, `cleared: 0`, `deleted: true`,
`MOCK_MCP_SERVER_NOT_FOUND`, and `MOCK_MCP_SERVER_REVISION_CONFLICT` semantics.
The named SDK path is not actual-network evidence.

For mock LLM, capability-negotiate `put_mock_llm_server` and
`delete_mock_llm_server` with `expectedRevision: null`. The bounded source pins
OpenAI SDK 6.49.0 and Anthropic SDK 0.115.0 with `maxRetries: 0`; probe `GET /models`
or `GET /v1/models`, including `anthropic-version: 2023-06-01`. Streaming uses
`stream: true`, `include_usage`, `include_obfuscation`, Anthropic
`message_start`/`message_stop`/`input_json_delta` with cumulative-usage, OpenAI
`[DONE]`, and no required Anthropic `ping`. Keep the schedule strictly less than
the deadline and the precomputed body within 2,097,152 bytes. The Environment Durable Object
commits selected state before streaming. The configured midstream errors remain
unsupported. Report source and deployment evidence separately.

## Stable recipe entry points

These anchors remain in the root skill for generated conformance links; follow each
link to its complete direct reference.

<a id="official-client-recipes"></a>

- [Qualify a pinned official client](references/identity-protocol-and-client-workflows.md#qualify-a-pinned-official-client)

<a id="m6-okta-authn-recipe"></a>

- [Exercise bounded Okta Classic primary authentication](references/identity-protocol-and-client-workflows.md#exercise-bounded-okta-classic-primary-authentication)

<a id="m6-broken-token-recipes"></a>

- [Mint focused token failures](references/fault-injection-and-observability.md#mint-focused-token-failures)

<a id="m6-signing-key-rotation-recipe"></a>

- [Rotate a signing key with overlap](references/fault-injection-and-observability.md#rotate-a-signing-key-with-overlap)

<a id="m6-token-clock-skew-recipe"></a>

- [Apply bounded token clock skew](references/fault-injection-and-observability.md#apply-bounded-token-clock-skew)

<a id="m6-group-overage-graph-fallback-recipe"></a>

- [Exercise group overage and Graph fallback](references/fault-injection-and-observability.md#exercise-group-overage-and-graph-fallback)

<a id="m6-scim-edge-recipes"></a>

- [Inject SCIM conflict, race, and tolerance edges](references/fault-injection-and-observability.md#m6-scim-edge-recipes)

## Clean up and report

In `finally`, clear every scenario created by the run, call `delete_environment` with
the explicit environment ID, and close the MCP client. Do not delete an environment
selected only through an inherited cursor, and do not rely on idle TTL as normal test
cleanup.

Report every case as passed, failed, or unavailable. Redact the management key,
Authorization headers, cookies, client secrets, full tokens, and synthetic passwords.
Structured secret-bearing request/response fields and redirect locations are redacted,
but non-secret fields and some non-JSON bodies can remain. For the MSAL and Auth JS
recipes, report only the exact named-field plus raw/URI/form-encoded representations
each harness checks; do not promote them to arbitrary-encoding classification. Quote
only the minimum safe evidence. Confirm that outbound target Bearer values remain redacted.
Report D/I/S/X/Q/H/V/P independently.

Use only the exact-revision records linked by the implementation ledger as deployed
evidence. Do not present an older workers.dev smoke as M5/M6 qualification, promote
the sampled M6 run to corpus-wide parity, or present any source or deployed result as
verified-live comparison against an Entra ID tenant or Okta organization.
