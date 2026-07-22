# Known limitations

Status: Current M3 source-candidate limitations; deliberately candid
Last reviewed: 2026-07-22

- The Entra OIDC fixtures are source-reviewed expectations marked `documented`.
  They have not been validated against a live tenant. The linked Worker OIDC and
  lifecycle-cascade tests prove only their exercised authorization-code,
  refresh/lifecycle, and error slices, not corpus-wide parity.
- The M2 deployed smoke uses the Entra path. Okta discovery, authorization-code, PKCE,
  introspection, revocation, and device-flow behavior passes local Worker tests but has
  not been compared with a live Okta tenant or run in the deployed acceptance flow.
- Entra remains a narrow OIDC/OAuth slice. Authorization code and rotating refresh
  grants have local evidence; client credentials, device flow, UserInfo, logout
  fidelity, and SAML remain unimplemented or unqualified.
- The bounded SCIM parser/PATCH/core service, HTTP adapter, and Worker mount are M3
  source-candidate evidence. All 113 SCIM fixtures execute green against the local HTTP
  composition, with focused Worker integration tested separately. This is not a
  live-provider comparison or deployed M3 SCIM smoke. The full local `pnpm check` is
  green, but hosted M3 CI is still pending.
- SCIM, Graph, and Okta directory authentication is intentionally presence-and-scheme
  validation for synthetic protocol tests. A non-empty mock Bearer or SSWS value is not
  a real access-control decision; never expose these surfaces as production identity
  infrastructure or send the MCP Access Key to them.
- The Microsoft Graph surface is read-only and bounded to tested User, Group, direct
  membership, filter, projection, and pagination behavior. The Okta `/api/v1` surface
  is limited to the tested Users/Groups, direct membership, and lifecycle routes.
  Okta Group-member listing is currently unpaginated and can return up to the directory
  membership cap. Neither surface claims broad provider API parity, and Okta Classic
  `/api/v1/authn` is absent.
- Lifecycle transitions model only the documented Entra/Okta action matrices. Token
  revocation covers tracked access and refresh credentials; there are no production
  sessions, external provider sessions, downstream application cookies, or distributed
  revocation fan-out to invalidate.
- Okta SCIM deletion of a non-deprovisioned User applies deprovision and delete as two
  sequential lifecycle transactions. An unexpected storage failure between them can
  leave a safely deprovisioned User; retrying the same DELETE completes the tombstone.
- Refresh tokens rotate only within this deterministic mock. Scope escalation and
  replay fail closed, but sender-constrained tokens, refresh-token binding, distributed
  race behavior, provider-specific grace windows, and every obscure parameter
  combination are not claimed.
- The source candidate supports bounded deterministic delay, semantic error, and
  JSON-object mutation actions at known injection points, including directory-specific
  `scim.request`, `graph.request`, and `okta.api` error/delay routing. It does not yet
  provide scheduled lifecycle events, outbound-provisioning failures, or the F-series
  behavior system.
- The authenticated MCP source candidate contains 14 management tools, including
  `simulate_lifecycle`. It does not yet host
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
  for one candidate. They do not establish that the M3 source candidate is deployed.
  They are qualification surfaces without a custom domain, uptime commitment, data
  durability promise, or production-service SLA. Hosted CI is green for the exact M2
  candidate, but M3 hosted CI remains pending. The M2 deploy-workflow run was skipped
  by explicit opt-in; automated deployment execution is not yet qualified.
- The `@mockos` npm scope is an intended name only. Authentication and registration
  are external publishing prerequisites.
- The fixture runner compares HTTP status, exact selected headers, exact bodies, and
  object subsets. It executes all 113 SCIM fixtures against the local HTTP composition,
  not every fixture through the Worker runtime; focused Worker coverage is a separate
  suite. The runner does not yet understand JSONPath, regex, JWT claims, or ordered
  request traces.
- SQLite Durable Object and `node:sqlite` share a synchronous design, and focused
  Worker integrations cover OIDC/MCP plus M3 directory/lifecycle paths, but this is not
  a general SQLite-equivalence claim.
- Environment request logs are designed to retain protocol bodies, including test
  tokens. Never put production tokens, account API keys, Cloudflare credentials, or
  real personal data into a mock environment.
- Absolute issuer URLs must never be persisted. Any violation would make host cutover
  unsafe and should block release.
