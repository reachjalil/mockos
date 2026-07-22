# M3 workers.dev deployment and smoke

Status: Passed on staging and production; hosted CI green
Last reviewed: 2026-07-22

This record closes the M3 deployment gate for the public Worker runtime. It proves
the accepted mockOS M3 slice against two live Cloudflare `workers.dev` targets with
synthetic identities, applications, and protocol credentials. It is not Microsoft
Entra ID or Okta live-provider parity evidence.

## Immutable candidate

| Item | Evidence |
| --- | --- |
| Candidate commit | `8645f405d5e3b922c30d51339b8b27f9fe30d93e` |
| Hosted CI | [CI run 29886610480](https://github.com/reachjalil/mockos/actions/runs/29886610480) passed for the exact candidate |
| Local full gate | The repository-wide M3 `pnpm check` passed before deployment qualification |
| Durable Object migrations | `v1-environment`, `v2-mcp-control`; the M3 directory and refresh-family schema is an additive in-object migration |

The functional M3 change first reached commit
`13054f6e0739e84b51b5c315f1e41bfca1b2ac5e`. Its hosted secret scan correctly
stopped on literal synthetic protocol credentials in the curl documentation. The
accepted candidate adds a rule-, path-, and pattern-scoped Gitleaks allowlist for
those known placeholders. The replacement CI run is green; no Worker runtime
behavior changed in that CI-only follow-up.

## Deployments

| Target | Origin | Deployment ID | Version ID | Created (UTC) |
| --- | --- | --- | --- | --- |
| Staging | `https://mockos-staging.workspaceagent.workers.dev` | `1cb63e8f-db1a-437e-91f2-14def56cb013` | `75a782c3-c61d-4558-87ed-34b3054e3e2f` | `2026-07-22T02:53:54.072600Z` |
| Production | `https://mockos.workspaceagent.workers.dev` | `2e192819-334f-4821-a623-e36a2691dfce` | `8392519b-e75c-47b1-81aa-a846021155c3` | `2026-07-22T02:54:38.915686Z` |

Both targets received 100% of their final version. They were deployed manually from
the exact candidate with the authenticated Wrangler session, staging first and
production second. The repository deployment workflow remained behind its explicit
opt-in gate; [its run for this candidate](https://github.com/reachjalil/mockos/actions/runs/29886659744)
was skipped and is not claimed as execution-qualified.

## Acceptance sequence

The expanded `scripts/smoke-worker.mjs` sequence ran to clean completion against
staging and then production. Each target passed:

| Step | Observed result |
| --- | --- |
| Health and control authentication | `/health` returned 200; authenticated MCP initialized; tool discovery advertised every tool required by the M3 smoke, including `simulate_lifecycle` |
| Isolated environments | Created and seeded separate Entra and Okta environments, each with a synthetic User and Group; the Entra environment also received an OAuth application with authorization-code and refresh grants |
| Inbound SCIM | Entra and Okta ServiceProviderConfig discovery advertised PATCH and filter support; Group PATCH returned the configured provider status (`204` for Entra and `200` for Okta), returned an ETag, and persisted the renamed Group |
| Microsoft Graph read | A bounded Entra User projection returned the seeded identifier, principal name, and enabled state |
| OIDC discovery and direct mint | MCP well-known URLs matched live discovery; direct mint produced a compact JWT whose RS256 signature and `iss`, `aud`, `tid`, and `oid` claims verified against live JWKS |
| Hosted authorization | Hosted login and S256 PKCE authorization-code exchange completed; the ID-token signature and nonce/identity claims verified against the same JWKS |
| Refresh rotation | The Entra refresh grant replaced the original token, preserved the narrowed scope, and returned an ID token whose signature and identity claims verified |
| Deterministic Entra failure | A one-shot `MFA_REQUIRED` scenario returned Entra-shaped HTTP 400 with `interaction_required`, error code `50076`, and `AADSTS50076`; synchronous log query and exact-count assertion passed |
| Lifecycle cascade | `simulate_lifecycle` disabled the Entra User, advanced its version, and reported access- and refresh-token revocation; the rotated refresh token then failed with `invalid_grant`, error code `50057`, and `AADSTS50057`, and its request-log assertion passed |
| Okta directory and failure shape | A bounded Okta User read returned the seeded active identity; a one-shot `okta.api` scenario returned HTTP 429 with `E0000047` and an Okta request identifier |
| Cleanup | Scenarios were cleared; the Okta and Entra environments were deleted in reverse creation order; smoke-side catalog verification passed, and final authenticated catalog checks returned empty on both targets |

The remote sequence is a focused deployed acceptance sample. The 113-case SCIM
corpus and broader adapter matrices remain local and hosted-CI evidence; this record
does not claim that every fixture ran through either deployed Worker.

## Security, rollback, and qualification boundary

- Management and protocol credentials were supplied out of band and were never
  printed. The record excludes API keys, Cloudflare account identifiers, tokens,
  client secrets, passwords, and captured request or response bodies.
- The staging and production runtime keys were bound atomically and retained only as
  masked GitHub Actions secrets. Repository variables point at the two recorded
  origins and keep `MOCKOS_WORKER_DEPLOY_ENABLED=false`.
- All identities and provider credentials used by the smoke were synthetic. No real
  Entra tenant or Okta organization was contacted.
- The immediately previous accepted versions were staging
  `05467231-f965-4a19-b882-66e82912a911` and production
  `8b077c46-3f74-4bd2-803a-65431e1adba1`. Cloudflare version rollback remains the
  code/config rollback boundary; additive Durable Object state migrations are not
  reversed. No rollback was required.
- These `workers.dev` targets are qualification surfaces without a custom-domain,
  uptime, durability, or service-level commitment. Passing this smoke accepts M3's
  tested emulator slice; it does not establish broad API compatibility or
  live-provider parity.
- Automated deployment remains explicitly disabled and lacks a configured Cloudflare
  API token. The manual acceptance above does not qualify that automation path.
