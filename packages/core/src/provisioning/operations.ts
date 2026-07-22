import {
  type ProviderId,
  type ProvisioningBehavior,
  type ProvisioningHttpAction,
  type ProvisioningHttpOperation,
  type ProvisioningSourceGroup,
  type ProvisioningSourceResource,
  type ProvisioningSourceUser,
  type ProvisioningWatermark,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
} from "@mockos/contracts";

const scimAcceptHeaders = {
  accept: "application/scim+json, application/json",
} as const;

const scimWriteHeaders = {
  ...scimAcceptHeaders,
  "content-type": "application/scim+json",
} as const;

const quotedFilterValue = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const filterPath = (collection: "Users" | "Groups", filter: string): string =>
  `/${collection}?filter=${encodeURIComponent(filter)}`;

const resourcePath = (collection: "Users" | "Groups", targetId: string): string =>
  `/${collection}/${encodeURIComponent(targetId)}`;

const userPayload = (
  source: ProvisioningSourceUser,
  active = source.active && !source.deleted
): Readonly<Record<string, unknown>> => ({
  schemas: [SCIM_CORE_USER_SCHEMA],
  externalId: source.externalId ?? source.id,
  userName: source.userName,
  displayName: source.displayName,
  name: {
    ...(source.givenName ? { givenName: source.givenName } : {}),
    ...(source.familyName ? { familyName: source.familyName } : {}),
  },
  emails: [
    {
      type: "work",
      primary: true,
      value: source.userName,
    },
  ],
  active,
});

const userPatchPayload = (
  source: ProvisioningSourceUser,
  behavior: ProvisioningBehavior
): Readonly<Record<string, unknown>> => {
  const aadOptscim = behavior.entra?.aadOptscim062020 ?? true;
  return {
    schemas: [SCIM_PATCH_OP_SCHEMA],
    Operations: [
      { op: "Replace", path: "userName", value: source.userName },
      { op: "Replace", path: "displayName", value: source.displayName },
      {
        op: "Replace",
        path: "name",
        value: {
          ...(source.givenName ? { givenName: source.givenName } : {}),
          ...(source.familyName ? { familyName: source.familyName } : {}),
        },
      },
      aadOptscim
        ? {
            op: "Replace",
            path: 'emails[type eq "work"].value',
            value: source.userName,
          }
        : {
            op: "Replace",
            path: "emails",
            value: [{ type: "work", primary: true, value: source.userName }],
          },
      {
        op: "Replace",
        path: "active",
        value: source.active && !source.deleted,
      },
    ],
  };
};

const groupPayload = (
  source: ProvisioningSourceGroup,
  memberTargetIds: readonly string[]
): Readonly<Record<string, unknown>> => ({
  schemas: [SCIM_CORE_GROUP_SCHEMA],
  externalId: source.externalId ?? source.id,
  displayName: source.displayName,
  members: memberTargetIds.map((value) => ({ value, type: "User" })),
});

const groupPatchPayload = (
  source: ProvisioningSourceGroup,
  memberTargetIds: readonly string[]
): Readonly<Record<string, unknown>> => ({
  schemas: [SCIM_PATCH_OP_SCHEMA],
  Operations: [
    { op: "Replace", path: "displayName", value: source.displayName },
    {
      op: "Replace",
      path: "members",
      value: memberTargetIds.map((value) => ({ value, type: "User" })),
    },
  ],
});

export class UnresolvedProvisioningMemberError extends Error {
  readonly code = "UNRESOLVED_PROVISIONING_MEMBER";
  readonly groupId: string;
  readonly memberId: string;

  constructor(groupId: string, memberId: string) {
    super(`Group '${groupId}' references unresolved user '${memberId}'.`);
    this.name = "UnresolvedProvisioningMemberError";
    this.groupId = groupId;
    this.memberId = memberId;
  }
}

const groupMemberTargetIds = (
  source: ProvisioningSourceGroup,
  watermark: ProvisioningWatermark
): string[] => {
  const targetIds = new Map(
    watermark.users.map((entry) => [entry.sourceId, entry.targetId] as const)
  );
  return [...new Set(source.memberIds)]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((sourceId) => {
      const targetId = targetIds.get(sourceId);
      if (!targetId) throw new UnresolvedProvisioningMemberError(source.id, sourceId);
      return targetId;
    });
};

interface OperationIdentity {
  readonly id: string;
  readonly sequence: number;
  readonly attempt?: number;
}

