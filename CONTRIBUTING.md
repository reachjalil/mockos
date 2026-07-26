# Contributing to mockOS

Thank you for helping make identity integration tests faster and more reproducible.

## Before you start

Small fixes and focused improvements are welcome. For a large feature or a new
provider surface, open a discussion first so the contract, ownership, and test
boundary are clear.

Please follow these principles:

- Keep public packages independently buildable and self-hostable; preserve the
  dependency direction enforced by the repository checks.
- Keep implemented behavior separate from target design. A fixture or specification is
  not runtime support until an automated test exercises it.
- Prefer official Microsoft, Okta, OpenID, OAuth, and SCIM sources. Record source URL,
  review date, and an honest `documented`, `implemented`, or `verified-live` status.
- Never commit real tenants, credentials, identities, access tokens, client secrets,
  Cloudflare secrets, or unsanitized traffic captures.
- Preserve determinism by using injected clock and RNG seams.
- Never persist absolute issuer URLs.

The detailed evidence model is documented in
[implementation status](./docs/IMPLEMENTATION_STATUS.md).

## Set up the repository

Use Node 22.12+ and pnpm 10.30.2.

```sh
pnpm install --frozen-lockfile
pnpm check
```

Add focused tests for behavior changes. For provider-fidelity changes, add or update a
fixture and link the authoritative source. Format and run the complete gate before
submitting:

```sh
pnpm format
pnpm check
```

Update [implementation status](./docs/IMPLEMENTATION_STATUS.md),
[known limitations](./docs/known-limitations.md), and traceability when a
user-visible support or evidence boundary changes.

## Pull requests

Keep pull requests focused. Describe:

- the user-visible behavior;
- how it was tested;
- provider-specific differences;
- security or privacy impact; and
- known gaps or follow-up work.

New dependencies need a clear reason and must pass dependency review.

By contributing, you agree that your contribution is licensed under Apache-2.0.
