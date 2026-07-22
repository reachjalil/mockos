import type {
  ProvisioningRun,
  ProvisioningWorkflowParams,
  RunProvisioningCycleToolInput,
} from "@mockos/contracts";

export type ProvisioningWorkflowStartBinding = {
  create(options: { id: string; params: ProvisioningWorkflowParams }): Promise<unknown>;
  get(id: string): Promise<{
    status(): Promise<{
      status:
        | "queued"
        | "running"
        | "paused"
        | "errored"
        | "terminated"
        | "complete"
        | "waiting"
        | "waitingForPause"
        | "unknown";
    }>;
  }>;
};

export type ProvisioningStartEnvironment = {
  getProvisioningRun(runId: string): Promise<ProvisioningRun | undefined>;
  reconcileTerminalProvisioningWorkflow(
    runId: string,
    workflowStatus: ProvisioningTerminalWorkflowStatus
  ): Promise<ProvisioningTerminalReconciliationResult>;
  compensateProvisioningRun(
    runId: string,
    message: string
  ): Promise<ProvisioningCompensationResult>;
};

export type ProvisioningCompensationResult =
  | { readonly outcome: "compensated"; readonly run: ProvisioningRun }
  | { readonly outcome: "missing" }
  | { readonly outcome: "preserved"; readonly run: ProvisioningRun };

export type ProvisioningTerminalWorkflowStatus = "complete" | "errored" | "terminated";

export type ProvisioningTerminalReconciliationResult =
  | { readonly outcome: "failed"; readonly run: ProvisioningRun }
  | { readonly outcome: "missing" }
  | { readonly outcome: "preserved"; readonly run: ProvisioningRun };

export type ProvisioningQueueEnvironment = ProvisioningStartEnvironment & {
  queueProvisioningRun(
    params: ProvisioningWorkflowParams,
    target: RunProvisioningCycleToolInput["target"]
  ): Promise<ProvisioningRun>;
  getActiveProvisioningRun(
    applicationId: string,
    targetRef: string
  ): Promise<ProvisioningRun | undefined>;
  revalidateActiveProvisioningRun(
    params: ProvisioningWorkflowParams,
    target: RunProvisioningCycleToolInput["target"]
  ): Promise<ProvisioningRun>;
};

export class ProvisioningWorkflowStartError extends Error {
  readonly code = "PROVISIONING_WORKFLOW_START_FAILED";

  constructor(options?: ErrorOptions) {
    super("Provisioning Workflow instance could not be started.", options);
    this.name = "ProvisioningWorkflowStartError";
  }
}

export class ProvisioningWorkflowReconciliationError extends Error {
  readonly code = "PROVISIONING_WORKFLOW_RECONCILIATION_FAILED";

  constructor(options?: ErrorOptions) {
    super("Provisioning Workflow instance state could not be reconciled.", options);
    this.name = "ProvisioningWorkflowReconciliationError";
  }
}

type ProvisioningWorkflowStatus = Awaited<
  ReturnType<Awaited<ReturnType<ProvisioningWorkflowStartBinding["get"]>>["status"]>
>["status"];

const terminalWorkflowStatuses = new Set<ProvisioningTerminalWorkflowStatus>([
  "complete",
  "errored",
  "terminated",
]);

const liveWorkflowStatuses = new Set<ProvisioningWorkflowStatus>([
  "queued",
  "running",
  "paused",
  "waiting",
  "waitingForPause",
]);

const isTerminalWorkflowStatus = (
  status: ProvisioningWorkflowStatus
): status is ProvisioningTerminalWorkflowStatus =>
  terminalWorkflowStatuses.has(status as ProvisioningTerminalWorkflowStatus);

const sameRunMetadata = (
  candidate: ProvisioningRun,
  expected: ProvisioningRun
): boolean =>
  candidate.id === expected.id &&
  candidate.envId === expected.envId &&
  candidate.appId === expected.appId &&
  candidate.provider === expected.provider &&
  candidate.mode === expected.mode &&
  candidate.targetRef === expected.targetRef &&
  candidate.createdAt === expected.createdAt;

const isTerminalRun = (run: ProvisioningRun): boolean =>
  run.status === "succeeded" || run.status === "partial" || run.status === "failed";

const requireExactRun = (
  candidate: ProvisioningRun | undefined,
  expected: ProvisioningRun
): ProvisioningRun => {
  if (!candidate || !sameRunMetadata(candidate, expected)) {
    throw new ProvisioningWorkflowReconciliationError();
  }
  return candidate;
};

const finalizeTerminalWorkflow = async (input: {
  readonly environment: ProvisioningStartEnvironment;
  readonly run: ProvisioningRun;
  readonly status: ProvisioningTerminalWorkflowStatus;
}): Promise<ProvisioningRun> => {
  try {
    const result = await input.environment.reconcileTerminalProvisioningWorkflow(
      input.run.id,
      input.status
    );
    if (
      result.outcome === "failed" &&
      result.run.status === "failed" &&
      sameRunMetadata(result.run, input.run)
    ) {
      return result.run;
    }
    if (
      result.outcome === "preserved" &&
      isTerminalRun(result.run) &&
      sameRunMetadata(result.run, input.run)
    ) {
      return result.run;
    }
  } catch (error) {
    if (error instanceof ProvisioningWorkflowReconciliationError) throw error;
    throw new ProvisioningWorkflowReconciliationError({ cause: error });
  }
  throw new ProvisioningWorkflowReconciliationError();
};

