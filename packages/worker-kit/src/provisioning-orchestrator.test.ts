import type {
  ProvisioningHttpOperation,
  ProvisioningHttpResponse,
  ProvisioningRun,
  ProvisioningWorkflowParams,
} from "@mockos/contracts";
import { describe, expect, it } from "vitest";
import type {
  CompleteProvisioningRunInput,
  ExecuteProvisioningOperationInput,
  PreparedProvisioningRun,
} from "./environment-do";
import {
  MAX_PROVISIONING_INITIAL_OPERATIONS,
  type ProvisioningWorkflowEnvironment,
  type ProvisioningWorkflowStep,
  runProvisioningWorkflow,
} from "./provisioning-orchestrator";

const params: ProvisioningWorkflowParams = {
  envId: "env_test01",
  appId: "app-test",
  runId: "run-test",
  mode: "full",
  targetRef: "target-app",
};

const prepared: PreparedProvisioningRun = {
  run: {
    id: params.runId,
    envId: params.envId,
    appId: params.appId,
    provider: "entra",
    mode: params.mode,
    targetRef: params.targetRef,
    status: "running",
    createdAt: "2026-07-22T12:00:00.000Z",
    startedAt: "2026-07-22T12:00:01.000Z",
  },
  target: {
    ref: params.targetRef,
    baseUrl: "https://target.example.com/scim/v2",
    auth: { kind: "none" },
    behavior: {},
  },
  snapshot: {
    cursor: "snapshot-test",
    users: [
      {
        resourceType: "User",
        id: "user-1",
        userName: "ada@example.com",
        displayName: "Ada Lovelace",
        active: true,
        deleted: false,
        version: 1,
      },
    ],
    groups: [],
  },
  watermark: { users: [], groups: [] },
};

class ImmediateStep implements ProvisioningWorkflowStep {
  readonly sleeps: number[] = [];

  do<T>(
    _name: string,
    callbackOrConfig:
      | (() => Promise<T>)
      | {
          retries: {
            limit: number;
            delay: number;
            backoff: "exponential";
          };
          timeout: number;
        },
    configuredCallback?: () => Promise<T>
  ): Promise<T> {
    if (_name === "record-completion-time") {
      return Promise.resolve("2026-07-22T12:00:05.000Z" as T);
    }
    const callback =
      typeof callbackOrConfig === "function" ? callbackOrConfig : configuredCallback;
    if (!callback) throw new Error("Missing fake Workflow callback.");
    return callback();
  }

  async sleep(_name: string, duration: number): Promise<void> {
    this.sleeps.push(duration);
  }
}

class RetryingStep extends ImmediateStep {
  configuredAttempts = 0;
  readonly retryLimits: number[] = [];

