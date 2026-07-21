# M1 Wrangler dev smoke

Status: Passed locally; no deployed Worker is claimed
Last reviewed: 2026-07-22

The M1 curl sequence was run against Wrangler 4.112.0 at
`http://127.0.0.1:8787` with synthetic credentials and an ephemeral local SQLite
Durable Object. No production identity or secret was used.

| Step | Observed result |
| --- | --- |
| Configure environment | `PUT /__mockos/v1/environments/oidc-curl-01` → 200 |
| Seed user | `POST .../identities:seed` → 200 |
| Register OAuth client | `POST .../applications` → 201 |
| Read discovery | Tenant-scoped discovery → 200; request-derived issuer matched |
| Render hosted login | Authorize GET → 200; form action retained `/e/{env}` path prefix |
| Submit credentials | Authorize POST → 302; callback state and one-time code present |
| Redeem S256 code | Token POST → 200 |
| Verify token | RS256 signature verified against fetched JWKS; `iss`, `aud`, `tid`, `upn`, and `nonce` matched |
| Purge environment | Authenticated DELETE → 204 |

This is local runtime evidence, not a workers.dev deployment, live-provider
interoperability capture, or M2 MCP/scenario smoke.
