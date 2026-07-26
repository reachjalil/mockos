# Test Okta Classic MFA through OIDC with Okta Auth JS

Status: Bounded `@okta/okta-auth-js` 8.0.1 Classic factor-to-OIDC local
actual-network D/I/S/X/Q passed; H/V/P remain unqualified
Last reviewed: 2026-07-26

Use this guide to reproduce one exact application journey: Okta Auth JS starts a
Classic Authentication API transaction, follows the returned factor-verification
link, exchanges the resulting one-use `sessionToken` for an authorization code with
S256 PKCE, verifies the ID token through discovery and JWKS, rotates the refresh
token, revokes the refreshed access token, and observes refresh rejection after an
MCP-managed User suspension.

Management remains on MCP. Classic Authn and OIDC are provider data planes called by
the application under test; do not send the management Access Key to them.

The factor is deliberately synthetic. mockOS accepts only the static passcode
`000000` for the seeded synthetic TOTP-shaped factor. This deterministic input does
not implement or qualify RFC 6238, a shared TOTP secret, time steps, drift windows,
factor enrollment, or a real authenticator.

The linked factor transaction also does not elevate token assurance claims. Tokens
retain `acr: "urn:okta:loa:1fa:any"` and `amr: ["pwd"]`. This qualification proves
that a verified-factor transaction can enter the OIDC code/PKCE flow; it does not
claim MFA-assurance-token parity.

The evidence boundary for this candidate is:

| Level | Result | Exact meaning |
| --- | --- | --- |
| Designed (D) | Yes | The Classic factor, one-use session, OIDC, management, observation, and cleanup boundaries are explicit and use Okta documentation reviewed on 2026-07-26 as design provenance. |
| Implemented (I) | Yes | The mounted factor route and validation-before-one-use session-token authorization bridge completed the exact journey. |
| Source-tested (S) | Yes | Focused core, HTTP-adapter, Worker, contract, type, and static checks passed; the complete repository gate remains a separate final handoff gate. |
| Integration-tested (X) | Yes | The exact clients traversed an actual HTTPS socket into local `wrangler dev`, its Durable Objects, MCP transport, and provider routes. |
| SDK/client-qualified (Q) | Yes | Pinned `@okta/okta-auth-js` 8.0.1 and `@modelcontextprotocol/sdk` 1.29.0 completed the journey. |
| Hosted-smoke (H) | No | No exact remote Worker version or Cloud endpoint has run this journey. |
| Verified-live (V) | No | No sanitized comparison with a real Okta organization exists. |
| Production-ready (P) | No | Distribution, operated-service policy, rollout, browser UX, broad client compatibility, and assurance-claim parity remain outside this record. |

The final reproducible result belongs in the
[local qualification record](../evidence/okta-auth-js-local-qualification.md).

## Prerequisites

- Node.js 22.12 or newer and pnpm 10.30.2;
- dependencies installed from the repository lockfile;
- port `8796` and inspector port `18796` available on loopback, or free alternatives
  supplied through `MOCKOS_OKTA_MFA_AUTHJS_E2E_PORT` and
  `MOCKOS_OKTA_MFA_AUTHJS_E2E_INSPECTOR_PORT`; and
- synthetic identities and credentials only.

Do not provide a production Okta organization, user password, API token, OAuth token,
Cloud Access Key, or confidential-client secret. The harness creates disposable local
values and removes its environment and temporary certificate material.

