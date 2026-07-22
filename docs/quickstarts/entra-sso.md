# Test Entra SSO

Status: Accepted M3 Entra code, refresh, directory, and lifecycle flow in workers.dev path mode; live-provider parity is not claimed
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

## M3 refresh and directory follow-on

The accepted staging deployment advertises the 14-tool M3 registry, including
`simulate_lifecycle`. A local profile can exercise the same flow from source; always
use `doctor` to negotiate the capability before depending on it.

Register an application permitting `authorization_code` and `refresh_token`, request
`offline_access`, and redeem the returned refresh token once. The replacement rotates
within the same family; scope escalation and replay fail closed. Then use the synthetic
User ID returned by `seed` to exercise the Entra lifecycle cascade:

```sh
node packages/cli/dist/bin.js lifecycle simulate \
  --profile local \
  --env env_replace_me \
  --user usr_replace_me \
  --action disable \
  --json
```

The result reports the previous/current state, resource version and ETag, and effective
access/refresh-token revocation counts. A subsequent refresh for that User must fail
with Entra-shaped `invalid_grant` / `AADSTS50057`. The local path-mode environment also
offers `/e/<environment>/scim/v2` for inbound SCIM and
`/e/<environment>/graph/v1.0` for bounded read-only directory queries. Use separate
non-empty synthetic Bearer values for those test surfaces, never the MCP Access Key.
The [curl walkthrough](./curl.md) contains concise probes.

Do not use real passwords, tenants, or tokens. The repository
[integration test](../../apps/worker/test/oidc.integration.test.ts) demonstrates these
steps under the Cloudflare Workers test runtime. The
[M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) records the bounded deployed
production and staging flow, including refresh/lifecycle behavior, JWT verification,
directory samples, and cleanup. This evidence does not claim arbitrary Entra client or
SDK compatibility or live-provider parity. Client credentials, device flow, UserInfo,
the locally qualified but undeployed M5 outbound provisioning source candidate, and
provider-shaped custom domains remain outside this quickstart.
