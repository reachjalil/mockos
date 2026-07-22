<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: M0-M3 accepted; M5 outbound provisioning is locally qualified source with immutable-revision, hosted-CI, and deployment gates still pending
Last reviewed: 2026-07-22

mockOS is an open-core, deterministic identity-platform test double for Entra ID and
Okta integrations. The public repository is intended to contain the provider engine,
self-hostable Cloudflare Worker, conformance fixtures, MCP tools, and test skill.

The documentation distinguishes four evidence levels:

- **Implemented** means linked code and automated tests exist.
- **Source candidate** means source evidence exists, but a working tree may not yet
  have an immutable revision and its local, hosted-CI, or deployment gates may still
  be open.
- **Documented target** means a sourced fixture or design exists but the runtime may not.
- **Live verified** means a sanitized capture or deployed smoke test exists.

M0-M3 have accepted evidence. M3 adds path-mode inbound SCIM for Entra and Okta
environments, bounded Microsoft Graph reads, bounded Okta Users/Groups and lifecycle
routes, rotating refresh-token families with lifecycle cascade, and a 14-tool MCP
registry plus the source CLI's `lifecycle simulate` command. Focused Worker
integrations, all 113 SCIM fixtures, and the full repository gate execute green
locally and in hosted CI. The same exact revision passed the expanded deployed smoke
at staging and production, including reverse cleanup and final empty-catalog checks.
This qualifies the tested mockOS runtime, not parity with a live Entra tenant or Okta
organization.

The current M5 source candidate adds a fifteenth MCP tool,
`run_provisioning_cycle`, deterministic Entra/Okta outbound SCIM planning, a
Cloudflare Workflow runtime, SSRF and bounded-HTTP controls, environment-isolated
target credentials, ordered request-sequence assertions, a source CLI command, and a
local target-app example. The Worker and worker-kit suites, full `pnpm check`, and a
fresh two-process `wrangler dev` provisioning e2e are green; see the
[local M5 source record](./evidence/m5-local-source-qualification.md). No immutable M5
revision, hosted CI, or staging/production smoke exists yet, so the accepted deployed
baseline remains M3.

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
- [M1 Wrangler dev smoke evidence](./evidence/m1-wrangler-dev-smoke.md)
- [M2 staging and production workers.dev smoke evidence](./evidence/m2-workers-dev-smoke.md)
- [M2 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591)
- [M3 staging and production workers.dev smoke evidence](./evidence/m3-workers-dev-smoke.md)
- [M3 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29886610480)
- [M5 local source qualification](./evidence/m5-local-source-qualification.md)
- Identity notes: [Entra ID](./identity/entra.md), [Okta](./identity/okta.md),
  [SCIM](./identity/scim.md)
- Security: [threat model](./security/threat-model.md) and
  [outbound provisioning](./security/outbound-provisioning.md)
- [Hosting modes](./hosting-modes.md)
- Quickstarts: [curl probe](./quickstarts/curl.md),
  [Entra SSO](./quickstarts/entra-sso.md), and
  [provisioning cycle](./quickstarts/provisioning-cycle.md)
- Agent interfaces: [MCP](./mcp.md) and [testing skill](./skill.md)
- [Source-built CLI](../packages/cli/README.md)
- [Self-hosting](./self-hosting.md)
- [Brand and asset usage](./brand.md)
