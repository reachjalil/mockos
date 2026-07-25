# Threat model

Status: M3/M5 accepted, bounded M6 deployed, and F1/partial OpenAI/Anthropic F2 controls source-only
Last reviewed: 2026-07-25

## Assets and trust boundaries

Protected assets are platform Access Keys, Cloudflare credentials, environment control
authority, hashed application secrets and OAuth tokens, signing keys, and isolation
between mock environments. F1 adds mock-MCP Bearer verifiers, opaque transport
sessions, revision-bound behavior state, and captured agent traffic. Provider,
environment mock-MCP, and mock-LLM protocol surfaces are intentionally
attacker-controllable.
F2 adds provider-scoped mock-LLM credential verifiers, revisioned server definitions,
schema-v7 definition storage, and bounded OpenAI/Anthropic provider data planes. Those
data planes are attacker-controlled synthetic protocol surfaces, not management APIs.
Management MCP and `/__mockos/v1/*` control operations cross a stronger authorization
boundary.

The control credential authenticates the operator, not a provider-protocol client. It
must never be sent to an environment's OIDC, OAuth, SCIM, Graph, Okta directory, or
Classic Authn endpoint. The Worker fails closed with `503` when `API_KEY` is not
configured and returns `401` for a missing or incorrect Bearer or `X-API-Key`
credential. `/health` and provider protocol routes remain public by design.

M3 directory authentication is intentionally a mock protocol boundary: SCIM and Graph
require a non-empty Bearer value, and the Okta `/api/v1` surface requires a non-empty
SSWS value. Scheme-and-presence validation is not authorization and must never be
presented as a production identity control. Environment URLs and synthetic directory
credentials should be treated as test artifacts, not security boundaries.

Primary threats are environment-ID guessing, cross-environment SQL access, OAuth
redirect abuse, code replay, refresh-token theft, signing-key confusion, stored XSS in
hosted pages or logs, refresh-family replay races, lifecycle/token-state drift,
cross-environment directory access, authentication-state user enumeration, Authn
state/session capability theft or replay, parser or body resource exhaustion, secret
leakage through logs, unbounded SQLite growth, denial of service, and SSRF through
outbound provisioning targets. F1 additionally considers forged internal routing
metadata, platform-key confusion with a mock Bearer value, raw session disclosure,
  session fixation or cross-server replay, stale sessions/cursors after definition
  replacement or delete/recreate, pathological JSON Schema and URI-template input,
  prototype traversal, configured error-map ambiguity, sequence-state races, aborted
  latency that commits state, and secret reflection through observations.
F2 definition threats add platform-key confusion with either provider key, plaintext
or verifier reflection through safe reads/behavior material, cross-environment
definition access, lost updates, delete/recreate revision reuse, canonicalization
ambiguity, malformed persisted rows/allocator regression, definition-size denial, and
unsafe rollback after a schema-v7 store has been opened. A safe-view marker mistakenly
reused as a write also risks an ambiguous credential update, so it must fail rather
than imply preservation. The provider data planes additionally consider malformed or
double-decoded route selection, cross-environment or cross-dialect dispatch,
caller-spoofed internal routing headers, alternate-header/platform-key authentication
confusion, credential rotation races, credential reflection through request
fingerprints/errors/logs, oversized or adversarial JSON/tool schemas, unknown provider
fields that silently change semantics, undeclared tool output, stale-definition plan
commit, content-derived transport-ID reuse, and abort/timing resource consumption.
Anthropic adds version/beta header confusion, authorization-alias confusion, malformed
tool history, and model-pagination assumptions.

## Implemented controls and evidence boundaries

- Authenticated MCP and HTTP control routes compare against the configured Access Key,
  fail closed when it is absent, and remove control credentials before forwarding.
- `put_mock_mcp_server` rejects a Bearer Mock Credential equal to the active self-host
  platform key before persistence. The write credential is hashed; list/get views
  return only `configured: true`, and their strict schemas cannot contain token or
  verifier material.
