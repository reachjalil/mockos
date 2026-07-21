import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "@mockos/core";

export type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "@mockos/core";

/**
 * The small synchronous store surface used by the runtime-independent engine.
 *
 * This interface deliberately lives in testkit as a structural type. A store from
 * `@mockos/core` can be passed anywhere this shape is expected without an adapter.
 */
export type SqlStoreShape = SqlStore;

export interface NodeSqlStoreOptions {
  /** Enable foreign-key enforcement. Defaults to true. */
  foreignKeys?: boolean;
  /** Enable WAL. Useful for file databases; disabled for `:memory:`. */
  wal?: boolean;
}

const applyBindings = <T>(
  statement: StatementSync,
  method: "all" | "get" | "run",
  bindings: readonly SqlValue[]
): T => {
  return statement[method](...bindings) as T;
};

/** Synchronous SQLite store for Node-based engine and fixture tests. */
export class NodeSqlStore implements SqlStore {
  readonly database: DatabaseSync;

  constructor(filename = ":memory:", options: NodeSqlStoreOptions = {}) {
    this.database = new DatabaseSync(filename);
    if (options.foreignKeys !== false) {
      this.database.exec("PRAGMA foreign_keys = ON");
    }
    if (options.wal === true && filename !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL");
    }
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const result = applyBindings<{
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    }>(this.database.prepare(sql), "run", bindings);
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[] {
    return applyBindings<T[]>(this.database.prepare(sql), "all", bindings);
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined {
    return applyBindings<T | undefined>(this.database.prepare(sql), "get", bindings);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  close(): void {
    this.database.close();
  }
}
