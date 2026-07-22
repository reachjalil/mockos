# Known limitations

Status: Accepted M3/M5 boundaries plus sampled M6 deployment and remaining limits; deliberately candid
Last reviewed: 2026-07-22

Source, deployed, and verified-live are separate evidence tiers. Hosted CI is source
evidence; a workers.dev or hosted-edge run tied to an exact version is deployed mock
evidence; only sanitized, reviewed comparison with a real provider can be
verified-live. The bounded M6 slice has sampled exact-version deployment evidence, but
no M6 fixture/corpus is verified-live and no current fixture has verified-live status.

- The Entra OIDC corpus has 30 source-reviewed expectations marked `documented` and
  eight M6 token/key/overage cases marked `implemented` that execute through an
  authenticated local Worker fixture runner. None has been validated against a live
  tenant. The linked tests prove only their exercised slices, not corpus-wide parity.
- The M3 deployed smoke exercises the Entra OIDC/refresh/lifecycle path and an Okta
  SCIM/directory subset. Okta discovery, authorization-code, PKCE, introspection,
  revocation, device flow, and lifecycle behavior pass local and hosted Worker tests
  but were not run in the deployed acceptance flow or compared with a live tenant.
- Entra remains a narrow OIDC/OAuth slice. Authorization code and rotating refresh
  grants have local evidence; client credentials, device flow, UserInfo, logout
  fidelity, and SAML remain unimplemented or unqualified.
- The bounded SCIM parser/PATCH/core service, HTTP adapter, and Worker mount are
  accepted for M3. All 113 SCIM fixtures execute green against the HTTP composition
  locally and in hosted CI, with focused Worker integration tested separately. The
  deployed smoke samples discovery and Group PATCH for both profiles; it does not run
  the full corpus remotely or compare with a live provider.
- The separate M6 SCIM edge slice is deliberately injection-locked. It can
  produce an atomic `409` conflict, a soft-delete race, or exactly one of two narrow
  malformed-PATCH repairs (`missing_schemas` or `singleton_operations`). Strict parsing
  is the default. A selected repair does not tolerate the other case, combined defects,
  unknown fields, invalid paths, missing values, or type coercions. The deployed M6
  smoke sampled the conflict, race, strict-default, and two narrow-repair paths; it was
  not a remote run of the complete eight-case edge corpus or verified-live evidence.
- SCIM, Graph, and Okta directory authentication is intentionally presence-and-scheme
  validation for synthetic protocol tests. A non-empty mock Bearer or SSWS value is not
  a real access-control decision; never expose these surfaces as production identity
  infrastructure or send the MCP Access Key to them.
- The Microsoft Graph surface is read-only and bounded to tested User, Group, direct
  membership, filter, projection, and pagination behavior. The Okta `/api/v1` surface
  is limited to the tested Users/Groups, direct membership, and lifecycle routes.
  Okta Group-member listing is currently unpaginated and can return up to the directory
  membership cap. Neither surface claims broad provider API parity. The bounded M6
  implementation adds Okta Classic `/api/v1/authn` primary states, transaction
  retrieval, and cancellation, but not factor verification, password-change
  execution, recovery/unlock execution, or Sessions API exchange.
- Classic Authn state retrieval renews its five-minute expiry from each successful
  read; this is sliding state, not an unlimited transaction, because idle state still
  expires. The one-time session capability keeps its original fixed five-minute
  expiry. Both are stored only as hashes. Lifecycle changes and SCIM password changes
  revoke both kinds, and a stale post-verification User snapshot cannot issue one.
- Classic Authn retention is bounded independently per table: 10,000 retained state
  rows and 10,000 retained session rows per environment, plus 32 retained rows per
  User per kind.
  Issuance evicts the oldest-expiring rows deterministically and deletes at most 256
  expired rows from each table per pass. The supporting expiry indexes are
  version-neutral operational indexes so schema remains v5 for rollback compatibility.
- Classic Authn browser access is same-origin only. Preflight permits only `POST` and
  the `accept`/`content-type` request headers, never emits
  `Access-Control-Allow-Credentials`, and returns `403` for cross-origin requests.
  Provider-shaped MFA uses the singular `_embedded.factor` key containing an array,
  and embedded Users omit `passwordChanged`. Authn request/response bodies are
  recursively redacted by secret-like field name; malformed or primitive bodies are
  wholly replaced, and sensitive headers including authorization, proxy authorization,
  cookies, and token/secret-like headers are redacted. The deployed smoke sampled the
  public state, CORS, privacy, and redaction behavior; deeper retention/revocation/race
  tests remain source evidence, and neither tier is a general log-security audit.
