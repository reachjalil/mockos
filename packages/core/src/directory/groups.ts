import { type Clock, type Rng, uuidFromRng } from "../determinism";
import type { SqlRow, SqlStore } from "../store";
import { asOptionalString, idFromUuid, normalizeName, parseJson } from "./shared";
import type { UserRecord } from "./users";

export interface GroupRecord {
  readonly id: string;
  readonly externalId?: string;
  readonly displayName: string;
  readonly provider: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly softDeletedAt?: string;
}

export interface CreateGroupInput {
  readonly id?: string;
  readonly externalId?: string;
  readonly displayName: string;
  readonly provider?: Readonly<Record<string, unknown>>;
}

type GroupRow = SqlRow & {
  id: string;
  external_id: string | null;
  display_name: string;
  provider_json: string;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

type UserMembershipRow = SqlRow & {
  id: string;
  external_id: string | null;
  user_name: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  account_enabled: number;
  password_state: string;
  mfa_state: string;
  provider_json: string;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

const selectGroups = `SELECT id, external_id, display_name, provider_json,
  created_at, updated_at, soft_deleted_at FROM groups`;

const toGroup = (row: GroupRow): GroupRecord => ({
  id: row.id,
  ...(asOptionalString(row.external_id)
    ? { externalId: row.external_id as string }
    : {}),
  displayName: row.display_name,
  provider: parseJson(row.provider_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(asOptionalString(row.soft_deleted_at)
    ? { softDeletedAt: row.soft_deleted_at as string }
    : {}),
});

const membershipRowToUser = (row: UserMembershipRow): UserRecord => ({
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
  passwordState: row.password_state as UserRecord["passwordState"],
  mfaState: row.mfa_state as UserRecord["mfaState"],
  provider: parseJson(row.provider_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(asOptionalString(row.soft_deleted_at)
    ? { softDeletedAt: row.soft_deleted_at as string }
    : {}),
});

export class GroupRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;

  constructor(store: SqlStore, clock: Clock, rng: Rng) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  create(input: CreateGroupInput): GroupRecord {
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error("Group display name is required.");
    const id = input.id ?? idFromUuid("grp", uuidFromRng(this.#rng));
    const now = this.#clock.now().toISOString();
    this.#store.run(
      `INSERT INTO groups (
        id, external_id, display_name, normalized_display_name,
        provider_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.externalId ?? null,
      displayName,
      normalizeName(displayName),
      JSON.stringify(input.provider ?? {}),
      now,
      now
    );
    return this.requireById(id);
  }

  findById(id: string): GroupRecord | undefined {
    const row = this.#store.get<GroupRow>(`${selectGroups} WHERE id = ?`, id);
    return row ? toGroup(row) : undefined;
  }

  getById(id: string): GroupRecord | undefined {
    return this.findById(id);
  }

  requireById(id: string): GroupRecord {
    const group = this.findById(id);
    if (!group) throw new Error(`Unknown group: ${id}`);
    return group;
  }

  list(): GroupRecord[] {
    return this.#store
      .all<GroupRow>(
        `${selectGroups} WHERE soft_deleted_at IS NULL ORDER BY created_at, id`
      )
      .map(toGroup);
  }

  addMember(groupId: string, userId: string): void {
    this.requireById(groupId);
    const now = this.#clock.now().toISOString();
    this.#store.run(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at)
       VALUES (?, ?, ?)`,
      groupId,
      userId,
      now
    );
  }

  removeMember(groupId: string, userId: string): void {
    this.#store.run(
      "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
      groupId,
      userId
    );
  }

  listForUser(userId: string): GroupRecord[] {
    return this.#store
      .all<GroupRow>(
        `${selectGroups} WHERE id IN (
          SELECT group_id FROM group_members WHERE user_id = ?
        ) AND soft_deleted_at IS NULL ORDER BY display_name, id`,
        userId
      )
      .map(toGroup);
  }

  listMembers(groupId: string): UserRecord[] {
    return this.#store
      .all<UserMembershipRow>(
        `SELECT u.id, u.external_id, u.user_name, u.display_name, u.given_name,
          u.family_name, u.account_enabled, u.password_state, u.mfa_state,
          u.provider_json, u.created_at, u.updated_at, u.soft_deleted_at
        FROM users u
        INNER JOIN group_members gm ON gm.user_id = u.id
        WHERE gm.group_id = ? AND u.soft_deleted_at IS NULL
        ORDER BY u.user_name, u.id`,
        groupId
      )
      .map(membershipRowToUser);
  }
}
