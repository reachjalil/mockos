# Okta Auth JS local qualification

Status: Bounded D/I/S/X/Q local candidate passed; H/V/P remain unqualified
Last reviewed: 2026-07-26

This record captures one exact client path: `@okta/okta-auth-js` 8.0.1 uses mockOS as
an Okta custom authorization server for a public-client authorization code flow with
S256 PKCE, discovery/JWKS ID-token verification, rotating refresh, public access-token
revocation, and lifecycle-revoked refresh. `@modelcontextprotocol/sdk` 1.29.0 manages
the disposable environment over Streamable HTTP.

The run was performed from branch `codex/okta-market-fit`, whose starting revision was
`9c713964f944c20326b8e826bb04be9bac7399c4`. The tranche was still a working-tree
candidate when this record was captured, so this is not an immutable revision,
hosted-CI, deployment, or release record.

The same exact client flow and focused signal-cleanup probe were rerun on 2026-07-26
from the `codex/entra-device-code` source candidate after the repository Wrangler
upgrade. Both remained green; this remains local source evidence rather than hosted or
deployed evidence.

## Eight-level evidence boundary

| Level | Result | Evidence |
| --- | --- | --- |
| Designed (D) | Yes | The bounded public-client, provider, management, network, lifecycle, observation, and cleanup contract is explicit in the harness and [quickstart](../quickstarts/okta-auth-js-node.md). |
| Implemented (I) | Yes | Public registration, secretless token authentication, owner-bound public revocation, exact discovery metadata, and the official-client acceptance harness exist in the candidate. |
| Source-tested (S) | Yes | Focused contracts, application repository, core OAuth/Okta, HTTP adapter, MCP discovery/runtime, Worker, and cleanup tests cover the source contract. |
| Integration-tested (X) | Yes | The clients traversed a real HTTPS loopback socket into local Wrangler, its MCP transport, router, Durable Objects, and provider endpoints. |
| SDK/client-qualified (Q) | Yes | Exact `@okta/okta-auth-js` 8.0.1 and `@modelcontextprotocol/sdk` 1.29.0 clients completed the stated flow. |
| Hosted-smoke (H) | No | No remote Worker, Cloud endpoint, or exact deployed version ran this acceptance client. |
| Verified-live (V) | No | No sanitized comparison with a real Okta organization exists. |
| Production-ready (P) | No | The record does not qualify package distribution, operated-service policy, guarded rollout, rollback, SLA, or broad client compatibility. |

X and Q are deliberately separate. The actual-network test proves more than an
injected Fetch or in-process handler test while remaining local. A future hosted-CI
execution would still not become H without an exact remote serving version and
recorded smoke.

## Candidate implementation under test

- `scripts/e2e-okta-authjs.mjs` configures the shared local official-client runner with
  Okta-specific client, environment, port, and temporary-state settings.
- `scripts/e2e-local-official-client.mjs` owns the loopback port, Wrangler process
  tree, HTTPS certificate trust, timeout, cleanup, and bounded result for both the Okta
  Auth JS and Entra MSAL qualifications.
- `scripts/e2e-okta-authjs-cleanup.mjs` configures the shared signal-cleanup verifier;
  `scripts/e2e-local-official-client-cleanup.mjs` interrupts a ready harness with
  `SIGTERM` and verifies parent status, port release, process-group exit, and
  temporary-state removal.
- `scripts/e2e-okta-authjs-client.mjs` uses the official MCP and Okta Auth JS clients
  and owns the product assertions.
- `apps/worker/wrangler.e2e.jsonc` supplies the existing local Durable Object
  composition.
- `packages/contracts/src/index.ts` distinguishes `public` from `confidential`
  registrations, rejects public secrets and public `client_credentials`, and makes
  the returned secret conditional. MCP SDK 1.29 `tools/list` projects the same
  distinction through a strict object input, Draft-7 `if`/`then` public condition, and
  separate public/confidential output branches.
- `packages/core/src/directory/applications.ts` stores no secret hash for a public
  registration and derives the client type from that persisted boundary.
- `packages/core/src/oauth/oauth-service.ts`,
  `packages/core/src/providers/okta.ts`, and
  `packages/engine-http/src/okta.ts` implement secretless public token authentication,
  confidential-only introspection, owner-bound public revocation, discovery metadata,
  and the Auth JS client-ID-only Basic compatibility shape.
- Focused tests in contracts, core, the Okta HTTP adapter, MCP, worker-kit, and Worker
  integration protect those boundaries. `.github/workflows/ci.yml` configures future Node
  `24.11.1` source-CI jobs; this local record does not claim those jobs ran.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-07-26 |
