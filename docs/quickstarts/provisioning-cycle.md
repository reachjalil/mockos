# Run a provisioning cycle

Status: M5 accepted workflow recipe; verify the connected server advertises the tool
Last reviewed: 2026-07-22

This loop seeds a synthetic directory, runs the deterministic Entra- or Okta-shaped
outbound SCIM planner, and proves the order and body shapes that the application under
test received. It uses only synthetic identities and a synthetic SCIM credential.

## Prerequisites

Build the unpublished CLI from this checkout and verify the server capability before
creating anything:

```bash
pnpm --filter @mockos/cli build
node packages/cli/dist/bin.js doctor --profile local
node packages/cli/dist/bin.js mcp tools --profile local --json
```

Stop if `run_provisioning_cycle`, `get_request_log`, and `assert_requests` are not
advertised. A historical M3 deployment does not become M5-capable merely because the
local CLI contains the command.

The target must be a disposable SCIM receiver reachable from the Worker at a policy-
accepted URL. HTTPS is required by default. The example in
[`examples/target-app`](../../examples/target-app/README.md) provides the receiving
surface and deterministic inspection endpoints. Its direct
`http://127.0.0.1:8792` address is intentionally rejected by the outbound SSRF guard;
use the repository e2e harness or place it behind an operator-controlled HTTPS test
origin. Do not weaken the literal-private-address rule to make a local demo pass.

For source qualification, run the repeatable two-Worker gate from the repository root:

```bash
pnpm e2e:provisioning
```

The gate starts the mockOS and target-app Workers as independent `wrangler dev`
processes, connects them through a local service binding while retaining a policy-safe
synthetic HTTPS target URL, and drives the complete flow through the built CLI and
authenticated MCP. It creates, seeds, provisions, asserts the four-request User-then-
Group sequence, validates target state and credential redaction, and cleans up both
Workers' test state. CI run `29957994237` passed the same command for exact public
revision `ac8d6d1b29003b7e9a9087d33c3dc2c4c3d55a93`. Separate manual hosted
staging/production acceptance is recorded in the
[M5 deployment evidence](../evidence/m5-workers-dev-smoke.md).

## Create the source environment

Create an environment, retain its returned `id`, and seed at least one User and Group.
The Group member is the seeded `userName`:

```json
{
  "users": [
    {
      "userName": "ada@example.test",
      "displayName": "Ada Lovelace",
      "givenName": "Ada",
      "familyName": "Lovelace",
      "password": "synthetic-password-only",
      "active": true
    }
  ],
  "groups": [
    {
      "displayName": "Engineering",
      "members": ["ada@example.test"]
    }
  ]
}
```

```bash
node packages/cli/dist/bin.js env create \
  --profile local \
  --name provisioning-demo \
  --provider entra \
  --seed provisioning-demo-1 \
  --json

node packages/cli/dist/bin.js seed \
  --profile local \
  --env env_12345678 \
  --file identities.json \
  --json
```

Create an application registration and retain its returned application `id` (not only
its OAuth `clientId`):

```json
{
  "name": "provisioning-target",
  "redirectUris": ["https://app.example.test/callback"],
  "grantTypes": ["authorization_code"]
}
```

```bash
node packages/cli/dist/bin.js app create \
  --profile local \
  --env env_12345678 \
  --file application.json \
  --json
```

## Start the cycle without exposing the target credential

Write the synthetic SCIM token to a mode-restricted file or pipe it on standard input.
The CLI deliberately has no target-token command-line option, so the value does not
enter shell history or the process argument list:

```bash
umask 077
printf '%s' "$TARGET_SCIM_TOKEN" > target-token.txt

node packages/cli/dist/bin.js provision run \
  --profile local \
  --env env_12345678 \
  --app-id app_12345678 \
  --mode full \
  --target-ref target-app \
  --target-url https://target-app.example.net/scim/v2 \
  --target-token-file target-token.txt \
  --save-target \
  --json
```

The token must be distinct from the exact Access Key in the active CLI profile or
`MOCKOS_API_KEY`, regardless of prefix. The CLI compares those values before calling
MCP, and the Worker/Durable Object repeat the defense. If a later `API_KEY` rotation
collides with a saved target token, the run fails closed before an outbound request.

`--save-target` stores safe target metadata plus the synthetic credential inside this
environment's Durable Object for later cycles. Omit it for a run-scoped target. After a
saved target exists, start another cycle without resending the URL or token:

```bash
node packages/cli/dist/bin.js provision run \
  --profile local \
  --env env_12345678 \
  --app-id app_12345678 \
  --mode incremental \
  --target-ref target-app \
  --json
```

The command returns the queued run record. Workflow execution is asynchronous. Poll the
outbound request log, with a bounded timeout in automation, until the expected terminal
operation appears; do not assume that command return means the target has already been
updated.

For a deployed acceptance run, inspect the Workflow instance as a second terminal
check. Platform status `complete` is necessary but not sufficient: the Workflow can
complete at the platform layer while returning a failed or partial application run.
Require the Workflow output to contain the exact queued run ID with `status:
"succeeded"`, and reject rollback-failure metadata if present.

Retain the returned run ID. An exact same-input retry can recover an ambiguous start
only while that run is still active. M5 does not accept a caller idempotency key and
does not replay terminal start responses; retrying after the original run is terminal
starts a new cycle and may repeat writes or consume another hosted quota unit. Resolve
an ambiguous terminal outcome from the request log and controlled-target state instead
of blindly retrying.

## Assert order and shapes

The first full cycle performs User lookups and writes before Group lookups and writes.
Save this as `provisioning-assertion.json`:

```json
{
  "source": "outbound",
  "sequence": [
    {
      "method": "GET",
      "path": "/scim/v2/Users",
      "status": 200,
      "responseBodyIncludes": "totalResults"
    },
    {
      "method": "POST",
      "path": "/scim/v2/Users",
      "status": 201,
      "bodyIncludes": "ada@example.test",
      "responseBodyIncludes": "\"id\""
    },
    {
      "method": "GET",
      "path": "/scim/v2/Groups",
      "status": 200
    },
    {
      "method": "POST",
      "path": "/scim/v2/Groups",
      "status": 201,
      "bodyIncludes": "Engineering"
    }
  ],
  "count": { "exactly": 1 }
}
```

```bash
node packages/cli/dist/bin.js logs dump \
  --profile local \
  --env env_12345678 \
  --source outbound \
  --out provisioning-requests.jsonl

node packages/cli/dist/bin.js assert \
  --profile local \
  --env env_12345678 \
  --spec provisioning-assertion.json \
  --junit provisioning-results.xml \
  --json
```

The sequence matcher finds complete, non-overlapping subsequences in append order;
unrelated requests may appear between steps. Top-level filters apply to every step.
`bodyIncludes` and `responseBodyIncludes` are case-sensitive literal substrings, not
JSONPath or regular expressions.

Inspect the target's protected `/__test/state` and `/__test/requests` endpoints when
using the example app. Its capture redacts the Bearer value. On completion, delete the
environment in a `finally` block and remove the local token and evidence files. Treat a
failed assertion, Workflow failure, or cleanup failure as a failed test rather than a
diagnostic warning.
