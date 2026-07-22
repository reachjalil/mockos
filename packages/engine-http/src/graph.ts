import { Hono } from "hono";

const MAX_GRAPH_QUERY_BYTES = 2_048;
const MAX_GRAPH_IDENTIFIER_BYTES = 512;
const textEncoder = new TextEncoder();

export type GraphDirectoryUser = {
  id: string;
  userName: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  accountEnabled: boolean;
  createdAt: string;
};

export type GraphDirectoryGroup = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type GraphDirectoryEngine = {
  listUsers(): readonly GraphDirectoryUser[];
  getUser(id: string): GraphDirectoryUser | undefined;
  listGroups(): readonly GraphDirectoryGroup[];
  getGroup(id: string): GraphDirectoryGroup | undefined;
  listGroupMembers(groupId: string): readonly GraphDirectoryUser[];
  listUserGroups(userId: string): readonly GraphDirectoryGroup[];
};

export type CreateGraphHttpAppOptions = {
  engine: GraphDirectoryEngine;
  now?: () => Date;
  requestId?: () => string;
};

class GraphProtocolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "GraphProtocolError";
    this.code = code;
    this.status = status;
  }
}

const authenticated = (request: Request): boolean => {
  const value = request.headers.get("authorization");
  return Boolean(value && /^Bearer[\t ]+\S(?:.*\S)?$/i.test(value));
};

const assertValidRequestPath = (request: Request): void => {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    throw new GraphProtocolError("BadRequest", "The request URI is malformed.");
  }
};

const routeIdentifier = (value: string): string => {
  if (!value || textEncoder.encode(value).byteLength > MAX_GRAPH_IDENTIFIER_BYTES) {
    throw new GraphProtocolError("BadRequest", "The directory identifier is invalid.");
  }
  return value;
};

const publicUrl = (request: Request): URL => {
  const url = new URL(request.url);
  const path = request.headers.get("x-mockos-public-path");
  if (path !== null) {
    try {
      if (!path.startsWith("/") || path.startsWith("//")) {
        throw new Error("Public path must be origin-relative.");
      }
      const parsed = new URL(path, url.origin);
      decodeURIComponent(parsed.pathname);
      if (parsed.origin !== url.origin || parsed.search || parsed.hash) {
        throw new Error("Public path must not contain a query or fragment.");
      }
      url.pathname = parsed.pathname;
    } catch {
      throw new GraphProtocolError(
        "BadRequest",
        "The routed Microsoft Graph public path is malformed."
      );
    }
  }
  return url;
};

const selectedFields = (
  value: string | undefined,
  supported: ReadonlySet<string>
): Set<string> | undefined => {
  if (!value) return undefined;
  if (textEncoder.encode(value).byteLength > MAX_GRAPH_QUERY_BYTES) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      "The $select query exceeds the supported length."
    );
  }
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0 || fields.length > 50) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      "The $select query is empty or exceeds the supported field limit."
    );
  }
  const unsupported = fields.find((field) => !supported.has(field));
  if (unsupported) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      `The property '${unsupported}' is not available in this mock.`
    );
  }
  return new Set(fields);
};

const assertSupportedQuery = (
  request: Request,
  supported: ReadonlySet<string>
): void => {
  for (const key of new URL(request.url).searchParams.keys()) {
    if (key.startsWith("$") && !supported.has(key)) {
      throw new GraphProtocolError(
        "Request_UnsupportedQuery",
        `The query parameter '${key}' is not supported.`
      );
    }
  }
};

const project = <T extends Record<string, unknown>>(
  value: T,
  selection: Set<string> | undefined
): Partial<T> => {
  if (!selection) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => selection.has(name))
  ) as Partial<T>;
};

const graphUser = (user: GraphDirectoryUser): Record<string, unknown> => ({
  "@odata.type": "#microsoft.graph.user",
  id: user.id,
  accountEnabled: user.accountEnabled,
  displayName: user.displayName,
  givenName: user.givenName ?? null,
  surname: user.familyName ?? null,
  mail: user.userName,
  userPrincipalName: user.userName,
  createdDateTime: user.createdAt,
});

const graphGroup = (group: GraphDirectoryGroup): Record<string, unknown> => ({
  "@odata.type": "#microsoft.graph.group",
  id: group.id,
  displayName: group.displayName,
  createdDateTime: group.createdAt,
  mail: null,
  mailEnabled: false,
  securityEnabled: true,
});

