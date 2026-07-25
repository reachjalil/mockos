# Okta behavior

Status: Accepted bounded M3 plus sampled deployed M6 Classic Authn; bounded Okta Auth JS public-client local X/Q passed; live-Okta parity is not claimed
Last reviewed: 2026-07-26

The Okta profile parameterizes the shared identity engine and has a dedicated HTTP
adapter for a bounded custom-authorization-server surface. In workers.dev path mode an
environment uses an issuer shaped like:

```text
https://<worker-origin>/e/<environment-id>/oauth2/default
```

Only the `default` authorization-server ID is accepted. A different ID returns an
Okta-shaped OAuth error. A future custom domain can provide an organization-style host;
workers.dev path mode cannot satisfy SDKs that insist on a bare Okta organization URL.

## Application registrations

The current source candidate distinguishes two OAuth client types:

| Client type | Secret and grants | Token endpoint | Introspection | Revocation |
| --- | --- | --- | --- | --- |
| `confidential` | Default. Returns a synthetic secret exactly once and stores only its hash. | `client_secret_basic` or `client_secret_post` | Secret required | Secret required |
| `public` | Returns and stores no secret. Supplying one or selecting `client_credentials` is rejected. | `none`; code redemption still requires S256 PKCE and refresh is bearer-token based | Not allowed | `none`, but the owning public client ID is still required |

This is an application-authentication contract, not a statement that a public client is
trusted. A public client cannot keep a secret. Its redirect URI, authorization code,
PKCE verifier, refresh token, and client ID remain the security inputs for the bounded
flow.

The official MCP SDK 1.29 `tools/list` schema exposes the same contract with a strict
object, optional advertised defaults, a Draft-7 public `if`/`then` that forbids a
secret and narrows grants, and exact public/confidential output branches. Runtime
validation and machine discovery therefore agree.

Public revocation is deliberately owner-bound. The service hashes the supplied token
and updates only rows whose stored `client_id` matches the caller, so identifying one
public client cannot revoke another application's token family. Unknown and
already-revoked tokens remain idempotent success. Public introspection is not exposed;
discovery advertises only confidential methods for introspection.
A core negative regression preserves another application's active access token and
rotated refresh family after an unrelated public client attempts revocation.

## OIDC and OAuth surface

| Method and route | Accepted M3 behavior |
| --- | --- |
| `GET /oauth2/default/.well-known/openid-configuration` | Request-derived discovery for the bounded authorization server |
| `GET /oauth2/default/v1/keys` | JWKS for the environment signing key |
| `GET, POST /oauth2/default/v1/authorize` | Synthetic hosted login and authorization code with required S256 PKCE |
| `POST /oauth2/default/v1/token` | Authorization-code redemption, rotating refresh-token redemption, and RFC 8628 device-code polling |
| `POST /oauth2/default/v1/device/authorize` | Device and user codes, verification URLs, expiry, and polling interval |
| `GET, POST /activate` | Synthetic user-code activation with a seeded identity |
| `POST /oauth2/default/v1/introspect` | Active/inactive access- and refresh-token state after client authentication |
| `POST /oauth2/default/v1/revoke` | Access- or refresh-token revocation; unknown tokens are idempotent |

Token discovery advertises `client_secret_basic`, `client_secret_post`, and `none`.
Confidential clients authenticate with a secret. Public code and refresh redemption
omit a secret, and a spurious secret fails client authentication. Authorization-code
redemption emits RS256 ID and access tokens plus a refresh token when
`offline_access` is requested and the application registration permits the
`refresh_token` grant.
Okta-specific claims, request IDs, OAuth errors, and the implemented token lifecycles
are covered by core, adapter, and Worker tests.

Introspection discovery advertises only `client_secret_basic` and
`client_secret_post`; the implementation rejects secretless introspection. Revocation
discovery additionally advertises `none`. The official Auth JS 8.0.1 client uses a
client-ID-only Basic compatibility request for its public revocation. The HTTP adapter
normalizes that to no secret; the core still validates the registration is public and
filters the revocation by its owning client ID.

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

## Okta Auth JS public-client qualification

The current local candidate pins `@okta/okta-auth-js` 8.0.1. Through a real owned
Wrangler HTTPS socket, Auth JS:

1. calls `getWithRedirect` with S256 PKCE, `state`, `nonce`, login hint, and
   `offline_access`;
