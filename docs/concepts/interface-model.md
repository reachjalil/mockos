# Interface model

Status: Current interface taxonomy including F1 and management-only F2
Last reviewed: 2026-07-25

mockOS is MCP-first: agents and automation manage deterministic test state through
the management MCP server, then an application under test connects to the
provider-shaped endpoints created for that state. The console, CLI, and limited HTTP
surface are supporting interfaces, not separate sources of product behavior.

## The interfaces have different jobs

| Interface | Job | Current status |
| --- | --- | --- |
| Management MCP at `/mcp` | Create and configure environments, seed identities, register applications, define mock MCP and mock-LLM dependencies, inject scenarios, inspect traffic, and clean up | Implemented with 24 classic tools in the current source |
| Environment-hosted mock MCP | Simulate tools, resources, templates, and prompts for an agent or MCP client under test | Bounded F1 source-qualified locally; no hosted/deployed acceptance |
| Mock LLM definitions | Persist future OpenAI/Anthropic mock models, behavior, cadence, and provider-key policy | Four MCP-only F2 operations source-implemented; management only |
| Environment-hosted mock LLM | Simulate OpenAI/Anthropic provider APIs for an application or agent SDK under test | Unavailable; no provider route/data plane |
| Provider-shaped endpoints | Act as the synthetic Entra ID or Okta dependency used by the application under test | Implemented for the bounded surfaces in the [provider docs](../README.md#provider-behavior) |
| CLI | Provide a non-interactive operator experience over management MCP | Source-qualified and unpublished |
| Hosted console | Make common account, environment, application, scenario, and request evidence visible | Operated-service interface; not required by the public runtime |
| Self-hosted management HTTP | Provide direct access to the five Worker routes that actually exist | Implemented but narrower than MCP |
| OpenAPI and `@mockos/client` | Describe and call those five HTTP routes | F0 source candidate; not published or deployed as a complete management API |
| Agent testing skill | Teach an agent a safe, capability-negotiated workflow over MCP | Implemented guidance |

The [generated management reference](../reference/management-tools.md) is the exact
catalog for the current source. The [self-hosted HTTP reference](../reference/self-hosted-http.md)
shows the smaller HTTP subset.

## Management MCP is not an environment mock MCP server

Two MCP roles exist in the product direction and must not be conflated:

1. **Management MCP** controls mockOS. It is available at `/mcp` and exposes 24
   management tools in this source.
2. **Environment mock MCP** lets an agent under test connect to configured synthetic
   tools, resources, resource templates, and prompts inside an environment. The
   locally source-qualified F1 boundary is documented in
   [Environment-hosted mock MCP](../mock-mcp.md).

A tool returned by management `tools/list` is a control-plane capability. A tool
returned from `/e/{environmentId}/mcp-mock/{slug}` or
`https://{environmentId}.{baseDomain}/mcp-mock/{slug}` is synthetic application
traffic that mockOS captures and asserts. The five F1 management tools define that
dependency; they are not the dependency's own tools and do not have invented HTTP
management routes.

The four F2 management tools similarly define future mock-LLM dependencies but do not
make an OpenAI or Anthropic endpoint callable. They have no HTTP management
projection. Use [Mock LLM management definitions](../mock-llm.md) for mandatory
revision compare-and-swap, write-only provider keys, schema-v7 persistence, and the
complete unsupported boundary.

Future Code Mode `search` and `execute` tools are also a management-MCP experience.
They remain disabled until F6 authorization, audit, sandbox, quota, and cost gates
pass. Classic management tools remain the current interface.

## One operation, checked projections

The public operation registry owns the current management operation ID,
description, input/output schemas, MCP annotations, effect, retry behavior, secret
handling, and optional HTTP metadata.

```text
canonical operation registry
├── management MCP tool registration
├── generated management-tool reference and JSON catalog
├── five implemented Worker HTTP routes
├── generated OpenAPI
└── generated @mockos/client authorization map
```

An operation without HTTP metadata is MCP-only. An HTTP-looking path in a design or
type is not an implemented route. `set_current_environment`, for example, is an MCP
session convenience and has no HTTP equivalent.

The registry currently labels all 24 operations with `env:ro` and `env:rw`, but those
values are metadata until F4 implements and verifies shared scoped authorization.
Current authentication and environment ownership checks remain real; the future
scope vocabulary must not be marketed as enforced key permissions.

## Trust boundaries

Management credentials and provider-shaped mock credentials are deliberately
different:

- `/mcp` and self-hosted management HTTP require the configured management key;
- a mock MCP server accepts no credential or its own write-only Bearer Mock
  Credential, according to its definition;
- a mock-LLM definition accepts provider-scoped OpenAI/Anthropic Mock Credentials only
  on its management write; no current provider route evaluates them;
- SCIM and Graph-shaped paths accept a non-empty synthetic Bearer value;
- Okta directory-shaped paths accept a non-empty synthetic SSWS value; and
- Okta Classic Authn is a public synthetic sign-in boundary.

Never send a management key to a provider-shaped or environment mock MCP endpoint.
The public Worker rejects the active platform key as a substring of a mock-MCP Bearer
credential and anywhere in a bounded mock-LLM definition's JSON keys or string values.
Mock credentials exercise synthetic protocol behavior; they are not real provider
authorization. A mock-LLM safe-view `configured: true` marker is read-only; a
full-definition replacement must resupply or rotate every enabled strict provider key
from caller-owned secret storage.

## Evidence vocabulary

The existence of an interface, schema, fixture, or generated page proves neither
deployment nor provider parity.

- **Implemented / source candidate** means code and tests exist in the source under
  review.
- **Source evidence** binds automated execution to an exact revision.
- **Deployed acceptance** additionally binds that revision to an exact deployment
  and recorded acceptance run.
- **Verified-live** requires sanitized, independently reviewed comparison with a real
  provider.

Use [implementation status](../IMPLEMENTATION_STATUS.md) and the linked evidence
records for the strongest current claim.
