<p align="center">
  <img src="./assets/brand/mockos-mark.svg" width="96" alt="">
</p>

<h1 align="center">mockOS</h1>

<p align="center"><strong>Mock identity, MCP, and LLM infrastructure for integration tests.</strong></p>

<p align="center">Give applications and agents realistic dependencies without creating real tenants, accounts, or production data.</p>

<p align="center">
  <a href="https://github.com/reachjalil/mockos/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/reachjalil/mockos/ci.yml?branch=main&amp;label=CI"></a>
  <a href="https://github.com/reachjalil/mockos/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/reachjalil/mockos?include_prereleases&amp;sort=semver"></a>
  <a href="./LICENSE"><img alt="Apache-2.0 license" src="https://img.shields.io/github/license/reachjalil/mockos"></a>
</p>

<p align="center">
  <a href="./docs/getting-started/mcp-first.md">Get started</a>
  ·
  <a href="./docs/README.md">Documentation</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
  ·
  <a href="https://github.com/reachjalil/mockos/releases">Releases</a>
  ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

mockOS creates isolated, deterministic test environments for Entra ID, Okta, SCIM,
MCP, and bounded OpenAI- and Anthropic-shaped APIs. Configure an environment through
MCP, point the system under test at the returned endpoints, exercise the flow, and
assert exactly what happened.

It is built for repeatable integration testing:

- **Deterministic by default.** Stable seeds, an injectable clock, controlled
  randomness, and explicit failure scenarios make bugs reproducible.
- **Made for agents and automation.** MCP is the primary management interface, so a
  test runner or coding agent can create, inspect, reset, and remove its own
  environment.
- **Protocol-shaped.** Applications use familiar OIDC, OAuth, SCIM, Graph-shaped,
  Okta-shaped, MCP, OpenAI, and Anthropic endpoints.
- **Observable.** Request logs and exact assertions make failures easier to diagnose
  without relying on screenshots or manual tenant inspection.
- **Safe to run locally.** The public repository is Apache-2.0 licensed and includes
  a self-hostable Cloudflare Worker. Test data must always be synthetic.

## What can you test?

| Area | Available surface |
| --- | --- |
| Identity | Entra ID- and Okta-shaped OIDC/OAuth flows, discovery, tokens, lifecycle, and selected failure cases |
| Directory | SCIM 2.0, bounded Microsoft Graph reads, Okta-shaped user and group APIs, and outbound SCIM provisioning |
| MCP clients and agents | Deterministic tools, resources, resource templates, and prompts on environment-hosted MCP servers |
| LLM integrations | Bounded OpenAI Chat Completions and Anthropic Messages behavior, including JSON and streaming responses |
| Test control | MCP-managed setup, scenarios, traffic inspection, assertions, and cleanup |

Support is intentionally explicit rather than implied. Check the
[implementation status](./docs/IMPLEMENTATION_STATUS.md) and
[known limitations](./docs/known-limitations.md) before depending on a specific
provider behavior or SDK path.

## How it works

1. A test runner, agent, or developer creates an isolated environment through
   management MCP.
2. mockOS returns provider-shaped endpoints and synthetic credentials for that
   environment.
3. The application or agent under test talks to those endpoints as if they were its
   external dependencies.
4. The test inspects captured traffic, asserts the expected behavior, and deletes the
   environment.

Management credentials never belong on provider endpoints. The
[interface model](./docs/concepts/interface-model.md) explains the separation between
the management plane and each synthetic data plane.

## Run from source

Requires Node.js 22.12 or newer and pnpm 10.30.2.

```sh
git clone https://github.com/reachjalil/mockos.git
cd mockos
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

To run the Worker locally, add a development-only `API_KEY` to the ignored
`apps/worker/.dev.vars` file, then start it:

```dotenv
API_KEY=choose-a-local-only-key
```

```sh
pnpm dev
```

The local management endpoint is `http://127.0.0.1:8787/mcp`. Continue with the
[MCP-first quickstart](./docs/getting-started/mcp-first.md) or the complete
[self-hosting guide](./docs/self-hosting.md).

## Choose a guide

| Goal | Guide |
| --- | --- |
| Create and manage a test environment through MCP | [MCP-first quickstart](./docs/getting-started/mcp-first.md) |
| Use the source-built command line | [CLI quickstart](./docs/getting-started/cli.md) |
| Test an MCP client or agent | [Mock MCP guide](./docs/mock-mcp.md) |
| Test an OpenAI SDK integration | [OpenAI SDK quickstart](./docs/quickstarts/openai-sdk.md) |
| Test an Anthropic SDK integration | [Anthropic SDK quickstart](./docs/quickstarts/anthropic-sdk.md) |
| Run an identity flow | [Entra SSO](./docs/quickstarts/entra-sso.md), [MSAL Node](./docs/quickstarts/entra-msal-node.md), or [Okta Auth JS](./docs/quickstarts/okta-auth-js-node.md) |
| Exercise outbound provisioning | [Provisioning guide](./docs/quickstarts/provisioning-cycle.md) |
| Deploy your own Worker | [Self-hosting](./docs/self-hosting.md) |

The [documentation index](./docs/README.md) contains the complete map, including
security guidance, generated interface references, provider conformance, and detailed
evidence.

## Project status

mockOS is in active pre-1.0 development. The repository contains substantial tested
behavior, but package publication, broad provider parity, and production-SLA support
are not complete. Detailed qualification and deployment evidence lives in the
[implementation status ledger](./docs/IMPLEMENTATION_STATUS.md), not in this welcome
page. Review the [known limitations](./docs/known-limitations.md) before choosing a
provider surface or client SDK.

## Releases

Versioned source releases are published on
[GitHub Releases](https://github.com/reachjalil/mockos/releases) and summarized in the
[changelog](./CHANGELOG.md). `v0.1.0-rc.1` is the first tagged source preview.

There is no stable npm release yet. Until a release explicitly confirms registry
publication, clone the repository and run mockOS from source. Prerelease tags describe
the exact source they contain; they do not imply complete provider parity or a
production SLA.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a
pull request, and use only synthetic identities and credentials. Security issues
should be reported privately as described in [SECURITY.md](./SECURITY.md).

Licensed under the [Apache License 2.0](./LICENSE).
