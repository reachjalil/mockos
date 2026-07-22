import {
  type ProviderId,
  type ProvisioningBehavior,
  type ProvisioningHttpOperation,
  type ProvisioningMode,
  type ProvisioningPlan,
  type ProvisioningSnapshot,
  type ProvisioningSourceGroup,
  type ProvisioningSourceResource,
  type ProvisioningSourceUser,
  type ProvisioningWatermark,
  providerIdSchema,
  provisioningBehaviorSchema,
  provisioningModeSchema,
  provisioningPlanSchema,
  provisioningSnapshotSchema,
  provisioningWatermarkSchema,
} from "@mockos/contracts";
import {
  buildLookupOperation,
  buildTerminalOperation,
  buildWriteOperation,
} from "./operations";

export interface PlanProvisioningInput {
  readonly provider: ProviderId;
  readonly mode: ProvisioningMode;
  readonly snapshot: ProvisioningSnapshot;
  readonly watermark?: ProvisioningWatermark;
  readonly behavior?: ProvisioningBehavior;
}

export class InvalidProvisioningStateError extends Error {
  readonly code = "INVALID_PROVISIONING_STATE";

  constructor(message: string) {
    super(message);
    this.name = "InvalidProvisioningStateError";
  }
}

const assertUniqueIds = (
  label: string,
  values: readonly { readonly id?: string; readonly sourceId?: string }[]
): void => {
  const seen = new Set<string>();
  for (const value of values) {
    const id = value.id ?? value.sourceId;
    if (!id) throw new InvalidProvisioningStateError(`${label} contains an empty ID.`);
    if (seen.has(id)) {
      throw new InvalidProvisioningStateError(
        `${label} contains duplicate ID '${id}'.`
      );
    }
    seen.add(id);
  }
};

const assertUniqueTargetIds = (
  label: string,
  values: readonly { readonly targetId: string }[]
): void => {
  const seen = new Set<string>();
  for (const { targetId } of values) {
    if (seen.has(targetId)) {
      throw new InvalidProvisioningStateError(
        `${label} contains duplicate target ID '${targetId}'.`
      );
    }
    seen.add(targetId);
  }
};

const operationId = (
  sequence: number,
  resource: "user" | "group",
  action: string
): string => `op-${String(sequence).padStart(6, "0")}-${resource}-${action}`;

const changedSince = (
  mode: ProvisioningMode,
  source: ProvisioningSourceResource,
  previousVersion: number | undefined,
  previousActive?: boolean
): boolean =>
  mode === "full" ||
  previousVersion === undefined ||
  source.version > previousVersion ||
  source.deleted ||
  (source.resourceType === "User" && source.active !== previousActive);

