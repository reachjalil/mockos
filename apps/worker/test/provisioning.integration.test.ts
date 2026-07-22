import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type {
  ApplicationRegistration,
  EnvironmentConfig,
  ProvisioningRun,
  ProvisioningSummary,
  ProvisioningWorkflowParams,
} from "@mockos/contracts";
import type {
  CompleteProvisioningRunInput,
  EnvironmentDurableObject,
} from "@mockos/worker-kit";
import { describe, expect, it, vi } from "vitest";

const namespace = Reflect.get(
  env,
  "ENVIRONMENTS"
) as DurableObjectNamespace<EnvironmentDurableObject>;
const target = Reflect.get(env, "PROVISIONING_FETCHER") as Fetcher;
const worker = (exports as unknown as { default: Fetcher }).default;
const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";

type JsonRpcResponse = {
  error?: { code: number; message: string };
  result?: {
    isError?: boolean;
    structuredContent?: { data?: Record<string, unknown> };
  };
};

const parseMcpMessages = async (response: Response): Promise<JsonRpcResponse[]> => {
  const body = await response.text();
  if (!body) return [];
  if (response.headers.get("content-type")?.includes("application/json")) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
};

const mcpRequest = (
  payload: Record<string, unknown>,
  sessionId?: string
): Promise<Response> => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return worker.fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
};

const initializeMcp = async (): Promise<string> => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "provisioning-e2e", version: "1.0.0" },
    },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const initialized = await mcpRequest(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId ?? undefined
  );
  expect([200, 202, 204]).toContain(initialized.status);
  await initialized.body?.cancel();
  return sessionId ?? "";
};