  override async do<T>(
    name: string,
    callbackOrConfig:
      | (() => Promise<T>)
      | {
          retries: {
            limit: number;
            delay: number;
            backoff: "exponential";
          };
          timeout: number;
        },
    configuredCallback?: () => Promise<T>
  ): Promise<T> {
    if (typeof callbackOrConfig === "function") {
      return super.do(name, callbackOrConfig);
    }
    if (!configuredCallback) throw new Error("Missing configured callback.");
    this.retryLimits.push(callbackOrConfig.retries.limit);
    let lastError: unknown;
    for (let attempt = 0; attempt <= callbackOrConfig.retries.limit; attempt += 1) {
      this.configuredAttempts += 1;
      try {
        return await configuredCallback();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

class CachingStep extends ImmediateStep {
  readonly cache = new Map<string, unknown>();

  override async do<T>(
    name: string,
    callbackOrConfig:
      | (() => Promise<T>)
      | {
          retries: {
            limit: number;
            delay: number;
            backoff: "exponential";
          };
          timeout: number;
        },
    configuredCallback?: () => Promise<T>
  ): Promise<T> {
    if (this.cache.has(name)) return this.cache.get(name) as T;
    const callback =
      typeof callbackOrConfig === "function" ? callbackOrConfig : configuredCallback;
    if (!callback) throw new Error("Missing cached callback.");
    const result = await callback();
    this.cache.set(name, result);
    return result;
  }
}

const environment = (
  responses: readonly ProvisioningHttpResponse[],
  executions: ExecuteProvisioningOperationInput[],
  completed: CompleteProvisioningRunInput[]
): ProvisioningWorkflowEnvironment => ({
  async prepareProvisioningRun() {
    return prepared;
  },
  async executeProvisioningOperation(input) {
    executions.push(input);
    const response = responses[executions.length - 1];
    if (!response) throw new Error("Missing fake response.");
    return {
      response,
      receivedAtEpochMs: Date.parse("2026-07-22T12:00:02.000Z"),
    };
  },
  async completeProvisioningRun(input) {
    completed.push(input);
    return {
      ...prepared.run,
      status: input.summary.status,
      completedAt: input.summary.completedAt,
    } as ProvisioningRun;
  },
  async failProvisioningRun() {
    throw new Error("The test workflow should not fail.");
  },
});

const emptyLookup: ProvisioningHttpResponse = {
  status: 200,
  headers: {},
  body: { totalResults: 0, Resources: [] },
};

const created: ProvisioningHttpResponse = {
  status: 201,
  headers: { location: "/scim/v2/Users/target-user-1" },
  body: { id: "target-user-1" },
};

describe("runProvisioningWorkflow", () => {
  it("persists lookup and create follow-up under distinct execution ordinals", async () => {
    const executions: ExecuteProvisioningOperationInput[] = [];
    const completed: CompleteProvisioningRunInput[] = [];
    const result = await runProvisioningWorkflow(
      params,
      environment([emptyLookup, created], executions, completed),
      new ImmediateStep()
    );

    expect(result.status).toBe("succeeded");
    expect(executions.map((entry) => entry.stepSequence)).toEqual([1, 2]);
    expect(
      executions.map((entry) => (entry.operation as ProvisioningHttpOperation).sequence)
    ).toEqual([1, 1]);
    expect(executions.map((entry) => entry.operation.action)).toEqual([
      "lookup",
      "create",
    ]);
    expect(completed[0]?.summary.operations).toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      retried: 0,
    });
    expect(completed[0]?.watermark.users).toEqual([
      expect.objectContaining({
        sourceId: "user-1",
        targetId: "target-user-1",
      }),
    ]);
  });

  it("sleeps explicitly for 429 then uses new ordinals for retry and create", async () => {
    const executions: ExecuteProvisioningOperationInput[] = [];
    const completed: CompleteProvisioningRunInput[] = [];
    const step = new ImmediateStep();
    await runProvisioningWorkflow(
      params,
      environment(
        [{ status: 429, headers: { "retry-after": "1" } }, emptyLookup, created],
        executions,
        completed
      ),
      step
    );

    expect(step.sleeps).toEqual([1_000]);
    expect(executions.map((entry) => entry.stepSequence)).toEqual([1, 2, 3]);
    expect(executions.map((entry) => entry.operation.sequence)).toEqual([1, 1, 1]);
    expect(executions.map((entry) => entry.operation.attempt)).toEqual([1, 2, 1]);
    expect(completed[0]?.summary.operations).toEqual({
      total: 3,
      succeeded: 2,
      failed: 0,
      retried: 1,
    });
  });

  it("retries a safe GET step and reuses its persisted response", async () => {
    const persisted = new Map<
      number,
      { response: ProvisioningHttpResponse; receivedAtEpochMs: number }
    >();
    const networkCalls = new Map<number, number>();
    const completed: CompleteProvisioningRunInput[] = [];
    let firstDeliveryLost = false;
    const targetEnvironment: ProvisioningWorkflowEnvironment = {
      async prepareProvisioningRun() {
        return prepared;
      },
      async executeProvisioningOperation(input) {
        const existing = persisted.get(input.stepSequence);
        if (existing) return existing;
        networkCalls.set(
          input.stepSequence,
          (networkCalls.get(input.stepSequence) ?? 0) + 1
        );
        const response =
          input.operation.action === "lookup"
            ? emptyLookup
            : {
                status: 201,
                headers: {},
                body: { id: `target-${input.operation.sourceId}` },
              };
        const result = {
          response,
          receivedAtEpochMs: Date.parse("2026-07-22T12:00:02.000Z"),
        };
        persisted.set(input.stepSequence, result);
        if (input.stepSequence === 1 && !firstDeliveryLost) {
          firstDeliveryLost = true;
          throw new Error("synthetic RPC response loss");
        }
        return result;
      },
      async completeProvisioningRun(input) {
        completed.push(input);
        return {
          ...prepared.run,
          status: input.summary.status,
          completedAt: input.summary.completedAt,
        } as ProvisioningRun;
      },
      async failProvisioningRun() {
        throw new Error("The retried test workflow should not fail.");
      },
    };
    const step = new RetryingStep();
    const result = await runProvisioningWorkflow(params, targetEnvironment, step);

    expect(result.status).toBe("succeeded");
    expect(step.configuredAttempts).toBe(3);
    expect(networkCalls.get(1)).toBe(1);
    expect(networkCalls.get(2)).toBe(1);
    expect(step.retryLimits).toEqual([2, 0]);
    expect(completed[0]?.summary.operations).toMatchObject({
      total: 2,
      failed: 0,
    });
  });

  it("never automatically retries an ambiguous write failure", async () => {
    const completed: CompleteProvisioningRunInput[] = [];
    let lookupCalls = 0;
    let createCalls = 0;
    const targetEnvironment: ProvisioningWorkflowEnvironment = {
      async prepareProvisioningRun() {
        return prepared;
      },
      async executeProvisioningOperation(input) {
        if (input.operation.request.method === "GET") {
          lookupCalls += 1;
          return {
            response: emptyLookup,
            receivedAtEpochMs: Date.parse("2026-07-22T12:00:02.000Z"),
          };
        }
        createCalls += 1;
        throw new Error("synthetic lost write response");
      },
      async completeProvisioningRun(input) {
        completed.push(input);
        return {
          ...prepared.run,
          status: input.summary.status,
          completedAt: input.summary.completedAt,
        } as ProvisioningRun;
      },
      async failProvisioningRun() {
        throw new Error("The write failure should produce a partial summary.");
      },
    };
    const step = new RetryingStep();
    const result = await runProvisioningWorkflow(params, targetEnvironment, step);

    expect(result.status).toBe("partial");
    expect(lookupCalls).toBe(1);
    expect(createCalls).toBe(1);
    expect(step.retryLimits).toEqual([2, 0]);
    expect(completed[0]?.summary.operations).toEqual({
      total: 2,
      succeeded: 1,
      failed: 1,
      retried: 0,
    });
  });

  it("keeps prior interpretations when a later operation exhausts transport retries", async () => {
    const twoUserPrepared: PreparedProvisioningRun = {
      ...prepared,
      snapshot: {
        ...prepared.snapshot,
        users: [
          ...prepared.snapshot.users,
          {
            resourceType: "User",
            id: "user-2",
            userName: "grace@example.com",
            displayName: "Grace Hopper",
            active: true,
            deleted: false,
            version: 1,
          },
        ],
      },
    };
    const completed: CompleteProvisioningRunInput[] = [];
    let failedLookupCalls = 0;
    const targetEnvironment: ProvisioningWorkflowEnvironment = {
      async prepareProvisioningRun() {
        return twoUserPrepared;
      },
      async executeProvisioningOperation(input) {
        if (input.operation.sourceId === "user-2") {
          failedLookupCalls += 1;
          throw new Error("synthetic transport outage");
        }
        return {
          response:
            input.operation.action === "lookup"
              ? emptyLookup
              : {
                  status: 201,
                  headers: {},
                  body: { id: "target-user-1" },
                },
          receivedAtEpochMs: Date.parse("2026-07-22T12:00:02.000Z"),
        };
      },
      async completeProvisioningRun(input) {
        completed.push(input);
        return {
          ...twoUserPrepared.run,
          status: input.summary.status,
          completedAt: input.summary.completedAt,
        } as ProvisioningRun;
      },
      async failProvisioningRun() {
        throw new Error("The transport failure should produce a partial summary.");
      },
    };
    const result = await runProvisioningWorkflow(
      params,
      targetEnvironment,
      new RetryingStep()
    );

    expect(result.status).toBe("partial");
    expect(failedLookupCalls).toBe(3);
    expect(completed[0]?.watermark.users).toEqual([
      expect.objectContaining({
        sourceId: "user-1",
        targetId: "target-user-1",
      }),
    ]);
  });

  it("rejects an oversized worst-case plan before the first HTTP operation", async () => {
    const oversized: PreparedProvisioningRun = {
      ...prepared,
      snapshot: {
        cursor: "snapshot-oversized",
        groups: [],
        users: Array.from(
          { length: MAX_PROVISIONING_INITIAL_OPERATIONS + 1 },
          (_, index) => ({
            resourceType: "User" as const,
            id: `user-${index}`,
            userName: `user-${String(index).padStart(3, "0")}@example.com`,
            displayName: `User ${index}`,
            active: true,
            deleted: false,
            version: 1,
          })
        ),
      },
    };
    let executions = 0;
    let failures = 0;
    const targetEnvironment: ProvisioningWorkflowEnvironment = {
      async prepareProvisioningRun() {
        return oversized;
      },
      async executeProvisioningOperation() {
        executions += 1;
        throw new Error("HTTP must not run for an oversized plan.");
      },
      async completeProvisioningRun() {
        throw new Error("An oversized plan must not complete.");
      },
      async failProvisioningRun() {
        failures += 1;
        return {
          ...oversized.run,
          status: "failed",
          startedAt: "2026-07-22T12:00:01.000Z",
          completedAt: "2026-07-22T12:00:02.000Z",
        };
      },
    };

    const result = await runProvisioningWorkflow(
      params,
      targetEnvironment,
      new ImmediateStep()
    );
    expect(result.status).toBe("failed");
    expect(executions).toBe(0);
    expect(failures).toBe(1);
  });

  it("replays cached Workflow steps without repeating outbound execution", async () => {
    const executions: ExecuteProvisioningOperationInput[] = [];
    const completed: CompleteProvisioningRunInput[] = [];
    const targetEnvironment = environment(
      [emptyLookup, created],
      executions,
      completed
    );
    const step = new CachingStep();

    await runProvisioningWorkflow(params, targetEnvironment, step);
    await runProvisioningWorkflow(params, targetEnvironment, step);

    expect(executions).toHaveLength(2);
    expect(completed).toHaveLength(1);
  });
});
