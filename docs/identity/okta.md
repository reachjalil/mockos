# Okta behavior

Status: M2 bounded OIDC runtime implemented; live-Okta parity is not claimed
Last reviewed: 2026-07-22

The Okta profile parameterizes the shared identity engine and has a dedicated HTTP
adapter for a bounded custom-authorization-server surface. In workers.dev path mode an
environment uses an issuer shaped like:

```text
https://<worker-origin>/e/<environment-id>/oauth2/default
```

Only the `default` authorization-server ID is accepted. A different ID returns an
Okta-shaped OAuth error. A future custom domain can provide an organization-style host;
workers.dev path mode cannot satisfy SDKs that insist on a bare Okta organization URL.

## Implemented HTTP surface

| Method and route | M2 behavior |
| --- | --- |
| `GET /oauth2/default/.well-known/openid-configuration` | Request-derived discovery for the bounded authorization server |
| `GET /oauth2/default/v1/keys` | JWKS for the environment signing key |
| `GET, POST /oauth2/default/v1/authorize` | Synthetic hosted login and authorization code with required S256 PKCE |
| `POST /oauth2/default/v1/token` | Authorization-code redemption and RFC 8628 device-code polling only |
| `POST /oauth2/default/v1/device/authorize` | Device and user codes, verification URLs, expiry, and polling interval |
| `GET, POST /activate` | Synthetic user-code activation with a seeded identity |
| `POST /oauth2/default/v1/introspect` | Active/inactive access- and refresh-token state after client authentication |
| `POST /oauth2/default/v1/revoke` | Access- or refresh-token revocation; unknown tokens are idempotent |

Client authentication accepts `client_secret_basic` and `client_secret_post` on the
token-management endpoints that require a secret. Authorization-code redemption emits
RS256 ID and access tokens plus a refresh token when `offline_access` is requested and
the application registration permits the `refresh_token` grant.
Okta-specific claims, request IDs, OAuth errors, and the implemented token lifecycles
are covered by core, adapter, and Worker tests.

The device flow models `authorization_pending`, `slow_down`, successful activation,
`access_denied`, expiry, invalid clients, and one-time device-code use. The Worker
integration test exercises pending and successful activation; the remaining states are
covered at the core or HTTP-adapter boundary.

## Evidence boundary

The [22 Okta fixtures](../../packages/testkit/fixtures/okta/oidc) document discovery,
authorization-code tokens and claims, introspection, revocation, device-flow states,
invalid clients, and rate-limit shapes from official Okta documentation. Every fixture
is marked `documented`. They are source-reviewed expectations, not captures from a live
Okta organization and not a claim that the complete corpus runs against the Worker.

Implemented subsets are exercised by:

- [core Okta tests](../../packages/core/src/okta.test.ts),
- [Okta HTTP-adapter tests](../../packages/engine-http/src/okta.test.ts), and
- [Okta Worker integration](../../apps/worker/test/okta.integration.test.ts).

The [M2 workers.dev smoke](../evidence/m2-workers-dev-smoke.md) qualifies deployment of
the same Worker runtime and its MCP/Entra scenario loop. Okta protocol behavior remains
qualified by the local Worker integration above; the smoke is not a live Okta-provider
comparison.

## Deliberate limits

- `refresh_token` and `client_credentials` grant redemption are not mounted on the
  Okta token endpoint in M2.
- Discovery and `get_wellknown_urls` return a UserInfo URL, but `/v1/userinfo` is not
  implemented yet.
- SCIM, Okta users/groups APIs, directory lifecycle, and Classic `/api/v1/authn` are
  not implemented. Provider-profile metadata does not make those routes available.
- The core can render an Okta API rate-limit envelope, but no `/api/v1/*` runtime is
  mounted. Implemented OAuth routes use OAuth-shaped error responses.
- Exact error descriptions, cookies, hosted-login HTML, uncommon parameters, key
  rollover, and organization-host SDK behavior can differ from Okta.
