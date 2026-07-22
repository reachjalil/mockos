#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_FILE = "docs/conformance/m6-parity-manifest.json";
export const OUTPUT_FILE = "docs/conformance/m6-generated-parity.md";

const REQUIRED_CASE_IDS = new Set([
  "m6-authn-invalid-credentials",
  "m6-authn-locked-out",
  "m6-authn-mfa-required",
  "m6-authn-password-expired",
  "m6-authn-success",
  "m6-scim-conflict-409",
  "m6-scim-race-soft-delete",
  "m6-scim-strict-missing-schemas",
  "m6-scim-strict-singleton-operations",
  "m6-scim-tolerance-case-isolation",
  "m6-scim-tolerance-missing-schemas",
  "m6-scim-tolerance-singleton-operations",
  "m6-scim-tolerance-unknown-field",
  "m6-token-bad-signature",
  "m6-token-clock-skew",
  "m6-token-expired",
  "m6-token-group-overage-graph-fallback",
  "m6-token-not-yet-valid",
  "m6-token-signing-key-rotation",
  "m6-token-wrong-audience",
  "m6-token-wrong-issuer",
]);

const ID_PATTERN = /^m6-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR_PATTERN = /^m6-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEST_FILE_PATTERN = /\.(?:integration\.)?test\.[cm]?[jt]sx?$/;

export class ReferenceValidationError extends Error {
  code = "M6_PARITY_REFERENCE_ERROR";
  exitCode = 2;

  constructor(failures) {
    super(`M6 parity reference validation failed:\n${failures.join("\n")}`);
    this.name = "ReferenceValidationError";
  }
}

export class OutputDriftError extends Error {
  code = "M6_PARITY_DRIFT";
  exitCode = 3;

  constructor(detail) {
    super(
      `M6 generated parity output is stale: ${detail}\n` +
        "Run `pnpm m6:parity:generate` and commit the result."
    );
    this.name = "OutputDriftError";
  }
}

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const repositoryPath = (value, label, failures, root) => {
  if (!nonEmptyString(value)) {
    failures.push(`${label} must be a non-empty repository-relative path.`);
    return undefined;
  }
  if (
    isAbsolute(value) ||
    value.includes("\\") ||
    posix.normalize(value) !== value ||
    value === ".." ||
    value.startsWith("../")
  ) {
    failures.push(`${label} must be a normalized repository-relative POSIX path.`);
    return undefined;
  }
  const absolute = resolve(root, value);
  const fromRoot = relative(root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    failures.push(`${label} escapes the repository root.`);
    return undefined;
  }
  return absolute;
};

const readCached = async (cache, absolute, label, failures) => {
  if (cache.has(absolute)) return cache.get(absolute);
  try {
    const contents = await readFile(absolute, "utf8");
    cache.set(absolute, contents);
    return contents;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push(`${label} is missing or unreadable: ${reason}`);
    return undefined;
  }
};

