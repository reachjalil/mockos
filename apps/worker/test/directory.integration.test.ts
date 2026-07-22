import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const worker = (exports as unknown as { default: Fetcher }).default;

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${origin}${path}`, { ...init, headers });
};

const configure = async (
  environmentId: string,
  provider: "entra" | "okta",
  tenantId: string
) => {
  const response = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
    method: "PUT",
    body: JSON.stringify({
      id: environmentId,
      name: `${provider} directory integration`,
      provider,
      seed: `${provider}-directory-integration`,
      tenantId,
      createdAt: "2026-07-22T00:00:00.000Z",
      idleTtlHours: 168,
      requestLogLimit: 10_000,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
};

const seed = async (environmentId: string, userName: string) => {
  const response = await controlFetch(
    `/__mockos/v1/environments/${environmentId}/identities:seed`,
    {
      method: "POST",
      body: JSON.stringify({
        users: [
          {
            userName,
            displayName: "Ada Lovelace",
            givenName: "Ada",
            familyName: "Lovelace",
            password: "Passw0rd!",
            active: true,
            mfaState: "none",
            roles: [],
          },
        ],
        groups: [{ displayName: "Engineering", members: [userName] }],
      }),
    }
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json<{
    data: {
      groups: Array<{ id: string }>;
      users: Array<{ id: string }>;
    };
  }>();
};

const remove = async (environmentId: string) => {
  const response = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
    method: "DELETE",
  });
  expect(response.status).toBe(204);
};

describe("M3 provider directory surfaces", () => {
  it("serves bounded Microsoft Graph user, group, and membership reads", async () => {
    const environmentId = "directory-entra-01";
    const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";
    const userName = "ada.graph@example.test";
    await configure(environmentId, "entra", tenantId);
    try {
      const seeded = await seed(environmentId, userName);
      const userId = seeded.data.users[0]?.id;
      const groupId = seeded.data.groups[0]?.id;
      expect(userId).toBeTruthy();
      expect(groupId).toBeTruthy();

      const unauthenticated = await worker.fetch(
        `${origin}/e/${environmentId}/graph/v1.0/users`
      );
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.json()).toMatchObject({
        error: { code: "InvalidAuthenticationToken" },
      });

      const usersUrl = new URL(`${origin}/e/${environmentId}/graph/v1.0/users`);
      usersUrl.searchParams.set("$filter", `userPrincipalName eq '${userName}'`);
      usersUrl.searchParams.set("$select", "id,displayName,userPrincipalName");
      const users = await worker.fetch(usersUrl, {
        headers: { authorization: "Bearer synthetic-graph-token" },
      });
      expect(users.status, await users.clone().text()).toBe(200);
      expect(await users.json()).toMatchObject({
        value: [
          { id: userId, displayName: "Ada Lovelace", userPrincipalName: userName },
        ],
      });

      const members = await worker.fetch(
        `${origin}/e/${environmentId}/graph/v1.0/groups/${groupId}/members?$select=id,userPrincipalName`,
        { headers: { authorization: "Bearer synthetic-graph-token" } }
      );
      expect(members.status, await members.clone().text()).toBe(200);
      expect(await members.json()).toMatchObject({
        value: [{ id: userId, userPrincipalName: userName }],
      });
    } finally {
      await remove(environmentId);
    }
  });

  it("serves Okta Users/Groups lifecycle APIs and E0000047 scenarios", async () => {
    const environmentId = "directory-okta-01";
    const tenantId = "1f6f4756-741d-4a4b-83b2-5f2e37ec621d";
    const userName = "ada.okta.directory@example.test";
    await configure(environmentId, "okta", tenantId);
    try {
      const seeded = await seed(environmentId, userName);
      const seededUserId = seeded.data.users[0]?.id;
      const groupId = seeded.data.groups[0]?.id;
      expect(seededUserId).toBeTruthy();
      expect(groupId).toBeTruthy();
      const headers = { authorization: "SSWS synthetic-okta-api-token" };

      const listUrl = new URL(`${origin}/e/${environmentId}/api/v1/users`);
      listUrl.searchParams.set("filter", `profile.login eq "${userName}"`);
      const users = await worker.fetch(listUrl, { headers });
      expect(users.status, await users.clone().text()).toBe(200);
      expect(await users.json()).toMatchObject([
        { id: seededUserId, status: "ACTIVE", profile: { login: userName } },
      ]);

      const members = await worker.fetch(
        `${origin}/e/${environmentId}/api/v1/groups/${groupId}/users`,
        { headers }
      );
      expect(members.status, await members.clone().text()).toBe(200);
      expect(await members.json()).toMatchObject([{ id: seededUserId }]);

      const staged = await worker.fetch(
        `${origin}/e/${environmentId}/api/v1/users?activate=false`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            profile: {
              login: "staged@example.test",
              email: "staged@example.test",
              firstName: "Staged",
              lastName: "User",
            },
          }),
        }
      );
      expect(staged.status, await staged.clone().text()).toBe(200);
      const stagedBody = await staged.json<{ id: string; status: string }>();
      expect(stagedBody.status).toBe("STAGED");

      const activate = await worker.fetch(
        `${origin}/e/${environmentId}/api/v1/users/${stagedBody.id}/lifecycle/activate`,
        { method: "POST", headers }
      );
      expect(activate.status, await activate.clone().text()).toBe(200);
      expect(await activate.json()).toMatchObject({ status: "ACTIVE" });

      const deactivate = await worker.fetch(
        `${origin}/e/${environmentId}/api/v1/users/${stagedBody.id}/lifecycle/deactivate`,
        { method: "POST", headers }
      );
      expect(deactivate.status).toBe(200);
      await deactivate.body?.cancel();
      const reactivate = await worker.fetch(
        `${origin}/e/${environmentId}/api/v1/users/${stagedBody.id}/lifecycle/reactivate`,
        { method: "POST", headers }
      );
      expect(reactivate.status, await reactivate.clone().text()).toBe(200);
      expect(await reactivate.json()).toMatchObject({ status: "ACTIVE" });

      const namespace = Reflect.get(env, "ENVIRONMENTS") as {
        get(id: DurableObjectId): {
          setScenario(input: Record<string, unknown>): Promise<unknown>;
        };
        idFromName(name: string): DurableObjectId;
      };
      await namespace.get(namespace.idFromName(environmentId)).setScenario({
        id: "okta-directory-rate-limit",
        injectionPoint: "okta.api",
        action: { type: "error", code: "RATE_LIMITED" },
        probability: 1,
        remaining: 1,
        enabled: true,
      });
      const limited = await worker.fetch(`${origin}/e/${environmentId}/api/v1/users`, {
        headers,
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("x-okta-request-id")).toBeTruthy();
      expect(await limited.json()).toMatchObject({ errorCode: "E0000047" });
    } finally {
      await remove(environmentId);
    }
  });
});
