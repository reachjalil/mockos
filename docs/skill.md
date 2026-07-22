# mockOS testing skill

Status: M3 source-candidate MCP, directory, lifecycle, refresh, scenario, log, and cleanup guidance
Last reviewed: 2026-07-22

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to inventory an application's identity configuration, create an
isolated Entra ID or Okta environment through the authenticated MCP server, seed
synthetic identities, register a client, and wire request-derived provider metadata.

The M3 source-candidate workflow covers:

- authorization code with required S256 PKCE for Entra ID or Okta;
- rotating refresh grants with scope narrowing, replay cautions, and provider-correct
  lifecycle revocation failures;
- Okta device authorization, activation, introspection, and revocation within the
  implemented authorization-server boundary;
- SCIM discovery and versioned synthetic User/Group CRUD/PATCH with weak ETags;
- bounded Entra Graph reads and Okta Users/Groups/lifecycle API checks using separate
  test-only credential schemes;
- the 14-tool MCP registry and CLI-compatible `simulate_lifecycle` result;
- `mint_token` negative cases for expired, wrong-audience, not-yet-valid,
  bad-signature, and wrong-issuer tokens;
- deterministic delay, semantic-error, and restricted JSON-mutation scenarios,
  including `scim.request`, `graph.request`, and `okta.api` error/delay routing; and
- filtered request logs plus exact count assertions before scenario and environment
  cleanup.

The skill deliberately narrows `assert_requests` to the implemented matcher: source,
normalized method, exact path, exact status, a case-sensitive literal request-body
substring, and count bounds. It does not instruct agents to assert headers, ordering,
regexes, or body subsets that the runtime does not support.

All management calls require the fail-closed `API_KEY`; the skill never asks an agent
to print it. It capability-negotiates the required MCP tools, keeps the management key
out of SCIM/Graph/Okta protocol calls, records explicit environment IDs for automation,
clears scenarios, deletes environments in a `finally`-style cleanup, and closes the MCP
client so its server session is terminated. Every identity, password, application
secret, directory Bearer/SSWS value, and provider token used as test data must be
synthetic; the operator-provided MCP Access Key remains a confidential management
credential.

Okta Classic Authn, broad Graph/Okta API parity, outbound provisioning, SAML, hosted M3
qualification, and npm publication remain outside the workflow. The
[M2 workers.dev smoke record](./evidence/m2-workers-dev-smoke.md) proves only the
deployed M2 MCP/Entra loop; it does not establish the M3 source candidate or
live-provider parity.