## Run the complete local qualification

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm e2e:okta-mfa-authjs
pnpm e2e:okta-mfa-authjs-cleanup
```

The thin provider wrapper configures the shared actual-network parent to start:

```text
wrangler dev --local --ip 127.0.0.1 --port 8796 --local-protocol https
```

For readiness, the parent captures Wrangler's generated leaf certificate, validates
its `localhost` hostname, and requires an unpredictable ownership nonce from the
exact child it started. It writes the certificate to a mode-`0600` temporary CA file
and passes that file to the client through `NODE_EXTRA_CA_CERTS`. This adds trust
alongside Node's standard trust roots; it is not exclusive certificate pinning. The
client independently requires an HTTPS `localhost` origin and the same nonce. TLS
verification remains enabled.

The parent and cleanup verifier reject an inherited
`NODE_TLS_REJECT_UNAUTHORIZED=0` and strip it from child environments. The normal and
failure paths remove temporary trust and persistence state.

A successful provider run ends with:

```json
{
  "ok": true,
  "claim": "okta-authjs-classic-mfa-session-token-authorization-code-pkce",
  "oktaAuthJsVersion": "8.0.1",
  "clientType": "public",
  "networkBoundary": "wrangler-dev-https",
  "managementInterface": "mcp-streamable-http",
  "environmentDeleted": true,
  "providerSequenceMatched": 1,
  "providerRequestCount": 9,
  "tokenStatuses": [200, 200, 400],
  "factorType": "token:software:totp",
  "lifecycleAction": "suspend",
  "lifecycleErrorCode": "invalid_grant",
  "mfaProvenanceClaim": "not-qualified-existing-1fa-claims-preserved",
  "logRedaction": "raw-url-form-encoded-and-structural-sensitive-field-verification"
}
```

This is local X/Q evidence only. An expected shape, a contract-only test, or the
earlier non-MFA Auth JS run would not qualify this journey.

## Configure the journey through MCP

The harness connects `@modelcontextprotocol/sdk` 1.29.0 to `/mcp` over Streamable
HTTP. It discovers the registry with `tools/list`, then uses:

1. `create_environment`;
2. `seed_identities`;
3. `create_application`;
4. `get_wellknown_urls`;
5. `assert_requests` and `get_request_log`;
6. `simulate_lifecycle`; and
7. `delete_environment`.

Seed one active synthetic Okta User with a valid password and
`mfaState: "required"`. Create a public application with an exact callback:

```js
const application = await callTool("create_application", {
  environmentId,
  name: "Okta Auth JS Classic MFA PKCE client",
  clientType: "public",
  redirectUris: ["https://client.example.test/mockos-okta-mfa-callback"],
  grantTypes: ["authorization_code", "refresh_token"],
});
```

The response must contain `clientType: "public"` and no `clientSecret`. Public
registrations cannot supply a secret or request `client_credentials`. Use the exact
`issuer` and `oktaAuthnEndpoint` returned by `get_wellknown_urls`; never reconstruct
or persist an origin from memory.

The management Access Key is confined to the MCP transport. Never forward it to the
Authn, factor, authorization, token, JWKS, or revocation route.

## Configure Okta Auth JS exactly

The qualified Node harness uses in-memory transaction and token managers:

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

The issuer contains `/oauth2/default`. Auth JS 8.0.1 derives its Classic Authn
origin by removing that authorization-server suffix, so
`signInWithCredentials` reaches the returned environment-specific
`/api/v1/authn` route.

This design follows the upstream
[Authentication API](https://developer.okta.com/docs/reference/api/authn/),
[session-token authorization guide](https://developer.okta.com/docs/guides/session-cookie/-/main/),
and [Okta Auth JS repository](https://github.com/okta/okta-auth-js), reviewed on
2026-07-26. Those sources are design provenance, not verified-live evidence. The
executable authority is the pinned 8.0.1 client against the mounted candidate.

## Verify the returned Classic factor

Start the Classic transaction through the official SDK:

```js
const transaction = await authClient.signInWithCredentials({
  username: "ada@example.test",
  password: syntheticPassword,
});
```

Require:

- `transaction.status === "MFA_REQUIRED"`;
- exactly one TOTP-shaped entry in `transaction.factor`; and
- the factor's SDK-generated verification function to target the exact returned URL
  under the owned environment's Authn endpoint.

The wire response uses the provider-shaped singular `_embedded.factor` property
containing an array. Auth JS projects that array as `transaction.factor`.

Follow the returned link through the SDK:

```js
const success = await transaction.factor[0].verify({
  passCode: "000000",
});
```

Auth JS posts `stateToken` and `passCode` to:

```text
POST /api/v1/authn/factors/{factorId}/verify
```

Exact outcomes:

- correct factor, live state, valid password, and `000000` return HTTP 200 `SUCCESS`
  with the User, `expiresAt`, and a one-use `sessionToken`;
- if the MFA-required User is also password-expired, correct verification returns
  `PASSWORD_EXPIRED` with the same live `stateToken`, refreshed bounded expiry,
  mounted cancel, and no session capability; repeating factor verification returns
  `E0000011` without deleting that transaction, so retrieval and cancel still work;
- a wrong factor or passcode returns HTTP 403 `E0000068`,
  `Invalid Passcode/Answer`, without consuming the state; and
- an invalid, expired, cancelled, or already-consumed state returns HTTP 401
  `E0000011`.

Keep `stateToken`, `passCode`, and `sessionToken` in memory only. Do not blindly retry
an ambiguous verification POST after a transport failure because the first request
could have consumed the one-time transaction.

## Enter OIDC with the one-use session token

Pass the successful session capability to the redirect transaction:

```js
await authClient.token.getWithRedirect({
  sessionToken: success.sessionToken,
  state,
  nonce,
  scopes: ["openid", "profile", "email", "offline_access"],
});
```

The authorization endpoint validates the application, exact redirect URI, requested
scope, response type, and S256 challenge before consuming the session capability. A
valid request returns HTTP 302 directly to the callback with `code` and `state`;
there is no hosted-login GET/POST in this journey. Reusing the same `sessionToken`
returns OAuth `invalid_grant`.

In Node, `parseFromUrl` otherwise dereferences `window`, so the exact 8.0.1 harness
assigns the SDK-exposed location seam and passes the callback URL:

```js
authClient.token.parseFromUrl._getLocation = () => new URL(redirectUri);
const initial = await authClient.token.parseFromUrl({
  url: callback.href,
});
```

`parseFromUrl` validates state, exchanges the code, fetches JWKS, verifies the RS256
ID token, and returns tokens. The harness checks the exact issuer, audience, subject,
username, email, and nonce. It does not qualify access-token signature validation or
UserInfo.

It also checks the deliberate assurance boundary:

```text
acr = urn:okta:loa:1fa:any
amr = ["pwd"]
```

Do not rewrite those values as MFA assurance merely because factor verification
preceded code issuance.

## Rotate, revoke, and apply lifecycle policy

Rotate the refresh token and revoke the refreshed access token:

```js
const refreshed = await authClient.token.renewTokens({
  tokens: initial.tokens,
});