| Operating system | Darwin 25.5.0 arm64 |
| Node.js | 26.4.0 for the current rerun; 24.18.0 for the original record |
| pnpm | 10.30.2 |
| Wrangler | Repository-pinned 4.114.0 for the current rerun; 4.112.0 for the original record |
| Okta Auth JS | 8.0.1 |
| MCP SDK | 1.29.0 |
| Network | `https://localhost:8795` actual loopback socket |
| Wrangler inspector | Explicit loopback port `18795`, distinct from Entra `18794` |

Wrangler generated the local certificate. For readiness, the parent process captured
the leaf, verified its `localhost` hostname, and required the ownership nonce from the
exact child it started. It wrote the certificate to a temporary mode-`0600` CA file
and started the client with that file in `NODE_EXTRA_CA_CERTS`. This augmented Node's
standard trust roots; it was not exclusive certificate pinning. The client
independently required an HTTPS `localhost` origin and the same ownership nonce. TLS
verification remained enabled, and the CA file and temporary persistence directory
were removed after the run.

The shared parent rejects an inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` before startup
and strips that variable from child environments. The cleanup verifier enforces the
same rule. Focused negative guards exercise both boundaries.

This proves a local HTTPS boundary only. It does not prove rejection of an alternate
otherwise-trusted certificate, public PKI, custom-domain TLS, or hosted routing.

## Exact application and SDK boundary

The MCP client created an Okta application with:

```json
{
  "clientType": "public",
  "redirectUris": [
    "https://client.example.test/mockos-okta-callback"
  ],
  "grantTypes": [
    "authorization_code",
    "refresh_token"
  ]
}
```

The returned registration contained no `clientSecret`. The Okta discovery document
advertised `none` for token and revocation authentication while keeping introspection
at `client_secret_basic` and `client_secret_post`.

The acceptance client configured `OktaAuth` with S256 PKCE, query response mode, and
in-memory transaction/token managers with automatic renewal, removal, and storage
synchronization disabled. `getWithRedirect` created the authorization transaction. In
Node, `parseFromUrl` otherwise dereferences `window`, so the harness assigned the
SDK-exposed `parseFromUrl._getLocation` seam to the callback location and also passed
the callback URL explicitly. This is an exact 8.0.1 Node-harness boundary, not a
browser or version-range claim.

## Executed flow

1. Confirm the client is attached to the exact owned Worker through `/health` and an
   unpredictable ownership nonce.
2. Connect the official MCP SDK to `/mcp`, discover the registry, and require every
   tool used by the flow.
3. Create one Okta environment, seed one active synthetic User, create one public
   application with code and refresh grants, and read request-derived well-known URLs.
4. Require `clientType: "public"` and absence of `clientSecret`.
5. Ask Okta Auth JS `getWithRedirect` to create the authorization transaction with
   `state`, `nonce`, login hint, and S256 PKCE.
6. Fetch and submit the mock hosted sign-in form over local HTTPS with only the seeded
   synthetic credentials.
7. Pass the callback to `parseFromUrl`; require the SDK's code exchange and JWKS-backed
   RS256 ID-token verification plus exact issuer, audience, subject, user, email, and
   nonce claims.
8. Call `renewTokens`; require a successful refresh and replacement refresh token.
9. Call the SDK's public `token.revoke` for the refreshed access token; require HTTP
   200 through client-ID-only Basic compatibility. When lifecycle suspension follows,
   require exactly one remaining access token to be revoked, proving the SDK call
   changed the refreshed token's state rather than merely receiving idempotent 200.
10. Suspend the User through MCP and call `renewTokens` again; require Okta Auth JS
    `OAuthError`, `invalid_grant`, and `User account is disabled.`.
11. Match the exact provider sequence. Parse the retained form, redirect, and token
    response evidence and require the exercised sensitive fields to equal
    `[REDACTED]`; also scan for the raw, `encodeURIComponent`, and
    `URLSearchParams`-encoded forms of every exercised credential and token.
12. Delete the environment, terminate MCP, stop Wrangler, and remove temporary trust
    and persistence material.

## Focused source results

The focused suites run for this candidate passed:

| Package or suite | Result |
| --- | --- |
| Contracts | 21 tests passed; package types passed |
| Core | 115 tests passed |
| Engine HTTP | 56 tests passed |
| MCP | 6 tests passed; package types passed |
| Worker kit | 90 tests passed; package types passed |
| Worker Okta integration | 2 tests passed |
| Full workspace gate | `pnpm check` passed after the final schema, revocation, redaction, TLS, and concurrency hardening |

The CI workflow contains Node 24.11.1 jobs, but they were only configured and had not
executed for this working-tree candidate. The full local gate and focused suites are S;
they do not become hosted CI, H, or release evidence.

## Exact process result

Command:

```sh
pnpm e2e:okta-authjs
```

Exit status: `0`.

Final output:

```json
{"ok":true,"claim":"okta-authjs-public-authorization-code-pkce","oktaAuthJsVersion":"8.0.1","clientType":"public","networkBoundary":"wrangler-dev-https","managementInterface":"mcp-streamable-http","environmentDeleted":true,"providerSequenceMatched":1,"tokenStatuses":[200,200,400],"revocationStatus":200,"lifecycleAction":"suspend","lifecycleErrorCode":"invalid_grant","logRedaction":"raw-url-form-encoded-and-structural-sensitive-field-verification"}
```

The one matched provider sequence consists of:

1. discovery `GET 200`;
2. authorization `GET 200`;
3. authorization form `POST 302`;
4. authorization-code token `POST 200`;
5. JWKS `GET 200`;
6. refresh token `POST 200`;
7. access-token revocation `POST 200`; and
8. suspended-User refresh token `POST 400`.

The harness separately required exactly three token requests with statuses
`[200, 200, 400]`. It parsed the retained structures and required `[REDACTED]` for the
authorization password, callback code, token-exchange code and verifier, both refresh
requests, revocation token, and every access/ID/refresh field present in the two
successful token responses. It also proved the serialized entries did not contain the
raw, `encodeURIComponent`, or `URLSearchParams` form encoding of the synthetic
password, authorization code, PKCE verifier, initial access/ID/refresh tokens, or
refreshed access/refresh tokens.

This is exact-value, exact-encoding, and named-field structural evidence for the
exercised entries. It is not a promise to classify arbitrary encodings, unknown field
names, or unstructured content.

## Forced-cancellation cleanup result

Command:

```sh
pnpm e2e:okta-authjs-cleanup
```

Exit status: `0` for the cleanup verifier. The interrupted parent harness exited
`143` after `SIGTERM`.

Final output:

```json
{"ok":true,"claim":"okta-authjs-e2e-signal-cleanup","signal":"SIGTERM","exitCode":143,"portReleased":true,"inspectorPortReleased":true,"processGroupGone":true,"temporaryStateRemoved":true}
```

The probe interrupts after the owned HTTPS Worker is ready and its temporary trust and
persistence directory exists. It then requires the exact signal acknowledgement,
rebinds the reserved provider and inspector ports, checks the detached Wrangler process
group is gone, and checks both the harness directory and temporary parent are empty.
The Entra and Okta provider plus inspector ports are distinct; both qualifications and
cleanup probes also passed when run concurrently.

This is focused local cleanup evidence. It does not qualify uncatchable `SIGKILL`,
Windows process-tree behavior, abrupt machine loss, or every interruption point while
the Auth JS client is active.

## Public-client security boundary

- Public application creation never returns or stores a client secret. Supplying one
  is rejected, and `client_credentials` is forbidden.
- Code and refresh redemption accept a known public client only when no secret is
  supplied. A spurious secret fails as `invalid_client`.
- Public introspection is denied and discovery does not advertise `none` for it.
- Public revocation accepts the owning public client's identity without a secret.
  Revocation still filters by that client ID, so it cannot revoke another
  application's token family. A core negative regression preserves another
  application's active access token and both rows of its rotated refresh family after
  an unrelated public client attempts revocation. In the SDK flow, lifecycle reports
  exactly one remaining access-token revocation after the SDK revokes the refreshed
  access token, which distinguishes the functional change from idempotent HTTP 200.
  Unknown or already-revoked tokens remain RFC 7009-style success.
- Refresh tokens remain bearer credentials. The run does not establish DPoP,
  sender-constraining, a provider grace period, or distributed replay semantics.
- The log check covers raw, `encodeURIComponent`, URL form-encoded, and named
  field-structural representations for the exercised flow, not arbitrary encodings,
  general content classification, or a penetration-test result.

## Explicit non-claims

This record does not qualify:

- a browser-hosted callback, Sign-In Widget, IDX, Classic Authn, Sessions, or Factors;
- device flow, client credentials, UserInfo, public introspection, access-token
  signature validation, DPoP, or broad claims/error parity;
- another Okta Auth JS version, browser storage, cross-process transaction storage,
  concurrent browser tabs, or distributed callback handling;
- a public socket, hosted Cloud, workers.dev, custom domain, production certificate,
  hosted-CI result, exact deployed Worker version, or real Okta organization; or
- guarded promotion, rollback, package publication, uptime, durability, security
  audit, penetration test, or production readiness.

Run [the quickstart](../quickstarts/okta-auth-js-node.md) to reproduce the local
evidence.
