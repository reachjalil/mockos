import type {
  ProvisioningBehavior,
  ProvisioningHttpOperation,
  ProvisioningOp,
  ProvisioningSnapshot,
  ProvisioningSourceGroup,
  ProvisioningSourceUser,
  ProvisioningWatermark,
} from "@mockos/contracts";
import { describe, expect, it } from "vitest";
import { interpretProvisioningResponse } from "./interpreter";
import { InvalidProvisioningStateError, planProvisioning } from "./planner";

const user = (
  overrides: Partial<ProvisioningSourceUser> = {}
): ProvisioningSourceUser => ({
  resourceType: "User",
  id: "usr_ada",
  userName: "ada@example.test",
  displayName: "Ada Lovelace",
  givenName: "Ada",
  familyName: "Lovelace",
  active: true,
  deleted: false,
  version: 1,
  ...overrides,
});

const group = (
  overrides: Partial<ProvisioningSourceGroup> = {}
): ProvisioningSourceGroup => ({
  resourceType: "Group",
  id: "grp_engineering",
  displayName: "Engineering",
  memberIds: ["usr_ada"],
  deleted: false,
  version: 1,
  ...overrides,
});

const snapshot = (
  users: readonly ProvisioningSourceUser[] = [user()],
  groups: readonly ProvisioningSourceGroup[] = []
): ProvisioningSnapshot => ({
  cursor: "snapshot-1",
  users: [...users],
  groups: [...groups],
});

const emptyWatermark = (): ProvisioningWatermark => ({ users: [], groups: [] });

const httpOperation = (
  operation: ProvisioningOp | undefined
): ProvisioningHttpOperation => {
  expect(operation).toBeDefined();
  expect(operation?.type).toBe("http");
  return operation as ProvisioningHttpOperation;
};

const listResponse = (...resources: Readonly<Record<string, unknown>>[]) => ({
  status: 200,
  headers: { "content-type": "application/scim+json" },
  body: {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  },
});

