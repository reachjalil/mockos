import {
  type ProvisioningInterpretation,
  type ProvisioningOp,
  type ProvisioningRun,
  type ProvisioningSummary,
  type ProvisioningWatermark,
  type ProvisioningWatermarkMutation,
  type ProvisioningWorkflowParams,
  provisioningWatermarkSchema,
  provisioningWorkflowParamsSchema,
} from "@mockos/contracts";
import { interpretProvisioningResponse, planProvisioning } from "@mockos/core";
import type {
  CompleteProvisioningRunInput,
  ExecuteProvisioningOperationInput,
  ExecuteProvisioningOperationResult,
  PreparedProvisioningRun,
} from "./environment-do";

export const MAX_PROVISIONING_HTTP_EXECUTIONS = 250;
const MAX_OUTBOUND_ATTEMPTS_PER_SOURCE_OPERATION = 15;
export const MAX_PROVISIONING_INITIAL_OPERATIONS = Math.floor(
  MAX_PROVISIONING_HTTP_EXECUTIONS / MAX_OUTBOUND_ATTEMPTS_PER_SOURCE_OPERATION
);
export const MAX_PROVISIONING_PLAN_BYTES = 512 * 1_024;

export type ProvisioningWorkflowStep = {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
  do<T>(
    name: string,
    config: {
      retries: {
        limit: number;
        delay: number;
        backoff: "exponential";
      };
      timeout: number;
    },
    callback: () => Promise<T>
  ): Promise<T>;
  sleep(name: string, duration: number): Promise<void>;
};

export type ProvisioningWorkflowEnvironment = {
  prepareProvisioningRun(
    params: ProvisioningWorkflowParams
  ): Promise<PreparedProvisioningRun>;
  executeProvisioningOperation(
    input: ExecuteProvisioningOperationInput
  ): Promise<ExecuteProvisioningOperationResult>;
  completeProvisioningRun(
    input: CompleteProvisioningRunInput
  ): Promise<ProvisioningRun>;
  failProvisioningRun(
    runId: string,
    message: string
  ): Promise<ProvisioningRun | undefined>;
};

const applyWatermarkMutation = (
  current: ProvisioningWatermark,
  mutation: ProvisioningWatermarkMutation | undefined
): ProvisioningWatermark => {
  if (!mutation) return current;
  const resourceType =
    mutation.action === "upsert" ? mutation.entry.resourceType : mutation.resourceType;
  if (resourceType === "User") {
    const users = current.users.filter(
      (entry) =>
        entry.sourceId !==
        (mutation.action === "upsert" ? mutation.entry.sourceId : mutation.sourceId)
    );
    if (mutation.action === "upsert") {
      if (mutation.entry.resourceType !== "User") {
        throw new Error("Provisioning user watermark mutation is inconsistent.");
      }
      users.push(mutation.entry);
    }
    return provisioningWatermarkSchema.parse({
      ...current,
      users: users.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    });
  }
  const groups = current.groups.filter(
    (entry) =>
      entry.sourceId !==
      (mutation.action === "upsert" ? mutation.entry.sourceId : mutation.sourceId)
  );
  if (mutation.action === "upsert") {
    if (mutation.entry.resourceType !== "Group") {
      throw new Error("Provisioning group watermark mutation is inconsistent.");
    }
    groups.push(mutation.entry);
  }
  return provisioningWatermarkSchema.parse({
    ...current,
    groups: groups.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  });
};

const stepName = (kind: string, ordinal: number): string =>
  `${kind}-${String(ordinal).padStart(6, "0")}`;

const serializedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const safeFailureMessage = (error: unknown): string => {
  const name =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
      ? error.name
      : "Error";
  return `Provisioning workflow failed (${name}).`;
};

