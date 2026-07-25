#!/usr/bin/env node

import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultPort = 8794;
const processLogLimit = 64 * 1_024;
const processTimeoutMs = 90_000;
const readinessTimeoutMs = 30_000;
const cleanupProbe = process.env.MOCKOS_ENTRA_MSAL_E2E_CLEANUP_PROBE === "true";
const temporaryParent =
  process.env.MOCKOS_ENTRA_MSAL_E2E_TEMP_PARENT?.trim() || tmpdir();

if (process.env.MOCKOS_ENTRA_MSAL_E2E_CLEANUP_PROBE !== undefined && !cleanupProbe) {
  throw new Error("MOCKOS_ENTRA_MSAL_E2E_CLEANUP_PROBE, when set, must equal true.");
}

const requestedPort = process.env.MOCKOS_ENTRA_MSAL_E2E_PORT;
const port = requestedPort === undefined ? defaultPort : Number(requestedPort);
if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error(
    "MOCKOS_ENTRA_MSAL_E2E_PORT must be an integer between 1024 and 65535."
  );
}

const origin = `https://localhost:${port}`;
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const appendBounded = (current, chunk) => `${current}${chunk}`.slice(-processLogLimit);
const abortable = async (operation, signal) => {
  if (signal.aborted) throw signal.reason;
  let onAbort;
  const interruption = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, interruption]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

