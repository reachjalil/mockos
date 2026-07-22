# Threat model

Status: M2 baseline controls implemented and exercised; residual controls remain
Last reviewed: 2026-07-22

## Assets and trust boundaries

Protected assets are platform Access Keys, Cloudflare credentials, environment control
authority, hashed application secrets and OAuth tokens, signing keys, and isolation
between mock environments. The provider protocol surface is intentionally
attacker-controllable. MCP and `/__mockos/v1/*` control operations cross a stronger
authorization boundary.

The control credential authenticates the operator, not a provider-protocol client. It
must never be sent to an environment's OIDC, OAuth, or future SCIM endpoint. The Worker
fails closed with `503` when `API_KEY` is not configured and returns `401` for a missing
or incorrect Bearer or `X-API-Key` credential. `/health` and provider protocol routes
remain public by design.

Primary threats are environment-ID guessing, cross-environment SQL access, OAuth
redirect abuse, code replay, refresh-token theft, signing-key confusion, stored XSS in
hosted pages or logs, secret leakage through logs, unbounded SQLite growth, denial of
service, and SSRF from future outbound provisioning.

## M2 implemented controls

- Authenticated MCP and HTTP control routes compare against the configured Access Key,
  fail closed when it is absent, and remove control credentials before forwarding.
- MCP-created environment identifiers are unguessable, and each routed request binds
  to exactly one environment Durable Object and its SQLite state.
- Redirect URIs are compared exactly. Authorization codes are short-lived, one-time,
  and S256-PKCE-bound where configured.
- Application secrets, refresh tokens, and tracked OAuth access tokens are stored as
  hashes. Signing keys remain environment-local.
- Hosted form values are HTML-escaped, and token/login responses use no-store cache
  controls where applicable.
- Environment TTLs, request-log row and byte budgets, captured body/header limits,
  assertion result limits, scenario-size limits, and scenario-delay limits bound the
  implemented persistence and fault-injection paths.
- Request-log capture redacts authenticated control credentials. A logging failure is
  not allowed to make an otherwise valid identity-protocol response unavailable.

The [M2 workers.dev smoke](../evidence/m2-workers-dev-smoke.md) exercises authenticated
MCP, environment isolation by identifier, OIDC/JWKS verification, scenario injection,
request logging, assertions, and cleanup in staging and production. It is focused
acceptance evidence, not a penetration test or a claim that every threat is closed.

## Residual and future work

The self-hosted M2 deployment uses one coarse operator key per target. Per-environment
authorization, automated key rotation, account governance, abuse protection, and
private hosted-control-plane policy are later milestones. workers.dev path mode also
lacks provider-shaped wildcard hosts, so client compatibility remains intentionally
bounded.

Environment logs intentionally retain test protocol bodies and mock tokens because
assertion is the product. This is not permission to send production secrets, account
Access Keys, Cloudflare credentials, or real personal data into a mock environment.
Operators must treat exported logs as sensitive test artifacts.

Outbound SSRF-specific controls are in
[outbound provisioning](./outbound-provisioning.md). That feature is not implemented
at M2; a target control listed there is not evidence that its mitigation has landed.
