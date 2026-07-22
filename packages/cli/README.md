# 🥸 mockOS CLI

The `mockos` command manages mockOS through its remote MCP interface. It is designed
for local development, deterministic integration tests, and keyless CI once the
hosted control plane is enabled.

Status: M2 command surface implemented; later-phase commands capability-negotiate
with the server.

Last reviewed: 2026-07-22

## Install and run

```bash
pnpm --filter @mockos/cli build
node packages/cli/dist/bin.js --help
```

Published-package usage:

```bash
pnpm add --global @mockos/cli
mockos doctor --endpoint https://your-worker.example/mcp
```

The default endpoint is `http://127.0.0.1:8787/mcp`. Override it with
`--endpoint` or `MOCKOS_ENDPOINT`. Supply an Access Key with `MOCKOS_API_KEY` in CI.

## Profiles

Profiles live in `${XDG_CONFIG_HOME:-~/.config}/mockos/config.json` with owner-only
permissions. Pipe the key over stdin to keep it out of shell history:

```bash
printf '%s' "$MOCKOS_API_KEY" | mockos login \
  --endpoint https://your-worker.example/mcp \
  --profile staging \
  --api-key-stdin

mockos doctor --profile staging
mockos logout --profile staging
```

Environment variables override saved profiles, and command options override both.
The CLI never prints an Access Key.

## Core loop

```bash
mockos env create --name integration --provider entra --seed pull-123 --json
mockos seed --env env_12345678 --file identities.json
mockos app create --env env_12345678 --file application.json
mockos scenario set --env env_12345678 --file mfa-required.json
mockos mint-token \
  --env env_12345678 \
  --client-id client_123 \
  --subject alex@example.test
mockos logs dump --env env_12345678 --out requests.jsonl
mockos assert \
  --env env_12345678 \
  --spec assertion.json \
  --junit mockos-results.xml
mockos env delete --env env_12345678
```

`mockos assert` exits `3` when the assertion executes but does not pass, which keeps
usage errors (`2`) and transport/runtime failures (`1`) distinct.

## Later-phase commands

`env ensure`, `blueprint export`, and `blueprint apply` are already present in the
CLI contract. They inspect the server's advertised MCP tools and fail with a clear
upgrade message until the governance and blueprint phases provide those capabilities.
This keeps one CLI stable while the server grows without pretending an unavailable
feature is implemented.
