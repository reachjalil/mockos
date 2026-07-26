# 🥸 mockOS CLI

The `mockos` command manages mockOS through its authenticated remote MCP interface. It
is designed for local development, deterministic integration tests, and
Access-Key-authenticated CI.

Status: Source 0.1.0 is locally qualified; registry 0.0.1 has no executable and the usable npm release remains pending
Last reviewed: 2026-07-26

## npm installation boundary

The registry currently contains historical `@mockos/cli@0.0.1`, but that package
does not publish `bin.mockos`. It is not an installable product command.

After the release workflow publishes 0.1.0, verify and install the exact executable:

```bash
npm view @mockos/cli@0.1.0 version bin engines --json
pnpm add --global @mockos/cli@0.1.0
mockos --help
```

Until then, use the source build below. The shorter
[CLI quickstart](../../docs/getting-started/cli.md) covers the Cloud profile and
create/inspect/delete loop.

## Build and run from source

From the repository root:

```bash
pnpm --filter @mockos/cli build
node packages/cli/dist/bin.js --help
```

The source CLI defaults to `http://127.0.0.1:8787/mcp`. Override that endpoint with
`--endpoint`, `MOCKOS_ENDPOINT`, or a saved profile. Capability discovery is
authoritative for a connected server; do not assume that a source command is deployed
until the exact-revision evidence ledger says so:

- staging: `https://mockos-staging.workspaceagent.workers.dev/mcp`
- production: `https://mockos.workspaceagent.workers.dev/mcp`

Both live endpoints require an operator-provided Access Key. Supply
`MOCKOS_API_KEY` in CI or save a local profile; a missing or incorrect key is rejected.
The keys used for the
[M2 workers.dev smoke](../../docs/evidence/m2-workers-dev-smoke.md) are not published.

## Profiles

Profiles live in `${XDG_CONFIG_HOME:-~/.config}/mockos/config.json` with owner-only
permissions. Pipe the key over stdin to keep it out of shell history:

```bash
printf '%s' "$MOCKOS_API_KEY" | node packages/cli/dist/bin.js login \
  --endpoint https://mockos-staging.workspaceagent.workers.dev/mcp \
  --profile staging \
  --api-key-stdin

node packages/cli/dist/bin.js doctor --profile staging
node packages/cli/dist/bin.js logout --profile staging
```

Command options override environment variables, which override saved profiles. The
relevant variables are `MOCKOS_ENDPOINT`, `MOCKOS_API_KEY`, `MOCKOS_PROFILE`, and
`MOCKOS_CONFIG`. The CLI never prints an Access Key. Keep the config file out of Git
and use a separate key for each deployment target.

## Identity and provisioning loop

The examples below deliberately invoke the built source file against a `local` profile
pointing at the source Worker because the usable executable is not published. Replace the
sample environment and User IDs with values returned by `env create` and `seed`.

```bash
node packages/cli/dist/bin.js env create \
  --profile local \
  --name integration \
  --provider entra \
  --seed pull-123 \
  --json

node packages/cli/dist/bin.js seed \
  --profile local \
  --env env_12345678 \
  --file identities.json
node packages/cli/dist/bin.js app create \
  --profile local \
  --env env_12345678 \
  --file application.json
printf '%s' "$TARGET_SCIM_TOKEN" | node packages/cli/dist/bin.js provision run \
  --profile local \
  --env env_12345678 \
  --app-id app_12345678 \
  --mode full \
  --target-ref target-app \
  --target-url https://target-app.example.net/scim/v2 \
  --target-token-file - \
  --save-target \
  --json
node packages/cli/dist/bin.js lifecycle simulate \
  --profile local \
  --env env_12345678 \
  --user usr_12345678 \
  --action disable \
  --json
node packages/cli/dist/bin.js scenario set \
  --profile local \
  --env env_12345678 \
  --file mfa-required.json
node packages/cli/dist/bin.js mint-token \
  --profile local \
  --env env_12345678 \
  --client-id client_123 \
  --subject alex@example.test
node packages/cli/dist/bin.js logs dump \
  --profile local \
  --env env_12345678 \
  --out requests.jsonl
node packages/cli/dist/bin.js assert \
  --profile local \
  --env env_12345678 \
  --spec assertion.json \
  --junit mockos-results.xml
node packages/cli/dist/bin.js env delete \
  --profile local \
  --env env_12345678
```

`lifecycle simulate` requires the server to advertise `simulate_lifecycle`. Use
`doctor` or `mcp tools` before a saved workflow and stop on a capability mismatch.
Actions are provider- and state-specific: an active Entra User can be `disable`d,
while an active Okta User can be `suspend`ed or `deprovision`ed. The result reports the
previous/current state, resource version/ETag, and effective access/refresh-token
revocation counts. Use only synthetic identities and credentials.

`wellknown` returns the request-derived OIDC/OAuth and SCIM URLs plus `graphBaseUrl`
for Entra or `oktaApiBaseUrl` for Okta. The directory endpoints use test-only mock
credential boundaries (SCIM/Graph Bearer and Okta SSWS); the MCP Access Key must never
be sent to them.

`provision run` likewise requires the server to advertise
`run_provisioning_cycle`. It accepts either a previously saved `--target-ref`, or an
inline `--target-url` with an optional synthetic Bearer value read only from
`--target-token-file <path>` or `--target-token-file -` for standard input. There is no
target-token argv option. Pass a stable, non-secret `--idempotency-key` to make an exact
transport retry resolve to the same run; hosted mockOS requires it. Reuse a key only
for the same Environment, application, mode, and target. `--save-target` retains the inline target in that environment
for subsequent cycles; omit it for run-scoped credentials. Platform `mk_` Access Keys
and the exact active configured self-host Access Key are rejected as target credentials.
The CLI uses a constant-time value comparison before the MCP call. This covers the
active profile or environment key and target tokens read from a file or standard input;
the value is not echoed on rejection. The command returns a queued run, so automation
must poll bounded log/assertion evidence rather than treating command return as Workflow
completion. See the [provisioning quickstart](../../docs/quickstarts/provisioning-cycle.md)
and [outbound security boundary](../../docs/security/outbound-provisioning.md).

`mockos assert` exits `3` when the assertion executes but does not pass, which keeps
usage errors (`2`) and transport/runtime failures (`1`) distinct. Use `--timeout` for a
slower remote target and `--json` for machine-readable command output.

## Later-phase commands

`env ensure`, `blueprint export`, and `blueprint apply` are already present in the CLI
contract. They inspect the server's advertised MCP tools and fail with a clear upgrade
message until the governance and blueprint phases provide those capabilities.
`blueprint validate` is local-only. This capability negotiation keeps the source CLI
stable without claiming that unavailable server features work.

## Release verification

Do not infer a usable release from package-name availability. The release is ready for
installation only when npm reports version 0.1.0 or newer, `bin.mockos` equals
`dist/bin.js`, and `mockos --help` starts on Node.js 22.12 or newer. The checked-in
release workflow enforces the metadata step after a successful publish.
