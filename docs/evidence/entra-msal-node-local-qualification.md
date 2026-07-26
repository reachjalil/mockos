# Entra MSAL Node local qualification

Status: Bounded D/I/S/X/Q local candidate passed; H/V/P remain unqualified
Last reviewed: 2026-07-26

This record captures the local qualification of one exact client path:
`@azure/msal-node` 5.4.2 uses one mockOS custom OIDC authority with a confidential
client for authorization code + S256 PKCE and a separate secret-free public client for
device code. Both perform a forced silent refresh and then observe lifecycle-revoked
refresh. `@modelcontextprotocol/sdk` 1.29.0 manages the disposable environment over
Streamable HTTP.

The earlier confidential-only run was captured on branch `codex/entra-market-fit` and
later rerun through the shared harness. The combined public-device expansion was run
from the `codex/entra-device-code` source candidate based on committed revision
`a4b6d0e810de524ba5abb6dbd69cdde2d0f69f0c`. The device changes were not yet an
immutable commit at run time. This is a local source record, not hosted-CI,
deployment, or release evidence.

## Eight-level evidence boundary

| Level | Result | Evidence |
| --- | --- | --- |
| Designed (D) | Yes | The bounded confidential-code/public-device clients, authority, network, lifecycle, observation, and cleanup contract are explicit in the harness and [quickstart](../quickstarts/entra-msal-node.md). |
| Implemented (I) | Yes | Core policy, Entra HTTP/Worker device routes, atomic consumption/token persistence, the acceptance harness, and generalized durable credential redaction exist in the candidate. |
| Source-tested (S) | Yes | Focused core, core-backed fixture, HTTP, mounted Worker, lifecycle, concurrency, and log-redaction tests pass. Fixtures cover start/pending/deny/unknown/expiry; mounted Worker covers the non-expiry device flow and secret representations. |
| Integration-tested (X) | Yes | The clients traversed a real HTTPS loopback socket into local Wrangler, its MCP transport, router, Durable Objects, and provider endpoints. |
| SDK/client-qualified (Q) | Yes | Exact `@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 clients completed the stated flow. |
| Hosted-smoke (H) | No | No remote Worker, Cloud endpoint, or exact deployed version ran this acceptance client. |
| Verified-live (V) | No | No sanitized comparison with a real Entra tenant exists. |
| Production-ready (P) | No | The record does not qualify package distribution, operated-service policy, guarded rollout, rollback, SLA, or broad client compatibility. |

X and Q are deliberately separate. The actual-network test proves more than an
injected Fetch or in-process handler test, while remaining local. A future hosted CI
execution would still not become H without an exact remote serving version and recorded
smoke.

## Candidate implementation under test

- `scripts/e2e-entra-msal.mjs` configures the Entra client, port, and temporary-state
  inputs for `scripts/e2e-local-official-client.mjs`, the shared owner of the loopback
  port, Wrangler child, HTTPS trust, timeout, cleanup, and bounded result.
- `scripts/e2e-entra-msal-cleanup.mjs` configures
  `scripts/e2e-local-official-client-cleanup.mjs`, the shared verifier that interrupts
  a ready harness with `SIGTERM` and checks parent status, port release, Wrangler
  process-group exit, and temporary-state removal.
- `scripts/e2e-entra-msal-client.mjs` uses the official MCP and MSAL clients and owns
  the product assertions.
- `apps/worker/wrangler.e2e.jsonc` supplies the existing local Durable Object
  composition.
- `packages/core/src/device-authorization.test.ts` protects the Entra 900/5/public-only
  policy, pending/throttle/approval/denial/expiry paths, trusted Graph fallback,
  atomic one-winner consumption, retry after pre-commit failure, refresh rotation,
  lifecycle rejection, and distinct Entra token `uti` claims.
- `packages/engine-http/src/entra-device-fixtures.test.ts` executes Entra fixtures
  23–27 against a core-backed HTTP composition.
- `apps/worker/test/entra-device.integration.test.ts` covers the mounted
  `/oauth2/v2.0/devicecode` and `/devicelogin` paths, credential-gated approve and
  deny, wire-grant normalization, error names, one-time use, routing, and device
  evidence redaction. Deterministic expiry remains core-backed HTTP evidence and is not
  exercised through this mounted Worker suite.
- `packages/worker-kit/src/environment-do.ts` redacts secret-bearing structured forms
  and JSON, sensitive request/response headers, and secret query or fragment fields in
  redirect `Location` values before durable request-log insertion.
- `apps/worker/test/lifecycle-cascade.integration.test.ts` independently verifies that
  persisted OAuth request and response evidence cannot reproduce the password, client
  secret, authorization code, PKCE verifier, or issued tokens, including malformed
  form and primitive JSON requests.
- `apps/worker/test/okta.integration.test.ts` supplements that boundary by verifying
  malformed JSON, primitive JSON, and unsupported-media request bodies on SCIM and
  Okta directory routes are replaced before persistence.
- `.github/workflows/ci.yml` contains a dedicated future source-CI job. This local
  record does not claim that job has run.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-07-26 |
| Operating system | Darwin 25.5.0 arm64 |
| Node.js | 26.4.0 for the combined run; 24.18.0 for the earlier shared-harness and focused signal-cleanup records |
| pnpm | 10.30.2 |
| Wrangler | Repository-pinned 4.114.0 |
| MSAL Node | 5.4.2 |
| MCP SDK | 1.29.0 |
| Network | `https://localhost:8794` actual loopback socket |
| Wrangler inspector | Explicit loopback port `18794`, distinct from Okta `18795` |

