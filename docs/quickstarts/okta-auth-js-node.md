# Test Okta authorization code with Okta Auth JS

Status: Bounded `@okta/okta-auth-js` 8.0.1 local actual-network and official-client qualification; no hosted, live-provider, or production-readiness claim
Last reviewed: 2026-07-26

Use this guide to reproduce one exact application path: a public Okta Auth JS client
uses a disposable mockOS Okta environment, authorization code with S256 PKCE, ID-token
verification through discovery and JWKS, refresh-token rotation, public access-token
revocation, and lifecycle-revoked refresh. Management stays on MCP; the client sends
only provider traffic to the URLs returned by mockOS.

The qualification level for this exact slice is:

| Level | Result | Exact meaning |
| --- | --- | --- |
| Designed (D) | Yes | The public-client, management, network, token, lifecycle, observation, and cleanup boundaries are explicit. |
| Implemented (I) | Yes | Public registrations, secretless token authentication, owner-bound public revocation, discovery metadata, and the acceptance harness exist. |
| Source-tested (S) | Yes | Contracts, core OAuth, Okta HTTP, MCP, Worker, and cleanup behavior have focused source coverage. |
| Integration-tested (X) | Yes | The exact clients traverse an actual HTTPS socket into local `wrangler dev`, its Durable Objects, MCP transport, and provider routes. |
| SDK/client-qualified (Q) | Yes | `@okta/okta-auth-js` 8.0.1 and `@modelcontextprotocol/sdk` 1.29.0 complete the bounded flow. |
| Hosted-smoke (H) | No | No exact remote Worker version or Cloud endpoint has run this client. |
| Verified-live (V) | No | No real Okta organization was compared. |
| Production-ready (P) | No | Distribution, operated-service policy, rollout, browser UX, and broader SDK guarantees are outside this record. |

The reproducible result and exact output are in the
[local qualification record](../evidence/okta-auth-js-local-qualification.md).

## Prerequisites

- Node.js 22.12 or newer and pnpm 10.30.2;
- dependencies installed from the repository lockfile;
- port `8795` available on loopback, or another free port supplied through
  `MOCKOS_OKTA_AUTHJS_E2E_PORT`; and
- synthetic identities and credentials only.

Do not provide a production Okta organization, user password, API token, OAuth token,
Cloud Access Key, or confidential-client secret. The harness creates disposable local
values and removes its environment and temporary certificate material.

