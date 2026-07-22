import { describe, expect, it } from "vitest";
import { createGraphHttpApp, type GraphDirectoryEngine } from "./graph";

const engine: GraphDirectoryEngine = {
  listUsers: () => [
    {
      id: "usr_ada",
      userName: "ada@example.test",
      displayName: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
      accountEnabled: true,
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    {
      id: "usr_grace",
      userName: "grace@example.test",
      displayName: "Grace Hopper",
      accountEnabled: false,
      createdAt: "2026-07-22T00:00:01.000Z",
    },
  ],
  getUser(id) {
    return this.listUsers().find((user) => user.id === id);
  },
  listGroups: () => [
    {
      id: "grp_engineering",
      displayName: "Engineering",
      createdAt: "2026-07-22T00:00:02.000Z",
    },
  ],
  getGroup(id) {
    return this.listGroups().find((group) => group.id === id);
  },
  listGroupMembers: (id) =>
    id === "grp_engineering" ? engine.listUsers().slice(0, 1) : [],
  listUserGroups: (id) => (id === "usr_ada" ? engine.listGroups() : []),
  listUserGroupIds: (id, limit) =>
    id === "usr_ada"
      ? engine
          .listGroups()
          .slice(0, limit)
          .map(({ id }) => id)
      : [],
};

const app = createGraphHttpApp({
  engine,
  now: () => new Date("2026-07-22T12:00:00.000Z"),
  requestId: () => "request-1",
});

const authorization = { authorization: "Bearer mock-graph-credential" };

const oversizedStreamRequest = (declaredLength?: string) => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(4_097));
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers({
    ...authorization,
    "content-type": "Application/JSON; Charset=UTF-8",
  });
  if (declaredLength !== undefined) headers.set("content-length", declaredLength);
  const request = new Request(
    "https://mockos.test/graph/v1.0/users/usr_ada/getMemberObjects",
    {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }
  );
  return {
    request,
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
};

