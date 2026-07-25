# Known limitations

Status: Accepted M3/M5 boundaries, sampled M6 deployment, source-only M7, locally
source-qualified F0/F1, the partial F2 kernel, bounded MSAL Node local X/Q, and
remaining limits; deliberately candid
Last reviewed: 2026-07-26

Designed (D), implemented (I), source-tested (S), integration-tested (X), pinned
SDK/client-qualified (Q), hosted-smoke (H), verified-live (V), and production-ready
(P) are separate levels. Hosted CI is source execution; H requires an exact remote
serving version and recorded smoke; V requires sanitized, reviewed real-provider
comparison. The bounded MSAL Node slice is D/I/S/X/Q yes and H/V/P no. The bounded M6
slice has sampled H evidence, but no current fixture is V or P.

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
- The only official Entra identity-client qualification is `@azure/msal-node` 5.4.2
  as a confidential client for one tenant-specific custom authority, authorization
  code with S256 PKCE, and forced silent refresh. It uses host-only
  `knownAuthorities` plus `ProtocolMode.OIDC` and passes through local Wrangler HTTPS.
  The management path is separately driven by `@modelcontextprotocol/sdk` 1.29.0. This
  is local X/Q evidence, not workers.dev, hosted Cloud, or custom-domain H. It does not
  qualify `@azure/msal-browser`, public-client helpers, device or client-credential
  grants, on-behalf-of, `common`/`organizations`/`consumers`, Graph SDK, a real Entra
  tenant, or P.
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
- Structured provider request-log capture now redacts secret-bearing form and JSON
  keys across routes, sensitive request/response header families, and secret query or
  fragment fields in redirect `Location` values before persistence. The MSAL
  actual-network flow and focused lifecycle Worker test prove absence of its password,
  client secret, authorization code, PKCE verifier, and issued token values while
  retaining the safe request sequence. This is not a general content-classification or
  log-security audit: non-secret structured protocol fields and non-JSON response bodies
  may still be retained. Malformed form/JSON, primitive JSON request, and
  unsupported-media request bodies are replaced rather than stored, but production
  credentials and personal data remain prohibited.
- The MSAL harness has focused normal-completion and ready-Worker `SIGTERM` cleanup
  evidence: the signal probe observes exit `143`, port release, Wrangler process-group
  exit, and temporary-state removal. It does not qualify uncatchable `SIGKILL`, Windows
  process-tree behavior, abrupt machine loss, or every interruption point while the
  client is active.
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
  events, or the F-series behavior runtime.
- The authenticated M3 MCP registry contains 14 management tools, including
  `simulate_lifecycle`. M5 adds `run_provisioning_cycle` as tool 15. Its authenticated
  mount, local gates, hosted CI, and exact-pair controlled-target acceptance are green.
  The standalone public staging/production Access Keys were preserved, so the
  authenticated hosted acceptance ran through the private edge consuming the public
  runtime rather than those standalone credentials.
  F1 appends five locally source-qualified tools for environment-hosted mock MCP
  definitions and state. Those five have no inherited M5 hosted/deployed acceptance.
- The locally source-qualified F1 implementation supports only MCP `2025-11-25` over POST-only Streamable
  HTTP. `GET` returns `405`; there are no `listChanged` notifications, JSON-RPC
  batches, legacy HTTP+SSE fallback, or second protocol-version adapter. The route is
  source-tested in path and subdomain resolution, but no current workers.dev version,
  wildcard TLS route, private hosted composition, or external ecosystem matrix is
  qualified for F1.
- F1 protects staged sequence state when an HTTP Fetch abort/disconnect is observed
  during configured latency and uses JSON-RPC `-32800` if it can still render a
  response. It has no in-flight request-ID registry: `notifications/cancelled` is
  accepted with HTTP `202` and deliberately ignored. MCP defines cancellation as a
  SHOULD rather than a MUST, but clients cannot rely on message-level cancellation in
  this tranche.
- F1 supports bounded declarative `static`, `template`, `match`, `sequence`, and
  configured `error` behavior. A `script` definition can only use an explicit
  declarative fallback or fail closed because no executor is installed. `proxy`
  record/replay is rejected. Served mock OpenAI/Anthropic APIs, Code Mode, team ACLs,
  blueprints, and OIDC-federated CI access remain future work.