## Run the complete local qualification

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm e2e:okta-authjs
pnpm e2e:okta-authjs-cleanup
```

The provider run and the Entra MSAL run are thin configurations of the same
actual-network parent and signal-cleanup harnesses. The parent starts:

```text
wrangler dev --local --ip 127.0.0.1 --port 8795 --local-protocol https
```

The wrapper also assigns explicit loopback inspector port `18795`, distinct from the
Entra wrapper's `18794`, so the two qualifications can run concurrently.

For readiness, it captures Wrangler's generated leaf certificate, validates the
`localhost` hostname, and requires an unpredictable ownership nonce from the exact
child it started. It writes the certificate to a mode-`0600` temporary CA file and
passes that file to the client through `NODE_EXTRA_CA_CERTS`. This adds trust alongside
Node's standard trust roots; it is not exclusive certificate pinning. The client
independently requires an HTTPS `localhost` origin and the same nonce. TLS verification
remains enabled, and temporary trust and persistence state are deleted at cleanup.
The shared parent and cleanup verifier reject an inherited
`NODE_TLS_REJECT_UNAUTHORIZED=0` and strip it from child environments; focused
negative guards protect both rules.

A successful provider run ends with:

```json
{
  "ok": true,
  "claim": "okta-authjs-public-authorization-code-pkce",
  "oktaAuthJsVersion": "8.0.1",
  "clientType": "public",
  "networkBoundary": "wrangler-dev-https",
  "managementInterface": "mcp-streamable-http",
  "environmentDeleted": true,
  "providerSequenceMatched": 1,
  "tokenStatuses": [200, 200, 400],
  "revocationStatus": 200,
  "lifecycleAction": "suspend",
  "lifecycleErrorCode": "invalid_grant",
  "logRedaction": "raw-url-form-encoded-and-structural-sensitive-field-verification"
}
```

This is local X/Q evidence. A future hosted-CI run would remain source execution; H
requires a separately recorded run against an exact remote serving version.

The cleanup command starts the same parent/Worker boundary on a free loopback port,
waits until the owned HTTPS Worker and temporary state are ready, and sends `SIGTERM`
to the parent. It succeeds only when the parent exits `143`, the port can be rebound,
the separate inspector port can also be rebound, the detached Wrangler process group
is gone, and the temporary state is removed.

## Keep management on MCP

The harness connects `@modelcontextprotocol/sdk` to `/mcp` over Streamable HTTP. It
discovers the registry with `tools/list`, then uses:

1. `create_environment`;
2. `seed_identities`;
3. `create_application`;
4. `get_wellknown_urls`;
5. `assert_requests` and `get_request_log`;
6. `simulate_lifecycle`; and
7. `delete_environment`.

The management Access Key is confined to the MCP transport. Never forward it to the
Okta issuer, hosted sign-in form, token, JWKS, or revocation endpoint.

## Register a public client

Pass `clientType: "public"` and omit `clientSecret`:

```js
const application = await callTool("create_application", {
  environmentId,
  name: "Okta Auth JS public PKCE client",
  clientType: "public",
  redirectUris: ["https://client.example.test/mockos-okta-callback"],
  grantTypes: ["authorization_code", "refresh_token"],
});
```

The response includes `clientType: "public"` and no `clientSecret`. Public
registrations cannot supply a secret or request `client_credentials`. Confidential is
the default for backward compatibility and still returns a creation-only synthetic
secret.

The official SDK `tools/list` schema exposes those rules rather than relying on prose:
its strict object input keeps defaulted fields optional, applies a JSON Schema Draft-7
`if`/`then` public condition that forbids `clientSecret` and narrows grants, and
publishes separate public/confidential output branches. The public output branch has no
secret property.

mockOS discovery advertises `none` for Okta token and revocation endpoint
authentication. Introspection remains confidential and advertises only
`client_secret_basic` and `client_secret_post`. A public client therefore cannot use
introspection to inspect its tokens.

Public revocation is intentionally narrower than anonymous revocation: the caller must
identify the owning public `clientId`, and only tokens belonging to that application
can change. The pinned Auth JS client sends its client-ID-only Basic compatibility
shape without a secret; mockOS accepts that as public `none` authentication. A secret,
another client ID, or an unknown client does not broaden access.

## Configure Okta Auth JS exactly

Use the `issuer` and redirect URI returned or registered through MCP. The qualified
Node harness uses in-memory transaction and token managers:

```js
import { OktaAuth } from "@okta/okta-auth-js";

let authorizationLocation;
const authClient = new OktaAuth({
  issuer: wellKnownUrls.issuer,
  clientId: application.clientId,
  redirectUri,
  scopes: ["openid", "profile", "email", "offline_access"],
  pkce: true,
  responseMode: "query",
  setLocation(location) {
    authorizationLocation = location;
  },
  tokenManager: {
    storage: "memory",
    autoRenew: false,
    autoRemove: false,
    syncStorage: false,
  },
  transactionManager: {
    storage: "memory",
  },
});
```

Okta documents redirect-driven authorization, PKCE, and Node support in the
[Okta Auth JS repository](https://github.com/okta/okta-auth-js). This qualification is
pinned to 8.0.1; it is not a version-range claim.

## Exercise redirect, PKCE, JWKS, refresh, revoke, and lifecycle

Start the transaction with the official client:

```js
await authClient.token.getWithRedirect({
  state,
  nonce,
  loginHint: "ada@example.test",
  scopes: ["openid", "profile", "email", "offline_access"],
});
```

The harness requires `authorizationLocation`, verifies the request uses S256, and
confirms the transaction manager retained the matching verifier and challenge. It then
performs the mock hosted-login GET and POST over the real local HTTPS socket.

In a browser, `parseFromUrl` reads the callback location from `window`. The qualified
Node harness has no browser global, so it assigns the SDK-exposed
`authClient.token.parseFromUrl._getLocation` seam to return the synthetic callback URL,
then passes that same URL explicitly:

```js
authClient.token.parseFromUrl._getLocation = () => new URL(redirectUri);
const initial = await authClient.token.parseFromUrl({
  url: callback.href,
});
```

This seam is part of this exact Node acceptance harness, not a recommendation for
browser production code or a promise across Okta Auth JS versions. In the qualified
flow, `parseFromUrl` validates state, exchanges the code, fetches JWKS, verifies the
RS256 ID token, and returns tokens. The harness checks `iss`, `aud`, `sub`,
`preferred_username`, `email`, and `nonce`. It does not claim access-token signature
validation or UserInfo behavior.

Rotate refresh tokens and revoke the refreshed access token through the public client:

```js
const refreshed = await authClient.token.renewTokens({
  tokens: initial.tokens,
});

