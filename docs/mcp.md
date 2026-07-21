# MCP interface

Status: M2 target; no mounted remote MCP service is claimed  
Last reviewed: 2026-07-22

The target tool registry covers environment lifecycle, configuration, identity seeds,
application registration, token minting, scenario control, provisioning cycles,
request logs, request assertions, lifecycle simulation, well-known URLs, and a
session-scoped current-environment cursor.

Hosted access will require account API keys. Self-hosting will require a constant-time
comparison against an `API_KEY` secret unless the operator explicitly enables public
mode. The Cloudflare composition target is an Agents SDK `McpAgent` with hibernation;
a handler-agnostic registry keeps other transports possible.

Package or type scaffolding is not an interoperable MCP service. M2 acceptance requires
initialize, tools/list, authenticated tools/call, fixture behavior, and cleanup in a
deployed workers.dev smoke.

