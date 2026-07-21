export type SqlValue = string | number | bigint | Uint8Array | null;

export type SqlRow = Record<string, SqlValue>;

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowid?: number | bigint;
}

/**
 * The deliberately small, synchronous SQLite seam shared by Durable Objects and
 * Node tests. Adapters are responsible only for binding values and materializing
 * rows; transactions must roll back when the callback throws.
 */
export interface SqlStore {
  run(sql: string, ...bindings: SqlValue[]): SqlRunResult;
  all<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T[];
  get<T extends SqlRow = SqlRow>(sql: string, ...bindings: SqlValue[]): T | undefined;
  transaction<T>(callback: () => T): T;
}
