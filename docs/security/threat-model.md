# Threat model

Status: M3 baseline and tested M5 outbound controls accepted; M6 Authn/token/key/Graph controls are source-only
Last reviewed: 2026-07-22

## Assets and trust boundaries

Protected assets are platform Access Keys, Cloudflare credentials, environment control
authority, hashed application secrets and OAuth tokens, signing keys, and isolation
between mock environments. The provider protocol surface is intentionally
attacker-controllable. MCP and `/__mockos/v1/*` control operations cross a stronger
authorization boundary.

The control credential authenticates the operator, not a provider-protocol client. It
must never be sent to an environment's OIDC, OAuth, SCIM, Graph, Okta directory, or
Classic Authn endpoint. The Worker fails closed with `503` when `API_KEY` is not
configured and returns `401` for a missing or incorrect Bearer or `X-API-Key`
credential. `/health` and provider protocol routes remain public by design.

M3 directory authentication is intentionally a mock protocol boundary: SCIM and Graph
require a non-empty Bearer value, and the Okta `/api/v1` surface requires a non-empty
SSWS value. Scheme-and-presence validation is not authorization and must never be
presented as a production identity control. Environment URLs and synthetic directory
credentials should be treated as test artifacts, not security boundaries.

Primary threats are environment-ID guessing, cross-environment SQL access, OAuth
redirect abuse, code replay, refresh-token theft, signing-key confusion, stored XSS in
hosted pages or logs, refresh-family replay races, lifecycle/token-state drift,
cross-environment directory access, authentication-state user enumeration, Authn
state/session capability theft or replay, parser or body resource exhaustion, secret
leakage through logs, unbounded SQLite growth, denial of service, and SSRF through
outbound provisioning targets.

## Implemented controls and evidence boundaries

- Authenticated MCP and HTTP control routes compare against the configured Access Key,
  fail closed when it is absent, and remove control credentials before forwarding.
- Outbound provisioning rejects a target credential equal to the current self-hosted
  `API_KEY` regardless of prefix. The CLI checks file/stdin input before MCP, Worker
  ingress checks the authenticated request, and the Environment Durable Object checks
  before save/stage/use. A key-rotation collision with an existing saved target fails
  before outbound execution without echoing the credential.
- MCP-created environment identifiers are unguessable, and each routed request binds
  to exactly one environment Durable Object and its SQLite state.
- Redirect URIs are compared exactly. Authorization codes are short-lived, one-time,
  and S256-PKCE-bound where configured.
- Application secrets, refresh tokens, and tracked OAuth access tokens are stored as
  hashes. Signing keys remain environment-local. The active and pre-published successor
  private JWKs stay inside the signing service; rotation scrubs the previous active
  private JWK transactionally and bounds the ring to four rows. A second rotation is
  blocked for the exact 26-hour rollback/verification-overlap window qualified for
  built-in Worker/MCP issuance with a fixed one-hour lifetime and bounded skew. Trusted
  public-core test seams can create longer or overridden temporal claims and are outside
  that guarantee.
- Classic Authn verifies the password before returning account state, stores only
  hashes of five-minute state/session capabilities, consumes session capabilities
  once, rejects expired/cancelled replay, and redacts Authn passwords and tokens from
  request logs. Deactivating lifecycle transitions remove outstanding Authn
  capabilities atomically so reactivation cannot restore them.
- Refresh grants authenticate the client, forbid scope escalation, consume and replace
  the token atomically, preserve absolute family expiry, and revoke the family plus
  associated tracked access tokens on replay or concurrent double redemption.
- Provider-valid disable, suspend, deprovision, and delete transitions revoke effective
  access/refresh credentials in the same transaction as the state change. User deletion
  also removes Group membership and increments affected Group versions atomically.
- Hosted form values are HTML-escaped, and token/login responses use no-store cache
  controls where applicable.
- Environment TTLs, request-log row and byte budgets, captured body/header limits,
  assertion result limits, scenario-size limits, and scenario-delay limits bound the
  implemented persistence and fault-injection paths.
- SCIM, Graph, and Okta directory adapters bound request paths, identifiers, query or
  filter sizes, page sizes, and supported operations. SCIM and Okta writes stream
  through 1 MiB body limits; Graph `getMemberObjects` streams through a 4,096-byte
  limit even without a trustworthy `Content-Length`, queries at most 1,001 membership
  IDs, and fails rather than returning more than 1,000; Entra token overage probes at
  most 201 IDs. SCIM additionally bounds filter tokens/depth/nodes and PATCH
  operations/depth/nodes.
- The edge removes every caller-supplied `x-mockos-*` header before adding trusted
  issuer, environment, public-path, and Graph-base routing context. Entra group-overage
  endpoints are derived from that context and never from a caller-provided URL.
- Request-log capture redacts authenticated control credentials. A logging failure is
  not allowed to make an otherwise valid identity-protocol response unavailable.

The [M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) exercises a bounded
authenticated MCP, environment isolation, OIDC/JWKS, refresh/lifecycle, directory,
scenario, logging, assertion, and cleanup sample in staging and production. It is
focused acceptance evidence, not a penetration test, full fixture run, live-provider
comparison, or evidence for M5 outbound provisioning. M5 has a separate
[deployment record](../evidence/m5-workers-dev-smoke.md).

## Residual and future work

The reference self-hosted deployment uses one coarse operator key per target.
Per-environment authorization, automated key rotation, account governance, and abuse
protection remain outside the public M3 deployment. Operated-service policy is a
separate private boundary and does not change this self-hosted threat model. workers.dev
path mode also lacks provider-shaped wildcard hosts, so client compatibility remains
intentionally bounded.

Environment logs intentionally retain test protocol bodies and mock tokens because
assertion is the product. This is not permission to send production secrets, account
Access Keys, Cloudflare credentials, or real personal data into a mock environment.
Operators must treat exported logs as sensitive test artifacts.

Active and successor private signing JWKs are stored in per-environment SQLite without
application-level encryption. Use only synthetic environments and apply the deployment
platform's storage and access controls; M6 hosted/deployed security evidence is pending.

M5 outbound SSRF and credential controls are described in
[outbound provisioning](./outbound-provisioning.md). The Worker and worker-kit suites,
full repository gate, independent source review, two-process e2e, hosted CI, and
source-paired staging/production controlled-target smoke are green. Workers cannot pin
DNS answers, so operators must restrict
targets and add external egress enforcement where required. UserInfo, the unimplemented
remainder of the Okta Classic transaction machine, broad Graph/Okta API parity, and
custom-domain routing likewise remain outside the accepted boundary. The bounded
Classic primary-authentication source is locally qualified but not accepted or
deployed evidence.