describe("pure outbound provisioning planner", () => {
  it("orders deterministic Entra user discovery before group discovery", () => {
    const plan = planProvisioning({
      provider: "entra",
      mode: "incremental",
      snapshot: snapshot(
        [user({ id: "usr_grace", userName: "grace@example.test" }), user()],
        [group({ memberIds: ["usr_grace", "usr_ada"] })]
      ),
    });

    expect(plan.counts).toEqual({ users: 2, groups: 1, total: 3 });
    expect(plan.operations.map((operation) => operation.resourceType)).toEqual([
      "User",
      "User",
      "Group",
    ]);
    expect(plan.operations.map((operation) => operation.sourceId)).toEqual([
      "usr_ada",
      "usr_grace",
      "grp_engineering",
    ]);
    expect(httpOperation(plan.operations[0]).request).toMatchObject({
      method: "GET",
      path: "/Users?filter=userName%20eq%20%22ada%40example.test%22",
    });
    expect(httpOperation(plan.operations[2]).request.path).toBe(
      "/Groups?filter=displayName%20eq%20%22Engineering%22"
    );
  });

  it("uses locale-independent ordering and safely quotes SCIM filter values", () => {
    const input = {
      provider: "entra" as const,
      mode: "incremental" as const,
      snapshot: snapshot(
        [
          user({ id: "usr_unicode", userName: "ä@example.test" }),
          user({ id: "usr_lower", userName: "a@example.test" }),
          user({ id: "usr_upper", userName: 'Z\\"@example.test' }),
        ],
        []
      ),
    };
    const first = planProvisioning(input);
    expect(first).toEqual(planProvisioning(input));
    expect(first.operations.map(({ sourceId }) => sourceId)).toEqual([
      "usr_upper",
      "usr_lower",
      "usr_unicode",
    ]);
    const query = new URL(
      `https://target.invalid${httpOperation(first.operations[0]).request.path}`
    ).searchParams.get("filter");
    expect(query).toBe('userName eq "Z\\\\\\"@example.test"');
  });

  it("interprets an empty lookup into an Entra create and persists its target ID", () => {
    const lookup = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot(),
      }).operations[0]
    );
    const discovered = interpretProvisioningResponse({
      operation: lookup,
      response: listResponse(),
      watermark: emptyWatermark(),
    });
    expect(discovered.outcome).toBe("follow_up");
    const create = httpOperation(discovered.followUpOperations[0]);
    expect(create.request).toMatchObject({
      method: "POST",
      path: "/Users",
      body: {
        externalId: "usr_ada",
        userName: "ada@example.test",
        active: true,
        emails: [{ type: "work", primary: true, value: "ada@example.test" }],
      },
    });

    const created = interpretProvisioningResponse({
      operation: create,
      response: {
        status: 201,
        headers: { location: "/scim/v2/Users/target-ada" },
        body: { id: "target-ada" },
      },
      watermark: emptyWatermark(),
    });
    expect(created).toMatchObject({
      outcome: "succeeded",
      targetId: "target-ada",
      watermarkMutation: {
        action: "upsert",
        entry: {
          resourceType: "User",
          sourceId: "usr_ada",
          targetId: "target-ada",
          sourceVersion: 1,
          active: true,
        },
      },
    });
  });

  it("uses the Entra filtered email PATCH shape with an opt-out compatibility flag", () => {
    const lookup = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot(),
      }).operations[0]
    );
    const found = interpretProvisioningResponse({
      operation: lookup,
      response: listResponse({ id: "target-ada" }),
      watermark: emptyWatermark(),
    });
    const update = httpOperation(found.followUpOperations[0]);
    expect(update.request.method).toBe("PATCH");
    expect(update.request.body).toMatchObject({
      Operations: expect.arrayContaining([
        {
          op: "Replace",
          path: 'emails[type eq "work"].value',
          value: "ada@example.test",
        },
      ]),
    });

    const behavior: ProvisioningBehavior = {
      entra: { aadOptscim062020: false, deleteAfterDeactivation: true },
    };
    const noFilteredPathLookup = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot(),
        behavior,
      }).operations[0]
    );
    const noFilteredPath = httpOperation(
      interpretProvisioningResponse({
        operation: noFilteredPathLookup,
        response: listResponse({ id: "target-ada" }),
        watermark: emptyWatermark(),
      }).followUpOperations[0]
    );
    expect(noFilteredPath.request.body).toMatchObject({
      Operations: expect.arrayContaining([
        {
          op: "Replace",
          path: "emails",
          value: [{ type: "work", primary: true, value: "ada@example.test" }],
        },
      ]),
    });
  });

  it("skips unchanged incremental resources but replays a full cycle", () => {
    const watermark: ProvisioningWatermark = {
      cursor: "snapshot-1",
      users: [
        {
          resourceType: "User",
          sourceId: "usr_ada",
          targetId: "target-ada",
          sourceVersion: 1,
          active: true,
        },
      ],
      groups: [
        {
          resourceType: "Group",
          sourceId: "grp_engineering",
          targetId: "target-engineering",
          sourceVersion: 1,
        },
      ],
    };
    expect(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot([user()], [group()]),
        watermark,
      }).operations
    ).toEqual([]);
    const full = planProvisioning({
      provider: "entra",
      mode: "full",
      snapshot: snapshot([user()], [group()]),
      watermark,
    });
    expect(full.operations.map((operation) => operation.action)).toEqual([
      "update",
      "lookup",
    ]);
    expect(httpOperation(full.operations[0]).request.method).toBe("PATCH");
  });

  it("makes Entra deactivation then deletion explicit and conditional", () => {
    const watermark: ProvisioningWatermark = {
      users: [
        {
          resourceType: "User",
          sourceId: "usr_ada",
          targetId: "target-ada",
          sourceVersion: 1,
          active: true,
        },
      ],
      groups: [],
    };
    const deactivate = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot([user({ deleted: true, active: false, version: 2 })]),
        watermark,
      }).operations[0]
    );
    expect(deactivate).toMatchObject({
      action: "deactivate",
      request: { method: "PATCH", path: "/Users/target-ada" },
    });
    expect(deactivate.request.body).toMatchObject({
      Operations: [{ op: "Replace", path: "active", value: false }],
    });

    const deactivated = interpretProvisioningResponse({
      operation: deactivate,
      response: { status: 204, headers: {} },
      watermark,
    });
    expect(deactivated.outcome).toBe("follow_up");
    const deletion = httpOperation(deactivated.followUpOperations[0]);
    expect(deletion.request).toMatchObject({
      method: "DELETE",
      path: "/Users/target-ada",
    });
    expect(
      interpretProvisioningResponse({
        operation: deletion,
        response: { status: 204, headers: {} },
        watermark,
      })
    ).toMatchObject({
      outcome: "succeeded",
      watermarkMutation: {
        action: "remove",
        resourceType: "User",
        sourceId: "usr_ada",
      },
    });
  });

  it("uses Okta PUT-heavy updates and resolves group-push members at execution", () => {
    const sourceUsers = [
      user({ id: "usr_ada", version: 2 }),
      user({
        id: "usr_grace",
        userName: "grace@example.test",
        displayName: "Grace Hopper",
      }),
    ];
    const initialWatermark: ProvisioningWatermark = {
      users: [
        {
          resourceType: "User",
          sourceId: "usr_ada",
          targetId: "target-ada",
          sourceVersion: 1,
          active: true,
        },
        {
          resourceType: "User",
          sourceId: "usr_grace",
          targetId: "target-grace",
          sourceVersion: 1,
          active: true,
        },
      ],
      groups: [],
    };
    const plan = planProvisioning({
      provider: "okta",
      mode: "incremental",
      snapshot: snapshot(sourceUsers, [group({ memberIds: ["usr_grace", "usr_ada"] })]),
      watermark: initialWatermark,
    });
    expect(httpOperation(plan.operations[0]).request.method).toBe("PUT");
    const groupLookup = httpOperation(plan.operations.at(-1));
    const groupFound = interpretProvisioningResponse({
      operation: groupLookup,
      response: listResponse({ id: "target-engineering" }),
      watermark: initialWatermark,
    });
    const groupUpdate = httpOperation(groupFound.followUpOperations[0]);
    expect(groupUpdate.request).toMatchObject({
      method: "PUT",
      path: "/Groups/target-engineering",
      body: {
        displayName: "Engineering",
        members: [
          { value: "target-ada", type: "User" },
          { value: "target-grace", type: "User" },
        ],
      },
    });
  });

  it("honors an explicit Okta group-push opt-out without mutating group state", () => {
    const plan = planProvisioning({
      provider: "okta",
      mode: "full",
      snapshot: snapshot([user()], [group()]),
      watermark: {
        users: [],
        groups: [
          {
            resourceType: "Group",
            sourceId: "grp_stale",
            targetId: "target-stale",
            sourceVersion: 1,
          },
        ],
      },
      behavior: { okta: { groupPush: false } },
    });
    expect(plan.operations.map(({ resourceType }) => resourceType)).toEqual(["User"]);
    expect(plan.counts).toEqual({ users: 1, groups: 0, total: 1 });
  });

  it("fails group push closed while a target user ID is unresolved", () => {
    const lookup = httpOperation(
      planProvisioning({
        provider: "okta",
        mode: "incremental",
        snapshot: snapshot([user()], [group()]),
      }).operations.at(-1)
    );
    expect(
      interpretProvisioningResponse({
        operation: lookup,
        response: listResponse({ id: "target-engineering" }),
        watermark: emptyWatermark(),
      })
    ).toMatchObject({
      outcome: "failed",
      message: "Group 'grp_engineering' references unresolved user 'usr_ada'.",
      followUpOperations: [],
    });
  });

  it("models a 429 as explicit bounded wait and retry operations", () => {
    const operation = httpOperation(
      planProvisioning({
        provider: "okta",
        mode: "incremental",
        snapshot: snapshot(),
      }).operations[0]
    );
    const rateLimited = interpretProvisioningResponse({
      operation,
      response: { status: 429, headers: { "Retry-After": "2" } },
      watermark: emptyWatermark(),
    });
    expect(rateLimited.outcome).toBe("retry");
    expect(rateLimited.followUpOperations).toMatchObject([
      { type: "wait", delayMs: 2_000, attempt: 2 },
      { type: "http", attempt: 2, request: operation.request },
    ]);

    const finalAttempt = httpOperation(rateLimited.followUpOperations[1]);
    expect(
      interpretProvisioningResponse({
        operation: { ...finalAttempt, attempt: 3 },
        response: { status: 429, headers: { "retry-after": "1" } },
        watermark: emptyWatermark(),
      })
    ).toMatchObject({ outcome: "failed", followUpOperations: [] });
    expect(
      interpretProvisioningResponse({
        operation,
        response: { status: 503, headers: {} },
        watermark: emptyWatermark(),
      })
    ).toMatchObject({ outcome: "failed", followUpOperations: [] });

    const receivedAtEpochMs = Date.parse("2026-07-22T12:00:00.000Z");
    expect(
      interpretProvisioningResponse({
        operation,
        response: {
          status: 429,
          headers: { "Retry-After": "Wed, 22 Jul 2026 12:00:45 GMT" },
        },
        watermark: emptyWatermark(),
        receivedAtEpochMs,
      }).followUpOperations[0]
    ).toMatchObject({ type: "wait", delayMs: 30_000 });
    expect(
      interpretProvisioningResponse({
        operation,
        response: {
          status: 429,
          headers: {
            "X-Rate-Limit-Reset": String(
              Math.floor((receivedAtEpochMs + 2_500) / 1_000)
            ),
          },
        },
        watermark: emptyWatermark(),
        receivedAtEpochMs,
      }).followUpOperations[0]
    ).toMatchObject({ type: "wait", delayMs: 2_000 });
    expect(() =>
      interpretProvisioningResponse({
        operation,
        response: { status: 429, headers: {} },
        watermark: emptyWatermark(),
        maxRateLimitAttempts: 0,
      })
    ).toThrow("between 1 and 10");
  });

  it("handles idempotent update/deactivation races without leaking response bodies", () => {
    const watermark: ProvisioningWatermark = {
      users: [
        {
          resourceType: "User",
          sourceId: "usr_ada",
          targetId: "target-ada",
          sourceVersion: 1,
          active: true,
        },
      ],
      groups: [],
    };
    const update = httpOperation(
      planProvisioning({
        provider: "okta",
        mode: "incremental",
        snapshot: snapshot([user({ version: 2 })]),
        watermark,
      }).operations[0]
    );
    const recreated = interpretProvisioningResponse({
      operation: update,
      response: { status: 404, headers: {}, body: "private-target-detail" },
      watermark,
    });
    expect(recreated.outcome).toBe("follow_up");
    expect(httpOperation(recreated.followUpOperations[0])).toMatchObject({
      action: "create",
      request: { method: "POST", path: "/Users" },
    });
    expect(recreated.message).not.toContain("private-target-detail");

    const deactivate = httpOperation(
      planProvisioning({
        provider: "okta",
        mode: "incremental",
        snapshot: snapshot([user({ deleted: true, active: false, version: 2 })]),
        watermark,
      }).operations[0]
    );
    expect(
      interpretProvisioningResponse({
        operation: deactivate,
        response: { status: 404, headers: {} },
        watermark,
      })
    ).toMatchObject({
      outcome: "succeeded",
      watermarkMutation: {
        action: "remove",
        resourceType: "User",
        sourceId: "usr_ada",
      },
    });
  });

  it("fails malformed target responses closed", () => {
    const lookup = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot(),
      }).operations[0]
    );
    expect(
      interpretProvisioningResponse({
        operation: lookup,
        response: {
          status: 200,
          headers: {},
          body: { totalResults: "1", Resources: [{ id: "target-ada" }] },
        },
        watermark: emptyWatermark(),
      })
    ).toMatchObject({
      outcome: "failed",
      message: "Target returned an invalid SCIM ListResponse.",
    });

    const create = httpOperation(
      interpretProvisioningResponse({
        operation: lookup,
        response: listResponse(),
        watermark: emptyWatermark(),
      }).followUpOperations[0]
    );
    expect(
      interpretProvisioningResponse({
        operation: create,
        response: { status: 201, headers: {}, body: {} },
        watermark: emptyWatermark(),
      })
    ).toMatchObject({
      outcome: "failed",
      message: "Successful create response did not identify the target resource.",
    });
    expect(() =>
      interpretProvisioningResponse({
        operation: lookup,
        response: { status: 99, headers: {} },
        watermark: emptyWatermark(),
      })
    ).toThrow();
  });

  it("treats missing deletes as idempotent but rejects ambiguous lookups", () => {
    const watermark: ProvisioningWatermark = {
      users: [],
      groups: [
        {
          resourceType: "Group",
          sourceId: "grp_engineering",
          targetId: "target-engineering",
          sourceVersion: 1,
        },
      ],
    };
    const deletion = httpOperation(
      planProvisioning({
        provider: "okta",
        mode: "incremental",
        snapshot: snapshot([], []),
        watermark,
      }).operations[0]
    );
    expect(
      interpretProvisioningResponse({
        operation: deletion,
        response: { status: 404, headers: {} },
        watermark,
      })
    ).toMatchObject({
      outcome: "succeeded",
      watermarkMutation: { action: "remove", resourceType: "Group" },
    });

    const lookup = httpOperation(
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot(),
      }).operations[0]
    );
    expect(
      interpretProvisioningResponse({
        operation: lookup,
        response: listResponse({ id: "one" }, { id: "two" }),
        watermark: emptyWatermark(),
      })
    ).toMatchObject({ outcome: "failed", message: "Target lookup was not unique." });
  });

  it("rejects duplicate source IDs and regressed directory versions", () => {
    expect(() =>
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot([user(), user()], []),
      })
    ).toThrow(InvalidProvisioningStateError);

    expect(() =>
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot([user({ version: 1 })]),
        watermark: {
          users: [
            {
              resourceType: "User",
              sourceId: "usr_ada",
              targetId: "target-ada",
              sourceVersion: 2,
              active: true,
            },
          ],
          groups: [],
        },
      })
    ).toThrow("regressed from version 2 to 1");

    expect(() =>
      planProvisioning({
        provider: "entra",
        mode: "incremental",
        snapshot: snapshot([], []),
        watermark: {
          users: [
            {
              resourceType: "User",
              sourceId: "usr_ada",
              targetId: "target-shared",
              sourceVersion: 1,
              active: true,
            },
            {
              resourceType: "User",
              sourceId: "usr_grace",
              targetId: "target-shared",
              sourceVersion: 1,
              active: true,
            },
          ],
          groups: [],
        },
      })
    ).toThrow("duplicate target ID 'target-shared'");
  });
});
