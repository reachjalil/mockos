import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  SCIM_BEFORE_COMMIT_INJECTION_POINT,
  SCIM_PATCH_PARSE_INJECTION_POINT,
  type AssertionSpec,
  type RequestLogEntry,
  scenarioSpecSchema,
} from "@mockos/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  CORE_MIGRATIONS,
  Engine,
  FixedClock,
  getSchemaVersion,
  MAX_ASSERTION_REQUEST_IDS,
  MAX_REQUEST_LOG_BODY_BYTES,
  MAX_REQUEST_LOG_HEADER_BYTES,
  MAX_SCENARIO_DELAY_MS,
  MAX_SCENARIO_SPEC_BYTES,
  RequestLogCursorError,
  RequestLogEntryTooLargeError,
  RequestLogService,
  ScenarioService,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
} from "./index";

class MemorySqlStore implements SqlStore {
  readonly database = new DatabaseSync(":memory:");
  #transactionDepth = 0;

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const result = this.database.prepare(sql).run(...(bindings as SQLInputValue[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[] {
    return this.database
      .prepare(sql)
      .all(...(bindings as SQLInputValue[])) as unknown as T[];
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined {
    return this.database.prepare(sql).get(...(bindings as SQLInputValue[])) as
      | T
      | undefined;
  }

  transaction<T>(callback: () => T): T {
    if (this.#transactionDepth > 0) return callback();
    this.database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth += 1;
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  close(): void {
    this.database.close();
  }
}

const stores: MemorySqlStore[] = [];
const memoryStore = () => {
  const store = new MemorySqlStore();
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const scenarioService = (seed: string) => {
  const store = memoryStore();
  applyMigrations(store);
  return {
    store,
    service: new ScenarioService({
      store,
      seed,
      clock: new FixedClock("2026-07-22T12:00:00.000Z"),
    }),
  };
};

describe("scenario service", () => {
  it("upgrades v2 scenario rows through later append-only migrations", () => {
    const store = memoryStore();
    expect(applyMigrations(store, CORE_MIGRATIONS.slice(0, 2))).toBe(2);
    const legacy = scenarioSpecSchema.parse({
      id: "legacy",
      injectionPoint: "oauth.token",
      action: { type: "error", code: "INVALID_GRANT" },
      remaining: 1,
    });
    store.run(
      `INSERT INTO scenarios (
        id, injection_point, spec_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
      legacy.id,
      legacy.injectionPoint,
      JSON.stringify(legacy),
      "2026-07-22T12:00:00.000Z",
      "2026-07-22T12:00:00.000Z"
    );

    expect(applyMigrations(store)).toBe(5);
    expect(getSchemaVersion(store)).toBe(5);
    const service = new ScenarioService({
      store,
      seed: "upgrade",
      clock: new FixedClock("2026-07-22T12:00:00.000Z"),
    });
    expect(service.decide("oauth.token")).toMatchObject({
      type: "error",
      scenarioId: "legacy",
    });
    expect(
      store.get<{ evaluations: number; remaining: number; enabled: number }>(
        "SELECT evaluations, remaining, enabled FROM scenarios WHERE id = 'legacy'"
      )
    ).toEqual({ evaluations: 1, remaining: 0, enabled: 0 });
  });

  it("prefers exact matches, falls back to *, and replaces and clears scenarios", () => {
    const { store, service } = scenarioService("scenario-order");
    service.set(
      scenarioSpecSchema.parse({
        id: "exact",
        injectionPoint: "oauth.token",
        action: { type: "error", code: "MFA_REQUIRED" },
        remaining: 2,
      })
    );
    service.set(
      scenarioSpecSchema.parse({
        id: "catch-all",
        injectionPoint: "*",
        action: { type: "mutate", patch: { marker: "fallback" } },
      })
    );

    expect(service.decideExact(SCIM_BEFORE_COMMIT_INJECTION_POINT)).toEqual({
      type: "pass",
    });
    expect(
      store.get<{ evaluations: number }>(
        "SELECT evaluations FROM scenarios WHERE id = 'catch-all'"
      )
    ).toEqual({ evaluations: 0 });

    expect(service.decide("oauth.token", { clientId: "client" })).toEqual({
      type: "error",
      scenarioId: "exact",
      injectionPoint: "oauth.token",
      code: "MFA_REQUIRED",
    });
    expect(service.decide("oauth.token")).toMatchObject({
      type: "error",
      scenarioId: "exact",
    });
    expect(service.decide("oauth.token")).toEqual({
      type: "mutate",
      scenarioId: "catch-all",
      injectionPoint: "*",
      patch: { marker: "fallback" },
    });
    expect(
      store.get<{ evaluations: number; remaining: number; enabled: number }>(
        "SELECT evaluations, remaining, enabled FROM scenarios WHERE id = 'exact'"
      )
    ).toEqual({ evaluations: 2, remaining: 0, enabled: 0 });

    service.replace(
      scenarioSpecSchema.parse({
        id: "exact",
        injectionPoint: "oauth.token",
        action: { type: "delay", milliseconds: 125 },
        remaining: 1,
      })
    );
    expect(service.decide("oauth.token")).toEqual({
      type: "delay",
      scenarioId: "exact",
      injectionPoint: "oauth.token",
      milliseconds: 125,
    });
    expect(service.list().find(({ id }) => id === "exact")).toMatchObject({
      id: "exact",
      enabled: false,
      action: { type: "delay", milliseconds: 125 },
    });
    expect(service.clear("exact")).toBe(1);
    expect(service.clear()).toBe(1);
    expect(service.list()).toEqual([]);
  });

  it("makes probability sequences stable for a seed and persists every draw", () => {
    const decisions = (seed: string) => {
      const { store, service } = scenarioService(seed);
      service.set(
        scenarioSpecSchema.parse({
          id: "coin-flip",
          injectionPoint: "oauth.token",
          action: { type: "error", code: "RATE_LIMITED" },
          probability: 0.5,
        })
      );
      const values = Array.from(
        { length: 12 },
        () => service.decide("oauth.token").type
      );
      const evaluations = store.get<{ evaluations: number }>(
        "SELECT evaluations FROM scenarios WHERE id = 'coin-flip'"
      )?.evaluations;
      return { values, evaluations };
    };

    expect(decisions("same-seed")).toEqual(decisions("same-seed"));
    expect(decisions("same-seed").values).not.toEqual(
      decisions("different-seed").values
    );
    expect(decisions("same-seed").evaluations).toBe(12);
  });

  it("rolls back the probability counter and remaining consumption together", () => {
    const { store, service } = scenarioService("rollback");
    service.set(
      scenarioSpecSchema.parse({
        id: "once",
        injectionPoint: "oauth.token",
        action: { type: "error", code: "INVALID_GRANT" },
        remaining: 1,
      })
    );
    store.database.exec(`CREATE TRIGGER reject_scenario_update
      BEFORE UPDATE ON scenarios
      BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
    expect(() => service.decide("oauth.token")).toThrow(/forced rollback/);
    expect(
      store.get<{ evaluations: number; remaining: number; enabled: number }>(
        "SELECT evaluations, remaining, enabled FROM scenarios WHERE id = 'once'"
      )
    ).toEqual({ evaluations: 0, remaining: 1, enabled: 1 });

    store.database.exec("DROP TRIGGER reject_scenario_update");
    expect(service.decide("oauth.token")).toMatchObject({
      type: "error",
      scenarioId: "once",
    });
    expect(
      store.get<{ evaluations: number; remaining: number; enabled: number }>(
        "SELECT evaluations, remaining, enabled FROM scenarios WHERE id = 'once'"
      )
    ).toEqual({ evaluations: 1, remaining: 0, enabled: 0 });
  });

  it("persists typed SCIM decisions and disables one-shot replays", () => {
    const { service } = scenarioService("scim-edge-decisions");
    service.set(
      scenarioSpecSchema.parse({
        id: "soft-delete-once",
        injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
        action: { type: "scim_soft_delete_race" },
        remaining: 1,
      })
    );
    service.set(
      scenarioSpecSchema.parse({
        id: "missing-schemas-once",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: {
          type: "scim_patch_tolerance",
          malformedCase: "missing_schemas",
        },
        remaining: 1,
      })
    );

    expect(service.decide(SCIM_BEFORE_COMMIT_INJECTION_POINT)).toEqual({
      type: "scim_soft_delete_race",
      scenarioId: "soft-delete-once",
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
    });
    expect(service.decide(SCIM_BEFORE_COMMIT_INJECTION_POINT)).toEqual({
      type: "pass",
    });
    expect(service.decide(SCIM_PATCH_PARSE_INJECTION_POINT)).toEqual({
      type: "scim_patch_tolerance",
      scenarioId: "missing-schemas-once",
      injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
      malformedCase: "missing_schemas",
    });
    expect(service.decide(SCIM_PATCH_PARSE_INJECTION_POINT)).toEqual({
      type: "pass",
    });
  });

  it("rejects delays and serialized mutation patches above defensive caps", () => {
    const { service } = scenarioService("caps");
    expect(() =>
      service.set({
        id: "long-delay",
        injectionPoint: "*",
        action: { type: "delay", milliseconds: MAX_SCENARIO_DELAY_MS + 1 },
        probability: 1,
        enabled: true,
      })
    ).toThrow();
    expect(() =>
      service.set({
        id: "large-patch",
        injectionPoint: "*",
        action: {
          type: "mutate",
          patch: { value: "x".repeat(MAX_SCENARIO_SPEC_BYTES) },
        },
        probability: 1,
        enabled: true,
      })
    ).toThrow(/cannot exceed/);
  });
});

const logEntry = (input: {
  readonly id: string;
  readonly source: RequestLogEntry["source"];
  readonly method: string;
  readonly path: string;
  readonly requestBody: string | null;
  readonly responseStatus: number;
}): RequestLogEntry => ({
  id: input.id,
  timestamp: "2026-07-22T12:00:00.000Z",
  source: input.source,
  provider: "okta",
  method: input.method,
  path: input.path,
  requestHeaders: { "content-type": "application/json" },
  requestBody: input.requestBody,
  responseStatus: input.responseStatus,
  responseHeaders: { "x-okta-request-id": input.id },
  responseBody: `{"request":"${input.id}"}`,
  durationMs: 5,
  correlationId: `correlation-${input.id}`,
});

describe("request log service", () => {
  it("trims transactionally and paginates newest-first with bound opaque cursors", async () => {
    const store = memoryStore();
    const engine = Engine.create(
      { provider: "okta", seed: "request-log", requestLogLimit: 3 },
      { store, clock: new FixedClock("2026-07-22T12:00:00.000Z") }
    );
    await engine.initialize();
    engine.requestLog.append(
      logEntry({
        id: "request-1",
        source: "control",
        method: "GET",
        path: "/oldest",
        requestBody: null,
        responseStatus: 200,
      })
    );
    engine.requestLog.append(
      logEntry({
        id: "request-2",
        source: "outbound",
        method: "PATCH",
        path: "/trimmed",
        requestBody: "trimmed",
        responseStatus: 204,
      })
    );
    engine.requestLog.append(
      logEntry({
        id: "request-3",
        source: "inbound",
        method: "post",
        path: "/oauth2/default/v1/token",
        requestBody: "alpha payload",
        responseStatus: 400,
      })
    );
    engine.requestLog.append(
      logEntry({
        id: "request-4",
        source: "outbound",
        method: "GET",
        path: "/api/v1/users",
        requestBody: null,
        responseStatus: 200,
      })
    );
    engine.requestLog.append(
      logEntry({
        id: "request-5",
        source: "inbound",
        method: "POST",
        path: "/oauth2/default/v1/token",
        requestBody: "beta payload",
        responseStatus: 200,
      })
    );

    expect(engine.getRequestLog({ limit: 10 }).entries.map(({ id }) => id)).toEqual([
      "request-5",
      "request-4",
      "request-3",
    ]);
    expect(() =>
      engine.requestLog.append(
        logEntry({
          id: "request-5",
          source: "inbound",
          method: "POST",
          path: "/duplicate",
          requestBody: null,
          responseStatus: 200,
        })
      )
    ).toThrow();
    expect(
      store.get<{ count: number }>("SELECT count(*) AS count FROM request_log")
    ).toEqual({ count: 3 });

    const first = engine.getRequestLog({
      source: "inbound",
      method: "post",
      path: "/oauth2/default/v1/token",
      limit: 1,
    });
    expect(first.entries.map(({ id, method }) => ({ id, method }))).toEqual([
      { id: "request-5", method: "POST" },
    ]);
    expect(first.nextCursor).toBeTypeOf("string");
    expect(first.nextCursor).not.toContain("request-5");
    const second = engine.getRequestLog({
      source: "inbound",
      method: "POST",
      path: "/oauth2/default/v1/token",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.entries.map(({ id }) => id)).toEqual(["request-3"]);
    expect(second.nextCursor).toBeUndefined();

    expect(() =>
      engine.getRequestLog({ limit: 1, cursor: "not-a-valid-cursor!" })
    ).toThrow(RequestLogCursorError);
    expect(() =>
      engine.getRequestLog({
        source: "inbound",
        method: "POST",
        path: "/different-path",
        limit: 1,
        cursor: first.nextCursor,
      })
    ).toThrow(/does not match/);
  });

  it("asserts count, source, method, path, status, body, and request IDs", async () => {
    const store = memoryStore();
    const engine = Engine.create(
      { provider: "okta", seed: "assertions", requestLogLimit: 10 },
      { store, clock: new FixedClock("2026-07-22T12:00:00.000Z") }
    );
    await engine.initialize();
    for (const entry of [
      logEntry({
        id: "match-old",
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        requestBody: "alpha payload",
        responseStatus: 400,
      }),
      logEntry({
        id: "not-source",
        source: "outbound",
        method: "POST",
        path: "/v1/token",
        requestBody: "alpha payload",
        responseStatus: 400,
      }),
      logEntry({
        id: "match-new",
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        requestBody: "beta payload",
        responseStatus: 200,
      }),
    ]) {
      engine.log.append(entry);
    }

    const exact: AssertionSpec = {
      source: "inbound",
      method: "post",
      path: "/v1/token",
      status: 400,
      bodyIncludes: "alpha",
      count: { exactly: 1 },
    };
    expect(engine.assertRequests(exact)).toEqual({
      pass: true,
      matched: 1,
      message: "Matched 1 request(s); expected exactly 1.",
      requestIds: ["match-old"],
    });
    expect(
      engine.assertRequests({
        responseBodyIncludes: '"request":"match-new"',
        count: { exactly: 1 },
      })
    ).toMatchObject({ pass: true, matched: 1, requestIds: ["match-new"] });
    expect(
      engine.assertRequests({
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        count: { atLeast: 2, atMost: 2 },
      })
    ).toMatchObject({
      pass: true,
      matched: 2,
      requestIds: ["match-new", "match-old"],
    });
    expect(
      engine.requestLog.assert({
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        count: { atMost: 1 },
      })
    ).toMatchObject({
      pass: false,
      matched: 2,
      requestIds: ["match-new", "match-old"],
    });
  });

  it("asserts an ordered outbound sequence with request and response shapes", async () => {
    const store = memoryStore();
    const engine = Engine.create(
      { provider: "entra", seed: "ordered-assertions", requestLogLimit: 10 },
      { store, clock: new FixedClock("2026-07-22T12:00:00.000Z") }
    );
    await engine.initialize();
    for (const entry of [
      logEntry({
        id: "lookup-user",
        source: "outbound",
        method: "GET",
        path: "/scim/v2/Users",
        requestBody: null,
        responseStatus: 200,
      }),
      logEntry({
        id: "create-user",
        source: "outbound",
        method: "POST",
        path: "/scim/v2/Users",
        requestBody: '{"userName":"ada@example.test"}',
        responseStatus: 201,
      }),
      logEntry({
        id: "create-group",
        source: "outbound",
        method: "POST",
        path: "/scim/v2/Groups",
        requestBody: '{"displayName":"Engineering"}',
        responseStatus: 201,
      }),
    ]) {
      engine.log.append(entry);
    }

    expect(
      engine.assertRequests({
        source: "outbound",
        sequence: [
          { method: "GET", path: "/scim/v2/Users" },
          {
            method: "POST",
            path: "/scim/v2/Users",
            bodyIncludes: "ada@example.test",
            responseBodyIncludes: "create-user",
          },
          {
            method: "POST",
            path: "/scim/v2/Groups",
            bodyIncludes: "Engineering",
          },
        ],
        count: { exactly: 1 },
      })
    ).toEqual({
      pass: true,
      matched: 1,
      message:
        "Matched 1 non-overlapping ordered request sequence(s); expected exactly 1.",
      requestIds: ["lookup-user", "create-user", "create-group"],
    });

    expect(
      engine.assertRequests({
        source: "outbound",
        sequence: [{ path: "/scim/v2/Groups" }, { path: "/scim/v2/Users" }],
        count: { atLeast: 1 },
      })
    ).toMatchObject({ pass: false, matched: 0, requestIds: [] });

    for (const entry of [
      logEntry({
        id: "lookup-user-2",
        source: "outbound",
        method: "GET",
        path: "/scim/v2/Users",
        requestBody: null,
        responseStatus: 200,
      }),
      logEntry({
        id: "create-user-2",
        source: "outbound",
        method: "POST",
        path: "/scim/v2/Users",
        requestBody: '{"userName":"grace@example.test"}',
        responseStatus: 201,
      }),
      logEntry({
        id: "create-group-2",
        source: "outbound",
        method: "POST",
        path: "/scim/v2/Groups",
        requestBody: '{"displayName":"Operations"}',
        responseStatus: 201,
      }),
    ]) {
      engine.log.append(entry);
    }

    expect(
      engine.assertRequests({
        source: "outbound",
        sequence: [
          { method: "GET", path: "/scim/v2/Users" },
          { method: "POST", path: "/scim/v2/Users" },
          { method: "POST", path: "/scim/v2/Groups" },
        ],
        count: { exactly: 2 },
      })
    ).toEqual({
      pass: true,
      matched: 2,
      message:
        "Matched 2 non-overlapping ordered request sequence(s); expected exactly 2.",
      requestIds: [
        "lookup-user",
        "create-user",
        "create-group",
        "lookup-user-2",
        "create-user-2",
        "create-group-2",
      ],
    });
  });

  it("rejects oversized entries and bounds assertion request IDs", async () => {
    const store = memoryStore();
    const engine = Engine.create(
      { provider: "okta", seed: "bounded-logs", requestLogLimit: 2_000 },
      { store, clock: new FixedClock("2026-07-22T12:00:00.000Z") }
    );
    await engine.initialize();
    expect(() =>
      engine.log.append(
        logEntry({
          id: "oversized",
          source: "inbound",
          method: "POST",
          path: "/v1/token",
          requestBody: "x".repeat(MAX_REQUEST_LOG_BODY_BYTES + 1),
          responseStatus: 200,
        })
      )
    ).toThrow(RequestLogEntryTooLargeError);
    expect(() =>
      engine.log.append({
        ...logEntry({
          id: "oversized-headers",
          source: "inbound",
          method: "POST",
          path: "/v1/token",
          requestBody: null,
          responseStatus: 200,
        }),
        requestHeaders: { value: "x".repeat(MAX_REQUEST_LOG_HEADER_BYTES) },
      })
    ).toThrow(RequestLogEntryTooLargeError);

    for (let index = 0; index < MAX_ASSERTION_REQUEST_IDS + 5; index += 1) {
      engine.log.append(
        logEntry({
          id: `bounded-${index.toString().padStart(4, "0")}`,
          source: "control",
          method: "POST",
          path: "/bulk",
          requestBody: null,
          responseStatus: 200,
        })
      );
    }
    const result = engine.assertRequests({
      source: "control",
      path: "/bulk",
      count: { exactly: MAX_ASSERTION_REQUEST_IDS + 5 },
    });
    expect(result).toMatchObject({
      pass: true,
      matched: MAX_ASSERTION_REQUEST_IDS + 5,
    });
    expect(result.requestIds).toHaveLength(MAX_ASSERTION_REQUEST_IDS);
    expect(result.requestIds[0]).toBe("bounded-1004");
    expect(result.message).toContain("Returning the newest 1000 request IDs");
  });

  it("trims before insertion when the total byte budget is reached", () => {
    const store = memoryStore();
    applyMigrations(store);
    const service = new RequestLogService({
      store,
      limit: 100,
      maxBytes: 2_048,
    });

    service.append(
      logEntry({
        id: "byte-budget-old",
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        requestBody: "x".repeat(900),
        responseStatus: 200,
      })
    );
    service.append(
      logEntry({
        id: "byte-budget-new",
        source: "inbound",
        method: "POST",
        path: "/v1/token",
        requestBody: "y".repeat(900),
        responseStatus: 200,
      })
    );

    expect(service.query({ limit: 10 }).entries.map(({ id }) => id)).toEqual([
      "byte-budget-new",
    ]);
  });
});
