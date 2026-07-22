import { type Clock, type Rng, uuidFromRng } from "../determinism";
import { canonicalJson } from "../security";
import type { SqlRow, SqlStore } from "../store";
import {
  asOptionalString,
  assertVersionPrecondition,
  DirectoryResourceNotFoundError,
  idFromUuid,
  type MutationResult,
  normalizeName,
  parseJson,
  type VersionPrecondition,
} from "./shared";
import { type UserRecord, type UserRow, userFromRow } from "./users";

export interface GroupRecord {
  readonly id: string;
  readonly externalId?: string;
  readonly displayName: string;
  readonly provider: Readonly<Record<string, unknown>>;
  readonly scim: Readonly<Record<string, unknown>>;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly softDeletedAt?: string;
}

export interface CreateGroupInput {
  readonly id?: string;
  readonly externalId?: string;
  readonly displayName: string;
  readonly provider?: Readonly<Record<string, unknown>>;
  readonly scim?: Readonly<Record<string, unknown>>;
  readonly memberIds?: readonly string[];
}

export interface UpdateGroupScimInput {
  readonly externalId?: string | null;
  readonly displayName?: string;
  readonly scim?: Readonly<Record<string, unknown>>;
  readonly memberIds?: readonly string[];
}

export interface DeleteGroupResult extends MutationResult<GroupRecord> {
  readonly deleted: true;
}

