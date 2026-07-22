# M6 workers.dev deployment and sampled acceptance

Status: Passed on staging and production for the exact M6 candidate; verified-live parity remains open
Last reviewed: 2026-07-22

This record binds the bounded M6 runtime to two exact Cloudflare Worker versions and
the source-locked smoke runs that exercised them. It is deployed mock evidence for the
sampled M6 behavior, not a corpus-wide fixture run, qualification of the guarded
Cloudflare-credential deployment workflow, or comparison with a real Microsoft Entra
ID tenant or Okta organization.

## Immutable candidate

| Item | Evidence |
| --- | --- |
| Candidate commit | `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da` |
| Hosted CI | [CI run 29966667984](https://github.com/reachjalil/mockos/actions/runs/29966667984) passed for the exact candidate |
| Local full gate | The repository-wide `pnpm check` passed before deployment |
| Deployment method | Manual, staging before production, using the authenticated local Wrangler OAuth session |

The Cloudflare version tags recorded during both deploys tie the candidate commit and
CI run to the resulting versions. The operator captured `wrangler` deployment status
before and after each rollout and confirmed that the candidate version received 100%
of traffic. The source-locked smoke workflow then validated the candidate's successful
push CI and checked the expected Cloudflare version metadata through `/health` before
and after its acceptance sequence. Together, the caller's Wrangler status and the
workflow's two serving-version probes provide the source, version, and 100%-traffic
provenance for this record.

## Deployments and smoke

| Target | Origin | Previous version | Accepted version | Traffic | Acceptance run |
| --- | --- | --- | --- | --- | --- |
| Staging | `https://mockos-staging.workspaceagent.workers.dev` | `6ac288f9-08e4-4f80-9e3b-12a82cdda4a9` | `9ea22805-e38e-4a1b-807f-f80646cbe298` | 100% | [Run 29966810455](https://github.com/reachjalil/mockos/actions/runs/29966810455), green |
| Production | `https://mockos.workspaceagent.workers.dev` | `53690750-cef2-4553-8bbe-2592b2139781` | `0695adab-d162-4f01-a3cf-da9c1640acdc` | 100% | [Run 29966918427](https://github.com/reachjalil/mockos/actions/runs/29966918427), green |

Staging passed before production was changed. The existing `API_KEY` secrets remained
in place; neither secret was created, printed, or rotated by this rollout. Both targets
remained on the accepted version after their final status check, so no rollback was
required.

## Sampled M6 acceptance

The deployed smoke exercised all six bounded M6 slices while retaining the accepted M3
regression sequence:

| Slice | Observed result |
| --- | --- |
| Signing-key rotation and JWKS overlap | Fetched the active plus pre-published successor keys, rotated during the authorization flow, verified the new token against both fresh and stale pre-rotation JWKS, verified the pre-rotation token during overlap, and observed the promoted successor plus bounded old/new key publication |
| Claim-only clock skew | Consumed a one-shot plus-300-second `token.before_sign` scenario, verified the actual signed JWT, and confirmed only temporal claims moved while lifetime and identity claims remained stable |
| Broken tokens | Minted and inspected the five explicit variants: `expired`, exact wrong audience, `not_yet_valid`, `bad_signature`, and exact wrong issuer; only the signature mutation failed signature verification |
| Entra group overage | Verified an actual signed token with exactly 200 inline group IDs, added membership 201, verified claim-source metadata instead of an inline `groups` claim, and resolved the exact 201 IDs through the trusted same-environment path-mode Graph endpoint |
| Deterministic SCIM edges | Proved an injected uniqueness `409` without partial User mutation, strict rejection followed by the exact missing-`schemas` and singleton-`Operations` repairs, and a soft-delete race that returned `404`, hid the raced Group from reads, and denied replay |
| Okta Classic Authn and redaction | Exercised generic invalid-credential privacy plus `MFA_REQUIRED`, state-token retrieval, `PASSWORD_EXPIRED`, explicit `LOCKED_OUT`, and `SUCCESS`; checked same-origin preflight and cross-origin denial, the singular `_embedded.factor` response shape, no-store behavior, exact credential-header redaction, flat secret-field redaction, and retention of safe log evidence |

The regression portion also checked health, authenticated MCP initialization and tool
discovery, isolated Entra and Okta environments, both provider SCIM discovery/PATCH
shapes, an Entra Graph User read, direct and hosted-PKCE token issuance, refresh
rotation, deterministic Entra and Okta errors, the Entra lifecycle cascade, synchronous
request logging/assertion, reverse cleanup, orphan discovery, empty catalogs, and the
final serving-version probe.

## Qualification boundary

- The smoke sampled the six M6 slices through deployed Workers; it did not execute all
  21 generated M6 evidence cases as a remote fixture corpus, all 113 SCIM fixtures, or
  every local concurrency, retention, cap, and denial test.
- The version-tagged manual OAuth rollout and the source-locked smoke workflow do not
  execute or qualify the separate guarded Cloudflare-credential deployment workflow.
- This is functional deployed mock evidence, not a penetration test, encryption-at-rest
  qualification, broad SDK compatibility result, production SLA, or custom-domain
  acceptance.
- Every identity, credential, password, and token used by the smoke was synthetic. No
  real Entra ID tenant or Okta organization was contacted, so verified-live parity
  remains open.
