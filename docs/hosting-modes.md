# Hosting modes

Status: Design plus configuration scaffolding; no live host is claimed  
Last reviewed: 2026-07-22

## Path mode

Path mode is the workers.dev bootstrap mode. Target examples are:

- Entra: `/e/<env>/<tenant-guid>/v2.0/.well-known/openid-configuration`
- Okta: `/e/<env>/oauth2/default/v1/authorize`
- SCIM: `/e/<env>/scim/v2/Users`
- MCP: `/mcp`

This mode works without an account-owned zone, but some SDKs assume provider-shaped
hosts. Configure explicit authorities and never claim broad SDK compatibility from curl
success alone.

## Subdomain mode

After domain purchase, the target is an account-owned wildcard identity route. Entra
uses a login host with tenant paths; Okta environments use provider-shaped bare
organization subdomains. Tenant/environment lookup can use a KV index, but the
environment remains the source of identity data in its Durable Object.

The critical invariant is that stored state contains no absolute issuer URL. Cutover
must be only host resolution, routes, variables, certificates, and index backfill—not a
data rewrite.

Subdomain routing can be unit tested today with fake Host headers. Live TLS, wildcard
routing, and SDK compatibility are blocked until the domain and Cloudflare resources
exist.