- `put_mock_llm_server` independently rejects the complete active self-host platform
  key as a substring anywhere in a bounded submitted definition's JSON keys or string
  values at Worker ingress and again inside the Environment Durable Object. Each
  strict provider key is write-only and hashed before repository entry. Put/get views
  represent it only as `configured: true`; list summaries omit authentication
  entirely, and neither plaintext nor verifier can be copied into other definition
  material.
- Every mock-LLM put requires explicit compare-and-swap intent. `null` is create-only,
  a changed replacement must name the current positive revision, and every changed
  write consumes one environment-wide monotonic safe-integer revision. Canonically
  identical replay is checked first and returns the existing record without consuming
  a revision, making an ambiguous successful retry safe. Replacement is a complete
  write: safe-view `configured` markers are rejected, and every enabled strict
  provider key must be resupplied or rotated from caller-owned secret storage. Server
  count, model count, byte/depth/node, slug, credential, and behavior bounds fail
  before persistence.
- Unknown top-level put arguments collapse to one secret-safe generic validation issue
  rather than reflecting their key or value. Static text/directives additionally pass
  bounded neutral response-plan validation before persistence. Focused MCP tests put a
  strict key into duplicate IDs, malformed nested input, and an unknown top-level key
  and prove it is absent from serialized pre-handler failures.
- Mock-LLM delete also requires a positive expected revision. The repository validates
  and deletes in one transaction with both slug and revision in the final predicate.
  A stale or delete/recreate ABA revision returns the typed `409` without mutation;
  an absent row or a retry after successful delete returns `deleted: false`.
- Schema v7 creates only the definition and monotonic allocator tables. New writes
  use canonical JSON; persisted reads validate the contract, slug identity, and
  canonical byte form. Transactional parsing verifies the allocator's monotonicity.
  Focused tests prove v6 upgrades to v7 while preserving F1 rows and prove an older v6
  bundle explicitly refuses a v7-touched database as newer than supported. This fails
  closed but means source rollback cannot downgrade the store; recovery must roll
  forward or use a separately reviewed bridge.
- The mock-LLM resolver recognizes only the exact OpenAI and Anthropic
  path/subdomain route families,
  decodes the slug once, validates the decoded slug, and binds the body to neither an
  environment, slug, nor dialect. The edge strips all caller-supplied `x-mockos-*`
  headers before adding trusted route kind, environment, dialect, and slug metadata.
  Unsupported/malformed paths do not fall through to management behavior.
- The OpenAI route requires `Authorization: Bearer` with a bounded provider Mock
  Credential even in `accept_any` mode. `accept_any` omits verifier comparison;
  `strict` hashes the credential before reading the current definition and compares
  the fixed-length SHA-256 verifier without early exit. `X-API-Key`,
  `X-Anthropic-API-Key`, malformed/duplicate authorization, and the active platform
  Access Key as a credential substring fail before runtime dispatch. Provider
  authentication never accepts the management key as a fallback.
- The Anthropic route requires a bounded provider `x-api-key` Mock Credential even in
  `accept_any` mode and exactly `anthropic-version: 2023-06-01`. `Authorization`,
  `X-Anthropic-API-Key`, duplicate/malformed credentials, every beta header, and the
  active platform Access Key fail before runtime dispatch. Strict mode uses the same
  hash-before-current-read and fixed-length verifier comparison, scoped only to the
  Anthropic dialect.
- Chat Completions accepts only UTF-8 `application/json` with absent/identity content
  encoding, reads at most 256 KiB even without a trustworthy `Content-Length`, and
  applies depth-24/10,000-node structural limits before strict message/tool parsing.
  Messages, text, tools, nested tool values, and responses have independent count and
  byte/depth/node ceilings. Unknown top-level OpenAI fields, multimodal content,
  streaming, `stream_options`, unsupported `tool_choice`, unsafe keys, malformed
  JSON/UTF-8, and undeclared behavior-selected tools fail closed. Provider-shaped
  request errors use generic fixed messages and never serialize validation-library
  issues, input values, credentials, or runtime exceptions.
