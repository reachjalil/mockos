#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd(), "docs");

const markdownFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
};

const failures = [];
for (const file of await markdownFiles(root)) {
  const contents = await readFile(file, "utf8");
  const header = contents.split("\n").slice(0, 8).join("\n");
  if (!/^Status:\s+\S+/m.test(header)) {
    failures.push(`${relative(process.cwd(), file)} is missing a Status header`);
  }
  if (!/^Last reviewed:\s+\d{4}-\d{2}-\d{2}\s*$/m.test(header)) {
    failures.push(
      `${relative(process.cwd(), file)} is missing a YYYY-MM-DD Last reviewed header`
    );
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation metadata check failed:\n${failures.join("\n")}`);
}

process.stdout.write("PASS  documentation Status and Last reviewed headers\n");
