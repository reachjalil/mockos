---
name: mockos-testing
description: >-
  Run locally qualified M5 source-candidate mockOS identity-integration tests through authenticated MCP:
  create isolated Entra ID or Okta environments, seed identities, register OIDC
  clients, run PKCE/refresh/lifecycle flows, exercise SCIM and bounded provider
  directory APIs, run outbound SCIM provisioning, mint broken tokens, inject
  deterministic scenarios, assert ordered request/response shapes, and clean up. Use
  when wiring or testing an application's enterprise identity integration or
  reproducing provider-shaped failures; do not claim unrecorded hosted qualification,
  the complete Okta Classic Authn transaction machine, or broad provider parity.
---

# Test with mockOS

Use synthetic identities, passwords, client secrets, and tokens only. Read
`docs/IMPLEMENTATION_STATUS.md`, `docs/known-limitations.md`, and `docs/mcp.md` before
running a repository checkout. Treat a returned URL, fixture, contract, or provider
profile as metadata unless the status ledger names its runtime evidence.

## Inventory the application

1. Record the application's issuer or authority, discovery behavior, callback URIs,
   client-authentication method, scopes, claim mapping, PKCE support, and token
   validation rules.
2. Choose `entra` or `okta`. Define one happy-path result and the exact application
   behavior expected for each negative case.
3. Separate implemented surfaces from gaps. SCIM, bounded Entra Graph reads, tested
   Okta Users/Groups lifecycle APIs, refresh rotation, and deterministic outbound SCIM
   provisioning are available in the locally qualified M5 source candidate. The M6
   source candidate adds bounded Okta Classic `/api/v1/authn` primary states,
   transaction retrieval, and cancellation. Broad Graph/Okta parity, the remaining
   Classic transitions, Entra UserInfo/client credentials/device flow, and SAML remain
   unavailable; never invent routes for them.

## Connect to management MCP

Connect an MCP client to `<origin>/mcp` with the configured mockOS key in
`Authorization: Bearer <key>`. Never print, persist in the repository, or place the key
in a URL. Stop if the operator has not supplied a key: the server intentionally returns
503 when `API_KEY` is not configured and 401 for a missing or incorrect key.

Treat `GET /mcp` returning 405 as the expected POST-only Streamable HTTP fallback. Keep
the issued session ID on later requests and close the client when finished so it sends
the authenticated session-termination DELETE.

Call `tools/list` before creating anything. The M5 source candidate defines these 15
tools:

`create_environment`, `list_environments`, `delete_environment`,
`configure_environment`, `seed_identities`, `create_application`,
`run_provisioning_cycle`, `mint_token`, `set_scenario`, `clear_scenario`,
`get_request_log`, `assert_requests`, `simulate_lifecycle`, `get_wellknown_urls`, and
`set_current_environment`.

Require only the tools needed by the planned workflow and tolerate additional tools
from a newer compatible server. Report a capability mismatch before any mutation; in
particular, do not attempt the lifecycle cascade unless `simulate_lifecycle` is
advertised or provisioning unless `run_provisioning_cycle` is advertised.
Capability discovery is evidence about the connected server, not proof that a local
source candidate is deployed there.

## Create and wire an environment

Use a `try`/`finally` cleanup boundary and keep the returned environment ID:

1. Call `create_environment` with a descriptive name, the chosen provider, and a stable
   test seed. This also selects the environment in the current MCP session.
2. Call `seed_identities` with explicit `users` and `groups`. Use the returned user ID
   in token tests; group members are seeded user names.
3. Call `create_application` with the exact callback URI and grants required by the
   test. Record the returned synthetic `clientId` and `clientSecret` without printing
   the secret.
4. Call `get_wellknown_urls` with the explicit environment ID. Configure the
   application from its returned issuer/endpoints and record `scimBaseUrl` plus
   `graphBaseUrl` for Entra or `oktaApiBaseUrl` plus `oktaAuthnEndpoint` for Okta. Never
   construct or persist an issuer or Authn endpoint from memory.
5. Verify discovery before login and require every absolute URL to use the active host.
   Treat a missing provider-specific directory URL as a capability mismatch.

Pass `environmentId` explicitly in saved automation. Use `set_current_environment`
only for interactive session convenience because its cursor is transport-session-local.

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
5. Introspect an access or refresh token with the synthetic client credentials.
6. Revoke it, then verify introspection returns `{ "active": false }`.

Do not claim the complete Okta Classic transaction machine, client-credentials
redemption, or live-provider parity. Use the bounded primary-authentication recipe
below and the provider-specific directory workflow for the organization API surface.

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
   explicit show-lockout-failures policy.
4. Keep a returned `stateToken` in memory, post it to `oktaAuthnEndpoint` to retrieve
   the same current state, then post it to `<oktaAuthnEndpoint>/cancel`. Reusing it must
   return HTTP 401 `E0000011`. In a separate disposable state transaction, suspend the
   User and then unsuspend it; the pre-suspension token must still return `E0000011`
   after reactivation. Never print or persist the token.
5. A valid active User without required MFA returns `SUCCESS` and a five-minute
   one-time `sessionToken`. The source has an atomic consume-once core seam, but no
   Sessions API exchange route; do not invent one or claim an application cookie.
6. Query the inbound request log for the exact Authn path. Password, `stateToken`, and
   `sessionToken` fields must appear as `[REDACTED]`; do not quote raw protocol bodies in
   the report.

Factor verification, password change, unlock/recovery execution, warnings, enrollment,
and other Classic states are deliberately unavailable even when a response includes a
provider-shaped next-operation link.

## Rotate refresh tokens and test the lifecycle cascade

Run this after a successful authorization-code flow when the application under test
uses refresh tokens:

1. Register `refresh_token` in the application's grant types and request
   `offline_access`. Keep the returned access and refresh tokens in memory only.
2. Redeem the initial refresh token once with the synthetic client credentials. If a
   narrower scope is supplied, require it to be a subset of the originally granted
   scope; otherwise omit `scope`. Assert that redemption succeeds, returns a different
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
expiry across rotation. Treat those as focused source behaviors, not live-provider or
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

For the M6 SCIM source slice, use only these injection-locked recipes:

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
Request-log bodies can contain test credentials and tokens, so quote only the minimum
safe evidence. Confirm that outbound target Bearer values remain redacted. Separate
local M5 source-candidate results from hosted or deployed evidence in the report.

Use only the exact-revision records linked by the implementation ledger as deployed
evidence. Do not present an older workers.dev smoke as M5 qualification or any source
or deployed result as comparison against a live Entra ID tenant or Okta organization.
