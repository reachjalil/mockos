import type { DirectoryUserState, LifecycleAction } from "@mockos/contracts";
import { Hono } from "hono";

const MAX_OKTA_BODY_BYTES = 1024 * 1024;
const MAX_OKTA_QUERY_BYTES = 2_048;
const MAX_OKTA_IDENTIFIER_BYTES = 512;
const textEncoder = new TextEncoder();

export type OktaDirectoryUser = {
  id: string;
  userName: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  state: DirectoryUserState;
  createdAt: string;
  updatedAt: string;
};

export type OktaDirectoryGroup = {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type OktaUserWrite = {
  userName: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  activate?: boolean;
};

export type OktaDirectoryApiEngine = {
  listUsers(): readonly OktaDirectoryUser[];
  getUser(idOrLogin: string): OktaDirectoryUser | undefined;
  createUser(input: OktaUserWrite): Promise<OktaDirectoryUser>;
  updateUser(
    id: string,
    input: Partial<Omit<OktaUserWrite, "activate">>
  ): Promise<OktaDirectoryUser>;
  lifecycleUser(id: string, action: LifecycleAction): Promise<OktaDirectoryUser>;
  deleteUser(id: string): Promise<void>;
  listGroups(): readonly OktaDirectoryGroup[];
  getGroup(id: string): OktaDirectoryGroup | undefined;
  createGroup(displayName: string): OktaDirectoryGroup;
  updateGroup(id: string, displayName: string): OktaDirectoryGroup;
  deleteGroup(id: string): void;
  listGroupMembers(id: string): readonly OktaDirectoryUser[];
  addGroupMember(groupId: string, userId: string): void;
  removeGroupMember(groupId: string, userId: string): void;
};

export type CreateOktaDirectoryApiOptions = {
  engine: OktaDirectoryApiEngine;
  requestId?: () => string;
};

export class OktaApiError extends Error {
  readonly errorCode: string;
  readonly status: number;
  readonly causes: readonly string[];

  constructor(
    errorCode: string,
    message: string,
    status: number,
    causes: readonly string[] = []
  ) {
    super(message);
    this.name = "OktaApiError";
    this.errorCode = errorCode;
    this.status = status;
    this.causes = causes;
  }
}

const authenticated = (request: Request): boolean => {
  const value = request.headers.get("authorization");
  return Boolean(value && /^SSWS[\t ]+\S(?:.*\S)?$/i.test(value));
};

const assertValidRequestPath = (request: Request): void => {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    throw new OktaApiError("E0000003", "The request URI is malformed.", 400);
  }
};

const routeIdentifier = (value: string, field = "id"): string => {
  if (!value || textEncoder.encode(value).byteLength > MAX_OKTA_IDENTIFIER_BYTES) {
    throw new OktaApiError("E0000001", "Api validation failed", 400, [
      `${field}: The identifier is invalid`,
    ]);
  }
  return value;
};

const statusFor = (state: DirectoryUserState) => {
  switch (state) {
    case "staged":
      return "STAGED";
    case "active":
      return "ACTIVE";
    case "suspended":
      return "SUSPENDED";
    case "disabled":
    case "deprovisioned":
      return "DEPROVISIONED";
    case "deleted":
      return "DEPROVISIONED";
  }
};

