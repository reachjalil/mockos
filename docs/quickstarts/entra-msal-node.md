# Test Entra authorization code with MSAL Node

Status: Bounded `@azure/msal-node` 5.4.2 local actual-network and official-client qualification; no hosted, live-provider, or production-readiness claim
Last reviewed: 2026-07-25

Use this guide to qualify one exact application path: a confidential MSAL Node client
uses a deterministic mockOS Entra tenant, authorization code with S256 PKCE, and the
MSAL token cache for a forced refresh. Management stays on MCP; the application under
test sends only provider traffic to the URLs returned by mockOS.

The qualification level for this exact slice is:

| Level | Result | Exact meaning |
| --- | --- | --- |
| Designed (D) | Yes | The custom-authority confidential-client flow and its negative boundary are explicit. |
| Implemented (I) | Yes | The public Worker, local acceptance client, and durable OAuth log redaction implement the flow. |
| Source-tested (S) | Yes | Focused Worker redaction/lifecycle coverage passes locally. |
| Integration-tested (X) | Yes | The exact clients traverse an actual HTTPS socket into a local `wrangler dev` Worker and its Durable Objects. |
| SDK/client-qualified (Q) | Yes | `@azure/msal-node` 5.4.2 and `@modelcontextprotocol/sdk` 1.29.0 execute the bounded flow. |
| Hosted-smoke (H) | No | No exact remote Worker version or Cloud endpoint has run this client. |
| Verified-live (V) | No | No real Entra tenant was compared. |
| Production-ready (P) | No | Distribution, operated-service, rollout, browser, and broader client guarantees are outside this record. |

The reproducible run and exact output are in the
[local qualification record](../evidence/entra-msal-node-local-qualification.md).

## Prerequisites

- Node.js 22.12 or newer and pnpm 10.30.2;
- dependencies installed from the repository lockfile;
- port `8794` available on loopback, or another free port supplied through
  `MOCKOS_ENTRA_MSAL_E2E_PORT`;
- synthetic identities and credentials only.

Do not provide a production Entra tenant, user password, application secret, token, or
Cloud Access Key. The harness creates disposable local values and removes its
environment and temporary certificate material.

## Run the complete local qualification

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm e2e:entra-msal
pnpm e2e:entra-msal-cleanup
```

The parent process starts the Worker with HTTPS:

```text
wrangler dev --local --ip 127.0.0.1 --port 8794 --local-protocol https
```

For readiness, the parent anchors the captured Wrangler leaf certificate, validates
its `localhost` hostname, and requires the ownership nonce from the exact child it
started. It writes the captured certificate to a mode-`0600` temporary CA file and
passes that file to the client through `NODE_EXTRA_CA_CERTS`. This adds the certificate
to the standard Node trust roots; it is not exclusive certificate pinning. The client
independently requires an HTTPS `localhost` origin and the same ownership nonce. TLS
verification remains enabled, and the temporary file is deleted at cleanup. This does
not prove that an alternate otherwise-trusted certificate would be rejected, and it is
not a deployment certificate or production trust configuration.

A successful run ends with one JSON object similar to:

```json
{
  "ok": true,
  "claim": "msal-node-custom-authority-authorization-code-pkce",
  "msalVersion": "5.4.2",
  "protocolMode": "OIDC",
  "networkBoundary": "wrangler-dev-https",
  "managementInterface": "mcp-streamable-http",
  "environmentDeleted": true,
  "providerSequenceMatched": 1,
  "tokenStatuses": [200, 200, 400],
  "lifecycleErrorCode": "invalid_grant"
}
```

This output is local X/Q evidence. A future hosted CI run would remain source
qualification; H requires a separate exact-version remote smoke.

The cleanup command starts the same parent/Worker boundary on a free loopback port,
waits until the owned HTTPS Worker and temporary trust material are ready, and sends
`SIGTERM` to the parent. It succeeds only when the parent reports signal exit code
`143`, the port can be rebound, the detached Wrangler process group no longer exists,
and the temporary state directory is gone.

## Keep management on MCP

The harness connects `@modelcontextprotocol/sdk` to `/mcp` over Streamable HTTP and
uses the management Access Key only on that transport. It discovers the registry with
`tools/list`, then calls:

1. `create_environment`;
2. `seed_identities`;
3. `create_application`;
4. `get_wellknown_urls`;
5. `assert_requests` and `get_request_log`;
6. `simulate_lifecycle`; and
7. `delete_environment`.

The Access Key must never be forwarded to the Entra authority, hosted sign-in form, or
token endpoint. `create_application` returns the synthetic client secret once; keep it
in process memory or a test secret store and do not write it to source or logs.

## Configure the custom authority exactly

Use the tenant-specific `issuer` returned by `get_wellknown_urls`; do not construct an
authority from a remembered host. For the qualified `@azure/msal-node` 5.4.2 path, the
configuration is:

```js
import {
  ConfidentialClientApplication,
  ProtocolMode,
} from "@azure/msal-node";

