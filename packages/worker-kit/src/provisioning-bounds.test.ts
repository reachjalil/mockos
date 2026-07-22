import type {
  ProvisioningRun,
  ProvisioningSnapshot,
  ProvisioningTarget,
  ProvisioningWatermark,
} from "@mockos/contracts";
import { describe, expect, it } from "vitest";
import {
  assertProvisioningPreparedOutputBounds,
  MAX_PROVISIONING_SNAPSHOT_RESOURCES,
} from "./provisioning-bounds";

const run: ProvisioningRun = {
  id: "run-bounds",
  envId: "env_bounds01",
  appId: "app-bounds",
  provider: "entra",
  mode: "full",
  targetRef: "target-bounds",
  status: "running",
  createdAt: "2026-07-22T12:00:00.000Z",
  startedAt: "2026-07-22T12:00:01.000Z",
};
const target: ProvisioningTarget = {
  ref: "target-bounds",
  baseUrl: "https://target.example.com/scim/v2",
  auth: { kind: "none" },
  behavior: {},
};
const watermark: ProvisioningWatermark = { users: [], groups: [] };

const output = (snapshot: ProvisioningSnapshot) => ({
  run,
  target,
  snapshot,
  watermark,
});

describe("provisioning Workflow output bounds", () => {
  it("rejects too many snapshot resources before returning the prepare step", () => {
    const snapshot: ProvisioningSnapshot = {
      cursor: "snapshot-resource-limit",
      groups: [],
      users: Array.from(
        { length: MAX_PROVISIONING_SNAPSHOT_RESOURCES + 1 },
        (_, index) => ({
          resourceType: "User" as const,
          id: `user-${index}`,
          userName: `user-${index}@example.com`,
          displayName: `User ${index}`,
          active: true,
          deleted: false,
          version: 1,
        })
      ),
    };
    expect(() => assertProvisioningPreparedOutputBounds(output(snapshot))).toThrow(
      "Provisioning snapshot exceeds the resource limit."
    );
  });

  it("rejects a serialized snapshot below the resource cap but above 512 KiB", () => {
    const memberIds = Array.from(
      { length: 5_000 },
      (_, index) => `${String(index).padStart(7, "0")}${"x".repeat(121)}`
    );
    const snapshot: ProvisioningSnapshot = {
      cursor: "snapshot-byte-limit",
      users: [],
      groups: [
        {
          resourceType: "Group",
          id: "group-large",
          displayName: "Large group",
          memberIds,
          deleted: false,
          version: 1,
        },
      ],
    };
    expect(() => assertProvisioningPreparedOutputBounds(output(snapshot))).toThrow(
      "Provisioning prepared output exceeds the serialized limit."
    );
  });
});
