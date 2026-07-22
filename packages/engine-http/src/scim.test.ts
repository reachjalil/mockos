import {
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  type ScimGroupResource,
  type ScimUserResource,
} from "@mockos/contracts";
import { describe, expect, it, vi } from "vitest";
import { createScimHttpApp, type ScimHttpEngine, ScimHttpError } from "./scim";

const baseUrl = "https://mockos.test/e/env_test/scim/v2";
const user: ScimUserResource = {
  schemas: [SCIM_CORE_USER_SCHEMA],
  id: "usr_ada",
  userName: "ada@example.test",
  displayName: "Ada Lovelace",
  active: true,
  meta: {
    resourceType: "User",
    created: "2026-07-22T00:00:00.000Z",
    lastModified: "2026-07-22T00:00:00.000Z",
    location: `${baseUrl}/Users/usr_ada`,
    version: 'W/"1"',
  },
};
const group: ScimGroupResource = {
  schemas: [SCIM_CORE_GROUP_SCHEMA],
  id: "grp_engineering",
  displayName: "Engineering",
  members: [],
  meta: {
    resourceType: "Group",
    created: "2026-07-22T00:00:00.000Z",
    lastModified: "2026-07-22T00:00:00.000Z",
    location: `${baseUrl}/Groups/grp_engineering`,
    version: 'W/"1"',
  },
};

const createEngine = (): ScimHttpEngine => ({
  groupPatchSuccessStatus: 204,
  serviceProviderConfig: (base) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    filter: { supported: true, maxResults: 200 },
    etag: { supported: true },
    meta: { location: `${base}/ServiceProviderConfig` },
  }),
  resourceTypes: () => ({
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [
      { id: "User", endpoint: "/Users", schema: SCIM_CORE_USER_SCHEMA },
      { id: "Group", endpoint: "/Groups", schema: SCIM_CORE_GROUP_SCHEMA },
    ],
  }),
  schemas: () => ({
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [],
  }),
  schema: () => ({ id: SCIM_CORE_USER_SCHEMA }),
  listUsers: () => ({
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [user],
  }),
  getUser: (id) =>
    id === user.id
      ? { resource: user, etag: user.meta.version, location: user.meta.location }
      : undefined,
  createUser: async (input) => ({
    resource: { ...user, ...input, id: "usr_created", meta: user.meta },
    etag: 'W/"1"',
    location: `${baseUrl}/Users/usr_created`,
  }),
  replaceUser: async (_id, input, ifMatch) => {
    if (ifMatch && ifMatch !== 'W/"1"' && ifMatch !== "*") {
      throw new ScimHttpError(412, "The supplied entity tag is stale.");
    }
    return {
      resource: { ...user, ...input, id: user.id, meta: user.meta },
      etag: 'W/"1"',
      location: user.meta.location,
    };
  },
  patchUser: vi.fn(async (_id, _patch, ifMatch) => {
    if (ifMatch && ifMatch !== 'W/"1"' && ifMatch !== "*") {
      throw new ScimHttpError(412, "The supplied entity tag is stale.");
    }
    return { resource: user, etag: 'W/"1"', location: user.meta.location };
  }),
  deleteUser: async () => undefined,
  listGroups: () => ({
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [group],
  }),
  getGroup: (id) =>
    id === group.id
      ? { resource: group, etag: group.meta.version, location: group.meta.location }
      : undefined,
  createGroup: async (input) => ({
    resource: { ...group, ...input, id: "grp_created", meta: group.meta },
    etag: 'W/"1"',
    location: `${baseUrl}/Groups/grp_created`,
  }),
  replaceGroup: async (_id, input) => ({
    resource: { ...group, ...input, id: group.id, meta: group.meta },
    etag: 'W/"1"',
    location: group.meta.location,
  }),
  patchGroup: vi.fn(async () => ({
    resource: group,
    etag: 'W/"1"',
    location: group.meta.location,
  })),
  deleteGroup: vi.fn(async () => undefined),
});

const headers = {
  authorization: "Bearer mock-scim-credential",
  "content-type": "application/scim+json",
  "x-mockos-public-path": "/e/env_test/scim/v2/Users/usr_ada",
};

