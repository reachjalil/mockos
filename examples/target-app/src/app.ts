import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_TARGET_SCIM_BODY_BYTES = 64 * 1_024;
export const MAX_TARGET_CAPTURE_BODY_BYTES = 8 * 1_024;
export const MAX_TARGET_CAPTURE_STATE_BYTES = 32 * 1_024;
export const MAX_TARGET_RESOURCE_STATE_BYTES = 48 * 1_024;
const CAPTURE_TRUNCATED_MARKER = "[mockOS target capture truncated]";

export type TargetAppBindings = {
  E2E_OWNER_NONCE?: string;
  TARGET_CONTROL_TOKEN?: string;
  TARGET_SCIM_TOKEN?: string;
};

type TargetHonoEnv = { Bindings: TargetAppBindings };

export type CapturedScimRequest = {
  sequence: number;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  responseStatus: number;
};

export type TargetScimResource = Record<string, unknown> & {
  id: string;
  meta: {
    created: string;
    lastModified: string;
    location: string;
    resourceType: "Group" | "User";
    version: string;
  };
  schemas: string[];
};

export type TargetAppStateSnapshot = {
  version: 1;
  captures: CapturedScimRequest[];
  groups: TargetScimResource[];
  mutationTick: number;
  nextCaptureSequence: number;
  nextGroupId: number;
  nextUserId: number;
  users: TargetScimResource[];
};

export class TargetAppCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetAppCapacityError";
  }
}

class TargetRequestBodyTooLargeError extends Error {
  constructor() {
    super("The SCIM request body exceeds the target-app limit.");
    this.name = "TargetRequestBodyTooLargeError";
  }
}

const clone = <T>(value: T): T => structuredClone(value);

const timestampFor = (tick: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();

const version = (value: number) => `W/"${value}"`;

const pathWithoutTrailingSlash = (value: string) =>
  value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;

const locationFor = (
  request: Request,
  resourceType: "Groups" | "Users",
  id: string
) => {
  const url = new URL(request.url);
  return `${url.origin}/scim/v2/${resourceType}/${encodeURIComponent(id)}`;
};

const redactedAuthorization = (value: string | null) => {
  if (!value) return undefined;
  const scheme = value.trim().split(/\s+/, 1)[0];
  return scheme ? `${scheme} <redacted>` : "<redacted>";
};

const captureHeaders = (request: Request) => {
  const output: Record<string, string> = {};
  const authorization = redactedAuthorization(request.headers.get("authorization"));
  if (authorization) output.authorization = authorization;
  for (const name of ["accept", "content-type", "if-match"]) {
    const value = request.headers.get(name);
    if (value) output[name] = value;
  }
  return output;
};

const utf8Bytes = (value: unknown) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))
    .byteLength;

const readBodyWithinLimit = async (request: Request): Promise<string> => {
  const announcedLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(announcedLength) &&
    announcedLength > MAX_TARGET_SCIM_BODY_BYTES
  ) {
    throw new TargetRequestBodyTooLargeError();
  }
  const body = request.clone().body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TARGET_SCIM_BODY_BYTES) {
      void reader.cancel("mockOS target body limit reached").catch(() => undefined);
      throw new TargetRequestBodyTooLargeError();
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
};

const captureBody = async (request: Request) => {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const text = await readBodyWithinLimit(request);
  if (!text) return null;
  if (utf8Bytes(text) > MAX_TARGET_CAPTURE_BODY_BYTES) {
    return CAPTURE_TRUNCATED_MARKER;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const sameSecret = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const bearerToken = (request: Request) => {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : "";
};

const scimError = (
  status: number,
  detail: string,
  scimType?: "invalidFilter" | "invalidSyntax" | "mutability" | "uniqueness"
) =>
  Response.json(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    {
      status: status as ContentfulStatusCode,
      headers: { "content-type": "application/scim+json" },
    }
  );

const decodeFilterValue = (value: string) =>
  value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");

const filterResources = (
  resources: TargetScimResource[],
  filter: string | undefined
): TargetScimResource[] | Response => {
  if (!filter) return resources;
  const match = /^(userName|externalId|displayName)\s+eq\s+"((?:\\.|[^"])*)"$/i.exec(
    filter.trim()
  );
  if (!match?.[1] || match[2] === undefined) {
    return scimError(400, "The SCIM filter is not supported.", "invalidFilter");
  }
  const requestedName = match[1].toLowerCase();
  const name = ["username", "externalid", "displayname"].find(
    (candidate) => candidate === requestedName
  );
  const key =
    name === "username"
      ? "userName"
      : name === "externalid"
        ? "externalId"
        : "displayName";
  const expected = decodeFilterValue(match[2]);
  return resources.filter((resource) => resource[key] === expected);
};

