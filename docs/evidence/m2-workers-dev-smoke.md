# M2 workers.dev deployment and smoke

Status: Passed on staging and production; hosted CI green
Last reviewed: 2026-07-22

This record closes the M2 deployment gate for the public Worker runtime. It proves
the mockOS implementation against two live Cloudflare `workers.dev` targets with
synthetic identities and applications. It is not Microsoft Entra ID or Okta
live-provider parity evidence.

## Immutable candidate

| Item | Evidence |
| --- | --- |
| Candidate commit | `358045b03161280bb3312e918130d148341104cf` |
| Worktree before deployment | Clean; candidate matched `origin/main` |
| Hosted CI | [CI run 29881568591](https://github.com/reachjalil/mockos/actions/runs/29881568591) passed |
| Local full gate | `pnpm check` passed before the candidate was deployed |
| Local runtime | Node `v26.4.0`, pnpm `10.30.2`, Wrangler `4.112.0`, CLI `0.1.0` |
| CI runtime | Node `24.11.1`, pnpm `10.30.2` |
| Durable Object migrations | `v1-environment`, `v2-mcp-control` |

The first hosted run found that the Worker integration corpus could exceed
Vitest's unit-test-oriented five-second default on a cold Linux runner. The
candidate adds a bounded 15-second integration timeout; the replacement run is
green. No Worker runtime behavior changed in that CI-only correction.

## Deployments

| Target | Origin | Version ID | Created (UTC) |
| --- | --- | --- | --- |
| Staging | `https://mockos-staging.workspaceagent.workers.dev` | `05467231-f965-4a19-b882-66e82912a911` | `2026-07-22T00:54:11.198018Z` |
| Production | `https://mockos.workspaceagent.workers.dev` | `8b077c46-3f74-4bd2-803a-65431e1adba1` | `2026-07-22T00:55:03.505305Z` |

Both targets were deployed manually from the candidate with the authenticated
Wrangler session, staging first and production second. The repository deployment
workflow is configured with step-scoped secrets and candidate/version recording,
but [its run for this candidate](https://github.com/reachjalil/mockos/actions/runs/29881613905)
was skipped by the explicit deployment opt-in gate and is not claimed as
execution-qualified.

## Acceptance sequence

The same `scripts/smoke-worker.sh` sequence ran against staging and then production
with the normal 30-second request timeout. Each target passed:

| Step | Observed result |
| --- | --- |
| Health and control authentication | `/health` returned 200; authenticated MCP initialized; tool discovery succeeded and the 10 tools required by this smoke were advertised |
| MCP transport fallback | Optional standalone GET stream returned 405; the official SDK continued over request-bound POST responses |
| Environment lifecycle | Created an isolated Entra environment, seeded one synthetic user, and registered one OAuth client |
| Discovery | MCP well-known URLs and live OIDC discovery agreed on issuer and endpoints |
| Direct mint | `mint_token` returned a compact JWT whose RS256 signature and `iss`, `aud`, `tid`, and `oid` claims verified against live JWKS |
| Hosted authorization | Hosted login and S256 PKCE authorization-code exchange completed; the ID token signature and expected identity claims verified against the same JWKS |
| Deterministic failure | A one-shot `MFA_REQUIRED` scenario produced Entra-shaped HTTP 400 with `interaction_required`, error code `50076`, and `AADSTS50076` |
| Synchronous evidence | `get_request_log` returned exactly the injected token request and `assert_requests` passed an exact-count assertion |
| Cleanup | Scenario cleared and environment deleted; the client attempted its normal authenticated DELETE session close. Separate authenticated post-smoke `env list` checks returned empty catalogs for both targets |

The staging smoke completed in about five seconds and the production smoke in about
six seconds. No retry or increased timeout was needed.

## Security and rollback boundary

- API keys were supplied from owner-readable local profiles and were never printed.
- The evidence record excludes API keys, Cloudflare account identifiers, JWT values,
  client secrets, synthetic passwords, and captured request or response bodies.
- Management credentials are removed before MCP Agent dispatch. A matching control
  credential accidentally sent to a provider route is redacted from the bounded
  request log.
- The immediately previous Worker versions were staging
  `c3b6e0b8-a0cd-4b0e-bd9a-813f6853904f` and production
  `f88d96f7-6076-4e18-888b-207a05530098`. Cloudflare version rollback remains the
  code/config rollback boundary; the additive Durable Object migrations are not
  reversed. No rollback was required.
