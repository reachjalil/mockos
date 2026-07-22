import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  ProvisioningHttpOperation,
  ProvisioningWorkflowParams,
} from "@mockos/contracts";
import {
  applyMigrations,
  type SqlRow,
  type SqlRunResult,
  type SqlStore,
  type SqlValue,
} from "@mockos/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActiveProvisioningRunError,
  ProvisioningPersistence,
} from "./provisioning-persistence";

class MemorySqlStore implements SqlStore {
  readonly database = new DatabaseSync(":memory:");
  #transactionDepth = 0;

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const result = this.database.prepare(sql).run(...(bindings as SQLInputValue[]));
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
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
const persistence = () => {
  const store = new MemorySqlStore();
  stores.push(store);
  applyMigrations(store);
  return new ProvisioningPersistence(store);
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const now = "2026-07-22T12:00:00.000Z";
const target = (token: string) => ({
  ref: "target-app",
  baseUrl: "https://target.example.com/scim/v2",
  auth: { kind: "bearer" as const, token },
  behavior: {},
});
const params = (
  runId: string,
  appId = "app-one",
  targetRef = "target-app"
): ProvisioningWorkflowParams => ({
  envId: "env_test01",
  appId,
  runId,
  mode: "incremental",
  targetRef,
});
const inlineSelector = { kind: "inline" as const, save: false };

describe("ProvisioningPersistence", () => {
  it("accepts an exact staged ingress retry but rejects credential replacement", () => {
    const subject = persistence();
    const first = subject.stageTarget("run-one", target("synthetic-token-one"), now);
    const replay = subject.stageTarget("run-one", target("synthetic-token-one"), now);
    expect(replay).toEqual(first);
    expect(() =>
      subject.stageTarget("run-one", target("synthetic-token-two"), now)
    ).toThrow("cannot be replaced");
    expect(
      subject.revalidateInlineTarget("run-one", target("synthetic-token-one"))
    ).toEqual(first);
    expect(() =>
      subject.revalidateInlineTarget("run-one", target("synthetic-token-two"))
    ).toThrow("cannot be replaced");
  });

  it("persists and enforces inline save intent for exact run recovery", () => {
    const subject = persistence();
    subject.stageTarget("run-selector", target("synthetic-token-one"), now);
    subject.queueRun(params("run-selector"), "entra", now, inlineSelector);
    expect(subject.getRunTargetSelector("run-selector")).toEqual(inlineSelector);
    expect(() =>
      subject.queueRun(params("run-selector"), "entra", now, {
        kind: "inline",
        save: true,
      })
    ).toThrow("cannot be replaced");
  });

  it("freezes saved target metadata and credentials for an in-flight run", () => {
    const subject = persistence();
    const first = subject.saveTarget(target("synthetic-token-one"), now);
    subject.stageSavedTarget("run-one", "target-app", now);
    const second = subject.saveTarget(
      target("synthetic-token-two"),
      "2026-07-22T12:01:00.000Z"
    );

    const frozen = subject.resolveTarget("target-app", "run-one");
    expect(frozen.target.auth).toEqual(first.auth);
    expect(frozen.target.auth).not.toEqual(second.auth);
    expect(frozen.bearerToken).toBe("synthetic-token-one");
  });

  it("serializes active app/target runs and releases the lock at terminal state", () => {
    const subject = persistence();
    const first = subject.queueRun(params("run-one"), "entra", now, inlineSelector);
    expect(subject.getActiveRun("app-one", "target-app")).toEqual(first);
    expect(() =>
      subject.queueRun(params("run-two"), "entra", now, inlineSelector)
    ).toThrow(ActiveProvisioningRunError);
    expect(() =>
      subject.queueRun(params("run-other-app", "app-two"), "entra", now, inlineSelector)
    ).not.toThrow();
    expect(() =>
      subject.queueRun(
        params("run-other-target", "app-one", "other-target"),
        "entra",
        now,
        inlineSelector
      )
    ).not.toThrow();

    subject.failRun("run-one", "Fixture complete.", now);
    expect(subject.getActiveRun("app-one", "target-app")).toBeUndefined();
    expect(() =>
      subject.queueRun(params("run-two"), "entra", now, inlineSelector)
    ).not.toThrow();
  });

  it("prunes replay bodies explicitly at terminal cleanup", () => {
    const subject = persistence();
    subject.queueRun(params("run-prune"), "entra", now, inlineSelector);
    const operation: ProvisioningHttpOperation = {
      type: "http",
      id: "op-1-user-lookup",
      sequence: 1,
      provider: "entra",
      resourceType: "User",
      action: "lookup",
      sourceId: "user-1",
      sourceVersion: 1,
      source: {
        resourceType: "User",
        id: "user-1",
        userName: "ada@example.com",
        displayName: "Ada Lovelace",
        active: true,
        deleted: false,
        version: 1,
      },
      behavior: {},
      attempt: 1,
      request: {
        method: "GET",
        path: "/Users?filter=userName%20eq%20%22ada%40example.com%22",
        headers: { accept: "application/scim+json" },
      },
    };
    const result = {
      response: { status: 200, headers: {}, body: { totalResults: 0, Resources: [] } },
      log: {
        id: "run-prune:execute:1",
        timestamp: now,
        method: "GET",
        path: "/Users",
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseHeaders: {},
        responseBody: '{"totalResults":0,"Resources":[]}',
        durationMs: 1,
        correlationId: "correlation-prune",
      },
    };
    subject.finishExecution("run-prune", 1, operation, result);
    expect(subject.readExecution("run-prune", 1, operation)).toBeDefined();
    subject.deleteExecutions("run-prune");
    expect(subject.readExecution("run-prune", 1, operation)).toBeUndefined();
  });
});
