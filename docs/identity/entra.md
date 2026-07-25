# Entra ID behavior

Status: Accepted bounded M3/M5 Entra slices and sampled M6 deployment; bounded MSAL Node 5.4.2 local X/Q qualification added
Last reviewed: 2026-07-25

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

The accepted M3 implementation also redeems the `refresh_token` grant for an authenticated
client. Refresh tokens are stored hashed and rotate atomically within a family while
preserving the original authentication time and absolute expiry. Scope escalation is
rejected. Replay or concurrent double redemption revokes the family and its associated
tracked access tokens. Disabling or deleting the User through lifecycle policy revokes
effective access and refresh credentials in the same transaction; a later refresh
attempt fails with Entra-shaped `invalid_grant` / `AADSTS50057` behavior. This has
focused core, adapter, and Worker coverage, and the M3 deployed smoke sampled the
rotation/lifecycle path.

## Pinned MSAL Node client boundary

The current source candidate qualifies one official-client slice through a real local
HTTPS socket: `@azure/msal-node` 5.4.2 runs as a confidential client against a
tenant-specific mockOS custom authority. The official MCP SDK 1.29.0 first creates,
seeds, configures, observes, and deletes the disposable environment. MSAL then drives
authorization URL construction, authorization-code redemption with S256 PKCE, and
`acquireTokenSilent({ forceRefresh: true })`. After MCP lifecycle disable, another
forced refresh surfaces `invalid_grant` with `AADSTS50057`.

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

The exact provider sequence—discovery, login GET/POST, successful code redemption,
successful forced refresh, and rejected post-disable forced refresh—is asserted from
the durable request log. The same tranche closes a credential-evidence gap by redacting
OAuth passwords, client secrets, authorization codes, PKCE verifiers, token response
fields, and redirect `Location` query/fragment secrets before persistence.

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
previous schema-v5 JWKS query keep publishing the overlap key without an unsafe migration.
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

The [OIDC fixture corpus](../../packages/testkit/fixtures/entra/oidc) records additional
documented behavior, including client credentials, device flow, UserInfo, and selected
AADSTS cases, plus eight implemented M6 token-edge fixtures executed through an
authenticated [Worker fixture runner](../../apps/worker/test/token-fixtures.integration.test.ts).
A fixture's own status controls its evidence level; a documented case is not promoted
by adjacency to an implemented case. The separate [SCIM corpus](../../packages/testkit/fixtures/entra/scim) contains
source-reviewed source-implemented cases but is not a live capture or a corpus-wide Worker
conformance run. Client credentials, device flow, UserInfo, exact Microsoft UI,
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

The only qualified SDK is `@azure/msal-node` 5.4.2 in the confidential-client,
authorization-code + S256 PKCE, forced-refresh flow above. It requires the explicit
request-derived authority, `knownAuthorities: [new URL(authority).host]`, and
`system.protocolMode: ProtocolMode.OIDC`. This local Wrangler proof does not qualify
workers.dev or Cloud deployment behavior.

Do not use `common`, `organizations`, or `consumers` as proof of multi-tenant parity;
deterministic mock tenants are the supported test unit. `@azure/msal-browser`, device
and client-credential grants, public-client interactive helpers, on-behalf-of,
Microsoft Graph SDK calls, and SDKs that require Microsoft-owned hosts or
unimplemented Graph operations remain outside the compatibility claim.