const authority = wellKnownUrls.issuer;
const client = new ConfidentialClientApplication({
  auth: {
    authority,
    clientId: application.clientId,
    clientSecret: application.clientSecret,
    knownAuthorities: [new URL(authority).host],
  },
  system: {
    protocolMode: ProtocolMode.OIDC,
  },
});
```

`knownAuthorities` contains the authority **host only**. `ProtocolMode.OIDC` prevents
the client from assuming Microsoft-owned authority metadata. Microsoft likewise
documents `knownAuthorities` plus OIDC protocol mode for a separate OIDC authority in
[Configure Authority](https://learn.microsoft.com/en-us/entra/msal/javascript/node/initialize-public-client-application#configure-authority).

This configuration is part of the qualified contract. The default `common` authority
and the `common`, `organizations`, or `consumers` tenant aliases are not supported test
units.

## Exercise code, PKCE, refresh, and lifecycle

Generate PKCE material through MSAL, preserve `state` and `nonce`, and use the same
scopes and redirect URI for both legs:

```js
import { CryptoProvider } from "@azure/msal-node";

const scopes = ["openid", "profile", "email"];
const pkce = await new CryptoProvider().generatePkceCodes();
const authorizationUrl = await client.getAuthCodeUrl({
  scopes,
  redirectUri,
  codeChallenge: pkce.challenge,
  codeChallengeMethod: "S256",
  nonce,
  state,
});

const initial = await client.acquireTokenByCode({
  code,
  codeVerifier: pkce.verifier,
  redirectUri,
  scopes,
  state,
});

const refreshed = await client.acquireTokenSilent({
  account: initial.account,
  forceRefresh: true,
  scopes,
});
```

The pinned client adds `offline_access` to the authorization request and retains the
refresh token in its cache; MSAL does not expose that raw refresh token. Microsoft
documents `getAuthCodeUrl`/`acquireTokenByCode` as the two authorization-code legs in
[Acquire tokens in MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests#authorization-code-flow)
and documents `forceRefresh` on
[`acquireTokenSilent`](https://learn.microsoft.com/en-us/javascript/api/%40azure/msal-node/clientapplication?view=msal-js-latest#acquiretokensilent-silentflowrequest-).

The acceptance client checks the account username and tenant, the `nonce`, `tid`, and
`oid` ID-token claims, and non-empty access and ID tokens. It then disables the seeded
User through `simulate_lifecycle` and forces another silent acquisition. That request
must fail with MSAL error code `invalid_grant` and an Entra-shaped message containing
`AADSTS50057`.

## Inspect evidence without exposing credentials

The exact ordered assertion is:

1. discovery `GET` → `200`;
2. authorization `GET` → `200`;
3. hosted sign-in `POST` → `302`;
4. authorization-code token `POST` → `200`;
5. forced-refresh token `POST` → `200`;
6. post-disable forced-refresh token `POST` → `400`.

The durable request log must not contain the synthetic password, client secret,
authorization code, PKCE verifier, access token, ID token, or refreshed access token.
Structured form and JSON bodies redact secret-bearing OAuth fields, token responses
replace token values, and redirect `Location` query or fragment secrets are redacted.
The retained method, path, status, and safe structure remain assertable.

This was a compatibility bug found by the official-client qualification: authorization
codes and token material could otherwise survive in durable provider evidence even when
the control credential was already redacted. The focused Worker test now protects the
same storage boundary independently of the process harness, including malformed form
and primitive JSON requests. Supplemental Worker coverage replaces malformed JSON,
primitive JSON, and unsupported-media request bodies on SCIM and Okta directory routes.

## Cleanup and common failures

The harness deletes the environment through MCP, terminates the MCP transport, stops
its owned Wrangler child, and removes the temporary CA directory. The `finally` path
attempts the same environment cleanup if a provider assertion fails.

- Run `pnpm e2e:entra-msal-cleanup` after changing process, signal, timeout, or
  temporary-state handling. It verifies the ready-Worker `SIGTERM` boundary; it does not
  qualify uncatchable `SIGKILL`, Windows process-tree behavior, or every possible
  interruption point during an active MSAL request.
- If MSAL rejects the authority, confirm `knownAuthorities` contains
  `new URL(authority).host` and `system.protocolMode` is `ProtocolMode.OIDC`.
- If TLS fails, run the parent harness instead of the child client directly; the parent
  captures and validates the Wrangler certificate before adding it as a process-local
  CA for the child.
- If the port is occupied, set a free loopback port, for example
  `MOCKOS_ENTRA_MSAL_E2E_PORT=8795 pnpm e2e:entra-msal`.
- If code redemption fails, confirm the redirect URI, scopes, authorization code, and
  PKCE verifier belong to the same attempt. Codes are short-lived and one-time.
- `invalid_grant` containing `AADSTS50057` is expected only after the test disables the
  User. An earlier occurrence indicates an unexpected lifecycle state.

## Deliberately unsupported by this qualification

This record does not qualify `@azure/msal-browser`, public-client interactive helpers,
device code, client credentials, on-behalf-of, `common`/`organizations`/`consumers`,
Microsoft Graph SDK calls, UserInfo, a hosted Cloud endpoint, a real Entra tenant,
custom-domain behavior, or production readiness. See the
[Entra behavior ledger](../identity/entra.md) and
[provider parity matrix](../conformance/parity-matrix.md) before expanding the claim.
