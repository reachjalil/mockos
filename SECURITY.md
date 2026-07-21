# Security policy

Status: Initial policy; pre-release project  
Last reviewed: 2026-07-22

## Supported versions

mockOS has no supported release yet. Security fixes are applied to the current default
branch while the project is pre-release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability
reporting for `reachjalil/mockos` once the repository is available. If that channel is
not available, contact the repository owner privately through the verified contact on
their GitHub profile. Do not include live secrets or personal data in the first message.

Include affected revision, impact, reproduction using synthetic data, and any suggested
mitigation. Please allow time to investigate before public disclosure.

## Test-data boundary

mockOS is for synthetic identities and non-production credentials. Request logs are
designed to retain test protocol bodies and tokens for assertions. Never send real
credentials, account keys, production tokens, or personal data to a mock environment.

Cloudflare credentials and account-level API keys must be stored as deployment secrets,
not source, fixtures, logs, or issue attachments. See the
[threat model](./docs/security/threat-model.md).

