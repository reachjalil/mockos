---
name: mockos-testing
description: Test an application's enterprise identity integration against mockOS with deterministic Entra ID or Okta OIDC, OAuth, SCIM, RBAC, lifecycle, and injected-failure workflows. Use when wiring an app to mockOS, designing an identity edge-case matrix, exercising login or provisioning, inspecting protocol requests, or asserting provider-shaped behavior; check repository milestone status before invoking runtime-dependent tools.
---

# Test with mockOS

Use synthetic identities and credentials only. Read
`docs/IMPLEMENTATION_STATUS.md` and `docs/known-limitations.md` first when working
from a repository checkout. Treat absent tools or endpoints as unavailable; never infer
support from a fixture or type.

## Build the test plan

1. Inspect the application under test for its issuer or authority, client
   authentication, callback URIs, scopes, claim mapping, SCIM base URL and token, and
   lifecycle behavior.
2. Choose one provider and one happy path first. Record the exact outcome the
   application must accept or reject.
3. Add only relevant edge cases: wrong audience or issuer, expiry, PKCE mismatch, MFA
   requirement, rate limiting, group overage, deprovisioning, SCIM conflict, or
   malformed PATCH.
4. Map each assertion to an observable result in the application and, when available,
   a mockOS request-log assertion.

## Create and wire an environment

When mockOS MCP tools are connected, use this order:

1. Call `create_environment` with provider and deterministic seed.
2. Call `seed_identities` and `create_application` with an exact callback URI.
3. Call `get_wellknown_urls`; configure the application from returned URLs. Never
   construct or persist an issuer from memory.
4. Call `set_current_environment` only as session convenience. Continue passing an
   explicit environment ID in saved scripts and reports.
5. Run discovery before login and verify that every absolute URL uses the active host.

If these tools are absent, read the repository status and concrete quickstart, then use
only an implemented, documented local control API or test harness. If no supported
environment-creation surface exists, report the case as unavailable and stop. Never
invent HTTP control routes.

## Exercise behavior

Run authorization code + S256 PKCE before testing failures. Preserve `state`, verify
`nonce`, redeem each code once, obtain JWKS through discovery, and validate signature,
issuer, audience, timestamps, tenant ID, and provider identity claims.

Use `set_scenario` only when the tool lists the requested scenario as supported. Keep
the environment seed, scenario parameters, clock offset, and application revision in
the test report. Clear one scenario before enabling another unless interaction is the
subject of the test.

For provisioning, run one cycle, then assert user operations precede dependent group
operations and inspect every HTTP response. Do not configure an outbound target until
the product exposes its target validation and the documented SSRF controls.

## Assert and clean up

Use `get_request_log` for diagnosis and `assert_requests` for stable machine
assertions when available. Assert method, normalized path, selected headers, body
subset, order, and count; avoid matching random IDs unless determinism makes them part
of the requirement.

Report each case as passed, failed, or unavailable. “Unavailable” is correct when the
documented behavior belongs to a later milestone.

Clear scenarios and call `delete_environment` after the run. Never print mock API
keys or full tokens. Redact Authorization, cookies, client secrets, and production-like
personal fields from reports.