const listResponse = (resources: TargetScimResource[], request: Request): Response => {
  const url = new URL(request.url);
  const startIndex = Math.max(
    1,
    Number.parseInt(url.searchParams.get("startIndex") ?? "1", 10)
  );
  const requestedCount = Math.max(
    0,
    Number.parseInt(url.searchParams.get("count") ?? String(resources.length), 10)
  );
  const page = resources.slice(startIndex - 1, startIndex - 1 + requestedCount);
  return Response.json(
    {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: resources.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page,
    },
    { headers: { "content-type": "application/scim+json" } }
  );
};

const requireString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
};

const assertSafeObjectGraph = (value: unknown) => {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || typeof candidate !== "object") continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    for (const key of Object.keys(candidate)) {
      if (UNSAFE_OBJECT_KEYS.has(key.toLowerCase())) {
        throw new TypeError("The SCIM request contains an unsafe object key.");
      }
      pending.push((candidate as Record<string, unknown>)[key]);
    }
  }
};

const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The SCIM request body must be an object.");
  }
  assertSafeObjectGraph(value);
  return value as Record<string, unknown>;
};

const readJsonObject = async (request: Request) => objectValue(await request.json());

const splitPath = (path: string) => {
  const parts = path.split(".").filter(Boolean);
  if (parts.some((part) => UNSAFE_OBJECT_KEYS.has(part.toLowerCase()))) {
    throw new TypeError("The SCIM PATCH path contains an unsafe object key.");
  }
  return parts;
};

const setNestedValue = (
  target: Record<string, unknown>,
  path: string,
  value: unknown
) => {
  const emailPath = /^emails\[type eq "([^"]+)"\]\.value$/i.exec(path);
  if (emailPath?.[1]) {
    const emails = Array.isArray(target.emails)
      ? clone(target.emails as Array<Record<string, unknown>>)
      : [];
    const existing = emails.find(
      (entry) => String(entry.type ?? "").toLowerCase() === emailPath[1]?.toLowerCase()
    );
    if (existing) existing.value = value;
    else emails.push({ type: emailPath[1], value, primary: emails.length === 0 });
    target.emails = emails;
    return;
  }

  const parts = splitPath(path);
  if (parts.length === 0) throw new TypeError("A SCIM PATCH path is required.");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = Object.hasOwn(current, part) ? current[part] : undefined;
    if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (leaf) current[leaf] = clone(value);
};

const removeNestedValue = (target: Record<string, unknown>, path: string) => {
  const memberPath = /^members\[value eq "([^"]+)"\]$/i.exec(path);
  if (memberPath?.[1] && Array.isArray(target.members)) {
    target.members = (target.members as Array<Record<string, unknown>>).filter(
      (member) => member.value !== memberPath[1]
    );
    return;
  }
  const parts = splitPath(path);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = Object.hasOwn(current, part) ? current[part] : undefined;
    if (!child || typeof child !== "object" || Array.isArray(child)) return;
    current = child as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (leaf) delete current[leaf];
};

