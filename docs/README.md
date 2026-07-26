<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: Current public documentation; detailed qualification is tracked separately
Last reviewed: 2026-07-26

mockOS provides deterministic identity, directory, MCP, and bounded LLM dependencies
for integration tests. Management happens through MCP; applications and agents under
test connect to separate provider-shaped endpoints.

New to the project? Start with the
[MCP-first quickstart](./getting-started/mcp-first.md). Before relying on a particular
provider behavior, read [implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md).

## Start by goal

| I want to… | Start here |
| --- | --- |
| Create an isolated test environment | [MCP-first quickstart](./getting-started/mcp-first.md) |
| Understand which endpoint does what | [Interface model](./concepts/interface-model.md) |
| Use the source-built CLI | [CLI quickstart](./getting-started/cli.md) |
| Test an MCP client or agent | [Environment-hosted mock MCP](./mock-mcp.md) |
| Test an OpenAI integration | [OpenAI SDK quickstart](./quickstarts/openai-sdk.md) |
| Test an Anthropic integration | [Anthropic SDK quickstart](./quickstarts/anthropic-sdk.md) |
| Run an identity login flow | [Entra SSO](./quickstarts/entra-sso.md), [MSAL Node](./quickstarts/entra-msal-node.md), or [Okta Auth JS](./quickstarts/okta-auth-js-node.md) |
| Exercise outbound SCIM | [Provisioning-cycle guide](./quickstarts/provisioning-cycle.md) |
| Run or deploy the public Worker | [Self-hosting](./self-hosting.md) |
| Check whether a behavior is supported | [Implementation status](./IMPLEMENTATION_STATUS.md), [limitations](./known-limitations.md), and [provider parity](./conformance/parity-matrix.md) |

## Core concepts

- [Interface model](./concepts/interface-model.md) — management MCP, companion HTTP,
  and synthetic provider data planes
- [Management MCP behavior](./mcp.md) — session, authentication, and operation
  semantics
- [Generated management-tool reference](./reference/management-tools.md) — the exact
  tools exposed by the current source
- [Self-hosted HTTP reference](./reference/self-hosted-http.md) — the smaller
  companion management API

The management MCP server at `/mcp` creates and configures environments. Applications
under test do not call that management interface; they use the OIDC, OAuth, SCIM,
Graph-shaped, Okta-shaped, MCP, OpenAI, or Anthropic endpoints returned for their
environment. Keep management Access Keys separate from every synthetic protocol
credential.

## Provider behavior

- [Entra ID behavior](./identity/entra.md)
- [Okta behavior](./identity/okta.md)
- [SCIM 2.0 behavior](./identity/scim.md)
- [curl walkthrough](./quickstarts/curl.md)
- [Entra SSO quickstart](./quickstarts/entra-sso.md)
- [Entra with MSAL Node](./quickstarts/entra-msal-node.md)
- [Okta with Okta Auth JS](./quickstarts/okta-auth-js-node.md)
- [Outbound provisioning](./quickstarts/provisioning-cycle.md)

## Agent and model dependencies

- [Environment-hosted mock MCP](./mock-mcp.md)
- [Salesforce SObject Reads blueprint](./blueprints/salesforce-sobject-reads.md)
- [MCP-managed mock OpenAI and Anthropic](./mock-llm.md)
- [OpenAI SDK quickstart](./quickstarts/openai-sdk.md)
- [Anthropic SDK quickstart](./quickstarts/anthropic-sdk.md)
- [Reusable mockOS testing skill](./skill.md)

These are synthetic test surfaces. Provider-derived names describe compatibility
targets and do not imply affiliation, live-provider access, certification, or complete
wire parity.

## Security and operations

- [Threat model](./security/threat-model.md)
- [Outbound provisioning security](./security/outbound-provisioning.md)
- [Self-hosting](./self-hosting.md)
- [Hosting modes](./hosting-modes.md)
- [Known limitations](./known-limitations.md)

Use only synthetic identities, credentials, tokens, and application data. Never route
a real account key, provider token, production credential, or personal data through a
mock environment.

## Status and exact reference

- [Implementation status](./IMPLEMENTATION_STATUS.md)
- [Requirements traceability](./requirements-traceability.md)
- [Provider parity matrix](./conformance/parity-matrix.md)
- [Generated product capability index](./reference/product-capabilities.v1.json)
- [F-series roadmap](./F_SERIES_ROADMAP.md)
- [Accepted evidence records](./evidence/)

mockOS tracks designed, implemented, source-tested, integration-tested,
SDK/client-qualified, hosted-smoke, verified-live, and production-ready evidence
independently. One level never implies another. Exact revisions, deployment records,
test boundaries, and pending work belong in the status and evidence documents above.

## Machine-readable entry points

- [`llms.txt`](../llms.txt) — concise repository map
- [`llms-full.txt`](../llms-full.txt) — curated public guidance
- [Management operation catalog](./reference/management-operations.v1.json)
- [Product capability index](./reference/product-capabilities.v1.json)
- [Mock MCP blueprint catalog](./reference/mock-mcp-blueprints.v1.json)
- [OpenAI provider manifest](./reference/mock-llm-openai.v1.json)
- [Anthropic provider manifest](./reference/mock-llm-anthropic.v1.json)

## Contributing

Read [Contributing](../CONTRIBUTING.md), the [security policy](../SECURITY.md), and
the [brand guide](./brand.md). The public repository is independently self-hostable,
and its documentation describes public behavior and support boundaries.