- The partial F2 source slice is a pure response kernel, not a mock LLM service.
  Provider-neutral schemas, behavior-to-plan adaptation, selected OpenAI Chat
  Completions and Anthropic Messages JSON/SSE-frame renderers, and official-SDK
  consumption through injected in-process Fetch are source-tested. There is no
  LLM server definition, management MCP operation, public route, request parser,
  authentication, persistence or persisted server sequence/conversation owner,
  edge-paced SSE network stream, observation/assertion support, Worker or Durable
  Object composition, private Cloud pin, Wrangler round trip, hosted CI, deployment,
  or verified-live comparison. The official-SDK harness hand-supplies
  model-list/retrieve fixtures; there is no model renderer or catalog. No listener
  emits the serialized SSE frames. The 20-tool management registry is unchanged. Do
  not configure either planned
  `/e/{environmentId}/llm-mock/{slug}/{provider}/v1` route because neither exists.
  Pure fixtures reuse content-derived plan IDs for deterministic provider/request
  correlation, not unique invocation IDs, and omit Anthropic organization identity
  because no HTTP/auth context exists. A future edge must inject both. Error and
  stream cadence are bounded inert metadata; no renderer sleeps or paces a network
  response.
- The OpenAPI document contains exactly five already-implemented self-hosted HTTP
  control routes; the other 15 management MCP operations, including all five F1
  operations, are deliberately absent from the HTTP client. `env:ro`/`env:rw` are
  contract metadata until F4 implements scoped-key/role/ACL enforcement. Code Mode has
  no Worker import, flag, `LOADER`, or `worker_loaders` binding, and `NoSandbox` always
  rejects JavaScript. The client, Code Mode, sandbox, and mock-MCP packages remain
  unpublished workspaces; local builds do not qualify npm distribution.
- F1 schemas intentionally implement a bounded JSON Schema subset rather than a
  general validator. `$ref`, `pattern`, `format`, remote schemas, unsafe keys, and
  unknown vocabularies are rejected. Resource templates support only safe absolute
  Level-1 `{variable}` expressions. Their bounded reverse matcher accepts empty
  expansions, decodes percent-encoded reserved characters, and assigns adjacent
  variables leftmost-minimally; raw reserved characters do not belong to a simple
  expansion. Server definitions are capped at 64 capabilities per kind and 64 servers
  per environment; pages are capped at 50 and stateful servers at 100 active sessions.
  Current-revision application state is capped at 256 rows and 2 MiB per server.
  Pagination cursors use a public unkeyed checksum for correctness; they are opaque
  client tokens, not authorization credentials or cryptographic tamper protection.
- Structurally bounded tool input can still exhaust the validator's internal shared
  work budget when composition, traversal, path rendering, uniqueness, or canonical
  comparison multiplies work. It then returns a bounded tool-level schema mismatch
  with one root diagnostic instead of attempting exhaustive validation. The numeric
  budget is not a compatibility guarantee. Template expansion is independently
  capped at 256 KiB of UTF-8 output; stricter method-result limits can reject a
  smaller rendered value.
- The additive M7 management-read substrate is source-only. Application and scenario
  pages default to and are capped at 25 records, use kind-bound keyset cursors, and are
  exposed only as typed Environment Durable Object RPCs in this slice. No new MCP tool,
  public HTTP route, or CLI command was added. Application creation still returns its
  plaintext client secret exactly once; later application pages are a distinct strict
  summary shape that contains neither the secret nor its stored hash. There is no
  secret recovery endpoint, and an ambiguous failed create response must not be retried
  automatically. Hosted CI, exact-version deployment, private control-plane ownership
  enforcement, no-store response handling, and console one-time-display behavior remain
  pending evidence rather than inherited claims.
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
- workers.dev cannot provide wildcard subdomains. The MSAL Node local qualification
  proves an explicit request-derived path authority only against an HTTPS loopback
  Wrangler listener; no workers.dev or Cloud client smoke has run. SDKs that require
  an Okta-style bare organization host may not work before custom-domain cutover.
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
- Environment request logs are designed to retain assertable protocol structure and
  may retain non-secret synthetic fields. Structured form/JSON secret keys, sensitive
  headers, and redirect-location secrets are now redacted generally. Malformed JSON,
  malformed form requests, primitive JSON requests, and unsupported-media request
  bodies are replaced with markers. Credential-bearing OAuth, device, activation, and
  Classic Authn paths use a stricter authentication-body marker where applicable.
  These rules are path-, key-, and media-type based, not a promise to detect every
  credential in arbitrary retained content. Never put production tokens, account API
  keys, Cloudflare credentials, or real personal data into a mock environment.
- Absolute issuer URLs must never be persisted. Any violation would make host cutover
  unsafe and should block release.
