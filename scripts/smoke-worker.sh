#!/usr/bin/env bash
set -euo pipefail

: "${MOCKOS_SMOKE_ORIGIN:?Set MOCKOS_SMOKE_ORIGIN to the deployed HTTPS origin.}"
: "${MOCKOS_SMOKE_API_KEY:?Set MOCKOS_SMOKE_API_KEY to the deployed self-host API key.}"

case "$MOCKOS_SMOKE_ORIGIN" in
  https://*) ;;
  *) printf 'MOCKOS_SMOKE_ORIGIN must be an HTTPS origin.\n' >&2; exit 1 ;;
esac

test -f packages/cli/dist/index.js || {
  printf 'Build @mockos/cli before running the deployed smoke.\n' >&2
  exit 1
}

node scripts/smoke-worker.mjs
