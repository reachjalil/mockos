# MCP-first quickstart

Status: Current 24-tool management workflow; package publication remains unavailable
Last reviewed: 2026-07-25

Use management MCP to create a deterministic identity environment, obtain its
provider-shaped endpoints, exercise your application, assert what it sent, and remove
the environment. MCP is the primary control interface; the OIDC, OAuth, SCIM, Graph,
and Okta-shaped routes are the dependencies your application tests against.
The same management interface also owns mock MCP and mock LLM definitions; their
application-facing data planes remain separate task flows.

## Before connecting

You need:

- an MCP client that supports Streamable HTTP;
- a mockOS management endpoint ending in `/mcp`;
- a management Access Key supplied by the operator; and
- only synthetic identities, credentials, tokens, and application data.

For the public self-hosted Worker, set `API_KEY` in an ignored local secret file or
Worker secret. Its default local management endpoint is:

```sh
export MOCKOS_MCP_ENDPOINT=http://127.0.0.1:8787/mcp
: "${MOCKOS_API_KEY:?load MOCKOS_API_KEY from your secret store}"
```

The endpoint is a non-secret local default. The second command verifies that the
management key is already present; it does not assign a placeholder or credential. Do
not place a real key in a command committed to Git, an MCP configuration checked into
a repository, a URL, fixture, log, or report.

An operated mockOS service may issue a display-once account key and a different
endpoint. Use the exact endpoint shown by that service. Do not substitute the public
workers.dev evidence origins or a provider-shaped URL.

## Connect and discover capabilities

Configure the MCP client with:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `$MOCKOS_MCP_ENDPOINT` |
| Authorization | `Bearer $MOCKOS_API_KEY` |
| Tested protocol revision | `2025-11-25` |

The current server uses initialization, an issued `Mcp-Session-Id`, subsequent POST
requests, and authenticated DELETE termination. A standalone `GET /mcp` returns `405`;
that is the supported POST-only Streamable HTTP behavior, not an instruction to fall
back to the legacy HTTP+SSE transport.

Call `tools/list` before any mutation. Require only the tools needed by the planned
workflow and tolerate additional tools from a newer compatible server. The current
source exposes exactly 24 tools; use the
[generated management-tool reference](../reference/management-tools.md) instead of a
copied list. Five F1 tools configure environment-hosted mock MCP dependencies, and
four F2 tools persist mock-LLM definitions. Those four tools do not prove that the
connected endpoint serves either separate provider route.

Stop before creating state when:

- authentication fails;
- the negotiated protocol revision is unsupported;
- a required tool is absent; or
- an endpoint advertises a tool whose input schema is incompatible with the saved
  workflow.

Connected capability discovery proves what that server advertises. It does not prove
that a local checkout is deployed there or that the server matches a particular
evidence record.

## Run the deterministic environment loop

Keep every returned ID and use an explicit `environmentId` in saved automation:

1. Call `create_environment` with `provider: "entra"` or `provider: "okta"`, a
   descriptive name, and a stable synthetic seed.
2. Call `seed_identities` with only synthetic Users, Groups, memberships, passwords,
   roles, and lifecycle inputs.
3. Call `create_application` with the exact redirect URIs and grant types the
   application under test expects. Keep its display-once synthetic client secret out
   of logs and reports.
4. Call `get_wellknown_urls` with the explicit environment ID. Configure the
   application from the returned issuer, discovery, OAuth/OIDC, JWKS, SCIM, and
   provider-specific directory URLs. Never reconstruct an absolute URL from memory.
5. Run the application flow against those provider-shaped endpoints with separate
   synthetic protocol credentials.
6. Call `get_request_log` for diagnosis and `assert_requests` for stable,
   machine-readable expectations.
7. Clear scenarios created by the run and call `delete_environment` in a
   `finally`-style cleanup.
8. Close the MCP client so it sends the authenticated session-termination request.

`set_current_environment` is useful in an interactive session, but its cursor does not
cross transports. An explicit environment ID makes automation reviewable and prevents
a stale session cursor from selecting the wrong test state.

## Start from the source CLI

The unpublished CLI is a tested MCP client and can verify connection/capability
behavior from a source checkout:

```sh
pnpm --filter @mockos/cli build

printf '%s' "$MOCKOS_API_KEY" |
  node packages/cli/dist/bin.js login \
    --endpoint "$MOCKOS_MCP_ENDPOINT" \
    --profile local \
    --api-key-stdin

node packages/cli/dist/bin.js doctor --profile local
node packages/cli/dist/bin.js mcp tools --profile local
```

The package is not published, so do not replace the source command with a speculative
global install. The full command workflow and exit-code contract are in the
[CLI guide](../../packages/cli/README.md).

## Credentials do not cross interfaces

The management key authenticates management MCP. It must not be reused for SCIM,
Graph-shaped, Okta directory-shaped, environment mock MCP, outbound provisioning, or
mock OpenAI/Anthropic application traffic. Those surfaces use separate synthetic Mock Credentials
documented in the
[interface model](../concepts/interface-model.md#trust-boundaries).

Captured protocol bodies can contain synthetic passwords, client credentials, or
tokens even after platform and outbound target secrets are redacted. Quote only the
minimum safe request evidence.

## What this quickstart does not enable

This identity workflow does not configure the source-qualified F1 mock MCP server.
Use the separate [environment-hosted mock MCP guide](../mock-mcp.md) for that task.
It also does not configure the F2 definition/provider workflow. Use the
[OpenAI SDK quickstart](../quickstarts/openai-sdk.md) or
[Anthropic SDK quickstart](../quickstarts/anthropic-sdk.md) for a short end-to-end
path, or [MCP-managed mock OpenAI and Anthropic](../mock-llm.md) for exact revision,
credential, request, persistence, and cleanup contracts. That partial F2 workflow
enables bounded model discovery plus OpenAI and Anthropic JSON/SSE
Chat Completions/Messages. It does not enable:

- broad Anthropic provider/beta APIs, configured midstream errors, or
  the OpenAI Responses API;
- LLM conversation state, reset, observations, or assertions;
- Cloud pinning, hosted deployment, or live-provider parity;
- user-script execution or Worker Loader (F3);
- enforced `env:ro` or `env:rw` key scopes (F4);
- Code Mode `search` and `execute` (F6); or
- npm installation of the CLI or typed client.

See [known limitations](../known-limitations.md) and
[implementation status](../IMPLEMENTATION_STATUS.md) before turning a source workflow
into a compatibility or deployment claim.
