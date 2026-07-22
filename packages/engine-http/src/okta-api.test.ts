import { describe, expect, it } from "vitest";
import {
  createOktaDirectoryApi,
  OktaApiError,
  type OktaDirectoryApiEngine,
  type OktaDirectoryGroup,
  type OktaDirectoryUser,
} from "./okta-api";

const createdAt = "2026-07-22T00:00:00.000Z";

const harness = () => {
  const lifecycleActions: string[] = [];
  const users: OktaDirectoryUser[] = [
    {
      id: "usr_ada",
      userName: "ada@example.test",
      displayName: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
      state: "active",
      createdAt,
      updatedAt: createdAt,
    },
  ];
  const groups: OktaDirectoryGroup[] = [
    {
      id: "grp_engineering",
      displayName: "Engineering",
      createdAt,
      updatedAt: createdAt,
    },
  ];
  const members = new Set<string>();
  const engine: OktaDirectoryApiEngine = {
    listUsers: () => users.filter((user) => user.state !== "deleted"),
    getUser: (idOrLogin) =>
      users.find((user) => user.id === idOrLogin || user.userName === idOrLogin),
    async createUser(input) {
      const user: OktaDirectoryUser = {
        id: `usr_${users.length + 1}`,
        userName: input.userName,
        displayName: input.displayName,
        ...(input.givenName ? { givenName: input.givenName } : {}),
        ...(input.familyName ? { familyName: input.familyName } : {}),
        state: input.activate === false ? "staged" : "active",
        createdAt,
        updatedAt: createdAt,
      };
      users.push(user);
      return user;
    },
    async updateUser(id, input) {
      const user = users.find((candidate) => candidate.id === id);
      if (!user) throw new OktaApiError("E0000007", "Not found", 404);
      Object.assign(user, input, { updatedAt: "2026-07-22T00:00:01.000Z" });
      return user;
    },
    async lifecycleUser(id, action) {
      lifecycleActions.push(action);
      const user = users.find((candidate) => candidate.id === id);
      if (!user) throw new OktaApiError("E0000007", "Not found", 404);
      user.state =
        action === "suspend"
          ? "suspended"
          : action === "deprovision"
            ? "deprovisioned"
            : "active";
      return user;
    },
    async deleteUser(id) {
      const user = users.find((candidate) => candidate.id === id);
      if (!user) throw new OktaApiError("E0000007", "Not found", 404);
      user.state = "deleted";
    },
    listGroups: () => groups,
    getGroup: (id) => groups.find((group) => group.id === id),
    createGroup(displayName) {
      const group = {
        id: `grp_${groups.length + 1}`,
        displayName,
        createdAt,
        updatedAt: createdAt,
      };
      groups.push(group);
      return group;
    },
    updateGroup(id, displayName) {
      const group = groups.find((candidate) => candidate.id === id);
      if (!group) throw new OktaApiError("E0000007", "Not found", 404);
      group.displayName = displayName;
      return group;
    },
    deleteGroup(id) {
      const index = groups.findIndex((group) => group.id === id);
      if (index < 0) throw new OktaApiError("E0000007", "Not found", 404);
      groups.splice(index, 1);
    },
    listGroupMembers: (id) =>
      id === "grp_engineering" && members.has("usr_ada") ? users.slice(0, 1) : [],
    addGroupMember(groupId, userId) {
      if (
        !groups.some((group) => group.id === groupId) ||
        !users.some((user) => user.id === userId)
      ) {
        throw new OktaApiError("E0000007", "Not found", 404);
      }
      members.add(userId);
    },
    removeGroupMember(_groupId, userId) {
      members.delete(userId);
    },
  };
  return {
    app: createOktaDirectoryApi({ engine, requestId: () => "okta-request-1" }),
    users,
    groups,
    lifecycleActions,
  };
};

const headers = {
  authorization: "SSWS mock-okta-api-token",
  "content-type": "application/json",
};