describe("SCIM HTTP adapter", () => {
  it("requires bearer auth and serves truthful discovery", async () => {
    const app = createScimHttpApp(createEngine());
    const unauthorized = await app.request(
      "https://mockos.test/scim/v2/ServiceProviderConfig"
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("content-type")).toContain("application/scim+json");

    const discovery = await app.request(
      "https://mockos.test/scim/v2/ServiceProviderConfig",
      {
        headers: {
          authorization: headers.authorization,
          "x-mockos-public-path": "/e/env_test/scim/v2/ServiceProviderConfig",
        },
      }
    );
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      patch: { supported: true },
      filter: { maxResults: 200 },
      meta: { location: `${baseUrl}/ServiceProviderConfig` },
    });

    const caseInsensitiveScheme = await app.request(
      "https://mockos.test/scim/v2/ResourceTypes/User",
      { headers: { authorization: "bearer mock-token" } }
    );
    expect(caseInsensitiveScheme.status).toBe(200);
    expect(await caseInsensitiveScheme.json()).toMatchObject({
      id: "User",
      endpoint: "/Users",
    });

    const unknownType = await app.request(
      "https://mockos.test/scim/v2/ResourceTypes/Device",
      { headers }
    );
    expect(unknownType.status).toBe(404);
  });

  it("returns ETags, honors If-None-Match, and renders plain 412 errors", async () => {
    const app = createScimHttpApp(createEngine());
    const read = await app.request("https://mockos.test/scim/v2/Users/usr_ada", {
      headers,
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("etag")).toBe('W/"1"');

    const notModified = await app.request("https://mockos.test/scim/v2/Users/usr_ada", {
      headers: { ...headers, "if-none-match": 'W/"1"' },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("cache-control")).toBe("no-store");

    const strongValidator = await app.request(
      "https://mockos.test/scim/v2/Users/usr_ada",
      { headers: { ...headers, "if-none-match": '"1"' } }
    );
    expect(strongValidator.status).toBe(304);
    expect(strongValidator.headers.get("etag")).toBe('W/"1"');

    const stale = await app.request("https://mockos.test/scim/v2/Users/usr_ada", {
      method: "PUT",
      headers: { ...headers, "if-match": 'W/"9"' },
      body: JSON.stringify({
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "ada@example.test",
      }),
    });
    expect(stale.status).toBe(412);
    expect(await stale.json()).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "412",
      detail: "The supplied entity tag is stale.",
    });
  });

  it("normalizes provider op casing and supports Entra-style group 204", async () => {
    const engine = createEngine();
    const app = createScimHttpApp(engine);
    const patch = await app.request("https://mockos.test/scim/v2/Users/usr_ada", {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        schemas: [SCIM_PATCH_OP_SCHEMA],
        Operations: [{ op: "RePlAcE", path: "active", value: false }],
      }),
    });
    expect(patch.status).toBe(200);
    expect(engine.patchUser).toHaveBeenCalledWith(
      "usr_ada",
      expect.objectContaining({
        Operations: [expect.objectContaining({ op: "replace", path: "active" })],
      }),
      undefined,
      baseUrl
    );

    const groupPatch = await app.request(
      "https://mockos.test/scim/v2/Groups/grp_engineering",
      {
        method: "PATCH",
        headers: {
          ...headers,
          "x-mockos-public-path": "/e/env_test/scim/v2/Groups/grp_engineering",
        },
        body: JSON.stringify({
          schemas: [SCIM_PATCH_OP_SCHEMA],
          Operations: [{ op: "remove", path: 'members[value eq "usr_ada"]' }],
        }),
      }
    );
    expect(groupPatch.status).toBe(204);
    expect(groupPatch.headers.get("etag")).toBe('W/"1"');
    expect(groupPatch.headers.get("location")).toBe(group.meta.location);

    const bodyRequired = await app.request(
      "https://mockos.test/scim/v2/Groups/grp_engineering?attributes=displayName",
      {
        method: "PATCH",
        headers: { ...headers, "if-match": 'W/"1"' },
        body: JSON.stringify({
          schemas: [SCIM_PATCH_OP_SCHEMA],
          Operations: [{ op: "replace", path: "displayName", value: "Platform" }],
        }),
      }
    );
    expect(bodyRequired.status).toBe(200);
    expect(engine.patchGroup).toHaveBeenLastCalledWith(
      "grp_engineering",
      expect.anything(),
      'W/"1"',
      baseUrl
    );
  });

  it("bounds bodies and rejects unsupported media types with SCIM errors", async () => {
    const app = createScimHttpApp(createEngine());
    const response = await app.request("https://mockos.test/scim/v2/Users", {
      method: "POST",
      headers: {
        authorization: headers.authorization,
        "content-type": "text/plain",
      },
      body: "not scim",
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ status: "415" });

    const excessivePatch = await app.request(
      "https://mockos.test/scim/v2/Users/usr_ada",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          schemas: [SCIM_PATCH_OP_SCHEMA],
          Operations: Array.from({ length: 101 }, () => ({
            op: "replace",
            path: "active",
            value: true,
          })),
        }),
      }
    );
    expect(excessivePatch.status).toBe(400);
    expect(await excessivePatch.json()).toMatchObject({
      status: "400",
      scimType: "tooMany",
    });

    const invalidPage = await app.request(
      "https://mockos.test/scim/v2/Users?count=201",
      { headers }
    );
    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.json()).toMatchObject({ scimType: "invalidValue" });

    const excessiveFilter = new URL("https://mockos.test/scim/v2/Users");
    excessiveFilter.searchParams.set("filter", "x".repeat(8_193));
    const invalidFilter = await app.request(excessiveFilter, { headers });
    expect(invalidFilter.status).toBe(400);
    expect(await invalidFilter.json()).toMatchObject({
      status: "400",
      scimType: "invalidFilter",
    });
  });

  it("handles malformed paths and unsupported methods as protocol errors", async () => {
    const app = createScimHttpApp(createEngine());
    const malformed = await app.request("https://mockos.test/scim/v2/Schemas/%ZZ", {
      headers,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      status: "400",
      scimType: "invalidPath",
    });

    const unsupported = await app.request(
      "https://mockos.test/scim/v2/ServiceProviderConfig",
      { method: "POST", headers }
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET");
  });
});
