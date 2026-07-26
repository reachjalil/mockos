# CLI quickstart

Status: Source `@mockos/cli` 0.1.0 is release-ready; registry executable publication remains pending
Last reviewed: 2026-07-26

The `mockos` command is a thin client for the primary management MCP interface. It
creates and inspects deterministic test environments; your application still calls
the separate provider-shaped endpoints returned for that Environment.

## Installation boundary

The npm registry currently contains `@mockos/cli@0.0.1`, but that historical package
does not expose a `mockos` executable. Do not use it as the product CLI.

Install only after `@mockos/cli` 0.1.0 or newer is visible with the expected binary:

```sh
npm view @mockos/cli@0.1.0 version bin engines --json
pnpm add --global @mockos/cli@0.1.0
mockos --help
```

The release workflow now verifies that npm publishes `bin.mockos` as `dist/bin.js`
and retains the Node.js 22.12-or-newer boundary. Until that release completes, use
the [source build](../../packages/cli/README.md#build-and-run-from-source).

## Connect to mockOS Cloud

Create a separate display-once Access Key in the Cloud console. Pipe it over standard
input so it does not enter shell history:

```sh
printf '%s' "$MOCKOS_API_KEY" | mockos login \
  --endpoint https://id.mockos.live/mcp \
  --profile cloud \
  --api-key-stdin

mockos doctor --profile cloud
```

The Access Key belongs only at the management endpoint. Never send it to an OIDC,
OAuth, SCIM, Graph, Okta-shaped, mock-MCP, OpenAI-shaped, or Anthropic-shaped
dependency endpoint.

## Create, inspect, and clean up

```sh
mockos env create \
  --profile cloud \
  --name agent-integration \
  --provider entra \
  --seed agent-integration \
  --json

mockos wellknown \
  --profile cloud \
  --env env_12345678 \
  --json

mockos env delete \
  --profile cloud \
  --env env_12345678
```

Replace `env_12345678` with the ID returned by `env create`. Use only synthetic
identities and credentials. Run `mockos doctor` before automation and stop when the
server does not advertise a required capability.
