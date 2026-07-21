#!/usr/bin/env bash
set -euo pipefail

: "${MOCKOS_SMOKE_ORIGIN:?Set MOCKOS_SMOKE_ORIGIN to the deployed HTTPS origin.}"

case "$MOCKOS_SMOKE_ORIGIN" in
  https://*) ;;
  *) printf 'MOCKOS_SMOKE_ORIGIN must be an HTTPS origin.\n' >&2; exit 1 ;;
esac

curl --fail-with-body --silent --show-error \
  --max-time 20 \
  "$MOCKOS_SMOKE_ORIGIN/health" >/dev/null

printf '%s\n' \
  'PASS  public Worker health probe.' \
  'M2 acceptance still requires authenticated MCP environment creation, OIDC discovery/token/JWKS, injected-error observation, and cleanup; this M0/M1 probe does not satisfy that gate.'
