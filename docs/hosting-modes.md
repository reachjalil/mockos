# Hosting modes

Status: M2 workers.dev path mode deployed; wildcard/subdomain mode remains planned
Last reviewed: 2026-07-22

## Path mode

Path mode is the live workers.dev bootstrap mode. The deployed origins are:

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
- Okta authorization:
  `/e/<env>/oauth2/default/v1/authorize`

The `/e/<env>/scim/v2` route shape is reserved, but SCIM behavior is M3 work and is not
available in the M2 deployment. Protocol endpoints are intentionally reachable test
surfaces once their unguessable environment URL is known; never send the control key
or real identities to those endpoints.

Path mode works without an account-owned zone, but some SDKs assume provider-shaped
hosts. Configure explicit authorities and never infer broad SDK compatibility from a
curl or single-client success. The authenticated MCP, OIDC, scenario, log, assertion,
and cleanup checks recorded for both live origins are in the
[M2 workers.dev smoke evidence](./evidence/m2-workers-dev-smoke.md).

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
