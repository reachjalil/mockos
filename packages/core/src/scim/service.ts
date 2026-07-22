import {
  type DirectoryUserState,
  type LifecycleAction,
  type ProviderId,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  type ScimDialect,
  type ScimGroupInput,
  type ScimGroupResource,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimQuery,
  type ScimUserInput,
  type ScimUserResource,
  scimGroupResourceSchema,
  scimUserResourceSchema,
} from "@mockos/contracts";
import {
  DirectoryResourceNotFoundError,
  DirectoryUniquenessError,
  DirectoryVersionPreconditionError,
  type GroupRecord,
  type GroupRepository,
  InvalidLifecycleActionError,
  type LifecycleService,
  type UpdateUserScimInput,
  type UserRecord,
  type UserRepository,
} from "../directory";
import { getProviderProfile, type ProviderProfile } from "../providers";
import {
  formatScimEtag,
  parseScimIfMatch,
  ScimProtocolError,
  type ScimVersionPrecondition,
} from "./errors";
import { evaluateScimFilter, parseScimAttributePath, parseScimFilter } from "./filter";
import { applyScimPatch } from "./patch";

const SERVICE_PROVIDER_CONFIG_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
const RESOURCE_TYPE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
const SCHEMA_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Schema";

export interface ScimServiceDependencies {
  readonly users: UserRepository;
  readonly groups: GroupRepository;
  readonly lifecycle: LifecycleService;
  readonly provider: ProviderId | Pick<ProviderProfile, "id" | "scimDialect">;
  readonly dialect?: ScimDialect;
}

export interface ScimServiceResourceResult<T> {
  readonly resource: T;
  readonly etag: string;
  readonly location: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cloneRecord = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> => structuredClone(value) as Record<string, unknown>;

const deleteCaseInsensitive = (record: Record<string, unknown>, name: string): void => {
  const normalized = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === normalized) delete record[key];
  }
};

const getCaseInsensitive = (
  record: Readonly<Record<string, unknown>>,
  name: string
): { readonly key: string; readonly value: unknown } | undefined => {
  const normalized = name.toLowerCase();
  const key = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === normalized
  );
  return key === undefined ? undefined : { key, value: record[key] };
};

const safeUserScim = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const result = cloneRecord(value);
  const sourceName = getCaseInsensitive(result, "name");
  for (const reserved of [
    "schemas",
    "id",
    "externalId",
    "userName",
    "displayName",
    "active",
    "password",
    "groups",
    "meta",
    "name",
  ]) {
    deleteCaseInsensitive(result, reserved);
  }
  if (sourceName && isRecord(sourceName.value)) {
    const residualName = cloneRecord(sourceName.value);
    deleteCaseInsensitive(residualName, "givenName");
    deleteCaseInsensitive(residualName, "familyName");
    if (Object.keys(residualName).length > 0) result.name = residualName;
  }
  return result;
};

const safeGroupScim = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const result = cloneRecord(value);
  for (const reserved of [
    "schemas",
    "id",
    "externalId",
    "displayName",
    "members",
    "meta",
  ]) {
    deleteCaseInsensitive(result, reserved);
  }
  return result;
};

const userScimFromInput = (input: ScimUserInput): Record<string, unknown> =>
  safeUserScim(input as Readonly<Record<string, unknown>>);

const groupScimFromInput = (input: ScimGroupInput): Record<string, unknown> =>
  safeGroupScim(input as Readonly<Record<string, unknown>>);

