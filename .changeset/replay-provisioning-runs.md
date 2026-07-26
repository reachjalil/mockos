---
"@mockos/contracts": minor
"@mockos/worker-kit": minor
"@mockos/mcp": minor
---

Add a caller-owned provisioning idempotency key and derive stable, opaque run
identifiers so an exact retry can return the original terminal run instead of
starting a second outbound cycle.
