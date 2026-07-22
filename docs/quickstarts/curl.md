# Entra OIDC curl walkthrough

Status: Accepted M3 path-mode identity walkthrough; M5 provisioning evidence is documented separately
Last reviewed: 2026-07-22

This walkthrough uses only synthetic data. It exercises the authenticated HTTP control
routes and the same public protocol routes as the
[Worker integration test](../../apps/worker/test/oidc.integration.test.ts). The main
hosted-login and bounded directory/lifecycle sequence has exact-revision M3 deployment
evidence. A later section probes accepted M3 SCIM, Graph, refresh, and lifecycle behavior.
The source-built CLI is documented in the [CLI guide](../../packages/cli/README.md).

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

Those live origins passed the bounded M3 acceptance recorded in
[M3 workers.dev smoke evidence](../evidence/m3-workers-dev-smoke.md). That smoke did
not exercise every command or fixture, and it is not a live-provider parity result.

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
  --data "{\"name\":\"curl PKCE client\",\"clientId\":\"$MOCKOS_CLIENT\",\"clientSecret\":\"$MOCKOS_CLIENT_SECRET\",\"redirectUris\":[\"$MOCKOS_REDIRECT\"],\"grantTypes\":[\"authorization_code\",\"refresh_token\"],\"appRoles\":[],\"groupClaimsMode\":\"none\"}" \
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
  --data-urlencode 'scope=openid profile email offline_access' \
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
  --data-urlencode 'scope=openid profile email offline_access' \
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

## Probe the accepted M3 directory and lifecycle surface

Keep `MOCKOS_ORIGIN=http://127.0.0.1:8787` for this section. SCIM and Graph use
non-empty synthetic Bearer values that check only scheme and presence; they are not
real provider tokens. Never substitute `MOCKOS_API_KEY` as a protocol credential.

Inspect SCIM discovery and the seeded User:

```sh
curl --fail-with-body \
  --header 'Authorization: Bearer synthetic-scim-token' \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/scim/v2/ServiceProviderConfig"

curl --fail-with-body --get \
  --header 'Authorization: Bearer synthetic-scim-token' \
  --data-urlencode 'filter=userName eq "ada@example.test"' \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/scim/v2/Users"
```

The same Entra environment exposes bounded, read-only Graph User/Group views:

```sh
curl --fail-with-body --get \
  --header 'Authorization: Bearer synthetic-graph-token' \
  --data-urlencode '$select=id,displayName,userPrincipalName' \
  --data-urlencode "\$filter=userPrincipalName eq 'ada@example.test'" \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/graph/v1.0/users"
```

For an Okta environment, SCIM uses the same `/scim/v2` path. The bounded Users/Groups
API instead uses a synthetic SSWS value:

```sh
export MOCKOS_OKTA_ENV=replace-with-local-okta-environment-id

curl --fail-with-body \
  --header 'Authorization: SSWS synthetic-okta-api-token' \
  "$MOCKOS_ORIGIN/e/$MOCKOS_OKTA_ENV/api/v1/users"
```

The application and authorization request above permit `refresh_token` and request
`offline_access`. Copy the first token response's synthetic refresh token into
`MOCKOS_REFRESH_TOKEN`, then redeem it once locally:

```sh
export MOCKOS_REFRESH_TOKEN=replace-with-synthetic-refresh-token

curl --fail-with-body --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "client_id=$MOCKOS_CLIENT" \
  --data-urlencode "client_secret=$MOCKOS_CLIENT_SECRET" \
  --data-urlencode "refresh_token=$MOCKOS_REFRESH_TOKEN" \
  "$MOCKOS_ORIGIN/e/$MOCKOS_ENV/$MOCKOS_TENANT/oauth2/v2.0/token"
```

Success returns a replacement refresh token. Reusing the consumed token fails closed
and revokes its family. A provider-valid disable, suspend, deprovision, or delete also
revokes effective tracked credentials. The source CLI reaches that behavior through
the accepted 14-tool M3 MCP runtime; copy the seeded User ID before invoking it:

```sh
pnpm --filter @mockos/cli build
export MOCKOS_USER_ID=replace-with-seeded-user-id

node packages/cli/dist/bin.js doctor \
  --endpoint "$MOCKOS_ORIGIN/mcp" \
  --json
node packages/cli/dist/bin.js lifecycle simulate \
  --endpoint "$MOCKOS_ORIGIN/mcp" \
  --env "$MOCKOS_ENV" \
  --user "$MOCKOS_USER_ID" \
  --action disable \
  --json
```

`doctor` must advertise `simulate_lifecycle`; stop rather than assuming compatibility
if it does not. Entra accepts `activate`, `disable`, `reactivate`, and `delete`; Okta
accepts `activate`, `reactivate`, `suspend`, `unsuspend`, `deprovision`, and `delete`
only from valid states.

## Clean up

```sh
curl --fail-with-body --request DELETE \
  --header "Authorization: Bearer $MOCKOS_API_KEY" \
  "$MOCKOS_ORIGIN/__mockos/v1/environments/$MOCKOS_ENV"
```

The raw control commands passed in the recorded
[M1 Wrangler smoke](../evidence/m1-wrangler-dev-smoke.md). The accepted
[M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) proves the bounded
authenticated MCP, OIDC/JWKS, refresh/lifecycle, directory, scenario, logging,
assertion, and cleanup samples against both staging and production. It does not
establish general Entra SDK parity, execute every command remotely, or deploy the
separately accepted M5 hosted outbound-provisioning flow.