const translatedError = (error: unknown): ScimProtocolError => {
  if (error instanceof ScimProtocolError) return error;
  if (error instanceof DirectoryResourceNotFoundError) {
    return new ScimProtocolError(404, error.message);
  }
  if (error instanceof DirectoryUniquenessError) {
    return new ScimProtocolError(409, error.message, "uniqueness");
  }
  if (error instanceof DirectoryVersionPreconditionError) {
    return new ScimProtocolError(412, error.message);
  }
  if (error instanceof InvalidLifecycleActionError) {
    return new ScimProtocolError(400, error.message, "invalidValue");
  }
  if (error instanceof RangeError) {
    return new ScimProtocolError(400, error.message, "invalidVers");
  }
  if (
    error instanceof Error &&
    /required|invalid|cannot be empty/i.test(error.message)
  ) {
    return new ScimProtocolError(400, error.message, "invalidValue");
  }
  return new ScimProtocolError(
    500,
    "The mock SCIM service could not complete the directory operation."
  );
};

export const translateScimServiceError = (error: unknown): ScimProtocolError =>
  translatedError(error);

const normalizedBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid SCIM base URL.");
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch (error) {
    throw new ScimProtocolError(400, "The SCIM base URL is invalid.", "invalidValue", {
      cause: error,
    });
  }
};

type ProjectionSelector = {
  readonly root: string;
  readonly child?: string;
  readonly grandchild?: string;
};

const projectionSelectors = (value: string): readonly ProjectionSelector[] => {
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length > 100 || entries.some((entry) => !entry)) {
    throw new ScimProtocolError(
      400,
      "SCIM attribute projection contains an empty or excessive path list.",
      "invalidPath"
    );
  }
  return entries.map((entry) => {
    const path = parseScimAttributePath(entry, { errorType: "invalidPath" });
    if (path.schema) {
      if (
        path.schema.toLowerCase() === SCIM_CORE_USER_SCHEMA.toLowerCase() ||
        path.schema.toLowerCase() === SCIM_CORE_GROUP_SCHEMA.toLowerCase()
      ) {
        return {
          root: path.attribute,
          ...(path.subAttribute ? { child: path.subAttribute } : {}),
        };
      }
      return {
        root: path.schema,
        child: path.attribute,
        ...(path.subAttribute ? { grandchild: path.subAttribute } : {}),
      };
    }
    return {
      root: path.attribute,
      ...(path.subAttribute ? { child: path.subAttribute } : {}),
    };
  });
};

const projectedComplex = (
  value: unknown,
  child: string,
  grandchild?: string
): unknown => {
  const projectOne = (candidate: unknown): unknown => {
    if (!isRecord(candidate)) return candidate;
    const selected = getCaseInsensitive(candidate, child);
    if (!selected) return {};
    if (!grandchild) return { [selected.key]: structuredClone(selected.value) };
    if (!isRecord(selected.value)) return { [selected.key]: {} };
    const nested = getCaseInsensitive(selected.value, grandchild);
    return {
      [selected.key]: nested ? { [nested.key]: structuredClone(nested.value) } : {},
    };
  };
  return Array.isArray(value) ? value.map(projectOne) : projectOne(value);
};

const projectResource = (
  resource: Readonly<Record<string, unknown>>,
  query: ScimQuery
): Record<string, unknown> => {
  if (query.attributes && query.excludedAttributes) {
    throw new ScimProtocolError(
      400,
      "attributes and excludedAttributes cannot be used together.",
      "invalidValue"
    );
  }
  if (!query.attributes && !query.excludedAttributes) return cloneRecord(resource);
  const selectors = projectionSelectors(
    query.attributes ?? (query.excludedAttributes as string)
  );
  if (query.attributes) {
    const result: Record<string, unknown> = {};
    for (const required of ["schemas", "id", "meta"]) {
      const selected = getCaseInsensitive(resource, required);
      if (selected) result[selected.key] = structuredClone(selected.value);
    }
    for (const selector of selectors) {
      const selected = getCaseInsensitive(resource, selector.root);
      if (!selected) continue;
      result[selected.key] = selector.child
        ? projectedComplex(selected.value, selector.child, selector.grandchild)
        : structuredClone(selected.value);
    }
    return result;
  }

  const result = cloneRecord(resource);
  for (const selector of selectors) {
    if (["schemas", "id"].includes(selector.root.toLowerCase())) continue;
    const selected = getCaseInsensitive(result, selector.root);
    if (!selected) continue;
    if (!selector.child) {
      delete result[selected.key];
      continue;
    }
    const removeOne = (candidate: unknown): unknown => {
      if (!isRecord(candidate)) return candidate;
      const copy = cloneRecord(candidate);
      const child = getCaseInsensitive(copy, selector.child as string);
      if (!child) return copy;
      if (!selector.grandchild) {
        delete copy[child.key];
      } else if (isRecord(child.value)) {
        const nested = cloneRecord(child.value);
        deleteCaseInsensitive(nested, selector.grandchild);
        copy[child.key] = nested;
      }
      return copy;
    };
    result[selected.key] = Array.isArray(selected.value)
      ? selected.value.map(removeOne)
      : removeOne(selected.value);
  }
  return result;
};