await authClient.token.revoke(refreshed.accessToken);
```

Require a different replacement refresh token and HTTP 200 revocation. Because that
status is idempotent, also require the following MCP `suspend` result to revoke
exactly one remaining access token; two would mean the SDK revocation did not change
the refreshed token's state.

Calling `renewTokens` after suspension must fail with Okta Auth JS `OAuthError`, code
`invalid_grant`, and `User account is disabled.`. Reactivation does not restore an
already revoked refresh family; begin a new transaction instead.

## Inspect exact evidence without exposing capabilities

The accepted harness matched exactly this ordered provider sequence:

1. Classic Authn `POST` → `200 MFA_REQUIRED`;
2. returned factor-verification `POST` → `200 SUCCESS`;
3. discovery `GET` → `200`;
4. authorization with `sessionToken` `GET` → `302`;
5. authorization-code token `POST` → `200`;
6. JWKS `GET` → `200`;
7. refresh token `POST` → `200`;
8. access-token revocation `POST` → `200`; and
9. post-suspend refresh token `POST` → `400`.

The harness requires exactly three token requests with statuses
`[200, 200, 400]`. It parses the retained Authn, factor, authorization, callback,
token, refresh, revocation, and token-response structures and requires
`[REDACTED]` for exercised secret-bearing fields. It also rejects raw,
`encodeURIComponent`, and `URLSearchParams` form-encoded representations of every
exercised password, state token, passcode, session token, code, PKCE verifier, and
initial/refreshed token value.

That is exact named-field and exact-representation evidence, not arbitrary-encoding
classification or a general log-security audit. Safe method, path, status, ordering,
and non-secret protocol fields remain assertable.

## Cleanup and common failures

The normal path deletes the environment through MCP, terminates the MCP transport,
stops the owned Wrangler process tree, and removes temporary state. The `finally`
path attempts the same cleanup after a failed assertion.

- Run `pnpm e2e:okta-mfa-authjs-cleanup` after changing the shared process, signal,
  timeout, certificate, or temporary-state handling. It does not qualify uncatchable
  `SIGKILL`, Windows process-tree behavior, abrupt machine loss, or every interruption
  point during an active SDK request.
- If Authn returns `SUCCESS` immediately, confirm the seeded User has
  `mfaState: "required"`.
- If factor verification returns `E0000068`, use the returned factor and the exact
  synthetic passcode `000000`. A previous wrong passcode should not consume the
  state.
- If verification returns `E0000011`, start a new Authn transaction. Do not reuse an
  expired, cancelled, or consumed state token.
- If authorization returns `invalid_grant`, start a new Authn transaction and verify
  the session token has not already been consumed.
- If code redemption fails, confirm callback, scopes, state, code, and PKCE verifier
  belong to one transaction.
- If TLS fails, run the parent command rather than the client script directly. The
  parent owns the Worker and process-local trust.
- If the port is occupied, select free provider and inspector ports, for example:

  ```sh
  MOCKOS_OKTA_MFA_AUTHJS_E2E_PORT=8896 \
    MOCKOS_OKTA_MFA_AUTHJS_E2E_INSPECTOR_PORT=18896 \
    pnpm e2e:okta-mfa-authjs
  ```

## Deliberately unsupported by this qualification

This record does not qualify:

- RFC 6238/TOTP generation or verification, factor enrollment, warnings, push, SMS,
  WebAuthn, recovery, password-change execution, or unlock execution;
- the Okta Sessions API, an Okta browser session cookie, or downstream application
  cookies—the `sessionToken` is consumed directly by the bounded authorization route;
- MFA-assurance ID/access-token claims; current tokens deliberately retain one-factor
  `acr` and password-only `amr`;
- password-expired or locked-out continuation links, which are omitted until their
  routes exist;
- browser callback UX, Sign-In Widget, IDX, browser storage, distributed transaction
  storage, concurrent tabs, or another Auth JS version;
- device authorization, UserInfo, public introspection, client credentials,
  access-token signature validation, DPoP, or sender-constrained refresh tokens; or
- hosted Cloud, workers.dev, custom domains, a real Okta organization, broad
  claims/error parity, or production readiness.

Read the [Okta behavior ledger](../identity/okta.md) and
[provider parity matrix](../conformance/parity-matrix.md) before expanding the claim.
