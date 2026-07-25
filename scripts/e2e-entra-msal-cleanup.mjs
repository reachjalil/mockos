#!/usr/bin/env node

process.env.MOCKOS_OFFICIAL_CLIENT_LABEL = "MSAL";
process.env.MOCKOS_OFFICIAL_CLIENT_SCRIPT = "scripts/e2e-entra-msal.mjs";
process.env.MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX = "MOCKOS_ENTRA_MSAL_E2E";
process.env.MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX = "mockos-entra-msal-cleanup-probe-";
process.env.MOCKOS_OFFICIAL_CLIENT_CLEANUP_CLAIM = "entra-msal-e2e-signal-cleanup";

await import("./e2e-local-official-client-cleanup.mjs");
