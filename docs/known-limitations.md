# Known limitations

Status: Current M2 limitations; deliberately candid
Last reviewed: 2026-07-22

- The Entra OIDC fixtures are source-reviewed expectations marked `documented`.
  They have not been validated against a live tenant. The separate M1 integration test
  proves only the linked authorization-code vertical slice, not corpus-wide parity.
- The M2 deployed smoke uses the Entra path. Okta's M2 discovery, authorization-code,
  PKCE, introspection, revocation, and device-flow slice passes local Worker tests but
  has not been compared with a live Okta tenant or run in the deployed acceptance flow.
- Entra remains a narrow authorization-code vertical slice. Entra refresh exchange,
  client credentials, device flow, UserInfo, SCIM, outbound provisioning, directory
  lifecycle, and SAML are later milestones.
- M2 scenarios support bounded deterministic delay, semantic error, and JSON-object
  mutation actions at known injection points. They do not yet provide scheduled
  lifecycle events, outbound-provisioning failures, or the F-series behavior system.
- The authenticated MCP surface contains 13 M2 management tools. It does not yet host
  user-configured mock MCP servers, LLM mocks, Code Mode, team ACLs, blueprints, or
  OIDC-federated CI access.
- Error descriptions, correlation identifiers, login HTML, cookie behavior, and
  obscure parameter combinations can differ from Entra even where the OAuth error
  code is correct.
- workers.dev cannot provide wildcard subdomains. Path mode needs explicit SDK
  authority configuration; SDKs that require an Okta-style bare organization host
  may not work before custom-domain cutover.
- Subdomain resolution can be unit tested with fake Host headers, but is not
  live-verifiable before an account-owned wildcard route and suitable certificate exist.
- The staging and production workers.dev targets passed a manual M2 acceptance smoke
  for one candidate. They are qualification surfaces without a custom domain, uptime
  commitment, data durability promise, or production-service SLA. Hosted CI is green
  for the exact candidate, but the deploy-workflow run was skipped by explicit opt-in;
  automated deployment execution is not yet qualified.
- The `@mockos` npm scope is an intended name only. Authentication and registration
  are external publishing prerequisites.
- The fixture runner compares HTTP status, exact selected headers, exact bodies, and
  object subsets. It does not yet understand JSONPath, regex, JWT claims, or ordered
  request traces.
- SQLite Durable Object and `node:sqlite` share a synchronous design and the Worker
  integration suite covers the M2 paths, but this is not a general SQLite-equivalence
  claim.
- Environment request logs are designed to retain protocol bodies, including test
  tokens. Never put production tokens, account API keys, Cloudflare credentials, or
  real personal data into a mock environment.
- Absolute issuer URLs must never be persisted. Any violation would make host cutover
  unsafe and should block release.
