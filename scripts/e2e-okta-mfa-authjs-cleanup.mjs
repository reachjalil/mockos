#!/usr/bin/env node

process.env.MOCKOS_OFFICIAL_CLIENT_LABEL = "Okta Auth JS Classic MFA";
process.env.MOCKOS_OFFICIAL_CLIENT_SCRIPT = "scripts/e2e-okta-mfa-authjs.mjs";
process.env.MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX = "MOCKOS_OKTA_MFA_AUTHJS_E2E";
process.env.MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX =
  "mockos-okta-mfa-authjs-cleanup-probe-";
process.env.MOCKOS_OFFICIAL_CLIENT_CLEANUP_CLAIM = "okta-mfa-authjs-e2e-signal-cleanup";

await import("./e2e-local-official-client-cleanup.mjs");
