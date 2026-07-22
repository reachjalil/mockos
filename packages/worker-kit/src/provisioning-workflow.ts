import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { ProvisioningWorkflowParams } from "@mockos/contracts";
import type { EnvironmentDurableObject } from "./environment-do";
import {
  type ProvisioningWorkflowEnvironment,
  type ProvisioningWorkflowStep,
  runProvisioningWorkflow,
} from "./provisioning-orchestrator";

export type ProvisioningWorkflowBindings = {
  ENVIRONMENTS: DurableObjectNamespace<EnvironmentDurableObject>;
};

/** Durable Cloudflare Workflow entrypoint for one outbound provisioning run. */
export class ProvisioningWorkflow extends WorkflowEntrypoint<
  ProvisioningWorkflowBindings,
  ProvisioningWorkflowParams
> {
  override run(
    event: Readonly<WorkflowEvent<ProvisioningWorkflowParams>>,
    step: WorkflowStep
  ): Promise<ProvisioningRunResult> {
    const namespace = this.env.ENVIRONMENTS;
    const environment = namespace.get(
      namespace.idFromName(event.payload.envId)
    ) as unknown as ProvisioningWorkflowEnvironment;
    return runProvisioningWorkflow(
      event.payload,
      environment,
      step as unknown as ProvisioningWorkflowStep
    );
  }
}

type ProvisioningRunResult = Awaited<ReturnType<typeof runProvisioningWorkflow>>;