- Each adapter rejects the presented provider credential or active platform key when
  either appears in a Chat Completions or Messages JSON key or string value. The planner receives
  normalized message/tool material rather than transport or internal routing headers.
  The current slice emits no LLM-specific observation/request-log entry, so it also
  offers no LLM assertion or audit claim; that deliberate absence must not be
  described as comprehensive redaction evidence.
- Stateless planning derives the turn only from prior assistant messages. Before
  plan commit, the environment runtime rereads the definition revision and replans
  after a concurrent replacement; repeated instability fails generically. The edge
  rejects a planned tool call unless the request declared that function/custom tool.
  Every invocation receives fresh random request/completion or request/message IDs,
  while content-derived
  deterministic plan IDs remain internal. Initial response/error delay runs outside
  the Environment Durable Object with abort-aware waiting; chunk cadence stays inert
  because the data plane does not stream.
- Mock-MCP session IDs contain 32 random bytes, are returned only at issuance, and are
  persisted only as SHA-256 hashes. Lookup binds a session to server slug, current
  revision, negotiated version, initialization state, expiry, and termination.
  Every non-idempotent definition write consumes one safe environment-wide revision
  from a single durable allocator row. Replacement makes old sessions stale, delete
  cascades them without resetting that allocator, active sessions are capped at 100
  per server, and cleanup is bounded.
- F1 definitions, schemas, behavior/results, fixed/returned resource URIs, templates,
  state, pages, capabilities, error maps, and sessions have explicit
  byte/depth/node/count ceilings. Current-revision state is capped at 256 rows and 2
  MiB per server; capacity failure is atomic and uses dedicated JSON-RPC `-32050`,
  which user-defined error maps cannot claim. Unsupported
  schema vocabularies, `$ref`, `pattern`, `format`, unsafe property names, non-Level-1
  templates, dangerous URI schemes, relative identifiers, userinfo, and implicit
  prototype error-map lookups fail validation.
- Safe Level-1 resource-template reverse matching compares literals without regular
  expression backtracking. Source tests exercise a worst-shape near miss with all 20
  adjacent variables and verify bounded linear work; empty expansions,
  percent-decoding, and leftmost-minimal adjacent captures remain deterministic.
- JSON Schema assertion work has one sticky per-validation budget shared across
  speculative branches, object/array traversal, path construction, string scans,
  uniqueness checks, and canonical comparisons. Exhaustion fails closed with one root
  issue; `tools/call` input exhaustion returns a bounded HTTP-`200` tool-error result,
  does not run behavior, and does not advance state. The budget value is an internal
  availability policy, not an advertised compatibility entitlement.
- Behavior evaluation memoizes repeated match-path reads and canonical values only
  for the current request. Source regression covers 100 cases repeatedly comparing a
  12,000-property value with one path read and one canonical enumeration. Template
  rendering incrementally enforces a 256-KiB UTF-8 output ceiling and reuses
  evaluation-local canonical/byte-length work; source tests cover 200 repeated
  12,000-property placeholders and exact/over-limit multibyte boundaries.
- Pagination cursors carry kind/revision/session correctness context and reject
  malformed or wrong-scope values. Their checksum is public and unkeyed, so neither
  the cursor nor its checksum is treated as authorization or cryptographic tamper
  protection.
- The edge removes every caller-supplied `x-mockos-*` header before adding a
  discriminated identity or mock-MCP route kind, environment ID, public path, and
  validated slug. A mock-MCP route does not receive identity issuer or Graph metadata.
- Declarative latency happens outside the SQLite transaction. An HTTP Fetch
  abort/disconnect observed during latency and invalid results do not commit staged
  sequence movement, and an expected-state comparison prevents stale concurrent plans
  from overwriting newer state. This does not implement message-level cancellation:
  there is no in-flight request-ID registry, and `notifications/cancelled` is accepted
  and ignored. Clients must not infer cancellation enforcement from the HTTP `202`.
- Outbound provisioning rejects a target credential equal to the current self-hosted
  `API_KEY` regardless of prefix. The CLI checks file/stdin input before MCP, Worker
  ingress checks the authenticated request, and the Environment Durable Object checks
  before save/stage/use. A key-rotation collision with an existing saved target fails
  before outbound execution without echoing the credential.
