#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputLimit = 64 * 1_024;
const probeTimeoutMs = 45_000;
const exitTimeoutMs = 15_000;
const unsafeTlsEnvironmentVariable = "NODE_TLS_REJECT_UNAUTHORIZED";
if (process.env[unsafeTlsEnvironmentVariable] === "0") {
  throw new Error(
    `${unsafeTlsEnvironmentVariable}=0 is forbidden because it invalidates HTTPS qualification evidence.`
  );
}
const childEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== unsafeTlsEnvironmentVariable
    )
  );
const appendBounded = (current, chunk) => `${current}${chunk}`.slice(-outputLimit);
const requiredConfiguration = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const clientLabel = requiredConfiguration("MOCKOS_OFFICIAL_CLIENT_LABEL");
const clientScript = requiredConfiguration("MOCKOS_OFFICIAL_CLIENT_SCRIPT");
const clientEnvironmentPrefix = requiredConfiguration(
  "MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX"
);
const temporaryDirectoryPrefix = requiredConfiguration(
  "MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX"
);
const cleanupClaim = requiredConfiguration("MOCKOS_OFFICIAL_CLIENT_CLEANUP_CLAIM");
if (!/^[A-Z][A-Z0-9_]*$/.test(clientEnvironmentPrefix)) {
  throw new Error(
    "MOCKOS_OFFICIAL_CLIENT_ENV_PREFIX must be an uppercase environment prefix."
  );
}
if (
  !clientScript.startsWith("scripts/") ||
  clientScript.includes("..") ||
  !clientScript.endsWith(".mjs")
) {
  throw new Error(
    "MOCKOS_OFFICIAL_CLIENT_SCRIPT must be a repository-local scripts/*.mjs path."
  );
}
if (
  !temporaryDirectoryPrefix.startsWith("mockos-") ||
  temporaryDirectoryPrefix.includes("/")
) {
  throw new Error("MOCKOS_OFFICIAL_CLIENT_TEMP_PREFIX must be a flat mockos-* prefix.");
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleanupClaim)) {
  throw new Error(
    "MOCKOS_OFFICIAL_CLIENT_CLEANUP_CLAIM must be a lowercase kebab-case claim."
  );
}

const reservePorts = async (count) => {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = createServer();
      server.unref();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
      });
    }
    const ports = servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not reserve a loopback cleanup-probe port.");
      }
      return address.port;
    });
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.close((error) => {
              if (error) reject(error);
              else resolve();
            });
          })
      )
    );
    return ports;
  } catch (error) {
    await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(() => resolve());
          })
      )
    );
    throw error;
  }
};

const assertPortAvailable = (port) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      reject(
        new Error(
          `Cleanup probe left 127.0.0.1:${port} unavailable (${error.code ?? "listener error"}).`
        )
      );
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

const processGroupAlive = (processGroupId) => {
  if (process.platform === "win32") return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
};

const withTimeout = (operation, milliseconds, message) => {
  let timeout;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timeout));
};

const main = async () => {
  const [port, inspectorPort] = await reservePorts(2);
  const temporaryParent = await mkdtemp(join(tmpdir(), temporaryDirectoryPrefix));
  let child;
  let workerProcessGroupId;
  let stdout = "";
  let stderr = "";
  try {
    child = spawn(process.execPath, [clientScript], {
      cwd: repositoryRoot,
      env: {
        ...childEnvironment(),
        [`${clientEnvironmentPrefix}_CLEANUP_PROBE`]: "true",
        [`${clientEnvironmentPrefix}_INSPECTOR_PORT`]: String(inspectorPort),
        [`${clientEnvironmentPrefix}_PORT`]: String(port),
        [`${clientEnvironmentPrefix}_TEMP_PARENT`]: temporaryParent,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const evidence = [];
    let lineBuffer = "";
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = appendBounded(stdout, text);
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          evidence.push(parsed);
          if (parsed?.probe === "ready") resolveReady(parsed);
        } catch {
          // Wrangler diagnostics belong on stderr; ignore non-JSON stdout here.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    const exited = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const readyEvidence = await withTimeout(
      Promise.race([
        ready,
        exited.then((result) => {
          throw new Error(
            `Cleanup-probe parent exited before readiness (${JSON.stringify(result)}).`
          );
        }),
      ]),
      probeTimeoutMs,
      "Cleanup-probe parent did not become ready."
    );
    if (
      readyEvidence.port !== port ||
      readyEvidence.inspectorPort !== inspectorPort ||
      !Number.isSafeInteger(readyEvidence.workerProcessGroupId) ||
      typeof readyEvidence.temporaryDirectory !== "string" ||
      !readyEvidence.temporaryDirectory.startsWith(`${temporaryParent}/`)
    ) {
      throw new Error("Cleanup-probe readiness evidence was invalid.");
    }
    workerProcessGroupId = readyEvidence.workerProcessGroupId;

    child.kill("SIGTERM");
    const exit = await withTimeout(
      exited,
      exitTimeoutMs,
      "Cleanup-probe parent did not exit after SIGTERM."
    );
    if (exit.error || exit.signal !== null || exit.code !== 143) {
      throw new Error(
        `Cleanup-probe parent returned an unexpected exit (${JSON.stringify(exit)}).`
      );
    }
    const cleaned = evidence.find((item) => item?.probe === "cleaned");
    if (cleaned?.signal !== "SIGTERM" || cleaned.temporaryDirectoryRemoved !== true) {
      throw new Error("Cleanup-probe parent returned no cleanup acknowledgement.");
    }

    await assertPortAvailable(port);
    await assertPortAvailable(inspectorPort);
    if (processGroupAlive(workerProcessGroupId)) {
      throw new Error("Cleanup probe left the detached Wrangler process group alive.");
    }
    try {
      await access(readyEvidence.temporaryDirectory);
      throw new Error("Cleanup probe left its Wrangler persistence directory behind.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const remaining = await readdir(temporaryParent);
    if (remaining.length > 0) {
      throw new Error("Cleanup probe left temporary children behind.");
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        claim: cleanupClaim,
        signal: "SIGTERM",
        exitCode: exit.code,
        portReleased: true,
        inspectorPortReleased: true,
        processGroupGone: true,
        temporaryStateRemoved: true,
      })}\n`
    );
  } catch (error) {
    throw new Error(
      `${
        error instanceof Error ? error.message : `${clientLabel} cleanup probe failed.`
      }\n${stdout}\n${stderr}`,
      { cause: error }
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    if (workerProcessGroupId && processGroupAlive(workerProcessGroupId)) {
      try {
        process.kill(-workerProcessGroupId, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") {
          process.stderr.write(
            `Cleanup probe could not reap Wrangler process group: ${
              error instanceof Error ? error.message : "unknown error"
            }\n`
          );
        }
      }
    }
    await rm(temporaryParent, { force: true, recursive: true });
  }
};

await main();
