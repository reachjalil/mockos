<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: MCP-first public documentation through F1 and the management-only F2 source slice
Last reviewed: 2026-07-25

mockOS is an MCP-first, deterministic identity-platform and agent-dependency test
double. Agents and automation use management MCP to create isolated Entra ID, Okta,
and mock MCP environments. Applications under test connect to the provider-shaped
identity routes or an environment-hosted mock MCP server.

Start with the workflow you need. Use
[implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md) before turning documentation into a
support, deployment, or provider-parity claim.

## Start by intent

| I want to… | Start here |
| --- | --- |
| Let an agent configure and test an integration | [MCP-first quickstart](./getting-started/mcp-first.md) |
| Test an agent or MCP client against deterministic tools, resources, and prompts | [Environment-hosted mock MCP](./mock-mcp.md) |
| Define a future OpenAI/Anthropic mock safely through management MCP | [Mock LLM management definitions](./mock-llm.md) |
| Understand the source-only mock-LLM plan/renderer architecture | [F2 LLM kernel](./f-series/f2-llm-kernel.md) |
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
- [Generated 24-tool reference](./reference/management-tools.md)
- [Machine-readable management catalog](./reference/management-operations.v1.json)
- [Self-hosted HTTP reference](./reference/self-hosted-http.md)
- [Source-built CLI](../packages/cli/README.md)
- [Agent testing skill](./skill.md)

The management MCP server at `/mcp` is the primary control interface. The current
source exposes 24 tools. Five F1 tools configure mock MCP servers and four F2 tools
configure management-only mock-LLM definitions, but the direct
self-hosted management HTTP surface still contains only five identity-management
routes and must not be presented as equivalent. The configured mock endpoint is a
separate data plane called by an agent under test. Its source behavior, wire sequence,
server contract, and limits are in [Environment-hosted mock MCP](./mock-mcp.md).
Mock-LLM definitions do not yet create a provider data plane; their exact
compare-and-swap, credential, persistence, and unsupported boundaries are in
[Mock LLM management definitions](./mock-llm.md).

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
- [F1 mock-MCP source implementation](./f-series/f1-mcp-foundation.md)
- [F2 mock-LLM management guide](./mock-llm.md)
- [Partial F2 LLM kernel and management slice](./f-series/f2-llm-kernel.md)
- [F-series execution roadmap](./F_SERIES_ROADMAP.md)

The F-series roadmap is target design, not implementation evidence. F1 is locally
source-qualified for its bounded implementation, while hosted CI, merge, package
publication, private Cloud consumption, and deployed F1 acceptance remain open. The
F2 source now combines a neutral response plan, behavior adapter, pure
OpenAI/Anthropic rendering, and in-process official-SDK deserialization with a strict
server-definition contract, four MCP-only operations, schema-v7 environment
persistence, mandatory revision compare-and-swap, and write-only provider Mock
Credentials. It still adds no provider route/auth enforcement, model renderer,
runtime/conversation state, reset, network/timed streaming, observation, Wrangler,
deployment, or Cloud pin, so mock LLM APIs remain unavailable as a data plane.
Script execution, enforced scoped keys, and Code Mode also remain unavailable.

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
