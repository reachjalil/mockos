# Changelog

Notable changes to mockOS are recorded here. The project follows
[Semantic Versioning](https://semver.org/) while it moves toward a stable release.

## [Unreleased]

## [0.1.0-rc.1] - 2026-07-26

The first tagged public source preview of mockOS.

### Included

- Deterministic environment setup and lifecycle management through MCP.
- Entra ID-, Okta-, SCIM-, Graph-, OpenAI-, and Anthropic-shaped test surfaces.
- Environment-hosted mock MCP servers for testing tools, resources, templates, and
  prompts.
- Request inspection, assertions, failure scenarios, and isolated synthetic test
  data.
- A source-built CLI and a self-hostable Cloudflare Worker.

### Release boundary

- This is a source prerelease, not a stable npm package release.
- Provider support is intentionally bounded; consult the
  [implementation status](./docs/IMPLEMENTATION_STATUS.md) and
  [known limitations](./docs/known-limitations.md) for exact coverage.
- No production SLA or complete provider parity is claimed.

[Unreleased]: https://github.com/reachjalil/mockos/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/reachjalil/mockos/releases/tag/v0.1.0-rc.1
