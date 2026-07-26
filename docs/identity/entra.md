# Entra ID behavior

Status: Accepted bounded M3/M5 Entra slices and sampled M6 deployment; bounded MSAL Node 5.4.2 authorization-code and public-device local X/Q qualification added
Last reviewed: 2026-07-26

mockOS models a tenant-specific Microsoft identity platform authority. In path hosting,
the target authority is:

`https://<worker>/e/<environment>/<tenant-guid>/v2.0`

The implementation must derive absolute discovery, issuer, redirect, and JWKS URLs from
the current request. It must persist the tenant and relative identity state, never an
absolute issuer.

## OIDC and OAuth boundary

The accepted vertical slice implements discovery, authorization code + PKCE S256, a
hosted sign-in form, token redemption, an RS256 ID token, and JWKS verification. Expected
claims include `aud`, `iss`, `iat`, `exp`, `nonce`, `oid`, `sub`, `tid`,
and a configured username claim. The [Worker integration test](../../apps/worker/test/oidc.integration.test.ts)
drives the full hosted-login flow and verifies the minted ID token from JWKS.

OIDC discovery and `get_wellknown_urls` deliberately omit UserInfo because no
UserInfo route is mounted. Entra fixtures 28 and 29 remain documented targets only.
Removing the previously advertised URL makes discovery match the executable runtime;
it adds no UserInfo support or higher evidence claim.

The accepted M3 implementation also redeems the `refresh_token` grant for an authenticated
client. Refresh tokens are stored hashed and rotate atomically within a family while
preserving the original authentication time and absolute expiry. Scope escalation is
rejected. Replay or concurrent double redemption revokes the family and its associated
tracked access tokens. Disabling or deleting the User through lifecycle policy revokes
effective access and refresh credentials in the same transaction; a later refresh
attempt fails with Entra-shaped `invalid_grant` / `AADSTS50057` behavior. This has
focused core, adapter, and Worker coverage, and the M3 deployed smoke sampled the
rotation/lifecycle path.

## Public-client device authorization

The current source also implements a bounded Microsoft identity platform device path
for secret-free public applications:

- discovery exposes `POST /<tenant-guid>/oauth2/v2.0/devicecode`;
- device authorization returns `device_code`, `user_code`, `verification_uri`,
  `expires_in: 900`, `interval: 5`, and a human message;
- Entra deliberately omits `verification_uri_complete`;
- `GET /devicelogin` renders the activation form, and `POST /devicelogin` accepts an
  explicit `approve` or `deny` decision only after the supplied synthetic username and
  password authenticate;
- the token endpoint accepts MSAL Node 5.4.2's wire
  `grant_type=device_code` as well as the discovery/registration RFC value
  `urn:ietf:params:oauth:grant-type:device_code`, normalizing both to the canonical
  core grant; and
- polling returns `authorization_pending`, `authorization_declined`,
  `bad_verification_code`, `expired_token`, or `slow_down` at the implemented
  boundaries.

Only a `clientType: "public"` registration can start this Entra flow; no client secret
is accepted or returned. A device-only registration uses `redirectUris: []` because
the flow has no callback. Do not invent a URI. If the registration also includes
`authorization_code`, it is mixed and must register at least one real, exact callback
URI for that code flow. Register the RFC device grant plus `refresh_token` when
testing rotation.

MSAL Node invokes its device callback once and polls immediately. The mock returns
`authorization_pending` for that first poll. Polling faster than the current interval
produces `slow_down` and increases the interval by five seconds; MSAL Node 5.4.2 does
not retry `slow_down`, so a qualification run must activate after observing the first
pending poll rather than deliberately triggering the throttle.

Approval prepares tokens and atomically commits device-code consumption with access,
ID, and refresh-token persistence. A signing, Graph-overage, or persistence failure
does not burn the code; concurrent successful polls have one winner. The token path
uses the trusted request-derived Graph base for the 201-group claim-source fallback.
Entra access and ID tokens receive distinct Microsoft-shaped `uti` values, public
refresh tokens rotate, and disabling the User revokes both the authorization-code and
device-flow credential families.

Core, HTTP fixture, mounted Worker, and actual-network MSAL Node 5.4.2 tests qualify
this bounded path through D/I/S/X/Q locally. There is no hosted Worker or Cloud smoke,
real-Entra comparison, broad MSAL/version matrix, or production-ready evidence, so
H/V/P remain open.

## Pinned MSAL Node client boundary

