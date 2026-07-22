# mockOS testing skill

Status: M2 MCP, Okta, scenario, log, and cleanup guidance implemented
Last reviewed: 2026-07-22

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to inventory an application's identity configuration, create an
isolated Entra ID or Okta environment through the authenticated MCP server, seed
synthetic identities, register a client, and wire request-derived provider metadata.

The M2 workflow covers:

- authorization code with required S256 PKCE for Entra ID or Okta;
- Okta device authorization, activation, introspection, and revocation within the
  implemented authorization-server boundary;
- `mint_token` negative cases for expired, wrong-audience, not-yet-valid,
  bad-signature, and wrong-issuer tokens;
- deterministic delay, semantic-error, and restricted JSON-mutation scenarios; and
- filtered request logs plus exact count assertions before scenario and environment
  cleanup.

The skill deliberately narrows `assert_requests` to the implemented matcher: source,
normalized method, exact path, exact status, a case-sensitive literal request-body
substring, and count bounds. It does not instruct agents to assert headers, ordering,
regexes, or body subsets that the runtime does not support.

All management calls require the fail-closed `API_KEY`; the skill never asks an agent
to print it. It records explicit environment IDs for automation, clears scenarios,
deletes environments in a `finally`-style cleanup, and closes the MCP client so its
server session is terminated.

SCIM, provider directory APIs and lifecycle, Okta Classic Authn, outbound provisioning,
and npm publication remain outside this skill's M2 runtime workflow. The
[M2 workers.dev smoke record](./evidence/m2-workers-dev-smoke.md) proves the deployed
MCP/Entra loop; it does not establish live-provider parity.
