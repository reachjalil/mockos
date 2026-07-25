#!/usr/bin/env node

process.env.MOCKOS_OFFICIAL_CLIENT_LABEL = "Okta Auth JS";
process.env.MOCKOS_OFFICIAL_CLIENT_SCRIPT = "scripts/e2e-okta-authjs.mjs";
process.env.MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX = "MOCKOS_OKTA_AUTHJS_E2E";
process.env.MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX = "mockos-okta-authjs-cleanup-probe-";
process.env.MOCKOS_OFFICIAL_CLIENT_CLEANUP_CLAIM = "okta-authjs-e2e-signal-cleanup";

await import("./e2e-local-official-client-cleanup.mjs");
