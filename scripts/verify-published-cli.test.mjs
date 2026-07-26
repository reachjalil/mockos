import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = async (metadata, version = "0.1.0") => {
  const directory = await mkdtemp(join(tmpdir(), "mockos-cli-metadata-"));
  const metadataPath = join(directory, "metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata));
  return spawnSync(
    process.execPath,
    ["scripts/verify-published-cli.mjs", metadataPath, version],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
};

test("accepts the exact published CLI metadata", async () => {
  const result = await run({
    name: "@mockos/cli",
    version: "0.1.0",
    bin: { mockos: "dist/bin.js" },
    engines: { node: ">=22.12.0" },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS {2}@mockos\/cli@0\.1\.0/);
});

test("rejects missing executable metadata", async () => {
  const result = await run({
    name: "@mockos/cli",
    version: "0.1.0",
    engines: { node: ">=22.12.0" },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not expose mockos at dist\/bin\.js/);
});
