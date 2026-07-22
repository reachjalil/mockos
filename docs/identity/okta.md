# Okta behavior

Status: M3 Okta source candidate locally tested; deployed and live-Okta parity are not claimed
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

## OIDC and OAuth surface

| Method and route | Source-candidate behavior |
| --- | --- |
| `GET /oauth2/default/.well-known/openid-configuration` | Request-derived discovery for the bounded authorization server |
| `GET /oauth2/default/v1/keys` | JWKS for the environment signing key |
| `GET, POST /oauth2/default/v1/authorize` | Synthetic hosted login and authorization code with required S256 PKCE |
| `POST /oauth2/default/v1/token` | Authorization-code redemption, rotating refresh-token redemption, and RFC 8628 device-code polling |
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

Refresh redemption authenticates the client, rejects scope escalation, rotates the
token atomically within its family, and preserves original authentication time and
absolute expiry. Replay or concurrent double redemption revokes the refresh family and
its associated tracked access tokens. Suspending, deprovisioning, or deleting the User
through lifecycle policy revokes effective access and refresh credentials in the same
transaction.

The device flow models `authorization_pending`, `slow_down`, successful activation,
`access_denied`, expiry, invalid clients, and one-time device-code use. The Worker
integration test exercises pending and successful activation; the remaining states are
covered at the core or HTTP-adapter boundary.

## Directory source candidate

An Okta environment has two local M3 directory surfaces in path mode:

- `/e/<environment>/scim/v2` provides the shared SCIM discovery and versioned
  User/Group surface with the Okta PUT-heavy, pathless PATCH, filtered-membership, and
  representation-returning Group PATCH profile.
- `/e/<environment>/api/v1` provides bounded Users, Groups, direct membership, paging,
  login filtering, and activate/reactivate/suspend/unsuspend/deactivate/delete routes.
  Deactivate maps to the internal deprovision action, and final deletion requires a
  deprovisioned User.

SCIM accepts a non-empty synthetic Bearer value and `/api/v1` accepts a non-empty
synthetic `SSWS` value. These are scheme-and-presence checks for protocol tests, not
validation of a real Okta token. Never send the MCP/control Access Key to either route.
User deletion removes Group membership and increments affected Group versions.

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

The M3 refresh, SCIM, directory, and lifecycle paths have focused local source tests.
They are not part of that deployment record, have not been compared with a live Okta
organization, and are not a broad Okta SDK compatibility claim.

## Deliberate limits

- `client_credentials` grant redemption is not mounted. The M3 source candidate mounts
  refresh redemption locally, but the deployed M2 evidence does not.
- Discovery and `get_wellknown_urls` return a UserInfo URL, but `/v1/userinfo` is not
  implemented yet.
- Classic `/api/v1/authn` is not implemented. The bounded Users/Groups routes do not
  imply support for the rest of the Okta Management API.
- `/api/v1` uses Okta API-shaped errors and request IDs for the tested cases, including
  deterministic rate limiting; exact catalog parity is not claimed.
- Exact error descriptions, cookies, hosted-login HTML, uncommon parameters, key
  rollover, and organization-host SDK behavior can differ from Okta.
- Outbound provisioning is not implemented; inbound SCIM dialect behavior does not
  constitute an outbound planner or delivery runtime.
