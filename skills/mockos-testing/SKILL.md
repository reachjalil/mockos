---
name: mockos-testing
description: >-
  Run implemented M2 mockOS identity-integration tests through authenticated MCP:
  create isolated Entra ID or Okta environments, seed identities, register OIDC
  clients, run PKCE and Okta device flows, mint broken tokens, inject deterministic
  scenarios, assert request logs, and clean up. Use when wiring or testing an
  application's enterprise OIDC/OAuth integration or reproducing provider-shaped
  failures; treat SCIM, directory lifecycle, Okta Classic Authn, and outbound
  provisioning as unavailable until their milestones are implemented.
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
3. Exclude SCIM, directory APIs and lifecycle, Okta Classic `/api/v1/authn`, UserInfo,
   refresh-token grant redemption, and outbound provisioning from an M2 executable
   plan. Report those cases as unavailable instead of inventing routes.

## Connect to management MCP

Connect an MCP client to `<origin>/mcp` with the configured mockOS key in
`Authorization: Bearer <key>`. Never print, persist in the repository, or place the key
in a URL. Stop if the operator has not supplied a key: the server intentionally returns
503 when `API_KEY` is not configured and 401 for a missing or incorrect key.

Treat `GET /mcp` returning 405 as the expected POST-only Streamable HTTP fallback. Keep
the issued session ID on later requests and close the client when finished so it sends
the authenticated session-termination DELETE.

Call `tools/list` and expect exactly these 13 M2 tools:

`create_environment`, `list_environments`, `delete_environment`,
`configure_environment`, `seed_identities`, `create_application`, `mint_token`,
`set_scenario`, `clear_scenario`, `get_request_log`, `assert_requests`,
`get_wellknown_urls`, and `set_current_environment`.

Report a capability mismatch before attempting a missing tool. Do not infer
provisioning or lifecycle tools from future documentation.

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
   application from its returned issuer and endpoints; never construct or persist an
   issuer from memory.
5. Verify discovery before login and require every absolute URL to use the active host.
   Do not call the returned SCIM or UserInfo URLs in M2.

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

Exercise only authorization-code and device-code redemption at the token endpoint.
Include `refresh_token` in the application registration only when the test needs an
issued refresh token, and request `offline_access` in that authorization flow. Do not
send a refresh-token grant. Do not claim Okta organization API, Classic Authn,
client-credentials redemption, or live-provider parity.

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
- `http.request`
- `*` as a lower-priority catch-all

Choose one action: `delay` (1–30,000 milliseconds), `error` with a supported semantic
error code, or `mutate` with a shallow JSON patch. Use mutation only at
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, or `oauth.introspect`;
other mutation points fail closed. Set `probability` and, for a bounded case,
`remaining`. Preserve the environment seed, scenario ID, parameters, and evaluation
order in the report so the sequence is reproducible.

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
safe evidence.

Use the [M2 workers.dev smoke record](../../docs/evidence/m2-workers-dev-smoke.md) only
as deployed mockOS evidence. Do not present it as a comparison against a live Entra ID
tenant or Okta organization.
