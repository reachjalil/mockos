# Self-hosting

Status: M0/M1 construction guide; no published package or deployment is claimed  
Last reviewed: 2026-07-22

Prerequisites are Node 22.12 or newer, pnpm 10.30.2, a Cloudflare account for Worker
operations, and Wrangler authentication. Local repository checks do not require a
production domain.

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @mockos/worker dev
```

The final command is useful only after the Worker package and bindings boot. Run
`pnpm worker:check` to validate checked-in target isolation and
`pnpm worker:dry-run` before deployment. A dry run does not create resources or prove
a reachable service.

The `@mockos` npm scope is retained as the locked package name, but it is not confirmed
registered and npm authentication currently fails. Consume workspace packages from
source until the M4 publishing prerequisite is resolved; do not assume
`pnpm add @mockos/...` works.

workers.dev path mode is the first deployment target. Custom `mockos.live` routing,
wildcard certificates, and subdomain compatibility are M8 work after domain purchase.
Never commit Cloudflare tokens or account identifiers. Configure `API_KEY` through
Wrangler secrets when MCP control becomes available.

