# Contributing to mockOS

Status: Initial public contribution policy  
Last reviewed: 2026-07-22

Thank you for helping make identity integration tests faster and more reproducible.

## Ground rules

- Keep the public dependency direction clean: public code must never import the private
  hosted control plane.
- Separate implemented behavior from target design. A fixture is not implementation
  evidence unless an automated engine test passes it.
- Prefer official Microsoft, Okta, OpenID, OAuth, and SCIM sources. Record source URL,
  review date, and an honest `documented`, `implemented`, or `verified-live` status.
  Reserve `verified-live` for sanitized evidence collected from a real provider tenant
  or organization and independently reviewed; a local test, hosted-CI run, or deployed
  mockOS Worker is never `verified-live` evidence.
- Never commit real tenants, credentials, identities, access tokens, client secrets,
  Cloudflare secrets, or unsanitized traffic captures.
- Preserve determinism by using injected clock and RNG seams.
- Never persist absolute issuer URLs.

## Development

Use Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Add focused tests for behavior changes. For provider fidelity changes, add or update a
fixture and link the official source. Keep the evidence tiers explicit:

- **Source evidence** is tied to an exact source revision and automated local or
  hosted-CI execution.
- **Deployed evidence** additionally ties that source revision to an exact mockOS
  deployment/version and a recorded smoke or acceptance run.
- **Verified-live evidence** requires a sanitized comparison with a real Entra ID
  tenant or Okta organization plus reviewer confirmation. It must never contain
  personal data or credentials.

Advancing one tier does not imply either later tier.

Run formatting before submitting:

```sh
pnpm format
pnpm check
```

Update [implementation status](./docs/IMPLEMENTATION_STATUS.md),
[known limitations](./docs/known-limitations.md), and traceability when a milestone
boundary changes.

## Pull requests

Describe the user-visible behavior, evidence, provider differences, security impact,
and known gaps. Keep unrelated refactors separate. New dependencies need a reason and
must pass dependency review.

By contributing, you agree that your contribution is licensed under Apache-2.0.