2. receives the synthetic hosted-login callback;
3. calls `parseFromUrl`, exchanges the code, fetches JWKS, verifies the RS256 ID token,
   and exposes the expected issuer, audience, subject, username, email, and nonce;
4. calls `renewTokens` and receives a rotated refresh token;
5. calls public `token.revoke` for the refreshed access token and receives HTTP 200;
   the following lifecycle result revokes exactly one remaining access token, proving
   the SDK call changed state despite the endpoint's idempotent success; and
6. receives `invalid_grant` with `User account is disabled.` when a later refresh
   follows MCP `suspend`.

Because the exact test runs in Node without a browser global, the harness supplies the
SDK-exposed `parseFromUrl._getLocation` seam and passes the callback URL explicitly.
This qualifies that exact 8.0.1 Node harness, not a browser callback flow or another
version. MCP is the management path for setup, request assertion, lifecycle, and
cleanup.

The exact flow is D/I/S/X/Q yes and H/V/P no. Read the
[quickstart](../quickstarts/okta-auth-js-node.md) and
[local evidence](../evidence/okta-auth-js-local-qualification.md). It does not promote
the 22 documented OIDC fixtures, earlier workers.dev samples, or a source-CI job into
official-client H, V, or P evidence.

Its durable-evidence assertion parses the exercised password, callback code,
code/verifier exchange, refresh, revocation-token, and successful token-response fields
as `[REDACTED]`. It also rejects the raw, `encodeURIComponent`, and URL-form-encoded
representations of every exercised password/code/verifier/token value. This is exact
named-field and representation evidence, not arbitrary-encoding classification.

## Classic primary authentication

Okta environments now expose a bounded Classic Engine primary-authentication machine
at `POST /e/<environment>/api/v1/authn`. `get_wellknown_urls` returns the exact URL as
`oktaAuthnEndpoint`; callers should use that value rather than retaining an old host.
This route is a public synthetic sign-in boundary and does not require the `SSWS`
credential used by the adjacent management API.

The bounded M6 implementation exposes these initial transaction outcomes:

| Seeded User condition after password verification | Result |
| --- | --- |
| active, valid password, no required MFA | `SUCCESS` with a five-minute one-time `sessionToken` |
| `mfaState: "required"` | `MFA_REQUIRED` with an expiring `stateToken` and synthetic TOTP factor |
| expired/reset-required password without required MFA | `PASSWORD_EXPIRED` with an expiring `stateToken` |
| suspended User | explicit show-lockout-failures `LOCKED_OUT` shape |

Credential verification always precedes policy/state evaluation. An unknown user or a
wrong password for an MFA, expired, suspended, disabled, or deleted User returns the
same HTTP 401 `E0000004` response and creates no transaction. Required MFA takes
precedence over password expiry, matching the documented Classic Engine order.

Raw passwords, state tokens, and session tokens are never persisted. The two bearer
capabilities are stored only as SHA-256 hashes. `POST /api/v1/authn` can read the exact
current transaction by `stateToken`; every valid read slides that transaction's expiry
to five minutes from the read. `POST /api/v1/authn/cancel` deletes it, while cancel
replay and tokens at their exact expiry return HTTP 401 `E0000011`. A successful
primary authentication instead issues a session capability with a fixed five-minute
expiry from issuance. Session tokens have a tested atomic consume-once core seam,
although a Sessions API exchange route is not part of this bounded slice.

Retention is bounded independently for state and session capabilities. Each User can
retain at most 32 retained rows of each kind, and each table can retain at most 10,000 retained
rows. Issuance evicts the oldest-expiring rows first when either cap would be exceeded
and prunes at most 256 expired rows from each table per issuance. Version-neutral
operational indexes make those expiry and eviction queries index-backed without
advancing schema v5, preserving rollback compatibility for already-provisioned
environments.

Browser CORS is same-origin only. A preflight must request `POST` and may request only
`accept` and `content-type`; responses never opt into credentialed CORS, and
cross-origin or unsupported preflights fail with HTTP 403. `MFA_REQUIRED` uses the
singular `_embedded.factor` property (containing the factor array), and embedded User
responses deliberately omit `passwordChanged`. Deactivating lifecycle transitions and
SCIM password changes atomically revoke outstanding state and session capabilities;
reactivation does not restore them.