The current source candidate qualifies two coordinated official-client slices through
one real local HTTPS socket: `@azure/msal-node` 5.4.2 runs a confidential
authorization-code client and a separate public device client against the same
tenant-specific mockOS custom authority. The official MCP SDK 1.29.0 first creates,
seeds, configures, observes, and deletes the disposable environment. MSAL drives
authorization URL construction, authorization-code redemption with S256 PKCE,
`acquireTokenByDeviceCode`, and a forced refresh for each account. After MCP lifecycle
disable, both clients' next forced refresh surface `invalid_grant`; the confidential
path also asserts `AADSTS50057`.

The client must use the exact `issuer` returned by `get_wellknown_urls`, trust the
authority host explicitly, and select generic OIDC behavior:

```js
const app = new ConfidentialClientApplication({
  auth: {
    authority,
    clientId,
    clientSecret,
    knownAuthorities: [new URL(authority).host],
  },
  system: { protocolMode: ProtocolMode.OIDC },
});
```

The `knownAuthorities` entry is the host only. The test does not use static authority
metadata or a Microsoft-owned tenant alias. Its actual-network boundary is a local
Wrangler HTTPS listener. For readiness, the parent anchors the captured leaf, validates
its `localhost` hostname, and requires the owned child's nonce. The child adds that
certificate as a process-local CA through `NODE_EXTRA_CA_CERTS` while retaining
standard Node trust, then independently requires an HTTPS `localhost` origin and the
same nonce. TLS verification remains enabled, the temporary mode-`0600` CA file is
removed during cleanup, and no alternate-certificate rejection is qualified.

The exact 14-request provider sequence covers confidential discovery, login GET/POST,
successful code redemption and refresh, separate public-client discovery, device
authorization, immediate pending poll, activation GET/POST, successful device
redemption, one successful device refresh, and one lifecycle-rejected refresh for each
client. The seven token responses are four 200s, one `authorization_pending`, and two
lifecycle 400s. A single ownership-checked `/health` request bridges the local Wrangler
loopback during MSAL's five-second wait; it is neither a provider request nor a retry.
Durable evidence redacts OAuth passwords, client secrets, authorization/device/user
codes, PKCE verifiers, activation credentials, token response fields, the repeated
device message, and redirect `Location` query/fragment secrets. The actual-network
harness rejects raw, URI-encoded, and form-encoded representations of every exercised
credential and token.

Normal completion deletes the MCP environment and stops the client, Wrangler process
group, and temporary state. A separate local cleanup probe interrupts a ready parent
with `SIGTERM` and verifies exit `143`, port release, process-group exit, and temporary
state removal. It does not qualify `SIGKILL`, Windows process-tree behavior, or every
active-client interruption point.

This qualifies D/I/S/X/Q for that one MSAL Node flow. It has no hosted-smoke (H),
verified-live (V), or production-ready (P) evidence. See the
[task guide](../quickstarts/entra-msal-node.md) and
[local evidence record](../evidence/entra-msal-node-local-qualification.md).

The M6 token/key stream keeps schema v5 and adds a pre-published successor key.
Rotation atomically promotes that successor, creates another successor, and converts the
previous active row into a metadata-only overlap: its private JWK is scrubbed to `{}` and
it is encoded as legacy-visible `next` plus a non-null `retired_at`. `retiring` is only
accepted while normalizing legacy rows; it is not a steady-state status. This lets the
previous JWKS query keep publishing the overlap key without an unsafe migration.
The ring is bounded to active, successor, overlap, and one retired metadata row.

A second rotation is blocked for exactly 26 hours after the prior rotation. That is the
maximum rollback/verification-overlap window mockOS qualifies for built-in Worker OIDC
and MCP `mint_token` issuance: it covers the bounded 24-hour scenario skew, fixed
one-hour token lifetime, and one hour of verifier/cache drift. The public core
`IssueIdTokenInput.expiresInSeconds` and `additionalClaims` fields are trusted test seams;
custom longer lifetimes or temporal-claim overrides through them are outside the 26-hour
guarantee. An idle ring may continue publishing the old public key until the next
eligible rotation, but no longer rollback guarantee is claimed. Each sign operation
rereads the persisted active key and verifies it remained active after signing, retrying
if rotation won the race. The internal `token.before_sign` scenario can trigger one
rollover or apply a bounded temporal-claim skew without moving storage timestamps.
Focused core and Worker tests cover the rollover, including multi-service and forced
sign/rotate interleavings. The deployed M6 smoke samples functional rotation and stale/
fresh JWKS verification; the concurrency, storage-scrubbing, and full time-gate cases
remain source evidence.