describe("Microsoft Graph read adapter", () => {
  it("requires a non-empty mock Bearer credential", async () => {
    const response = await app.request("https://mockos.test/graph/v1.0/users");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(await response.json()).toMatchObject({
      error: { code: "InvalidAuthenticationToken" },
    });

    const lowerCaseScheme = await app.request(
      "https://mockos.test/graph/v1.0/users?$top=1",
      { headers: { authorization: "bearer mock-token" } }
    );
    expect(lowerCaseScheme.status).toBe(200);
  });

  it("filters, projects, pages, and keeps the public path in nextLink", async () => {
    const response = await app.request(
      "https://mockos.test/graph/v1.0/users?%24top=1&%24select=id%2CdisplayName",
      {
        headers: {
          ...authorization,
          "x-mockos-public-path": "/e/env_test/graph/v1.0/users",
        },
      }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      value: Array<Record<string, unknown>>;
      "@odata.nextLink": string;
    };
    expect(body.value).toEqual([{ id: "usr_ada", displayName: "Ada Lovelace" }]);
    const next = new URL(body["@odata.nextLink"]);
    expect(next.pathname).toBe("/e/env_test/graph/v1.0/users");
    expect(next.searchParams.get("$top")).toBe("1");
    expect(next.searchParams.get("$select")).toBe("id,displayName");
    expect(next.searchParams.get("$skiptoken")).toBe("1");

    const filtered = await app.request(
      "https://mockos.test/graph/v1.0/users?%24filter=userPrincipalName%20eq%20%27GRACE%40EXAMPLE.TEST%27",
      { headers: authorization }
    );
    expect(await filtered.json()).toMatchObject({
      value: [{ id: "usr_grace", accountEnabled: false }],
    });
  });

  it("returns users, groups, and direct memberships with Graph-shaped errors", async () => {
    const memberResponse = await app.request(
      "https://mockos.test/graph/v1.0/groups/grp_engineering/members",
      { headers: authorization }
    );
    expect(await memberResponse.json()).toMatchObject({
      value: [{ id: "usr_ada", userPrincipalName: "ada@example.test" }],
    });

    const membershipResponse = await app.request(
      "https://mockos.test/graph/v1.0/users/usr_ada/memberOf",
      { headers: authorization }
    );
    expect(await membershipResponse.json()).toMatchObject({
      value: [{ id: "grp_engineering", displayName: "Engineering" }],
    });

    const projectedMembership = await app.request(
      "https://mockos.test/graph/v1.0/users/usr_ada/memberOf?%24select=id",
      { headers: authorization }
    );
    expect(await projectedMembership.json()).toMatchObject({
      value: [{ id: "grp_engineering" }],
    });

    const missing = await app.request("https://mockos.test/graph/v1.0/users/missing", {
      headers: authorization,
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("request-id")).toBe("request-1");
    expect(await missing.json()).toMatchObject({
      error: { code: "Request_ResourceNotFound" },
    });
  });

  it("resolves group-overage IDs through bounded getMemberObjects", async () => {
    const response = await app.request(
      "https://mockos.test/graph/v1.0/users/usr_ada/getMemberObjects",
      {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "Application/JSON; Charset=UTF-8",
        },
        body: JSON.stringify({ securityEnabledOnly: true }),
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      "@odata.context": "$metadata#Collection(Edm.String)",
      value: ["grp_engineering"],
    });

    for (const body of [
      "not-json",
      JSON.stringify({ securityEnabledOnly: "yes" }),
      JSON.stringify({ securityEnabledOnly: true, endpoint: "https://attacker.test" }),
    ]) {
      const invalid = await app.request(
        "https://mockos.test/graph/v1.0/users/usr_ada/getMemberObjects",
        {
          method: "POST",
          headers: { ...authorization, "content-type": "application/json" },
          body,
        }
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({
        error: { code: "Request_BadRequest" },
      });
    }

    const oversized = await app.request(
      "https://mockos.test/graph/v1.0/users/usr_ada/getMemberObjects",
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ securityEnabledOnly: true, padding: "x".repeat(4_096) }),
      }
    );
    expect(oversized.status).toBe(413);

    for (const declaredLength of [undefined, "1"]) {
      const streamed = oversizedStreamRequest(declaredLength);
      const streamedResponse = await app.request(streamed.request);
      expect(streamedResponse.status).toBe(413);
      expect(streamed.cancelled()).toBe(true);
      expect(streamed.pulls()).toBeLessThanOrEqual(2);
    }

    let requestedLimit = 0;
    const oversizedMembershipApp = createGraphHttpApp({
      engine: {
        ...engine,
        listUserGroupIds: (_userId, limit) => {
          requestedLimit = limit;
          return Array.from({ length: limit }, (_, index) => `grp_${index}`);
        },
      },
    });
    const tooMany = await oversizedMembershipApp.request(
      "https://mockos.test/graph/v1.0/users/usr_ada/getMemberObjects",
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ securityEnabledOnly: true }),
      }
    );
    expect(requestedLimit).toBe(1_001);
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({
      error: { code: "Directory_ResultSizeLimitExceeded" },
    });
  });

  it("bounds and validates query options, cursors, routed paths, and methods", async () => {
    for (const query of [
      "%24top=0",
      "%24skip=1",
      "%24select=id%2CunsupportedProperty",
    ]) {
      const response = await app.request(
        `https://mockos.test/graph/v1.0/users?${query}`,
        { headers: authorization }
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "Request_UnsupportedQuery" },
      });
    }

    const malformed = await app.request("https://mockos.test/graph/v1.0/users/%ZZ", {
      headers: authorization,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "BadRequest" } });

    const badPublicPath = await app.request(
      "https://mockos.test/graph/v1.0/users?%24top=1",
      {
        headers: {
          ...authorization,
          "x-mockos-public-path": "/e/env/graph/v1.0/users?unexpected=true",
        },
      }
    );
    expect(badPublicPath.status).toBe(400);

    const unsupportedMethod = await app.request(
      "https://mockos.test/graph/v1.0/users",
      { method: "POST", headers: authorization }
    );
    expect(unsupportedMethod.status).toBe(405);
    expect(unsupportedMethod.headers.get("allow")).toBe("GET");
  });
});
