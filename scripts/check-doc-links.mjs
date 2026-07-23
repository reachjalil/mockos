#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const root = process.cwd();
const docsRoot = resolve(root, "docs");

const markdownFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
};

const exists = async (path) => {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
};

const githubSlug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s+/g, "-");

const anchorsFor = (contents) => {
  const anchors = new Set();
  const counts = new Map();
  let fenced = false;
  for (const line of contents.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = githubSlug(heading[2]);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
};

const destinationFrom = (raw) => {
  const value = raw.trim();
  if (value.startsWith("<")) {
    const close = value.indexOf(">");
    return close === -1 ? value.slice(1) : value.slice(1, close);
  }
  return value.split(/\s+["'(]/, 1)[0];
};

const markdownDestinations = (contents) => {
  const destinations = [];
  for (const match of contents.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
    destinations.push(destinationFrom(match[1]));
  }
  for (const match of contents.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    destinations.push(match[1]);
  }
  return destinations;
};

const rootMarkdown = [];
for (const path of [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "llms.txt",
  "llms-full.txt",
]) {
  const absolute = resolve(root, path);
  if (await exists(absolute)) rootMarkdown.push(absolute);
}
const files = [...rootMarkdown, ...(await markdownFiles(docsRoot))];
const cache = new Map();
const failures = [];

for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const destination of markdownDestinations(contents)) {
    if (
      destination.length === 0 ||
      destination.startsWith("/") ||
      destination.startsWith("//") ||
      /^[a-z][a-z+.-]*:/i.test(destination)
    ) {
      continue;
    }

    const [pathWithQuery, encodedFragment] = destination.split("#", 2);
    const path = pathWithQuery.split("?", 1)[0];
    const target =
      path.length === 0 ? file : resolve(dirname(file), decodeURIComponent(path));
    const targetFromRoot = relative(root, target);
    if (
      targetFromRoot === ".." ||
      targetFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(targetFromRoot)
    ) {
      failures.push(
        `${relative(root, file)} links outside the repository to ${destination}`
      );
      continue;
    }
    const targetStats = await exists(target);
    if (!targetStats) {
      failures.push(
        `${relative(root, file)} links to missing ${relative(root, target)}`
      );
      continue;
    }

    if (
      !encodedFragment ||
      targetStats.isDirectory() ||
      !(target.endsWith(".md") || target.endsWith(".txt"))
    ) {
      continue;
    }
    const fragment = decodeURIComponent(encodedFragment).toLowerCase();
    let targetContents = cache.get(target);
    if (targetContents === undefined) {
      targetContents = await readFile(target, "utf8");
      cache.set(target, targetContents);
    }
    if (!anchorsFor(targetContents).has(fragment)) {
      failures.push(
        `${relative(root, file)} links to missing anchor #${fragment} in ${relative(root, target)}`
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Documentation internal-link check failed:\n${[...new Set(failures)]
      .map((failure) => `- ${failure}`)
      .join("\n")}`
  );
}

process.stdout.write(
  `PASS  ${files.length} documentation files have resolvable internal links and anchors\n`
);
