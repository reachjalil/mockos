import {
  type DirectoryUserState,
  directoryUserStateSchema,
  type LifecycleAction,
  type LifecycleResult,
  type ProviderId,
  scimWeakEtag,
} from "@mockos/contracts";
import type { Clock } from "../determinism";
import type { SqlRow, SqlStore } from "../store";
import type { VersionPrecondition } from "./shared";
import type { UpdateUserScimInput, UserRecord, UserRepository } from "./users";

type LifecycleRule = {
  readonly from: ReadonlySet<DirectoryUserState>;
  readonly to: DirectoryUserState;
  readonly revokesTokens: boolean;
};

const states = (...values: DirectoryUserState[]): ReadonlySet<DirectoryUserState> =>
  new Set(values);

const providerRules: Readonly<
  Record<ProviderId, Partial<Record<LifecycleAction, LifecycleRule>>>
> = {
  entra: {
    activate: {
      from: states("staged", "active"),
      to: "active",
      revokesTokens: false,
    },
    disable: {
      from: states("active", "disabled", "suspended"),
      to: "disabled",
      revokesTokens: true,
    },
    reactivate: {
      from: states("disabled", "active"),
      to: "active",
      revokesTokens: false,
    },
    delete: {
      from: states("staged", "active", "disabled", "suspended", "deprovisioned"),
      to: "deleted",
      revokesTokens: true,
    },
  },
  okta: {
    activate: {
      from: states("staged", "active"),
      to: "active",
      revokesTokens: false,
    },
    reactivate: {
      from: states("deprovisioned", "active"),
      to: "active",
      revokesTokens: false,
    },
    suspend: {
      from: states("active", "suspended"),
      to: "suspended",
      revokesTokens: true,
    },
    unsuspend: {
      from: states("suspended", "active"),
      to: "active",
      revokesTokens: false,
    },
    deprovision: {
      from: states("staged", "active", "suspended", "deprovisioned"),
      to: "deprovisioned",
      revokesTokens: true,
    },
    delete: {
      from: states("deprovisioned"),
      to: "deleted",
      revokesTokens: true,
    },
  },
};

type CountRow = SqlRow & { count: number };

export interface LifecycleScimUpdateResult extends LifecycleResult {
  readonly record: UserRecord;
}

export class InvalidLifecycleActionError extends Error {
  readonly code = "INVALID_LIFECYCLE_ACTION";
  readonly provider: ProviderId;
  readonly action: LifecycleAction;
  readonly currentState: DirectoryUserState;

  constructor(
    provider: ProviderId,
    action: LifecycleAction,
    currentState: DirectoryUserState
  ) {
    super(
      `Lifecycle action '${action}' is not valid for a ${provider} user in state '${currentState}'.`
    );
    this.name = "InvalidLifecycleActionError";
    this.provider = provider;
    this.action = action;
    this.currentState = currentState;
  }
}

export class LifecycleService {
  readonly #provider: ProviderId;
  readonly #users: UserRepository;
  readonly #store: SqlStore;
  readonly #clock: Clock;

  constructor(options: {
    readonly provider: ProviderId;
    readonly users: UserRepository;
    readonly store: SqlStore;
    readonly clock: Clock;
  }) {
    this.#provider = options.provider;
    this.#users = options.users;
    this.#store = options.store;
    this.#clock = options.clock;
  }