const publicApiBase = (request: Request) => {
  const url = new URL(request.url);
  const publicPath = request.headers.get("x-mockos-public-path");
  if (publicPath !== null) {
    try {
      if (!publicPath.startsWith("/") || publicPath.startsWith("//")) {
        throw new Error("Public path must be origin-relative.");
      }
      const parsed = new URL(publicPath, url.origin);
      decodeURIComponent(parsed.pathname);
      if (parsed.origin !== url.origin || parsed.search || parsed.hash) {
        throw new Error("Public path must not contain a query or fragment.");
      }
      url.pathname = parsed.pathname;
    } catch {
      throw new OktaApiError(
        "E0000003",
        "The routed Okta public path is malformed.",
        400
      );
    }
  }
  const marker = "/api/v1";
  const index = url.pathname.indexOf(marker);
  url.pathname = index >= 0 ? url.pathname.slice(0, index + marker.length) : marker;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const oktaUser = (user: OktaDirectoryUser, request: Request) => {
  const self = `${publicApiBase(request)}/users/${encodeURIComponent(user.id)}`;
  const status = statusFor(user.state);
  return {
    id: user.id,
    status,
    created: user.createdAt,
    activated: status === "ACTIVE" ? user.updatedAt : null,
    statusChanged: user.updatedAt,
    lastLogin: null,
    lastUpdated: user.updatedAt,
    passwordChanged: null,
    type: { id: "otyMockUser" },
    profile: {
      login: user.userName,
      email: user.userName,
      firstName: user.givenName ?? null,
      lastName: user.familyName ?? null,
      displayName: user.displayName,
    },
    credentials: {},
    _links: {
      self: { href: self },
      ...(status === "ACTIVE"
        ? {
            suspend: { href: `${self}/lifecycle/suspend`, method: "POST" },
            deactivate: { href: `${self}/lifecycle/deactivate`, method: "POST" },
          }
        : status === "SUSPENDED"
          ? {
              unsuspend: { href: `${self}/lifecycle/unsuspend`, method: "POST" },
              deactivate: { href: `${self}/lifecycle/deactivate`, method: "POST" },
            }
          : {
              activate: { href: `${self}/lifecycle/activate`, method: "POST" },
            }),
    },
  };
};

const oktaGroup = (group: OktaDirectoryGroup, request: Request) => {
  const self = `${publicApiBase(request)}/groups/${encodeURIComponent(group.id)}`;
  return {
    id: group.id,
    created: group.createdAt,
    lastUpdated: group.updatedAt,
    lastMembershipUpdated: group.updatedAt,
    objectClass: ["okta:user_group"],
    type: "OKTA_GROUP",
    profile: { name: group.displayName, description: "" },
    _links: {
      self: { href: self },
      users: { href: `${self}/users` },
    },
  };
};

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new OktaApiError("E0000001", "Api validation failed", 400, [
      `${field}: The field cannot be left blank`,
    ]);
  }
  return value.trim();
};

const boundedJson = async (request: Request): Promise<unknown> => {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > MAX_OKTA_BODY_BYTES) {
      throw new OktaApiError("E0000001", "Api validation failed: request body", 413);
    }
  }
  if (!request.body) {
    throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_OKTA_BODY_BYTES) {
        await reader.cancel();
        throw new OktaApiError("E0000001", "Api validation failed: request body", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof OktaApiError) throw error;
    throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
  } finally {
    reader.releaseLock();
  }
};

const userWrite = (value: unknown, activate: boolean | undefined): OktaUserWrite => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
  }
  const profile = Reflect.get(value, "profile");
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new OktaApiError("E0000001", "Api validation failed: profile", 400);
  }
  const login = requiredString(Reflect.get(profile, "login"), "profile.login");
  const displayNameRaw = Reflect.get(profile, "displayName");
  const firstName = Reflect.get(profile, "firstName");
  const lastName = Reflect.get(profile, "lastName");
  return {
    userName: login,
    displayName:
      typeof displayNameRaw === "string" && displayNameRaw.trim()
        ? displayNameRaw.trim()
        : [firstName, lastName].filter((item) => typeof item === "string").join(" ") ||
          login,
    ...(typeof firstName === "string" && firstName.trim()
      ? { givenName: firstName.trim() }
      : {}),
    ...(typeof lastName === "string" && lastName.trim()
      ? { familyName: lastName.trim() }
      : {}),
    ...(activate === undefined ? {} : { activate }),
  };
};

const userUpdate = (value: unknown): Partial<Omit<OktaUserWrite, "activate">> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OktaApiError("E0000003", "The request body was not well-formed.", 400);
  }
  const profile = Reflect.get(value, "profile");
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new OktaApiError("E0000001", "Api validation failed: profile", 400);
  }
  const login = Reflect.get(profile, "login");
  const displayName = Reflect.get(profile, "displayName");
  const firstName = Reflect.get(profile, "firstName");
  const lastName = Reflect.get(profile, "lastName");
  const update = {
    ...(typeof login === "string" && login.trim() ? { userName: login.trim() } : {}),
    ...(typeof displayName === "string" && displayName.trim()
      ? { displayName: displayName.trim() }
      : {}),
    ...(typeof firstName === "string"
      ? { givenName: firstName.trim() || undefined }
      : {}),
    ...(typeof lastName === "string"
      ? { familyName: lastName.trim() || undefined }
      : {}),
  };
  if (Object.keys(update).length === 0) {
    throw new OktaApiError("E0000001", "Api validation failed: profile", 400);
  }
  return update;
};

const limitFrom = (raw: string | undefined) => {
  if (raw === undefined) return 200;
  if (!/^[0-9]+$/.test(raw)) {
    throw new OktaApiError("E0000001", "Api validation failed: limit", 400);
  }
  const value = Number(raw);
  if (value < 1 || value > 200) {
    throw new OktaApiError("E0000001", "Api validation failed: limit", 400);
  }
  return value;
};

