import { beforeEach, describe, expect, it } from "vitest";
import {
  createTargetApp,
  MAX_TARGET_CAPTURE_STATE_BYTES,
  MAX_TARGET_SCIM_BODY_BYTES,
  TargetAppState,
} from "../src/app";

const bindings = {
  TARGET_SCIM_TOKEN: "scim-test-token",
  TARGET_CONTROL_TOKEN: "control-test-token",
};
const scimHeaders = {
  authorization: `Bearer ${bindings.TARGET_SCIM_TOKEN}`,
  "content-type": "application/scim+json",
};

const target = createTargetApp();

const request = (path: string, init?: RequestInit) =>
  target.app.request(`https://target.test${path}`, init, bindings);

beforeEach(() => target.state.reset());

describe("M5 target application", () => {
  it("echoes the local process-ownership nonce in health", async () => {
    const response = await target.app.request("https://target.test/health", undefined, {
      ...bindings,
      E2E_OWNER_NONCE: "owned-target-process",
    });
    expect(await response.json()).toEqual({
      status: "ok",
      service: "mockos-target-app",
      e2eOwnerNonce: "owned-target-process",
    });
  });

  it("authenticates before body capture and never records raw tokens", async () => {
    const unauthorized = await request("/scim/v2/Users");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer");

    const hidden = await request("/__test/requests");
    expect(hidden.status).toBe(401);

    const authorized = await request("/scim/v2/Users", {
      headers: { authorization: scimHeaders.authorization },
    });
    expect(authorized.status).toBe(200);

    const captured = await request("/__test/requests", {
      headers: { "x-target-control-token": bindings.TARGET_CONTROL_TOKEN },
    });
    expect(await captured.json()).toEqual({
      requests: [
        {
          sequence: 1,
          method: "GET",
          path: "/scim/v2/Users",
          query: {},
          headers: { authorization: "Bearer <redacted>" },
          body: null,
          responseStatus: 200,
        },
      ],
    });
  });

  it("rejects oversized authenticated bodies and bounds durable captures", async () => {
    const oversizedBody = JSON.stringify({
      userName: "large@example.test",
      padding: "x".repeat(MAX_TARGET_SCIM_BODY_BYTES),
    });
    const unauthorized = await request("/scim/v2/Users", {
      method: "POST",
      headers: { "content-type": "application/scim+json" },
      body: oversizedBody,
    });
    expect(unauthorized.status).toBe(401);
    expect(target.state.requests()).toEqual([]);

    const rejected = await request("/scim/v2/Users", {
      method: "POST",
      headers: scimHeaders,
      body: oversizedBody,
    });
    expect(rejected.status).toBe(413);
    expect(target.state.requests()).toEqual([]);

    for (let index = 0; index < 500; index += 1) {
      const response = await request("/scim/v2/Users", {
        headers: { authorization: scimHeaders.authorization },
      });
      expect(response.status).toBe(200);
    }
    const snapshot = target.state.snapshot();
    expect(
      new TextEncoder().encode(JSON.stringify(snapshot.captures)).byteLength
    ).toBeLessThanOrEqual(MAX_TARGET_CAPTURE_STATE_BYTES);
    expect(snapshot.captures.at(-1)?.sequence).toBe(500);
    expect(snapshot.captures[0]?.sequence).toBeGreaterThan(1);
  });

  it("captures a deterministic user and group provisioning sequence", async () => {
    const lookup = new URL("https://target.test/scim/v2/Users");
    lookup.searchParams.set("filter", 'userName eq "ada@example.test"');
    const missing = await request(`${lookup.pathname}${lookup.search}`, {
      headers: { authorization: scimHeaders.authorization },
    });
    expect(await missing.json()).toMatchObject({ totalResults: 0, Resources: [] });

    const createdUser = await request("/scim/v2/Users", {
      method: "POST",
      headers: scimHeaders,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "source-user-1",
        userName: "ada@example.test",
        displayName: "Ada Lovelace",
        active: true,
        emails: [{ type: "work", value: "ada@example.test", primary: true }],
      }),
    });
    expect(createdUser.status, await createdUser.clone().text()).toBe(201);
    expect(createdUser.headers.get("location")).toBe(
      "https://target.test/scim/v2/Users/usr-0001"
    );

    const patchedUser = await request("/scim/v2/Users/usr-0001", {
      method: "PATCH",
      headers: scimHeaders,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "Replace", path: "active", value: false },
          {
            op: "Replace",
            path: 'emails[type eq "work"].value',
            value: "ada.lovelace@example.test",
          },
        ],
      }),
    });
    expect(await patchedUser.json()).toMatchObject({
      id: "usr-0001",
      active: false,
      emails: [{ type: "work", value: "ada.lovelace@example.test" }],
      meta: { version: 'W/"2"' },
    });

    const createdGroup = await request("/scim/v2/Groups", {
      method: "POST",
      headers: scimHeaders,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        externalId: "source-group-1",
        displayName: "Engineering",
        members: [{ value: "usr-0001" }],
      }),
    });
    expect(createdGroup.status, await createdGroup.clone().text()).toBe(201);
    expect(await createdGroup.json()).toMatchObject({ id: "grp-0001" });

    const captures = target.state.requests();
    expect(
      captures.map(({ sequence, method, path, responseStatus }) => ({
        sequence,
        method,
        path,
        responseStatus,
      }))
    ).toEqual([
      { sequence: 1, method: "GET", path: "/scim/v2/Users", responseStatus: 200 },
      { sequence: 2, method: "POST", path: "/scim/v2/Users", responseStatus: 201 },
      {
        sequence: 3,
        method: "PATCH",
        path: "/scim/v2/Users/usr-0001",
        responseStatus: 200,
      },
      { sequence: 4, method: "POST", path: "/scim/v2/Groups", responseStatus: 201 },
    ]);
    expect(captures[1]).toMatchObject({
      headers: {
        authorization: "Bearer <redacted>",
        "content-type": "application/scim+json",
      },
      body: { userName: "ada@example.test" },
    });
  });

  it("rejects prototype-bearing SCIM PATCH input without mutating object prototypes", async () => {
    const created = await request("/scim/v2/Users", {
      method: "POST",
      headers: scimHeaders,
      body: JSON.stringify({ userName: "safe@example.test", active: true }),
    });
    expect(created.status).toBe(201);

    const maliciousBodies = [
      '{"Operations":[{"op":"replace","path":"__proto__.polluted","value":"yes"}]}',
      '{"Operations":[{"op":"remove","path":"constructor.prototype.polluted"}]}',
      '{"Operations":[{"op":"replace","value":{"profile":{"constructor":{"prototype":{"polluted":"yes"}}}}}]}',
    ];

    for (const body of maliciousBodies) {
      const response = await request("/scim/v2/Users/usr-0001", {
        method: "PATCH",
        headers: scimHeaders,
        body,
      });
      expect(response.status, await response.clone().text()).toBe(400);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }

    expect(target.state.users()).toMatchObject([
      { id: "usr-0001", userName: "safe@example.test", active: true },
    ]);
  });

  it("resets deterministic IDs, captures, and resource state through the harness", async () => {
    const createUser = () =>
      request("/scim/v2/Users", {
        method: "POST",
        headers: scimHeaders,
        body: JSON.stringify({ userName: "grace@example.test", active: true }),
      });

    expect(await (await createUser()).json()).toMatchObject({ id: "usr-0001" });
    const reset = await request("/__test/reset", {
      method: "POST",
      headers: { "x-target-control-token": bindings.TARGET_CONTROL_TOKEN },
    });
    expect(await reset.json()).toEqual({ reset: true });
    expect(target.state.users()).toEqual([]);
    expect(target.state.groups()).toEqual([]);
    expect(await (await createUser()).json()).toMatchObject({
      id: "usr-0001",
      meta: {
        created: "2026-01-01T00:00:00.000Z",
        version: 'W/"1"',
      },
    });
    expect(target.state.requests()).toHaveLength(1);
  });

  it("round-trips deterministic resource and capture state for Durable Objects", async () => {
    const created = await request("/scim/v2/Users", {
      method: "POST",
      headers: scimHeaders,
      body: JSON.stringify({ userName: "durable@example.test", active: true }),
    });
    expect(created.status).toBe(201);

    const restored = new TargetAppState(target.state.snapshot());
    expect(restored.users()).toMatchObject([
      { id: "usr-0001", userName: "durable@example.test" },
    ]);
    expect(restored.requests()).toMatchObject([
      { sequence: 1, method: "POST", responseStatus: 201 },
    ]);
    expect(
      restored.create(
        "Users",
        { userName: "next@example.test" },
        new Request("https://target.test/scim/v2/Users")
      )
    ).toMatchObject({
      id: "usr-0002",
    });
  });
});
