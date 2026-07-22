import { readFile, writeFile } from "node:fs/promises";

export type CliIo = {
  stdout(value: string): void;
  stderr(value: string): void;
  readStdin(): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, value: string): Promise<void>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
};

export function processIo(): CliIo {
  return {
    stdout(value) {
      process.stdout.write(value);
    },
    stderr(value) {
      process.stderr.write(value);
    },
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    readFile(path) {
      return readFile(path, "utf8");
    },
    async writeFile(path, value) {
      await writeFile(path, value, "utf8");
    },
    now: Date.now,
    sleep(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
  };
}

export async function readJson(
  path: string,
  io: CliIo
): Promise<Record<string, unknown>> {
  const source = path === "-" ? await io.readStdin() : await io.readFile(path);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value as Record<string, unknown>;
}

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function toJsonLines(value: unknown): string {
  const rows = extractRows(value);
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

export function extractRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["entries", "environments", "logs", "requests", "data"]) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [value];
}

export function assertionToJunit(value: unknown): string {
  const assertion = unwrapData(value);
  const passed =
    assertion !== null &&
    typeof assertion === "object" &&
    "pass" in assertion &&
    assertion.pass === true;
  const message =
    assertion !== null &&
    typeof assertion === "object" &&
    "message" in assertion &&
    typeof assertion.message === "string"
      ? assertion.message
      : passed
        ? "mockOS assertion passed"
        : "mockOS assertion failed";
  const failure = passed
    ? ""
    : `<failure message="${escapeXml(message)}">${escapeXml(
        JSON.stringify(assertion)
      )}</failure>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="mockOS assertions" tests="1" failures="${passed ? 0 : 1}">`,
    `  <testcase classname="mockos" name="request assertion">${failure}</testcase>`,
    "</testsuite>",
    "",
  ].join("\n");
}

export function unwrapData(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) {
    return (value as Record<string, unknown>).data;
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
