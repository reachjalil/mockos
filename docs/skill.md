# mockOS testing skill

Status: M1 local Entra guidance; later MCP and scenario steps are milestone-gated  
Last reviewed: 2026-07-22

The repository skill at [skills/mockos-testing](../skills/mockos-testing/SKILL.md)
teaches an agent to inventory the application, create an isolated mock environment,
wire explicit provider metadata, exercise a small behavior matrix, and assert requests.

At M1 the skill can guide the implemented local Entra authorization-code slice. It must
stop before calling absent MCP tools or claiming a scenario passed. Environment lifecycle,
scenarios, logs, and provisioning require the later MCP milestones.

The skill treats environment IDs, mock credentials, and test tokens as sensitive test
data and never substitutes production credentials.
