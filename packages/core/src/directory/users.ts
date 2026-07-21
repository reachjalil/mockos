import { type Clock, type Rng, uuidFromRng } from "../determinism";
import { hashSecret, verifySecret } from "../security";
import type { SqlRow, SqlStore } from "../store";
import { asOptionalString, idFromUuid, normalizeName, parseJson } from "./shared";

export type PasswordState = "valid" | "expired" | "reset_required";
export type MfaState = "none" | "enrolled" | "required";

export interface UserRecord {
  readonly id: string;
  readonly externalId?: string;
  readonly userName: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly accountEnabled: boolean;
  readonly passwordState: PasswordState;
  readonly mfaState: MfaState;
  readonly provider: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly softDeletedAt?: string;
}

export interface CreateUserInput {
  readonly id?: string;
  readonly externalId?: string;
  readonly userName: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly password?: string;
  readonly accountEnabled?: boolean;
  readonly active?: boolean;
  readonly passwordState?: PasswordState;
  readonly mfaState?: MfaState;
  readonly provider?: Readonly<Record<string, unknown>>;
}

type UserRow = SqlRow & {
  id: string;
  external_id: string | null;
  user_name: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  account_enabled: number;
  password_hash: string;
  password_state: string;
  mfa_state: string;
  provider_json: string;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

const selectUsers = `SELECT id, external_id, user_name, display_name,
  given_name, family_name, account_enabled, password_hash, password_state,
  mfa_state, provider_json, created_at, updated_at, soft_deleted_at FROM users`;

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  ...(asOptionalString(row.external_id)
    ? { externalId: row.external_id as string }
    : {}),
  userName: row.user_name,
  displayName: row.display_name,
  ...(asOptionalString(row.given_name) ? { givenName: row.given_name as string } : {}),
  ...(asOptionalString(row.family_name)
    ? { familyName: row.family_name as string }
    : {}),
  accountEnabled: row.account_enabled === 1,
  passwordState: row.password_state as PasswordState,
  mfaState: row.mfa_state as MfaState,
  provider: parseJson(row.provider_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(asOptionalString(row.soft_deleted_at)
    ? { softDeletedAt: row.soft_deleted_at as string }
    : {}),
});

export class UserRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;

  constructor(store: SqlStore, clock: Clock, rng: Rng) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const userName = input.userName.trim();
    const displayName = input.displayName.trim();
    if (!userName || !displayName)
      throw new Error("User name and display name are required.");
    const id = input.id ?? idFromUuid("usr", uuidFromRng(this.#rng));
    const now = this.#clock.now().toISOString();
    const enabled = input.accountEnabled ?? input.active ?? true;
    const passwordHash = await hashSecret(input.password ?? "Passw0rd!");
    this.#store.run(
      `INSERT INTO users (
        id, external_id, user_name, normalized_user_name, display_name,
        given_name, family_name, account_enabled, password_hash,
        password_state, mfa_state, provider_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.externalId ?? null,
      userName,
      normalizeName(userName),
      displayName,
      input.givenName ?? null,
      input.familyName ?? null,
      enabled ? 1 : 0,
      passwordHash,
      input.passwordState ?? "valid",
      input.mfaState ?? "none",
      JSON.stringify(input.provider ?? {}),
      now,
      now
    );
    const created = this.findById(id);
    if (!created) throw new Error("Created user could not be read.");
    return created;
  }

  findById(id: string): UserRecord | undefined {
    const row = this.#store.get<UserRow>(`${selectUsers} WHERE id = ?`, id);
    return row ? toUser(row) : undefined;
  }

  getById(id: string): UserRecord | undefined {
    return this.findById(id);
  }

  requireById(id: string): UserRecord {
    const user = this.findById(id);
    if (!user) throw new Error(`Unknown user: ${id}`);
    return user;
  }

  findByUserName(userName: string): UserRecord | undefined {
    const row = this.#store.get<UserRow>(
      `${selectUsers} WHERE normalized_user_name = ?`,
      normalizeName(userName)
    );
    return row ? toUser(row) : undefined;
  }

  getByUserName(userName: string): UserRecord | undefined {
    return this.findByUserName(userName);
  }

  list(options: { includeDeleted?: boolean } = {}): UserRecord[] {
    const sql = options.includeDeleted
      ? `${selectUsers} ORDER BY created_at, id`
      : `${selectUsers} WHERE soft_deleted_at IS NULL ORDER BY created_at, id`;
    return this.#store.all<UserRow>(sql).map(toUser);
  }

  async authenticate(userName: string, password: string): Promise<UserRecord | null> {
    const row = this.#store.get<UserRow>(
      `${selectUsers} WHERE normalized_user_name = ? AND soft_deleted_at IS NULL`,
      normalizeName(userName)
    );
    if (!row) return null;
    if (
      row.account_enabled !== 1 ||
      row.password_state !== "valid" ||
      !(await verifySecret(password, row.password_hash))
    ) {
      return null;
    }
    return toUser(row);
  }

  setAccountEnabled(id: string, enabled: boolean): UserRecord {
    const now = this.#clock.now().toISOString();
    this.#store.run(
      "UPDATE users SET account_enabled = ?, updated_at = ? WHERE id = ?",
      enabled ? 1 : 0,
      now,
      id
    );
    return this.requireById(id);
  }

  softDelete(id: string): UserRecord {
    const now = this.#clock.now().toISOString();
    this.#store.run(
      `UPDATE users SET account_enabled = 0, soft_deleted_at = ?, updated_at = ?
       WHERE id = ?`,
      now,
      now,
      id
    );
    return this.requireById(id);
  }
}
