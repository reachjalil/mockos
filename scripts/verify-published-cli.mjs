#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const [metadataPath, expectedVersion] = process.argv.slice(2);

if (
  !metadataPath ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion ?? "")
) {
  throw new Error(
    "Usage: verify-published-cli.mjs <npm-metadata.json> <expected-version>"
  );
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const failures = [];

if (metadata.name !== "@mockos/cli") {
  failures.push("npm metadata did not identify @mockos/cli");
}
if (metadata.version !== expectedVersion) {
  failures.push(
    `npm returned version ${String(metadata.version)} instead of ${expectedVersion}`
  );
}
if (metadata.bin?.mockos !== "dist/bin.js") {
  failures.push("the published package does not expose mockos at dist/bin.js");
}
if (metadata.engines?.node !== ">=22.12.0") {
  failures.push("the published package does not retain the Node >=22.12.0 boundary");
}

if (failures.length > 0) {
  throw new Error(`Published CLI verification failed:\n${failures.join("\n")}`);
}

process.stdout.write(
  `PASS  @mockos/cli@${expectedVersion} publishes the expected executable metadata\n`
);
