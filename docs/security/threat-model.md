# Threat model

Status: Initial design review; controls require implementation evidence  
Last reviewed: 2026-07-22

## Assets and trust boundaries

Protected assets are platform API keys, Cloudflare credentials, environment control
authority, hashed application secrets, signing keys, and isolation between mock
environments. The public protocol surface is intentionally attacker-controllable.
MCP and future control operations cross a stronger authorization boundary.

Primary threats are environment-ID guessing, cross-environment SQL access, OAuth
redirect abuse, code replay, refresh-token theft, signing-key confusion, stored XSS in
hosted pages or logs, secret leakage through logs, unbounded SQLite growth, denial of
service, and SSRF from outbound provisioning.

## Required controls

- Use unguessable environment IDs and bind each request to exactly one Durable Object.
- Compare redirect URIs exactly and make authorization codes one-time, short-lived, and
  PKCE-bound where configured.
- Store client secrets and refresh tokens as hashes; keep signing keys environment-local.
- Generate hosted HTML with escaped values and restrictive response headers.
- Apply quota, TTL, log-ring, body-size, and rate limits at trust boundaries.
- Authenticate MCP control operations unless an operator deliberately enables
  self-hosted public mode.
- Redact account/control credentials before logging.

Environment logs intentionally retain test protocol bodies and mock tokens because
assertion is the product. This is not permission to send production secrets or real
personal data. The UI and docs must keep that distinction explicit.

Outbound SSRF-specific controls are in
[outbound provisioning](./outbound-provisioning.md). A threat listed here is not a
claim that its mitigation has landed.

