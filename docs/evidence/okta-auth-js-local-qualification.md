# Okta Auth JS Classic MFA-to-OIDC local qualification

Status: Bounded local D/I/S/X/Q passed; H/V/P remain unqualified
Last reviewed: 2026-07-26

This record is reserved for one exact client path: `@okta/okta-auth-js` 8.0.1 starts
an Okta Classic Authentication API transaction for an MFA-required synthetic User,
follows the returned factor-verification link, supplies mockOS's fixed synthetic
passcode, receives a one-use `sessionToken`, and enters a public-client authorization
code flow with S256 PKCE. It then performs discovery/JWKS ID-token verification,
rotating refresh, owner-bound public access-token revocation, and lifecycle-revoked
refresh. `@modelcontextprotocol/sdk` 1.29.0 manages the disposable environment over
Streamable HTTP.

The implementation uses Okta's
[Authentication API](https://developer.okta.com/docs/reference/api/authn/),
[session-token authorization guide](https://developer.okta.com/docs/guides/session-cookie/-/main/),
and [Okta Auth JS repository](https://github.com/okta/okta-auth-js), reviewed on
2026-07-26, as design provenance. That review is D input, not V evidence.

The factor is deterministic mock behavior. Only the static passcode `000000` succeeds
for the synthetic TOTP-shaped factor. This is not RFC 6238/TOTP generation or
verification and does not model a shared secret, time step, drift, enrollment,
recovery, or a real authenticator.

The factor chain does not elevate current token claims. ID/access-token behavior
retains `acr: "urn:okta:loa:1fa:any"` and `amr: ["pwd"]`. This record may qualify the
transaction bridge through a verified factor, but it must not be cited as
MFA-assurance-token evidence.

The candidate starts from public revision
`cf8457682776f49322a3dd57623641dbab2dc194` on branch
`codex/okta-mfa-oidc`. It remains working-tree evidence until committed; this record
is not an immutable revision, hosted-CI run, deployment, or release record.

## Eight-level evidence boundary

| Level | Result | Evidence |
| --- | --- | --- |
| Designed (D) | Yes | The bounded Classic factor, one-use session, public OIDC, management, network, lifecycle, observation, and cleanup contracts are explicit in the harness and [quickstart](../quickstarts/okta-auth-js-node.md). |
| Implemented (I) | Yes | The mounted factor route and validation-before-consume one-use session-token authorization bridge completed the exact journey. |
| Source-tested (S) | Yes | Focused core, HTTP-adapter, Worker, contract, type, lint, syntax, and diff checks passed. The complete repository gate was still pending when this record was finalized and remains a handoff gate. |
| Integration-tested (X) | Yes | The real HTTPS loopback path traversed local Wrangler, MCP, routing, Durable Objects, and provider routes. |
| SDK/client-qualified (Q) | Yes | Exact Okta Auth JS 8.0.1 and MCP SDK 1.29.0 clients completed the stated flow. |
| Hosted-smoke (H) | No | No remote Worker, Cloud endpoint, or exact deployed version ran this journey. |
| Verified-live (V) | No | No sanitized comparison with a real Okta organization exists. |
| Production-ready (P) | No | Package distribution, operated-service policy, guarded rollout, rollback, SLA, broad client compatibility, security review, and assurance-claim parity remain open. |

X and Q are separate. An actual-network local run proves more than an injected Fetch
or in-process handler test while remaining local. Hosted CI running source would
remain S; H requires an exact remote serving version and recorded smoke.

## Candidate implementation under test

- `scripts/e2e-okta-mfa-authjs.mjs` configures the shared official-client parent with
  dedicated provider port `8796`, inspector port `18796`, client script, environment
  prefix, and temporary-state prefix.
- `scripts/e2e-local-official-client.mjs` owns the loopback port, Wrangler process
  tree, HTTPS certificate trust, timeout, cleanup, and bounded result.
- `scripts/e2e-okta-mfa-authjs-cleanup.mjs` configures the shared signal-cleanup
  verifier; `scripts/e2e-local-official-client-cleanup.mjs` interrupts a ready
  harness with `SIGTERM` and verifies parent status, both port releases,
  process-group exit, and temporary-state removal.
- `scripts/e2e-okta-mfa-authjs-contract.mjs` freezes the official-client version,
  static synthetic passcode, exact owned factor-link rule, and nine-request provider
  sequence.
- `scripts/e2e-okta-mfa-authjs-client.mjs` uses the official MCP and Okta Auth JS
  clients and owns the product assertions.
- `apps/worker/wrangler.e2e.jsonc` supplies the existing local Durable Object
  composition.
- `packages/core/src/authn/okta-authn.ts` owns factor verification and hash-only,
  one-use session capabilities.
- `packages/engine-http/src/okta-authn.ts` owns the mounted Classic Authn and returned
  factor-verification HTTP contract.
- `packages/engine-http/src/okta.ts` and
  `packages/worker-kit/src/environment-do.ts` connect a valid one-use Authn session
  capability to the Okta authorization-code path.
- Focused tests in core, the HTTP adapter, worker-kit, and mounted Worker protect
  transaction, race, validation-order, lifecycle, and evidence-redaction boundaries.

## Exact factor and authorization contract

Classic primary authentication for a valid, active User with
`mfaState: "required"` returns `MFA_REQUIRED`. The provider-shaped response uses the
singular `_embedded.factor` property containing an array and advertises:

```text
POST /api/v1/authn/factors/{factorId}/verify
```

The exact JSON input is `stateToken` plus `passCode`.

| Input | HTTP/provider result | State effect |
| --- | --- | --- |
| Correct factor, live MFA state, valid password, and `000000` | `200 SUCCESS` with User, `expiresAt`, and `sessionToken` | Atomically consumes the Authn state and creates one one-use session capability |
| Correct factor and `000000` when the User is also password-expired | `200 PASSWORD_EXPIRED` with the same `stateToken`, refreshed bounded expiry, and no `sessionToken` | Advances the live transaction without creating a session; cancel remains mounted |
| Wrong factor or passcode | `403 E0000068`, `Invalid Passcode/Answer` | Does not consume the state |
| Invalid, expired, cancelled, or replayed state | `401 E0000011` | No session capability is issued |

The password-change and recovery/unlock continuation routes are not implemented.
Responses omit those executable links instead of advertising dead endpoints. The MFA
cancel link remains because its route is mounted.

Repeating factor verification after the transaction has advanced to
`PASSWORD_EXPIRED` returns `E0000011` but does not delete that live wrong-state
transaction. Retrieval and cancellation continue to work with the same state token.

Authorization accepts the camel-case `sessionToken` parameter at:

```text
GET /oauth2/default/v1/authorize
```

Application, redirect URI, response type, scopes, and S256 PKCE are validated before
the one-use capability is consumed. A valid request returns a direct HTTP 302 callback
with `code` and `state`, without hosted login. Replay returns OAuth
`invalid_grant`. The capability remains bound to its environment, User, expiry, and
lifecycle state.

Ambiguous one-time requests are not retried. A lost response from factor verification
or session-token authorization may follow a committed consume; the harness fails and
starts a fresh isolated environment instead of replaying blindly.

## Environment

| Item | Accepted value |
| --- | --- |
| Date | 2026-07-26 |
| Operating system | Darwin 25.5.0 arm64 |
| Node.js | 26.4.0 |
| pnpm | 10.30.2 |
| Wrangler | 4.114.0 |
| Okta Auth JS | 8.0.1 |
| MCP SDK | 1.29.0 |
| Network | `https://localhost:8796` actual loopback socket |
| Wrangler inspector | Explicit loopback port `18796` |

Wrangler generates the local certificate. For readiness, the parent captures the
leaf, verifies its `localhost` hostname, and requires the ownership nonce from the
exact child it started. It writes the certificate to a temporary mode-`0600` CA file
and starts the client with that file in `NODE_EXTRA_CA_CERTS`. This augments Node's
standard trust roots; it is not exclusive certificate pinning. The client
independently requires an HTTPS `localhost` origin and the same ownership nonce. TLS
verification remains enabled.

The parent rejects an inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` before startup and
strips that variable from child environments. The cleanup verifier enforces the same
rule.

This proves a local HTTPS boundary only. It does not prove rejection of an alternate
otherwise-trusted certificate, public PKI, custom-domain TLS, or hosted routing.

## Exact application and SDK boundary

The MCP client creates one Okta environment, one active MFA-required synthetic User,
and one public application:

```json
{
  "clientType": "public",
  "redirectUris": [
    "https://client.example.test/mockos-okta-mfa-callback"
  ],
  "grantTypes": [
    "authorization_code",
    "refresh_token"
  ]
}
```

The returned registration contains no `clientSecret`. Okta discovery advertises
`none` for token and revocation authentication while keeping introspection at
`client_secret_basic` and `client_secret_post`.

The client configures Okta Auth JS with S256 PKCE, query response mode, and in-memory
transaction/token managers with automatic renewal, removal, and synchronization
disabled. `signInWithCredentials` reaches the environment's Classic Authn endpoint.
Auth JS projects the wire `_embedded.factor` array as `transaction.factor`; calling
the factor's generated `verify` function sends `{passCode, stateToken}` to the exact
returned owned URL.

The `SUCCESS` `sessionToken` is passed to `getWithRedirect`, which reaches the direct
authorization redirect. In Node, `parseFromUrl` otherwise dereferences `window`, so
the harness assigns the SDK-exposed `parseFromUrl._getLocation` seam to the callback
location and also passes the callback URL explicitly. This is an exact 8.0.1
Node-harness boundary, not browser guidance or a version-range claim.

## Executed flow

The accepted run must perform every step:

1. Confirm the client is attached to the exact owned Worker through `/health` and an
   unpredictable ownership nonce.
2. Connect the official MCP SDK to `/mcp`, discover the registry, and require every
   tool used by the flow.
3. Create one Okta environment, seed one active MFA-required synthetic User, create
   one public code/refresh application, and read request-derived URLs.
4. Require `clientType: "public"` and absence of `clientSecret`.
5. Call Okta Auth JS `signInWithCredentials`; require `MFA_REQUIRED`, exactly one
   factor, and an exact owned verification link.
6. Call the returned factor's SDK `verify` function with `000000`; require
   `SUCCESS` and a one-use `sessionToken`.
7. Call `getWithRedirect` with the `sessionToken`, state, nonce,
   `offline_access`, and S256 PKCE; require a direct callback rather than hosted
   login.
8. Pass the callback to `parseFromUrl`; require code exchange, JWKS-backed RS256
   ID-token verification, exact issuer/audience/subject/user/email/nonce, and the
   deliberate `acr`/`amr` non-assurance boundary.
9. Call `renewTokens`; require successful refresh and a replacement refresh token.
10. Call public `token.revoke` for the refreshed access token; require HTTP 200.
11. Suspend the User through MCP; require exactly one remaining access token to be
    revoked, then require `renewTokens` to fail with Okta Auth JS `OAuthError`,
    `invalid_grant`, and `User account is disabled.`.
12. Match the exact provider sequence. Parse retained structures and require exercised
    secret fields to be `[REDACTED]`; reject raw, URI-component, and form encodings of
    every exercised credential, one-time capability, code, verifier, and token.
13. Delete the environment, terminate MCP, stop Wrangler, and remove temporary trust
    and persistence material.

## Exact provider sequence

The harness contract requires one complete sequence:

1. Classic Authn `POST 200`;
2. returned factor verification `POST 200`;
3. discovery `GET 200`;
4. authorization with `sessionToken` `GET 302`;
5. authorization-code token `POST 200`;
6. JWKS `GET 200`;
7. refresh token `POST 200`;
8. access-token revocation `POST 200`; and
9. suspended-User refresh token `POST 400`.

It separately requires exactly three token requests with statuses
`[200, 200, 400]`. No hosted-login GET or credential POST belongs to this sequence.

## Focused source results

| Package or suite | Result |
| --- | --- |
| Core Authn | 1 file, 16 tests passed |
| Core Okta/OAuth | 1 file, 12 tests passed |
| Engine HTTP Authn plus fixtures | 2 files, 10 tests passed |
| Engine HTTP Okta/OAuth | 1 file, 12 tests passed |
| Worker kit | Package types passed; composed behavior is exercised through the Worker integration |
| Worker Okta integration | 1 file, 2 tests passed |
| E2E contract | 3 tests passed |
| Static checks | Core, engine-http, and worker-kit types passed; targeted Biome checks, module syntax checks, and `git diff --check` passed |
| Complete workspace gate | Pending at record finalization; required before handoff |

Hosted CI remains S and must be recorded separately. A green local gate does not
become H, V, or release evidence.

## Exact process result

Command:

```sh
pnpm e2e:okta-mfa-authjs
```

Exit status: `0`.

Final output:

```json
{"ok":true,"claim":"okta-authjs-classic-mfa-session-token-authorization-code-pkce","oktaAuthJsVersion":"8.0.1","clientType":"public","networkBoundary":"wrangler-dev-https","managementInterface":"mcp-streamable-http","environmentDeleted":true,"providerSequenceMatched":1,"providerRequestCount":9,"tokenStatuses":[200,200,400],"factorType":"token:software:totp","lifecycleAction":"suspend","lifecycleErrorCode":"invalid_grant","mfaProvenanceClaim":"not-qualified-existing-1fa-claims-preserved","logRedaction":"raw-url-form-encoded-and-structural-sensitive-field-verification"}
```

The accepted result must agree with the nine provider requests and token statuses
above, prove environment deletion, and identify the bounded Classic-factor-to-OIDC
claim.

## Evidence-redaction result

The final run must parse retained Classic Authn, factor, authorization, callback,
token exchange, refresh, revocation, and successful token-response structures. It
must require `[REDACTED]` for the exercised password, `stateToken`, `passCode`,
`sessionToken`, callback and exchange code, PKCE verifier, refresh values, revocation
token, and access/ID/refresh response fields.

It must also prove serialized evidence excludes the raw, `encodeURIComponent`, and
`URLSearchParams` form-encoded representations of every exercised sensitive value.
This is exact-value, exact-encoding, and named-field structural evidence for this run.
It is not a promise to classify arbitrary encodings, unknown field names, or
unstructured content.

## Forced-cancellation cleanup result

Command:

```sh
pnpm e2e:okta-mfa-authjs-cleanup
```

Exit status: `0`.

Final output:

```json
{"ok":true,"claim":"okta-mfa-authjs-e2e-signal-cleanup","signal":"SIGTERM","exitCode":143,"portReleased":true,"inspectorPortReleased":true,"processGroupGone":true,"temporaryStateRemoved":true}
```

The accepted probe must interrupt after the owned HTTPS Worker and temporary trust
state are ready, then require the exact signal acknowledgement, provider and inspector
port reuse, detached Wrangler process-group exit, and removal of the harness directory
and temporary parent. This is focused local cleanup evidence. It does not qualify
uncatchable `SIGKILL`, Windows process-tree behavior, abrupt machine loss, or every
interruption point while the Auth JS client is active.

## Public-client and one-time-capability boundary

- Public application creation never returns or stores a client secret. Supplying one
  is rejected, and `client_credentials` is forbidden.
- Factor verification requires the exact state and factor. Wrong factor/passcode
  returns the same `E0000068` class and preserves state.
- Successful verification atomically consumes state before issuing a hash-only,
  fixed-expiry session capability.
- Authorization validates the client request before consuming that capability.
  Successful consume is one-use; replay returns `invalid_grant`.
- Public code and refresh redemption accept a known public client only when no secret
  is supplied. A spurious secret fails as `invalid_client`.
- Public introspection is denied. Public revocation accepts the owning application's
  identity without a secret and cannot revoke another application's token family.
- Refresh tokens and the Authn `sessionToken` remain bearer capabilities. This run
  does not establish DPoP, sender constraining, distributed replay protection, or a
  provider grace period.
- The factor chain does not change token `acr` or `amr`; no MFA-assurance-token claim
  follows from this record.

## Explicit non-claims

This record does not qualify:

- RFC 6238/TOTP verification, enrollment, push, SMS, WebAuthn, warnings, password
  change, recovery, or unlock;
- a Sessions API exchange, Okta browser session cookie, or downstream application
  cookie;
- MFA-assurance token claims;
- browser callback UX, Sign-In Widget, IDX, browser storage, distributed transaction
  storage, concurrent browser tabs, or another Auth JS version;
- device flow, client credentials, UserInfo, public introspection, access-token
  signature validation, DPoP, or broad claims/error parity;
- a public socket, hosted Cloud, workers.dev, custom domain, production certificate,
  hosted-CI result, exact deployed Worker version, or real Okta organization; or
- guarded promotion, rollback, package publication, uptime, durability, security
  audit, penetration test, or production readiness.

Run [the quickstart](../quickstarts/okta-auth-js-node.md) to produce the evidence that
finalizes this record.
