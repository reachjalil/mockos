# Run a provisioning cycle

Status: M5 target quickstart; unavailable in M0/M1  
Last reviewed: 2026-07-22

The intended loop is: configure a safe test SCIM target, seed identities, request a
plan, run one deterministic cycle, then inspect outbound request logs and assertions.
Users must be created before groups; every network response is recorded as an outcome.

No provisioning workflow, target-save API, MCP tool, or outbound fetch is implemented
at this milestone. Do not invent commands or supply a target URL yet. Review
[outbound security](../security/outbound-provisioning.md) before enabling this feature
in a later milestone.

