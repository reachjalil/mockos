import {
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
} from "@mockos/contracts";
import { describe, expect, it } from "vitest";
import { ScimProtocolError } from "./errors";
import { applyScimPatch } from "./patch";

const patchRequest = (Operations: readonly Record<string, unknown>[]) => ({
  schemas: [SCIM_PATCH_OP_SCHEMA],
  Operations,
});

const userResource = () => ({
  schemas: [SCIM_CORE_USER_SCHEMA],
  id: "user-1",
  externalId: "directory-1",
  userName: "ada@example.test",
  displayName: "Ada Lovelace",
  name: { givenName: "Ada", familyName: "Lovelace" },
  active: true,
  emails: [
    { type: "work", value: "ada@corp.test", primary: true },
    { type: "home", value: "ada@example.test", primary: false },
  ],
  groups: [{ value: "group-1", display: "Engineers" }],
  [SCIM_ENTERPRISE_USER_SCHEMA]: { department: "Research" },
  meta: {
    resourceType: "User",
    created: "2026-07-22T12:00:00.000Z",
    lastModified: "2026-07-22T12:00:00.000Z",
    location: "https://example.test/scim/v2/Users/user-1",
    version: 'W/"1"',
  },
});

const groupResource = () => ({
  schemas: [SCIM_CORE_GROUP_SCHEMA],
  id: "group-1",
  displayName: "Engineers",
  members: [
    { value: "user-1", type: "User" },
    { value: "user-2", type: "User" },
  ],
  meta: {
    resourceType: "Group",
    created: "2026-07-22T12:00:00.000Z",
    lastModified: "2026-07-22T12:00:00.000Z",
    location: "https://example.test/scim/v2/Groups/group-1",
    version: 'W/"1"',
  },
});

const expectScimType = (
  callback: () => unknown,
  scimType: string,
  status = 400
): void => {
  try {
    callback();
    throw new Error("Expected a SCIM protocol error.");
  } catch (error) {
    expect(error).toBeInstanceOf(ScimProtocolError);
    expect(error).toMatchObject({ status, scimType });
  }
};

