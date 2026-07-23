# `@mockos/client`

Typed, fetch-based access to the management HTTP operations that the public mockOS
Worker currently implements.

The client accepts a Worker management endpoint such as
`https://mockos.example/__mockos/v1` and owns the Access Key header. Callers select a
known operation; they cannot pass an arbitrary origin or authorization header.

This is the F0 client skeleton. It intentionally does not advertise MCP-only
operations as HTTP capabilities, and it does not replace the CLI's proven MCP
transport yet. The workspace package remains private until the contracts dependency
and package artifacts pass the separate distribution qualification.
