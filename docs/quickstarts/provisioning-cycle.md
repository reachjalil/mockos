# Run a provisioning cycle

Status: M5 target quickstart; unavailable in the deployed M2 release
Last reviewed: 2026-07-22

The intended loop is: configure a safe test SCIM target, seed identities, request a
plan, run one deterministic cycle, then inspect outbound request logs and assertions.
Users must be created before groups; every network response is recorded as an outcome.

No provisioning workflow, target-save API, MCP tool, or outbound fetch is implemented
at M2. The live workers.dev deployment proven by the
[M2 smoke](../evidence/m2-workers-dev-smoke.md) covers identity protocols, scenario
injection, request logs, and assertions—not outbound provisioning. Do not invent
commands or supply a target URL yet. Review
[outbound security](../security/outbound-provisioning.md) before enabling this feature
in a later milestone.
