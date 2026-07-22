# SCIM 2.0 behavior

Status: Accepted bounded inbound SCIM and tested M5 outbound slice; no live-provider parity claim
Last reviewed: 2026-07-22

mockOS has an accepted bounded inbound SCIM 2.0 implementation. It includes portable
[wire contracts](../../packages/contracts/src/scim.ts),
bounded [filter](../../packages/core/src/scim/filter.ts) and
[PATCH](../../packages/core/src/scim/patch.ts) implementations, versioned directory
repositories, the [SCIM HTTP adapter](../../packages/engine-http/src/scim.ts), and the
[Worker mount](../../apps/worker/test/scim.integration.test.ts). All 113 SCIM fixtures
execute green against the local HTTP composition, and focused Worker tests exercise the
mounted runtime. The exact M3 revision passed the full repository gate, hosted CI, and
a bounded staging/production deployed sample. This is not a live-provider comparison
or a claim that all fixtures ran remotely.

## Accepted endpoint contract

Every route below is relative to `/scim/v2` and requires a non-empty mock Bearer
credential. The credential check is intentionally bounded protocol-test authentication;
it does not validate an external identity-provider token and must not be treated as
production authorization.

| Route | Methods | Accepted M3 behavior |
| --- | --- | --- |
| `/ServiceProviderConfig` | `GET` | Advertises PATCH, filter, and ETag support, a filter result maximum of 200, and no Bulk or sort support |
| `/ResourceTypes`, `/ResourceTypes/{id}` | `GET` | Lists and retrieves the advertised User and Group resource types |
| `/Schemas`, `/Schemas/{schema-uri}` | `GET` | Lists and retrieves the core User, core Group, and enterprise User extension schemas |
| `/Users` | `GET`, `POST` | Lists, filters, paginates, and creates Users; create returns `201`, `Location`, and a weak ETag |
| `/Users/{id}` | `GET`, `PUT`, `PATCH`, `DELETE` | Reads, replaces, patches, and deletes a User; successful writes return the representation except `DELETE`, which returns `204` |
| `/Groups` | `GET`, `POST` | Lists, filters, paginates, and creates Groups |
| `/Groups/{id}` | `GET`, `PUT`, `PATCH`, `DELETE` | Reads, replaces, patches, and deletes a Group; Entra-style Group PATCH can return `204`, while the common and Okta profiles return `200` |

Unsupported methods return a SCIM error and `405` with an `Allow` header. SCIM JSON
responses use `application/scim+json`; writes accept that media type and
`application/json` as an explicit compatibility allowance. Resource errors use the
SCIM Error schema with a string HTTP status and, when applicable, `invalidFilter`,
`tooMany`, `uniqueness`, `mutability`, `invalidSyntax`, `invalidPath`, `noTarget`,
`invalidValue`, or `invalidVers`.

## Filters, pagination, PATCH, and versions

The filter parser produces a typed AST and supports `eq`, `ne`, `co`, `sw`, `ew`,
`pr`, `gt`, `ge`, `lt`, and `le`, plus `and`, `or`, `not`, grouping, and one-level
multi-valued `valuePath` expressions. Evaluation is case-insensitive unless an
attribute is configured as case-exact. The current implementation evaluates canonical SCIM
resources; it does not claim a general SCIM-to-SQL compiler.

Pagination is one-based. `startIndex` must be at least 1, `count` is between 0 and 200,
and the default count is 100. `attributes` and `excludedAttributes` are each bounded to
4096 characters; only the locally tested projection subset is claimed.

PATCH accepts one through 100 operations. Structural field and operation-name matching
is case-insensitive for provider compatibility. The core applies pathless operations,
simple and schema-qualified paths, filtered multi-valued paths, required/read-only
checks, primary-value normalization, membership de-duplication, and semantic no-op
detection. Entra-specific member-array removal and Okta-style pathless replacement are
selected through provider profiles rather than engine forks.

### M6 deterministic edge scenarios

The M6 slice adds three typed actions at two reserved internal injection points.
They are synthetic application-test controls, not observed Entra or Okta behavior:

| Injection point | Typed action | Bounded behavior |
| --- | --- | --- |
| `scim.before_commit` | `scim_conflict` | Rejects the next SCIM write with `409 uniqueness` before any requested field, lifecycle, version, or membership mutation commits |
| `scim.before_commit` | `scim_soft_delete_race` | For an existing User or Group, atomically commits only the competing tombstone and returns `404`; selecting it for create fails with `409` and inserts nothing |
| `scim.patch_parse` | `scim_patch_tolerance` | Enables exactly one selected malformed PATCH repair: add a missing PatchOp `schemas` field or wrap one singleton `Operations` object in an array |

The action and point are locked together by the wire schema. Generic delay, error, and
response-mutation actions cannot use these internal points; SCIM edge actions cannot be
moved to `scim.request`, `*`, or another protocol point. Strict PATCH parsing remains
the default. Internal evaluation is exact-only, so an existing `*` catch-all is neither
executed nor consumed at either boundary. A tolerance action repairs only `missing_schemas` or
`singleton_operations`; it does not remove unknown fields, coerce values, repair both
defects at once, or broaden operation/path semantics.

