# M5 deployment and provisioning acceptance

Status: Manually accepted for the exact M5 source pair; guarded deployment workflows remain unqualified
Last reviewed: 2026-07-22

This record separates three facts that must not be collapsed into one claim:

1. public runtime commit `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`
   passed [CI run 29957994237](https://github.com/reachjalil/mockos/actions/runs/29957994237);
2. that public Worker source was manually deployed to the isolated staging and
   production workers.dev targets; and
3. the controlled-target provisioning acceptance ran through the separately operated
   hosted composition consuming that exact public commit.

The rollout was source-locked and staging preceded production. It was not an execution
of either repository's guarded GitHub deployment workflow, so it does not qualify the
workflow artifact chain, protected production approval, or formal promotion path.

## Exact source and CI

| Field | Verified value |
| --- | --- |
| Public runtime/deployed source | `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` |
| Public CI | Run `29957994237`, green |
| Initial private hosted runtime source | `5edb41603353ae4665fffe2d53807ec6ffc4cec0` |
| Private verifier follow-up/current source | `d27a54970a7b257b1712e2d4fe1357d775ca510a` |
| Private CI | Runs `29959351824` and `29960074468`, green |

All four Worker bundle artifacts from the verifier follow-up were byte-for-byte
identical to the corresponding initial-runtime artifacts. This preserves runtime
identity while recording the corrected exact-instance verification source separately.

## Active Worker versions

All six versions below were confirmed 100% active after rollout.

| Target | Worker | Active version | Active deployment | Captured at |
| --- | --- | --- | --- | --- |
| Staging | Hosted control | `39066b53-10c6-4822-9194-775a8d6bca8f` | `332ab217-4421-4eb1-a807-7bdcf52c318c` | `2026-07-22T21:34:58.137228Z` |
| Staging | Hosted edge | `0be76987-d1c5-4495-918a-33e7501f10cd` | `b9c04b33-5e7c-44e5-b712-047e5793ae88` | `2026-07-22T21:35:25.684266Z` |
| Staging | Public self-hosted Worker | `6ac288f9-08e4-4f80-9e3b-12a82cdda4a9` | `f7142b5c-2923-4a2a-b211-0799abdda17f` | `2026-07-22T21:35:55.415478Z` |
| Production | Hosted control | `64a08dd0-dcb4-4348-b93f-d12cfe14e757` | `762044b3-ad95-4a18-92d7-531ec8fcc170` | `2026-07-22T21:44:00.366803Z` |
| Production | Hosted edge | `2bcd5aa2-fb61-48cf-9760-a75275fd92a3` | `daaf47d4-f733-49f5-afac-1dd4e0015e4a` | `2026-07-22T21:44:27.175781Z` |
| Production | Public self-hosted Worker | `53690750-cef2-4553-8bbe-2592b2139781` | `cff34241-e3d7-4683-aa5b-710fb3263d0e` | `2026-07-22T21:44:55.684713Z` |

The existing public staging and production `API_KEY` secrets were preserved and were
not rotated. The public self-hosted Workers were version/health verified, but the
authenticated four-request provisioning acceptance below used the hosted edge rather
than those pre-existing standalone credentials.

## Controlled-target provisioning acceptance

| Target | Run | Workflow | Workflow version | Platform result | Runtime result | Timing | Matched requests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Staging | `run_b38cf88618604f70854e7fc607273266` | `mockos-cloud-provisioning-staging` | `1fc1386e-9d0d-4c1e-b62d-828a97d801e8` | `complete` / success; final step `complete-1` | `succeeded` | `2026-07-22T21:37:27.541Z`–`2026-07-22T21:37:28.065Z` | 4 |
| Production | `run_17fb728538e44d42aede3fae16048197` | `mockos-cloud-provisioning` | `7e0ec87a-e163-478d-9dfa-6029f8d602af` | `complete` / success; final step `complete-1` | `succeeded` | `2026-07-22T21:46:15.928Z`–`2026-07-22T21:46:16.362Z` | 4 |

Each target also passed the existing M4 identity/session smoke and reverse cleanup.
The disposable target app ran at version
`250314b9-5394-4ad5-ad42-4edc71a956ca`. Its state and request capture were empty after
both runs; the Worker was then deleted, its endpoint returned `404`, and its synthetic
credentials were not retained. Existing private Better Auth secrets were preserved
and were not rotated.

## Acceptance boundary

This evidence accepts the tested M5 outbound-provisioning slice for the exact source
pair: hosted admission, Workflow execution, four controlled HTTPS target requests,
terminal run verification, and cleanup. It does not claim live Entra/Okta parity,
recurring scheduling, public npm availability, an authenticated provisioning run on
the standalone public Worker credentials, or qualification of the guarded GitHub
promotion workflows.
