# Entra MSAL Node local qualification

Status: Bounded D/I/S/X/Q local candidate passed; H/V/P remain unqualified
Last reviewed: 2026-07-25

This record captures the local qualification of one exact client path:
`@azure/msal-node` 5.4.2 uses a mockOS custom OIDC authority as a confidential client
for authorization code with S256 PKCE, forced silent refresh, and lifecycle-revoked
refresh. `@modelcontextprotocol/sdk` 1.29.0 manages the disposable environment over
Streamable HTTP.

The run was performed from branch `codex/entra-market-fit`, whose starting revision
was `6f70c31a96694fecfd2cc84891bd19c75a171d30`. The tranche was still a working-tree
candidate when this record was captured, so this is not an immutable revision,
hosted-CI, deployment, or release record.

## Eight-level evidence boundary

| Level | Result | Evidence |
| --- | --- | --- |
| Designed (D) | Yes | The bounded client, authority, network, lifecycle, observation, and cleanup contract is explicit in the harness and [quickstart](../quickstarts/entra-msal-node.md). |
| Implemented (I) | Yes | The acceptance harness, Worker composition, OAuth flow, and generalized durable credential redaction exist in the candidate. |
| Source-tested (S) | Yes | Focused Worker lifecycle/log tests passed, including stored structured, malformed, primitive, and unsupported-media request bodies plus response-token and redirect-location redaction. |
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

- `scripts/e2e-entra-msal.mjs` owns the loopback port, Wrangler child, HTTPS
  certificate trust, timeout, cleanup, and bounded result.
- `scripts/e2e-entra-msal-cleanup.mjs` interrupts a ready harness with `SIGTERM` and
  independently verifies parent status, port release, Wrangler process-group exit, and
  temporary-state removal.
- `scripts/e2e-entra-msal-client.mjs` uses the official MCP and MSAL clients and owns
  the product assertions.
- `apps/worker/wrangler.e2e.jsonc` supplies the existing local Durable Object
  composition.
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
| Date | 2026-07-25 |
| Operating system | Darwin 25.5.0 arm64 |
| Node.js | 26.4.0 |
| pnpm | 10.30.2 |
| Wrangler | Repository-pinned 4.112.0 |
| MSAL Node | 5.4.2 |
| MCP SDK | 1.29.0 |
| Network | `https://localhost:8794` actual loopback socket |

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

## Exact MSAL configuration

The acceptance client used the `issuer` returned by `get_wellknown_urls`:

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

## Executed flow

1. Confirm the child is attached to the exact owned Worker through `/health` and an
   unpredictable ownership nonce.
2. Connect the official MCP SDK to `/mcp`, discover the registry, and require all tools
   used by the flow.
3. Create one Entra environment, seed one synthetic User, create one confidential
   application with authorization-code and refresh grants, and read request-derived
   well-known URLs.
4. Ask MSAL to generate the authorization URL with `state`, `nonce`, and S256 PKCE.
5. Fetch and submit the mock hosted sign-in form, preserving the MSAL request and using
   only the seeded synthetic password.
6. Redeem the code with `acquireTokenByCode`; validate the MSAL account and `nonce`,
   `tid`, and `oid` ID-token claims.
7. Call `acquireTokenSilent` with `forceRefresh: true`; require a successful
   token-endpoint response.
8. Disable the User through MCP lifecycle management, force another silent
   acquisition, and require MSAL `invalid_grant` with `AADSTS50057` in the message.
9. Match the exact discovery/login/code/refresh/disabled-refresh request sequence and
   inspect durable evidence for credential absence.
10. Delete the environment, terminate the MCP session, stop Wrangler, and remove
    temporary trust material.

## Exact process result

Command:

```sh
pnpm e2e:entra-msal
```

Exit status: `0`.

Final output:

```json
{"ok":true,"claim":"msal-node-custom-authority-authorization-code-pkce","msalVersion":"5.4.2","protocolMode":"OIDC","networkBoundary":"wrangler-dev-https","managementInterface":"mcp-streamable-http","environmentDeleted":true,"providerSequenceMatched":1,"tokenStatuses":[200,200,400],"lifecycleErrorCode":"invalid_grant"}
```

The one matched sequence consists of discovery `GET 200`, authorization `GET 200`,
authorization form `POST 302`, code redemption `POST 200`, forced refresh `POST 200`,
and disabled-User forced refresh `POST 400`. The harness separately asserted that the
last MSAL error message contained `AADSTS50057`.

## Forced-cancellation cleanup result

Command:

```sh
pnpm e2e:entra-msal-cleanup
```

Exit status: `0` for the cleanup verifier. The interrupted parent harness exited
`143` after `SIGTERM`.

Final output:

```json
{"ok":true,"claim":"entra-msal-e2e-signal-cleanup","signal":"SIGTERM","exitCode":143,"portReleased":true,"processGroupGone":true,"temporaryStateRemoved":true}
```

The probe interrupts after the owned HTTPS Worker is ready and the temporary
certificate/persistence directory exists. It then requires the exact signal
acknowledgement, rebinds the reserved loopback port, checks the detached Wrangler
process group no longer exists, and checks both the harness directory and its temporary
parent are empty. This is focused local cleanup evidence. It does not qualify
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
redaction, and access/ID/refresh-token response redaction. It also checks the serialized
log does not contain any original secret or token value, and replaces both a malformed
form and a credential-bearing JSON primitive before persistence. The Okta integration
supplements the generalized storage boundary with malformed JSON, primitive JSON, and
unsupported-media request bodies on SCIM and Okta directory routes. The process
acceptance repeats the OAuth absence checks across actual-network provider evidence.

Official-client qualification exposed this durable evidence gap. The tranche fixes the
storage boundary while retaining method, path, safe structured fields, response status,
and ordering for assertions.

## Explicit non-claims

This record does not qualify:

- `@azure/msal-browser` or another MSAL version;
- device code, client credentials, on-behalf-of, public-client interactive helpers, or
  the `common`, `organizations`, and `consumers` aliases;
- Microsoft Graph SDK, UserInfo, broad claims/error parity, or a real Entra tenant;
- a public socket, hosted Cloud, workers.dev, custom domain, production certificate,
  hosted CI result, or deployed Worker version;
- guarded promotion, rollback, package publication, uptime, durability, security audit,
  penetration test, or production readiness.

Run [the quickstart](../quickstarts/entra-msal-node.md) to reproduce the local evidence.
