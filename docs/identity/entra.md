# Entra ID behavior

Status: M1 authorization-code vertical slice implemented and tested  
Last reviewed: 2026-07-22

mockOS models a tenant-specific Microsoft identity platform authority. In path hosting,
the target authority is:

`https://<worker>/e/<environment>/<tenant-guid>/v2.0`

The implementation must derive absolute discovery, issuer, redirect, and JWKS URLs from
the current request. It must persist the tenant and relative identity state, never an
absolute issuer.

## Implemented M1 fidelity boundary

The first vertical slice implements discovery, authorization code + PKCE S256, a hosted
sign-in form, token redemption, an RS256 ID token, and JWKS verification. Expected
claims include `aud`, `iss`, `iat`, `exp`, `nonce`, `oid`, `sub`, `tid`,
and a configured username claim. The [Worker integration test](../../apps/worker/test/oidc.integration.test.ts)
drives the full hosted-login flow and verifies the minted ID token from JWKS.

The [fixture corpus](../../packages/testkit/fixtures/entra/oidc) records additional
documented behavior, including refresh, client credentials, device flow, UserInfo, and
selected AADSTS cases. Those files remain `documented` until an automated engine
executor passes them. Exact Microsoft UI, localization, risk policy, Conditional
Access, and tenant administration are outside the current slice.

## SDK note

MSAL clients in workers.dev path mode need an explicit authority and may need metadata
overrides depending on the SDK. Do not use `common`, `organizations`, or
`consumers` as proof of full multi-tenant parity; deterministic mock tenants are the
supported test unit.