const assertPortAvailable = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      reject(
        new Error(
          `MSAL Wrangler E2E cannot start because 127.0.0.1:${port} is unavailable (${error.code ?? "listener error"}).`
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

const startWorker = (ownerNonce, persistencePath) => {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@mockos/worker",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.e2e.jsonc",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--local-protocol",
      "https",
      "--persist-to",
      persistencePath,
      "--var",
      `E2E_OWNER_NONCE:${ownerNonce}`,
      "--var",
      `PUBLIC_ORIGIN:${origin}`,
    ],
    {
      cwd: repositoryRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const service = {
    child,
    stdout: "",
    stderr: "",
    spawnError: undefined,
  };
  service.exited = new Promise((resolve) => {
    child.once("error", (error) => {
      service.spawnError = error;
      resolve({ error });
    });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on("data", (chunk) => {
    service.stdout = appendBounded(service.stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    service.stderr = appendBounded(service.stderr, chunk.toString());
  });
  return service;
};

const serviceFailure = (service) =>
  `mockOS Wrangler output:\n${service?.stdout ?? ""}\n${service?.stderr ?? ""}`;

const assertWorkerAlive = (service) => {
  if (
    service.spawnError ||
    service.child.exitCode !== null ||
    service.child.signalCode !== null
  ) {
    throw new Error(`mockOS Wrangler exited unexpectedly.\n${serviceFailure(service)}`);
  }
};

const workerTreeAlive = (service) => {
  if (!service?.child.pid) return false;
  if (process.platform === "win32") {
    return service.child.exitCode === null && service.child.signalCode === null;
  }
  try {
    process.kill(-service.child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
};

const signalWorkerTree = (service, signal) => {
  if (!service?.child.pid) return;
  try {
    if (process.platform === "win32") service.child.kill(signal);
    else process.kill(-service.child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
};

const waitForWorkerTreeStop = async (service, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (workerTreeAlive(service) && Date.now() < deadline) {
    await delay(50);
  }
  return !workerTreeAlive(service);
};

const stopWorker = async (service) => {
  if (!workerTreeAlive(service)) return;
  signalWorkerTree(service, "SIGINT");
  if (await waitForWorkerTreeStop(service, 5_000)) return;
  signalWorkerTree(service, "SIGKILL");
  if (await waitForWorkerTreeStop(service, 5_000)) return;
  throw new Error("mockOS Wrangler process tree could not be stopped.");
};

const readLoopbackCertificate = () =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      servername: "localhost",
      rejectUnauthorized: false,
    });
    const finish = (error, certificate) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(certificate);
    };
    socket.once("secureConnect", () => {
      const peer = socket.getPeerCertificate();
      if (!peer.raw) {
        finish(new Error("Wrangler presented no TLS certificate."));
        return;
      }
      try {
        const certificate = new X509Certificate(peer.raw);
        if (certificate.checkHost("localhost") !== "localhost") {
          finish(
            new Error(
              "Wrangler's generated certificate is not valid for the localhost E2E authority."
            )
          );
          return;
        }
        finish(undefined, certificate);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("error", reject);
    socket.setTimeout(2_000, () => {
      finish(new Error("Timed out reading the Wrangler TLS certificate."));
    });
  });

const requestHealth = (certificatePem) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      `${origin}/health`,
      {
        ca: certificatePem,
        method: "GET",
        rejectUnauthorized: true,
        servername: "localhost",
        timeout: 2_000,
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 64 * 1_024) {
            request.destroy(new Error("Wrangler health response exceeded 64 KiB."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.once("error", reject);
    request.once("timeout", () => {
      request.destroy(new Error("Wrangler health request timed out."));
    });
    request.end();
  });

const waitForOwnedWorker = async (service, ownerNonce) => {
  const deadline = Date.now() + readinessTimeoutMs;
  let certificate;
  let lastError;
  while (Date.now() < deadline) {
    assertWorkerAlive(service);
    try {
      certificate ??= await readLoopbackCertificate();
      const health = await requestHealth(certificate.toString());
      if (
        health.status !== 200 ||
        health.body?.service !== "mockos" ||
        health.body?.e2eOwnerNonce !== ownerNonce
      ) {
        throw new Error(
          "The HTTPS listener did not return the expected service ownership nonce."
        );
      }
      return certificate;
    } catch (error) {
      lastError = error;
      certificate = undefined;
      await delay(100);
    }
  }
  throw new Error(
    `mockOS Wrangler did not become ready (${lastError instanceof Error ? lastError.message : "unknown readiness failure"}).\n${serviceFailure(service)}`
  );
};

const startClient = (input) => {
  const child = spawn(process.execPath, ["scripts/e2e-entra-msal-client.mjs"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MOCKOS_ENTRA_MSAL_E2E_API_KEY: "mockos-e2e-api-key",
      MOCKOS_ENTRA_MSAL_E2E_ORIGIN: origin,
      MOCKOS_ENTRA_MSAL_E2E_OWNER_NONCE: input.ownerNonce,
      NODE_EXTRA_CA_CERTS: input.certificatePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = {
    child,
    stdout: "",
    stderr: "",
    spawnError: undefined,
  };
  service.exited = new Promise((resolve) => {
    child.once("error", (error) => {
      service.spawnError = error;
      resolve({ error });
    });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, processTimeoutMs);
  child.stdout.on("data", (chunk) => {
    service.stdout = appendBounded(service.stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    service.stderr = appendBounded(service.stderr, chunk.toString());
  });
  service.result = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `The MSAL acceptance client exceeded ${processTimeoutMs} ms.\n${service.stdout}\n${service.stderr}`
          )
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `The MSAL acceptance client exited ${String(code)}.\n${service.stdout}\n${service.stderr}`
          )
        );
        return;
      }
      const line = service.stdout
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .at(-1);
      if (!line) {
        reject(
          new Error(
            `The MSAL acceptance client returned no evidence.\n${service.stderr}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(
          new Error(
            `The MSAL acceptance client returned invalid JSON.\n${service.stdout}`,
            {
              cause: error,
            }
          )
        );
      }
    });
  });
  return service;
};

const stopClient = async (service) => {
  if (
    !service ||
    service.child.exitCode !== null ||
    service.child.signalCode !== null
  ) {
    return;
  }
  service.child.kill("SIGTERM");
  await Promise.race([service.exited, delay(2_000)]);
  if (service.child.exitCode === null && service.child.signalCode === null) {
    service.child.kill("SIGKILL");
    await Promise.race([service.exited, delay(2_000)]);
  }
  if (service.child.exitCode === null && service.child.signalCode === null) {
    throw new Error("The MSAL acceptance client could not be stopped.");
  }
};

const main = async () => {
  const shutdown = new AbortController();
  let requestedSignal;
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      requestedSignal ??= signal;
      if (!shutdown.signal.aborted) {
        shutdown.abort(new Error(`MSAL acceptance interrupted by ${signal}.`));
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  const ownerNonce = crypto.randomUUID();
  let temporaryDirectory;
  let service;
  let client;
  let result;
  let operationError;
  const cleanupErrors = [];
  try {
    await abortable(assertPortAvailable(), shutdown.signal);
    temporaryDirectory = await mkdtemp(join(temporaryParent, "mockos-entra-msal-"));
    if (shutdown.signal.aborted) throw shutdown.signal.reason;
    const certificatePath = join(temporaryDirectory, "wrangler-loopback-ca.pem");
    const persistencePath = join(temporaryDirectory, "wrangler-state");
    service = startWorker(ownerNonce, persistencePath);
    const certificate = await abortable(
      waitForOwnedWorker(service, ownerNonce),
      shutdown.signal
    );
    await abortable(
      writeFile(certificatePath, certificate.toString(), { mode: 0o600 }),
      shutdown.signal
    );
    if (cleanupProbe) {
      process.stdout.write(
        `${JSON.stringify({
          probe: "ready",
          port,
          temporaryDirectory,
          workerProcessGroupId: service.child.pid,
        })}\n`
      );
      await abortable(new Promise(() => undefined), shutdown.signal);
    }
    client = startClient({ certificatePath, ownerNonce });
    result = await abortable(
      Promise.race([
        client.result,
        service.exited.then(() => {
          throw new Error(
            `mockOS Wrangler exited during the MSAL acceptance flow.\n${serviceFailure(service)}`
          );
        }),
      ]),
      shutdown.signal
    );
    assertWorkerAlive(service);
  } catch (error) {
    operationError = error;
  }

  try {
    await stopClient(client);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await stopWorker(service);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (temporaryDirectory) {
    try {
      await rm(temporaryDirectory, { force: true, recursive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }

  if (requestedSignal && cleanupErrors.length === 0) {
    if (cleanupProbe) {
      process.stdout.write(
        `${JSON.stringify({
          probe: "cleaned",
          signal: requestedSignal,
          temporaryDirectoryRemoved: true,
        })}\n`
      );
    }
    process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
    return;
  }

  if (operationError || cleanupErrors.length > 0) {
    const failures = [
      operationError instanceof Error
        ? operationError.message
        : operationError
          ? "MSAL acceptance failed."
          : undefined,
      ...cleanupErrors.map((error) =>
        error instanceof Error ? error.message : "E2E cleanup failed."
      ),
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(`${failures}\n${serviceFailure(service)}`, {
      cause: operationError ?? cleanupErrors[0],
    });
  }
  if (!result) throw new Error("MSAL acceptance produced no evidence.");
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

await main();
