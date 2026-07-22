# Entra ID behavior

Status: M3 Entra source candidate locally tested; deployed evidence remains the bounded M2 authorization-code slice
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

The M3 source candidate also redeems the `refresh_token` grant for an authenticated
client. Refresh tokens are stored hashed and rotate atomically within a family while
preserving the original authentication time and absolute expiry. Scope escalation is
rejected. Replay or concurrent double redemption revokes the family and its associated
tracked access tokens. Disabling or deleting the User through lifecycle policy revokes
effective access and refresh credentials in the same transaction; a later refresh
attempt fails with Entra-shaped `invalid_grant` / `AADSTS50057` behavior. This has
focused core, adapter, and local Worker coverage, not an M3 deployment record.

## Directory source candidate

In path mode an Entra environment exposes these local M3 candidate bases:

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
source-reviewed M3 candidate cases but is not a live capture or a corpus-wide Worker
conformance run. Client credentials, device flow, UserInfo, exact Microsoft UI,
localization, risk policy, Conditional Access, and tenant administration remain outside
the implemented boundary.

The historical [M2 workers.dev smoke](../evidence/m2-workers-dev-smoke.md) verifies the
earlier hosted authorization-code/JWKS scenario. It does not qualify M3 refresh,
lifecycle, SCIM, or Graph behavior and is not a live Entra comparison.

## SDK note

MSAL clients in workers.dev path mode need an explicit authority and may need metadata
overrides depending on the SDK. Do not use `common`, `organizations`, or
`consumers` as proof of full multi-tenant parity; deterministic mock tenants are the
supported test unit. SDKs that require Microsoft-owned hosts or unimplemented Graph
operations remain outside the current compatibility claim.
