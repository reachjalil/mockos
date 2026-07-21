#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), "apps/worker/wrangler.jsonc");
const allowWorkersDev = process.argv.includes("--allow-workers-dev");

const withoutJsonComments = (source) => {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
      continue;
    }
    output += character;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
};

const config = JSON.parse(withoutJsonComments(readFileSync(configPath, "utf8")));

const fail = (message) => {
  throw new Error(`Worker Wrangler configuration: ${message}`);
};

const requireValue = (condition, message) => {
  if (!condition) fail(message);
};

const readTarget = (label, target) => {
  requireValue(target && typeof target === "object", `${label} is missing.`);
  requireValue(
    typeof target.name === "string" && target.name,
    `${label} name is missing.`
  );
  requireValue(
    target.compatibility_date === "2026-07-21",
    `${label} compatibility_date must stay pinned to 2026-07-21.`
  );
  requireValue(
    target.compatibility_flags?.includes("nodejs_compat"),
    `${label} must enable nodejs_compat.`
  );
  requireValue(
    target.observability?.enabled === true,
    `${label} must enable observability.`
  );
  requireValue(
    ["path", "subdomain"].includes(target.vars?.HOSTING_MODE),
    `${label} HOSTING_MODE must be path or subdomain.`
  );
  requireValue(
    target.secrets?.required?.includes("API_KEY"),
    `${label} must declare API_KEY as a required secret.`
  );
  const environmentDo = target.durable_objects?.bindings?.find(
    (binding) => binding.name === "ENVIRONMENTS"
  );
  requireValue(
    environmentDo?.class_name === "EnvironmentDurableObject",
    `${label} ENVIRONMENTS Durable Object binding is missing.`
  );

  if (target.workers_dev === true) {
    requireValue(
      allowWorkersDev,
      `${label} enables workers.dev; pass --allow-workers-dev only during the pre-zone phase.`
    );
    requireValue(
      target.vars.HOSTING_MODE === "path",
      `${label} workers.dev target must use path hosting.`
    );
  } else {
    requireValue(
      target.workers_dev === false,
      `${label} must set workers_dev explicitly.`
    );
    requireValue(
      Array.isArray(target.routes) && target.routes.length > 0,
      `${label} must declare account-owned routes when workers.dev is disabled.`
    );
  }

  return { environmentDo, name: target.name, workersDev: target.workers_dev };
};

const production = readTarget("production", config);
const stagingConfig = config.env?.staging;
const staging = readTarget("staging", { ...config, ...stagingConfig });

requireValue(
  production.name !== staging.name,
  "production and staging must use different Worker names."
);
requireValue(
  config.migrations?.some((migration) =>
    migration.new_sqlite_classes?.includes("EnvironmentDurableObject")
  ),
  "EnvironmentDurableObject must have a new_sqlite_classes migration."
);

process.stdout.write(
  `PASS  isolated Worker targets: ${production.name} and ${staging.name}` +
    `${allowWorkersDev ? " (workers.dev phase allowed)" : ""}\n`
);