/** Runs one replay-safe provisioning cycle using only safe Workflow outputs. */
export const runProvisioningWorkflow = async (
  rawParams: ProvisioningWorkflowParams,
  environment: ProvisioningWorkflowEnvironment,
  step: ProvisioningWorkflowStep
): Promise<ProvisioningRun> => {
  const params = provisioningWorkflowParamsSchema.parse(rawParams);
  try {
    const prepared = await step.do("prepare", () =>
      environment.prepareProvisioningRun(params)
    );
    const plan = await step.do("plan", async () => {
      const result = planProvisioning({
        provider: prepared.run.provider,
        mode: prepared.run.mode,
        snapshot: prepared.snapshot,
        watermark: prepared.watermark,
        behavior: prepared.target.behavior,
      });
      // A source operation can traverse lookup -> update/deactivate ->
      // create/delete. Each phase can make three explicit 429 attempts, and a
      // safe GET may make three transport attempts. That is a conservative
      // 15 outbound attempts per initial source operation. Reject before I/O.
      if (result.operations.length > MAX_PROVISIONING_INITIAL_OPERATIONS) {
        throw new Error("Provisioning plan exceeds the safe execution limit.");
      }
      if (serializedBytes(result) > MAX_PROVISIONING_PLAN_BYTES) {
        throw new Error("Provisioning plan exceeds the serialized size limit.");
      }
      return result;
    });

    let watermark = prepared.watermark;
    let queue: ProvisioningOp[] = [...plan.operations];
    let executionOrdinal = 0;
    let succeeded = 0;
    let failed = 0;
    let retried = 0;

    while (queue.length > 0) {
      const operation = queue.shift();
      if (!operation) break;
      if (operation.type === "wait") {
        await step.sleep(
          stepName("rate-limit-wait", executionOrdinal + retried + 1),
          operation.delayMs
        );
        continue;
      }
      if (executionOrdinal + 1 > MAX_PROVISIONING_HTTP_EXECUTIONS) {
        throw new Error("Provisioning workflow HTTP execution limit exceeded.");
      }
      executionOrdinal += 1;
      const input: ExecuteProvisioningOperationInput = {
        runId: params.runId,
        targetRef: params.targetRef,
        stepSequence: executionOrdinal,
        operation,
      };
      let interpretation: ProvisioningInterpretation;
      try {
        interpretation = await step.do<ProvisioningInterpretation>(
          stepName("execute", executionOrdinal),
          {
            // Only GET is semantically safe. A write may have committed before
            // a response/RPC failure, so the next cycle must reconcile it.
            retries: {
              limit: operation.request.method === "GET" ? 2 : 0,
              delay: 1_000,
              backoff: "exponential",
            },
            timeout: 30_000,
          },
          async () => {
            const execution = await environment.executeProvisioningOperation(input);
            return interpretProvisioningResponse({
              operation,
              response: execution.response,
              watermark,
              receivedAtEpochMs: execution.receivedAtEpochMs,
            });
          }
        );
      } catch {
        failed += 1;
        continue;
      }
      if (interpretation.outcome === "failed") {
        failed += 1;
      } else if (interpretation.outcome === "retry") {
        retried += 1;
      } else {
        succeeded += 1;
      }
      watermark = applyWatermarkMutation(watermark, interpretation.watermarkMutation);
      queue = [...interpretation.followUpOperations, ...queue];
    }

    const completedAt = await step.do("record-completion-time", async () =>
      new Date().toISOString()
    );
    const startedAt = prepared.run.startedAt ?? prepared.run.createdAt;
    const status: ProvisioningSummary["status"] =
      failed === 0 ? "succeeded" : succeeded === 0 ? "failed" : "partial";
    const summary: ProvisioningSummary = {
      runId: params.runId,
      status,
      operations: {
        total: executionOrdinal,
        succeeded,
        failed,
        retried,
      },
      resources: {
        users: plan.counts.users,
        groups: plan.counts.groups,
      },
      startedAt,
      completedAt,
    };
    const finalWatermark = provisioningWatermarkSchema.parse({
      ...watermark,
      cursor: plan.snapshotCursor,
    });
    return step.do("complete", () =>
      environment.completeProvisioningRun({
        runId: params.runId,
        summary,
        watermark: finalWatermark,
      })
    );
  } catch (error) {
    const failedRun = await environment.failProvisioningRun(
      params.runId,
      safeFailureMessage(error)
    );
    if (failedRun) return failedRun;
    throw new Error("Provisioning workflow could not persist its failed state.");
  }
};
