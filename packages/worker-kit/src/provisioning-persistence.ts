import {
  type ProviderId,
  type ProvisioningHttpOperation,
  type ProvisioningHttpResponse,
  type ProvisioningRun,
  type ProvisioningSummary,
  type ProvisioningTarget,
  type ProvisioningTargetInput,
  type ProvisioningWatermark,
  type ProvisioningWorkflowParams,
  provisioningHttpOperationSchema,
  provisioningHttpResponseSchema,
  provisioningRunSchema,
  provisioningSummarySchema,
  provisioningTargetInputSchema,
  provisioningTargetSchema,
  provisioningWatermarkSchema,
  provisioningWorkflowParamsSchema,
} from "@mockos/contracts";
import type { SqlRow, SqlStore } from "@mockos/core";

type TargetRow = SqlRow & {
  target_json: string;
  credential_secret: string | null;
};

type RunTargetRow = TargetRow & { target_ref: string };

type RunRow = SqlRow & {
  id: string;
  status: string;
  summary_json: string | null;
};

type StepRow = SqlRow & {
  operation_json: string;
  result_json: string | null;
};

type WatermarkRow = SqlRow & { watermark_json: string };

export type StoredTargetSelector =
  | { readonly kind: "saved" }
  | { readonly kind: "inline"; readonly save: boolean };

type StoredRunState = {
  run: ProvisioningRun;
  targetSelector?: StoredTargetSelector;
  summary?: ProvisioningSummary;
  failureMessage?: string;
};

export type ResolvedProvisioningTarget = {
  readonly target: ProvisioningTarget;
  /** Environment-DO-private. Never return this across an RPC boundary. */
  readonly bearerToken?: string;
};

export type StoredProvisioningExecution = {
  readonly response: ProvisioningHttpResponse;
  readonly log: {
    readonly id: string;
    readonly timestamp: string;
    readonly method: string;
    readonly path: string;
    readonly requestHeaders: Readonly<Record<string, string>>;
    readonly requestBody: string | null;
    readonly responseStatus: number;
    readonly responseHeaders: Readonly<Record<string, string>>;
    readonly responseBody: string | null;
    readonly durationMs: number;
    readonly correlationId: string;
  };
};

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error(`Stored provisioning ${label} is invalid JSON.`, { cause });
  }
};

const parseStoredTargetSelector = (value: unknown): StoredTargetSelector => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored provisioning target selector is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "saved" && Object.keys(record).length === 1) {
    return { kind: "saved" };
  }
  if (
    record.kind === "inline" &&
    typeof record.save === "boolean" &&
    Object.keys(record).length === 2
  ) {
    return { kind: "inline", save: record.save };
  }
  throw new Error("Stored provisioning target selector is invalid.");
};

