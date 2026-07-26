---
"@mockos/contracts": patch
"@mockos/mcp": patch
---

Align `delete_environment` discovery with its retry-safe behavior, and document
that a retry after cursor-targeted deletion must pass the deleted Environment ID
explicitly because successful deletion clears the session cursor.
