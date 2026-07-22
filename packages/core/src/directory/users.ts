import { type DirectoryUserState, directoryUserStateSchema } from "@mockos/contracts";
import { type Clock, type Rng, uuidFromRng } from "../determinism";
import { canonicalJson, hashSecret, verifySecret } from "../security";
import type { SqlRow, SqlStore } from "../store";
import {
  asOptionalString,
  assertVersionPrecondition,
  DirectoryResourceNotFoundError,
  DirectoryUniquenessError,
  idFromUuid,
  type MutationResult,
  normalizeName,
  parseJson,
  type VersionPrecondition,
} from "./shared";

export type PasswordState = "valid" | "expired" | "reset_required";
export type MfaState = "none" | "enrolled" | "required";

export interface UserRecord {
  readonly id: string;
  readonly externalId?: string;
  readonly userName: string;
  readonly displayName: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly lifecycleState: DirectoryUserState;
  /** Compatibility projection. Lifecycle state is the source of truth. */
  readonly accountEnabled: boolean;
  readonly passwordState: PasswordState;
  readonly mfaState: MfaState;
  readonly provider: Readonly<Record<string, unknown>>;
  readonly scim: Readonly<Record<string, unknown>>;
  readonly resourceVersion: number;
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
  readonly lifecycleState?: DirectoryUserState;
  readonly passwordState?: PasswordState;
  readonly mfaState?: MfaState;
  readonly provider?: Readonly<Record<string, unknown>>;
  readonly scim?: Readonly<Record<string, unknown>>;
}

export interface UpdateUserScimInput {
  readonly externalId?: string | null;
  readonly userName?: string;
  readonly displayName?: string;
  readonly givenName?: string | null;
  readonly familyName?: string | null;
  readonly accountEnabled?: boolean;
  readonly lifecycleState?: DirectoryUserState;
  readonly password?: string;
  readonly scim?: Readonly<Record<string, unknown>>;
}

export type UserLifecycleTransitionCallback = (
  current: UserRecord,
  requestedState: DirectoryUserState
) => void;

export interface DeleteUserResult extends MutationResult<UserRecord> {
  readonly deleted: true;
  readonly affectedGroupIds: readonly string[];
}

export class InvalidUserLifecycleTransitionError extends Error {
  readonly code = "INVALID_USER_LIFECYCLE_TRANSITION";
  readonly currentState: DirectoryUserState;
  readonly requestedState: DirectoryUserState;

  constructor(currentState: DirectoryUserState, requestedState: DirectoryUserState) {
    super(`A user cannot transition from '${currentState}' to '${requestedState}'.`);
    this.name = "InvalidUserLifecycleTransitionError";
    this.currentState = currentState;
    this.requestedState = requestedState;
  }
}

export type UserRow = SqlRow & {
  id: string;
  external_id: string | null;
  user_name: string;
  normalized_user_name: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  account_enabled: number;
  password_hash: string;
  password_state: string;
  mfa_state: string;
  provider_json: string;
  lifecycle_state: string;
  resource_version: number;
  scim_json: string;
  created_at: string;
  updated_at: string;
  soft_deleted_at: string | null;
};

export const selectUsers = `SELECT id, external_id, user_name, normalized_user_name,
  display_name, given_name, family_name, account_enabled, password_hash,
  password_state, mfa_state, provider_json, lifecycle_state, resource_version,
  scim_json, created_at, updated_at, soft_deleted_at FROM users`;

const INVALID_PASSWORD_HASH = "0".repeat(64);