const parseRunState = (row: RunRow): StoredRunState => {
  if (!row.summary_json) {
    throw new Error(`Provisioning run '${row.id}' has no state document.`);
  }
  const parsed = parseJson(row.summary_json, "run state");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Provisioning run '${row.id}' has invalid state.`);
  }
  const record = parsed as Record<string, unknown>;
  const run = provisioningRunSchema.parse(record.run);
  if (run.id !== row.id || run.status !== row.status) {
    throw new Error(`Provisioning run '${row.id}' state is inconsistent.`);
  }
  return {
    run,
    ...(record.targetSelector === undefined
      ? {}
      : { targetSelector: parseStoredTargetSelector(record.targetSelector) }),
    ...(record.summary === undefined
      ? {}
      : { summary: provisioningSummarySchema.parse(record.summary) }),
    ...(typeof record.failureMessage === "string"
      ? { failureMessage: record.failureMessage }
      : {}),
  };
};

const sameRunIdentity = (
  run: ProvisioningRun,
  params: ProvisioningWorkflowParams,
  provider: ProviderId
) =>
  run.id === params.runId &&
  run.envId === params.envId &&
  run.appId === params.appId &&
  run.provider === provider &&
  run.mode === params.mode &&
  run.targetRef === params.targetRef;

const credential = (input: ProvisioningTargetInput) => {
  if (input.auth.kind === "none") {
    return {
      safeAuth: { kind: "none" } as const,
      credentialRef: null,
      credentialSecret: null,
    };
  }
  const credentialRef = `credential_${crypto.randomUUID()}`;
  return {
    safeAuth: { kind: "bearer", credentialRef } as const,
    credentialRef,
    credentialSecret: input.auth.token,
  };
};

const safeTarget = (
  input: ProvisioningTargetInput,
  safeAuth: ProvisioningTarget["auth"]
): ProvisioningTarget =>
  provisioningTargetSchema.parse({
    ref: input.ref,
    baseUrl: input.baseUrl,
    auth: safeAuth,
    behavior: input.behavior,
  });

const terminal = (status: ProvisioningRun["status"]) =>
  status === "succeeded" || status === "partial" || status === "failed";

const sameSecret = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export class ActiveProvisioningRunError extends Error {
  readonly code = "ACTIVE_PROVISIONING_RUN";

  constructor() {
    super("An active provisioning run already exists for this application and target.");
    this.name = "ActiveProvisioningRunError";
  }
}

/** SQLite persistence owned by one Environment Durable Object. */
export class ProvisioningPersistence {
  readonly #store: SqlStore;

  constructor(store: SqlStore) {
    this.#store = store;
  }

  saveTarget(rawInput: ProvisioningTargetInput, now: string): ProvisioningTarget {
    const input = provisioningTargetInputSchema.parse(rawInput);
    const nextCredential = credential(input);
    const target = safeTarget(input, nextCredential.safeAuth);
    this.#store.run(
      `INSERT INTO provisioning_targets (
        target_ref, target_json, credential_ref, credential_secret,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_ref) DO UPDATE SET
        target_json = excluded.target_json,
        credential_ref = excluded.credential_ref,
        credential_secret = excluded.credential_secret,
        updated_at = excluded.updated_at`,
      target.ref,
      JSON.stringify(target),
      nextCredential.credentialRef,
      nextCredential.credentialSecret,
      now,
      now
    );
    return target;
  }

  stageTarget(
    runId: string,
    rawInput: ProvisioningTargetInput,
    now: string
  ): ProvisioningTarget {
    const input = provisioningTargetInputSchema.parse(rawInput);
    const existingRow = this.#runTargetRow(runId);
    if (existingRow) return this.revalidateInlineTarget(runId, input);
    const nextCredential = credential(input);
    const target = safeTarget(input, nextCredential.safeAuth);
    const result = this.#store.run(
      `INSERT OR IGNORE INTO provisioning_run_targets (
        run_id, target_ref, target_json, credential_ref, credential_secret,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      runId,
      target.ref,
      JSON.stringify(target),
      nextCredential.credentialRef,
      nextCredential.credentialSecret,
      now
    );
    if (result.changes !== 1) return this.stageTarget(runId, input, now);
    return target;
  }

  stageSavedTarget(runId: string, targetRef: string, now: string): ProvisioningTarget {
    const existing = this.#runTargetRow(runId);
    if (existing) return this.revalidateSavedTarget(runId, targetRef);
    this.resolveTarget(targetRef);
    const result = this.#store.run(
      `INSERT OR IGNORE INTO provisioning_run_targets (
        run_id, target_ref, target_json, credential_ref, credential_secret,
        created_at
      ) SELECT ?, target_ref, target_json, credential_ref, credential_secret, ?
        FROM provisioning_targets WHERE target_ref = ?`,
      runId,
      now,
      targetRef
    );
    if (result.changes !== 1) {
      return this.resolveTarget(targetRef, runId).target;
    }
    return this.resolveTarget(targetRef, runId).target;
  }

  revalidateInlineTarget(
    runId: string,
    rawInput: ProvisioningTargetInput
  ): ProvisioningTarget {
    const input = provisioningTargetInputSchema.parse(rawInput);
    const existingRow = this.#runTargetRow(runId);
    if (!existingRow) {
      throw new Error(`Provisioning run '${runId}' has no staged target.`);
    }
    const existing = provisioningTargetSchema.parse(
      parseJson(existingRow.target_json, "run target")
    );
    const sameMetadata =
      existing.ref === input.ref &&
      existing.baseUrl === input.baseUrl &&
      JSON.stringify(existing.behavior) === JSON.stringify(input.behavior) &&
      existing.auth.kind === input.auth.kind;
    const sameCredential =
      input.auth.kind === "none"
        ? existingRow.credential_secret === null
        : typeof existingRow.credential_secret === "string" &&
          sameSecret(existingRow.credential_secret, input.auth.token);
    if (!sameMetadata || !sameCredential) {
      throw new Error(`Provisioning run '${runId}' target cannot be replaced.`);
    }
    return existing;
  }

  revalidateSavedTarget(runId: string, targetRef: string): ProvisioningTarget {
    const existing = this.#runTargetRow(runId);
    if (!existing || existing.target_ref !== targetRef) {
      throw new Error(`Provisioning run '${runId}' target cannot be replaced.`);
    }
    return provisioningTargetSchema.parse(
      parseJson(existing.target_json, "run target")
    );
  }

  #targetRow(targetRef: string, runId?: string): TargetRow | undefined {
    if (runId) {
      return this.#store.get<TargetRow>(
        `SELECT target_json, credential_secret
         FROM provisioning_run_targets
         WHERE run_id = ? AND target_ref = ?`,
        runId,
        targetRef
      );
    }
    return this.#store.get<TargetRow>(
      `SELECT target_json, credential_secret
       FROM provisioning_targets WHERE target_ref = ?`,
      targetRef
    );
  }

  #runTargetRow(runId: string): RunTargetRow | undefined {
    return this.#store.get<RunTargetRow>(
      `SELECT target_ref, target_json, credential_secret
       FROM provisioning_run_targets WHERE run_id = ?`,
      runId
    );
  }

  resolveTarget(targetRef: string, runId?: string): ResolvedProvisioningTarget {
    const row = this.#targetRow(targetRef, runId);
    if (!row) throw new Error(`Unknown provisioning target '${targetRef}'.`);
    const target = provisioningTargetSchema.parse(parseJson(row.target_json, "target"));
    if (target.ref !== targetRef) {
      throw new Error(`Provisioning target '${targetRef}' is inconsistent.`);
    }
    if (target.auth.kind === "bearer" && !row.credential_secret) {
      throw new Error(`Provisioning target '${targetRef}' has no credential.`);
    }
    if (target.auth.kind === "none" && row.credential_secret !== null) {
      throw new Error(`Provisioning target '${targetRef}' has unexpected credentials.`);
    }
    return {
      target,
      ...(row.credential_secret ? { bearerToken: row.credential_secret } : {}),
    };
  }

  deleteStagedTarget(runId: string): void {
    this.#store.run("DELETE FROM provisioning_run_targets WHERE run_id = ?", runId);
  }

  deleteExecutions(runId: string): void {
    this.#store.run("DELETE FROM provisioning_steps WHERE run_id = ?", runId);
  }

  queueRun(
    rawParams: ProvisioningWorkflowParams,
    provider: ProviderId,
    now: string,
    targetSelector: StoredTargetSelector
  ): ProvisioningRun {
    const params = provisioningWorkflowParamsSchema.parse(rawParams);
    const existing = this.getRun(params.runId);
    if (existing) {
      if (!sameRunIdentity(existing, params, provider)) {
        throw new Error(`Provisioning run '${params.runId}' cannot be reused.`);
      }
      const existingSelector = this.#requireRunState(params.runId).targetSelector;
      if (JSON.stringify(existingSelector) !== JSON.stringify(targetSelector)) {
        throw new Error(
          `Provisioning run '${params.runId}' target cannot be replaced.`
        );
      }
      return existing;
    }
    const run = provisioningRunSchema.parse({
      id: params.runId,
      envId: params.envId,
      appId: params.appId,
      provider,
      mode: params.mode,
      targetRef: params.targetRef,
      status: "queued",
      createdAt: now,
    });
    const result = this.#store.run(
      `INSERT OR IGNORE INTO provisioning_runs (
        id, application_id, target_ref, mode, status, summary_json,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      run.id,
      run.appId,
      run.targetRef,
      run.mode,
      run.status,
      JSON.stringify({ run, targetSelector } satisfies StoredRunState),
      run.createdAt
    );
    if (result.changes !== 1) {
      const raced = this.getRun(run.id);
      if (raced && sameRunIdentity(raced, params, provider)) {
        const racedSelector = this.#requireRunState(run.id).targetSelector;
        if (JSON.stringify(racedSelector) !== JSON.stringify(targetSelector)) {
          throw new Error(
            `Provisioning run '${params.runId}' target cannot be replaced.`
          );
        }
        return raced;
      }
      const activeConflict = this.#store.get<{ id: string }>(
        `SELECT id FROM provisioning_runs
         WHERE application_id = ? AND target_ref = ?
           AND status IN ('queued', 'running')
         LIMIT 1`,
        run.appId,
        run.targetRef
      );
      if (activeConflict) throw new ActiveProvisioningRunError();
      if (!raced || !sameRunIdentity(raced, params, provider)) {
        throw new Error(`Provisioning run '${params.runId}' cannot be reused.`);
      }
      return raced;
    }
    return run;
  }

  getRun(runId: string): ProvisioningRun | undefined {
    const row = this.#store.get<RunRow>(
      "SELECT id, status, summary_json FROM provisioning_runs WHERE id = ?",
      runId
    );
    return row ? parseRunState(row).run : undefined;
  }

  getActiveRun(applicationId: string, targetRef: string): ProvisioningRun | undefined {
    const row = this.#store.get<RunRow>(
      `SELECT id, status, summary_json FROM provisioning_runs
       WHERE application_id = ? AND target_ref = ?
         AND status IN ('queued', 'running')
       ORDER BY created_at ASC
       LIMIT 1`,
      applicationId,
      targetRef
    );
    return row ? parseRunState(row).run : undefined;
  }

  getRunTargetSelector(runId: string): StoredTargetSelector | undefined {
    return this.#requireRunState(runId).targetSelector;
  }

  startRun(runId: string, now: string): ProvisioningRun {
    const current = this.#requireRunState(runId);
    if (current.run.status === "running") return current.run;
    if (terminal(current.run.status)) {
      throw new Error(`Provisioning run '${runId}' is already complete.`);
    }
    const run = provisioningRunSchema.parse({
      ...current.run,
      status: "running",
      startedAt: current.run.startedAt ?? now,
    });
    this.#writeRunState({ ...current, run });
    return run;
  }

  completeRun(runId: string, rawSummary: ProvisioningSummary): ProvisioningRun {
    const summary = provisioningSummarySchema.parse(rawSummary);
    if (summary.runId !== runId) {
      throw new Error("Provisioning summary and run identifiers must match.");
    }
    const current = this.#requireRunState(runId);
    if (terminal(current.run.status)) {
      if (
        current.summary &&
        JSON.stringify(current.summary) === JSON.stringify(summary)
      ) {
        return current.run;
      }
      throw new Error(`Provisioning run '${runId}' has already been finalized.`);
    }
    const run = provisioningRunSchema.parse({
      ...current.run,
      status: summary.status,
      startedAt: current.run.startedAt ?? summary.startedAt,
      completedAt: summary.completedAt,
    });
    this.#writeRunState({ run, summary });
    return run;
  }

  failRun(runId: string, message: string, now: string): ProvisioningRun {
    const current = this.#requireRunState(runId);
    if (terminal(current.run.status)) return current.run;
    const run = provisioningRunSchema.parse({
      ...current.run,
      status: "failed",
      startedAt: current.run.startedAt ?? now,
      completedAt: now,
    });
    this.#writeRunState({
      ...current,
      run,
      failureMessage: message.slice(0, 2_048),
    });
    return run;
  }

  #requireRunState(runId: string): StoredRunState {
    const row = this.#store.get<RunRow>(
      "SELECT id, status, summary_json FROM provisioning_runs WHERE id = ?",
      runId
    );
    if (!row) throw new Error(`Unknown provisioning run '${runId}'.`);
    return parseRunState(row);
  }

  #writeRunState(state: StoredRunState): void {
    const result = this.#store.run(
      `UPDATE provisioning_runs
       SET status = ?, summary_json = ?, completed_at = ?
       WHERE id = ?`,
      state.run.status,
      JSON.stringify(state),
      state.run.completedAt ?? null,
      state.run.id
    );
    if (result.changes !== 1) {
      throw new Error(`Provisioning run '${state.run.id}' could not be updated.`);
    }
  }

  getSummary(runId: string): ProvisioningSummary | undefined {
    return this.#requireRunState(runId).summary;
  }

  readExecution(
    runId: string,
    stepSequence: number,
    operation: ProvisioningHttpOperation
  ): StoredProvisioningExecution | undefined {
    const parsedOperation = provisioningHttpOperationSchema.parse(operation);
    const row = this.#store.get<StepRow>(
      `SELECT operation_json, result_json FROM provisioning_steps
       WHERE run_id = ? AND sequence = ?`,
      runId,
      stepSequence
    );
    if (!row) return undefined;
    if (row.operation_json !== JSON.stringify(parsedOperation)) {
      throw new Error(
        `Provisioning step ${stepSequence} cannot be reused for another operation.`
      );
    }
    if (!row.result_json) return undefined;
    const result = parseJson(row.result_json, "step result");
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Stored provisioning step result is invalid.");
    }
    const record = result as Record<string, unknown>;
    const log = record.log;
    if (!log || typeof log !== "object" || Array.isArray(log)) {
      throw new Error("Stored provisioning step log is invalid.");
    }
    return {
      response: provisioningHttpResponseSchema.parse(record.response),
      log: log as StoredProvisioningExecution["log"],
    };
  }

  beginExecution(
    runId: string,
    stepSequence: number,
    operation: ProvisioningHttpOperation,
    now: string
  ): void {
    const parsedOperation = provisioningHttpOperationSchema.parse(operation);
    const id = `${runId}:execute:${stepSequence}`;
    const result = this.#store.run(
      `INSERT OR IGNORE INTO provisioning_steps (
        id, run_id, sequence, operation_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?)`,
      id,
      runId,
      stepSequence,
      JSON.stringify(parsedOperation),
      now
    );
    if (result.changes !== 1) {
      this.readExecution(runId, stepSequence, parsedOperation);
    }
  }

  finishExecution(
    runId: string,
    stepSequence: number,
    operation: ProvisioningHttpOperation,
    result: StoredProvisioningExecution
  ): StoredProvisioningExecution {
    this.beginExecution(runId, stepSequence, operation, result.log.timestamp);
    this.#store.run(
      `UPDATE provisioning_steps SET result_json = ?
       WHERE run_id = ? AND sequence = ? AND result_json IS NULL`,
      JSON.stringify(result),
      runId,
      stepSequence
    );
    const stored = this.readExecution(runId, stepSequence, operation);
    if (!stored) {
      throw new Error(`Provisioning step ${stepSequence} could not be persisted.`);
    }
    return stored;
  }

  getWatermark(applicationId: string, targetRef: string): ProvisioningWatermark {
    const row = this.#store.get<WatermarkRow>(
      `SELECT watermark_json FROM provisioning_watermarks
       WHERE application_id = ? AND target_ref = ?`,
      applicationId,
      targetRef
    );
    return row
      ? provisioningWatermarkSchema.parse(parseJson(row.watermark_json, "watermark"))
      : provisioningWatermarkSchema.parse({});
  }

  saveWatermark(
    applicationId: string,
    targetRef: string,
    rawWatermark: ProvisioningWatermark,
    now: string
  ): ProvisioningWatermark {
    const watermark = provisioningWatermarkSchema.parse(rawWatermark);
    this.#store.run(
      `INSERT INTO provisioning_watermarks (
        application_id, target_ref, watermark_json, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(application_id, target_ref) DO UPDATE SET
        watermark_json = excluded.watermark_json,
        updated_at = excluded.updated_at`,
      applicationId,
      targetRef,
      JSON.stringify(watermark),
      now
    );
    return watermark;
  }
}