type GroupRow = SqlRow & {
  id: string;
  external_id: string | null;
  display_name: string;
  normalized_display_name: string;
  provider_json: string;
  scim_json: string;
  resource_version: number;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

type UserMembershipRow = UserRow;

const selectGroups = `SELECT id, external_id, display_name, normalized_display_name,
  provider_json, scim_json, resource_version, created_at, updated_at,
  soft_deleted_at FROM groups`;

const toGroup = (row: GroupRow): GroupRecord => ({
  id: row.id,
  ...(asOptionalString(row.external_id)
    ? { externalId: row.external_id as string }
    : {}),
  displayName: row.display_name,
  provider: parseJson(row.provider_json, {}),
  scim: parseJson(row.scim_json, {}),
  resourceVersion: Number(row.resource_version),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(asOptionalString(row.soft_deleted_at)
    ? { softDeletedAt: row.soft_deleted_at as string }
    : {}),
});

type MembershipMode = "replace" | "add" | "remove";

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
    const memberIds = this.#canonicalMemberIds(input.memberIds ?? []);
    this.#store.transaction(() => {
      this.#assertMembersExist(memberIds);
      this.#store.run(
        `INSERT INTO groups (
          id, external_id, display_name, normalized_display_name,
          provider_json, scim_json, resource_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        input.externalId ?? null,
        displayName,
        normalizeName(displayName),
        canonicalJson(input.provider ?? {}),
        canonicalJson(input.scim ?? {}),
        now,
        now
      );
      for (const userId of memberIds) {
        this.#store.run(
          `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)`,
          id,
          userId,
          now
        );
      }
    });
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
    if (!group) throw new DirectoryResourceNotFoundError("Group", id);
    return group;
  }

  list(options: { includeDeleted?: boolean } = {}): GroupRecord[] {
    const sql = options.includeDeleted
      ? `${selectGroups} ORDER BY created_at, id`
      : `${selectGroups} WHERE soft_deleted_at IS NULL ORDER BY created_at, id`;
    return this.#store.all<GroupRow>(sql).map(toGroup);
  }

  updateScim(
    id: string,
    input: UpdateGroupScimInput,
    precondition?: VersionPrecondition
  ): MutationResult<GroupRecord> {
    return this.#mutateScim(id, input, precondition, "replace");
  }

  replaceMembers(
    id: string,
    userIds: readonly string[],
    precondition?: VersionPrecondition
  ): MutationResult<GroupRecord> {
    return this.#mutateScim(id, { memberIds: userIds }, precondition, "replace");
  }

  addMembers(
    id: string,
    userIds: readonly string[],
    precondition?: VersionPrecondition
  ): MutationResult<GroupRecord> {
    return this.#mutateScim(id, { memberIds: userIds }, precondition, "add");
  }

  removeMembers(
    id: string,
    userIds: readonly string[],
    precondition?: VersionPrecondition
  ): MutationResult<GroupRecord> {
    return this.#mutateScim(id, { memberIds: userIds }, precondition, "remove");
  }

  addMember(groupId: string, userId: string): MutationResult<GroupRecord> {
    return this.addMembers(groupId, [userId]);
  }

  removeMember(groupId: string, userId: string): MutationResult<GroupRecord> {
    return this.removeMembers(groupId, [userId]);
  }

  deleteScim(id: string, precondition?: VersionPrecondition): DeleteGroupResult {
    return this.#store.transaction(() => {
      const row = this.#requireMutableRow(id);
      const current = toGroup(row);
      assertVersionPrecondition(current.resourceVersion, precondition);
      const now = this.#clock.now().toISOString();
      const deleted = this.#store.run(
        `UPDATE groups SET soft_deleted_at = ?, updated_at = ?,
          resource_version = resource_version + 1
         WHERE id = ? AND soft_deleted_at IS NULL AND resource_version = ?`,
        now,
        now,
        id,
        current.resourceVersion
      );
      if (deleted.changes !== 1) {
        throw new Error("Concurrent group deletion was not serialized.");
      }
      this.#store.run("DELETE FROM group_members WHERE group_id = ?", id);
      return {
        record: this.requireById(id),
        changed: true,
        deleted: true,
      };
    });
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
    const group = this.findById(groupId);
    if (!group || group.softDeletedAt) {
      throw new DirectoryResourceNotFoundError("Group", groupId);
    }
    return this.#store
      .all<UserMembershipRow>(
        `SELECT u.id, u.external_id, u.user_name, u.normalized_user_name,
          u.display_name, u.given_name, u.family_name, u.account_enabled,
          u.password_hash, u.password_state, u.mfa_state, u.provider_json,
          u.lifecycle_state, u.resource_version, u.scim_json, u.created_at,
          u.updated_at, u.soft_deleted_at
         FROM users u
         INNER JOIN group_members gm ON gm.user_id = u.id
         WHERE gm.group_id = ? AND u.lifecycle_state <> 'deleted'
         ORDER BY u.user_name, u.id`,
        groupId
      )
      .map(userFromRow);
  }

  #mutateScim(
    id: string,
    input: UpdateGroupScimInput,
    precondition: VersionPrecondition,
    membershipMode: MembershipMode
  ): MutationResult<GroupRecord> {
    return this.#store.transaction(() => {
      const row = this.#requireMutableRow(id);
      const current = toGroup(row);
      assertVersionPrecondition(current.resourceVersion, precondition);
      const displayName = input.displayName?.trim() ?? current.displayName;
      if (!displayName) throw new Error("Group display name is required.");
      const externalId =
        input.externalId === undefined
          ? (current.externalId ?? null)
          : input.externalId;
      const scimJson = canonicalJson(input.scim ?? current.scim);
      const currentMemberIds = this.#memberIds(id);
      let nextMemberIds = currentMemberIds;
      if (input.memberIds !== undefined) {
        const requested = this.#canonicalMemberIds(input.memberIds);
        if (membershipMode !== "remove") this.#assertMembersExist(requested);
        const requestedSet = new Set(requested);
        if (membershipMode === "replace") {
          nextMemberIds = requested;
        } else if (membershipMode === "add") {
          nextMemberIds = this.#canonicalMemberIds([...currentMemberIds, ...requested]);
        } else {
          nextMemberIds = currentMemberIds.filter(
            (memberId) => !requestedSet.has(memberId)
          );
        }
      }
      const memberChanged =
        currentMemberIds.length !== nextMemberIds.length ||
        currentMemberIds.some((memberId, index) => memberId !== nextMemberIds[index]);
      const changed =
        displayName !== current.displayName ||
        externalId !== (current.externalId ?? null) ||
        scimJson !== canonicalJson(current.scim) ||
        memberChanged;
      if (!changed) return { record: current, changed: false };

      const now = this.#clock.now().toISOString();
      const updated = this.#store.run(
        `UPDATE groups SET external_id = ?, display_name = ?,
          normalized_display_name = ?, scim_json = ?, updated_at = ?,
          resource_version = resource_version + 1
         WHERE id = ? AND soft_deleted_at IS NULL AND resource_version = ?`,
        externalId,
        displayName,
        normalizeName(displayName),
        scimJson,
        now,
        id,
        current.resourceVersion
      );
      if (updated.changes !== 1) {
        throw new Error("Concurrent group update was not serialized.");
      }
      if (memberChanged) {
        this.#store.run("DELETE FROM group_members WHERE group_id = ?", id);
        for (const userId of nextMemberIds) {
          this.#store.run(
            `INSERT INTO group_members (group_id, user_id, created_at)
             VALUES (?, ?, ?)`,
            id,
            userId,
            now
          );
        }
      }
      return { record: this.requireById(id), changed: true };
    });
  }

  #requireMutableRow(id: string): GroupRow {
    const row = this.#store.get<GroupRow>(
      `${selectGroups} WHERE id = ? AND soft_deleted_at IS NULL`,
      id
    );
    if (!row) throw new DirectoryResourceNotFoundError("Group", id);
    return row;
  }

  #assertMembersExist(userIds: readonly string[]): void {
    for (const userId of userIds) {
      const user = this.#store.get<{ id: string } & SqlRow>(
        "SELECT id FROM users WHERE id = ? AND lifecycle_state <> 'deleted'",
        userId
      );
      if (!user) throw new DirectoryResourceNotFoundError("User", userId);
    }
  }

  #memberIds(groupId: string): string[] {
    return this.#store
      .all<{ user_id: string } & SqlRow>(
        "SELECT user_id FROM group_members WHERE group_id = ? ORDER BY user_id",
        groupId
      )
      .map((row) => row.user_id);
  }

  #canonicalMemberIds(userIds: readonly string[]): string[] {
    return [...new Set(userIds)].sort((left, right) => left.localeCompare(right));
  }
}