const validateFixture = async (row, index, root, cache, failures) => {
  const label = `rows[${index}].fixture`;
  if (!isRecord(row.fixture)) {
    failures.push(`${label} must be an object.`);
    return;
  }
  if (!nonEmptyString(row.fixture.name)) {
    failures.push(`${label}.name must be a non-empty string.`);
  }
  const absolute = repositoryPath(row.fixture.file, `${label}.file`, failures, root);
  if (!absolute) return;
  const contents = await readCached(cache, absolute, `${label}.file`, failures);
  if (contents === undefined) return;
  try {
    const fixture = JSON.parse(contents);
    if (!isRecord(fixture)) {
      failures.push(`${label}.file must contain a JSON object.`);
      return;
    }
    if (fixture.name !== row.fixture.name) {
      failures.push(
        `${label}.name does not match the referenced fixture's top-level name.`
      );
    }
    if (fixture.provider !== row.provider) {
      failures.push(`${label}.file provider does not match rows[${index}].provider.`);
    }
    if (fixture.status !== "implemented") {
      failures.push(`${label}.file must have top-level status "implemented".`);
    }
    if (!isRecord(fixture.request) || !isRecord(fixture.expected)) {
      failures.push(`${label}.file must have top-level request and expected objects.`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push(`${label}.file is not valid JSON: ${reason}`);
  }
};

const validateIntegrationTest = async (row, index, root, cache, failures) => {
  const label = `rows[${index}].integrationTest`;
  if (!isRecord(row.integrationTest)) {
    failures.push(`${label} must be an object.`);
    return;
  }
  if (!nonEmptyString(row.integrationTest.case)) {
    failures.push(`${label}.case must be a non-empty test title.`);
  }
  if (
    nonEmptyString(row.integrationTest.file) &&
    !TEST_FILE_PATTERN.test(row.integrationTest.file)
  ) {
    failures.push(`${label}.file must reference an executable test file.`);
  }
  const absolute = repositoryPath(
    row.integrationTest.file,
    `${label}.file`,
    failures,
    root
  );
  if (!absolute) return;
  const contents = await readCached(cache, absolute, `${label}.file`, failures);
  if (
    contents !== undefined &&
    nonEmptyString(row.integrationTest.case) &&
    !contents.includes(JSON.stringify(row.integrationTest.case))
  ) {
    failures.push(`${label}.case is not an exact string literal in the test file.`);
  }
};

const validateRecipe = async (row, index, root, cache, failures) => {
  const label = `rows[${index}].recipe`;
  if (!isRecord(row.recipe)) {
    failures.push(`${label} must be an object.`);
    return;
  }
  if (!nonEmptyString(row.recipe.label)) {
    failures.push(`${label}.label must be a non-empty string.`);
  }
  if (!nonEmptyString(row.recipe.anchor) || !ANCHOR_PATTERN.test(row.recipe.anchor)) {
    failures.push(`${label}.anchor must be a stable m6-* anchor.`);
  }
  const absolute = repositoryPath(row.recipe.file, `${label}.file`, failures, root);
  if (!absolute) return;
  const contents = await readCached(cache, absolute, `${label}.file`, failures);
  if (
    contents !== undefined &&
    nonEmptyString(row.recipe.anchor) &&
    !contents.includes(`<a id="${row.recipe.anchor}"></a>`)
  ) {
    failures.push(`${label}.anchor is missing from the referenced Markdown file.`);
  }
};

export const validateManifest = async (
  manifest,
  root,
  { requiredCaseIds = REQUIRED_CASE_IDS } = {}
) => {
  const failures = [];
  if (!isRecord(manifest)) {
    throw new ReferenceValidationError(["Manifest root must be an object."]);
  }
  if (manifest.schemaVersion !== 1) {
    failures.push("schemaVersion must equal 1.");
  }
  for (const field of ["title", "status", "lastReviewed"]) {
    if (!nonEmptyString(manifest[field])) {
      failures.push(`${field} must be a non-empty string.`);
    }
  }
  if (
    nonEmptyString(manifest.lastReviewed) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.lastReviewed)
  ) {
    failures.push("lastReviewed must use YYYY-MM-DD.");
  }
  if (!Array.isArray(manifest.rows)) {
    throw new ReferenceValidationError([...failures, "rows must be an array."]);
  }

  const ids = new Set();
  const fixtureFiles = new Set();
  const cache = new Map();
  for (const [index, row] of manifest.rows.entries()) {
    if (!isRecord(row)) {
      failures.push(`rows[${index}] must be an object.`);
      continue;
    }
    if (!nonEmptyString(row.id) || !ID_PATTERN.test(row.id)) {
      failures.push(`rows[${index}].id must be a stable m6-* identifier.`);
    } else if (ids.has(row.id)) {
      failures.push(`rows[${index}].id duplicates ${row.id}.`);
    } else {
      ids.add(row.id);
    }
    for (const field of ["area", "capability"]) {
      if (!nonEmptyString(row[field])) {
        failures.push(`rows[${index}].${field} must be a non-empty string.`);
      }
    }
    if (row.provider !== "entra" && row.provider !== "okta") {
      failures.push(`rows[${index}].provider must be entra or okta.`);
    }
    if (isRecord(row.fixture) && nonEmptyString(row.fixture.file)) {
      if (fixtureFiles.has(row.fixture.file)) {
        failures.push(`rows[${index}].fixture.file duplicates ${row.fixture.file}.`);
      }
      fixtureFiles.add(row.fixture.file);
    }
    await Promise.all([
      validateFixture(row, index, root, cache, failures),
      validateIntegrationTest(row, index, root, cache, failures),
      validateRecipe(row, index, root, cache, failures),
    ]);
  }

  for (const requiredId of requiredCaseIds) {
    if (!ids.has(requiredId)) failures.push(`Required case ${requiredId} is missing.`);
  }
  if (failures.length > 0) throw new ReferenceValidationError(failures);
  return manifest;
};

export const loadAndValidateManifest = async (root) => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(root, MANIFEST_FILE), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReferenceValidationError([
      `${MANIFEST_FILE} is missing or invalid JSON: ${reason}`,
    ]);
  }
  return validateManifest(manifest, root);
};

