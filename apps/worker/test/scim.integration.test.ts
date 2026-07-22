import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const apiKey = "mockos-integration-test-key";
const origin = "https://mockos.test";
const worker = (exports as unknown as { default: Fetcher }).default;
const bearer = { authorization: "Bearer synthetic-scim-token" };
const scimHeaders = {
  ...bearer,
  "content-type": "application/scim+json",
};

const controlFetch = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(`${origin}${path}`, { ...init, headers });
};

const prepare = async (
  environmentId: string,
  provider: "entra" | "okta",
  tenantId: string,
  userName: string
) => {
  const configured = await controlFetch(`/__mockos/v1/environments/${environmentId}`, {
    method: "PUT",
    body: JSON.stringify({
      id: environmentId,
      name: `${provider} SCIM integration`,
      provider,
      seed: `${provider}-scim-integration`,
      tenantId,
      createdAt: "2026-07-22T00:00:00.000Z",
      idleTtlHours: 168,
      requestLogLimit: 10_000,
    }),
  });
  expect(configured.status, await configured.clone().text()).toBe(200);
  const seeded = await controlFetch(
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
  expect(seeded.status, await seeded.clone().text()).toBe(200);
  return seeded.json<{
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

const patchBody = (Operations: Array<Record<string, unknown>>) =>
  JSON.stringify({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations,
  });

describe("M3 SCIM Worker surface", () => {
  it("runs Okta-dialect discovery, filters, CRUD, PATCH, and ETag semantics", async () => {
    const environmentId = "scim-okta-01";
    const userName = "ada.scim.okta@example.test";
    await prepare(
      environmentId,
      "okta",
      "2f6f4756-741d-4a4b-83b2-5f2e37ec621d",
      userName
    );
    const base = `${origin}/e/${environmentId}/scim/v2`;
    try {
      const unauthenticated = await worker.fetch(`${base}/ServiceProviderConfig`);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("www-authenticate")).toContain("Bearer");

      const providerConfig = await worker.fetch(`${base}/ServiceProviderConfig`, {
        headers: bearer,
      });
      expect(providerConfig.status, await providerConfig.clone().text()).toBe(200);
      expect(await providerConfig.json()).toMatchObject({
        patch: { supported: true },
        filter: { supported: true, maxResults: 200 },
      });

      const usersUrl = new URL(`${base}/Users`);
      usersUrl.searchParams.set("filter", `userName eq "${userName}"`);
      const listed = await worker.fetch(usersUrl, { headers: bearer });
      expect(listed.status, await listed.clone().text()).toBe(200);
      const listBody = await listed.json<{
        Resources: Array<{ id: string; meta: { location: string } }>;
        totalResults: number;
      }>();
      expect(listBody.totalResults).toBe(1);
      const userId = listBody.Resources[0]?.id;
      expect(userId).toBeTruthy();
      expect(listBody.Resources[0]?.meta.location).toBe(`${base}/Users/${userId}`);

      const read = await worker.fetch(`${base}/Users/${userId}`, {
        headers: bearer,
      });
      expect(read.status).toBe(200);
      expect(read.headers.get("etag")).toBe('W/"1"');

      const updated = await worker.fetch(`${base}/Users/${userId}`, {
        method: "PATCH",
        headers: { ...scimHeaders, "if-match": 'W/"1"' },
        body: patchBody([
          { op: "replace", path: "displayName", value: "Ada Augusta Lovelace" },
        ]),
      });
      expect(updated.status, await updated.clone().text()).toBe(200);
      expect(updated.headers.get("etag")).toBe('W/"2"');
      expect(await updated.json()).toMatchObject({
        displayName: "Ada Augusta Lovelace",
        meta: { version: 'W/"2"' },
      });

      const noOp = await worker.fetch(`${base}/Users/${userId}`, {
        method: "PATCH",
        headers: { ...scimHeaders, "if-match": 'W/"2"' },
        body: patchBody([
          { op: "replace", path: "displayName", value: "Ada Augusta Lovelace" },
        ]),
      });
      expect(noOp.status, await noOp.clone().text()).toBe(200);
      expect(noOp.headers.get("etag")).toBe('W/"2"');
      await noOp.body?.cancel();

      const stale = await worker.fetch(`${base}/Users/${userId}`, {
        method: "PATCH",
        headers: { ...scimHeaders, "if-match": 'W/"1"' },
        body: patchBody([{ op: "replace", path: "title", value: "Engineer" }]),
      });
      expect(stale.status).toBe(412);
      const staleBody = await stale.json<Record<string, unknown>>();
      expect(staleBody).toMatchObject({ status: "412" });
      expect(staleBody).not.toHaveProperty("scimType");

      const sharedExternalId = "non-unique-upstream-id";
      for (const suffix of ["one", "two"]) {
        const created = await worker.fetch(`${base}/Users`, {
          method: "POST",
          headers: scimHeaders,
          body: JSON.stringify({
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            externalId: sharedExternalId,
            userName: `${suffix}.scim@example.test`,
            displayName: `SCIM ${suffix}`,
            active: true,
          }),
        });
        expect(created.status, await created.clone().text()).toBe(201);
        expect(await created.json()).toMatchObject({ externalId: sharedExternalId });
      }
    } finally {
      await remove(environmentId);
    }
  });

  it("returns Entra's 204 Group PATCH dialect and deactivates users", async () => {
    const environmentId = "scim-entra-01";
    const userName = "ada.scim.entra@example.test";
    const seeded = await prepare(
      environmentId,
      "entra",
      "3f6f4756-741d-4a4b-83b2-5f2e37ec621d",
      userName
    );
    const base = `${origin}/e/${environmentId}/scim/v2`;
    try {
      const userId = seeded.data.users[0]?.id;
      const groupId = seeded.data.groups[0]?.id;
      expect(userId).toBeTruthy();
      expect(groupId).toBeTruthy();

      const groupPatch = await worker.fetch(`${base}/Groups/${groupId}`, {
        method: "PATCH",
        headers: scimHeaders,
        body: patchBody([
          { op: "replace", path: "displayName", value: "Platform Engineering" },
        ]),
      });
      expect(groupPatch.status, await groupPatch.clone().text()).toBe(204);
      expect(groupPatch.headers.get("etag")).toBe('W/"2"');

      const deactivate = await worker.fetch(`${base}/Users/${userId}`, {
        method: "PATCH",
        headers: scimHeaders,
        body: patchBody([{ op: "replace", path: "active", value: false }]),
      });
      expect(deactivate.status, await deactivate.clone().text()).toBe(200);
      expect(await deactivate.json()).toMatchObject({ active: false });
    } finally {
      await remove(environmentId);
    }
  });
});