const page = <T extends { id: string }>(
  rows: readonly T[],
  request: Request,
  limitRaw: string | undefined,
  after: string | undefined
) => {
  const limit = limitFrom(limitRaw);
  const cursor = after ? rows.findIndex((row) => row.id === after) : -1;
  if (after && cursor < 0) {
    throw new OktaApiError("E0000001", "Api validation failed: after", 400);
  }
  const start = cursor + 1;
  const values = rows.slice(start, start + limit);
  const hasNext = start + values.length < rows.length;
  const next = hasNext ? new URL(request.url) : undefined;
  const last = values.at(-1);
  if (next && last) {
    const publicPath = request.headers.get("x-mockos-public-path");
    if (publicPath?.startsWith("/") && !publicPath.startsWith("//")) {
      next.pathname = new URL(publicPath, next.origin).pathname;
    }
    next.searchParams.set("limit", String(limit));
    next.searchParams.set("after", last.id);
  }
  return { values, next: next?.toString() };
};

const filteredUsers = (
  users: readonly OktaDirectoryUser[],
  expression: string | undefined
) => {
  if (!expression) return [...users];
  if (textEncoder.encode(expression).byteLength > MAX_OKTA_QUERY_BYTES) {
    throw new OktaApiError("E0000001", "Api validation failed: filter", 400);
  }
  const match = expression.match(/^profile\.login\s+eq\s+"([^"]+)"$/i);
  if (!match) {
    throw new OktaApiError("E0000001", "Api validation failed: filter", 400);
  }
  const login = match[1]?.toLocaleLowerCase();
  return users.filter((user) => user.userName.toLocaleLowerCase() === login);
};

const booleanQuery = (raw: string | undefined, fallback: boolean) => {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new OktaApiError("E0000001", "Api validation failed", 400);
};

