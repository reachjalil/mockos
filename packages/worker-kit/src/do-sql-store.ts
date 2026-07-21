import type { SqlRow, SqlRunResult, SqlStore, SqlValue } from "@mockos/core";

type DoStorage = Pick<DurableObjectStorage, "sql" | "transactionSync">;

const USER_VERSION_GET = /^\s*PRAGMA\s+user_version\s*;?\s*$/i;
const USER_VERSION_SET = /^\s*PRAGMA\s+user_version\s*=\s*([0-9]+)\s*;?\s*$/i;
const VERSION_TABLE = "_mockos_schema_version";

const toBinding = (value: SqlValue): ArrayBuffer | string | number | null => {
  if (typeof value === "bigint") {
    const converted = Number(value);
    if (!Number.isSafeInteger(converted)) {
      throw new RangeError("Cloudflare SQLite cannot bind an unsafe bigint.");
    }
    return converted;
  }
  if (value instanceof Uint8Array) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength
    ) as ArrayBuffer;
  }
  return value;
};

const fromRow = <T extends SqlRow>(
  row: Record<string, ArrayBuffer | string | number | null>
): T =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    ])
  ) as T;

/** Synchronous adapter over Durable Object SQLite. */
export class DoSqlStore implements SqlStore {
  readonly #storage: DoStorage;

  constructor(storage: DoStorage) {
    this.#storage = storage;
  }

  run(sql: string, ...bindings: SqlValue[]): SqlRunResult {
    const userVersion = USER_VERSION_SET.exec(sql)?.[1];
    if (userVersion !== undefined) {
      this.#storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS ${VERSION_TABLE} (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL
        )`
      );
      const cursor = this.#storage.sql.exec(
        `INSERT INTO ${VERSION_TABLE} (singleton, version) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET version = excluded.version`,
        Number(userVersion)
      );
      cursor.toArray();
      return { changes: cursor.rowsWritten };
    }
    const cursor = this.#storage.sql.exec(sql, ...bindings.map(toBinding));
    // Materialize RETURNING queries so writes complete before the caller moves on.
    cursor.toArray();
    return { changes: cursor.rowsWritten };
  }

  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[] {
    const rows = this.#storage.sql.exec(sql, ...bindings.map(toBinding)).toArray();
    return rows.map((row) => fromRow<T>(row));
  }

  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined {
    if (USER_VERSION_GET.test(sql)) {
      try {
        const result = this.#storage.sql
          .exec<{ user_version: number }>(
            `SELECT version AS user_version FROM ${VERSION_TABLE}
             WHERE singleton = 1`
          )
          .next();
        return (result.done ? { user_version: 0 } : result.value) as unknown as T;
      } catch (error) {
        if (error instanceof Error && /no such table/i.test(error.message)) {
          return { user_version: 0 } as unknown as T;
        }
        throw error;
      }
    }
    const result = this.#storage.sql.exec(sql, ...bindings.map(toBinding)).next();
    return result.done ? undefined : fromRow<T>(result.value);
  }

  transaction<T>(callback: () => T): T {
    return this.#storage.transactionSync(callback);
  }
}
