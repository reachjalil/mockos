#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const failures = [];

const workspace = await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8");
const expectedPins = new Map([
  ["@cloudflare/codemode", "0.4.3"],
  ["agents", "0.17.4"],
  ["@modelcontextprotocol/sdk", "1.29.0"],
  ["wrangler", "4.114.0"],
]);

for (const [name, version] of expectedPins) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*(?:["']${escaped}["']|${escaped}):\\s*${version.replaceAll(".", "\\.")}\\s*$`,
    "m"
  );
  if (!pattern.test(workspace)) {
    failures.push(`pnpm-workspace.yaml must pin ${name} exactly to ${version}`);
  }
}

const codemodePackage = JSON.parse(
  await readFile(resolve(root, "packages/codemode/package.json"), "utf8")
);
if (codemodePackage.dependencies?.["@cloudflare/codemode"] !== "catalog:") {
  failures.push(
    "packages/codemode must declare @cloudflare/codemode as a direct catalog dependency"
  );
}

for (const packageName of ["client", "codemode", "sandbox"]) {
  const packageJson = JSON.parse(
    await readFile(resolve(root, `packages/${packageName}/package.json`), "utf8")
  );
  if (packageJson.private !== true) {
    failures.push(
      `packages/${packageName} must remain private until distribution or runtime qualification is recorded`
    );
  }
}

const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8").catch(
  () => ""
);
if (
  !/packages\/codemode:[\s\S]*?'@cloudflare\/codemode':[\s\S]*?version:\s+0\.4\.3\b/.test(
    lockfile
  )
) {
  failures.push(
    "pnpm-lock.yaml must contain the packages/codemode importer resolved to 0.4.3"
  );
}

const runtimeRoots = [
  resolve(root, "apps/worker"),
  resolve(root, "packages/worker-kit"),
];
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  ".turbo",
  ".wrangler",
  "coverage",
]);
const runtimeFiles = [];

const collectFiles = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(path);
    else if (entry.isFile()) runtimeFiles.push(path);
  }
};

for (const directory of runtimeRoots) await collectFiles(directory);
runtimeFiles.push(
  resolve(root, "apps/worker/wrangler.jsonc"),
  resolve(root, "apps/worker/wrangler.e2e.jsonc")
);

const disabledRuntimePatterns = [
  /@mockos\/codemode/,
  /@mockos\/sandbox/,
  /\bworker_loaders\b/,
  /\bCODE_MODE_ENABLED\b/,
  /\bSCRIPT_BEHAVIORS_ENABLED\b/,
  /\bLOADER\b/,
];

for (const file of new Set(runtimeFiles)) {
  const contents = await readFile(file, "utf8");
  for (const pattern of disabledRuntimePatterns) {
    if (pattern.test(contents)) {
      failures.push(
        `${relative(root, file)} activates or imports an F0 experimental runtime (${pattern})`
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`F0 guard check failed:\n${failures.join("\n")}`);
}

process.stdout.write(
  "PASS  F0 exact pins are direct and experimental runtimes remain unwired\n"
);
