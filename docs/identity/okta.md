# Okta behavior

Status: Target design; runtime not started  
Last reviewed: 2026-07-22

The Okta profile is planned for M2. It should parameterize the same engine rather than
forking OAuth, directory, and scenario logic.

Target path-mode surfaces include `/oauth2/default/v1/*` and `/api/v1/*`. A custom
subdomain host is important for SDKs that validate or derive an Okta organization URL;
workers.dev path mode cannot reproduce that host shape.

Planned provider differences include Okta error bodies, `X-Rate-Limit-*` headers,
introspection, revocation, device flow, and the STAGED → ACTIVE → SUSPENDED →
DEPROVISIONED lifecycle. None is claimed implemented or live-verified here. Classic
`/api/v1/authn` is a later M6 target.

