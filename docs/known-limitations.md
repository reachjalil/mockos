# Known limitations

Status: Current M0/M1 limitations; deliberately candid  
Last reviewed: 2026-07-22

- The Entra OIDC fixtures are source-reviewed expectations marked `documented`.
  They have not been validated against a live tenant. The separate M1 integration test
  proves only the linked authorization-code vertical slice, not corpus-wide parity.
- M1 supports a narrow Entra authorization-code vertical slice. Okta,
  SCIM, outbound provisioning, scenario injection, MCP control, and SAML are absent
  until later milestones.
- Error descriptions, correlation identifiers, login HTML, cookie behavior, and
  obscure parameter combinations can differ from Entra even where the OAuth error
  code is correct.
- workers.dev cannot provide wildcard subdomains. Path mode needs explicit SDK
  authority configuration; SDKs that require an Okta-style bare organization host
  may not work before custom-domain cutover.
- Subdomain resolution can be unit tested with fake Host headers, but is not
  live-verifiable before an account-owned wildcard route and suitable certificate exist.
- No successful Cloudflare deployment is claimed. Checked Wrangler configuration and
  a dry run are build evidence, not production evidence.
- The `@mockos` npm scope is an intended name only. Authentication and registration
  are external publishing prerequisites.
- The fixture runner compares HTTP status, exact selected headers, exact bodies, and
  object subsets. It does not yet understand JSONPath, regex, JWT claims, or ordered
  request traces.
- SQLite Durable Object and `node:sqlite` share a synchronous design, but behavioral
  equivalence requires the worker integration suite.
- Environment request logs are designed to retain protocol bodies, including test
  tokens. Never put production tokens, account API keys, Cloudflare credentials, or
  real personal data into a mock environment.
- Absolute issuer URLs must never be persisted. Any violation would make host cutover
  unsafe and should block release.