- MCP-created environment identifiers are unguessable, and each routed request binds
  to exactly one environment Durable Object and its SQLite state.
- Redirect URIs are compared exactly. Authorization codes are short-lived, one-time,
  and S256-PKCE-bound where configured.
- Application secrets, refresh tokens, and tracked OAuth access tokens are stored as
  hashes. Signing keys remain environment-local. The active and pre-published successor
  private JWKs stay inside the signing service; rotation scrubs the previous active
  private JWK transactionally and bounds the ring to four rows. A second rotation is
  blocked for the exact 26-hour rollback/verification-overlap window qualified for
  built-in Worker/MCP issuance with a fixed one-hour lifetime and bounded skew. Trusted
  public-core test seams can create longer or overridden temporal claims and are outside
  that guarantee.
- Classic Authn verifies the password before returning account state and stores only
  hashes of bearer capabilities. Valid state reads slide expiry to five minutes from
  the read; one-time session capabilities retain a fixed five-minute issuance expiry.
  Each User is capped at 32 retained rows per capability kind and each table at 10,000,
  with oldest-expiring eviction. Each issuance prunes no more than 256 expired rows per
  table through version-neutral operational indexes that preserve schema-v5 rollback
  compatibility. Expired, cancelled, consumed, or evicted capabilities fail closed.
- Authn browser CORS permits same-origin `POST` with only `accept` and `content-type`,
  does not enable credentialed CORS, and rejects cross-origin requests with HTTP 403.
  Responses use singular `_embedded.factor` and omit `passwordChanged`, limiting
  provider-shaped data disclosure. Deactivating lifecycle transitions and SCIM
  password changes remove outstanding Authn capabilities atomically so reactivation
  cannot restore them.
- Authn log capture recursively redacts password, passcode, secret, token, credential,
  code, API-key, private-key, and authorization body keys; malformed or non-object
  bodies are replaced wholesale. Sensitive authorization, proxy-authorization,
  cookie/set-cookie, API-key, credential, password, private-key, secret, and token
  header families are redacted on requests and responses.
- Refresh grants authenticate the client, forbid scope escalation, consume and replace
  the token atomically, preserve absolute family expiry, and revoke the family plus
  associated tracked access tokens on replay or concurrent double redemption.
- Provider-valid disable, suspend, deprovision, and delete transitions revoke effective
  access/refresh credentials in the same transaction as the state change. User deletion
  also removes Group membership and increments affected Group versions atomically.
- Hosted form values are HTML-escaped, and token/login responses use no-store cache
  controls where applicable.
- Environment TTLs, request-log row and byte budgets, captured body/header limits,
  assertion result limits, scenario-size limits, and scenario-delay limits bound the
  implemented persistence and fault-injection paths.
- SCIM, Graph, and Okta directory adapters bound request paths, identifiers, query or
  filter sizes, page sizes, and supported operations. SCIM and Okta writes stream
  through 1 MiB body limits; Graph `getMemberObjects` streams through a 4,096-byte
  limit even without a trustworthy `Content-Length`, queries at most 1,001 membership
  IDs, and fails rather than returning more than 1,000; Entra token overage probes at
  most 201 IDs. SCIM additionally bounds filter tokens/depth/nodes and PATCH
  operations/depth/nodes.
- The edge removes every caller-supplied `x-mockos-*` header before adding trusted
  issuer, environment, public-path, and Graph-base routing context. Entra group-overage
  endpoints are derived from that context and never from a caller-provided URL.
- Request-log capture redacts authenticated control credentials. A logging failure is
  not allowed to make an otherwise valid identity-protocol response unavailable.
- F1 captures MCP method, tool, canonical arguments, top-level error code, and
  tool-level `isError` as bounded synthetic test evidence. Authorization and session
  headers are redacted, trusted routing headers are omitted, and raw JSON-RPC request
  and response bodies are not persisted. Bounded synthetic argument values may
  intentionally remain observable after recursive secret-key redaction. Unsupported
  top-level argument-key lengths collapse the whole observed argument object to a
  fixed redaction marker, and the log schema includes the adapter's `-32800` HTTP-abort
  error.