export const userFromRow = (row: UserRow): UserRecord => {
  const lifecycleState = directoryUserStateSchema.parse(row.lifecycle_state);
  return {
    id: row.id,
    ...(asOptionalString(row.external_id)
      ? { externalId: row.external_id as string }
      : {}),
    userName: row.user_name,
    displayName: row.display_name,
    ...(asOptionalString(row.given_name)
      ? { givenName: row.given_name as string }
      : {}),
    ...(asOptionalString(row.family_name)
      ? { familyName: row.family_name as string }
      : {}),
    lifecycleState,
    accountEnabled: lifecycleState === "active",
    passwordState: row.password_state as PasswordState,
    mfaState: row.mfa_state as MfaState,
    provider: parseJson(row.provider_json, {}),
    scim: parseJson(row.scim_json, {}),
    resourceVersion: Number(row.resource_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(asOptionalString(row.soft_deleted_at)
      ? { softDeletedAt: row.soft_deleted_at as string }
      : {}),
  };
};

const createLifecycleState = (input: CreateUserInput): DirectoryUserState => {
  const enabled = input.accountEnabled ?? input.active;
  const state = input.lifecycleState ?? (enabled === false ? "disabled" : "active");
  const parsed = directoryUserStateSchema.parse(state);
  if (enabled !== undefined && enabled !== (parsed === "active")) {
    throw new Error("Lifecycle state conflicts with the account-enabled input.");
  }
  if (parsed === "deleted") {
    throw new InvalidUserLifecycleTransitionError("staged", parsed);
  }
  return parsed;
};

const nextStateFromScim = (
  current: DirectoryUserState,
  input: UpdateUserScimInput
): DirectoryUserState => {
  if (input.lifecycleState !== undefined) {
    const requested = directoryUserStateSchema.parse(input.lifecycleState);
    if (
      input.accountEnabled !== undefined &&
      input.accountEnabled !== (requested === "active")
    ) {
      throw new Error("Lifecycle state conflicts with the account-enabled input.");
    }
    return requested;
  }
  if (input.accountEnabled === true) return "active";
  if (input.accountEnabled === false) {
    return current === "active" || current === "staged" ? "disabled" : current;
  }
  return current;
};

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
    if (!userName || !displayName) {
      throw new Error("User name and display name are required.");
    }
    const id = input.id ?? idFromUuid("usr", uuidFromRng(this.#rng));
    const now = this.#clock.now().toISOString();
    const lifecycleState = createLifecycleState(input);
    const passwordHash = await hashSecret(input.password ?? "Passw0rd!");
    const normalizedUserName = normalizeName(userName);
    const scimJson = canonicalJson(input.scim ?? {});
    this.#store.transaction(() => {
      this.#assertUserNameUnique(normalizedUserName, id);
      this.#store.run(
        `INSERT INTO users (
          id, external_id, user_name, normalized_user_name, display_name,
          given_name, family_name, account_enabled, password_hash,
          password_state, mfa_state, provider_json, lifecycle_state,
          resource_version, scim_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        id,
        input.externalId ?? null,
        userName,
        normalizedUserName,
        displayName,
        input.givenName ?? null,
        input.familyName ?? null,
        lifecycleState === "active" ? 1 : 0,
        passwordHash,
        input.passwordState ?? "valid",
        input.mfaState ?? "none",
        canonicalJson(input.provider ?? {}),
        lifecycleState,
        scimJson,
        now,
        now
      );
    });
    const created = this.findById(id);
    if (!created) throw new Error("Created user could not be read.");
    return created;
  }

  findById(id: string): UserRecord | undefined {
    const row = this.#store.get<UserRow>(`${selectUsers} WHERE id = ?`, id);
    return row ? userFromRow(row) : undefined;
  }

  getById(id: string): UserRecord | undefined {
    return this.findById(id);
  }

  requireById(id: string): UserRecord {
    const user = this.findById(id);
    if (!user) throw new DirectoryResourceNotFoundError("User", id);
    return user;
  }

  findByUserName(userName: string): UserRecord | undefined {
    const row = this.#store.get<UserRow>(
      `${selectUsers} WHERE normalized_user_name = ?`,
      normalizeName(userName)
    );
    return row ? userFromRow(row) : undefined;
  }

  getByUserName(userName: string): UserRecord | undefined {
    return this.findByUserName(userName);
  }

  list(options: { includeDeleted?: boolean } = {}): UserRecord[] {
    const sql = options.includeDeleted
      ? `${selectUsers} ORDER BY created_at, id`
      : `${selectUsers} WHERE lifecycle_state <> 'deleted' ORDER BY created_at, id`;
    return this.#store.all<UserRow>(sql).map(userFromRow);
  }

  async authenticate(userName: string, password: string): Promise<UserRecord | null> {
    const user = await this.verifyPrimaryCredentials(userName, password);
    if (!user?.accountEnabled || user.passwordState !== "valid" || user.softDeletedAt) {
      return null;
    }
    return user;
  }

  /**
   * Verifies the password before returning any current account state. Callers
   * must apply their own provider policy only after this method succeeds.
   */
  async verifyPrimaryCredentials(
    userName: string,
    password: string
  ): Promise<UserRecord | null> {
    const row = this.#store.get<UserRow>(
      `${selectUsers} WHERE normalized_user_name = ?`,
      normalizeName(userName)
    );
    const verified = await verifySecret(
      password,
      row?.password_hash ?? INVALID_PASSWORD_HASH
    );
    if (!row || !verified) return null;

    // Re-read after WebCrypto completes so status and credential changes that
    // interleaved with verification cannot produce a stale authentication result.
    const current = this.#store.get<UserRow>(`${selectUsers} WHERE id = ?`, row.id);
    if (!current || current.password_hash !== row.password_hash) return null;
    return userFromRow(current);
  }

  async updateScim(
    id: string,
    input: UpdateUserScimInput,
    precondition?: VersionPrecondition,
    onLifecycleTransition?: UserLifecycleTransitionCallback
  ): Promise<MutationResult<UserRecord>> {
    const passwordHash =
      input.password === undefined ? undefined : await hashSecret(input.password);
    return this.#store.transaction(() => {
      const row = this.#requireMutableRow(id);
      assertVersionPrecondition(Number(row.resource_version), precondition);
      const current = userFromRow(row);
      const userName = input.userName?.trim() ?? current.userName;
      const displayName = input.displayName?.trim() ?? current.displayName;
      if (!userName || !displayName) {
        throw new Error("User name and display name are required.");
      }
      const externalId =
        input.externalId === undefined
          ? (current.externalId ?? null)
          : input.externalId;
      const givenName =
        input.givenName === undefined ? (current.givenName ?? null) : input.givenName;
      const familyName =
        input.familyName === undefined
          ? (current.familyName ?? null)
          : input.familyName;
      const lifecycleState = nextStateFromScim(current.lifecycleState, input);
      if (lifecycleState === "deleted") {
        throw new InvalidUserLifecycleTransitionError(
          current.lifecycleState,
          lifecycleState
        );
      }
      const scimJson = canonicalJson(input.scim ?? current.scim);
      const normalizedUserName = normalizeName(userName);
      this.#assertUserNameUnique(normalizedUserName, id);
      const changed =
        userName !== current.userName ||
        displayName !== current.displayName ||
        externalId !== (current.externalId ?? null) ||
        givenName !== (current.givenName ?? null) ||
        familyName !== (current.familyName ?? null) ||
        lifecycleState !== current.lifecycleState ||
        scimJson !== canonicalJson(current.scim) ||
        (passwordHash !== undefined && passwordHash !== row.password_hash);
      onLifecycleTransition?.(current, lifecycleState);
      if (!changed) return { record: current, changed: false };

      const now = this.#clock.now().toISOString();
      const updated = this.#store.run(
        `UPDATE users SET external_id = ?, user_name = ?, normalized_user_name = ?,
          display_name = ?, given_name = ?, family_name = ?, account_enabled = ?,
          password_hash = ?, lifecycle_state = ?, scim_json = ?,
          resource_version = resource_version + 1, updated_at = ?
         WHERE id = ? AND lifecycle_state <> 'deleted' AND resource_version = ?`,
        externalId,
        userName,
        normalizedUserName,
        displayName,
        givenName,
        familyName,
        lifecycleState === "active" ? 1 : 0,
        passwordHash ?? row.password_hash,
        lifecycleState,
        scimJson,
        now,
        id,
        row.resource_version
      );
      if (updated.changes !== 1) {
        throw new Error("Concurrent user update was not serialized.");
      }
      return { record: this.requireById(id), changed: true };
    });
  }

  transitionLifecycle(
    id: string,
    requestedState: DirectoryUserState,
    precondition?: VersionPrecondition,
    onTransition?: () => void
  ): MutationResult<UserRecord> {
    const nextState = directoryUserStateSchema.parse(requestedState);
    return this.#store.transaction(() => {
      const row = this.#store.get<UserRow>(`${selectUsers} WHERE id = ?`, id);
      if (!row) throw new DirectoryResourceNotFoundError("User", id);
      const current = userFromRow(row);
      assertVersionPrecondition(current.resourceVersion, precondition);
      if (current.lifecycleState === nextState) {
        onTransition?.();
        return { record: current, changed: false };
      }
      if (current.lifecycleState === "deleted") {
        throw new InvalidUserLifecycleTransitionError(
          current.lifecycleState,
          nextState
        );
      }
      const now = this.#clock.now().toISOString();
      const updated = this.#store.run(
        `UPDATE users SET lifecycle_state = ?, account_enabled = ?,
          soft_deleted_at = CASE WHEN ? = 'deleted' THEN ? ELSE soft_deleted_at END,
          resource_version = resource_version + 1, updated_at = ?
         WHERE id = ? AND resource_version = ?`,
        nextState,
        nextState === "active" ? 1 : 0,
        nextState,
        now,
        now,
        id,
        current.resourceVersion
      );
      if (updated.changes !== 1) {
        throw new Error("Concurrent lifecycle update was not serialized.");
      }
      if (nextState === "deleted") this.#removeMembershipsAndBumpGroups(id, now);
      onTransition?.();
      return { record: this.requireById(id), changed: true };
    });
  }

  deleteScim(id: string, precondition?: VersionPrecondition): DeleteUserResult {
    const current = this.requireById(id);
    if (current.lifecycleState === "deleted") {
      throw new DirectoryResourceNotFoundError("User", id);
    }
    const affectedGroupIds = this.#memberGroupIds(id);
    const mutation = this.transitionLifecycle(id, "deleted", precondition);
    return { ...mutation, deleted: true, affectedGroupIds };
  }

  setAccountEnabled(id: string, enabled: boolean): UserRecord {
    return this.transitionLifecycle(id, enabled ? "active" : "disabled").record;
  }

  softDelete(id: string): UserRecord {
    return this.deleteScim(id).record;
  }

  #requireMutableRow(id: string): UserRow {
    const row = this.#store.get<UserRow>(
      `${selectUsers} WHERE id = ? AND lifecycle_state <> 'deleted'`,
      id
    );
    if (!row) throw new DirectoryResourceNotFoundError("User", id);
    return row;
  }

  #assertUserNameUnique(normalizedUserName: string, exceptId: string): void {
    const usernameOwner = this.#store.get<{ id: string } & SqlRow>(
      "SELECT id FROM users WHERE normalized_user_name = ? AND id <> ? LIMIT 1",
      normalizedUserName,
      exceptId
    );
    if (usernameOwner) throw new DirectoryUniquenessError("userName");
  }

  #memberGroupIds(userId: string): string[] {
    return this.#store
      .all<{ group_id: string } & SqlRow>(
        `SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id`,
        userId
      )
      .map((row) => row.group_id);
  }

  #removeMembershipsAndBumpGroups(userId: string, now: string): void {
    const groupIds = this.#memberGroupIds(userId);
    if (groupIds.length === 0) return;
    this.#store.run("DELETE FROM group_members WHERE user_id = ?", userId);
    for (const groupId of groupIds) {
      this.#store.run(
        `UPDATE groups SET resource_version = resource_version + 1, updated_at = ?
         WHERE id = ? AND soft_deleted_at IS NULL`,
        now,
        groupId
      );
    }
  }
}
