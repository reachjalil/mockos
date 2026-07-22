---
name: mockos-testing
description: >-
  Run implemented M3 source-candidate mockOS identity-integration tests through authenticated MCP:
  create isolated Entra ID or Okta environments, seed identities, register OIDC
  clients, run PKCE/refresh/lifecycle flows, exercise SCIM and bounded provider
  directory APIs, mint broken tokens, inject deterministic scenarios, assert request
  logs, and clean up. Use when wiring or testing an application's enterprise identity
  integration or reproducing provider-shaped failures; do not claim hosted M3
  qualification, Okta Classic Authn, broad provider parity, or outbound provisioning.
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
   Okta Users/Groups lifecycle APIs, and refresh rotation are available in the M3
   source candidate. Okta Classic `/api/v1/authn`, broad Graph/Okta parity, Entra
   UserInfo/client credentials/device flow, SAML, and outbound provisioning remain
   unavailable; never invent routes for them.

## Connect to management MCP

Connect an MCP client to `<origin>/mcp` with the configured mockOS key in
`Authorization: Bearer <key>`. Never print, persist in the repository, or place the key
in a URL. Stop if the operator has not supplied a key: the server intentionally returns
503 when `API_KEY` is not configured and 401 for a missing or incorrect key.

Treat `GET /mcp` returning 405 as the expected POST-only Streamable HTTP fallback. Keep
the issued session ID on later requests and close the client when finished so it sends
the authenticated session-termination DELETE.

Call `tools/list` before creating anything. The M3 source candidate defines these 14
tools:

`create_environment`, `list_environments`, `delete_environment`,
`configure_environment`, `seed_identities`, `create_application`, `mint_token`,
`set_scenario`, `clear_scenario`, `get_request_log`, `assert_requests`,
`simulate_lifecycle`, `get_wellknown_urls`, and `set_current_environment`.

Require only the tools needed by the planned workflow and tolerate additional tools
from a newer compatible server. Report a capability mismatch before any mutation; in
particular, do not attempt the M3 cascade unless `simulate_lifecycle` is advertised.
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
   `graphBaseUrl` for Entra or `oktaApiBaseUrl` for Okta. Never construct or persist an
   issuer from memory.
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

Do not claim Okta Classic Authn, client-credentials redemption, or live-provider
parity. Use the provider-specific directory workflow below for the bounded organization
API surface.

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

The current M3 source preserves the original authentication time and absolute family
expiry across rotation. Treat those as focused local source-candidate behaviors, not
live-provider or deployed-M3 evidence.

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
because its result reports the coordinated revocation counts. Do not call Classic
`/api/v1/authn` or infer other Okta organization APIs.

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

## Diagnose and assert requests

Use `get_request_log` to inspect newest-first inbound protocol entries. Filter only by
supported fields: source, provider, normalized method, exact path, exact status, limit,
and cursor.

Use `assert_requests` for stable machine assertions. Supply only:

- `source` for an exact source match;
- `method`, normalized to uppercase and then matched exactly;
- `path` for the exact public request path;
- `status` for the exact response status;
- `bodyIncludes` for a case-sensitive literal substring of the stored **request** body;
  and
- `count.atLeast`, `count.atMost`, or `count.exactly`.

Do not ask `assert_requests` to match headers, response-body subsets, regular
expressions, ordering, or selected JSON fields. Check the returned `pass`, `matched`,
`message`, and request IDs. Treat a failed assertion as a failed test, not merely a
diagnostic note.

## Clean up and report

In `finally`, clear every scenario created by the run, call `delete_environment` with
the explicit environment ID, and close the MCP client. Do not delete an environment
selected only through an inherited cursor, and do not rely on idle TTL as normal test
cleanup.

Report every case as passed, failed, or unavailable. Redact the management key,
Authorization headers, cookies, client secrets, full tokens, and synthetic passwords.
Request-log bodies can contain test credentials and tokens, so quote only the minimum
safe evidence. Separate local M3 source-candidate results from hosted or deployed
evidence in the report.

Use the [M2 workers.dev smoke record](../../docs/evidence/m2-workers-dev-smoke.md) only
as historical deployed M2 evidence. Do not present it as M3 qualification or as a
comparison against a live Entra ID tenant or Okta organization.
