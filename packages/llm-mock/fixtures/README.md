# Provider wire fixtures

These fixtures freeze the deterministic projection of one neutral
`MockLlmPlan` into the initial F2 provider dialects. They are shape references,
not captured production traffic, and contain no credentials.

The OpenAI fixtures cover a Chat Completions response, immediate SSE chunks,
text, one function tool call, canonical JSON arguments, the requested usage
chunk, and `[DONE]`. The Anthropic fixtures cover a Messages response, named SSE
events, text, one direct `tool_use`, canonical `input_json_delta` data, current
nullable usage fields, and terminal message events. Cadence delays are preserved
in the neutral plan; these pure fixtures do not sleep.

Sources frozen on 2026-07-25:

- [OpenAI Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI Node SDK 6.49.0](https://www.npmjs.com/package/openai/v/6.49.0)
- [Anthropic Messages API reference](https://platform.claude.com/docs/en/api/typescript/messages/create)
- [Anthropic streaming Messages reference](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic TypeScript SDK 0.115.0](https://www.npmjs.com/package/@anthropic-ai/sdk/v/0.115.0)

Request parsing, provider authentication, model discovery, HTTP routing, timed
delivery, persistence, conversations, and hosted qualification are deliberately
outside these renderer fixtures.
