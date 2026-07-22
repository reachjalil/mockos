import type { ProvisioningRun, ProvisioningWorkflowParams } from "@mockos/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createProvisioningWorkflowInstance,
  type ProvisioningCompensationResult,
  type ProvisioningTerminalReconciliationResult,
  ProvisioningWorkflowReconciliationError,
  ProvisioningWorkflowStartError,
  queueAndCreateProvisioningWorkflowInstance,
} from "./provisioning-start";

const params: ProvisioningWorkflowParams = {
  envId: "env_test01",
  appId: "app-test",
  runId: "run-test",
  mode: "incremental",
  targetRef: "target-app",
};

const queuedRun: ProvisioningRun = {
  id: params.runId,
  envId: params.envId,
  appId: params.appId,
  provider: "entra",
  mode: params.mode,
  targetRef: params.targetRef,
  status: "queued",
  createdAt: "2026-07-22T12:00:00.000Z",
};

const failedRun: ProvisioningRun = {
  ...queuedRun,
  status: "failed",
  startedAt: "2026-07-22T12:00:01.000Z",
  completedAt: "2026-07-22T12:00:01.000Z",
};

const environment = () => ({
  getProvisioningRun: vi.fn(
    async (): Promise<ProvisioningRun | undefined> => queuedRun
  ),
  reconcileTerminalProvisioningWorkflow: vi.fn(
    async (): Promise<ProvisioningTerminalReconciliationResult> => ({
      outcome: "failed",
      run: failedRun,
    })
  ),
  compensateProvisioningRun: vi.fn(
    async (): Promise<ProvisioningCompensationResult> => ({
      outcome: "compensated",
      run: failedRun,
    })
  ),
});