Wrangler generated the local certificate. For readiness, the parent process anchored
the captured leaf, verified its `localhost` hostname, and required the ownership nonce
from the exact child it started. It wrote the captured certificate to a temporary
mode-`0600` CA file and started the client with that file in
`NODE_EXTRA_CA_CERTS`. This augmented the standard Node trust roots; it was not
exclusive certificate pinning. The client independently required an HTTPS `localhost`
origin and the same ownership nonce. TLS verification remained enabled, and the CA
file and directory were removed after the run. This proves a local HTTPS boundary
only. It does not prove rejection of an alternate otherwise-trusted certificate,
public PKI, custom-domain TLS, or hosted routing.

The shared parent rejects an inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` before startup
and strips that variable from child environments. The cleanup verifier enforces the
same rule. Focused negative guards exercise both boundaries.

Wrangler 4.112.0 intermittently lost its local ProxyWorker-to-user-Worker loopback on
the first request after MSAL's required five-second device polling wait and returned a
misleading restart `503`. This matches Cloudflare's open
[five-second local-proxy keep-alive race](https://github.com/cloudflare/workers-sdk/issues/14641).
A temporary marker at the first line of mockOS protocol routing appeared for every
preceding provider request but not the failed approved poll, proving that the request
never entered mockOS. Wrangler 4.114.0 includes
[Cloudflare's origin-comparison fix](https://github.com/cloudflare/workers-sdk/pull/14593)
and surfaces the underlying `Network connection lost` instead of a false reload
classification. It does not remove the local loopback transient.

The acceptance client therefore makes one ownership-checked `GET /health` halfway
through the five-second wait. The probe is local-harness liveness only: it neither
enters the provider request log nor retries token redemption, changes Entra's
five-second policy, or exists in deployed product behavior. Eight consecutive complete
runs passed with the probe and the exact 14-request provider sequence unchanged.

## Exact MSAL configuration

Both acceptance clients used the `issuer` returned by `get_wellknown_urls`. The
confidential client was:

```js
const app = new ConfidentialClientApplication({
  auth: {
    authority,
    clientId,
    clientSecret,
    knownAuthorities: [new URL(authority).host],
  },
  system: { protocolMode: ProtocolMode.OIDC },
});
```

The host-only `knownAuthorities` value and `ProtocolMode.OIDC` are required parts of
this claim. The client did not use Microsoft-owned authority aliases or static
metadata.

The device client was a separate public registration with the canonical RFC device
grant plus `refresh_token`, no secret, and an inert synthetic redirect URI retained
only because the application contract still requires one:

```js
const app = new PublicClientApplication({
  auth: {
    authority,
    clientId: publicDeviceClientId,
    knownAuthorities: [new URL(authority).host],
  },
  system: { protocolMode: ProtocolMode.OIDC },
});
```

Discovery/registration use
`urn:ietf:params:oauth:grant-type:device_code`; MSAL Node 5.4.2 sends the shorter
`grant_type=device_code` token form.

## Executed flow

1. Confirm the child is attached to the exact owned Worker through `/health` and an
   unpredictable ownership nonce.
2. Connect the official MCP SDK to `/mcp`, discover the registry, and require all tools
   used by the flow.
3. Create one Entra environment, seed one synthetic User, create one confidential
   application with authorization-code/refresh grants and one public application with
   device/refresh grants, and read request-derived well-known URLs.
4. Ask MSAL to generate the authorization URL with `state`, `nonce`, and S256 PKCE.
5. Fetch and submit the mock hosted sign-in form, preserving the MSAL request and using
   only the seeded synthetic password.
6. Redeem the code with `acquireTokenByCode`; validate the MSAL account and `nonce`,
   `tid`, and `oid` ID-token claims.
7. Call `acquireTokenSilent` with `forceRefresh: true`; require a successful
   token-endpoint response.
8. Start `acquireTokenByDeviceCode`; require exactly one callback with a 900-second
   lifetime, five-second interval, owned `/devicelogin` URL, and no complete URI.
9. Observe MSAL's immediate `authorization_pending` poll, then load the activation
   form and approve with the exact user code plus seeded synthetic credentials.
10. Make one ownership-checked local `/health` request halfway through the required
    five-second polling wait; this is outside provider evidence and is not a token
    retry.
11. Require successful device token acquisition, validate account/tenant/claims, and
    force one public refresh with a changed access token.
12. Disable the User through MCP lifecycle management and require both clients'
    subsequent forced refreshes to surface `invalid_grant`; the confidential error
    also contains `AADSTS50057`.
13. Match all 14 provider requests and inspect durable evidence for structural,
    raw, URI-encoded, and form-encoded credential/token absence.
14. Delete the environment, terminate the MCP session, stop Wrangler, and remove
    temporary trust material.

## Exact process result

Command:

```sh
pnpm e2e:entra-msal
```

Exit status: `0`.

Final output:

```json
{"ok":true,"claim":"msal-node-custom-authority-authorization-code-pkce-and-public-device-code","msalVersion":"5.4.2","protocolMode":"OIDC","networkBoundary":"wrangler-dev-https","managementInterface":"mcp-streamable-http","environmentDeleted":true,"providerSequenceMatched":1,"providerRequestCount":14,"tokenStatuses":[200,200,200,200,400,400,400],"lifecycleErrorCode":"invalid_grant","deviceCallbackCount":1,"devicePendingPolls":1,"deviceActivationStatus":200,"deviceRefreshStatus":200,"deviceLifecycleErrorCode":"invalid_grant","wranglerLoopbackHealthProbes":1,"logRedaction":"raw-url-form-encoded-and-structural-sensitive-field-verification"}
```

The one matched sequence consists of the confidential discovery/login/code/refresh
path, a second discovery for the public client, device creation, immediate pending
poll, activation GET/POST, successful device poll and refresh, and the
lifecycle-rejected refreshes. A separate complete-array assertion requires exactly
those 14 method/path/status triples and no additional provider call. The sorted token
statuses contain four successful token responses, the pending poll, and both lifecycle
errors. The harness separately asserted that the confidential lifecycle error
contained `AADSTS50057`.

## Forced-cancellation cleanup result

Command:

```sh
pnpm e2e:entra-msal-cleanup
```

Exit status: `0` for the cleanup verifier. The interrupted parent harness exited
`143` after `SIGTERM`.

Final output:

```json
{"ok":true,"claim":"entra-msal-e2e-signal-cleanup","signal":"SIGTERM","exitCode":143,"portReleased":true,"inspectorPortReleased":true,"processGroupGone":true,"temporaryStateRemoved":true}
```

The probe interrupts after the owned HTTPS Worker is ready and the temporary
certificate/persistence directory exists. It then requires the exact signal
acknowledgement, rebinds the reserved loopback port, checks the detached Wrangler
process group no longer exists, rebinds the separate inspector port, and checks both
the harness directory and its temporary parent are empty. The Entra and Okta provider
plus inspector ports are distinct; both qualifications and cleanup probes passed when
run concurrently. This is focused local cleanup evidence. It does not qualify
uncatchable `SIGKILL`, Windows process-tree behavior, or every interruption point while
the MSAL child is active.

## Focused durable-redaction results

Command:

```sh
pnpm --filter @mockos/worker exec env \
  API_KEY=mockos-integration-test-key \
  vitest run \
    test/lifecycle-cascade.integration.test.ts \
    test/okta.integration.test.ts