const queryResources = (
  resources: readonly Readonly<Record<string, unknown>>[],
  query: ScimQuery
): ScimListResponse => {
  const filtered = query.filter
    ? resources.filter((resource) =>
        evaluateScimFilter(parseScimFilter(query.filter as string), resource, {
          caseExact: (path) =>
            ["id", "externalid", "value", "$ref"].includes(
              (path.subAttribute ?? path.attribute).toLowerCase()
            ),
        })
      )
    : [...resources];
  const start = Math.max(0, query.startIndex - 1);
  const page = query.count === 0 ? [] : filtered.slice(start, start + query.count);
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: filtered.length,
    startIndex: query.startIndex,
    itemsPerPage: page.length,
    Resources: page.map((resource) => projectResource(resource, query)),
  };
};

const schemaDocument = (
  id: string,
  name: string,
  description: string,
  attributes: readonly Record<string, unknown>[],
  baseUrl: string
): Record<string, unknown> => ({
  schemas: [SCHEMA_SCHEMA],
  id,
  name,
  description,
  attributes,
  meta: {
    resourceType: "Schema",
    location: `${baseUrl}/Schemas/${encodeURIComponent(id)}`,
  },
});

const schemaDocuments = (baseUrl: string): readonly Record<string, unknown>[] => [
  schemaDocument(
    SCIM_CORE_USER_SCHEMA,
    "User",
    "SCIM core User schema supported by mockOS.",
    [
      { name: "userName", type: "string", multiValued: false, required: true },
      { name: "displayName", type: "string", multiValued: false, required: false },
      { name: "active", type: "boolean", multiValued: false, required: false },
      { name: "groups", type: "complex", multiValued: true, mutability: "readOnly" },
    ],
    baseUrl
  ),
  schemaDocument(
    SCIM_CORE_GROUP_SCHEMA,
    "Group",
    "SCIM core Group schema supported by mockOS.",
    [
      { name: "displayName", type: "string", multiValued: false, required: true },
      { name: "members", type: "complex", multiValued: true, required: false },
    ],
    baseUrl
  ),
  schemaDocument(
    SCIM_ENTERPRISE_USER_SCHEMA,
    "EnterpriseUser",
    "SCIM enterprise User extension supported by mockOS.",
    [
      { name: "employeeNumber", type: "string", multiValued: false },
      { name: "department", type: "string", multiValued: false },
      { name: "manager", type: "complex", multiValued: false },
    ],
    baseUrl
  ),
];

export class ScimService {
  readonly users: UserRepository;
  readonly groups: GroupRepository;
  readonly lifecycle: LifecycleService;
  readonly providerId: ProviderId;
  readonly dialect: ScimDialect;
  readonly groupPatchSuccessStatus: 200 | 204;

  constructor(options: ScimServiceDependencies) {
    this.users = options.users;
    this.groups = options.groups;
    this.lifecycle = options.lifecycle;
    const profile =
      typeof options.provider === "string"
        ? getProviderProfile(options.provider)
        : options.provider;
    this.providerId = profile.id;
    this.dialect = options.dialect ?? profile.scimDialect;
    this.groupPatchSuccessStatus = this.dialect.groupPatchSuccessStatus;
  }