describe("SCIM PatchOp application", () => {
  it("applies provider-style op casing and Okta pathless replace", () => {
    const original = userResource();
    const result = applyScimPatch(
      original,
      {
        SCHEMAS: [SCIM_PATCH_OP_SCHEMA],
        OPERATIONS: [{ OP: "Replace", VALUE: { active: false, title: "Countess" } }],
      },
      { resourceType: "User", dialect: "okta" }
    );

    expect(result.changed).toBe(true);
    expect(result.resource).toMatchObject({ active: false, title: "Countess" });
    expect(original).not.toHaveProperty("title");
    expect(original.active).toBe(true);
  });

  it("updates simple, complex, and enterprise extension paths sequentially", () => {
    const result = applyScimPatch(
      userResource(),
      patchRequest([
        { op: "replace", path: "displayName", value: "Augusta Ada King" },
        { op: "replace", path: "name.givenName", value: "Augusta" },
        {
          op: "replace",
          path: `${SCIM_ENTERPRISE_USER_SCHEMA}:department`,
          value: "Mathematics",
        },
      ]),
      { resourceType: "User" }
    );

    expect(result.resource).toMatchObject({
      displayName: "Augusta Ada King",
      name: { givenName: "Augusta", familyName: "Lovelace" },
      [SCIM_ENTERPRISE_USER_SCHEMA]: { department: "Mathematics" },
    });
  });

  it("selects a multi-valued element before changing its sub-attribute", () => {
    const result = applyScimPatch(
      userResource(),
      patchRequest([
        {
          op: "replace",
          path: 'emails[type eq "home"].value',
          value: "ada@home.test",
        },
        {
          op: "replace",
          path: 'emails[type eq "home"].primary',
          value: true,
        },
      ]),
      { resourceType: "User" }
    );

    expect(result.resource.emails).toEqual([
      { type: "work", value: "ada@corp.test", primary: false },
      { type: "home", value: "ada@home.test", primary: true },
    ]);
  });

  it("normalizes a newly added primary multi-value", () => {
    const result = applyScimPatch(
      userResource(),
      patchRequest([
        {
          op: "add",
          path: "emails",
          value: { type: "other", value: "ada@new.test", primary: true },
        },
      ]),
      { resourceType: "User" }
    );

    expect(result.resource.emails.map(({ primary }) => primary)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("supports Entra group member array add and removal forms", () => {
    const added = applyScimPatch(
      groupResource(),
      patchRequest([
        {
          op: "Add",
          path: "members",
          value: [{ value: "user-3", type: "User" }],
        },
      ]),
      { resourceType: "Group", dialect: "entra" }
    );
    expect(added.resource.members.map(({ value }) => value)).toEqual([
      "user-1",
      "user-2",
      "user-3",
    ]);

    const removed = applyScimPatch(
      added.resource,
      patchRequest([{ op: "Remove", path: "members", value: [{ value: "user-2" }] }]),
      { resourceType: "Group", dialect: { patchStyle: "entra" } }
    );
    expect(removed.resource.members.map(({ value }) => value)).toEqual([
      "user-1",
      "user-3",
    ]);
  });

  it("supports Okta and RFC filtered group membership removal and replacement", () => {
    const removed = applyScimPatch(
      groupResource(),
      patchRequest([{ op: "remove", path: 'members[value eq "user-1"]' }]),
      { resourceType: "Group", dialect: "okta" }
    );
    expect(removed.resource.members).toEqual([{ value: "user-2", type: "User" }]);

    const replaced = applyScimPatch(
      groupResource(),
      patchRequest([
        {
          op: "replace",
          path: 'members[value eq "user-2"]',
          value: { value: "user-3", type: "User" },
        },
      ]),
      { resourceType: "Group" }
    );
    expect(replaced.resource.members.map(({ value }) => value)).toEqual([
      "user-1",
      "user-3",
    ]);
  });

  it("keeps semantic no-ops stable", () => {
    const original = userResource();
    const result = applyScimPatch(
      original,
      patchRequest([{ op: "replace", path: "active", value: true }]),
      { resourceType: "User" }
    );
    expect(result.changed).toBe(false);
    expect(result.resource).toEqual(original);

    const duplicate = applyScimPatch(
      groupResource(),
      patchRequest([{ op: "add", path: "members", value: { value: "user-2" } }]),
      { resourceType: "Group" }
    );
    expect(duplicate.changed).toBe(false);
  });

  it("is atomic when a later operation fails", () => {
    const original = userResource();
    const before = structuredClone(original);
    expectScimType(
      () =>
        applyScimPatch(
          original,
          patchRequest([
            { op: "replace", path: "displayName", value: "Changed" },
            { op: "remove", path: "userName" },
          ]),
          { resourceType: "User" }
        ),
      "invalidValue"
    );
    expect(original).toEqual(before);
  });

  it("fails closed for read-only, unknown, mistyped, and unmatched targets", () => {
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([{ op: "replace", path: "id", value: "other" }]),
          { resourceType: "User" }
        ),
      "mutability"
    );
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([
            {
              op: "replace",
              path: 'groups[value eq "group-1"].display',
              value: "Other",
            },
          ]),
          { resourceType: "User" }
        ),
      "mutability"
    );
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([{ op: "replace", path: "unknown", value: "x" }]),
          { resourceType: "User" }
        ),
      "invalidPath"
    );
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([{ op: "replace", path: "active", value: "false" }]),
          { resourceType: "User" }
        ),
      "invalidValue"
    );
    expectScimType(
      () =>
        applyScimPatch(
          groupResource(),
          patchRequest([{ op: "remove", path: 'members[value eq "missing-user"]' }]),
          { resourceType: "Group" }
        ),
      "noTarget"
    );
  });

  it("enforces request, operation, path, and nesting limits", () => {
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([
            { op: "replace", path: "active", value: true },
            { op: "replace", path: "displayName", value: "Ada" },
          ]),
          { resourceType: "User", limits: { maxOperations: 1 } }
        ),
      "invalidSyntax"
    );
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([{ op: "replace", path: "displayName", value: "Ada" }]),
          { resourceType: "User", limits: { maxPathBytes: 4 } }
        ),
      "invalidPath"
    );
    expectScimType(
      () =>
        applyScimPatch(
          userResource(),
          patchRequest([{ op: "replace", value: { name: { givenName: "Ada" } } }]),
          { resourceType: "User", limits: { maxDepth: 2 } }
        ),
      "invalidValue"
    );
  });
});