```

Exit status: `0`.

Result:

```text
Test Files  2 passed (2)
Tests       3 passed (3)
```

The lifecycle Worker integration proves stored authorization-form password redaction,
`Location` authorization-code redaction, token-request client-secret/code/verifier
redaction, and access/ID/refresh-token response redaction. The device Worker
integration adds device/user-code and message response redaction, device-poll
redaction, and credential-gated activation-form redaction while retaining the explicit
decision. It also checks raw and encoded values never appear. The generalized tests
replace malformed forms and credential-bearing JSON primitives before persistence;
the Okta integration supplements that boundary with malformed JSON, primitive JSON,
and unsupported-media bodies on directory routes. The actual-network run repeats
named structural plus raw/URI/form representation checks for both Entra flows.

Official-client qualification exposed this durable evidence gap. The tranche fixes the
storage boundary while retaining method, path, safe structured fields, response status,
and ordering for assertions.

## Explicit non-claims

This record does not qualify:

- `@azure/msal-browser` or another MSAL version;
- client credentials, on-behalf-of, public-client browser helpers, or
  the `common`, `organizations`, and `consumers` aliases;
- device-flow behavior beyond the named start/pending/activation/refresh/lifecycle
  slice, including a broad RFC/upstream error, UI, or localization matrix;
- Microsoft Graph SDK, UserInfo, broad claims/error parity, or a real Entra tenant;
- a public socket, hosted Cloud, workers.dev, custom domain, production certificate,
  hosted CI result, or deployed Worker version;
- guarded promotion, rollback, package publication, uptime, durability, security audit,
  penetration test, or production readiness.

Run [the quickstart](../quickstarts/entra-msal-node.md) to reproduce the local evidence.
