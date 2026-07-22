import {
  DirectoryResourceNotFoundError,
  DirectoryUniquenessError,
  type Engine,
  InvalidLifecycleActionError,
  type UserRecord,
} from "@mockos/core";
import {
  type GraphDirectoryEngine,
  type GraphDirectoryGroup,
  type GraphDirectoryUser,
  OktaApiError,
  type OktaDirectoryApiEngine,
  type OktaDirectoryGroup,
  type OktaDirectoryUser,
} from "@mockos/engine-http";

const graphUser = (user: UserRecord): GraphDirectoryUser => ({
  id: user.id,
  userName: user.userName,
  displayName: user.displayName,
  ...(user.givenName ? { givenName: user.givenName } : {}),
  ...(user.familyName ? { familyName: user.familyName } : {}),
  accountEnabled: user.accountEnabled,
  createdAt: user.createdAt,
});

const graphGroup = (
  group: ReturnType<Engine["groups"]["requireById"]>
): GraphDirectoryGroup => ({
  id: group.id,
  displayName: group.displayName,
  createdAt: group.createdAt,
});

const oktaUser = (user: UserRecord): OktaDirectoryUser => ({
  id: user.id,
  userName: user.userName,
  displayName: user.displayName,
  ...(user.givenName ? { givenName: user.givenName } : {}),
  ...(user.familyName ? { familyName: user.familyName } : {}),
  state: user.lifecycleState,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const oktaGroup = (
  group: ReturnType<Engine["groups"]["requireById"]>
): OktaDirectoryGroup => ({
  id: group.id,
  displayName: group.displayName,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

const oktaFailure = (error: unknown): never => {
  if (error instanceof DirectoryResourceNotFoundError) {
    throw new OktaApiError(
      "E0000007",
      `Not found: Resource not found: ${error.resourceId} (${error.resourceType})`,
      404
    );
  }
  if (error instanceof DirectoryUniquenessError) {
    throw new OktaApiError("E0000001", "Api validation failed", 400, [
      `${error.attribute}: An object with this field already exists`,
    ]);
  }
  if (error instanceof InvalidLifecycleActionError) {
    throw new OktaApiError("E0000001", "Api validation failed: lifecycle", 400, [
      error.message,
    ]);
  }
  throw error;
};

const withOktaErrors = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    return oktaFailure(error);
  }
};

const withOktaErrorsAsync = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    return oktaFailure(error);
  }
};

export const createGraphDirectoryEngine = (engine: Engine): GraphDirectoryEngine => ({
  listUsers: () => engine.users.list().map(graphUser),
  getUser: (id) => {
    const user = engine.users.findById(id) ?? engine.users.findByUserName(id);
    return user && !user.softDeletedAt ? graphUser(user) : undefined;
  },
  listGroups: () => engine.groups.list().map(graphGroup),
  getGroup: (id) => {
    const group = engine.groups.findById(id);
    return group && !group.softDeletedAt ? graphGroup(group) : undefined;
  },
  listGroupMembers: (groupId) => engine.groups.listMembers(groupId).map(graphUser),
  listUserGroups: (userId) => engine.groups.listForUser(userId).map(graphGroup),
  listUserGroupIds: (userId, limit) => engine.groups.listIdsForUser(userId, limit),
});

export const createOktaDirectoryEngine = (engine: Engine): OktaDirectoryApiEngine => ({
  listUsers: () => engine.users.list().map(oktaUser),
  getUser: (idOrLogin) => {
    const user =
      engine.users.findById(idOrLogin) ?? engine.users.findByUserName(idOrLogin);
    return user && !user.softDeletedAt ? oktaUser(user) : undefined;
  },
  createUser: (input) =>
    withOktaErrorsAsync(async () =>
      oktaUser(
        await engine.users.create({
          userName: input.userName,
          displayName: input.displayName,
          ...(input.givenName ? { givenName: input.givenName } : {}),
          ...(input.familyName ? { familyName: input.familyName } : {}),
          lifecycleState: input.activate === false ? "staged" : "active",
        })
      )
    ),
  updateUser: (id, input) =>
    withOktaErrorsAsync(async () =>
      oktaUser(
        (
          await engine.users.updateScim(id, {
            ...(input.userName ? { userName: input.userName } : {}),
            ...(input.displayName ? { displayName: input.displayName } : {}),
            ...(input.givenName !== undefined
              ? { givenName: input.givenName ?? null }
              : {}),
            ...(input.familyName !== undefined
              ? { familyName: input.familyName ?? null }
              : {}),
          })
        ).record
      )
    ),
  lifecycleUser: async (id, action) =>
    withOktaErrors(() => {
      engine.lifecycle.apply(id, action);
      return oktaUser(engine.users.requireById(id));
    }),
  deleteUser: async (id) =>
    withOktaErrors(() => {
      const user = engine.users.requireById(id);
      engine.lifecycle.apply(
        id,
        user.lifecycleState === "deprovisioned" ? "delete" : "deprovision"
      );
    }),
  listGroups: () => engine.groups.list().map(oktaGroup),
  getGroup: (id) => {
    const group = engine.groups.findById(id);
    return group && !group.softDeletedAt ? oktaGroup(group) : undefined;
  },
  createGroup: (displayName) =>
    withOktaErrors(() => oktaGroup(engine.groups.create({ displayName }))),
  updateGroup: (id, displayName) =>
    withOktaErrors(() =>
      oktaGroup(engine.groups.updateScim(id, { displayName }).record)
    ),
  deleteGroup: (id) =>
    withOktaErrors(() => {
      engine.groups.deleteScim(id);
    }),
  listGroupMembers: (id) =>
    withOktaErrors(() => engine.groups.listMembers(id).map(oktaUser)),
  addGroupMember: (groupId, userId) =>
    withOktaErrors(() => {
      engine.groups.addMember(groupId, userId);
    }),
  removeGroupMember: (groupId, userId) =>
    withOktaErrors(() => {
      engine.groups.removeMember(groupId, userId);
    }),
});
