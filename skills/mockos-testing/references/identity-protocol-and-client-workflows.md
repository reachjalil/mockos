# Identity protocol and official-client workflows

## Contents

- [Exercise provider OAuth flows](#exercise-the-provider-flow)
- [Qualify pinned official clients](#qualify-a-pinned-official-client)
- [Exercise bounded Okta Classic authentication](#exercise-bounded-okta-classic-primary-authentication)
- [Rotate refresh tokens and test lifecycle](#rotate-refresh-tokens-and-test-the-lifecycle-cascade)
- [Exercise SCIM and directory APIs](#exercise-scim-and-provider-directory-surfaces)
- [Run outbound SCIM provisioning](#run-the-outbound-provisioning-loop)

Read the provider sections that match the application and evidence claim.

## Exercise the provider flow

For both providers, run authorization code with S256 PKCE first. Preserve `state`,
verify `nonce`, redeem the code once, fetch JWKS through discovery, and validate the
signature, issuer, audience, timestamps, subject, and provider-specific claims.

For a bounded Entra public-device follow-on:

1. Create a separate `clientType: "public"` application with the canonical
   `urn:ietf:params:oauth:grant-type:device_code` and `refresh_token` grants, no
   secret, and `redirectUris: []`. A mixed registration that also includes
   `authorization_code` must instead provide the real callback URI used by that flow.
2. Start device authorization at the returned
   `/<tenant>/oauth2/v2.0/devicecode` endpoint. Require `expires_in: 900`,
   `interval: 5`, an owned clean `/devicelogin` verification URI, and no
   `verification_uri_complete`.
3. When testing pinned MSAL Node 5.4.2, accept its short token-wire
   `grant_type=device_code` while retaining the RFC URN in discovery/registration.
   Require one callback and observe its immediate token poll returning
   `authorization_pending`.
4. Load `/devicelogin`, then submit the exact user code, seeded synthetic username and
   password, and `decision=approve`. Test denial separately and require the same
   credential check before `authorization_declined`; an unauthenticated deny must
   fail.
5. Poll after approval and validate account/tenant, `tid`, `oid`, usable access/ID
   tokens, and distinct Entra access/ID-token `uti` values. Force a public refresh and
   require a changed access token.
6. Disable the User through management MCP. Require the device account's next forced
   refresh to return `invalid_grant`; do not infer hosted or real-provider evidence.
7. Exercise `bad_verification_code` for an unknown or consumed code and
   `expired_token` with the deterministic core-backed HTTP fixture when those cases
   matter. Mounted Worker coverage does not include deterministic expiry.
8. Keep `slow_down` in protocol tests: polling faster than the current interval raises
   it and adds five seconds. MSAL Node 5.4.2 does not retry that error, so its qualified
   actual-network flow activates after the first pending poll instead of deliberately
   triggering throttling.

For Okta, use only the `/oauth2/default` custom-authorization-server surface. Exercise
the implemented flow as needed:

1. Start device authorization at the returned device endpoint.
2. Verify an early token poll returns `authorization_pending`.
3. Open the returned verification URL and activate with a seeded synthetic identity.
4. Poll after the advertised interval and validate the returned tokens.
5. For a confidential registration, introspect an access or refresh token with its
   synthetic secret.
6. Revoke it, then verify confidential introspection returns `{ "active": false }`.

Public Okta clients cannot introspect. They can revoke only their own access or refresh
tokens by identifying the public client without a secret; discovery advertises
revocation `none`. The pinned Auth JS client uses a client-ID-only Basic compatibility
shape that the adapter normalizes to public `none`. Do not treat that as anonymous or
cross-client revocation.

<a id="official-client-recipes"></a>

## Qualify a pinned official client

Prefer the repository commands when the application path matches an existing claim:

```sh
pnpm e2e:entra-msal
pnpm e2e:entra-msal-cleanup
pnpm e2e:okta-authjs
pnpm e2e:okta-authjs-cleanup
pnpm e2e:okta-mfa-authjs
pnpm e2e:okta-mfa-authjs-cleanup
```

Both provider wrappers configure a shared parent that owns an actual local Wrangler
HTTPS process, validates its `localhost` certificate and ownership nonce, adds the
captured leaf to process-local Node trust, bounds time/output, and cleans up the
process group and temporary state. The wrappers use distinct provider and inspector
ports (`8794`/`18794` for Entra, `8795`/`18795` for the original Okta path, and
`8796`/`18796` for the Classic-factor Okta path), so the flows can run concurrently.
Their cleanup wrappers configure one shared ready-Worker `SIGTERM` verifier that
requires both ports to be reusable. The parent and cleanup verifier reject inherited
`NODE_TLS_REJECT_UNAUTHORIZED=0` and strip it from children. Added trust is not
exclusive certificate pinning.

For Entra, require the exact
[MSAL Node recipe](../../../docs/quickstarts/entra-msal-node.md): host-only
`knownAuthorities`, `ProtocolMode.OIDC`, confidential code + S256 PKCE, a separate
secret-free public device client, one device callback/immediate pending poll,
credential-gated activation, forced refresh for both accounts, MCP disable, and
`invalid_grant` for both refresh families. Require `AADSTS50057` on the confidential
path. Require exactly 14 provider method/path/status entries, including separate
confidential and public discovery. The combined token statuses are
`[200, 200, 200, 200, 400, 400, 400]`. Parse the password, client secret, code,
verifier, device/user codes, repeated device message, activation credentials, and
successful token fields as structurally redacted, then reject raw,
`encodeURIComponent`, and `URLSearchParams` representations of every exercised
sensitive value.

The repository-pinned Wrangler 4.114.0 harness makes one ownership-checked `/health`
request halfway through MSAL's required five-second wait. Keep that request strictly
outside provider evidence. It de-phases an
[open Wrangler local-proxy five-second keep-alive race](https://github.com/cloudflare/workers-sdk/issues/14641);
it is not product behavior, a token retry, hosted evidence, or permission to change
Entra's interval. If the approved POST still fails before entering mockOS, fail and
rerun the entire isolated qualification flow. Never replay an ambiguous token POST:
the first request could have committed even when its response was lost.

For Okta, require the exact
[Okta Auth JS recipe](../../../docs/quickstarts/okta-auth-js-node.md):

1. Create one active synthetic User with `mfaState: "required"` and one
   `clientType: "public"` application with code/refresh grants, an exact callback, and
   no secret.
2. Call Auth JS 8.0.1 `signInWithCredentials`; require `MFA_REQUIRED`, exactly one
   `token:software:totp` factor, singular `factor` projection, and an exact returned
   verification URL on the owned environment Authn endpoint.
3. Call the factor's SDK-generated `verify` function with fixed synthetic passcode
   `000000`; require HTTP 200 `SUCCESS` and a one-use `sessionToken`. Treat the
   passcode as inert deterministic input, not RFC 6238/TOTP.
4. Pass that capability to `getWithRedirect` with `state`, `nonce`,
   `offline_access`, and S256. Require a direct HTTP 302 callback without a hosted
   login request. Reuse must return `invalid_grant`; invalid redirect or malformed
   challenge must fail before consumption; concurrent authorize must have one winner.
5. In the exact Node harness, supply the SDK-exposed
   `parseFromUrl._getLocation` seam plus the callback URL because the method otherwise
   dereferences `window`. Require code exchange and JWKS-backed RS256 ID-token
   verification.
6. Assert the deliberate assurance boundary: the access token retains
   `acr: urn:okta:loa:1fa:any` and the ID token retains `amr: [pwd]`. Do not report
   this factor chain as an MFA-assurance-token result.
7. Call `renewTokens` and require refresh rotation.
8. Call public `token.revoke` and require HTTP 200; because that status is idempotent,
   require the following lifecycle result to revoke exactly one remaining access token
   rather than two;
9. Apply Okta `suspend` through MCP, call `renewTokens` again, and require Auth JS
   `OAuthError`, `invalid_grant`, and `User account is disabled.`; and
10. Assert exactly nine provider requests in this order: Authn `POST 200`, factor
    `POST 200`, discovery `GET 200`, authorize `GET 302`, code token `POST 200`, JWKS
    `GET 200`, refresh `POST 200`, revoke `POST 200`, suspended refresh `POST 400`.
    Token statuses are `[200, 200, 400]`. Parse password, state/passcode/session
    capabilities, callback/exchange code, verifier, refresh, revoke-token, and
    successful token-response fields as `[REDACTED]`; reject raw,
    `encodeURIComponent`, and `URLSearchParams` encodings of every exercised value.

The `_getLocation` seam is an exact 8.0.1 Node-test boundary, not browser guidance or a
version-range promise. Auth JS verifies the ID token in this flow; do not promote that
to access-token signature validation, UserInfo, browser callback UX, Sign-In Widget,
IDX, broad Classic Authn, device flow, hosted, live-provider, or P evidence.

Do not claim RFC 6238/TOTP, the complete Okta Classic transaction machine, Sessions
API/cookies, MFA-assurance tokens, client-credentials redemption, or live-provider
parity. Use the bounded Classic recipe below and the provider-specific directory
workflow for the organization API surface.

<a id="m6-okta-authn-recipe"></a>

## Exercise bounded Okta Classic primary authentication

Use only the returned `oktaAuthnEndpoint` and synthetic credentials. This endpoint is a
public mock sign-in boundary; do not attach the MCP Access Key or the directory `SSWS`
credential.

1. Seed separate active Users for `SUCCESS`, `MFA_REQUIRED`, and
   `PASSWORD_EXPIRED`. Set `mfaState: "required"` for MFA and
   `passwordState: "expired"` for expiry. To test `LOCKED_OUT`, seed an active User and
   apply Okta `suspend` through `simulate_lifecycle` before authenticating it.
2. Send a wrong password to the MFA, expired, and suspended Users before each positive
   case. Require the same HTTP 401 `E0000004` body returned for an unknown User; any
   state-specific response before password verification is a privacy failure.
3. Send the valid synthetic password. Require `MFA_REQUIRED` to win when both MFA and
   expiry are configured, `PASSWORD_EXPIRED` only without required MFA, and
   `LOCKED_OUT` only for the suspended User. The bounded lockout case models Okta's
   explicit show-lockout-failures policy. For MFA require the singular
   `_embedded.factor` key containing an array, not `_embedded.factors`. Embedded User
   profiles must omit `passwordChanged`.
4. Keep a returned `stateToken` in memory, post it to `oktaAuthnEndpoint` to retrieve
   the same current state, then post it to `<oktaAuthnEndpoint>/cancel`. Reusing it must
   return HTTP 401 `E0000011`. In a separate disposable state transaction, suspend the
   User and then unsuspend it; the pre-suspension token must still return `E0000011`
   after reactivation. Each successful state retrieval renews expiry to five minutes
   from that read; inactivity still expires the state. Never print or persist the token.
5. For `MFA_REQUIRED`, follow only the exact returned
   `/api/v1/authn/factors/{factorId}/verify` link. Send the current `stateToken` and
   fixed synthetic `passCode: "000000"`. A wrong factor or passcode returns HTTP 403
   `E0000068` without consuming state; invalid/expired/cancelled state returns HTTP 401
   `E0000011`. The static value is not RFC 6238/TOTP.
6. For an MFA-required User whose password remains valid, correct verification returns
   `SUCCESS` and a five-minute one-use `sessionToken`. For a User who is also
   password-expired, it instead returns `PASSWORD_EXPIRED` with the same live
   `stateToken`, refreshed bounded expiry, mounted cancel, and no session capability.
   Repeating factor verification on that live password-expired transaction returns
   `E0000011` without deleting it; retrieval and cancel must still work.
7. Pass a valid session capability to the Okta authorization endpoint only with an
   exact registered public code/S256 request. Require application, redirect, scope,
   response type, and challenge validation before consume, direct HTTP 302 on success,
   `invalid_grant` on replay, and one winner under concurrency. This is not a Sessions
   API or cookie. Tokens retain `acr: urn:okta:loa:1fa:any` and `amr: [pwd]`; do not
   claim MFA assurance.
8. Prove revocation in disposable transactions. Suspend/deprovision/delete a User, or
   change its password through SCIM, then require both pending state and session
   capabilities issued before the mutation to fail after reactivation. A lifecycle or
   password change racing after credential verification must not issue a capability.
9. For browser use, preflight only from the exact Authn origin. Require `POST`, only
   `accept` and/or `content-type`, no `Access-Control-Allow-Credentials`, and `403`
   without an allow-origin header for a different origin. Do not treat Authn as a
   cross-origin credential endpoint.
10. Query the inbound request log for the Authn, factor, and authorize paths. Recursively nested
   password/passcode/secret/token/credential-like fields and sensitive headers such as
   Authorization, Proxy-Authorization, Cookie, and token-like headers must appear as
   `[REDACTED]`; malformed or primitive Authn bodies must be wholly replaced. Require a
   benign `passwordChanged` value to remain visible so over-redaction is detectable,
   but do not quote raw protocol bodies in the report.

The default source limits each Authn table to 10,000 retained rows and each User to 32
retained rows per capability kind. Issuance evicts oldest-expiring rows, prunes no more than 256
expired rows from each table per pass, and uses schema-v5-compatible operational
indexes. Treat an evicted capability exactly like any other invalid state/session token;
do not design a load test that assumes unlimited retention.

Password-change and unlock/recovery execution, warnings, enrollment, RFC 6238/TOTP,
Sessions API/cookies, MFA-assurance claims, and other Classic states remain
unavailable. Unsupported password-change and unlock links are omitted until mounted;
do not reconstruct them.

## Rotate refresh tokens and test the lifecycle cascade

Run this after a successful authorization-code flow when the application under test
uses refresh tokens:

1. Register `refresh_token` in the application's grant types and request
   `offline_access`. Keep the returned access and refresh tokens in memory only.
2. Redeem the initial refresh token once. Confidential clients provide their synthetic
   secret; public clients identify the known client and omit a secret. If a narrower
   scope is supplied, require it to be a subset of the originally granted scope;
   otherwise omit `scope`. Assert that redemption succeeds, returns a different
   replacement refresh token, and does not widen scope.
3. Keep the replacement for the lifecycle check. Do not replay the consumed initial
   token in this environment: replay or concurrent double redemption revokes the whole
   refresh family and its associated access tokens. Test replay only in a disposable
   second environment or token family whose invalidation is the expected result.
4. Call `simulate_lifecycle` with the explicit environment and seeded User IDs. For an
   active Entra User use `disable`; for an active Okta User use `suspend` or
   `deprovision`. Assert the returned provider, action, previous/current state,
   `changed`, positive resource `version`, weak `etag`, and access/refresh counts in
   `revoked`. Choose subsequent transitions from the provider/state matrix rather than
   sending an action from the other provider.
5. Redeem the replacement refresh token again. Require HTTP 400 `invalid_grant` and
   the provider's disabled-account shape: Entra includes `error_codes: [50057]` and
   `AADSTS50057`; Okta returns `The resource owner account is disabled.` Reactivation
   does not restore already revoked credentials, so obtain a new authorization grant
   before any post-reactivation token test.
6. Use request logs and `assert_requests` to prove the token endpoint received the
   expected POST and, for the failure, a request body containing
   `grant_type=refresh_token`. Never print or quote the refresh-token value from the
   captured body.

The current source preserves the original authentication time and absolute family
expiry across rotation. Public refresh tokens remain bearer credentials without DPoP
or sender constraint. Treat those as focused source behaviors, not live-provider or
unrecorded deployed evidence.

## Exercise SCIM and provider directory surfaces

Use separate, synthetic protocol credentials for these requests. SCIM and Graph accept
a non-empty mock Bearer value; the Okta API accepts a non-empty mock SSWS value. These
checks validate the scheme/presence boundary only. Never send the MCP management Access
Key, a real tenant token, or one protocol's mock credential to another protocol.

For SCIM at the returned `scimBaseUrl`:

1. Read `ServiceProviderConfig`, `ResourceTypes`, and `Schemas` with
   `Accept: application/scim+json` and a synthetic Bearer credential.
2. Create a uniquely named synthetic User with
   `Content-Type: application/scim+json`, retain its returned ID, location, and weak
   ETag, then GET and filter it by `userName`.
3. PATCH that User with the SCIM PatchOp schema and `If-Match`. Assert the ETag advances
   after a real change, stays stable after an exact no-op, and a deliberately stale
   precondition returns 412. Add a disposable Group/direct membership case only when
   the application needs it; account for provider-specific response differences such
   as Entra Group PATCH returning 204.
4. Let the environment-level `finally` cleanup remove test data. Delete individual
   resources only when deletion semantics are themselves under test.

For Entra, use the returned `graphBaseUrl` and a synthetic Bearer credential to read
seeded Users, Groups, User `memberOf`, and Group `members`. Exercise only the supported
single-property string `eq` filters, `$select`, and bounded pagination. Graph writes,
nested/transitive membership, and broad Microsoft Graph semantics are unavailable.

For Okta, use the returned `oktaApiBaseUrl` and a synthetic SSWS credential to exercise
the tested Users/Groups CRUD, direct membership, filter/paging, and lifecycle routes.
Use a separate directory-only User for mutating lifecycle tests so it cannot invalidate
the refresh-family case. Prefer MCP `simulate_lifecycle` for the token-bearing User
because its result reports the coordinated revocation counts. Keep this SSWS-protected
management workflow separate from the public `oktaAuthnEndpoint`, and do not infer
other Okta organization APIs.

## Run the outbound provisioning loop

Use a disposable SCIM receiver at a policy-accepted URL. Prefer the repository's
`examples/target-app` harness for source qualification. A literal loopback/private URL
is rejected even when self-host HTTP is enabled; use the e2e harness or an operator-
controlled HTTPS test origin instead of weakening SSRF validation.

When qualifying a repository checkout, run `pnpm e2e:provisioning` first. It boots the
mockOS and Durable Object-backed target app as separate `wrangler dev` processes and
drives the authenticated MCP/CLI/Workflow/service-binding/assertion loop. A passing
unit or Miniflare test is not a substitute for this process-level gate.

1. Keep the application registration's returned `id`; provisioning uses that ID, not
   its OAuth `clientId`.
2. Reset the disposable target and retain its synthetic SCIM Bearer value without
   printing it. Never use a platform `mk_` Access Key or the exact active non-prefixed
   self-host `API_KEY` as the target credential. The CLI and runtime reject that exact
   reuse, and a later key-rotation collision with a saved target fails before outbound
   execution.
3. Call `run_provisioning_cycle` with the explicit environment ID, application ID,
   `full` mode, and an inline target `{ref, baseUrl, auth}`. Set `save: false` unless a
   later cycle deliberately tests saved-target reuse. The raw credential must not
   appear in the returned run or any Workflow parameter/log evidence.
4. Require a queued run with the same environment, application, provider, mode, and
   target reference. This acknowledges Workflow creation only; it is not terminal
   success.
5. Poll `get_request_log` with `source: "outbound"` and a bounded deadline. A full
   cycle must perform all User operations before Group operations. Let unrelated log
   entries exist between expected steps.
6. Call `assert_requests` with an ordered sequence that proves at least User lookup,
   User create/update, Group lookup, and Group create/update. Match the synthetic user
   name and Group display name with `bodyIncludes`, and target result fields with
   `responseBodyIncludes`. Require exactly one complete sequence for a reset target.
7. Inspect the target's protected request and state snapshots. Require its captured
   Authorization value to be redacted, the User to exist before Group membership is
   materialized, and the final member reference to use the target User ID.
8. Run `incremental` against the saved target only when the first run used `save:
   true`; otherwise resend a fresh inline target. Assert unchanged source versions do
   not produce duplicate writes. Mutate one source resource, rerun, and require only
   its provider-shaped update plus any dependent Group reconciliation.

For a deployed acceptance run, inspect the platform Workflow instance as well as the
request log. Platform status `complete` is necessary but not sufficient because the
Workflow can return a failed or partial application run. Require its output to contain
the exact retained run ID with `status: "succeeded"`, and reject rollback-failure
metadata if present.

Treat HTTP responses, including 4xx, 429, and 5xx, as recorded outcomes. A 429 may
produce an explicit bounded wait and retry; it is not an invisible infrastructure
retry. Report a partial or failed sequence as a failed test. Do not retry a whole run
with changed inputs after an ambiguous client timeout. If the server returns its stable
Workflow-reconciliation failure, retry the exact same environment, application, mode,
target reference, target metadata, and synthetic credential. The server revalidates
the frozen target in constant time and resumes or returns the existing fixed Workflow
run; a mismatched retry remains a conflict and must not reveal stored metadata or
credentials.

This recovery rule applies only while the exact run remains queued or running. If the
original run can already be terminal, do not submit another whole-cycle call: M5 has
no caller idempotency key or terminal replay record, so that call is a new run and may
write and consume hosted quota again. Resolve the outcome from the retained run ID,
outbound request log, and disposable target state. Terminal request replay is deferred
to F4.

If a same-input retry returns a terminal failed run, treat it as reconciliation of a
platform Workflow failure and do not expect its hosted quota unit to be released.
M5 performs this cleanup on retry rather than through a background orphan sweep; keep
the retry bounded and preserve the returned failure evidence.