const assertVersionHasNotRegressed = (
  source: ProvisioningSourceResource,
  previousVersion: number | undefined
): void => {
  if (previousVersion !== undefined && source.version < previousVersion) {
    throw new InvalidProvisioningStateError(
      `${source.resourceType} '${source.id}' regressed from version ${previousVersion} to ${source.version}.`
    );
  }
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortUsers = (
  users: readonly ProvisioningSourceUser[]
): ProvisioningSourceUser[] =>
  [...users].sort(
    (left, right) =>
      compareText(left.userName, right.userName) || compareText(left.id, right.id)
  );

const sortGroups = (
  groups: readonly ProvisioningSourceGroup[]
): ProvisioningSourceGroup[] =>
  [...groups].sort(
    (left, right) =>
      compareText(left.displayName, right.displayName) || compareText(left.id, right.id)
  );

/**
 * Produces deterministic, network-free SCIM operations. The workflow executes each
 * HTTP operation and feeds its response to `interpretProvisioningResponse`; lookup
 * and rate-limit responses can therefore add explicit follow-up operations.
 */
export const planProvisioning = (input: PlanProvisioningInput): ProvisioningPlan => {
  const provider = providerIdSchema.parse(input.provider);
  const mode = provisioningModeSchema.parse(input.mode);
  const snapshot = provisioningSnapshotSchema.parse(input.snapshot);
  const behavior = provisioningBehaviorSchema.parse(input.behavior ?? {});
  const watermark = provisioningWatermarkSchema.parse(input.watermark ?? {});
  assertUniqueIds("Provisioning snapshot users", snapshot.users);
  assertUniqueIds("Provisioning snapshot groups", snapshot.groups);
  assertUniqueIds("Provisioning watermark users", watermark.users);
  assertUniqueIds("Provisioning watermark groups", watermark.groups);
  assertUniqueTargetIds("Provisioning watermark users", watermark.users);
  assertUniqueTargetIds("Provisioning watermark groups", watermark.groups);

  const userWatermarks = new Map(
    watermark.users.map((entry) => [entry.sourceId, entry] as const)
  );
  const groupWatermarks = new Map(
    watermark.groups.map((entry) => [entry.sourceId, entry] as const)
  );
  const currentUserIds = new Set(snapshot.users.map((user) => user.id));
  const currentGroupIds = new Set(snapshot.groups.map((group) => group.id));
  const operations: ProvisioningHttpOperation[] = [];
  let sequence = 1;

  for (const source of sortUsers(snapshot.users)) {
    const previous = userWatermarks.get(source.id);
    assertVersionHasNotRegressed(source, previous?.sourceVersion);
    if (!changedSince(mode, source, previous?.sourceVersion, previous?.active)) {
      continue;
    }
    if (source.deleted) {
      if (!previous) continue;
      operations.push(
        buildTerminalOperation({
          id: operationId(sequence, "user", "deactivate"),
          sequence,
          provider,
          action: "deactivate",
          resourceType: "User",
          sourceId: source.id,
          sourceVersion: source.version,
          targetId: previous.targetId,
          source,
          behavior,
        })
      );
    } else if (previous) {
      operations.push(
        buildWriteOperation({
          id: operationId(sequence, "user", "update"),
          sequence,
          provider,
          action: "update",
          source,
          targetId: previous.targetId,
          behavior,
          watermark,
        })
      );
    } else {
      operations.push(
        buildLookupOperation({
          id: operationId(sequence, "user", "lookup"),
          sequence,
          provider,
          source,
          behavior,
        })
      );
    }
    sequence += 1;
  }

  for (const previous of [...watermark.users].sort((left, right) =>
    compareText(left.sourceId, right.sourceId)
  )) {
    if (currentUserIds.has(previous.sourceId)) continue;
    operations.push(
      buildTerminalOperation({
        id: operationId(sequence, "user", "deactivate"),
        sequence,
        provider,
        action: "deactivate",
        resourceType: "User",
        sourceId: previous.sourceId,
        sourceVersion: previous.sourceVersion,
        targetId: previous.targetId,
        behavior,
      })
    );
    sequence += 1;
  }

  const groupPushEnabled = provider !== "okta" || (behavior.okta?.groupPush ?? true);
  for (const source of groupPushEnabled ? sortGroups(snapshot.groups) : []) {
    const previous = groupWatermarks.get(source.id);
    assertVersionHasNotRegressed(source, previous?.sourceVersion);
    if (!changedSince(mode, source, previous?.sourceVersion)) continue;
    if (source.deleted) {
      if (!previous) continue;
      operations.push(
        buildTerminalOperation({
          id: operationId(sequence, "group", "delete"),
          sequence,
          provider,
          action: "delete",
          resourceType: "Group",
          sourceId: source.id,
          sourceVersion: source.version,
          targetId: previous.targetId,
          source,
          behavior,
        })
      );
    } else {
      // Group lookup is intentionally retained even with a known target ID. It defers
      // membership materialization until all preceding user outcomes update watermark.
      operations.push(
        buildLookupOperation({
          id: operationId(sequence, "group", "lookup"),
          sequence,
          provider,
          source,
          behavior,
        })
      );
    }
    sequence += 1;
  }

  for (const previous of (groupPushEnabled ? [...watermark.groups] : []).sort(
    (left, right) => compareText(left.sourceId, right.sourceId)
  )) {
    if (currentGroupIds.has(previous.sourceId)) continue;
    operations.push(
      buildTerminalOperation({
        id: operationId(sequence, "group", "delete"),
        sequence,
        provider,
        action: "delete",
        resourceType: "Group",
        sourceId: previous.sourceId,
        sourceVersion: previous.sourceVersion,
        targetId: previous.targetId,
        behavior,
      })
    );
    sequence += 1;
  }

  const users = operations.filter(
    (operation) => operation.resourceType === "User"
  ).length;
  const groups = operations.length - users;
  return provisioningPlanSchema.parse({
    version: 1,
    provider,
    mode,
    snapshotCursor: snapshot.cursor,
    behavior,
    operations,
    counts: { users, groups, total: operations.length },
  });
};
