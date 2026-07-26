# `@mockos/codemode`

The mockOS-owned boundary around Cloudflare's experimental Code Mode package.

Code Mode is disabled by default. Importing the package root does not import the
Cloudflare implementation. A caller must import `@mockos/codemode/cloudflare` and
pass `enabled: true` explicitly before the upstream factory can run.

F0 does not wire this wrapper into the Worker and does not add a Worker Loader
binding. Activation remains gated on the F3 sandbox spike and F6 authorization,
audit, quota, and cost evidence.

The workspace package remains private while that qualification is open.
