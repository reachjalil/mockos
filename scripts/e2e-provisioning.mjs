#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const endpoint = "http://127.0.0.1:8787/mcp";
const targetOrigin = "http://127.0.0.1:8792";
const apiKey = "mockos-e2e-api-key";
const targetScimToken = "target-app-scim-token";
const targetControlToken = "target-app-control-token";
const processLogLimit = 64 * 1_024;
const requestTimeoutMs = 5_000;
const processTimeoutMs = 45_000;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const appendBounded = (current, chunk) => `${current}${chunk}`.slice(-processLogLimit);

const assertPortAvailable = (port, label) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      reject(
        new Error(
          `${label} cannot start because 127.0.0.1:${port} is unavailable (${error.code ?? "listener error"}).`
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

const startService = (label, args) => {
  const child = spawn("pnpm", args, {
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = { child, label, stdout: "", stderr: "", spawnError: undefined };
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

const stopService = async (service) => {
  if (
    !service ||
    service.child.exitCode !== null ||
    service.child.signalCode !== null
  ) {
    return;
  }
  service.child.kill("SIGINT");
  await Promise.race([service.exited, delay(5_000)]);
  if (service.child.exitCode === null && service.child.signalCode === null) {
    service.child.kill("SIGKILL");
    await Promise.race([service.exited, delay(5_000)]);
  }
  if (service.child.exitCode === null && service.child.signalCode === null) {
    throw new Error(`${service.label} could not be stopped.`);
  }
};

const serviceFailure = (service) =>
  `${service.label} output:\n${service.stdout}\n${service.stderr}`;

const serviceExitError = (service) =>
  new Error(`${service.label} exited unexpectedly.\n${serviceFailure(service)}`);

const assertServiceAlive = (service) => {
  if (
    service.spawnError ||
    service.child.exitCode !== null ||
    service.child.signalCode !== null
  ) {
    throw serviceExitError(service);
  }
};

const withLiveServices = async (services, operation) => {
  const monitored = services.filter(Boolean);
  for (const service of monitored) assertServiceAlive(service);
  const result = await Promise.race([
    Promise.resolve().then(operation),
    ...monitored.map((service) =>
      service.exited.then(() => {
        throw serviceExitError(service);
      })
    ),
  ]);
  for (const service of monitored) assertServiceAlive(service);
  return result;
};

const fetchWithTimeout = (url, init = {}, services = []) =>
  withLiveServices(services, () =>
    fetch(url, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(requestTimeoutMs)])
        : AbortSignal.timeout(requestTimeoutMs),
    })
  );

const waitForOwnedHttp = async (url, service, expected) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertServiceAlive(service);
    let response;
    try {
      response = await fetchWithTimeout(url, {}, [service]);
    } catch {
      // The local listener is not ready yet.
      assertServiceAlive(service);
      await withLiveServices([service], () => delay(100));
      continue;
    }
    if (response.ok) {
      let identity;
      try {
        identity = await withLiveServices([service], () => response.json());
      } catch (error) {
        throw new Error(`${service.label} health response was not valid JSON.`, {
          cause: error,
        });
      }
      if (
        identity?.service !== expected.service ||
        identity?.e2eOwnerNonce !== expected.nonce
      ) {
        throw new Error(
          `${service.label} health response is owned by another listener on ${new URL(url).host}.`
        );
      }
      return;
    }
    await withLiveServices([service], () => response.body?.cancel());
    await withLiveServices([service], () => delay(100));
  }
  throw new Error(`${service.label} did not become ready.\n${serviceFailure(service)}`);
};

const runProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? processTimeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk.toString());
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `${command} ${args.join(" ")} exceeded its process timeout.\n${stdout}\n${stderr}`
          )
        );
        return;
      }
      const allowed = options.allowedExitCodes ?? [0];
      if (code !== null && allowed.includes(code)) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${String(code)}.\n${stdout}\n${stderr}`
        )
      );
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });

const runCli = async (args, options = {}) => {
  const result = await withLiveServices(options.services ?? [], () =>
    runProcess(process.execPath, ["packages/cli/dist/bin.js", ...args, "--json"], {
      ...options,
      env: {
        ...process.env,
        MOCKOS_ENDPOINT: endpoint,
        MOCKOS_API_KEY: apiKey,
        MOCKOS_CONFIG: ".wrangler/e2e-cli-config.json",
      },
    })
  );
  const line = result.stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error(`mockOS CLI returned no JSON.\n${result.stderr}`);
  return { code: result.code, payload: JSON.parse(line) };
};

const resetTarget = async (services = []) => {
  const response = await fetchWithTimeout(
    `${targetOrigin}/__test/reset`,
    {
      method: "POST",
      headers: { "x-target-control-token": targetControlToken },
    },
    services
  );
  if (!response.ok) {
    await withLiveServices(services, () => response.body?.cancel());
    throw new Error(`Target reset failed (${response.status}).`);
  }
  await withLiveServices(services, () => response.body?.cancel());
};

const main = async () => {
  await runProcess("pnpm", ["--filter", "@mockos/cli", "build"]);

  const targetOwnerNonce = crypto.randomUUID();
  const workerOwnerNonce = crypto.randomUUID();
  let targetService;
  let workerService;
  let targetOwned = false;
  let workerOwned = false;
  let environmentId;
  let resultPayload;
  let operationError;
  try {
    await assertPortAvailable(8792, "target-app wrangler dev");
    targetService = startService("target-app wrangler dev", [
      "--filter",
      "@mockos/target-app",
      "exec",
      "wrangler",
      "dev",
      "--config",
      "wrangler.local.jsonc",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "8792",
      "--var",
      `E2E_OWNER_NONCE:${targetOwnerNonce}`,
    ]);
    await waitForOwnedHttp(`${targetOrigin}/health`, targetService, {
      service: "mockos-target-app",
      nonce: targetOwnerNonce,
    });
    targetOwned = true;

    await assertPortAvailable(8787, "mockOS wrangler dev");
    workerService = startService("mockOS wrangler dev", [
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
      "8787",
      "--var",
      `E2E_OWNER_NONCE:${workerOwnerNonce}`,
    ]);
    await waitForOwnedHttp("http://127.0.0.1:8787/health", workerService, {
      service: "mockos",
      nonce: workerOwnerNonce,
    });
    workerOwned = true;

    const services = [workerService, targetService];
    await resetTarget(services);

    const created = await runCli(
      [
        "env",
        "create",
        "--name",
        "Wrangler provisioning e2e",
        "--provider",
        "entra",
        "--seed",
        `wrangler-provisioning-${crypto.randomUUID()}`,
      ],
      { services }
    );
    environmentId = created.payload?.data?.id;
    if (typeof environmentId !== "string") {
      throw new Error("Environment creation returned no id.");
    }

    await runCli(
      ["seed", "--env", environmentId, "--file", "examples/target-app/e2e/seed.json"],
      { services }
    );
    const application = await runCli(
      [
        "app",
        "create",
        "--env",
        environmentId,
        "--file",
        "examples/target-app/e2e/application.json",
      ],
      { services }
    );
    const applicationId = application.payload?.data?.id;
    if (typeof applicationId !== "string") {
      throw new Error("Application creation returned no id.");
    }

    const queued = await runCli(
      [
        "provision",
        "run",
        "--env",
        environmentId,
        "--app-id",
        applicationId,
        "--mode",
        "full",
        "--target-ref",
        "target-app",
        "--target-url",
        "https://target.example.com/scim/v2",
        "--target-token-file",
        "-",
      ],
      { input: `${targetScimToken}\n`, services }
    );
    if (queued.payload?.data?.status !== "queued") {
      throw new Error("Provisioning did not return a queued run.");
    }

    const assertionDeadline = Date.now() + 30_000;
    let assertion;
    while (Date.now() < assertionDeadline) {
      assertion = await runCli(
        [
          "assert",
          "--env",
          environmentId,
          "--spec",
          "examples/target-app/e2e/assertion.json",
        ],
        { allowedExitCodes: [0, 3], services }
      );
      if (assertion.code === 0 && assertion.payload?.data?.pass === true) break;
      await withLiveServices(services, () => delay(200));
    }
    if (assertion?.payload?.data?.pass !== true) {
      throw new Error("Provisioning request assertion did not pass before timeout.");
    }

    const runId = queued.payload.data.id;
    const terminalDeadline = Date.now() + 30_000;
    let terminalRun;
    while (Date.now() < terminalDeadline) {
      const response = await fetchWithTimeout(
        `http://127.0.0.1:8787/__mockos/e2e/environments/${encodeURIComponent(environmentId)}/provisioning-runs/${encodeURIComponent(runId)}`,
        { headers: { authorization: `Bearer ${apiKey}` } },
        services
      );
      if (response.ok) {
        terminalRun = (await withLiveServices(services, () => response.json())).data;
        if (["succeeded", "partial", "failed"].includes(terminalRun?.status)) {
          break;
        }
      } else {
        await withLiveServices(services, () => response.body?.cancel());
      }
      await withLiveServices(services, () => delay(200));
    }
    if (terminalRun?.status !== "succeeded") {
      throw new Error(
        `Provisioning Workflow did not reach succeeded state (received ${String(terminalRun?.status ?? "no terminal state")}).`
      );
    }

    const [stateResponse, requestResponse] = await Promise.all([
      fetchWithTimeout(
        `${targetOrigin}/__test/state`,
        { headers: { "x-target-control-token": targetControlToken } },
        services
      ),
      fetchWithTimeout(
        `${targetOrigin}/__test/requests`,
        { headers: { "x-target-control-token": targetControlToken } },
        services
      ),
    ]);
    if (!stateResponse.ok || !requestResponse.ok) {
      await withLiveServices(services, () =>
        Promise.all([stateResponse.body?.cancel(), requestResponse.body?.cancel()])
      );
      throw new Error("Target evidence endpoints were unavailable.");
    }
    const [state, requests] = await withLiveServices(services, () =>
      Promise.all([stateResponse.json(), requestResponse.json()])
    );
    const [userLookup, userCreate, groupLookup, groupCreate] = requests.requests ?? [];
    if (
      state.users?.[0]?.userName !== "ada.provisioning@example.test" ||
      state.groups?.[0]?.displayName !== "Provisioning engineers" ||
      requests.requests?.length !== 4 ||
      userLookup?.query?.filter !== 'userName eq "ada.provisioning@example.test"' ||
      groupLookup?.query?.filter !== 'displayName eq "Provisioning engineers"' ||
      userCreate?.body?.userName !== "ada.provisioning@example.test" ||
      userCreate?.body?.active !== true ||
      !userCreate?.body?.schemas?.includes(
        "urn:ietf:params:scim:schemas:core:2.0:User"
      ) ||
      groupCreate?.body?.displayName !== "Provisioning engineers" ||
      groupCreate?.body?.members?.length !== 1 ||
      groupCreate?.body?.members?.[0]?.value !== state.users?.[0]?.id ||
      groupCreate?.body?.members?.[0]?.type !== "User" ||
      !groupCreate?.body?.schemas?.includes(
        "urn:ietf:params:scim:schemas:core:2.0:Group"
      ) ||
      !requests.requests.every(
        (request) => request.headers?.authorization === "Bearer <redacted>"
      )
    ) {
      throw new Error("Target state or credential-redaction evidence was invalid.");
    }

    for (const service of services) assertServiceAlive(service);
    resultPayload = {
      ok: true,
      environmentId,
      runId,
      matchedRequests: assertion.payload.data.requestIds.length,
      targetUsers: state.users.length,
      targetGroups: state.groups.length,
    };
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  if (environmentId) {
    try {
      if (!workerOwned || !workerService) throw new Error("Worker ownership lost.");
      await runCli(["env", "delete", "--env", environmentId], {
        services: [workerService, targetService],
      });
    } catch (error) {
      cleanupErrors.push(new Error("Environment cleanup failed.", { cause: error }));
    }
  }
  if (targetOwned && targetService) {
    try {
      await resetTarget([workerService, targetService]);
    } catch (error) {
      cleanupErrors.push(new Error("Target cleanup failed.", { cause: error }));
    }
  }
  for (const service of [workerService, targetService]) {
    try {
      await stopService(service);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (operationError || cleanupErrors.length > 0) {
    const failures = [
      operationError instanceof Error
        ? operationError.message
        : operationError
          ? "Provisioning E2E failed."
          : undefined,
      ...cleanupErrors.map(
        (error) =>
          `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ""}`
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const diagnostics = [workerService, targetService]
      .filter(Boolean)
      .map(serviceFailure)
      .join("\n");
    throw new Error(`${failures}\n${diagnostics}`, {
      cause: operationError ?? cleanupErrors[0],
    });
  }
  if (!resultPayload) throw new Error("Provisioning E2E produced no result.");
  process.stdout.write(`${JSON.stringify(resultPayload)}\n`);
};

await main();