const filtered = <T extends Record<string, unknown>>(
  rows: readonly T[],
  expression: string | undefined,
  supported: ReadonlySet<string>
): T[] => {
  if (!expression) return [...rows];
  if (textEncoder.encode(expression).byteLength > MAX_GRAPH_QUERY_BYTES) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      "The $filter query exceeds the supported length."
    );
  }
  const match = expression.match(/^([A-Za-z][A-Za-z0-9]*)\s+eq\s+'((?:[^']|'')*)'$/i);
  const field = match?.[1];
  const supportedLookup = new Map(
    [...supported].map((candidate) => [candidate.toLowerCase(), candidate])
  );
  if (!match || !field || !supportedLookup.has(field.toLowerCase())) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      "Only a single supported-property eq string filter is available in this mock."
    );
  }
  const expected = (match[2] ?? "").replaceAll("''", "'").toLocaleLowerCase();
  const canonical = supportedLookup.get(field.toLowerCase());
  return rows.filter((row) => {
    const value = canonical ? row[canonical] : undefined;
    return typeof value === "string" && value.toLocaleLowerCase() === expected;
  });
};

const graphUserFields = new Set([
  "@odata.type",
  "id",
  "accountEnabled",
  "displayName",
  "givenName",
  "surname",
  "mail",
  "userPrincipalName",
  "createdDateTime",
]);

const graphGroupFields = new Set([
  "@odata.type",
  "id",
  "displayName",
  "createdDateTime",
  "mail",
  "mailEnabled",
  "securityEnabled",
]);

const integerQuery = (
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      `${name} must be an integer.`
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new GraphProtocolError(
      "Request_UnsupportedQuery",
      `${name} is outside the supported range.`
    );
  }
  return value;
};

const page = <T>(
  rows: readonly T[],
  request: Request,
  topRaw: string | undefined,
  skipTokenRaw: string | undefined
) => {
  const top = integerQuery(topRaw, "$top", 100, 1, 999);
  const offset = integerQuery(skipTokenRaw, "$skiptoken", 0, 0, 1_000_000);
  const value = rows.slice(offset, offset + top);
  const nextOffset = offset + value.length;
  if (nextOffset >= rows.length) return { value };
  const next = publicUrl(request);
  next.searchParams.set("$top", String(top));
  next.searchParams.set("$skiptoken", String(nextOffset));
  return { value, "@odata.nextLink": next.toString() };
};