  serviceProviderConfig(baseUrl: string): Record<string, unknown> {
    return this.#sync(() => {
      const base = normalizedBaseUrl(baseUrl);
      return {
        schemas: [SERVICE_PROVIDER_CONFIG_SCHEMA],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: true },
        sort: { supported: false },
        etag: { supported: true },
        authenticationSchemes: [
          {
            type: "oauthbearertoken",
            name: "Mock Bearer Token",
            description: "Any non-empty synthetic Bearer credential.",
            primary: true,
          },
        ],
        meta: {
          resourceType: "ServiceProviderConfig",
          location: `${base}/ServiceProviderConfig`,
        },
      };
    });
  }

  resourceTypes(baseUrl: string): ScimListResponse {
    return this.#sync(() => {
      const base = normalizedBaseUrl(baseUrl);
      const resources: Record<string, unknown>[] = [
        {
          schemas: [RESOURCE_TYPE_SCHEMA],
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: SCIM_CORE_USER_SCHEMA,
          schemaExtensions: [{ schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false }],
          meta: {
            resourceType: "ResourceType",
            location: `${base}/ResourceTypes/User`,
          },
        },
        {
          schemas: [RESOURCE_TYPE_SCHEMA],
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          schema: SCIM_CORE_GROUP_SCHEMA,
          meta: {
            resourceType: "ResourceType",
            location: `${base}/ResourceTypes/Group`,
          },
        },
      ];
      return {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA],
        totalResults: resources.length,
        startIndex: 1,
        itemsPerPage: resources.length,
        Resources: resources,
      };
    });
  }

  schemas(baseUrl: string): ScimListResponse {
    return this.#sync(() => {
      const resources = schemaDocuments(normalizedBaseUrl(baseUrl));
      return {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA],
        totalResults: resources.length,
        startIndex: 1,
        itemsPerPage: resources.length,
        Resources: [...resources],
      };
    });
  }

  schema(id: string, baseUrl: string): Record<string, unknown> | undefined {
    return this.#sync(() =>
      schemaDocuments(normalizedBaseUrl(baseUrl)).find((document) => document.id === id)
    );
  }

  listUsers(query: ScimQuery, baseUrl: string): ScimListResponse {
    return this.#sync(() =>
      queryResources(
        this.users.list().map((record) => this.#userResource(record, baseUrl)),
        query
      )
    );
  }

  getUser(
    id: string,
    baseUrl: string
  ): ScimServiceResourceResult<ScimUserResource> | undefined {
    return this.#sync(() => {
      const record = this.users.findById(id);
      if (!record || record.lifecycleState === "deleted") return undefined;
      return this.#userResult(record, baseUrl);
    });
  }

  async createUser(
    input: ScimUserInput,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimUserResource>> {
    return this.#async(async () => {
      this.#assertResourceSchemas(input.schemas, "User");
      const givenName = input.name?.givenName;
      const familyName = input.name?.familyName;
      const displayName =
        input.displayName ??
        input.name?.formatted ??
        ([givenName, familyName].filter(Boolean).join(" ") || input.userName);
      const active = input.active ?? true;
      const record = await this.users.create({
        ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
        userName: input.userName,
        displayName,
        ...(givenName === undefined ? {} : { givenName }),
        ...(familyName === undefined ? {} : { familyName }),
        ...(input.password === undefined ? {} : { password: input.password }),
        lifecycleState: active
          ? "active"
          : this.providerId === "okta"
            ? "staged"
            : "disabled",
        scim: userScimFromInput(input),
      });
      return this.#userResult(record, baseUrl);
    });
  }

  listGroups(query: ScimQuery, baseUrl: string): ScimListResponse {
    return this.#sync(() =>
      queryResources(
        this.groups.list().map((record) => this.#groupResource(record, baseUrl)),
        query
      )
    );
  }

  getGroup(
    id: string,
    baseUrl: string
  ): ScimServiceResourceResult<ScimGroupResource> | undefined {
    return this.#sync(() => {
      const record = this.groups.findById(id);
      if (!record || record.softDeletedAt) return undefined;
      return this.#groupResult(record, baseUrl);
    });
  }

  async createGroup(
    input: ScimGroupInput,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimGroupResource>> {
    return this.#async(async () => {
      this.#assertResourceSchemas(input.schemas, "Group");
      const record = this.groups.create({
        ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
        displayName: input.displayName,
        scim: groupScimFromInput(input),
        memberIds: input.members?.map((member) => member.value) ?? [],
      });
      return this.#groupResult(record, baseUrl);
    });
  }

  async replaceUser(
    id: string,
    input: ScimUserInput,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimUserResource>> {
    return this.#async(async () => {
      this.#assertResourceSchemas(input.schemas, "User");
      this.#assertMatchingId(input.id, id);
      const current = this.#requiredUser(id, baseUrl);
      const desired = scimUserResourceSchema.parse({
        ...input,
        id: current.id,
        displayName:
          input.displayName ??
          input.name?.formatted ??
          ([input.name?.givenName, input.name?.familyName].filter(Boolean).join(" ") ||
            input.userName),
        active: input.active ?? true,
        groups: current.groups,
        meta: current.meta,
      });
      const record = await this.#persistUser(
        this.users.requireById(id),
        desired,
        parseScimIfMatch(ifMatch)
      );
      return this.#userResult(record, baseUrl);
    });
  }

  async patchUser(
    id: string,
    patch: ScimPatchRequest,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimUserResource>> {
    return this.#async(async () => {
      const current = this.#requiredUser(id, baseUrl);
      const applied = applyScimPatch(current, patch, {
        resourceType: "User",
        dialect: this.dialect,
      });
      const precondition = parseScimIfMatch(ifMatch);
      const desired = scimUserResourceSchema.parse(applied.resource);
      const record = await this.#persistUser(
        this.users.requireById(id),
        desired,
        precondition
      );
      return this.#userResult(record, baseUrl);
    });
  }

  async deleteUser(id: string, ifMatch: string | undefined): Promise<void> {
    return this.#async(async () => {
      const current = this.users.requireById(id);
      if (current.lifecycleState === "deleted") {
        throw new DirectoryResourceNotFoundError("User", id);
      }
      const precondition = parseScimIfMatch(ifMatch);
      if (this.providerId === "okta" && current.lifecycleState !== "deprovisioned") {
        this.lifecycle.apply(id, "deprovision", precondition);
        this.lifecycle.apply(id, "delete");
      } else {
        this.lifecycle.apply(id, "delete", precondition);
      }
    });
  }

  async replaceGroup(
    id: string,
    input: ScimGroupInput,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimGroupResource>> {
    return this.#async(async () => {
      this.#assertResourceSchemas(input.schemas, "Group");
      this.#assertMatchingId(input.id, id);
      this.#requiredGroup(id, baseUrl);
      const mutation = this.groups.updateScim(
        id,
        {
          externalId: input.externalId ?? null,
          displayName: input.displayName,
          scim: groupScimFromInput(input),
          memberIds: input.members?.map((member) => member.value) ?? [],
        },
        parseScimIfMatch(ifMatch)
      );
      return this.#groupResult(mutation.record, baseUrl);
    });
  }

  async patchGroup(
    id: string,
    patch: ScimPatchRequest,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimServiceResourceResult<ScimGroupResource>> {
    return this.#async(async () => {
      const current = this.#requiredGroup(id, baseUrl);
      const applied = applyScimPatch(current, patch, {
        resourceType: "Group",
        dialect: this.dialect,
      });
      const desired = scimGroupResourceSchema.parse(applied.resource);
      const mutation = this.groups.updateScim(
        id,
        applied.changed
          ? {
              externalId: desired.externalId ?? null,
              displayName: desired.displayName,
              scim: safeGroupScim(desired),
              memberIds: desired.members.map((member) => member.value),
            }
          : {},
        parseScimIfMatch(ifMatch)
      );
      return this.#groupResult(mutation.record, baseUrl);
    });
  }

  async deleteGroup(id: string, ifMatch: string | undefined): Promise<void> {
    return this.#async(async () => {
      this.groups.deleteScim(id, parseScimIfMatch(ifMatch));
    });
  }

  #userResource(record: UserRecord, baseUrl: string): ScimUserResource {
    const base = normalizedBaseUrl(baseUrl);
    const stored = safeUserScim(record.scim);
    const storedName = isRecord(stored.name) ? cloneRecord(stored.name) : {};
    delete stored.name;
    const name = {
      ...storedName,
      ...(record.givenName ? { givenName: record.givenName } : {}),
      ...(record.familyName ? { familyName: record.familyName } : {}),
    };
    const enterprise = getCaseInsensitive(stored, SCIM_ENTERPRISE_USER_SCHEMA);
    const schemas = [
      SCIM_CORE_USER_SCHEMA,
      ...(enterprise ? [SCIM_ENTERPRISE_USER_SCHEMA] : []),
    ];
    const location = `${base}/Users/${encodeURIComponent(record.id)}`;
    return scimUserResourceSchema.parse({
      ...stored,
      schemas,
      id: record.id,
      ...(record.externalId === undefined ? {} : { externalId: record.externalId }),
      userName: record.userName,
      ...(Object.keys(name).length === 0 ? {} : { name }),
      displayName: record.displayName,
      active: record.lifecycleState === "active",
      groups: this.groups.listForUser(record.id).map((group) => ({
        value: group.id,
        display: group.displayName,
        type: "direct",
        $ref: `${base}/Groups/${encodeURIComponent(group.id)}`,
      })),
      meta: {
        resourceType: "User",
        created: record.createdAt,
        lastModified: record.updatedAt,
        location,
        version: formatScimEtag(record.resourceVersion),
      },
    });
  }

  #groupResource(record: GroupRecord, baseUrl: string): ScimGroupResource {
    const base = normalizedBaseUrl(baseUrl);
    const location = `${base}/Groups/${encodeURIComponent(record.id)}`;
    return scimGroupResourceSchema.parse({
      ...safeGroupScim(record.scim),
      schemas: [SCIM_CORE_GROUP_SCHEMA],
      id: record.id,
      ...(record.externalId === undefined ? {} : { externalId: record.externalId }),
      displayName: record.displayName,
      members: this.groups.listMembers(record.id).map((user) => ({
        value: user.id,
        display: user.displayName,
        type: "User",
        $ref: `${base}/Users/${encodeURIComponent(user.id)}`,
      })),
      meta: {
        resourceType: "Group",
        created: record.createdAt,
        lastModified: record.updatedAt,
        location,
        version: formatScimEtag(record.resourceVersion),
      },
    });
  }

  #userResult(
    record: UserRecord,
    baseUrl: string
  ): ScimServiceResourceResult<ScimUserResource> {
    const resource = this.#userResource(record, baseUrl);
    return {
      resource,
      etag: resource.meta.version,
      location: resource.meta.location,
    };
  }

  #groupResult(
    record: GroupRecord,
    baseUrl: string
  ): ScimServiceResourceResult<ScimGroupResource> {
    const resource = this.#groupResource(record, baseUrl);
    return {
      resource,
      etag: resource.meta.version,
      location: resource.meta.location,
    };
  }

  #requiredUser(id: string, baseUrl: string): ScimUserResource {
    const record = this.users.findById(id);
    if (!record || record.lifecycleState === "deleted") {
      throw new DirectoryResourceNotFoundError("User", id);
    }
    return this.#userResource(record, baseUrl);
  }

  #requiredGroup(id: string, baseUrl: string): ScimGroupResource {
    const record = this.groups.findById(id);
    if (!record || record.softDeletedAt) {
      throw new DirectoryResourceNotFoundError("Group", id);
    }
    return this.#groupResource(record, baseUrl);
  }

  async #persistUser(
    current: UserRecord,
    desired: ScimUserResource,
    precondition: ScimVersionPrecondition
  ): Promise<UserRecord> {
    const displayName =
      desired.displayName ??
      desired.name?.formatted ??
      ([desired.name?.givenName, desired.name?.familyName].filter(Boolean).join(" ") ||
        desired.userName);
    const update: UpdateUserScimInput = {
      externalId: desired.externalId ?? null,
      userName: desired.userName,
      displayName,
      givenName: desired.name?.givenName ?? null,
      familyName: desired.name?.familyName ?? null,
      ...(desired.password === undefined ? {} : { password: desired.password }),
      scim: safeUserScim(desired),
    };
    const action = this.#lifecycleAction(current.lifecycleState, desired.active);
    if (!action) {
      return (await this.users.updateScim(current.id, update, precondition)).record;
    }
    return (
      await this.lifecycle.applyScimUpdate(current.id, action, update, precondition)
    ).record;
  }

  #lifecycleAction(
    currentState: DirectoryUserState,
    requestedActive: boolean
  ): LifecycleAction | undefined {
    if (requestedActive) {
      if (currentState === "active") return undefined;
      if (currentState === "staged") return "activate";
      if (this.providerId === "entra" && currentState === "disabled") {
        return "reactivate";
      }
      if (this.providerId === "okta" && currentState === "deprovisioned") {
        return "reactivate";
      }
      if (this.providerId === "okta" && currentState === "suspended") {
        return "unsuspend";
      }
    } else if (this.providerId === "entra") {
      if (
        currentState === "active" ||
        currentState === "disabled" ||
        currentState === "suspended"
      ) {
        return "disable";
      }
      if (currentState === "staged") return undefined;
    } else {
      if (
        currentState === "active" ||
        currentState === "suspended" ||
        currentState === "deprovisioned"
      ) {
        return "deprovision";
      }
      if (currentState === "staged") return undefined;
    }
    throw new ScimProtocolError(
      400,
      `The requested active value is invalid for a ${this.providerId} user in state '${currentState}'.`,
      "invalidValue"
    );
  }

  #assertResourceSchemas(
    schemas: readonly string[],
    resourceType: "User" | "Group"
  ): void {
    const coreSchema =
      resourceType === "User" ? SCIM_CORE_USER_SCHEMA : SCIM_CORE_GROUP_SCHEMA;
    const allowed = new Set([
      coreSchema.toLowerCase(),
      ...(resourceType === "User" && this.dialect.acceptsEnterpriseExtension
        ? [SCIM_ENTERPRISE_USER_SCHEMA.toLowerCase()]
        : []),
    ]);
    const normalized = schemas.map((schema) => schema.toLowerCase());
    if (
      !normalized.includes(coreSchema.toLowerCase()) ||
      new Set(normalized).size !== normalized.length ||
      normalized.some((schema) => !allowed.has(schema))
    ) {
      throw new ScimProtocolError(
        400,
        `The schemas attribute must contain the ${resourceType} core schema and only supported extensions.`,
        "invalidValue"
      );
    }
  }

  #assertMatchingId(inputId: string | undefined, routeId: string): void {
    if (inputId !== undefined && inputId !== routeId) {
      throw new ScimProtocolError(
        400,
        "The service-provider-issued resource id is immutable.",
        "mutability"
      );
    }
  }

  #sync<T>(callback: () => T): T {
    try {
      return callback();
    } catch (error) {
      throw translatedError(error);
    }
  }

  async #async<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      throw translatedError(error);
    }
  }
}
