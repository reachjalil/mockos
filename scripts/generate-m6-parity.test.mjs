import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import {
  checkGeneratedOutput,
  OutputDriftError,
  ReferenceValidationError,
  renderParityMarkdown,
  validateManifest,
} from "./generate-m6-parity.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "mockos-m6-parity-"));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(resolve(root, "fixtures"), { recursive: true }),
    mkdir(resolve(root, "tests"), { recursive: true }),
    mkdir(resolve(root, "skills"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      resolve(root, "fixtures/case.json"),
      `${JSON.stringify({
        name: "fixture-case",
        provider: "entra",
        status: "implemented",
        request: {},
        expected: {},
      })}\n`
    ),
    writeFile(resolve(root, "tests/case.integration.test.ts"), 'it("case title");\n'),
    writeFile(resolve(root, "skills/SKILL.md"), '<a id="m6-case-recipe"></a>\n'),
  ]);
  return root;
};

const manifest = (fixtureFile = "fixtures/case.json") => ({
  schemaVersion: 1,
  title: "M6 test matrix",
  status: "Test-only evidence",
  lastReviewed: "2026-07-22",
  rows: [
    {
      id: "m6-test-case",
      area: "Test",
      provider: "entra",
      capability: "Deterministic test case",
      fixture: { file: fixtureFile, name: "fixture-case" },
      integrationTest: {
        file: "tests/case.integration.test.ts",
        case: "case title",
      },
      recipe: {
        file: "skills/SKILL.md",
        anchor: "m6-case-recipe",
        label: "Test recipe",
      },
    },
  ],
});

test("validates references and renders deterministically", async () => {
  const root = await temporaryRoot();
  const value = await validateManifest(manifest(), root, {
    requiredCaseIds: new Set(["m6-test-case"]),
  });
  const first = renderParityMarkdown(value);
  const second = renderParityMarkdown({ ...value, rows: [...value.rows].reverse() });
  assert.equal(first, second);
  assert.match(first, /m6-test-case/);
});

test("reports a missing reference with the reference error code", async () => {
  const root = await temporaryRoot();
  await assert.rejects(
    validateManifest(manifest("fixtures/missing.json"), root, {
      requiredCaseIds: new Set(["m6-test-case"]),
    }),
    (error) => {
      assert.ok(error instanceof ReferenceValidationError);
      assert.equal(error.code, "M6_PARITY_REFERENCE_ERROR");
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /missing or unreadable/);
      return true;
    }
  );
});

test("reports fixture metadata mismatches as reference errors", async () => {
  const root = await temporaryRoot();
  const mismatched = manifest();
  mismatched.rows[0].provider = "okta";
  await assert.rejects(
    validateManifest(mismatched, root, {
      requiredCaseIds: new Set(["m6-test-case"]),
    }),
    (error) => {
      assert.ok(error instanceof ReferenceValidationError);
      assert.equal(error.code, "M6_PARITY_REFERENCE_ERROR");
      assert.match(error.message, /provider does not match/);
      return true;
    }
  );
});

test("reports generated-output drift with a distinct drift error code", async () => {
  const root = await temporaryRoot();
  const output = resolve(root, "generated.md");
  await writeFile(output, "stale\n");
  await assert.rejects(checkGeneratedOutput("fresh\n", output), (error) => {
    assert.ok(error instanceof OutputDriftError);
    assert.equal(error.code, "M6_PARITY_DRIFT");
    assert.equal(error.exitCode, 3);
    assert.match(error.message, /content differs/);
    return true;
  });
});