  apply(
    userId: string,
    action: LifecycleAction,
    precondition?: VersionPrecondition
  ): LifecycleResult {
    const current = this.#users.requireById(userId);
    const currentState = directoryUserStateSchema.parse(current.lifecycleState);
    const rule = providerRules[this.#provider][action];
    if (!rule?.from.has(currentState)) {
      throw new InvalidLifecycleActionError(this.#provider, action, currentState);
    }

    let revoked = { accessTokens: 0, refreshTokens: 0 };
    const mutation = this.#users.transitionLifecycle(
      userId,
      rule.to,
      precondition,
      rule.revokesTokens
        ? () => {
            revoked = this.#revokeTokens(userId);
          }
        : undefined
    );
    return {
      userId,
      provider: this.#provider,
      action,
      previousState: currentState,
      currentState: mutation.record.lifecycleState,
      changed: mutation.changed,
      version: mutation.record.resourceVersion,
      etag: scimWeakEtag(mutation.record.resourceVersion),
      revoked,
    };
  }

  async applyScimUpdate(
    userId: string,
    action: LifecycleAction,
    input: UpdateUserScimInput,
    precondition?: VersionPrecondition
  ): Promise<LifecycleScimUpdateResult> {
    const current = this.#users.requireById(userId);
    const initialState = directoryUserStateSchema.parse(current.lifecycleState);
    const rule = providerRules[this.#provider][action];
    if (!rule?.from.has(initialState)) {
      throw new InvalidLifecycleActionError(this.#provider, action, initialState);
    }

    let previousState = initialState;
    let revoked = { accessTokens: 0, refreshTokens: 0 };
    const mutation = await this.#users.updateScim(
      userId,
      { ...input, lifecycleState: rule.to },
      precondition,
      (transactionalCurrent, requestedState) => {
        previousState = directoryUserStateSchema.parse(
          transactionalCurrent.lifecycleState
        );
        const transactionalRule = providerRules[this.#provider][action];
        if (
          !transactionalRule?.from.has(previousState) ||
          requestedState !== transactionalRule.to
        ) {
          throw new InvalidLifecycleActionError(this.#provider, action, previousState);
        }
        if (transactionalRule.revokesTokens) {
          revoked = this.#revokeTokens(userId);
        }
      }
    );
    return {
      userId,
      provider: this.#provider,
      action,
      previousState,
      currentState: mutation.record.lifecycleState,
      changed: mutation.changed,
      version: mutation.record.resourceVersion,
      etag: scimWeakEtag(mutation.record.resourceVersion),
      revoked,
      record: mutation.record,
    };
  }

  simulate(
    userId: string,
    action: LifecycleAction,
    precondition?: VersionPrecondition
  ): LifecycleResult {
    return this.apply(userId, action, precondition);
  }

  /**
   * Internal SCIM race seam. A competing storage-level delete must tombstone the
   * User, remove memberships, bump affected Groups, and revoke credentials in the
   * single repository transaction even when the provider's normal API sequence has
   * an intermediate state (for example Okta deprovision-then-delete).
   */
  applyConcurrentSoftDelete(
    userId: string,
    precondition?: VersionPrecondition
  ): LifecycleResult {
    const current = this.#users.requireById(userId);
    const previousState = directoryUserStateSchema.parse(current.lifecycleState);
    let revoked = { accessTokens: 0, refreshTokens: 0 };
    const mutation = this.#users.transitionLifecycle(
      userId,
      "deleted",
      precondition,
      () => {
        revoked = this.#revokeTokens(userId);
      }
    );
    return {
      userId,
      provider: this.#provider,
      action: "delete",
      previousState,
      currentState: mutation.record.lifecycleState,
      changed: mutation.changed,
      version: mutation.record.resourceVersion,
      etag: scimWeakEtag(mutation.record.resourceVersion),
      revoked,
    };
  }

  #revokeTokens(userId: string): { accessTokens: number; refreshTokens: number } {
    const now = this.#clock.now().toISOString();
    const accessTokens = Number(
      this.#store.get<CountRow>(
        `SELECT COUNT(*) AS count FROM oauth_access_tokens
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
        userId,
        now
      )?.count ?? 0
    );
    const refreshTokens = Number(
      this.#store.get<CountRow>(
        `SELECT COUNT(*) AS count FROM refresh_tokens
         WHERE user_id = ? AND consumed_at IS NULL AND revoked_at IS NULL
           AND expires_at > ?`,
        userId,
        now
      )?.count ?? 0
    );
    this.#store.run(
      `UPDATE oauth_access_tokens SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
      now,
      userId
    );
    this.#store.run(
      `UPDATE refresh_tokens SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
      now,
      userId
    );
    // UserRepository owns Authn capability invalidation for every lifecycle
    // mutation path, including exported convenience mutators that bypass this
    // service. This callback remains responsible for tracked OAuth credentials.
    return { accessTokens, refreshTokens };
  }
}
