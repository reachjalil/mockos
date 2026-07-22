import type {
  ProvisioningRun,
  ProvisioningSnapshot,
  ProvisioningTarget,
  ProvisioningWatermark,
} from "@mockos/contracts";

export const MAX_PROVISIONING_PREPARED_BYTES = 512 * 1_024;
export const MAX_PROVISIONING_SNAPSHOT_RESOURCES = 1_000;
export const MAX_PROVISIONING_WATERMARK_RESOURCES = 1_000;

export type ProvisioningPreparedOutput = {
  readonly run: ProvisioningRun;
  readonly target: ProvisioningTarget;
  readonly snapshot: ProvisioningSnapshot;
  readonly watermark: ProvisioningWatermark;
};

const serializedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Keeps a non-streaming Workflow step result comfortably below its 1 MiB cap. */
export const assertProvisioningPreparedOutputBounds = (
  output: ProvisioningPreparedOutput
): void => {
  if (
    output.snapshot.users.length + output.snapshot.groups.length >
    MAX_PROVISIONING_SNAPSHOT_RESOURCES
  ) {
    throw new Error("Provisioning snapshot exceeds the resource limit.");
  }
  if (
    output.watermark.users.length + output.watermark.groups.length >
    MAX_PROVISIONING_WATERMARK_RESOURCES
  ) {
    throw new Error("Provisioning watermark exceeds the resource limit.");
  }
  if (serializedBytes(output) > MAX_PROVISIONING_PREPARED_BYTES) {
    throw new Error("Provisioning prepared output exceeds the serialized limit.");
  }
};
