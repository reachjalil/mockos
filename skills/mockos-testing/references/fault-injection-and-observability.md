# Fault injection and observability workflows

## Contents

- [Mint focused token failures](#mint-focused-token-failures)
- [Rotate a signing key](#rotate-a-signing-key-with-overlap)
- [Apply token clock skew](#apply-bounded-token-clock-skew)
- [Exercise group overage](#exercise-group-overage-and-graph-fallback)
- [Inject deterministic scenarios](#inject-deterministic-scenarios)
- [Diagnose and assert requests](#diagnose-and-assert-requests)

Read the exact recipe for each planned negative or observation case.

<a id="m6-broken-token-recipes"></a>

## Mint focused token failures

Call `mint_token` with the application `clientId` and a seeded user ID or user name in
`subject`. Supply `audience` only when the test requires an explicit audience. Run the
valid token first, then choose exactly one supported `broken` variant per negative case:

- `expired`
- `wrong_audience`
- `not_yet_valid`
- `bad_signature`
- `wrong_issuer`

Assert the application's validation outcome. Do not treat `mint_token` as evidence that
the same token can be obtained from a provider HTTP grant.

<a id="m6-signing-key-rotation-recipe"></a>

## Rotate a signing key with overlap

Use a disposable Entra environment and keep all JWTs in memory. Read JWKS before the
flow and require one active key plus its pre-published successor. Complete authorization
through code issuance, then set a one-shot scenario at `token.before_sign` with
`action: { "type": "rotate_signing_key" }` before redeeming the code. Require redemption
to succeed, read JWKS again, and verify the returned token by `kid`. The former active
key, promoted active key, and new successor must all be published during the overlap.
Do not treat a fresh execution of this recipe as deployed rollover evidence unless it
is tied to an exact serving version and recorded acceptance. The immutable M6 smoke
record is the deployed reference for its sampled rotation path.

<a id="m6-token-clock-skew-recipe"></a>

## Apply bounded token clock skew

Set a one-shot `token.before_sign` scenario with
`action: { "type": "token_clock_skew", "seconds": <integer> }`; the integer must remain
within plus or minus 86,400 seconds. Mint one token and assert only its temporal claims
move by the selected offset. The environment clock and stored authorization, device,
and refresh-grant timestamps must remain unchanged. Clear the scenario before testing a
different offset, and validate the token with the application's intended clock tolerance.

<a id="m6-group-overage-graph-fallback-recipe"></a>

## Exercise group overage and Graph fallback

Create an Entra application with group claims enabled and one User in exactly 200
Groups. Mint an in-memory token and require all 200 IDs inline with no claim-source
metadata. Add membership in Group 201 and mint again: `groups` must be absent, while
`_claim_names.groups` selects a same-environment `_claim_sources` endpoint ending in
`/graph/v1.0/users/<id>/getMemberObjects`. POST the strict body
`{ "securityEnabledOnly": true }` to that returned endpoint with the synthetic bearer
and require the 201 Group IDs. Never follow a caller-supplied fallback URL.

## Inject deterministic scenarios

Call `set_scenario` with a stable scenario ID and one implemented injection point:

- `oidc.discovery`
- `oidc.jwks`
- `oauth.authorize`
- `oauth.token`
- `oauth.device`
- `oauth.device.activate`
- `oauth.introspect`
- `oauth.revoke`
- `scim.request`
- `scim.patch_parse` (reserved for its typed PATCH-tolerance action)
- `scim.before_commit` (reserved for typed SCIM conflict/race actions)
- `graph.request`
- `okta.api`
- `http.request`
- `*` as a lower-priority catch-all

Choose one action: `delay` (1–30,000 milliseconds), `error` with a supported semantic
error code, or `mutate` with a shallow JSON patch. Use mutation only at
`oidc.discovery`, `oidc.jwks`, `oauth.token`, `oauth.device`, or `oauth.introspect`;
other mutation points fail closed. Use only delay or error actions at `scim.request`,
`graph.request`, and `okta.api`; the Worker renders their protocol-shaped errors. Set
`probability` and, for a bounded case, `remaining`. Preserve the environment seed,
scenario ID, parameters, and evaluation order in the report so the sequence is
reproducible.

Clear one scenario before enabling the next unless interaction between scenarios is
the test subject. Prefer `remaining: 1` for a one-shot failure.

<a id="m6-scim-edge-recipes"></a>

For the M6 SCIM slice, use only these injection-locked recipes:

1. To prove conflict handling, set `injectionPoint: "scim.before_commit"`,
   `action: { "type": "scim_conflict" }`, and `remaining: 1`. Send one create,
   replace, PATCH, or delete request. Require `409` with `scimType: "uniqueness"`,
   then read the resource and prove that requested fields, lifecycle, membership, and
   ETag did not partially change. A deliberate replay occurs after the one-shot action
   is consumed and should follow the normal current-state rules.
2. To reproduce a delete race, create an isolated disposable User or Group first, then
   set `injectionPoint: "scim.before_commit"`,
   `action: { "type": "scim_soft_delete_race" }`, and `remaining: 1`. The losing
   write returns `404`; require the resource to be hidden and only the tombstone-side
   effects to exist. For a User, verify direct memberships were removed and affected
   Group ETags advanced. Concurrent or later replay writes must also return `404`.
   Do not use this action on create: that combination fails with `409` and inserts
   nothing.
3. Keep malformed PATCH strict unless the application explicitly needs a compatibility
   case. At `scim.patch_parse`, select
   `{ "type": "scim_patch_tolerance", "malformedCase": "missing_schemas" }` to
   add only the missing PatchOp schema field, or use `"singleton_operations"` to wrap
   exactly one operation object in an array. Set `remaining: 1`, test the same payload
   without the scenario first and require `400`, then enable the selected case. Do not
   expect one selection to repair the other case, combined defects, unknown fields,
   invalid paths, missing values, or type coercions.

Generic delay/error/mutate actions are invalid at the two reserved internal SCIM
points. The three typed actions are invalid at `scim.request`, `*`, and all non-SCIM
points. Reserved internal evaluation does not execute or consume a `*` catch-all. Treat
schema rejection as a failed test setup rather than weakening the point or switching
to a generic action.

## Diagnose and assert requests

Use `get_request_log` to inspect newest-first inbound or outbound protocol entries. Filter only by
supported fields: source, provider, normalized method, exact path, exact status, limit,
and cursor.

Use `assert_requests` for stable machine assertions. Supply:

- `source` for an exact source match;
- `method`, normalized to uppercase and then matched exactly;
- `path` for the exact public request path;
- `status` for the exact response status;
- `bodyIncludes` or `responseBodyIncludes` for case-sensitive literal substrings of
  the respective stored body;
- `sequence` with two to 100 non-empty step matchers when append order matters; top-
  level matchers apply to every step and unrelated requests may appear between them;
  and
- `count.atLeast`, `count.atMost`, or `count.exactly`.

Ordered matching greedily counts complete, non-overlapping subsequences from oldest to
newest and returns IDs from complete matches only. Do not ask `assert_requests` to
match headers, parsed JSON/JSONPath, regular expressions, or partial-field semantics.
Check the returned `pass`, `matched`, `message`, and request IDs. Treat a failed
assertion as a failed test, not merely a diagnostic note.