For applications whose group-claims mode is enabled, Entra group claims remain inline
through exactly 200 group IDs. At 201, the token omits `groups` and emits
`_claim_names` / `_claim_sources` pointing to the same environment's
`POST /graph/v1.0/users/<id>/getMemberObjects` endpoint. The Graph base is derived from
trusted routing state, not token input: path mode uses `/e/<environment>/graph/v1.0`,
while subdomain mode uses `https://<environment>.<base>/graph/v1.0` even though the
Entra issuer is on `https://login.<base>/<tenant>/v2.0`. The endpoint accepts only a
strict JSON body containing `securityEnabledOnly`, streams and cancels above 4,096
bytes even when `Content-Length` is absent or false, and treats JSON media types
case-insensitively. Token issuance uses an ID-only SQL query capped at 201 memberships.
The fallback uses an ID-only query capped at 1,001 and returns HTTP 400 with
`Directory_ResultSizeLimitExceeded` instead of returning more than 1,000 IDs. Callers
cannot supply a source URL, and no outbound request is made.

## Directory surface

In path mode an Entra environment exposes these accepted M3 bases:

- `/e/<environment>/scim/v2` for SCIM discovery and versioned User/Group CRUD,
  filtering, pagination, PATCH, and ETags;
- `/e/<environment>/graph/v1.0` for bounded read-only Users, Groups, direct group
  membership, exact supported-property `eq` filters, projection, cursor pages, and the
  bounded group-overage `getMemberObjects` lookup.

Entra lifecycle policy supports activate, disable, reactivate, and delete. Deletion
also removes the User from Groups and increments affected Group versions. SCIM and
Graph require a non-empty synthetic Bearer value for protocol testing. That check does
not validate a Microsoft access token, and the MCP/control Access Key must never be
used as the directory credential.

The [OIDC fixture corpus](../../packages/testkit/fixtures/entra/oidc) contains 38
source-reviewed cases: 25 documented targets and 13 implemented cases. Fixtures 23–27
execute device start, pending, credential-gated denial, unknown-code, and deterministic
expiry behavior through a core-backed HTTP executor. Mounted Worker coverage exercises
creation, pending/`slow_down`, credential-gated denial, approval/token/refresh/
consumption, and unknown-code handling; deterministic expiry is not mounted. Eight M6
token-edge fixtures execute through an authenticated
[Worker fixture runner](../../apps/worker/test/token-fixtures.integration.test.ts).
A fixture's own status controls its evidence level; a documented case is not promoted
by adjacency to an implemented case. The separate [SCIM corpus](../../packages/testkit/fixtures/entra/scim) contains
source-reviewed source-implemented cases but is not a live capture or a corpus-wide Worker
conformance run. Client credentials, UserInfo, exact Microsoft UI,
localization, risk policy, Conditional Access, and tenant administration remain outside
the implemented boundary.

The [M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) verifies a bounded
hosted authorization-code/JWKS, refresh/lifecycle, SCIM, and Graph sample. It does not
run the entire fixture corpus or compare with a live Entra tenant. M5 adds deterministic
outbound Entra-shaped SCIM planning and delivery. Exact public revision
`ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` passed its full local gate, hosted CI,
and source-paired manual staging/production controlled-target acceptance. Each hosted
run completed its Entra-shaped four-request flow and cleanup. That is deployed mock
acceptance for the tested M5 slice; it does not qualify guarded promotion workflows,
the broader planner against a real Entra tenant, or verified-live provider parity.

The separate [M6 workers.dev smoke](../evidence/m6-workers-dev-smoke.md) samples
rotation/JWKS overlap, plus-300-second signed-token skew, every explicit broken-token
variant, and the exact path-mode 200/201 group boundary on staging and production. It
does not remotely execute every M6 fixture or source-only cap/concurrency/subdomain
case and is not verified-live Entra ID evidence.

## SDK note

The only qualified SDK is `@azure/msal-node` 5.4.2 in the coordinated
confidential-client authorization-code + S256 PKCE and public-client device-code flows
above. Both require the explicit request-derived authority,
`knownAuthorities: [new URL(authority).host]`, and
`system.protocolMode: ProtocolMode.OIDC`. This local Wrangler proof does not qualify
workers.dev or Cloud deployment behavior.

Do not use `common`, `organizations`, or `consumers` as proof of multi-tenant parity;
deterministic mock tenants are the supported test unit. `@azure/msal-browser`,
client-credential grants, public-client browser helpers, on-behalf-of,
Microsoft Graph SDK calls, and SDKs that require Microsoft-owned hosts or
unimplemented Graph operations remain outside the compatibility claim.