export const createGraphHttpApp = ({
  engine,
  now = () => new Date(),
  requestId = () => crypto.randomUUID(),
}: CreateGraphHttpAppOptions) => {
  const app = new Hono();

  const errorResponse = (request: Request, error: unknown) => {
    const id = requestId();
    const clientRequestId = request.headers.get("client-request-id") ?? id;
    const protocolError =
      error instanceof GraphProtocolError
        ? error
        : new GraphProtocolError(
            "InternalServerError",
            "The mock directory could not complete the request.",
            500
          );
    return Response.json(
      {
        error: {
          code: protocolError.code,
          message: protocolError.message,
          innerError: {
            date: now().toISOString(),
            "request-id": id,
            "client-request-id": clientRequestId,
          },
        },
      },
      {
        status: protocolError.status,
        headers: {
          "cache-control": "no-store",
          "request-id": id,
          "client-request-id": clientRequestId,
          ...(protocolError.status === 401
            ? { "www-authenticate": 'Bearer realm="Microsoft Graph"' }
            : {}),
        },
      }
    );
  };

  app.onError((error, context) => errorResponse(context.req.raw, error));

  app.use("/graph/v1.0/*", async (context, next) => {
    assertValidRequestPath(context.req.raw);
    if (!authenticated(context.req.raw)) {
      throw new GraphProtocolError(
        "InvalidAuthenticationToken",
        "Access token is empty or missing.",
        401
      );
    }
    await next();
  });

  app.get("/graph/v1.0/users", (context) => {
    assertSupportedQuery(
      context.req.raw,
      new Set(["$select", "$filter", "$top", "$skiptoken"])
    );
    const selection = selectedFields(context.req.query("$select"), graphUserFields);
    const rows = filtered(
      engine.listUsers().map(graphUser),
      context.req.query("$filter"),
      new Set(["id", "userPrincipalName", "displayName", "mail"])
    ).map((row) => project(row, selection));
    return context.json({
      "@odata.context": "$metadata#users",
      ...page(
        rows,
        context.req.raw,
        context.req.query("$top"),
        context.req.query("$skiptoken")
      ),
    });
  });

  app.get("/graph/v1.0/users/:id", (context) => {
    assertSupportedQuery(context.req.raw, new Set(["$select"]));
    const id = routeIdentifier(context.req.param("id"));
    const user = engine.getUser(id);
    if (!user) {
      throw new GraphProtocolError(
        "Request_ResourceNotFound",
        `Resource '${id}' does not exist or one of its queried reference-property objects is not present.`,
        404
      );
    }
    return context.json(
      project(
        graphUser(user),
        selectedFields(context.req.query("$select"), graphUserFields)
      )
    );
  });

  app.get("/graph/v1.0/users/:id/memberOf", (context) => {
    assertSupportedQuery(context.req.raw, new Set(["$select", "$top", "$skiptoken"]));
    const id = routeIdentifier(context.req.param("id"));
    if (!engine.getUser(id)) {
      throw new GraphProtocolError(
        "Request_ResourceNotFound",
        `Resource '${id}' was not found.`,
        404
      );
    }
    const selection = selectedFields(context.req.query("$select"), graphGroupFields);
    const rows = engine
      .listUserGroups(id)
      .map(graphGroup)
      .map((row) => project(row, selection));
    return context.json({
      "@odata.context": "$metadata#directoryObjects",
      ...page(
        rows,
        context.req.raw,
        context.req.query("$top"),
        context.req.query("$skiptoken")
      ),
    });
  });

  app.get("/graph/v1.0/groups", (context) => {
    assertSupportedQuery(
      context.req.raw,
      new Set(["$select", "$filter", "$top", "$skiptoken"])
    );
    const selection = selectedFields(context.req.query("$select"), graphGroupFields);
    const rows = filtered(
      engine.listGroups().map(graphGroup),
      context.req.query("$filter"),
      new Set(["id", "displayName"])
    ).map((row) => project(row, selection));
    return context.json({
      "@odata.context": "$metadata#groups",
      ...page(
        rows,
        context.req.raw,
        context.req.query("$top"),
        context.req.query("$skiptoken")
      ),
    });
  });

  app.get("/graph/v1.0/groups/:id", (context) => {
    assertSupportedQuery(context.req.raw, new Set(["$select"]));
    const id = routeIdentifier(context.req.param("id"));
    const group = engine.getGroup(id);
    if (!group) {
      throw new GraphProtocolError(
        "Request_ResourceNotFound",
        `Resource '${id}' was not found.`,
        404
      );
    }
    return context.json(
      project(
        graphGroup(group),
        selectedFields(context.req.query("$select"), graphGroupFields)
      )
    );
  });

  app.get("/graph/v1.0/groups/:id/members", (context) => {
    assertSupportedQuery(context.req.raw, new Set(["$select", "$top", "$skiptoken"]));
    const id = routeIdentifier(context.req.param("id"));
    if (!engine.getGroup(id)) {
      throw new GraphProtocolError(
        "Request_ResourceNotFound",
        `Resource '${id}' was not found.`,
        404
      );
    }
    const selection = selectedFields(context.req.query("$select"), graphUserFields);
    const rows = engine
      .listGroupMembers(id)
      .map(graphUser)
      .map((row) => project(row, selection));
    return context.json({
      "@odata.context": "$metadata#directoryObjects",
      ...page(
        rows,
        context.req.raw,
        context.req.query("$top"),
        context.req.query("$skiptoken")
      ),
    });
  });

  const disallow = (route: string, allow: string) =>
    app.all(route, (context) => {
      const response = errorResponse(
        context.req.raw,
        new GraphProtocolError(
          "Request_BadRequest",
          "The requested HTTP method is not supported.",
          405
        )
      );
      response.headers.set("allow", allow);
      return response;
    });
  disallow("/graph/v1.0/users", "GET");
  disallow("/graph/v1.0/users/:id", "GET");
  disallow("/graph/v1.0/users/:id/memberOf", "GET");
  disallow("/graph/v1.0/groups", "GET");
  disallow("/graph/v1.0/groups/:id", "GET");
  disallow("/graph/v1.0/groups/:id/members", "GET");

  app.notFound((context) =>
    errorResponse(
      context.req.raw,
      new GraphProtocolError(
        "Request_ResourceNotFound",
        "The requested directory resource was not found.",
        404
      )
    )
  );

  return app;
};
