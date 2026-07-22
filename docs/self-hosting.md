# Self-hosting

Status: Source-build guide with M5 source deployed; M6 Authn is source-only and distribution limits remain
Last reviewed: 2026-07-22

Prerequisites are Node 22.12 or newer, pnpm 10.30.2, a Cloudflare account for Worker
operations, and Wrangler authentication. Local repository checks do not require a
production domain.

## Run from source

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm check
```

Create an ignored `apps/worker/.dev.vars` with a development-only control key:

```dotenv
API_KEY=replace-with-a-local-development-key
```

Build the source CLI, then run the Worker:

```sh
pnpm --filter @mockos/cli build
pnpm --filter @mockos/worker dev
```

The control plane fails closed. `/mcp` and `/__mockos/v1/*` return `503` if `API_KEY`
is not configured and reject a missing or incorrect key with `401`. `/health` and the
mock provider protocol routes do not require that control credential.

The accepted M3 source exposes 14 authenticated MCP management tools, including
`simulate_lifecycle`. M5 adds `run_provisioning_cycle` as tool 15; its Worker suite,
full repository gate, and two-process provisioning e2e are green locally. The
source-paired hosted flow also passed. Path-mode provider
surfaces include SCIM for both provider
profiles at `/e/<environment>/scim/v2`, bounded Entra Graph reads at
`/e/<environment>/graph/v1.0`, and bounded Okta Users/Groups/lifecycle routes at
`/e/<environment>/api/v1`. The M6 source candidate also mounts bounded Okta Classic
primary authentication at `/e/<environment>/api/v1/authn`. Entra and Okta token
endpoints also have local refresh
redemption/rotation coverage. The bounded M3 subset has exact-revision hosted-CI and
deployed evidence; M5 has a separate source-paired hosted acceptance record, while M6
Authn does not yet have hosted or deployed evidence.

Save a local CLI profile without putting the key directly in the command line:

```sh
export MOCKOS_API_KEY=local-mockos-only

printf '%s' "$MOCKOS_API_KEY" | node packages/cli/dist/bin.js login \
  --endpoint http://127.0.0.1:8787/mcp \
  --profile local \
  --api-key-stdin

node packages/cli/dist/bin.js doctor --profile local
node packages/cli/dist/bin.js mcp tools --profile local --json
```

Profiles are stored with owner-only permissions in
`${XDG_CONFIG_HOME:-~/.config}/mockos/config.json`. Keep that file out of Git and
never reuse a production credential for local development.

`doctor` should advertise `simulate_lifecycle` before a source workflow depends on it.
After seeding a synthetic User, apply a provider-valid transition with:

```sh
node packages/cli/dist/bin.js lifecycle simulate \
  --profile local \
  --env env_replace_me \
  --user usr_replace_me \
  --action disable \
  --json
```

SCIM and Graph accept non-empty synthetic Bearer values; the Okta directory API accepts
a non-empty synthetic SSWS value. Those checks are for protocol tests, not production
authorization. Never use the MCP Access Key as a directory or outbound target token.
The M5 CLI and runtime reject an outbound target Bearer equal to the exact active
self-host `API_KEY`, even when it has no `mk_` prefix. A later key rotation that
collides with a saved target also fails before the outbound request; choose distinct,
synthetic values rather than relying on this guard.
UserInfo, the rest of the Okta Classic transaction machine, and broad Graph/Okta API
compatibility remain unavailable. Outbound provisioning has tested public-HTTPS target
and SSRF constraints plus separate M5 hosted acceptance; see
[known limitations](./known-limitations.md).

## Deploy your Worker

Validate target isolation and render the production Worker without changing remote
state:

```sh
pnpm worker:check
pnpm worker:dry-run
pnpm --filter @mockos/worker exec wrangler deploy --dry-run --env staging
```

A dry run does not create resources or prove a reachable service. A Worker that does
not exist yet cannot accept `wrangler secret put`. For each target's first deployment,
create a different `API_KEY` in an owner-readable temporary dotenv file outside the
repository, then pass that file only to the intended deployment:

```sh
pnpm --filter @mockos/worker exec wrangler deploy --env staging \
  --secrets-file /absolute/path/to/staging-secrets.env
pnpm --filter @mockos/worker exec wrangler deploy \
  --secrets-file /absolute/path/to/production-secrets.env
```

Each file has dotenv syntax (`API_KEY=<unique-random-value>`). Set mode `0600`, never
place the file in Git or the secret value directly in a shell argument, and securely
remove the file immediately after the deploy succeeds. For later secret rotations,
after the Worker exists, use Wrangler's interactive prompt for the intended target:

```sh
pnpm --filter @mockos/worker exec wrangler secret put API_KEY --env staging
pnpm --filter @mockos/worker exec wrangler secret put API_KEY
```

These commands mutate the authenticated Cloudflare account. Confirm the account and
target before running them, then execute the authenticated smoke against that exact
origin. A self-deployment proves only the revision and checks you ran; it is not the
project's M3 acceptance record. The repository's reference deployment is live in
workers.dev path mode at:

- `https://mockos-staging.workspaceagent.workers.dev`
- `https://mockos.workspaceagent.workers.dev`

Its keys are deliberately not public. The sanitized production and staging results
are recorded in the
[M3 workers.dev smoke evidence](./evidence/m3-workers-dev-smoke.md). That record
establishes only the bounded sampled M3 routes and does not qualify every fixture,
live-provider parity, an authenticated M5 flow using the preserved standalone public
Worker Access Keys,
or a service-level commitment.

## Distribution limits

The `@mockos` npm scope is retained as the locked package name, but it is not confirmed
registered and npm authentication currently fails. Consume workspace packages from
source until npm authentication and scope registration are resolved; do not assume
`pnpm add @mockos/...` works.

workers.dev path mode cannot provide provider-shaped wildcard hosts. Custom
`mockos.live` routing, wildcard certificates, and subdomain compatibility remain M8
work after domain purchase.
