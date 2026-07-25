<h1><span aria-hidden="true">🥸</span> mockOS documentation</h1>

Status: MCP-first public documentation for accepted M0-M3/M5 and sampled M6, locally
source-qualified F0/F1, the partial OpenAI/Anthropic F2 source slice, and bounded MSAL
Node local X/Q qualification
Last reviewed: 2026-07-26

mockOS is an MCP-first, deterministic identity-platform and agent-dependency test
double. Agents and automation use management MCP to create isolated Entra ID, Okta,
mock MCP, and mock LLM environments. Applications under test connect to the
provider-shaped identity, MCP, or bounded OpenAI/Anthropic data plane.

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

Start with the workflow you need. Use
[implementation status](./IMPLEMENTATION_STATUS.md) and
[known limitations](./known-limitations.md) before turning documentation into a
support, deployment, or provider-parity claim.

## Start by intent

| I want to… | Start here |
| --- | --- |
| Let an agent configure and test an integration | [MCP-first quickstart](./getting-started/mcp-first.md) |
| Test an agent or MCP client against deterministic tools, resources, and prompts | [Environment-hosted mock MCP](./mock-mcp.md) |
| Test an application against deterministic OpenAI model and JSON/SSE Chat Completions behavior | [OpenAI SDK quickstart](./quickstarts/openai-sdk.md) |
| Test an application against deterministic Anthropic model and JSON/SSE Messages behavior | [Anthropic SDK quickstart](./quickstarts/anthropic-sdk.md) |
| Configure, replace, inspect, and remove a mock LLM through MCP | [MCP-managed mock OpenAI and Anthropic](./mock-llm.md) |
| Understand the partial mock-LLM planner/provider architecture | [F2 LLM kernel](./f-series/f2-llm-kernel.md) |
| Understand MCP, the console, CLI, HTTP, and provider endpoints | [Interface model](./concepts/interface-model.md) |
| Compare bounded product support with source, hosted-CI, Cloud-pin, deployment, and verified-live evidence | [Machine-readable product capability index](./reference/product-capabilities.v1.json) |
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
- [Machine-readable product capability index](./reference/product-capabilities.v1.json)
- [Machine-readable mock OpenAI provider manifest](./reference/mock-llm-openai.v1.json)
- [Machine-readable mock Anthropic provider manifest](./reference/mock-llm-anthropic.v1.json)
- [Self-hosted HTTP reference](./reference/self-hosted-http.md)
- [Source-built CLI](../packages/cli/README.md)
- [Agent testing skill](./skill.md)

The management MCP server at `/mcp` is the primary control interface. The current
source exposes 24 tools. Five F1 tools configure mock MCP servers and four F2 tools
configure mock-LLM definitions. The direct self-hosted management HTTP surface still
contains only five identity-management routes and must not be presented as
equivalent. Environment mock MCP and mock LLM provider endpoints are separate data planes
called by the application or agent under test. Their source behavior and exact
boundaries are in [Environment-hosted mock MCP](./mock-mcp.md) and
[MCP-managed mock OpenAI and Anthropic](./mock-llm.md).
The generated product capability index links each interface included in its explicitly
partial F0-F2 slice to executable authorities, specifications, guides, anchored
limitations, and five independent evidence tiers. Each evidence claim separates
qualification, coverage, and its relationship to the current revision. Its `support`
field describes only the referenced bounded contract; it does not assert hosted CI, a
private Cloud pin, deployment, or verified-live provider parity. Absence means
unindexed, not unsupported: identity, provisioning, and private Cloud product surfaces
are named as unindexed domains. Their existing management operations are already
covered by the MCP/HTTP rows; provider and provisioning-outcome rows wait for exact
public machine contracts. Private Cloud remains a separate overlay that joins private
product evidence and policy to an immutable public revision without exposing private
authorities in this artifact.

The current source candidate adds one bounded client qualification:
`@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 traverse an actual local
Wrangler HTTPS socket for custom-authority authorization code with S256 PKCE, forced
MSAL refresh, lifecycle disable, request assertion, durable credential-redaction
checks, normal cleanup, and a focused ready-Worker `SIGTERM` cleanup probe. This is
D/I/S/X/Q evidence only. Read the
[MSAL Node quickstart](./quickstarts/entra-msal-node.md) and
[local qualification record](./evidence/entra-msal-node-local-qualification.md).
There is no H, V, or P claim for that slice.

The public source remains independently self-hostable. The later public docs-only close
commit `e446eeda357b5e765401b97b892128fd70ac9ab8` was consumed by the separately
qualified private M4 composition, but that private acceptance is not M5 evidence and
does not add a private runtime dependency to this repository.

## Provider behavior

- [Entra ID](./identity/entra.md)
- [Okta](./identity/okta.md)
- [SCIM 2.0](./identity/scim.md)
- [Bounded OpenAI and Anthropic provider data planes](./mock-llm.md)
- [OpenAI SDK quickstart](./quickstarts/openai-sdk.md)
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
- [F2 MCP-managed mock OpenAI and Anthropic guide](./mock-llm.md)
- [Partial F2 LLM kernel and provider slice](./f-series/f2-llm-kernel.md)
- [F-series execution roadmap](./F_SERIES_ROADMAP.md)

The F-series roadmap is target design, not implementation evidence. F1 is locally
source-qualified for its bounded implementation, while hosted CI, merge, package
publication, private Cloud consumption, and deployed F1 acceptance remain open. The
F2 source now combines a neutral response plan, behavior adapter, pure
OpenAI/Anthropic rendering, and in-process official-SDK deserialization with a strict
server-definition contract, four MCP-only operations, schema-v8 environment
persistence, mandatory revision compare-and-swap, and write-only provider Mock
Credentials. It now source-qualifies bounded provider routes for ordered model
list/retrieve plus OpenAI Chat Completions and Anthropic Messages as JSON or timed
SSE through local Worker integrations and pinned official SDKs. Successfully
parsed/planned POSTs that pass response preflight attempt one metadata-only request-log
reservation within a 50-millisecond fail-open budget; prospective
metadata/credential collisions skip it. Existing MCP tools query and assert
successfully persisted lifecycle rows exactly.
Configured midstream errors, the OpenAI Responses API, Anthropic beta APIs,
runtime/conversation state, reset, Wrangler-network qualification, deployment, and
Cloud pinning remain unavailable. Script execution, enforced scoped keys, and Code
Mode also remain unavailable.

## Accepted evidence

- [M1 Wrangler development smoke](./evidence/m1-wrangler-dev-smoke.md)
- [M2 staging and production workers.dev smoke](./evidence/m2-workers-dev-smoke.md)
- [M2 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29881568591)
- [M3 staging and production workers.dev smoke](./evidence/m3-workers-dev-smoke.md)
- [M3 hosted CI run](https://github.com/reachjalil/mockos/actions/runs/29886610480)
- [M5 local source qualification](./evidence/m5-local-source-qualification.md)
- [M5 deployment and provisioning acceptance](./evidence/m5-workers-dev-smoke.md)
- [M6 sampled staging and production acceptance](./evidence/m6-workers-dev-smoke.md)
- [Entra MSAL Node local X/Q qualification](./evidence/entra-msal-node-local-qualification.md)

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
