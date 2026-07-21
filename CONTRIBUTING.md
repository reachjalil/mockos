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
fixture and link the official source. A live-capture status requires a sanitized capture
process and reviewer confirmation; it must never contain personal data.

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