- Lifecycle transitions model only the documented Entra/Okta action matrices. Token
  revocation covers tracked access/refresh credentials and removes bounded Classic
  Authn state/session capabilities. There are no production sessions, external
  provider sessions, downstream application cookies, or distributed revocation fan-out
  to invalidate.
- Okta SCIM deletion of a non-deprovisioned User applies deprovision and delete as two
  sequential lifecycle transactions. An unexpected storage failure between them can
  leave a safely deprovisioned User; retrying the same DELETE completes the tombstone.
- Refresh tokens rotate only within this deterministic mock. Scope escalation and
  replay fail closed, but sender-constrained tokens, refresh-token binding, distributed
  race behavior, provider-specific grace windows, and every obscure parameter
  combination are not claimed.
- The M6 signing-key implementation keeps active and pre-published successor private
  JWKs in the environment's SQLite state; application-level encryption at rest is not
  implemented. Rotation scrubs the previous active private JWK in the same transaction
  and bounds the ring to four rows. The rollback/verification-overlap window qualified
  for built-in Worker OIDC and MCP token issuance is exactly 26 hours; a second rotation
  is blocked during it. Public core `expiresInSeconds` and `additionalClaims` are trusted
  test seams, so longer custom lifetimes or temporal overrides are outside that
  guarantee. The deployed smoke exercised functional rotation and stale/fresh JWKS
  verification; storage-at-rest, concurrency, and broader security qualification were
  not remotely tested, and verified-live comparison remains pending.
- The M6 broken-token slice intentionally supports only `expired`, exact wrong
  audience, `not_yet_valid`, `bad_signature`, and exact wrong issuer. These are
  deterministic `mint_token` mutations, not evidence that a provider HTTP grant emits
  an equivalent token. Claim-only clock skew is bounded to plus/minus 86,400 seconds
  and does not move the environment clock or persisted grant timestamps. The deployed
  smoke exercised every broken variant and a plus-300-second signed token; it did not
  establish equivalent provider HTTP-grant behavior or verified-live parity.
- Entra group claims are inline through exactly 200 IDs. At 201 the implementation
  emits claim-source metadata for a trusted same-environment Graph
  `getMemberObjects` endpoint; it never follows a caller-supplied URL. The fallback
  returns at most 1,000 IDs and rejects a 1,001-ID result with the bounded directory
  size error. The deployed smoke exercised the exact path-mode 200/201 transition and
  resolved 201 IDs; it did not remotely exercise the 1,001-ID ceiling, subdomain mode,
  broad Graph parity, or verified-live comparison.
- The accepted M3 implementation supports bounded deterministic delay, semantic error,
  and JSON-object mutation actions at known injection points, including
  directory-specific `scim.request`, `graph.request`, and `okta.api` error/delay
  routing. The M5 runtime interprets outbound HTTP and rate-limit responses,
  but it does not add a scheduler, recurring provisioning cycles, scheduled lifecycle
  events, or the F-series behavior system.
- The authenticated M3 MCP registry contains 14 management tools, including
  `simulate_lifecycle`. M5 adds `run_provisioning_cycle` as tool 15. Its authenticated
  mount, local gates, hosted CI, and exact-pair controlled-target acceptance are green.
  The standalone public staging/production Access Keys were preserved, so the
  authenticated hosted acceptance ran through the private edge consuming the public
  runtime rather than those standalone credentials.
  The registry does not yet host
  user-configured mock MCP servers, LLM mocks, Code Mode, team ACLs, blueprints, or
  OIDC-federated CI access.
