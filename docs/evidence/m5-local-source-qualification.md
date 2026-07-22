# M5 local source qualification

Status: Local source qualification passed; immutable revision, hosted CI, and deployment acceptance remain pending
Last reviewed: 2026-07-22

This record captures the final local evidence for the M5 outbound-provisioning source
candidate. It is intentionally not an acceptance or deployment record: no exact
immutable candidate revision is recorded here yet, and no hosted CI,
staging/production deployment, controlled public-HTTPS target smoke, npm publication,
or live-provider comparison is claimed.

## Repository gate

The full repository command passed after the final credential-boundary patch:

```sh
pnpm check
```

That gate includes formatting, linting, documentation and brand checks, public-boundary
checks, TypeScript, the complete test suite, builds, Wrangler configuration validation,
and production/staging dry runs. The final source run included these focused totals:

- Cloudflare Worker: 23/23 tests passed;
- worker-kit: 79/79 tests passed; and
- CLI: 19/19 tests passed.

An independent adversarial source review found no remaining public-repository blocker.
That review is local source evidence, not a penetration test or a substitute for the
hosted and deployed gates.

## Two-process provisioning gate

A fresh invocation of:

```sh
pnpm e2e:provisioning
```

started mockOS and the Durable Object-backed target app as separate `wrangler dev`
processes. The built CLI connected through authenticated MCP, seeded the environment,
queued the Workflow, asserted the User-before-Group request sequence, verified target
state and credential redaction, and cleaned up. The final result was:

| Field | Result |
| --- | --- |
| Provisioning run | `run_23d7a2bd0b4d4511a59b14ff4b8654ef` |
| Matched ordered requests | 4 |
| Final target users | 1 |
| Final target groups | 1 |
| Cleanup | Environment and target state removed; child processes and listeners clean |

This proves the local two-process service-binding path only. A deployed acceptance run
still requires the exact committed revision, hosted CI, immutable Worker version IDs,
a controlled public-HTTPS target, sanitized evidence, and reverse cleanup at staging
and production.

## Self-hosted Access Key defense

The final source rejects a target Bearer credential that equals the active self-hosted
`API_KEY`, regardless of whether the key has an `mk_` prefix. The CLI compares file- or
stdin-supplied target tokens with the active profile/environment Access Key before an
MCP call. The Worker rejects the same confusion at authenticated MCP ingress, and the
Environment Durable Object rechecks before saving, staging, or using a target.
Comparisons are constant-time with respect to the candidate values. If key rotation
makes an existing saved target credential equal the new `API_KEY`, execution fails
closed before an outbound request or provisioning-step write and does not echo the
credential.