const reconcileExistingWorkflow = async (input: {
  readonly workflow: ProvisioningWorkflowStartBinding;
  readonly environment: ProvisioningStartEnvironment;
  readonly run: ProvisioningRun;
}): Promise<ProvisioningRun> => {
  let status: ProvisioningWorkflowStatus;
  try {
    const result = await (await input.workflow.get(input.run.id)).status();
    status = result.status;
  } catch (error) {
    throw new ProvisioningWorkflowReconciliationError({ cause: error });
  }
  if (status === "unknown") {
    throw new ProvisioningWorkflowReconciliationError();
  }
  if (isTerminalWorkflowStatus(status)) {
    return finalizeTerminalWorkflow({
      environment: input.environment,
      run: input.run,
      status,
    });
  }
  if (!liveWorkflowStatuses.has(status)) {
    throw new ProvisioningWorkflowReconciliationError();
  }
  try {
    return requireExactRun(
      await input.environment.getProvisioningRun(input.run.id),
      input.run
    );
  } catch (error) {
    throw new ProvisioningWorkflowReconciliationError({ cause: error });
  }
};

/**
 * Starts a Workflow and reconciles an ambiguous create failure by fixed ID.
 * Cleanup is performed only after the binding positively reports no instance.
 */
export const createProvisioningWorkflowInstance = async (input: {
  readonly workflow: ProvisioningWorkflowStartBinding;
  readonly environment: ProvisioningStartEnvironment;
  readonly params: ProvisioningWorkflowParams;
  readonly queuedRun: ProvisioningRun;
}): Promise<ProvisioningRun> => {
  try {
    await input.workflow.create({
      id: input.params.runId,
      params: input.params,
    });
    return input.queuedRun;
  } catch (createError) {
    let instance: Awaited<ReturnType<ProvisioningWorkflowStartBinding["get"]>>;
    try {
      instance = await input.workflow.get(input.params.runId);
    } catch (getError) {
      // A binding failure is not proof of absence. Preserve staged credentials
      // because create may have committed before either response was lost.
      throw new ProvisioningWorkflowReconciliationError({ cause: getError });
    }
    let status: Awaited<ReturnType<typeof instance.status>>;
    try {
      status = await instance.status();
    } catch (statusError) {
      // A handle proves the fixed-ID instance exists. Preserve its target and
      // run even when status retrieval is transiently unavailable.
      throw new ProvisioningWorkflowReconciliationError({ cause: statusError });
    }
    if (status.status === "unknown") {
      let compensation: ProvisioningCompensationResult;
      try {
        compensation = await input.environment.compensateProvisioningRun(
          input.params.runId,
          "Provisioning Workflow instance creation failed."
        );
      } catch (compensationError) {
        throw new ProvisioningWorkflowReconciliationError({
          cause: compensationError,
        });
      }
      if (compensation.outcome === "preserved") {
        if (
          sameRunMetadata(compensation.run, input.queuedRun) &&
          (compensation.run.status === "queued" ||
            compensation.run.status === "running")
        ) {
          return compensation.run;
        }
        throw new ProvisioningWorkflowReconciliationError();
      }
      throw new ProvisioningWorkflowStartError({ cause: createError });
    }
    if (isTerminalWorkflowStatus(status.status)) {
      return finalizeTerminalWorkflow({
        environment: input.environment,
        run: input.queuedRun,
        status: status.status,
      });
    }
    if (!liveWorkflowStatuses.has(status.status)) {
      throw new ProvisioningWorkflowReconciliationError();
    }
    try {
      return requireExactRun(
        await input.environment.getProvisioningRun(input.params.runId),
        input.queuedRun
      );
    } catch (getError) {
      throw new ProvisioningWorkflowReconciliationError({ cause: getError });
    }
  }
};

const errorCode = (error: unknown): unknown =>
  error && typeof error === "object" && "code" in error
    ? Reflect.get(error, "code")
    : undefined;

/**
 * Queues a new run, or safely resumes the fixed Workflow ID of an exact queued
 * retry. Replaying the queue call revalidates frozen target metadata and the
 * credential without exposing either through this recovery surface.
 */
export const queueAndCreateProvisioningWorkflowInstance = async (input: {
  readonly workflow: ProvisioningWorkflowStartBinding;
  readonly environment: ProvisioningQueueEnvironment;
  readonly params: ProvisioningWorkflowParams;
  readonly target: RunProvisioningCycleToolInput["target"];
}): Promise<ProvisioningRun> => {
  let params = input.params;
  let queuedRun: ProvisioningRun;
  try {
    queuedRun = await input.environment.queueProvisioningRun(params, input.target);
  } catch (queueError) {
    if (errorCode(queueError) !== "ACTIVE_PROVISIONING_RUN") throw queueError;
    const active = await input.environment.getActiveProvisioningRun(
      params.appId,
      params.targetRef
    );
    if (!active || active.mode !== params.mode) {
      throw queueError;
    }
    params = {
      envId: active.envId,
      appId: active.appId,
      runId: active.id,
      mode: active.mode,
      targetRef: active.targetRef,
    };
    if (active.status === "running") {
      try {
        const validated = await input.environment.revalidateActiveProvisioningRun(
          params,
          input.target
        );
        return reconcileExistingWorkflow({
          workflow: input.workflow,
          environment: input.environment,
          run: validated,
        });
      } catch (error) {
        if (error instanceof ProvisioningWorkflowReconciliationError) throw error;
        throw queueError;
      }
    }
    if (active.status !== "queued") throw queueError;
    try {
      queuedRun = await input.environment.queueProvisioningRun(params, input.target);
    } catch {
      // Do not reveal whether frozen metadata or credentials differed.
      throw queueError;
    }
  }
  if (isTerminalRun(queuedRun)) return queuedRun;
  return createProvisioningWorkflowInstance({
    workflow: input.workflow,
    environment: input.environment,
    params,
    queuedRun,
  });
};