const applyPatch = (resource: TargetScimResource, body: Record<string, unknown>) => {
  if (
    Array.isArray(body.schemas) &&
    !body.schemas.some((schema) => schema === SCIM_PATCH_SCHEMA)
  ) {
    throw new TypeError("The request is not a SCIM PatchOp document.");
  }
  const operations = body.Operations ?? body.operations;
  if (!Array.isArray(operations)) {
    throw new TypeError("SCIM PATCH requires an Operations array.");
  }
  const updated = clone(resource);
  for (const candidate of operations) {
    const operation = objectValue(candidate);
    const op = String(operation.op ?? "").toLowerCase();
    const path = typeof operation.path === "string" ? operation.path : undefined;
    if (!new Set(["add", "remove", "replace"]).has(op)) {
      throw new TypeError(`Unsupported SCIM PATCH operation: ${op || "missing"}.`);
    }
    if (op === "remove") {
      if (!path) throw new TypeError("SCIM remove operations require a path.");
      removeNestedValue(updated, path);
      continue;
    }
    if (!path) {
      for (const [key, value] of Object.entries(objectValue(operation.value))) {
        updated[key] = clone(value);
      }
      continue;
    }
    setNestedValue(updated, path, operation.value);
  }
  return updated;
};

export class TargetAppState {
  #captures: CapturedScimRequest[] = [];
  #groups = new Map<string, TargetScimResource>();
  #mutationTick = 0;
  #nextCaptureSequence = 1;
  #nextGroupId = 1;
  #nextUserId = 1;
  #users = new Map<string, TargetScimResource>();

  constructor(snapshot?: TargetAppStateSnapshot) {
    if (snapshot) this.restore(snapshot);
  }

  reset() {
    this.#captures = [];
    this.#groups.clear();
    this.#mutationTick = 0;
    this.#nextCaptureSequence = 1;
    this.#nextGroupId = 1;
    this.#nextUserId = 1;
    this.#users.clear();
  }

