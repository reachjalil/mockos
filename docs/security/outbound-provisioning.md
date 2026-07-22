# Outbound provisioning security

Status: M5 source and manual hosted acceptance passed; guarded promotion remains unqualified
Last reviewed: 2026-07-22

Outbound SCIM turns user-controlled configuration into network access. mockOS treats a
target URL and its response as untrusted at every stage. The public self-hosted Worker
does not call the private hosted control plane, and the hosted composition adds only
tenant authorization and quota reservation around the same public Workflow and
Environment Durable Object implementation.

## Target policy

The default policy requires HTTPS. A self-hoster may set
`ALLOW_INSECURE_TARGETS=true` for an HTTP development target, but that switch does not
permit literal private or special-use addresses. The validator rejects:

- URL user information, fragments, unsupported schemes, and origin-escaping operation
  paths;
- literal loopback, private, link-local, carrier-grade NAT, multicast, documentation,
  benchmarking, and other non-public IPv4 ranges;
- non-global and special-use IPv6 literals;
- `localhost`, dotless names, and names ending in `.local`, `.internal`, `.test`, or
  `.invalid`; and
- the configured mockOS public, base-domain, and Entra hosts, including their
  subdomains; deployment configuration also pins the complete public, edge, and
  control workers.dev host set for both production and staging.

The same validator runs when inline or saved target metadata is accepted and again
immediately before every fetch. Operations are resolved beneath the configured SCIM
base path and may not change origin or escape that path.

Cloudflare Workers do not expose a general DNS-resolution and connection-pinning API.
The hostname checks therefore reduce SSRF exposure but cannot eliminate DNS rebinding
or a public hostname that later resolves to a private address. Operators needing a
stronger boundary must enforce outbound policy outside the Worker or allow-list targets
at an egress proxy. This remains a documented residual risk rather than a claim that
hostname validation is DNS pinning.

## Request and response boundary

The executor constructs the request from a portable planner operation. It accepts only
the bounded SCIM methods and product-generated content negotiation headers, attaches
the target's scoped Bearer credential itself, and never forwards an inbound
`Authorization`, Cookie, platform Access Key, Cloudflare credential, or proxy header.
Workers do not implement `redirect: "error"`, so the executor forces
`redirect: "manual"` and rejects every 3xx response before any redirected request can
leave the Worker.

Each request has a 10-second default timeout. The generic fetch boundary has a 2 MiB
ceiling, and provisioning narrows request and response bodies to 64 KiB. The response
is consumed only within that bound. Only GET transport failures receive up to two
automatic Workflow retries. POST, PUT, PATCH, and DELETE are never automatically
replayed because a target may have committed before its response was lost. An HTTP
response is not converted into an infrastructure retry: HTTP 429 is recorded and
interpreted into an explicit, bounded wait plus retry operation, while other 4xx/5xx
responses remain assertable outcomes.

Prepared source state and plans are capped at 512 KiB, source/watermark counts are
bounded before a Workflow step persists them, and a conservative worst-case expansion
check rejects an oversized plan before the first outbound call. The check accounts for
lookup, update/deactivate/delete chains, explicit 429 attempts, and GET transport
retries under the 250-request run ceiling.

The full synthetic SCIM request/response shape is recorded under request-log source
`outbound`, but the target Bearer value is redacted from request headers and from any
target response that reflects it. Workflow parameters, MCP results, run metadata, and
error messages contain only safe target metadata and a credential reference. A saved
or run-scoped target credential is necessarily retained inside that environment's
Durable Object so it can perform later requests; it is synthetic test data and must
never be a production credential. Run-scoped credentials are deleted when the run is
finalized or compensated.

## Hosted authorization and quota

The hosted edge first resolves the environment through the authenticated organization
boundary. Starting a run then takes a strongly consistent control-service reservation
against the plan's UTC-day provisioning quota. Reservation identity includes the
organization, environment, API-key metadata, request, and run ID; a conflicting or
cross-tenant replay fails closed.

Only after reservation does the edge stage target data and create the Workflow by its
fixed run ID. A confirmed pre-start failure first performs an atomic queued-only
runtime compensation; only its exact semantic acknowledgement permits cancellation of
the matching quota reservation. If the run became running, either dependency is
indeterminate, or cleanup cannot be confirmed, the target state and quota remain
fail-closed. An exact same-input retry revalidates frozen target metadata and the
credential without exposing them, then resumes or returns the fixed run without taking
a second reservation. Cancellation remains possession-bound to the original key hash,
request, run, organization, and environment even if that key expires or is revoked
after reservation.

That recovery guarantee is deliberately scoped to an active queued or running run. If
the caller loses the response and retries only after the original run is terminal,
M5 has no caller-supplied idempotency key with which to distinguish a replay from an
intentional new cycle; the new call can create another run and consume another quota
unit. Request-level terminal replay is deferred to the F4 idempotency design. Clients
must retain the returned run ID, avoid blind whole-cycle retries after an ambiguous
terminal outcome, and use target/request evidence to resolve it.

Platform-level `errored` or `terminated` status is reconciled atomically when an exact
same-input retry encounters the still-active run. M5 does not run a background orphan
sweeper, so a Workflow failure that bypasses application cleanup can retain its active
lock and staged credential until that retry (or environment expiry/deletion) performs
the reconciliation. Known terminal reconciliation keeps the already-consumed hosted
quota unit because outbound execution may have begun.

The raw platform Access Key remains inside a request-scoped capability and never enters
a Workflow parameter, environment Durable Object row, MCP session, log, or returned
problem document. Hosted MCP ingress authenticates before reading the body and enforces
the same 2 MiB declared-and-streamed limit at the edge and session boundary; target
base URLs are capped at 2,048 characters before they can be staged.

Credential confusion also fails closed for arbitrary self-hosted key formats. A target
Bearer beginning with `mk_` is rejected, and a target Bearer exactly equal to the
currently configured self-host `API_KEY` is rejected regardless of prefix. The source
CLI performs a constant-time comparison against its active profile/environment key
before calling MCP; Worker ingress and the Environment Durable Object independently
enforce the runtime boundary before save, stage, or use. If an operator rotates
`API_KEY` to a value already stored as a target credential, the per-operation Durable
Object check stops execution before an outbound call or step write and does not reveal
the value.

## Verification boundary

Source tests cover rejected names and IP families, URL user information, request and
response size caps, redirect mode, timeout signals, per-fetch validation, credential
redaction and key-rotation collision, ordered outbound assertions, Workflow replay,
explicit 429 handling, and hosted quota denial/compensation. The full local gate and
two-process target-app e2e are green. Exact-revision CI, staging and production
Workflow version IDs, sanitized provisioning smoke, and cleanup then passed through
the source-paired hosted composition; see the
[M5 deployment evidence](../evidence/m5-workers-dev-smoke.md). That manual rollout did
not qualify the guarded GitHub promotion workflows, and neither source nor deployed
evidence is a penetration test or live-provider comparison.