interface BuildLookupOperationInput extends OperationIdentity {
  readonly provider: ProviderId;
  readonly source: ProvisioningSourceResource;
  readonly behavior: ProvisioningBehavior;
}

export const buildLookupOperation = (
  input: BuildLookupOperationInput
): ProvisioningHttpOperation => {
  const { source } = input;
  const filter =
    source.resourceType === "User"
      ? `userName eq ${quotedFilterValue(source.userName)}`
      : `displayName eq ${quotedFilterValue(source.displayName)}`;
  return {
    type: "http",
    id: input.id,
    sequence: input.sequence,
    provider: input.provider,
    resourceType: source.resourceType,
    action: "lookup",
    sourceId: source.id,
    sourceVersion: source.version,
    source,
    behavior: input.behavior,
    attempt: input.attempt ?? 1,
    request: {
      method: "GET",
      path: filterPath(source.resourceType === "User" ? "Users" : "Groups", filter),
      headers: scimAcceptHeaders,
    },
  };
};

interface BuildWriteOperationInput extends OperationIdentity {
  readonly provider: ProviderId;
  readonly action: Extract<ProvisioningHttpAction, "create" | "update">;
  readonly source: ProvisioningSourceResource;
  readonly targetId?: string;
  readonly behavior: ProvisioningBehavior;
  readonly watermark: ProvisioningWatermark;
}

export const buildWriteOperation = (
  input: BuildWriteOperationInput
): ProvisioningHttpOperation => {
  const { source } = input;
  if (input.action === "update" && !input.targetId) {
    throw new Error("Update operations require a resolved target ID.");
  }
  const collection = source.resourceType === "User" ? "Users" : "Groups";
  const memberTargetIds =
    source.resourceType === "Group"
      ? groupMemberTargetIds(source, input.watermark)
      : undefined;
  const body =
    source.resourceType === "User"
      ? input.action === "update" && input.provider === "entra"
        ? userPatchPayload(source, input.behavior)
        : userPayload(source)
      : input.action === "update" && input.provider === "entra"
        ? groupPatchPayload(source, memberTargetIds ?? [])
        : groupPayload(source, memberTargetIds ?? []);
  const method =
    input.action === "create" ? "POST" : input.provider === "entra" ? "PATCH" : "PUT";
  return {
    type: "http",
    id: input.id,
    sequence: input.sequence,
    provider: input.provider,
    resourceType: source.resourceType,
    action: input.action,
    sourceId: source.id,
    sourceVersion: source.version,
    ...(input.targetId ? { targetId: input.targetId } : {}),
    source,
    behavior: input.behavior,
    attempt: input.attempt ?? 1,
    request: {
      method,
      path:
        input.action === "create"
          ? `/${collection}`
          : resourcePath(collection, input.targetId as string),
      headers: scimWriteHeaders,
      body,
    },
  };
};

interface BuildTerminalOperationInput extends OperationIdentity {
  readonly provider: ProviderId;
  readonly action: Extract<ProvisioningHttpAction, "deactivate" | "delete">;
  readonly resourceType: "User" | "Group";
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly targetId: string;
  readonly source?: ProvisioningSourceResource;
  readonly behavior: ProvisioningBehavior;
}

export const buildTerminalOperation = (
  input: BuildTerminalOperationInput
): ProvisioningHttpOperation => {
  const collection = input.resourceType === "User" ? "Users" : "Groups";
  if (input.action === "deactivate" && input.resourceType !== "User") {
    throw new Error("Only User resources can be deactivated.");
  }
  const oktaSource =
    input.provider === "okta" &&
    input.action === "deactivate" &&
    input.source?.resourceType === "User"
      ? input.source
      : undefined;
  return {
    type: "http",
    id: input.id,
    sequence: input.sequence,
    provider: input.provider,
    resourceType: input.resourceType,
    action: input.action,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    targetId: input.targetId,
    ...(input.source ? { source: input.source } : {}),
    behavior: input.behavior,
    attempt: input.attempt ?? 1,
    request: {
      method: input.action === "delete" ? "DELETE" : oktaSource ? "PUT" : "PATCH",
      path: resourcePath(collection, input.targetId),
      headers: input.action === "delete" ? scimAcceptHeaders : scimWriteHeaders,
      ...(input.action === "deactivate"
        ? {
            body: oktaSource
              ? userPayload(oktaSource, false)
              : {
                  schemas: [SCIM_PATCH_OP_SCHEMA],
                  Operations: [{ op: "Replace", path: "active", value: false }],
                },
          }
        : {}),
    },
  };
};