  capture(value: Omit<CapturedScimRequest, "sequence">) {
    this.#captures.push({
      sequence: this.#nextCaptureSequence,
      ...clone(value),
    });
    this.#nextCaptureSequence += 1;
    while (
      this.#captures.length > 0 &&
      utf8Bytes(this.#captures) > MAX_TARGET_CAPTURE_STATE_BYTES
    ) {
      this.#captures.shift();
    }
  }

  requests() {
    return clone(this.#captures);
  }

  users() {
    return clone([...this.#users.values()]);
  }

  groups() {
    return clone([...this.#groups.values()]);
  }

  snapshot(): TargetAppStateSnapshot {
    return clone({
      version: 1,
      captures: this.#captures,
      groups: [...this.#groups.values()],
      mutationTick: this.#mutationTick,
      nextCaptureSequence: this.#nextCaptureSequence,
      nextGroupId: this.#nextGroupId,
      nextUserId: this.#nextUserId,
      users: [...this.#users.values()],
    });
  }

  restore(snapshot: TargetAppStateSnapshot) {
    if (
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.captures) ||
      !Array.isArray(snapshot.groups) ||
      !Array.isArray(snapshot.users) ||
      ![
        snapshot.mutationTick,
        snapshot.nextCaptureSequence,
        snapshot.nextGroupId,
        snapshot.nextUserId,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      utf8Bytes(snapshot.captures) > MAX_TARGET_CAPTURE_STATE_BYTES ||
      utf8Bytes([...snapshot.users, ...snapshot.groups]) >
        MAX_TARGET_RESOURCE_STATE_BYTES
    ) {
      throw new Error("Stored target-app state is invalid.");
    }
    const users = new Map(snapshot.users.map((resource) => [resource.id, resource]));
    const groups = new Map(snapshot.groups.map((resource) => [resource.id, resource]));
    if (
      users.size !== snapshot.users.length ||
      groups.size !== snapshot.groups.length ||
      [...users.keys(), ...groups.keys()].some(
        (id) => typeof id !== "string" || id.length === 0
      )
    ) {
      throw new Error("Stored target-app resources are invalid.");
    }
    this.#captures = clone(snapshot.captures);
    this.#groups = new Map(clone([...groups.entries()]));
    this.#mutationTick = snapshot.mutationTick;
    this.#nextCaptureSequence = snapshot.nextCaptureSequence;
    this.#nextGroupId = snapshot.nextGroupId;
    this.#nextUserId = snapshot.nextUserId;
    this.#users = new Map(clone([...users.entries()]));
  }

  resource(type: "Groups" | "Users", id: string) {
    return (type === "Users" ? this.#users : this.#groups).get(id);
  }

  resources(type: "Groups" | "Users") {
    return [...(type === "Users" ? this.#users : this.#groups).values()];
  }

  create(type: "Groups" | "Users", input: Record<string, unknown>, request: Request) {
    const id =
      type === "Users"
        ? `usr-${String(this.#nextUserId).padStart(4, "0")}`
        : `grp-${String(this.#nextGroupId).padStart(4, "0")}`;
    const created = timestampFor(this.#mutationTick);
    const resource: TargetScimResource = {
      ...clone(input),
      schemas: [type === "Users" ? SCIM_USER_SCHEMA : SCIM_GROUP_SCHEMA],
      id,
      meta: {
        resourceType: type === "Users" ? "User" : "Group",
        created,
        lastModified: created,
        version: version(1),
        location: locationFor(request, type, id),
      },
    };
    this.#setResource(type, id, resource);
    if (type === "Users") this.#nextUserId += 1;
    else this.#nextGroupId += 1;
    this.#mutationTick += 1;
    return resource;
  }

  replace(
    type: "Groups" | "Users",
    id: string,
    input: Record<string, unknown>,
    request: Request
  ) {
    const previous = this.resource(type, id);
    if (!previous) return undefined;
    const nextVersion = this.#version(previous) + 1;
    const resource: TargetScimResource = {
      ...clone(input),
      schemas: [type === "Users" ? SCIM_USER_SCHEMA : SCIM_GROUP_SCHEMA],
      id,
      meta: {
        resourceType: type === "Users" ? "User" : "Group",
        created: previous.meta.created,
        lastModified: timestampFor(this.#mutationTick),
        version: version(nextVersion),
        location: locationFor(request, type, id),
      },
    };
    this.#setResource(type, id, resource);
    this.#mutationTick += 1;
    return resource;
  }

  patch(
    type: "Groups" | "Users",
    id: string,
    input: Record<string, unknown>,
    request: Request
  ) {
    const previous = this.resource(type, id);
    if (!previous) return undefined;
    const patched = applyPatch(previous, input);
    return this.replace(type, id, patched, request);
  }

  delete(type: "Groups" | "Users", id: string) {
    const deleted = (type === "Users" ? this.#users : this.#groups).delete(id);
    if (deleted && type === "Users") {
      for (const [groupId, group] of this.#groups) {
        if (!Array.isArray(group.members)) continue;
        const members = (group.members as Array<Record<string, unknown>>).filter(
          (member) => member.value !== id
        );
        if (members.length !== group.members.length) {
          this.#groups.set(groupId, { ...group, members });
        }
      }
    }
    return deleted;
  }

  #setResource(type: "Groups" | "Users", id: string, resource: TargetScimResource) {
    const users = new Map(this.#users);
    const groups = new Map(this.#groups);
    (type === "Users" ? users : groups).set(id, resource);
    if (
      utf8Bytes([...users.values(), ...groups.values()]) >
      MAX_TARGET_RESOURCE_STATE_BYTES
    ) {
      throw new TargetAppCapacityError(
        "The target-app resource-state limit has been reached."
      );
    }
    (type === "Users" ? this.#users : this.#groups).set(id, resource);
  }

  #version(resource: TargetScimResource) {
    const match = /\d+/.exec(resource.meta.version);
    return match ? Number.parseInt(match[0], 10) : 0;
  }
}

const authorizeScim = (context: Context<TargetHonoEnv>) => {
  const expected = context.env.TARGET_SCIM_TOKEN?.trim();
  if (!expected) {
    return scimError(503, "TARGET_SCIM_TOKEN is not configured.");
  }
  if (sameSecret(bearerToken(context.req.raw), expected)) return undefined;
  const response = scimError(401, "Supply the target SCIM Bearer token.");
  response.headers.set("www-authenticate", 'Bearer realm="mockos-target-app"');
  return response;
};

const authorizeControl = (context: Context<TargetHonoEnv>) => {
  const expected = context.env.TARGET_CONTROL_TOKEN?.trim();
  if (!expected) {
    return Response.json(
      { error: "TARGET_CONTROL_TOKEN is not configured." },
      { status: 503 }
    );
  }
  const presented = context.req.header("x-target-control-token") ?? "";
  if (sameSecret(presented, expected)) return undefined;
  return Response.json(
    { error: "Unauthorized test-harness request." },
    { status: 401 }
  );
};

const ensureUnique = (
  state: TargetAppState,
  type: "Groups" | "Users",
  input: Record<string, unknown>,
  excludedId?: string
) => {
  const key = type === "Users" ? "userName" : "displayName";
  const value = input[key];
  return state
    .resources(type)
    .some((resource) => resource.id !== excludedId && resource[key] === value);
};

const assertIfMatch = (request: Request, resource: TargetScimResource) => {
  const expected = request.headers.get("if-match");
  return !expected || expected === "*" || expected === resource.meta.version;
};

export const createTargetApp = (state = new TargetAppState()) => {
  const app = new Hono<TargetHonoEnv>();

  app.get("/health", (context) =>
    context.json({
      status: "ok",
      service: "mockos-target-app",
      ...(context.env.E2E_OWNER_NONCE
        ? { e2eOwnerNonce: context.env.E2E_OWNER_NONCE }
        : {}),
    })
  );

  app.use("/__test/*", async (context, next) => {
    const failure = authorizeControl(context);
    if (failure) return failure;
    return next();
  });

  app.post("/__test/reset", (context) => {
    state.reset();
    return context.json({ reset: true });
  });

  app.get("/__test/requests", (context) =>
    context.json({ requests: state.requests() })
  );

  app.get("/__test/state", (context) =>
    context.json({ users: state.users(), groups: state.groups() })
  );

  app.use("/scim/v2/*", async (context, next) => {
    const request = context.req.raw;
    const failure = authorizeScim(context);
    if (failure) return failure;
    let body: unknown;
    try {
      body = await captureBody(request);
    } catch (error) {
      if (error instanceof TargetRequestBodyTooLargeError) {
        return scimError(413, error.message);
      }
      throw error;
    }
    await next();
    const url = new URL(request.url);
    const query = Object.fromEntries(
      [...url.searchParams.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );
    state.capture({
      method: request.method,
      path: pathWithoutTrailingSlash(url.pathname),
      query,
      headers: captureHeaders(request),
      body,
      responseStatus: context.res.status,
    });
  });

  app.get("/scim/v2/ServiceProviderConfig", (context) =>
    context.json(
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: true },
        authenticationSchemes: [
          {
            type: "oauthbearertoken",
            name: "Bearer token",
            description: "Static local test token",
            specUri: "https://www.rfc-editor.org/rfc/rfc6750",
            primary: true,
          },
        ],
      },
      200,
      { "content-type": "application/scim+json" }
    )
  );

  app.get("/scim/v2/ResourceTypes", (context) => {
    const origin = new URL(context.req.url).origin;
    return context.json(
      {
        schemas: [SCIM_LIST_SCHEMA],
        totalResults: 2,
        Resources: [
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "User",
            name: "User",
            endpoint: "/Users",
            schema: SCIM_USER_SCHEMA,
            meta: {
              resourceType: "ResourceType",
              location: `${origin}/scim/v2/ResourceTypes/User`,
            },
          },
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "Group",
            name: "Group",
            endpoint: "/Groups",
            schema: SCIM_GROUP_SCHEMA,
            meta: {
              resourceType: "ResourceType",
              location: `${origin}/scim/v2/ResourceTypes/Group`,
            },
          },
        ],
        startIndex: 1,
        itemsPerPage: 2,
      },
      200,
      { "content-type": "application/scim+json" }
    );
  });

  app.get("/scim/v2/:type{Users|Groups}", (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    const filtered = filterResources(
      state.resources(type),
      context.req.query("filter")
    );
    return filtered instanceof Response
      ? filtered
      : listResponse(filtered, context.req.raw);
  });

  app.post("/scim/v2/:type{Users|Groups}", async (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    let input: Record<string, unknown>;
    try {
      input = await readJsonObject(context.req.raw);
      requireString(input[type === "Users" ? "userName" : "displayName"], type);
    } catch (error) {
      return scimError(
        400,
        error instanceof Error ? error.message : "Invalid SCIM resource.",
        "invalidSyntax"
      );
    }
    if (ensureUnique(state, type, input)) {
      return scimError(409, "The resource already exists.", "uniqueness");
    }
    let resource: TargetScimResource;
    try {
      resource = state.create(type, input, context.req.raw);
    } catch (error) {
      if (error instanceof TargetAppCapacityError) {
        return scimError(507, error.message);
      }
      throw error;
    }
    return Response.json(resource, {
      status: 201,
      headers: {
        "content-type": "application/scim+json",
        location: resource.meta.location,
        etag: resource.meta.version,
      },
    });
  });

  app.get("/scim/v2/:type{Users|Groups}/:id", (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    const resource = state.resource(type, context.req.param("id"));
    if (!resource) return scimError(404, "The SCIM resource was not found.");
    return Response.json(resource, {
      headers: {
        "content-type": "application/scim+json",
        etag: resource.meta.version,
      },
    });
  });

  app.put("/scim/v2/:type{Users|Groups}/:id", async (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    const id = context.req.param("id");
    const existing = state.resource(type, id);
    if (!existing) return scimError(404, "The SCIM resource was not found.");
    if (!assertIfMatch(context.req.raw, existing)) {
      return scimError(412, "The supplied ETag is stale.");
    }
    let input: Record<string, unknown>;
    try {
      input = await readJsonObject(context.req.raw);
      requireString(input[type === "Users" ? "userName" : "displayName"], type);
    } catch (error) {
      return scimError(
        400,
        error instanceof Error ? error.message : "Invalid SCIM resource.",
        "invalidSyntax"
      );
    }
    if (ensureUnique(state, type, input, id)) {
      return scimError(409, "The resource already exists.", "uniqueness");
    }
    let resource: TargetScimResource | undefined;
    try {
      resource = state.replace(type, id, input, context.req.raw);
    } catch (error) {
      if (error instanceof TargetAppCapacityError) {
        return scimError(507, error.message);
      }
      throw error;
    }
    return Response.json(resource, {
      headers: {
        "content-type": "application/scim+json",
        etag: resource?.meta.version ?? "",
      },
    });
  });

  app.patch("/scim/v2/:type{Users|Groups}/:id", async (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    const id = context.req.param("id");
    const existing = state.resource(type, id);
    if (!existing) return scimError(404, "The SCIM resource was not found.");
    if (!assertIfMatch(context.req.raw, existing)) {
      return scimError(412, "The supplied ETag is stale.");
    }
    let resource: TargetScimResource | undefined;
    try {
      resource = state.patch(
        type,
        id,
        await readJsonObject(context.req.raw),
        context.req.raw
      );
    } catch (error) {
      if (error instanceof TargetAppCapacityError) {
        return scimError(507, error.message);
      }
      return scimError(
        400,
        error instanceof Error ? error.message : "Invalid SCIM PATCH document.",
        "invalidSyntax"
      );
    }
    return Response.json(resource, {
      headers: {
        "content-type": "application/scim+json",
        etag: resource?.meta.version ?? "",
      },
    });
  });

  app.delete("/scim/v2/:type{Users|Groups}/:id", (context) => {
    const type = context.req.param("type") as "Groups" | "Users";
    return state.delete(type, context.req.param("id"))
      ? new Response(null, { status: 204 })
      : scimError(404, "The SCIM resource was not found.");
  });

  app.notFound((context) => {
    if (new URL(context.req.url).pathname.startsWith("/scim/")) {
      return scimError(404, "The SCIM endpoint was not found.");
    }
    return context.json({ error: "Not found." }, 404);
  });

  return { app, state };
};
