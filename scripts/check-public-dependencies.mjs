#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const ignored = new Set([
  ".git",
  ".turbo",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);
const privatePackagePattern = /@mockos(?:-|)cloud\//;

const sourceFiles = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:c|m)?(?:j|t)sx?$|\.json$/.test(entry.name)) files.push(path);
  }
  return files;
};

const violations = [];
for (const file of await sourceFiles(root)) {
  const contents = await readFile(file, "utf8");
  if (privatePackagePattern.test(contents)) {
    violations.push(relative(root, file));
  }
}

if (violations.length > 0) {
  throw new Error(
    `Public packages must not depend on private mockOS Cloud code:\n${violations.join("\n")}`
  );
}

process.stdout.write("PASS  public-to-private dependency direction\n");
