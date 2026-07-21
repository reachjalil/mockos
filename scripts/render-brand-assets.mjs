#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const manifestPath = resolve(root, "assets/brand/manifest.json");
const assets = [
  {
    source: "assets/brand/mockos-mark.svg",
    output: "assets/brand/mockos-mark-512.png",
    width: 512,
    height: 512,
  },
  {
    source: "assets/brand/mockos-mark.svg",
    output: "assets/brand/mockos-mark-1024.png",
    width: 1024,
    height: 1024,
  },
  {
    source: "assets/brand/mockos-social-card.svg",
    output: "assets/brand/mockos-social-card.png",
    width: 1280,
    height: 640,
  },
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = check
  ? JSON.parse(await readFile(manifestPath, "utf8"))
  : { version: 1, renderer: `sharp@${sharp.versions.sharp}`, assets: [] };
const stale = [];
for (const asset of assets) {
  const source = resolve(root, asset.source);
  const output = resolve(root, asset.output);
  const sourceBytes = await readFile(source);
  let outputBytes;

  if (!check) {
    outputBytes = await sharp(sourceBytes)
      .resize(asset.width, asset.height)
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(output, outputBytes);
    process.stdout.write(`WROTE ${asset.output}\n`);
  } else {
    outputBytes = await readFile(output).catch(() => undefined);
  }

  if (!outputBytes) {
    stale.push(asset.output);
    continue;
  }

  const metadata = await sharp(outputBytes).metadata();
  const entry = {
    source: asset.source,
    output: asset.output,
    width: asset.width,
    height: asset.height,
    sourceSha256: sha256(sourceBytes),
    outputSha256: sha256(outputBytes),
  };

  if (!check) {
    manifest.assets.push(entry);
    continue;
  }

  const expected = manifest.assets?.find(
    (candidate) => candidate.output === asset.output
  );
  if (
    JSON.stringify(expected) !== JSON.stringify(entry) ||
    metadata.format !== "png" ||
    metadata.width !== asset.width ||
    metadata.height !== asset.height
  ) {
    stale.push(asset.output);
  }
}

if (stale.length > 0) {
  throw new Error(
    `Brand raster assets are stale. Run pnpm brand:render:\n${stale.join("\n")}`
  );
}

if (check) {
  process.stdout.write("PASS  brand sources, manifest, and raster dimensions agree\n");
} else {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write("WROTE assets/brand/manifest.json\n");
}