await authClient.token.revoke(refreshed.accessToken);
```

The harness requires a different replacement refresh token and HTTP 200 revocation.
Because RFC 7009-style 200 can be idempotent, it also requires the subsequent
lifecycle result to revoke exactly one remaining access token; two would mean the SDK
revocation did not change the refreshed token's state. It then tries `renewTokens`
again. The exact
expected error is Okta Auth JS `OAuthError`, code `invalid_grant`, with
`User account is disabled.`. Reactivation would not restore an already revoked refresh
family; begin a new authorization flow instead.

## Inspect exact evidence without exposing credentials

The accepted ordered provider sequence is:

1. discovery `GET` → `200`;
2. authorization `GET` → `200`;
3. hosted sign-in `POST` → `302`;
4. authorization-code token `POST` → `200`;
5. JWKS `GET` → `200`;
6. refresh token `POST` → `200`;
7. access-token revocation `POST` → `200`; and
8. post-suspend refresh token `POST` → `400`.

The durable log contains exactly three token requests with statuses
`[200, 200, 400]`. The harness parses the retained forms, callback location, and token
responses and requires `[REDACTED]` in the exercised password, code, verifier, refresh,
revocation-token, and token-response fields. It also scans for the raw,
`encodeURIComponent`, and `URLSearchParams` form-encoded representation of the
synthetic password, authorization code, PKCE verifier, initial access/ID/refresh
tokens, and refreshed access/refresh tokens.

That is exact named-field and exact-representation evidence, not arbitrary-encoding or
general content-classification coverage. Method, path, status, ordering, and safe
structured fields remain assertable.

## Cleanup and common failures

The normal path deletes the environment through MCP, terminates the MCP transport,
stops the owned Wrangler process tree, and removes temporary state. The `finally` path
attempts the same cleanup after a failed assertion.

- Run `pnpm e2e:okta-authjs-cleanup` after changing the shared process, signal,
  timeout, certificate, or temporary-state handling. It does not qualify uncatchable
  `SIGKILL`, Windows process-tree behavior, abrupt machine loss, or every interruption
  point during an active SDK request.
- If the issuer is rejected, use `get_wellknown_urls`; do not construct or persist a
  remembered origin.
- If TLS fails, run the parent command rather than the client script directly. The
  parent owns the Worker and adds only its validated local certificate to child trust.
- If the port is occupied, choose a free loopback port, for example
  `MOCKOS_OKTA_AUTHJS_E2E_PORT=8895 pnpm e2e:okta-authjs`.
- If code redemption fails, confirm the callback, scopes, state, code, and PKCE
  verifier belong to one transaction. Authorization codes are short-lived and
  one-time.
- If revocation fails, confirm the registration is public, the token belongs to that
  client, and no client secret was supplied.
- `invalid_grant` with `User account is disabled.` is expected only after the harness
  suspends the User.

## Deliberately unsupported by this qualification

This record does not qualify browser callback UX, Sign-In Widget, IDX, Classic Authn,
Sessions, Factors, device authorization, UserInfo, introspection by a public client,
client credentials, DPoP or sender-constrained refresh tokens, a different Auth JS
version, hosted Cloud, workers.dev, custom domains, a real Okta organization, broad
error/claim parity, or production readiness. Read the
[Okta behavior ledger](../identity/okta.md) and
[provider parity matrix](../conformance/parity-matrix.md) before expanding the claim.
