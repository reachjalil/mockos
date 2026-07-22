# Entra OIDC curl walkthrough

Status: M2 source and workers.dev path-mode flow implemented; evidence linked below
Last reviewed: 2026-07-22

This walkthrough uses only synthetic data. It exercises the authenticated HTTP control
routes and the same public protocol routes as the
[Worker integration test](../../apps/worker/test/oidc.integration.test.ts). The M2
remote MCP interface is the preferred automation surface; the source-built CLI is
documented in the [CLI guide](../../packages/cli/README.md).

## Choose a Worker

For a local Worker, create an ignored `apps/worker/.dev.vars` containing a
development-only key:

```dotenv
API_KEY=local-mockos-only
```

Then start Wrangler:

```sh
pnpm --filter @mockos/worker dev
```

In a second terminal, define stable fixture values:

```sh
export MOCKOS_ORIGIN=http://127.0.0.1:8787
export MOCKOS_API_KEY=local-mockos-only
export MOCKOS_ENV="env_$(node --input-type=module -e 'process.stdout.write(crypto.randomUUID().replaceAll("-", "").slice(0, 20))')"
export MOCKOS_TENANT=0f6f4756-741d-4a4b-83b2-5f2e37ec621d
export MOCKOS_CLIENT=mockos-curl-client
export MOCKOS_CLIENT_SECRET=mockos-curl-secret
export MOCKOS_REDIRECT=https://client.example/callback
```

To target the live staging path-mode Worker instead, replace `MOCKOS_ORIGIN` with:

```sh
export MOCKOS_ORIGIN=https://mockos-staging.workspaceagent.workers.dev
```

The production origin is `https://mockos.workspaceagent.workers.dev`. Either live
target also requires its operator-provided Access Key in `MOCKOS_API_KEY`; no shared
key is published. Never enter a Cloudflare credential, production identity, or real
application secret into this walkthrough. A missing server-side `API_KEY` fails closed
with `503`, while a missing or incorrect client credential receives `401`.

## Configure synthetic state

Create the environment:

```sh
curl --fail-with-body --request PUT \
  --header "Authorization: Bearer $MOCKOS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"id\":\"$MOCKOS_ENV\",\"name\":\"curl environment\",\"provider\":\"entra\",\"seed\":\"curl-seed\",\"tenantId\":\"$MOCKOS_TENANT\",\"createdAt\":\"2026-07-22T00:00:00.000Z\",\"idleTtlHours\":168,\"requestLogLimit\":10000}" \
  "$MOCKOS_ORIGIN/__mockos/v1/environments/$MOCKOS_ENV"
```

Seed one user:

```sh
curl --fail-with-body --request POST \
  --header "Authorization: Bearer $MOCKOS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"users":[{"userName":"ada@example.test","displayName":"Ada Lovelace","givenName":"Ada","familyName":"Lovelace","password":"Passw0rd!","active":true,"mfaState":"none","roles":[]}],"groups":[]}' \
  "$MOCKOS_ORIGIN/__mockos/v1/environments/$MOCKOS_ENV/identities:seed"
```

Register the application:

```sh
curl --fail-with-body --request POST \
  --header "Authorization: Bearer $MOCKOS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "{\"name\":\"curl PKCE client\",\"clientId\":\"$MOCKOS_CLIENT\",\"clientSecret\":\"$MOCKOS_CLIENT_SECRET\",\"redirectUris\":[\"$MOCKOS_REDIRECT\"],\"grantTypes\":[\"authorization_code\"],\"appRoles\":[],\"groupClaimsMode\":\"none\"}" \
  "$MOCKOS_ORIGIN/__mockos/v1/environments/$MOCKOS_ENV/applications"
```

Fetch discovery and confirm its absolute URLs use `MOCKOS_ORIGIN`:

```sh
curl --fail-with-body \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/v2.0/.well-known/openid-configuration"
```

## Complete hosted login and PKCE

Create a verifier and S256 challenge:

```sh
export MOCKOS_PKCE_VERIFIER=mockos-pkce-verifier-with-at-least-forty-three-characters-123
export MOCKOS_PKCE_CHALLENGE="$(node --input-type=module -e 'const value=process.env.MOCKOS_PKCE_VERIFIER; const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); console.log(Buffer.from(digest).toString("base64url"))')"
```

The authorization GET returns the hosted login page:

```sh
curl --fail-with-body --get \
  --data-urlencode "client_id=$MOCKOS_CLIENT" \
  --data-urlencode "redirect_uri=$MOCKOS_REDIRECT" \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'response_mode=query' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=curl-state' \
  --data-urlencode 'nonce=curl-nonce' \
  --data-urlencode "code_challenge=$MOCKOS_PKCE_CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'login_hint=ada@example.test' \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/oauth2/v2.0/authorize"
```

Submit the synthetic credentials and inspect the `Location` response header:

```sh
curl --silent --show-error --dump-header - --output /dev/null \
  --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=$MOCKOS_CLIENT" \
  --data-urlencode "redirect_uri=$MOCKOS_REDIRECT" \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'response_mode=query' \
  --data-urlencode 'scope=openid profile email' \
  --data-urlencode 'state=curl-state' \
  --data-urlencode 'nonce=curl-nonce' \
  --data-urlencode "code_challenge=$MOCKOS_PKCE_CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'username=ada@example.test' \
  --data-urlencode 'password=Passw0rd!' \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/oauth2/v2.0/authorize"
```

Copy the `code` query value from that synthetic callback into `MOCKOS_CODE`, redeem it
once, and fetch JWKS:

```sh
export MOCKOS_CODE=replace-with-code-from-location

curl --fail-with-body --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "client_id=$MOCKOS_CLIENT" \
  --data-urlencode "client_secret=$MOCKOS_CLIENT_SECRET" \
  --data-urlencode "code=$MOCKOS_CODE" \
  --data-urlencode "redirect_uri=$MOCKOS_REDIRECT" \
  --data-urlencode "code_verifier=$MOCKOS_PKCE_VERIFIER" \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/oauth2/v2.0/token"

curl --fail-with-body \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/discovery/v2.0/keys"
```

The automated integration test additionally verifies the ID-token RS256 signature and
the `iss`, `aud`, `tid`, `oid`, `upn`, and `nonce` claims.

## Clean up

```sh
curl --fail-with-body --request DELETE \
  --header "Authorization: Bearer $MOCKOS_API_KEY" \
  "$MOCKOS_ORIGIN/__mockos/v1/environments/$MOCKOS_ENV"
```

The raw control commands passed in the recorded
[M1 Wrangler smoke](../evidence/m1-wrangler-dev-smoke.md). The later
[M2 workers.dev smoke](../evidence/m2-workers-dev-smoke.md) proves authenticated MCP
setup and cleanup, OIDC/JWKS verification, deterministic scenario injection, request
logging, and assertions against both staging and production. It does not establish
general Entra SDK parity.
