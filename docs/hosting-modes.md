# Hosting modes

Status: M2 workers.dev path mode deployed; M3 path routes are a local source candidate and wildcard/subdomain mode remains planned
Last reviewed: 2026-07-22

## Path mode

Path mode is the workers.dev bootstrap mode. The recorded deployed origins are:

- staging: `https://mockos-staging.workspaceagent.workers.dev`
- production: `https://mockos.workspaceagent.workers.dev`

Each origin exposes an unauthenticated `/health` probe and an authenticated `/mcp`
control endpoint. MCP and `/__mockos/v1/*` control requests require the deployment's
`API_KEY`; the Worker returns `503` when the secret is absent and `401` when the
presented Bearer or `X-API-Key` credential is wrong. Keys are operator-provided and are
not stored in this repository.

Provider traffic is routed beneath an environment segment. Current examples are:

- Entra discovery:
  `/e/<env>/<tenant-guid>/v2.0/.well-known/openid-configuration`
- Entra Microsoft Graph reads:
  `/e/<env>/graph/v1.0/users`
- Okta authorization:
  `/e/<env>/oauth2/default/v1/authorize`
- Okta directory Users/Groups and lifecycle:
  `/e/<env>/api/v1/users`
- Entra- or Okta-profile SCIM:
  `/e/<env>/scim/v2/Users`

The Graph, Okta directory, and SCIM paths are M3 source-candidate surfaces with focused
local tests. They are not established by the M2 workers.dev deployment record. SCIM
uses the environment's provider profile, so the same path exposes Entra or Okta PATCH
and lifecycle semantics rather than a third provider.

Protocol endpoints are intentionally reachable test surfaces once their unguessable
environment URL is known. OIDC/OAuth uses registered synthetic clients; SCIM and Graph
accept a non-empty synthetic Bearer value, while the Okta directory API accepts a
non-empty synthetic SSWS value. Those directory checks validate scheme and presence,
not a real provider token. Never send the MCP/control Access Key, real identities, or
production credentials to these endpoints.

Path mode works without an account-owned zone, but some SDKs assume provider-shaped
hosts. Configure explicit authorities and never infer broad SDK compatibility from a
curl or single-client success. The authenticated MCP, OIDC, scenario, log, assertion,
and cleanup checks recorded for both live origins are in the
[M2 workers.dev smoke evidence](./evidence/m2-workers-dev-smoke.md).

Path mode does not imply broad provider API coverage. Microsoft Graph is read-only,
Okta Classic `/api/v1/authn` and both UserInfo routes are absent, and outbound SCIM
provisioning remains a later milestone. See [known limitations](./known-limitations.md).

## Subdomain mode

After domain purchase, the target is an account-owned wildcard identity route. Entra
uses a login host with tenant paths; Okta environments use provider-shaped bare
organization subdomains. Tenant/environment lookup can use a KV index, but the
environment remains the source of identity data in its Durable Object.

The critical invariant is that stored state contains no absolute issuer URL. Cutover
must be only host resolution, routes, variables, certificates, and index backfill—not a
data rewrite.

Subdomain routing can be unit tested today with fake Host headers. Live TLS, wildcard
routing, and SDK compatibility remain M8 work, blocked until the domain and Cloudflare
resources exist.