- M5 outbound provisioning is manually accepted for the exact tested source pair.
  Public revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`, CI run
  `29957994237`, the six active Worker versions, both terminal-success Workflow runs,
  and cleanup are recorded in the [M5 deployment evidence](./evidence/m5-workers-dev-smoke.md).
  This manual source-locked rollout did not execute or qualify either repository's
  guarded GitHub deployment workflow.
- Outbound targets require a public HTTPS origin in the supported production path.
  Loopback, private/special IP literals, dotless and special-use names, userinfo,
  product/control hosts, redirects, oversized bodies, and unsafe operation headers are
  denied. A self-host-only insecure-HTTP switch exists as an escape hatch, but private
  address literals remain blocked and that switch is not a hosted qualification claim.
- Cloudflare Workers do not expose a way for this runtime to resolve and pin a DNS
  answer for the subsequent fetch. The M5 policy revalidates the URL at save and fetch
  time and rejects literal/special targets, but it cannot by itself eliminate DNS
  rebinding risk for an otherwise public hostname. Operators must allow only controlled
  test targets and enforce egress policy outside the Worker where stronger pinning is
  required.
- The repository target app is a deterministic local test surface, not a production
  SCIM server. Direct loopback provisioning remains intentionally blocked; the local
  end-to-end harness uses the Worker test/service-binding seam, while deployed
  acceptance requires a controlled public HTTPS target.
- M5 start recovery can resume or return an exact fixed-ID run only while that run is
  still active. There is no caller-supplied idempotency key or terminal-result replay:
  a retry after the original run finishes is treated as a new cycle and can provision
  again and consume another hosted quota unit. Full request idempotency is deferred to
  F4; clients must retain run IDs and resolve ambiguous terminal outcomes from the
  request log and controlled-target evidence instead of blindly retrying.
- Reconciliation of a platform-level errored or terminated Workflow is retry-driven,
  not a background sweep. If platform failure bypasses the Workflow's application
  cleanup, its active lock and staged run credential remain fail-closed until an exact
  same-input retry observes and atomically reconciles the terminal instance, or until
  the environment is expired/deleted.
- Raw outbound target credentials are intended to remain in the environment Durable
  Object and are excluded from Workflow parameters, plans, logs, and returned records.
  Worker/full local tests and the process e2e cover isolation and reflection/capture
  redaction. `mk_` credentials and the exact active self-host `API_KEY` are rejected
  regardless of prefix; if rotation makes a saved target credential equal the current
  key, execution fails before any outbound call. The manual acceptance retained no
  target credential and left target state/capture empty after both runs. This is not a
  general secret-audit or penetration-test claim. Use synthetic target credentials
  only.
- Error descriptions, correlation identifiers, login HTML, cookie behavior, and
  obscure parameter combinations can differ from Entra even where the OAuth error
  code is correct.
- workers.dev cannot provide wildcard subdomains. Path mode needs explicit SDK
  authority configuration; SDKs that require an Okta-style bare organization host
  may not work before custom-domain cutover.
- Subdomain resolution can be unit tested with fake Host headers, but is not
  live-verifiable before an account-owned wildcard route and suitable certificate exist.
- The staging and production workers.dev targets most recently passed the sampled M6
  smoke for exact candidate `a01fb6abbaf85e2cd98b42a3839bebe7451cf8da`,
  including accepted regressions, reverse cleanup, empty catalogs, and exact
  serving-version probes. They remain qualification surfaces without a custom domain,
  uptime commitment, data-durability promise, or production-service SLA. The manual
  OAuth rollout and smoke workflow do not execute or qualify the separate guarded
  Cloudflare-credential deployment workflow.
- The `@mockos` npm scope is an intended name only. Authentication and registration
  are external publishing prerequisites.
- The fixture runner compares HTTP status, exact selected headers, exact bodies, and
  object subsets. It executes all 113 SCIM fixtures against the local HTTP composition
  and eight M6 Entra fixtures through the authenticated local Worker setup; it does not
  execute every OIDC fixture or all 113 SCIM fixtures through the Worker runtime. The
  runner does not yet understand JSONPath, regex, or arbitrary JWT-claim expressions.
  The M5 request-log assertion can count repeated non-overlapping ordered sequences,
  but that capability is separate from the fixture runner; the accepted M5 flow
  exercised one four-request sequence on each hosted target, not every possible
  sequence.
- SQLite Durable Object and `node:sqlite` share a synchronous design, and focused
  Worker integrations plus the sampled M3 deployment cover OIDC/MCP and selected
  directory/lifecycle paths, but this is not a general SQLite-equivalence claim.
- Environment request logs are designed to retain protocol bodies, including many
  synthetic test tokens. The M6 Classic Authn slice is an explicit exception: it
  recursively redacts password, state-token, and session-token fields in Authn request
  and response bodies, including malformed-body fallback redaction. Never put
  production tokens, account API keys, Cloudflare credentials, or real personal data
  into a mock environment.
- Absolute issuer URLs must never be persisted. Any violation would make host cutover
  unsafe and should block release.
