#!/usr/bin/env node

const forwardOptional = (target, source) => {
  const value = process.env[source];
  if (value === undefined) delete process.env[target];
  else process.env[target] = value;
};

process.env.MOCKOS_OFFICIAL_CLIENT_LABEL = "Okta Auth JS";
process.env.MOCKOS_OFFICIAL_CLIENT_SCRIPT = "scripts/e2e-okta-authjs-client.mjs";
process.env.MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX = "MOCKOS_OKTA_AUTHJS_E2E";
process.env.MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX = "mockos-okta-authjs-";
process.env.MOCKOS_OFFICIAL_CLIENT_DEFAULT_PORT = "8795";
process.env.MOCKOS_OFFICIAL_CLIENT_DEFAULT_INSPECTOR_PORT = "18795";
forwardOptional(
  "MOCKOS_OFFICIAL_CLIENT_CLEANUP_PROBE",
  "MOCKOS_OKTA_AUTHJS_E2E_CLEANUP_PROBE"
);
forwardOptional(
  "MOCKOS_OFFICIAL_CLIENT_TEMP_PARENT",
  "MOCKOS_OKTA_AUTHJS_E2E_TEMP_PARENT"
);
forwardOptional("MOCKOS_OFFICIAL_CLIENT_PORT", "MOCKOS_OKTA_AUTHJS_E2E_PORT");
forwardOptional(
  "MOCKOS_OFFICIAL_CLIENT_INSPECTOR_PORT",
  "MOCKOS_OKTA_AUTHJS_E2E_INSPECTOR_PORT"
);

await import("./e2e-local-official-client.mjs");
