# mockOS testing skill

Status: M5 source-paired workflow plus bounded M6 Classic Authn source guidance
Last reviewed: 2026-07-22

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to inventory an application's identity configuration, capability-
negotiate the authenticated MCP server, create an isolated Entra ID or Okta
environment, seed synthetic identities, register a client, and wire request-derived
provider metadata.

The tested M5 workflow covers:

- authorization code with required S256 PKCE for Entra ID or Okta;
- rotating refresh grants with scope narrowing, replay cautions, and provider-correct
  lifecycle revocation failures;
- Okta device authorization, activation, introspection, and revocation within the
  implemented authorization-server boundary;
- SCIM discovery and versioned synthetic User/Group CRUD/PATCH with weak ETags;
- bounded Entra Graph reads and Okta Users/Groups/lifecycle API checks using separate
  test-only credential schemes;
- bounded Okta Classic primary authentication with password-before-state privacy,
  deterministic initial states, transaction cancellation/replay checks, and Authn log
  redaction;
- the 15-tool MCP registry, including `simulate_lifecycle` and
  `run_provisioning_cycle`;
- deterministic Entra- and Okta-shaped outbound SCIM planning through a durable
  Workflow, with User-before-Group execution, explicit 429 waits/retries, saved or run-
  scoped targets, and the disposable target application;
- `mint_token` negative cases for expired, wrong-audience, not-yet-valid,
  bad-signature, and wrong-issuer tokens;
- deterministic delay, semantic-error, and restricted JSON-mutation scenarios,
  including `scim.request`, `graph.request`, and `okta.api` error/delay routing;
- the M6 SCIM source slice's injection-locked conflict, soft-delete race, and two
  explicit malformed-PATCH tolerance recipes, with strict parsing as the default; and
- filtered request logs plus literal request/response-body matchers and complete non-
  overlapping ordered-sequence assertions before cleanup.

The skill treats capability discovery as connected-server evidence, not proof that
local source is deployed. A provisioning call returns a queued run; the skill polls
bounded outbound evidence and checks target state before reporting success. It never
places target credentials in command arguments, never reuses a platform `mk_` Access
Key or the exact active non-prefixed self-host Access Key as a mock SCIM credential,
and requires target Bearer redaction in captured evidence. A key-rotation collision
with a saved target must fail before outbound execution.

All management calls require the fail-closed `API_KEY`; the skill never asks an agent
to print it. It keeps the management key out of SCIM/Graph/Okta and outbound target
calls, records explicit environment IDs for automation, clears scenarios, deletes
environments in a `finally`-style cleanup, and closes the MCP client so its server
session is terminated. Every identity, password, application secret, directory
Bearer/SSWS value, target credential, and provider token used as test data must be
synthetic.

The rest of the Okta Classic Authn transaction machine, broad Graph/Okta API parity,
SAML, unrecorded hosted qualification, and npm publication remain outside the
workflow. Use only immutable CI/deployment records linked by the implementation
ledger, and never present mockOS source or deployment evidence as live-provider
parity.
