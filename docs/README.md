<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: M0-M3 accepted; tested M5 and bounded M6 deployment evidence retained; bounded MSAL Node and Okta Auth JS local X/Q qualifications added
Last reviewed: 2026-07-26

mockOS is an open-core, deterministic identity-platform test double for Entra ID and
Okta integrations. The public repository is intended to contain the provider engine,
self-hostable Cloudflare Worker, conformance fixtures, MCP tools, and test skill.

The documentation keeps eight evidence levels separate:

| Code | Level | What it establishes |
| --- | --- | --- |
| D | Designed | A reviewed target, fixture, or contract exists. Runtime behavior is not implied. |
| I | Implemented | Executable code exists. Test execution is not implied. |
| S | Source-tested | Named focused or full local tests pass against the source candidate. |
| X | Integration-tested | Named composed-runtime or actual-network tests pass at the stated boundary. |
| Q | SDK/client-qualified | A pinned official client passes the exact stated flow. |
| H | Hosted-smoke | An exact remote serving version passes a recorded mockOS smoke. |
| V | Verified-live | Sanitized, independently reviewed evidence compares the case with a real provider. |
| P | Production-ready | Distribution, operations, security, rollback, support, and release gates for the stated product claim are complete. |

The levels do not substitute for one another. A local official-SDK run can establish X
and Q without H; a raw workers.dev smoke can establish H without Q; neither is V or P.
Hosted CI is source execution, not H, unless it drives and identifies an exact deployed
serving version. No current fixture or milestone is V or P.

M0-M3 have accepted evidence. M3 adds path-mode inbound SCIM for Entra and Okta
environments, bounded Microsoft Graph reads, bounded Okta Users/Groups and lifecycle
routes, rotating refresh-token families with lifecycle cascade, and a 14-tool MCP
registry plus the source CLI's `lifecycle simulate` command. Focused Worker
integrations, all 113 SCIM fixtures, and the full repository gate execute green
locally and in hosted CI. The same exact revision passed the expanded deployed smoke
at staging and production, including reverse cleanup and final empty-catalog checks.
This qualifies the tested mockOS runtime, not parity with a live Entra tenant or Okta
organization.

M5 adds a fifteenth MCP tool,
`run_provisioning_cycle`, deterministic Entra/Okta outbound SCIM planning, a
Cloudflare Workflow runtime, SSRF and bounded-HTTP controls, environment-isolated
target credentials, ordered request-sequence assertions, a source CLI command, and a
local target-app example. The Worker and worker-kit suites, full `pnpm check`, and a
fresh two-process `wrangler dev` provisioning e2e are green; see the
[local M5 source record](./evidence/m5-local-source-qualification.md). Exact public
revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93` also passed hosted CI, manual
staging-before-production rollout, and source-paired hosted Workflow acceptance; see
the [M5 deployment record](./evidence/m5-workers-dev-smoke.md). The guarded GitHub
promotion workflows were not executed or formally qualified. This is deployed mock
acceptance for the tested source pair, not verified-live Entra ID or Okta evidence.

The bounded M6 slice is accepted at public revision
`a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`. The full local gate and
[CI run 29966667984](https://github.com/reachjalil/mockos/actions/runs/29966667984)
are green; exact versions on staging and production then passed the
[source-locked M6 workers.dev smoke](./evidence/m6-workers-dev-smoke.md). That smoke
sampled all six M6 slices plus accepted regressions. It is deployed mock evidence, not
a remote run of every generated case or fixture, qualification of the guarded
Cloudflare-credential deployment workflow, or verified-live provider evidence.

The current source carries two bounded official-client qualifications over the same
owned local Wrangler HTTPS and focused signal-cleanup harnesses:

- `@azure/msal-node` 5.4.2 uses a custom Entra authority as a confidential client for
  authorization code with S256 PKCE, forced refresh, lifecycle disable, exact request
  assertion, and durable credential-redaction checks. Read the
  [MSAL Node quickstart](./quickstarts/entra-msal-node.md) and
  [local record](./evidence/entra-msal-node-local-qualification.md).
- `@okta/okta-auth-js` 8.0.1 uses an Okta custom authorization server as a public
  client for `getWithRedirect`, S256 PKCE, `parseFromUrl` code exchange and JWKS
  ID-token verification, refresh rotation, owner-bound public revocation, lifecycle
  suspend, exact request assertion, and durable credential/token-redaction checks.
  Read the [Okta Auth JS quickstart](./quickstarts/okta-auth-js-node.md) and
  [local record](./evidence/okta-auth-js-local-qualification.md).

Both use `@modelcontextprotocol/sdk` 1.29.0 for setup, observation, lifecycle, and
cleanup. Each is D/I/S/X/Q evidence only; neither has H, V, or P evidence.

The public source remains independently self-hostable. The later public docs-only close
commit `e446eeda357b5e765401b97b892128fd70ac9ab8` was consumed by the separately
qualified private M4 composition, but that private acceptance is not M5 evidence and
does not add a private runtime dependency to this repository.

Start with [implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md). Do not infer support from a route, type, or
fixture alone.

## Reference map

- [Requirements traceability](./requirements-traceability.md)
- [F-series execution roadmap](./F_SERIES_ROADMAP.md)
- [Provider parity matrix](./conformance/parity-matrix.md)
- [Generated M6 executable-evidence matrix](./conformance/m6-generated-parity.md)
- [M1 Wrangler dev smoke evidence](./evidence/m1-wrangler-dev-smoke.md)
- [M2 staging and production workers.dev smoke evidence](./evidence/m2-workers-dev-smoke.md)
- [M2 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591)
- [M3 staging and production workers.dev smoke evidence](./evidence/m3-workers-dev-smoke.md)
- [M3 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29886610480)
- [M5 local source qualification](./evidence/m5-local-source-qualification.md)
- [M5 deployment and hosted provisioning acceptance](./evidence/m5-workers-dev-smoke.md)
- [M6 staging and production workers.dev sampled acceptance](./evidence/m6-workers-dev-smoke.md)
- [Entra MSAL Node local X/Q qualification](./evidence/entra-msal-node-local-qualification.md)
- [Okta Auth JS local X/Q qualification](./evidence/okta-auth-js-local-qualification.md)
- Identity notes: [Entra ID](./identity/entra.md), [Okta](./identity/okta.md),
  [SCIM](./identity/scim.md)
- Security: [threat model](./security/threat-model.md) and
  [outbound provisioning](./security/outbound-provisioning.md)
- [Hosting modes](./hosting-modes.md)
- Quickstarts: [curl probe](./quickstarts/curl.md),
  [Entra SSO](./quickstarts/entra-sso.md),
  [Entra with MSAL Node](./quickstarts/entra-msal-node.md),
  [Okta with Okta Auth JS](./quickstarts/okta-auth-js-node.md), and
  [provisioning cycle](./quickstarts/provisioning-cycle.md)
- Agent interfaces: [MCP](./mcp.md) and [testing skill](./skill.md)
- [Source-built CLI](../packages/cli/README.md)
- [Self-hosting](./self-hosting.md)
- [Brand and asset usage](./brand.md)