describe("createProvisioningWorkflowInstance", () => {
  it("preserves a run when fixed-ID reconciliation proves create committed", async () => {
    const target = environment();
    const result = await createProvisioningWorkflowInstance({
      workflow: {
        create: vi.fn(async () => {
          throw new Error("create response lost");
        }),
        get: vi.fn(async () => ({
          status: async () => ({ status: "running" as const }),
        })),
      },
      environment: target,
      params,
      queuedRun,
    });
    expect(result).toBe(queuedRun);
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("recovers an indeterminate queued start through an exact same-input retry", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const freshParams = { ...params, runId: "run-fresh-retry" };
    const queueProvisioningRun = vi
      .fn()
      .mockRejectedValueOnce(activeError)
      .mockResolvedValueOnce(queuedRun);
    const target = {
      ...environment(),
      queueProvisioningRun,
      getActiveProvisioningRun: vi.fn(async () => queuedRun),
      revalidateActiveProvisioningRun: vi.fn(async () => queuedRun),
    };
    const create = vi.fn(async () => undefined);
    const result = await queueAndCreateProvisioningWorkflowInstance({
      workflow: {
        create,
        get: vi.fn(async () => ({
          status: async () => ({ status: "unknown" as const }),
        })),
      },
      environment: target,
      params: freshParams,
      target: {
        kind: "inline",
        save: false,
        target: {
          ref: params.targetRef,
          baseUrl: "https://target.example.com/scim/v2",
          auth: { kind: "none" },
          behavior: {},
        },
      },
    });

    expect(result).toBe(queuedRun);
    expect(queueProvisioningRun).toHaveBeenNthCalledWith(2, params, {
      kind: "inline",
      save: false,
      target: {
        ref: params.targetRef,
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "none" },
        behavior: {},
      },
    });
    expect(create).toHaveBeenCalledWith({ id: params.runId, params });
  });

  it("returns a queued retry that races to terminal without recreating Workflow", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const queueProvisioningRun = vi
      .fn()
      .mockRejectedValueOnce(activeError)
      .mockResolvedValueOnce(failedRun);
    const target = {
      ...environment(),
      queueProvisioningRun,
      getActiveProvisioningRun: vi.fn(async () => queuedRun),
      revalidateActiveProvisioningRun: vi.fn(async () => queuedRun),
    };
    const create = vi.fn(async () => undefined);

    const result = await queueAndCreateProvisioningWorkflowInstance({
      workflow: {
        create,
        get: vi.fn(async () => ({
          status: async () => ({ status: "unknown" as const }),
        })),
      },
      environment: target,
      params: { ...params, runId: "run-client-retry" },
      target: { kind: "saved", targetRef: params.targetRef },
    });

    expect(result).toBe(failedRun);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps mismatched queued retries as active-run conflicts", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const queueProvisioningRun = vi
      .fn()
      .mockRejectedValueOnce(activeError)
      .mockRejectedValueOnce(new Error("target cannot be replaced"));
    const target = {
      ...environment(),
      queueProvisioningRun,
      getActiveProvisioningRun: vi.fn(async () => queuedRun),
      revalidateActiveProvisioningRun: vi.fn(async () => queuedRun),
    };
    const create = vi.fn(async () => undefined);

    await expect(
      queueAndCreateProvisioningWorkflowInstance({
        workflow: {
          create,
          get: vi.fn(async () => ({
            status: async () => ({ status: "unknown" as const }),
          })),
        },
        environment: target,
        params: { ...params, runId: "run-mismatch" },
        target: { kind: "saved", targetRef: params.targetRef },
      })
    ).rejects.toBe(activeError);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an exact running retry after confirming its Workflow is live", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const runningRun: ProvisioningRun = {
      ...queuedRun,
      status: "running",
      startedAt: "2026-07-22T12:00:01.000Z",
    };
    const queueProvisioningRun = vi.fn().mockRejectedValue(activeError);
    const revalidateActiveProvisioningRun = vi.fn(async () => runningRun);
    const target = {
      ...environment(),
      queueProvisioningRun,
      getProvisioningRun: vi.fn(async () => runningRun),
      getActiveProvisioningRun: vi.fn(async () => runningRun),
      revalidateActiveProvisioningRun,
    };
    const create = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({
      status: async () => ({ status: "running" as const }),
    }));
    const selector = {
      kind: "inline" as const,
      save: false,
      target: {
        ref: params.targetRef,
        baseUrl: "https://target.example.com/scim/v2",
        auth: { kind: "bearer" as const, token: "exact-running-token" },
        behavior: {},
      },
    };

    const result = await queueAndCreateProvisioningWorkflowInstance({
      workflow: {
        create,
        get,
      },
      environment: target,
      params: { ...params, runId: "run-fresh-running-retry" },
      target: selector,
    });

    expect(result).toBe(runningRun);
    expect(revalidateActiveProvisioningRun).toHaveBeenCalledWith(params, selector);
    expect(queueProvisioningRun).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(params.runId);
    expect(target.reconcileTerminalProvisioningWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    [
      "mismatched",
      { ...queuedRun, status: "running" as const, targetRef: "other-target" },
    ],
  ] as const)(
    "fails closed when a live Workflow has a %s runtime record",
    async (_case, current) => {
      const activeError = Object.assign(new Error("active"), {
        code: "ACTIVE_PROVISIONING_RUN",
      });
      const runningRun: ProvisioningRun = {
        ...queuedRun,
        status: "running",
        startedAt: "2026-07-22T12:00:01.000Z",
      };
      const target = {
        ...environment(),
        queueProvisioningRun: vi.fn().mockRejectedValue(activeError),
        getActiveProvisioningRun: vi.fn(async () => runningRun),
        revalidateActiveProvisioningRun: vi.fn(async () => runningRun),
      };
      target.getProvisioningRun.mockResolvedValueOnce(current);

      await expect(
        queueAndCreateProvisioningWorkflowInstance({
          workflow: {
            create: vi.fn(async () => undefined),
            get: vi.fn(async () => ({
              status: async () => ({ status: "running" as const }),
            })),
          },
          environment: target,
          params: { ...params, runId: "run-client-retry" },
          target: { kind: "saved", targetRef: params.targetRef },
        })
      ).rejects.toBeInstanceOf(ProvisioningWorkflowReconciliationError);
      expect(target.reconcileTerminalProvisioningWorkflow).not.toHaveBeenCalled();
      expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
    }
  );

  it.each(["errored", "terminated"] as const)(
    "atomically fails an exact running retry whose Workflow is %s",
    async (status) => {
      const activeError = Object.assign(new Error("active"), {
        code: "ACTIVE_PROVISIONING_RUN",
      });
      const runningRun: ProvisioningRun = {
        ...queuedRun,
        status: "running",
        startedAt: "2026-07-22T12:00:01.000Z",
      };
      const target = {
        ...environment(),
        queueProvisioningRun: vi.fn().mockRejectedValue(activeError),
        getActiveProvisioningRun: vi.fn(async () => runningRun),
        revalidateActiveProvisioningRun: vi.fn(async () => runningRun),
      };

      const result = await queueAndCreateProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => undefined),
          get: vi.fn(async () => ({
            status: async () => ({ status }),
          })),
        },
        environment: target,
        params: { ...params, runId: "run-client-retry" },
        target: { kind: "saved", targetRef: params.targetRef },
      });

      expect(result).toBe(failedRun);
      expect(target.reconcileTerminalProvisioningWorkflow).toHaveBeenCalledWith(
        params.runId,
        status
      );
      expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
    }
  );

  it("preserves state and reports indeterminate running Workflow status reads", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const runningRun: ProvisioningRun = {
      ...queuedRun,
      status: "running",
      startedAt: "2026-07-22T12:00:01.000Z",
    };
    const target = {
      ...environment(),
      queueProvisioningRun: vi.fn().mockRejectedValue(activeError),
      getActiveProvisioningRun: vi.fn(async () => runningRun),
      revalidateActiveProvisioningRun: vi.fn(async () => runningRun),
    };

    await expect(
      queueAndCreateProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => undefined),
          get: vi.fn(async () => ({
            status: async () => {
              throw new Error("transient platform failure with secret-token");
            },
          })),
        },
        environment: target,
        params: { ...params, runId: "run-client-retry" },
        target: { kind: "saved", targetRef: params.targetRef },
      })
    ).rejects.toBeInstanceOf(ProvisioningWorkflowReconciliationError);
    expect(target.reconcileTerminalProvisioningWorkflow).not.toHaveBeenCalled();
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("preserves state when an exact running retry has unknown Workflow status", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const runningRun: ProvisioningRun = {
      ...queuedRun,
      status: "running",
      startedAt: "2026-07-22T12:00:01.000Z",
    };
    const target = {
      ...environment(),
      queueProvisioningRun: vi.fn().mockRejectedValue(activeError),
      getActiveProvisioningRun: vi.fn(async () => runningRun),
      revalidateActiveProvisioningRun: vi.fn(async () => runningRun),
    };

    await expect(
      queueAndCreateProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => undefined),
          get: vi.fn(async () => ({
            status: async () => ({ status: "unknown" as const }),
          })),
        },
        environment: target,
        params: { ...params, runId: "run-client-retry" },
        target: { kind: "saved", targetRef: params.targetRef },
      })
    ).rejects.toBeInstanceOf(ProvisioningWorkflowReconciliationError);
    expect(target.reconcileTerminalProvisioningWorkflow).not.toHaveBeenCalled();
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("preserves a terminal DB run that wins the Workflow reconciliation race", async () => {
    const activeError = Object.assign(new Error("active"), {
      code: "ACTIVE_PROVISIONING_RUN",
    });
    const runningRun: ProvisioningRun = {
      ...queuedRun,
      status: "running",
      startedAt: "2026-07-22T12:00:01.000Z",
    };
    const succeededRun: ProvisioningRun = {
      ...runningRun,
      status: "succeeded",
      completedAt: "2026-07-22T12:00:02.000Z",
    };
    const target = {
      ...environment(),
      queueProvisioningRun: vi.fn().mockRejectedValue(activeError),
      getActiveProvisioningRun: vi.fn(async () => runningRun),
      revalidateActiveProvisioningRun: vi.fn(async () => runningRun),
    };
    target.reconcileTerminalProvisioningWorkflow.mockResolvedValueOnce({
      outcome: "preserved",
      run: succeededRun,
    });

    const result = await queueAndCreateProvisioningWorkflowInstance({
      workflow: {
        create: vi.fn(async () => undefined),
        get: vi.fn(async () => ({
          status: async () => ({ status: "complete" as const }),
        })),
      },
      environment: target,
      params: { ...params, runId: "run-client-retry" },
      target: { kind: "saved", targetRef: params.targetRef },
    });

    expect(result).toBe(succeededRun);
    expect(target.reconcileTerminalProvisioningWorkflow).toHaveBeenCalledWith(
      params.runId,
      "complete"
    );
  });

  it("rejects malformed terminal-reconciliation metadata", async () => {
    const target = environment();
    target.reconcileTerminalProvisioningWorkflow.mockResolvedValueOnce({
      outcome: "failed",
      run: { ...failedRun, appId: "other-app" },
    });

    await expect(
      createProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => {
            throw new Error("create response lost");
          }),
          get: vi.fn(async () => ({
            status: async () => ({ status: "terminated" as const }),
          })),
        },
        environment: target,
        params,
        queuedRun,
      })
    ).rejects.toBeInstanceOf(ProvisioningWorkflowReconciliationError);
  });

  it("fails a queued run when an ambiguous create finds an errored Workflow", async () => {
    const target = environment();
    const result = await createProvisioningWorkflowInstance({
      workflow: {
        create: vi.fn(async () => {
          throw new Error("create response lost");
        }),
        get: vi.fn(async () => ({
          status: async () => ({ status: "errored" as const }),
        })),
      },
      environment: target,
      params,
      queuedRun,
    });

    expect(result).toBe(failedRun);
    expect(target.reconcileTerminalProvisioningWorkflow).toHaveBeenCalledWith(
      params.runId,
      "errored"
    );
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("preserves staged state when fixed-ID get is indeterminate", async () => {
    const target = environment();
    let thrown: unknown;
    try {
      await createProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => {
            throw new Error("create leaked-account-detail");
          }),
          get: vi.fn(async () => {
            throw new Error("instance does not exist leaked-account-detail");
          }),
        },
        environment: target,
        params,
        queuedRun,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisioningWorkflowReconciliationError);
    expect(String(thrown)).not.toContain("leaked-account-detail");
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("preserves staged state when status retrieval fails", async () => {
    const target = environment();
    let thrown: unknown;
    try {
      await createProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => {
            throw new Error("create failed");
          }),
          get: vi.fn(async () => ({
            status: async () => {
              throw new Error("status leaked-account-detail");
            },
          })),
        },
        environment: target,
        params,
        queuedRun,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisioningWorkflowReconciliationError);
    expect(String(thrown)).not.toContain("leaked-account-detail");
    expect(target.compensateProvisioningRun).not.toHaveBeenCalled();
  });

  it("compensates only when status positively reports absence", async () => {
    const target = environment();
    let thrown: unknown;
    try {
      await createProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => {
            throw new Error("create leaked-account-detail");
          }),
          get: vi.fn(async () => ({
            status: async () => ({ status: "unknown" as const }),
          })),
        },
        environment: target,
        params,
        queuedRun,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisioningWorkflowStartError);
    expect(String(thrown)).not.toContain("leaked-account-detail");
    expect(target.compensateProvisioningRun).toHaveBeenCalledWith(
      params.runId,
      "Provisioning Workflow instance creation failed."
    );
  });

  it("preserves a run that crosses queued to running before compensation", async () => {
    const runningRun: ProvisioningRun = {
      ...queuedRun,
      status: "running",
      startedAt: "2026-07-22T12:00:01.000Z",
    };
    const target = environment();
    target.compensateProvisioningRun.mockResolvedValueOnce({
      outcome: "preserved",
      run: runningRun,
    });
    const result = await createProvisioningWorkflowInstance({
      workflow: {
        create: vi.fn(async () => {
          throw new Error("create response lost");
        }),
        get: vi.fn(async () => ({
          status: async () => ({ status: "unknown" as const }),
        })),
      },
      environment: target,
      params,
      queuedRun,
    });

    expect(result).toBe(runningRun);
  });

  it("rejects malformed preserved compensation acknowledgements", async () => {
    const target = environment();
    target.compensateProvisioningRun.mockResolvedValueOnce({
      outcome: "preserved",
      run: { ...failedRun, appId: "other-app" },
    });

    await expect(
      createProvisioningWorkflowInstance({
        workflow: {
          create: vi.fn(async () => {
            throw new Error("create response lost");
          }),
          get: vi.fn(async () => ({
            status: async () => ({ status: "unknown" as const }),
          })),
        },
        environment: target,
        params,
        queuedRun,
      })
    ).rejects.toBeInstanceOf(ProvisioningWorkflowReconciliationError);
  });
});