Race and conflict decisions use the persisted deterministic scenario evaluator. A
one-shot action is consumed once; a replay then observes the committed directory state.
For a soft-delete race, concurrent and later writes therefore converge on `404`. User
tombstoning removes memberships and bumps affected Group versions through the existing
directory transaction, while the losing requested patch never partially persists.

Resources use weak entity tags of the form `W/"<positive decimal>"`. `If-Match` is
optional and accepts the current tag or `*`; a stale precondition returns `412` without
a `scimType`. Semantic no-ops preserve `updatedAt`, the resource version, and the ETag.
Item reads support `If-None-Match` and return `304` when a supplied tag matches.

## Bounded inputs

| Input | Accepted M3 limit |
| --- | --- |
| Request body | 1 MiB, checked while streaming; malformed UTF-8 and JSON fail closed |
| User or Group route id | 128 bytes |
| Schema route id | 2048 bytes |
| Page size | 200 resources |
| Filter | 8192 bytes, 256 tokens, depth 16, 128 AST nodes |
| Filter path / literal | 2048 / 4096 bytes |
| PATCH | 100 operations, depth 16, 20,000 JSON nodes |
| PATCH arrays / objects / strings / paths | 10,000 items / 256 keys / 16,384 bytes / 2048 bytes |

These limits are test-safety boundaries, not claims about Entra or Okta service limits.

## Directory identity and lifecycle semantics

`userName` is globally unique using case-insensitive normalization. The uniqueness
check includes soft-deleted tombstones, so deleting a User does not currently release
its former `userName`; restore and name-reuse policy remain an explicit limitation.
`externalId` is deliberately non-unique for Users and Groups, and Group `displayName`
is also non-unique. Callers must therefore tolerate multiple filter matches for those
attributes.

The directory retains `staged`, `active`, `disabled`, `suspended`, `deprovisioned`, and
`deleted` states. SCIM `active=true` selects the provider-valid transition to active.
On create, `active=false` produces `disabled` for Entra and `staged` for Okta. For an
existing active User, `active=false` disables Entra and deprovisions Okta; idempotent
repeats preserve the resource version while still applying lifecycle revocation.
Deleted Users remain tombstones and are not returned from normal lists.

Provider lifecycle policy remains distinct:

- Entra supports activate, disable, reactivate, and delete. Its provisioning profile
  is users-before-groups with disable-then-delete semantics, case-insensitive PATCH
  operations, filtered email/member paths, and `204` Group PATCH responses.
- Okta supports activate/reactivate, suspend/unsuspend, deprovision, and delete. Delete
  requires a deprovisioned User in the lifecycle service. Its provisioning profile is
  users-before-groups with deactivate semantics, PUT-heavy replacement, pathless
  replacement, filtered membership changes, and `200` Group PATCH representations.

Disabling, suspending, deprovisioning, or deleting through lifecycle policy revokes
effective access and refresh credentials transactionally. User deletion also removes
group memberships and increments each affected Group version in the same transaction.
Refresh-token rotation preserves family, original authentication time, and absolute
expiry; scope escalation is denied, and replay or concurrent double redemption revokes
the refresh family and its associated access tokens. These behaviors are exercised by
focused [lifecycle-cascade Worker integration](../../apps/worker/test/lifecycle-cascade.integration.test.ts).
The deployed M3 smoke sampled the Entra lifecycle cascade; Okta lifecycle remained a
local/hosted test path. Neither provider was compared with a live tenant.

## Fixture and evidence ledger

The [SCIM fixture corpus](../../packages/testkit/fixtures) contains 113 independently
loadable, source-reviewed cases: 91 RFC, 10 Entra, and 12 Okta fixtures. It covers the
route surface, User and Group CRUD, filtering, pagination, ETags, no-ops, errors,
parser limits, and provider PATCH dialects. The
[corpus-lock test](../../packages/testkit/src/testkit.test.ts) checks count, unique
names, area, provider distribution, and implementation/documentation status. It records
113 source-implemented fixtures and zero documented-only fixtures. The dedicated
[fixture executor](../../packages/engine-http/src/scim-fixtures.test.ts) runs all 113
against the local HTTP composition and is green.

Eight additional synthetic M6 regression fixtures under
[`packages/testkit/fixtures/m6/scim`](../../packages/testkit/fixtures/m6/scim) exercise
strict-default parsing, each narrow tolerance, case isolation, pre-commit conflict, and
Group soft-delete behavior. They are intentionally separate from the 113
source-reviewed provider/RFC conformance fixtures and do not change that corpus's
evidence count.

The corpus is not a live capture, corpus-wide deployed fixture run, or live-provider
conformance result. Focused Worker integration, the full gate, and hosted CI are green;
the M3 deployed smoke sampled discovery/PATCH for both profiles, while the
[M6 deployed smoke](../evidence/m6-workers-dev-smoke.md) sampled the injection-locked
conflict, soft-delete race, strict defaults, and two narrow tolerances. Neither ran all
113 accepted fixtures or the complete eight-case M6 edge corpus remotely. Live
Entra/Okta comparison remains pending. Outbound SCIM provisioning has separate
M5 local and source-paired hosted acceptance; see the
[provisioning quickstart](../quickstarts/provisioning-cycle.md),
[outbound security design](../security/outbound-provisioning.md), and
[known limitations](../known-limitations.md).
