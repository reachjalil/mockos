# Self-hosting

Status: M2 source-build and deployment guide; npm and custom-domain distribution remain unavailable
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

Save a local CLI profile without putting the key directly in the command line:

```sh
export MOCKOS_API_KEY=local-mockos-only

printf '%s' "$MOCKOS_API_KEY" | node packages/cli/dist/bin.js login \
  --endpoint http://127.0.0.1:8787/mcp \
  --profile local \
  --api-key-stdin

node packages/cli/dist/bin.js doctor --profile local
```

Profiles are stored with owner-only permissions in
`${XDG_CONFIG_HOME:-~/.config}/mockos/config.json`. Keep that file out of Git and
never reuse a production credential for local development.

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
origin. The repository's reference deployment is live in workers.dev path mode at:

- `https://mockos-staging.workspaceagent.workers.dev`
- `https://mockos.workspaceagent.workers.dev`

Its keys are deliberately not public. The sanitized production and staging results
are recorded in the
[M2 workers.dev smoke evidence](./evidence/m2-workers-dev-smoke.md).

## Distribution limits

The `@mockos` npm scope is retained as the locked package name, but it is not confirmed
registered and npm authentication currently fails. Consume workspace packages from
source until the M4 publishing prerequisite is resolved; do not assume
`pnpm add @mockos/...` works.

workers.dev path mode cannot provide provider-shaped wildcard hosts. Custom
`mockos.live` routing, wildcard certificates, and subdomain compatibility remain M8
work after domain purchase.
