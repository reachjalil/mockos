# Live-provider parity roadmap

Status: Comparison foundation landed and unit-tested; no real tenant has been contacted, so every case remains not-captured
Last reviewed: 2026-07-26

This is the continuation guide for live-provider parity. It records what exists,
what is missing, and exactly where to resume. Current per-case state lives in the
generated [live parity report](./live-parity.md); this file explains the system
around it.

## Why this exists

mockOS sells one claim: its mock behaves like the real provider. Only a
comparison against a real tenant can substantiate that. The evidence ladder
reserves **verified-live (V)** for exactly this, and no fixture has ever earned
it.

Credentials were not available when the foundation was built, so the work was
inverted deliberately: build and prove the entire comparison machine offline, and
let real captures drop in opportunistically later.

## The rule this system is built around

**Parity never blocks a release.**

- Only the harness's own unit tests gate. They are pure functions with no network.
- `pnpm live-parity:check` verifies the report is regenerated and internally
  consistent. It does **not** assert that parity holds.
- Every case ships `enforcement: "advisory"`. Promote one to `enforcing` only
  after it has been stable across several captures.
- A missing credential must be a skip, never a failure and never a pass.

## What exists today

| Piece | Path | State |
|---|---|---|
| Observation record and client-side interceptor | `packages/testkit/src/parity/observation.ts` | Done, unit-tested |
| Normaliser | `packages/testkit/src/parity/normalize.ts` | Done, unit-tested |
| Comparator and ledger classification | `packages/testkit/src/parity/compare.ts` | Done, unit-tested |
| Divergence ledger | `docs/conformance/divergence-ledger.json` | 25 seeded entries |
| Scenario matrix | `docs/conformance/live-parity-manifest.json` | 28 cases, all `not-captured` |
| Report generator and drift check | `scripts/generate-live-parity.mjs` | Done, unit-tested |
| Mock-versus-mock self-test | `packages/testkit/src/parity/self-test.test.ts` | Done, green |

Commands: `pnpm live-parity:generate`, `pnpm live-parity:check`,
`pnpm live-parity:test`.

### Design decisions worth not relitigating

- **Observation is client-side.** mockOS can describe its own traffic through
  `get_request_log`, but no real provider can. A client-side interceptor is the
  only channel both sides can produce, so it is the only one that yields a single
  comparator, a single redactor, and a single evidence shape.
- **Normalisation happens inside `compareCase`, not in callers.** Comparing raw
  observations leaves JWTs opaque and volatile claims mismatched, so a forgotten
  normalise step would silently turn every case into a defect.
- **Volatile values are replaced, never deleted.** A missing claim must still read
  as a difference.
- **JWTs are decoded** so claim sets compare rather than opaque strings. The
  signature is dropped: it can never match across targets, and the client under
  test asserts its validity separately.

## What is left

### 1. Live executor and capture command
Add a `FixtureExecutor` that issues real HTTPS and a `pnpm parity:capture`
entry point. It must **skip cleanly** when credentials are absent — exit 0, print
a clear skip, and leave cases `not-captured`.

### 2. Origin parameterisation
The existing harness is hardcoded to localhost in three places, all of which
refuse a non-localhost origin today:
- `scripts/e2e-local-official-client.mjs:101` builds `https://localhost:${port}`
- `scripts/e2e-entra-msal-client.mjs:21-32` guards `hostname !== "localhost"`
- `scripts/e2e-okta-mfa-authjs-client.mjs:30-43` has the same guard

Replace with a target descriptor, keeping `mock` behaviour byte-identical.

### 3. Nightly workflow
A separate workflow, `continue-on-error: true`, never a required check. It should
open a pull request with refreshed sanitised baselines rather than pushing to a
branch directly.

### 4. Fixture promotion
`status: "verified-live"` and `provenance: "sanitized-live-capture"` already exist
in `packages/testkit/fixtures/fixture.schema.json` and
`packages/testkit/src/fixtures.ts` with **zero** users. Populate them rather than
inventing a parallel axis. Note `scripts/generate-m6-parity.mjs:130` currently
hard-fails any fixture whose status is not `implemented`; widen that check before
promoting anything.

### 5. Tier B, last or never
Entra authorization-code, Entra device approval, and the Okta hosted-login
redirect all require a real interactive sign-in and therefore browser automation
plus a test user with no MFA and no Conditional Access. Fragile by nature. Treat a
Tier B failure as "someone should look", never as a release signal.

## Where to resume

**Start with Okta Classic Authn.** It is fully headless — `signInWithCredentials`
needs no browser — it is the product's headline differentiator, and it covers nine
of the twenty-eight cases including all four primary states and the factor path.
Highest value per minute of tenant access.

Suggested order once credentials exist:
1. `okta-discovery` and `okta-jwks` — read-only, proves the pipeline against a real host.
2. The Classic Authn cases.
3. Okta token, introspection, and revocation error cases.
4. Entra discovery, JWKS, and the token and device error catalog.
5. Tier B, only if it proves worth the maintenance.

## Tenant requirements

- **Entra**: free developer tenant. One confidential app (authorization code plus
  PKCE) and one public device-only app. Users covering active, disabled, and
  forced-password-change.
- **Okta**: Integrator or developer org. One public app with an exact callback and
  one confidential app, since introspection is confidential-only. Users covering
  active, suspended, and password-expired, plus one with an enrolled software TOTP
  factor whose shared secret is held as a secret so real RFC 6238 codes can be
  computed.
- Provision with an idempotent checked-in script so the tenants are reproducible
  and reviewable.

## Evidence boundary

The foundation is **designed, implemented, and source-tested** only. It has never
contacted a real tenant.

That matters for one specific reason: the normaliser's volatile-key list is a
*hypothesis* about what real providers vary, derived from reading mockOS rather
than from observing Entra or Okta. The first live capture will very likely reveal
more volatile fields, exactly as the mock-versus-mock self-test already revealed a
missing `kid`. Expect the first capture to be a normaliser-tuning exercise before
it is an evidence-gathering one.

Nothing here promotes any fixture, milestone, or capability to verified-live.
