# Test Entra SSO

Status: M2 Entra flow live in workers.dev path mode; compatibility remains bounded
Last reviewed: 2026-07-22

1. Choose a local Worker or a live workers.dev origin from
   [hosting modes](../hosting-modes.md). A live control session requires an
   operator-provided Access Key; the provider protocol URLs do not receive that key.
2. Build the CLI from source and save an MCP profile, or use the authenticated HTTP
   control calls in the [curl walkthrough](./curl.md). The CLI package is not published
   to npm yet.
3. Create a deterministic Entra environment, seed a synthetic user, and register an
   application with one exact callback URI.
4. Read discovery from the environment's tenant authority and configure the
   application under test with that explicit issuer, client ID, secret when
   confidential, and the same callback URI.
5. Begin authorization code flow with `openid profile email`, `state`, `nonce`, and an
   S256 PKCE challenge.
6. Submit the mock hosted sign-in form, redeem the code once, and verify the ID-token
   signature through the discovered JWKS.
7. Assert `iss`, `aud`, `nonce`, `oid`, `tid`, and expiry, then delete the environment
   through the authenticated control interface.

For example, create a staging profile from a source checkout without putting the key
directly on the command line:

```sh
pnpm --filter @mockos/cli build

printf '%s' "$MOCKOS_API_KEY" | node packages/cli/dist/bin.js login \
  --endpoint https://mockos-staging.workspaceagent.workers.dev/mcp \
  --profile staging \
  --api-key-stdin

node packages/cli/dist/bin.js doctor --profile staging
node packages/cli/dist/bin.js env create \
  --profile staging \
  --name entra-sso-test \
  --provider entra \
  --seed entra-sso-test \
  --json
```

Use the returned environment ID for `seed`, `app create`, `wellknown`, and cleanup
commands described in the [CLI guide](../../packages/cli/README.md). Profiles contain
control credentials; keep the owner-only config file out of Git.

Do not use real passwords, tenants, or tokens. The repository
[integration test](../../apps/worker/test/oidc.integration.test.ts) demonstrates these
steps under the Cloudflare Workers test runtime. The
[M2 workers.dev smoke](../evidence/m2-workers-dev-smoke.md) records the corresponding
deployed production and staging flow, including JWT verification and cleanup. This
evidence does not claim arbitrary Entra client or SDK compatibility.