The [M3 workers.dev smoke](../evidence/m3-workers-dev-smoke.md) exercises a bounded
authenticated MCP, environment isolation, OIDC/JWKS, refresh/lifecycle, directory,
scenario, logging, assertion, and cleanup sample in staging and production. It is
focused acceptance evidence, not a penetration test, full fixture run, live-provider
comparison, or evidence for M5 outbound provisioning. M5 has a separate
[deployment record](../evidence/m5-workers-dev-smoke.md).

The [M6 workers.dev record](../evidence/m6-workers-dev-smoke.md) separately binds exact
source and CI to exact staging and production versions. Its functional sample covers
rotation/JWKS overlap, signed token edges, trusted path-mode group fallback, SCIM
conflict/race/tolerances, same-origin Authn CORS, account-state privacy, and exact
header/body redaction. It is not a penetration test or a remote execution of every
storage, retention, concurrency, and denial assertion above.

Those records establish deployed mock acceptance only when an exact revision is bound
to an exact mockOS deployment/version and recorded run. Verified-live evidence is a
separate tier reserved for sanitized, independently reviewed comparison with a real
Entra ID tenant or Okta organization; no current fixture or milestone has it.

## Residual and future work

The reference self-hosted deployment uses one coarse operator key per target.
Per-environment authorization, automated key rotation, account governance, and abuse
protection remain outside the public M3 deployment. Operated-service policy is a
separate private boundary and does not change this self-hosted threat model. workers.dev
path mode also lacks provider-shaped wildcard hosts, so client compatibility remains
intentionally bounded.

Environment logs intentionally retain test protocol bodies and mock tokens because
assertion is the product. This is not permission to send production secrets, account
Access Keys, Cloudflare credentials, or real personal data into a mock environment.
Operators must treat exported logs as sensitive test artifacts.

The F1 threat controls currently have source tests only. They are not a penetration
test, load/abuse envelope, hosted multi-tenant authorization review, wildcard-route
qualification, or deployment acceptance. The public self-host still uses one coarse
management key, while a mock MCP Bearer value is a synthetic per-server credential,
not team or end-user authorization. `env:ro`/`env:rw` enforcement remains F4 work.
POST-only operation, disabled GET/list-change delivery, no scripts, and no proxy are
deliberate capability reductions, not controls that may be silently bypassed.

The F2 definition and bounded OpenAI/Anthropic controls likewise have source evidence only.
They are not a penetration test, hosted rollback, multi-tenant authorization review,
load/abuse envelope, deployment, or live-provider evidence. `accept_any` deliberately
accepts any syntactically valid credential through the provider's required channel
without verifier comparison; it is suitable only for synthetic tests and is not
public/anonymous access or production authorization. `strict` compares the current
hash-only verifier, but a successful mock check still grants only this synthetic
provider behavior. Conversation/response state, reset, LLM observation/assertion,
paced streaming, Anthropic betas/broad parameters, Wrangler-network qualification,
deployment, and private Cloud pinning remain absent.
Do not expose the definition store, place real credentials in test traffic, or infer a
hosted security boundary from the local Worker integration.

Active and successor private signing JWKs are stored in per-environment SQLite without
application-level encryption. Use only synthetic environments and apply the deployment
platform's storage and access controls. The M6 deployed sample proves functional
rotation and verification, not encryption-at-rest or broad storage-security
qualification.

M5 outbound SSRF and credential controls are described in
[outbound provisioning](./outbound-provisioning.md). The Worker and worker-kit suites,
full repository gate, independent source review, two-process e2e, hosted CI, and
source-paired staging/production controlled-target smoke are green. Workers cannot pin
DNS answers, so operators must restrict
targets and add external egress enforcement where required. UserInfo, the unimplemented
remainder of the Okta Classic transaction machine, broad Graph/Okta API parity, and
custom-domain routing likewise remain outside the accepted boundary. The bounded
Classic primary-authentication states, privacy, CORS, and redaction have sampled
deployed evidence; deeper retention, revocation, and issuance-race results remain
source evidence, and verified-live comparison remains open.
