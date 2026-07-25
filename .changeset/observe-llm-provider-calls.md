---
"@mockos/contracts": minor
"@mockos/core": minor
"@mockos/llm-mock": minor
"@mockos/openapi": minor
"@mockos/worker-kit": minor
---

Add metadata-only OpenAI and Anthropic provider observations to the request log,
including exact query and sequence matchers. LLM requests reserve one pending row
within a 50-millisecond fail-open budget and explicit legacy-column sentinels, then
append one immutable terminal overlay carrying the actual delivered status and
monotonic duration. Prospective metadata/credential collisions skip the complete observation;
configured errors omit the preallocated response ID. Prompts, output text, headers,
bodies, credentials, and provider-plan internals are never persisted.