Authn request and response logs recursively redact sensitive JSON keys. Malformed,
primitive, or otherwise non-object bodies are replaced wholesale rather than retained.
Sensitive request/response headers—including authorization, proxy authorization,
cookies, API-key, credential, password, private-key, secret, and token header
families—are redacted while non-secret fields such as `passwordChanged` remain
available for assertions.

## Directory surface

An Okta environment has two accepted M3 directory surfaces in path mode:

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

The [22 Okta OIDC fixtures](../../packages/testkit/fixtures/okta/oidc) document discovery,
authorization-code tokens and claims, introspection, revocation, device-flow states,
invalid clients, and rate-limit shapes from official Okta documentation. Every fixture
is marked `documented`. They are source-reviewed expectations, not captures from a live
Okta organization and not a claim that the complete corpus runs against the Worker.

Five additional [Classic Authn fixtures](../../packages/testkit/fixtures/okta/authn)
are marked `implemented` and execute against the core-backed HTTP composition. They
cover `SUCCESS`, `MFA_REQUIRED`, `PASSWORD_EXPIRED`, `LOCKED_OUT`, and generic invalid
credentials. Focused core tests cover hash-only storage, expiry, cancellation replay,
MFA precedence, and one-time session-token consumption; the Worker integration covers
the mounted states, state retrieval/cancellation, discovery, privacy boundary, and log
redaction.

Implemented subsets are exercised by:

- [core Okta tests](../../packages/core/src/okta.test.ts),
- [Okta HTTP-adapter tests](../../packages/engine-http/src/okta.test.ts), and
- [Okta Worker integration](../../apps/worker/test/okta.integration.test.ts).

The [M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) qualifies a bounded Okta
SCIM discovery/PATCH, directory-read, and rate-limit sample. The broader accepted M3
Okta OAuth, refresh, device, and lifecycle behavior remains qualified by local and
hosted tests rather than that deployed sample. None is a live Okta-provider comparison
or broad SDK compatibility claim.

The separate [Okta Auth JS local record](../evidence/okta-auth-js-local-qualification.md)
qualifies one public-client code/PKCE/JWKS/refresh/revoke/suspend path through Q. It
does not establish H for any deployed Worker, V against a real Okta organization, or P.

The separate [M6 workers.dev smoke](../evidence/m6-workers-dev-smoke.md) samples
invalid-credential privacy, `MFA_REQUIRED`, state retrieval, `PASSWORD_EXPIRED`,
`LOCKED_OUT`, `SUCCESS`, same-origin/cross-origin CORS, and exact body/header redaction
on both exact Worker versions. It does not exercise every retention, cancellation,
revocation, or race assertion remotely and is not verified-live Okta evidence.

## Deliberate limits

- `client_credentials` grant redemption is not mounted. M3 refresh redemption is
  accepted in local/hosted tests, but the deployed acceptance did not sample it.
- Public clients are limited to the bounded code, refresh, and owner-bound revocation
  contract above. They cannot configure a secret, use `client_credentials`, or call
  introspection. Refresh tokens remain bearer credentials without DPoP or another
  sender constraint.
- Discovery and `get_wellknown_urls` return a UserInfo URL, but `/v1/userinfo` is not
  implemented yet.
- Classic `/api/v1/authn` is limited to primary authentication, state retrieval, and
  cancellation. Factor verification, password change, recovery/unlock execution,
  Sessions API exchange, password warnings, enrollment, and the rest of the Classic
  transaction machine are not implemented. Provider-shaped links identify the next
  operation but do not claim those linked transitions are mounted.
  Deactivating lifecycle transitions and SCIM password changes atomically remove
  outstanding Classic state and one-time session capabilities; later reactivation
  does not restore them.
- `/api/v1` uses Okta API-shaped errors and request IDs for the tested cases, including
  deterministic rate limiting; exact catalog parity is not claimed.
- Exact error descriptions, cookies, hosted-login HTML, uncommon parameters, key
  rollover, browser storage/callback behavior, Sign-In Widget, IDX, and
  organization-host SDK behavior can differ from Okta. The Auth JS record qualifies
  only 8.0.1 over local path-mode HTTPS with in-memory managers.
- M5 outbound provisioning now has a deterministic Okta planner and delivery source
  candidate. Worker/full local gates are green, but the process e2e samples an
  Entra-shaped cycle; Okta deployed and live-provider comparison remain pending.
  Accepted inbound SCIM behavior alone is not live-provider evidence for that outbound
  runtime.
