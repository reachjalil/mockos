# Entra ID behavior

Status: Accepted bounded M3 Entra implementation with hosted-CI and deployed samples; live-provider parity is not claimed
Last reviewed: 2026-07-22

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

## Directory surface

In path mode an Entra environment exposes these accepted M3 bases:

- `/e/<environment>/scim/v2` for SCIM discovery and versioned User/Group CRUD,
  filtering, pagination, PATCH, and ETags;
- `/e/<environment>/graph/v1.0` for bounded read-only Users, Groups, direct group
  membership, exact supported-property `eq` filters, projection, and cursor pages.

Entra lifecycle policy supports activate, disable, reactivate, and delete. Deletion
also removes the User from Groups and increments affected Group versions. SCIM and
Graph require a non-empty synthetic Bearer value for protocol testing. That check does
not validate a Microsoft access token, and the MCP/control Access Key must never be
used as the directory credential.

The [OIDC fixture corpus](../../packages/testkit/fixtures/entra/oidc) records additional
documented behavior, including client credentials, device flow, UserInfo, and selected
AADSTS cases. Those files remain `documented` until an automated engine executor passes
them. The separate [SCIM corpus](../../packages/testkit/fixtures/entra/scim) contains
source-reviewed source-implemented cases but is not a live capture or a corpus-wide Worker
conformance run. Client credentials, device flow, UserInfo, exact Microsoft UI,
localization, risk policy, Conditional Access, and tenant administration remain outside
the implemented boundary.

The [M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) verifies a bounded
hosted authorization-code/JWKS, refresh/lifecycle, SCIM, and Graph sample. It does not
run the entire fixture corpus or compare with a live Entra tenant. M5 adds an outbound
Entra provisioning source candidate whose Worker/full local gates and two-process
Entra-shaped target flow are green; immutable-revision, hosted, deployed, and
live-provider gates remain pending.

## SDK note

MSAL clients in workers.dev path mode need an explicit authority and may need metadata
overrides depending on the SDK. Do not use `common`, `organizations`, or
`consumers` as proof of full multi-tenant parity; deterministic mock tenants are the
supported test unit. SDKs that require Microsoft-owned hosts or unimplemented Graph
operations remain outside the current compatibility claim.