describe("Okta directory API adapter", () => {
  it("requires an SSWS mock credential and returns Okta errors", async () => {
    const { app } = harness();
    const unauthorized = await app.request("https://mockos.test/api/v1/users");
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ errorCode: "E0000004" });

    const missing = await app.request("https://mockos.test/api/v1/users/missing", {
      headers,
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-okta-request-id")).toBe("okta-request-1");
    expect(await missing.json()).toMatchObject({ errorCode: "E0000007" });

    const caseInsensitiveScheme = await app.request(
      "https://mockos.test/api/v1/users",
      { headers: { authorization: "ssws mock-token" } }
    );
    expect(caseInsensitiveScheme.status).toBe(200);
  });

  it("creates, filters, pages, and transitions users", async () => {
    const { app, lifecycleActions } = harness();
    const created = await app.request(
      "https://mockos.test/api/v1/users?activate=false",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          profile: {
            login: "grace@example.test",
            firstName: "Grace",
            lastName: "Hopper",
          },
        }),
      }
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      status: "STAGED",
      profile: { login: "grace@example.test" },
    });

    const list = await app.request(
      "https://mockos.test/api/v1/users?filter=profile.login%20eq%20%22ADA%40EXAMPLE.TEST%22&limit=1",
      {
        headers: {
          ...headers,
          "x-mockos-public-path": "/e/env_test/api/v1/users",
        },
      }
    );
    expect(await list.json()).toMatchObject([{ id: "usr_ada", status: "ACTIVE" }]);

    const suspended = await app.request(
      "https://mockos.test/api/v1/users/usr_ada/lifecycle/suspend",
      { method: "POST", headers }
    );
    expect(suspended.status).toBe(200);
    expect(await suspended.text()).toBe("");
    const user = await app.request("https://mockos.test/api/v1/users/usr_ada", {
      headers,
    });
    expect(await user.json()).toMatchObject({ status: "SUSPENDED" });

    const deactivated = await app.request(
      "https://mockos.test/api/v1/users/usr_ada/lifecycle/deactivate",
      { method: "POST", headers }
    );
    expect(deactivated.status).toBe(200);
    const reactivated = await app.request(
      "https://mockos.test/api/v1/users/usr_ada/lifecycle/reactivate",
      { method: "POST", headers }
    );
    expect(reactivated.status).toBe(200);
    expect(lifecycleActions).toEqual(["suspend", "deprovision", "reactivate"]);
  });

  it("manages groups and direct membership idempotently", async () => {
    const { app } = harness();
    const add = await app.request(
      "https://mockos.test/api/v1/groups/grp_engineering/users/usr_ada",
      { method: "PUT", headers }
    );
    expect(add.status).toBe(204);

    const members = await app.request(
      "https://mockos.test/api/v1/groups/grp_engineering/users",
      { headers }
    );
    expect(await members.json()).toMatchObject([
      { id: "usr_ada", profile: { login: "ada@example.test" } },
    ]);

    const remove = await app.request(
      "https://mockos.test/api/v1/groups/grp_engineering/users/usr_ada",
      { method: "DELETE", headers }
    );
    expect(remove.status).toBe(204);
  });

  it("returns bounded provider-shaped errors for malformed input and cursors", async () => {
    const { app } = harness();
    const malformedBody = await app.request("https://mockos.test/api/v1/users", {
      method: "POST",
      headers,
      body: "{not-json",
    });
    expect(malformedBody.status).toBe(400);
    expect(await malformedBody.json()).toMatchObject({ errorCode: "E0000003" });

    const invalidCursor = await app.request(
      "https://mockos.test/api/v1/users?after=missing",
      { headers }
    );
    expect(invalidCursor.status).toBe(400);
    expect(await invalidCursor.json()).toMatchObject({ errorCode: "E0000001" });

    const overlongFilter = await app.request(
      `https://mockos.test/api/v1/users?filter=${encodeURIComponent("x".repeat(2_049))}`,
      { headers }
    );
    expect(overlongFilter.status).toBe(400);

    const missingMembershipCollection = await app.request(
      "https://mockos.test/api/v1/groups/missing/users",
      { headers }
    );
    expect(missingMembershipCollection.status).toBe(404);
  });

  it("handles malformed paths and unsupported methods without internal errors", async () => {
    const { app } = harness();
    const malformed = await app.request("https://mockos.test/api/v1/users/%ZZ", {
      headers,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ errorCode: "E0000003" });

    const unsupported = await app.request("https://mockos.test/api/v1/groups", {
      method: "PATCH",
      headers,
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, POST");
  });
});