const escapeCell = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

const linkFromOutput = (target) => posix.relative(posix.dirname(OUTPUT_FILE), target);

export const renderParityMarkdown = (manifest) => {
  const rows = [...manifest.rows].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const manifestLink = posix.basename(MANIFEST_FILE);
  const lines = [
    `# ${manifest.title}`,
    "",
    `Status: ${manifest.status}`,
    `Last reviewed: ${manifest.lastReviewed}`,
    "",
    "<!-- Generated by scripts/generate-m6-parity.mjs. Do not edit by hand. -->",
    "",
    `This matrix is generated from [the machine-readable manifest](${manifestLink}).`,
    "The gate validates every fixture, exact test title, and explicit recipe anchor before",
    "checking output drift. It records case-level source evidence; the separate sampled workers.dev",
    "acceptance does not promote every case to corpus-wide deployed or live-provider parity.",
    "",
    `Required executable cases: **${rows.length}**.`,
    "",
    "| Stable ID | Area | Provider | Capability | Fixture | Executable test | Anchored recipe |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const fixtureLink = linkFromOutput(row.fixture.file);
    const testLink = linkFromOutput(row.integrationTest.file);
    const recipeLink = `${linkFromOutput(row.recipe.file)}#${row.recipe.anchor}`;
    lines.push(
      `| \`${escapeCell(row.id)}\` | ${escapeCell(row.area)} | \`${escapeCell(
        row.provider
      )}\` | ${escapeCell(row.capability)} | [${escapeCell(
        row.fixture.name
      )}](${fixtureLink}) | [${escapeCell(row.integrationTest.case)}](${testLink}) | [${escapeCell(
        row.recipe.label
      )}](${recipeLink}) |`
    );
  }
  return `${lines.join("\n")}\n`;
};

export const checkGeneratedOutput = async (expected, outputPath) => {
  let actual;
  try {
    actual = await readFile(outputPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OutputDriftError(`output is missing or unreadable (${reason}).`);
  }
  if (actual !== expected)
    throw new OutputDriftError("content differs from the manifest.");
};

export const run = async ({ check, root }) => {
  const manifest = await loadAndValidateManifest(root);
  const rendered = renderParityMarkdown(manifest);
  const outputPath = resolve(root, OUTPUT_FILE);
  if (check) {
    await checkGeneratedOutput(rendered, outputPath);
    process.stdout.write(
      `PASS  ${OUTPUT_FILE} matches ${MANIFEST_FILE} and all references resolve\n`
    );
    return;
  }
  await writeFile(outputPath, rendered);
  process.stdout.write(`WROTE ${OUTPUT_FILE}\n`);
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    process.stderr.write("Usage: node scripts/generate-m6-parity.mjs [--check]\n");
    process.exitCode = 64;
    return;
  }
  try {
    await run({
      check: args[0] === "--check",
      root: resolve(import.meta.dirname, ".."),
    });
  } catch (error) {
    if (
      error instanceof ReferenceValidationError ||
      error instanceof OutputDriftError
    ) {
      process.stderr.write(`[${error.code}] ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
