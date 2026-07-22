<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: M0/M1 evidence index; no live deployment is claimed  
Last reviewed: 2026-07-22

mockOS is an open-core, deterministic identity-platform test double for Entra ID and
Okta integrations. The public repository is intended to contain the provider engine,
self-hostable Cloudflare Worker, conformance fixtures, MCP tools, and test skill.

The documentation distinguishes three things:

- **Implemented** means linked code and automated tests exist.
- **Documented target** means a sourced fixture or design exists but the runtime may not.
- **Live verified** means a sanitized capture or deployed smoke test exists.

Start with [implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md). Do not infer support from a route, type, or
fixture alone.

## Reference map

- [Requirements traceability](./requirements-traceability.md)
- [F-series execution roadmap](./F_SERIES_ROADMAP.md)
- [Provider parity matrix](./conformance/parity-matrix.md)
- [M1 Wrangler dev smoke evidence](./evidence/m1-wrangler-dev-smoke.md)
- Identity notes: [Entra ID](./identity/entra.md), [Okta](./identity/okta.md),
  [SCIM](./identity/scim.md)
- Security: [threat model](./security/threat-model.md) and
  [outbound provisioning](./security/outbound-provisioning.md)
- [Hosting modes](./hosting-modes.md)
- Quickstarts: [curl probe](./quickstarts/curl.md),
  [Entra SSO](./quickstarts/entra-sso.md), and
  [provisioning cycle](./quickstarts/provisioning-cycle.md)
- Agent interfaces: [MCP](./mcp.md) and [testing skill](./skill.md)
- [Self-hosting](./self-hosting.md)
- [Brand and asset usage](./brand.md)