const callMcpTool = async (
  sessionId: string,
  name: string,
  args: Record<string, unknown>
) => {
  const response = await mcpRequest(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const [message] = await parseMcpMessages(response);
  expect(message?.error).toBeUndefined();
  return message?.result;
};

const config = (id: string): EnvironmentConfig => ({
  id,
  name: `Provisioning ${id}`,
  provider: "entra",
  seed: id,
  tenantId: "7f6f4756-741d-4a4b-83b2-5f2e37ec621d",
  createdAt: "2026-07-22T12:00:00.000Z",
  idleTtlHours: 168,
  requestLogLimit: 10_000,
});

const stub = (id: string) => namespace.get(namespace.idFromName(id));

const createApplication = (
  environment: DurableObjectStub<EnvironmentDurableObject>,
  name: string
): Promise<ApplicationRegistration> =>
  environment.createApplication({
    name,
    redirectUris: [`https://client.example/${name}`],
    grantTypes: ["authorization_code"],
    appRoles: [],
    groupClaimsMode: "none",
  });

const inlineTarget = (
  ref: string,
  auth: { kind: "none" } | { kind: "bearer"; token: string } = {
    kind: "none",
  }
) => ({
  kind: "inline" as const,
  save: false,
  target: {
    ref,
    baseUrl: "https://target.example.com/scim/v2",
    auth,
    behavior: {},
  },
});

const params = (
  environmentId: string,
  applicationId: string,
  runId: string,
  targetRef: string
): ProvisioningWorkflowParams => ({
  envId: environmentId,
  appId: applicationId,
  runId,
  mode: "full",
  targetRef,
});

const waitForTerminalRun = async (
  environment: DurableObjectStub<EnvironmentDurableObject>,
  runId: string
): Promise<ProvisioningRun> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await environment.getProvisioningRun(runId);
    if (
      run &&
      (run.status === "succeeded" ||
        run.status === "partial" ||
        run.status === "failed")
    ) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Provisioning run '${runId}' did not finish.`);
};

describe("M5 provisioning Worker orchestration", () => {
  it("does not orphan a queued run when alarm scheduling fails", async () => {
    const environmentId = "provision-alarm-01";
    const environment = stub(environmentId);
    await environment.configure(config(environmentId));
    try {
      const application = await createApplication(environment, "alarm-order-app");
      const runParams = params(
        environmentId,
        application.id,
        "run-alarm-order",
        "alarm-order-target"
      );
      await runInDurableObject(environment, async (instance, state) => {
        const alarm = vi
          .spyOn(state.storage, "setAlarm")
          .mockRejectedValueOnce(new Error("synthetic alarm failure"));
        await expect(
          instance.queueProvisioningRun(runParams, inlineTarget("alarm-order-target"))
        ).rejects.toThrow("synthetic alarm failure");
        expect(instance.getProvisioningRun(runParams.runId)).toBeUndefined();
        alarm.mockRestore();
      });
    } finally {
      await environment.purge();
    }
  });

  it("never re-stages a credential when a queued retry races terminal cleanup", async () => {
    const environmentId = "provision-terminal-retry-01";
    const environment = stub(environmentId);
    await environment.configure(config(environmentId));
    try {
      const application = await createApplication(environment, "terminal-retry-app");
      const runParams = params(
        environmentId,
        application.id,
        "run-terminal-retry",
        "terminal-retry-target"
      );
      const retryTarget = inlineTarget("terminal-retry-target", {
        kind: "bearer",
        token: "terminal-retry-secret",
      });
      await environment.queueProvisioningRun(runParams, retryTarget);
      await expect(
        environment.reconcileTerminalProvisioningWorkflow(runParams.runId, "terminated")
      ).resolves.toMatchObject({
        outcome: "failed",
        run: { id: runParams.runId, status: "failed" },
      });

      await expect(
        environment.queueProvisioningRun(runParams, retryTarget)
      ).resolves.toMatchObject({ id: runParams.runId, status: "failed" });
      await runInDurableObject(environment, async (_instance, state) => {
        const [row] = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM provisioning_run_targets WHERE run_id = ?",
            runParams.runId
          )
          .toArray();
        expect(row?.count).toBe(0);
      });
    } finally {
      await environment.purge();
    }
  });

  it("rejects the exact self-host platform key before saving or staging it", async () => {
    const environmentId = "provision-platform-key-01";
    const environment = stub(environmentId);
    await environment.configure(config(environmentId));
    try {
      const application = await createApplication(environment, "platform-key-app");
      let saveError: unknown;
      try {
        await environment.saveProvisioningTarget({
          ref: "platform-key-saved",
          baseUrl: "https://target.example.com/scim/v2",
          auth: { kind: "bearer", token: apiKey },
          behavior: {},
        });
      } catch (error) {
        saveError = error;
      }
      expect(saveError).toBeInstanceOf(Error);
      expect(String(saveError)).not.toContain(apiKey);

      const runParams = params(
        environmentId,
        application.id,
        "run-platform-key",
        "platform-key-inline"
      );
      let queueError: unknown;
      try {
        await environment.queueProvisioningRun(
          runParams,
          inlineTarget("platform-key-inline", {
            kind: "bearer",
            token: apiKey,
          })
        );
      } catch (error) {
        queueError = error;
      }
      expect(queueError).toBeInstanceOf(Error);
      expect(String(queueError)).not.toContain(apiKey);

      await runInDurableObject(environment, async (_instance, state) => {
        const [saved] = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM provisioning_targets WHERE target_ref = ?",
            "platform-key-saved"
          )
          .toArray();
        const [staged] = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM provisioning_run_targets WHERE run_id = ?",
            runParams.runId
          )
          .toArray();
        const [run] = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM provisioning_runs WHERE id = ?",
            runParams.runId
          )
          .toArray();
        expect({ saved: saved?.count, staged: staged?.count, run: run?.count }).toEqual(
          {
            saved: 0,
            staged: 0,
            run: 0,
          }
        );
      });
    } finally {
      await environment.purge();
    }
  });

  it("rechecks a resolved saved credential after platform-key rotation before fetch", async () => {
    const environmentId = "provision-key-rotation-01";
    const environment = stub(environmentId);
    const rotatedPlatformKey = "rotated-platform-key";
    await environment.configure(config(environmentId));
    await target.fetch("https://target.example.com/__test/reset", {
      method: "POST",
      headers: { "x-target-control-token": "target-control-token" },
    });
    try {
      const application = await createApplication(environment, "key-rotation-app");
      await environment.saveProvisioningTarget({
        ref: "key-rotation-target",
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "bearer", token: rotatedPlatformKey },
        behavior: {},
      });
      const runParams = params(
        environmentId,
        application.id,
        "run-key-rotation",
        "key-rotation-target"
      );
      await environment.queueProvisioningRun(runParams, {
        kind: "saved",
        targetRef: runParams.targetRef,
      });
      await environment.prepareProvisioningRun(runParams);

      await runInDurableObject(environment, async (instance, state) => {
        const runtimeEnv = Reflect.get(instance, "env") as {
          API_KEY?: string;
        };
        const originalApiKey = runtimeEnv.API_KEY;
        runtimeEnv.API_KEY = rotatedPlatformKey;
        let executionError: unknown;
        try {
          await instance.executeProvisioningOperation({
            runId: runParams.runId,
            targetRef: runParams.targetRef,
            stepSequence: 1,
            operation: {
              type: "http",
              id: "op-rotation-user-lookup",
              sequence: 1,
              provider: "entra",
              resourceType: "User",
              action: "lookup",
              sourceId: "rotation-user",
              sourceVersion: 1,
              source: {
                resourceType: "User",
                id: "rotation-user",
                userName: "rotation@example.test",
                displayName: "Rotation User",
                active: true,
                deleted: false,
                version: 1,
              },
              behavior: {},
              attempt: 1,
              request: {
                method: "GET",
                path: "/Users?filter=userName%20eq%20%22rotation%40example.test%22",
                headers: { accept: "application/scim+json" },
              },
            },
          });
        } catch (error) {
          executionError = error;
        } finally {
          runtimeEnv.API_KEY = originalApiKey;
        }
        expect(executionError).toBeInstanceOf(Error);
        expect(String(executionError)).not.toContain(rotatedPlatformKey);
        const [steps] = state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM provisioning_steps WHERE run_id = ?",
            runParams.runId
          )
          .toArray();
        expect(steps?.count).toBe(0);
      });

      const captured = await target.fetch(
        "https://target.example.com/__test/requests",
        { headers: { "x-target-control-token": "target-control-token" } }
      );
      expect((await captured.json<{ requests: unknown[] }>()).requests).toEqual([]);
      await environment.failProvisioningRun(
        runParams.runId,
        "Key-rotation test complete."
      );
    } finally {
      await environment.purge();
    }
  });

  it("pins credentials, isolates run namespaces, and keeps terminal watermark immutable", async () => {
    const environmentId = "provision-state-01";
    const environment = stub(environmentId);
    await environment.configure(config(environmentId));
    try {
      const appA = await createApplication(environment, "provision-app-a");
      const appB = await createApplication(environment, "provision-app-b");
      const firstSaved = await environment.saveProvisioningTarget({
        ref: "frozen-target",
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "bearer", token: "first-target-token" },
        behavior: {},
      });
      const frozenParams = params(
        environmentId,
        appA.id,
        "run-frozen-target",
        "frozen-target"
      );
      await environment.queueProvisioningRun(frozenParams, {
        kind: "saved",
        targetRef: "frozen-target",
      });
      const secondSaved = await environment.saveProvisioningTarget({
        ref: "frozen-target",
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "bearer", token: "second-target-token" },
        behavior: {},
      });
      const frozenPrepared = await environment.prepareProvisioningRun(frozenParams);
      expect(frozenPrepared.target.auth).toEqual(firstSaved.auth);
      expect(frozenPrepared.target.auth).not.toEqual(secondSaved.auth);
      await environment.failProvisioningRun(
        frozenParams.runId,
        "Frozen-target test complete."
      );

      const retryParams = params(
        environmentId,
        appA.id,
        "run-exact-retry",
        "exact-retry-target"
      );
      const retryTarget = inlineTarget("exact-retry-target", {
        kind: "bearer",
        token: "exact-retry-token",
      });
      await environment.queueProvisioningRun(retryParams, retryTarget);
      await expect(
        environment.queueProvisioningRun(retryParams, retryTarget)
      ).resolves.toMatchObject({ id: retryParams.runId, status: "queued" });
      await environment.prepareProvisioningRun(retryParams);
      await expect(
        environment.revalidateActiveProvisioningRun(retryParams, retryTarget)
      ).resolves.toMatchObject({ id: retryParams.runId, status: "running" });
      const replayInput = {
        runId: retryParams.runId,
        targetRef: retryParams.targetRef,
        stepSequence: 1,
        operation: {
          type: "http" as const,
          id: "op-race-user-lookup",
          sequence: 1,
          provider: "entra" as const,
          resourceType: "User" as const,
          action: "lookup" as const,
          sourceId: "race-user",
          sourceVersion: 1,
          source: {
            resourceType: "User" as const,
            id: "race-user",
            userName: "race@example.com",
            displayName: "Race User",
            active: true,
            deleted: false,
            version: 1,
          },
          behavior: {},
          attempt: 1,
          request: {
            method: "GET" as const,
            path: "/Users?filter=userName%20eq%20%22race%40example.com%22",
            headers: { accept: "application/scim+json" },
          },
        },
      };
      const persistedExecution =
        await environment.executeProvisioningOperation(replayInput);
      const compensation = await environment.compensateProvisioningRun(
        retryParams.runId,
        "Synthetic queued-to-running compensation race."
      );
      expect(compensation).toMatchObject({
        outcome: "preserved",
        run: { id: retryParams.runId, status: "running" },
      });
      await expect(
        environment.revalidateActiveProvisioningRun(retryParams, retryTarget)
      ).resolves.toMatchObject({ id: retryParams.runId, status: "running" });
      await expect(
        environment.executeProvisioningOperation(replayInput)
      ).resolves.toEqual(persistedExecution);
      await environment.failProvisioningRun(
        retryParams.runId,
        "Compensation race fixture complete."
      );
      const differentAppRun = params(
        environmentId,
        appB.id,
        "run-different-app",
        "exact-retry-target"
      );
      await environment.queueProvisioningRun(differentAppRun, retryTarget);
      const differentTargetRun = params(
        environmentId,
        appA.id,
        "run-different-target",
        "different-target"
      );
      await environment.queueProvisioningRun(
        differentTargetRun,
        inlineTarget("different-target")
      );
      for (const runId of [differentAppRun.runId, differentTargetRun.runId]) {
        await environment.compensateProvisioningRun(
          runId,
          "Concurrency fixture complete."
        );
      }

      await environment.saveProvisioningTarget({
        ref: "terminal-target",
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "none" },
        behavior: {},
      });
      const terminalParams = params(
        environmentId,
        appA.id,
        "run-terminal-watermark",
        "terminal-target"
      );
      await environment.queueProvisioningRun(terminalParams, {
        kind: "saved",
        targetRef: "terminal-target",
      });
      const terminalPrepared = await environment.prepareProvisioningRun(terminalParams);
      const summary: ProvisioningSummary = {
        runId: terminalParams.runId,
        status: "succeeded",
        operations: { total: 0, succeeded: 0, failed: 0, retried: 0 },
        resources: { users: 0, groups: 0 },
        startedAt: terminalPrepared.run.startedAt ?? terminalPrepared.run.createdAt,
        completedAt: new Date(Date.now() + 1_000).toISOString(),
      };
      const firstCompletion: CompleteProvisioningRunInput = {
        runId: terminalParams.runId,
        summary,
        watermark: { cursor: "cursor-one", users: [], groups: [] },
      };
      await environment.completeProvisioningRun(firstCompletion);
      await environment.completeProvisioningRun({
        ...firstCompletion,
        watermark: { cursor: "cursor-two", users: [], groups: [] },
      });
      const nextParams = params(
        environmentId,
        appA.id,
        "run-read-terminal-watermark",
        "terminal-target"
      );
      await environment.queueProvisioningRun(nextParams, {
        kind: "saved",
        targetRef: "terminal-target",
      });
      const nextPrepared = await environment.prepareProvisioningRun(nextParams);
      expect(nextPrepared.watermark.cursor).toBe("cursor-one");
      await environment.failProvisioningRun(
        nextParams.runId,
        "Terminal watermark fixture complete."
      );
    } finally {
      await environment.purge();
    }
  });

  it("runs the authenticated MCP tool through Workflow and the target binding", async () => {
    const environmentId = "provision-e2e-01";
    const environment = stub(environmentId);
    await target.fetch("https://target.example.com/__test/reset", {
      method: "POST",
      headers: { "x-target-control-token": "target-control-token" },
    });
    const configured = await worker.fetch(
      `${origin}/__mockos/v1/environments/${environmentId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(config(environmentId)),
      }
    );
    expect(configured.status, await configured.clone().text()).toBe(200);
    try {
      await environment.seed({
        users: [
          {
            userName: "ada.provisioning@example.com",
            displayName: "Ada Provisioning",
            givenName: "Ada",
            familyName: "Lovelace",
            password: "Passw0rd!",
            active: true,
            mfaState: "none",
            roles: [],
          },
        ],
        groups: [
          {
            displayName: "Provisioning engineers",
            members: ["ada.provisioning@example.com"],
          },
        ],
      });
      const application = await createApplication(environment, "provision-e2e-app");
      const sessionId = await initializeMcp();
      const started = await callMcpTool(sessionId, "run_provisioning_cycle", {
        environmentId,
        appId: application.id,
        mode: "full",
        target: inlineTarget("target-app", {
          kind: "bearer",
          token: "target-scim-token",
        }),
      });
      expect(started?.isError).not.toBe(true);
      const runId = started?.structuredContent?.data?.id;
      expect(typeof runId).toBe("string");

      const run = await waitForTerminalRun(environment, runId as string);
      expect(run.status).toBe("succeeded");
      const assertion = await environment.assertRequests({
        source: "outbound",
        count: { exactly: 1 },
        sequence: [
          {
            method: "GET",
            path: "/scim/v2/Users",
            status: 200,
            responseBodyIncludes: "totalResults",
          },
          {
            method: "POST",
            path: "/scim/v2/Users",
            status: 201,
            bodyIncludes: "ada.provisioning@example.com",
          },
          {
            method: "GET",
            path: "/scim/v2/Groups",
            status: 200,
            responseBodyIncludes: "totalResults",
          },
          {
            method: "POST",
            path: "/scim/v2/Groups",
            status: 201,
            bodyIncludes: "Provisioning engineers",
          },
        ],
      });
      expect(assertion).toMatchObject({ pass: true, matched: 1 });

      const stateResponse = await target.fetch(
        "https://target.example.com/__test/state",
        { headers: { "x-target-control-token": "target-control-token" } }
      );
      expect(await stateResponse.json()).toMatchObject({
        users: [{ userName: "ada.provisioning@example.com" }],
        groups: [{ displayName: "Provisioning engineers" }],
      });
      const requestResponse = await target.fetch(
        "https://target.example.com/__test/requests",
        { headers: { "x-target-control-token": "target-control-token" } }
      );
      const requestState = await requestResponse.json<{
        requests: Array<{ headers: Record<string, string> }>;
      }>();
      expect(requestState.requests).toHaveLength(4);
      expect(
        requestState.requests.every(
          (request) => request.headers.authorization === "Bearer <redacted>"
        )
      ).toBe(true);
    } finally {
      const deleted = await worker.fetch(
        `${origin}/__mockos/v1/environments/${environmentId}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${apiKey}` },
        }
      );
      expect(deleted.status, await deleted.clone().text()).toBe(204);
    }
  });
});