export const createOktaDirectoryApi = ({
  engine,
  requestId = () => crypto.randomUUID(),
}: CreateOktaDirectoryApiOptions) => {
  const app = new Hono();

  const errorResponse = (_request: Request, error: unknown) => {
    const id = requestId();
    const apiError =
      error instanceof OktaApiError
        ? error
        : new OktaApiError(
            "E0000009",
            "The mock directory could not complete the request.",
            500
          );
    return Response.json(
      {
        errorCode: apiError.errorCode,
        errorSummary: apiError.message,
        errorLink: apiError.errorCode,
        errorId: id,
        errorCauses: apiError.causes.map((errorSummary) => ({ errorSummary })),
      },
      {
        status: apiError.status,
        headers: {
          "cache-control": "no-store",
          "x-okta-request-id": id,
          ...(apiError.status === 401 ? { "www-authenticate": "SSWS" } : {}),
          ...(apiError.status === 429
            ? {
                "x-rate-limit-limit": "60",
                "x-rate-limit-remaining": "0",
                "x-rate-limit-reset": String(Math.floor(Date.now() / 1_000) + 60),
              }
            : {}),
        },
      }
    );
  };

  app.onError((error, context) => errorResponse(context.req.raw, error));
  app.use("/api/v1/*", async (context, next) => {
    assertValidRequestPath(context.req.raw);
    if (!authenticated(context.req.raw)) {
      throw new OktaApiError("E0000004", "Authentication failed", 401);
    }
    await next();
  });

  app.get("/api/v1/users", (context) => {
    const rows = filteredUsers(engine.listUsers(), context.req.query("filter"));
    const result = page(
      rows,
      context.req.raw,
      context.req.query("limit"),
      context.req.query("after")
    );
    if (result.next) context.header("link", `<${result.next}>; rel="next"`);
    return context.json(result.values.map((user) => oktaUser(user, context.req.raw)));
  });

  app.post("/api/v1/users", async (context) => {
    const input = userWrite(
      await boundedJson(context.req.raw),
      booleanQuery(context.req.query("activate"), true)
    );
    const user = await engine.createUser(input);
    return context.json(oktaUser(user, context.req.raw), 200);
  });

  app.get("/api/v1/users/:id", (context) => {
    const id = routeIdentifier(context.req.param("id"));
    const user = engine.getUser(id);
    if (!user) {
      throw new OktaApiError(
        "E0000007",
        `Not found: Resource not found: ${id} (User)`,
        404
      );
    }
    return context.json(oktaUser(user, context.req.raw));
  });

  app.post("/api/v1/users/:id", async (context) => {
    const input = userUpdate(await boundedJson(context.req.raw));
    const user = await engine.updateUser(
      routeIdentifier(context.req.param("id")),
      input
    );
    return context.json(oktaUser(user, context.req.raw));
  });

  const lifecycle = (route: string, action: LifecycleAction, includeBody: boolean) =>
    app.post(route, async (context) => {
      const user = await engine.lifecycleUser(
        routeIdentifier(requiredString(context.req.param("id"), "id")),
        action
      );
      return includeBody
        ? context.json(oktaUser(user, context.req.raw))
        : context.body(null, 200);
    });

  lifecycle("/api/v1/users/:id/lifecycle/activate", "activate", true);
  lifecycle("/api/v1/users/:id/lifecycle/reactivate", "reactivate", true);
  lifecycle("/api/v1/users/:id/lifecycle/suspend", "suspend", false);
  lifecycle("/api/v1/users/:id/lifecycle/unsuspend", "unsuspend", false);
  lifecycle("/api/v1/users/:id/lifecycle/deactivate", "deprovision", false);

  app.delete("/api/v1/users/:id", async (context) => {
    await engine.deleteUser(routeIdentifier(context.req.param("id")));
    return context.body(null, 204);
  });

  app.get("/api/v1/groups", (context) => {
    const result = page(
      engine.listGroups(),
      context.req.raw,
      context.req.query("limit"),
      context.req.query("after")
    );
    if (result.next) context.header("link", `<${result.next}>; rel="next"`);
    return context.json(
      result.values.map((group) => oktaGroup(group, context.req.raw))
    );
  });

  app.post("/api/v1/groups", async (context) => {
    const rawBody = await boundedJson(context.req.raw);
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const profile = body.profile;
    const name =
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? Reflect.get(profile, "name")
        : undefined;
    const group = engine.createGroup(requiredString(name, "profile.name"));
    return context.json(oktaGroup(group, context.req.raw), 200);
  });

  app.get("/api/v1/groups/:id", (context) => {
    const id = routeIdentifier(context.req.param("id"));
    const group = engine.getGroup(id);
    if (!group) {
      throw new OktaApiError(
        "E0000007",
        `Not found: Resource not found: ${id} (UserGroup)`,
        404
      );
    }
    return context.json(oktaGroup(group, context.req.raw));
  });

  app.put("/api/v1/groups/:id", async (context) => {
    const rawBody = await boundedJson(context.req.raw);
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const profile = body.profile;
    const name =
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? Reflect.get(profile, "name")
        : undefined;
    return context.json(
      oktaGroup(
        engine.updateGroup(
          routeIdentifier(context.req.param("id")),
          requiredString(name, "profile.name")
        ),
        context.req.raw
      )
    );
  });

  app.delete("/api/v1/groups/:id", (context) => {
    engine.deleteGroup(routeIdentifier(context.req.param("id")));
    return context.body(null, 204);
  });

  app.get("/api/v1/groups/:id/users", (context) => {
    const id = routeIdentifier(context.req.param("id"));
    if (!engine.getGroup(id)) {
      throw new OktaApiError(
        "E0000007",
        `Not found: Resource not found: ${id} (UserGroup)`,
        404
      );
    }
    return context.json(
      engine.listGroupMembers(id).map((user) => oktaUser(user, context.req.raw))
    );
  });

  app.put("/api/v1/groups/:groupId/users/:userId", (context) => {
    engine.addGroupMember(
      routeIdentifier(context.req.param("groupId"), "groupId"),
      routeIdentifier(context.req.param("userId"), "userId")
    );
    return context.body(null, 204);
  });

  app.delete("/api/v1/groups/:groupId/users/:userId", (context) => {
    const groupId = routeIdentifier(context.req.param("groupId"), "groupId");
    const userId = routeIdentifier(context.req.param("userId"), "userId");
    if (!engine.getGroup(groupId) || !engine.getUser(userId)) {
      throw new OktaApiError("E0000007", "Not found: Resource not found", 404);
    }
    engine.removeGroupMember(groupId, userId);
    return context.body(null, 204);
  });

  const disallow = (route: string, allow: string) =>
    app.all(route, (context) => {
      const response = errorResponse(
        context.req.raw,
        new OktaApiError(
          "E0000022",
          "The endpoint does not support the provided HTTP method.",
          405
        )
      );
      response.headers.set("allow", allow);
      return response;
    });
  disallow("/api/v1/users", "GET, POST");
  disallow("/api/v1/users/:id", "GET, POST, DELETE");
  for (const action of [
    "activate",
    "reactivate",
    "suspend",
    "unsuspend",
    "deactivate",
  ]) {
    disallow(`/api/v1/users/:id/lifecycle/${action}`, "POST");
  }
  disallow("/api/v1/groups", "GET, POST");
  disallow("/api/v1/groups/:id", "GET, PUT, DELETE");
  disallow("/api/v1/groups/:id/users", "GET");
  disallow("/api/v1/groups/:groupId/users/:userId", "PUT, DELETE");

  app.notFound((context) =>
    errorResponse(
      context.req.raw,
      new OktaApiError("E0000008", "The requested path was not found", 404)
    )
  );

  return app;
};
