<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: MCP-first public documentation for the current M5/M6 runtime and F0 source candidate
Last reviewed: 2026-07-23

mockOS is an MCP-first, deterministic identity-platform test double. Agents and
automation use management MCP to create isolated Entra ID or Okta environments;
applications under test connect to their provider-shaped OIDC, OAuth, SCIM, Graph,
and Okta endpoints.

Start with the workflow you need. Use
[implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md) before turning documentation into a
support, deployment, or provider-parity claim.

## Start by intent

| I want to… | Start here |
| --- | --- |
| Let an agent configure and test an integration | [MCP-first quickstart](./getting-started/mcp-first.md) |
| Understand MCP, the console, CLI, HTTP, and provider endpoints | [Interface model](./concepts/interface-model.md) |
| Inspect every current management tool | [Generated management-tool reference](./reference/management-tools.md) |
| Call the smaller self-hosted HTTP surface | [Self-hosted HTTP reference](./reference/self-hosted-http.md) |
| Run a concrete OIDC flow | [Entra SSO guide](./quickstarts/entra-sso.md) or [curl walkthrough](./quickstarts/curl.md) |
| Exercise outbound SCIM | [Provisioning-cycle guide](./quickstarts/provisioning-cycle.md) |
| Deploy the public Worker | [Self-hosting](./self-hosting.md) and [hosting modes](./hosting-modes.md) |
| Decide whether a behavior is supported | [Implementation status](./IMPLEMENTATION_STATUS.md), [limitations](./known-limitations.md), and [provider parity](./conformance/parity-matrix.md) |

## Management and agent interfaces

- [MCP-first quickstart](./getting-started/mcp-first.md)
- [Interface model](./concepts/interface-model.md)
- [Management MCP behavior](./mcp.md)
- [Generated 15-tool reference](./reference/management-tools.md)
- [Machine-readable management catalog](./reference/management-operations.v1.json)
- [Self-hosted HTTP reference](./reference/self-hosted-http.md)
- [Source-built CLI](../packages/cli/README.md)
- [Agent testing skill](./skill.md)

The management MCP server at `/mcp` is the primary control interface. The current
source exposes 15 tools. The direct self-hosted management HTTP surface contains five
implemented routes and must not be presented as equivalent. Future mock MCP servers
inside environments belong to F1 and are unavailable today.

## Provider behavior

- [Entra ID](./identity/entra.md)
- [Okta](./identity/okta.md)
- [SCIM 2.0](./identity/scim.md)
- [Provider parity matrix](./conformance/parity-matrix.md)
- [Generated M6 executable-evidence matrix](./conformance/m6-generated-parity.md)

Provider endpoints are the synthetic dependencies used by an application under test.
They have separate mock credential boundaries and must never receive the management
Access Key.

## Security and operations

- [Threat model](./security/threat-model.md)
- [Outbound provisioning security](./security/outbound-provisioning.md)
- [Self-hosting](./self-hosting.md)
- [Hosting modes](./hosting-modes.md)
- [Known limitations](./known-limitations.md)

## Status, roadmap, and traceability

- [Implementation status](./IMPLEMENTATION_STATUS.md)
- [Requirements traceability](./requirements-traceability.md)
- [F0 contract, client, and wrapper foundation](./f-series/f0-foundation.md)
- [F-series execution roadmap](./F_SERIES_ROADMAP.md)

The F-series roadmap is target design, not implementation evidence. In particular,
mock MCP servers, mock LLM APIs, script execution, enforced scoped keys, and Code Mode
remain unavailable at the current F0 source boundary.

## Accepted evidence

- [M1 Wrangler development smoke](./evidence/m1-wrangler-dev-smoke.md)
- [M2 staging and production workers.dev smoke](./evidence/m2-workers-dev-smoke.md)
- [M3 staging and production workers.dev smoke](./evidence/m3-workers-dev-smoke.md)
- [M5 local source qualification](./evidence/m5-local-source-qualification.md)
- [M5 deployment and provisioning acceptance](./evidence/m5-workers-dev-smoke.md)
- [M6 sampled staging and production acceptance](./evidence/m6-workers-dev-smoke.md)

Documentation uses four distinct claims:

- **Implemented / source candidate** means linked code and automated tests exist.
- **Source evidence** binds automated local or hosted-CI execution to an exact
  revision.
- **Deployed acceptance** additionally binds an exact deployment/version to a
  recorded acceptance run.
- **Verified-live** requires sanitized, independently reviewed comparison with a real
  provider.

No current fixture or milestone is verified-live. A workers.dev or hosted mockOS run
is deployed mock evidence, never real-provider evidence.

## Project and contribution reference

- [Brand and asset usage](./brand.md)
- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)

For an agent-readable map, use [`llms.txt`](../llms.txt). The curated
[`llms-full.txt`](../llms-full.txt) combines the core public guidance without
publishing credentials or private operated-service material.
