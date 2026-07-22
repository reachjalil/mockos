import {
  SCIM_ERROR_SCHEMA,
  type ScimGroupInput,
  type ScimGroupResource,
  type ScimListResponse,
  type ScimPatchRequest,
  type ScimQuery,
  type ScimType,
  type ScimUserInput,
  type ScimUserResource,
  scimGroupInputSchema,
  scimPatchRequestSchema,
  scimQuerySchema,
  scimUserInputSchema,
} from "@mockos/contracts";
import { Hono } from "hono";

const MAX_SCIM_BODY_BYTES = 1024 * 1024;
const MAX_SCIM_RESOURCE_ID_BYTES = 128;

export type ScimResourceResult<T> = {
  resource: T;
  etag: string;
  location: string;
};

export type ScimHttpEngine = {
  normalizePatchRequest?(value: unknown): unknown;
  serviceProviderConfig(baseUrl: string): Record<string, unknown>;
  resourceTypes(baseUrl: string): ScimListResponse;
  schemas(baseUrl: string): ScimListResponse;
  schema(id: string, baseUrl: string): Record<string, unknown> | undefined;
  listUsers(query: ScimQuery, baseUrl: string): ScimListResponse;
  getUser(
    id: string,
    baseUrl: string
  ): ScimResourceResult<ScimUserResource> | undefined;
  createUser(
    input: ScimUserInput,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimUserResource>>;
  replaceUser(
    id: string,
    input: ScimUserInput,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimUserResource>>;
  patchUser(
    id: string,
    patch: ScimPatchRequest,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimUserResource>>;
  deleteUser(id: string, ifMatch: string | undefined): Promise<void>;
  listGroups(query: ScimQuery, baseUrl: string): ScimListResponse;
  getGroup(
    id: string,
    baseUrl: string
  ): ScimResourceResult<ScimGroupResource> | undefined;
  createGroup(
    input: ScimGroupInput,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimGroupResource>>;
  replaceGroup(
    id: string,
    input: ScimGroupInput,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimGroupResource>>;
  patchGroup(
    id: string,
    patch: ScimPatchRequest,
    ifMatch: string | undefined,
    baseUrl: string
  ): Promise<ScimResourceResult<ScimGroupResource>>;
  deleteGroup(id: string, ifMatch: string | undefined): Promise<void>;
  readonly groupPatchSuccessStatus: 200 | 204;
};

export class ScimHttpError extends Error {
  readonly status: number;
  readonly scimType?: ScimType;

  constructor(
    status: number,
    detail: string,
    scimType?: ScimType,
    options?: ErrorOptions
  ) {
    super(detail, options);
    this.name = "ScimHttpError";
    this.status = status;
    this.scimType = scimType;
  }
}

const authenticated = (request: Request) => {
  const value = request.headers.get("authorization");
  return Boolean(value && /^Bearer[\t ]+\S(?:.*\S)?$/i.test(value));
};

const assertValidRequestPath = (request: Request): void => {
  try {
    decodeURIComponent(new URL(request.url).pathname);
  } catch {
    throw new ScimHttpError(400, "The request URI is malformed.", "invalidPath");
  }
};

const routeIdentifier = (value: string, maximum = MAX_SCIM_RESOURCE_ID_BYTES) => {
  if (!value || new TextEncoder().encode(value).byteLength > maximum) {
    throw new ScimHttpError(
      400,
      "The SCIM resource identifier is invalid.",
      "invalidValue"
    );
  }
  return value;
};

const publicBaseUrl = (request: Request) => {
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
        throw new Error("Public path must not change origin or contain a query.");
      }
      url.pathname = parsed.pathname;
    } catch (error) {
      throw new ScimHttpError(
        400,
        "The routed SCIM public path is malformed.",
        undefined,
        {
          cause: error,
        }
      );
    }
  }
  const marker = "/scim/v2";
  const index = url.pathname.indexOf(marker);
  if (index < 0) {
    throw new ScimHttpError(400, "The SCIM base URL could not be derived.");
  }
  url.pathname = url.pathname.slice(0, index + marker.length);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const contentTypeAccepted = (request: Request) => {
  const value = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return value === "application/scim+json" || value === "application/json";
};

const boundedText = async (request: Request): Promise<string> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new ScimHttpError(
        400,
        "Content-Length must be a non-negative integer.",
        "invalidSyntax"
      );
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > MAX_SCIM_BODY_BYTES) {
      throw new ScimHttpError(413, "The SCIM request body exceeds one MiB.", "tooMany");
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SCIM_BODY_BYTES) {
        await reader.cancel();
        throw new ScimHttpError(
          413,
          "The SCIM request body exceeds one MiB.",
          "tooMany"
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch (error) {
    if (error instanceof ScimHttpError) throw error;
    throw new ScimHttpError(
      400,
      "The SCIM request body is not valid UTF-8.",
      "invalidSyntax"
    );
  } finally {
    reader.releaseLock();
  }
};

const boundedJson = async (request: Request): Promise<unknown> => {
  if (!contentTypeAccepted(request)) {
    throw new ScimHttpError(
      415,
      "Content-Type must be application/scim+json or application/json."
    );
  }
  const body = await boundedText(request);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ScimHttpError(
      400,
      "The SCIM request body is not valid JSON.",
      "invalidSyntax"
    );
  }
};

const normalizePatch = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const canonicalize = (
    input: Record<string, unknown>,
    expected: string
  ): Record<string, unknown> => {
    const matches = Object.keys(input).filter(
      (key) => key.toLowerCase() === expected.toLowerCase()
    );
    if (matches.length !== 1) return { ...input };
    const source = matches[0];
    if (!source || source === expected) return { ...input };
    const result = { ...input };
    delete result[source];
    result[expected] = input[source];
    return result;
  };
  let record = canonicalize(value as Record<string, unknown>, "schemas");
  record = canonicalize(record, "Operations");
  const operations = record.Operations;
  if (!Array.isArray(operations)) return value;
  return {
    ...record,
    Operations: operations.map((operation) => {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        return operation;
      }
      let operationRecord = canonicalize(operation as Record<string, unknown>, "op");
      operationRecord = canonicalize(operationRecord, "path");
      operationRecord = canonicalize(operationRecord, "value");
      const op = operationRecord.op;
      return {
        ...operationRecord,
        ...(typeof op === "string" ? { op: op.toLowerCase() } : {}),
      };
    }),
  };
};

const patchBody = async (
  request: Request,
  engine: ScimHttpEngine
): Promise<ScimPatchRequest> => {
  const raw = await boundedJson(request);
  const tolerated = engine.normalizePatchRequest?.(raw) ?? raw;
  const normalized = normalizePatch(tolerated);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const operations = Reflect.get(normalized, "Operations");
    if (Array.isArray(operations) && operations.length > 100) {
      throw new ScimHttpError(
        400,
        "PatchOp Operations exceeds the supported 100-operation limit.",
        "tooMany"
      );
    }
  }
  try {
    return scimPatchRequestSchema.parse(normalized);
  } catch {
    throw new ScimHttpError(
      400,
      "The SCIM PatchOp request does not match the supported schema.",
      "invalidValue"
    );
  }
};

const parsedBody = async <T>(
  request: Request,
  parse: (value: unknown) => T
): Promise<T> => {
  try {
    return parse(await boundedJson(request));
  } catch (error) {
    if (error instanceof ScimHttpError) throw error;
    throw new ScimHttpError(
      400,
      "The SCIM request body does not match the supported schema.",
      "invalidValue"
    );
  }
};

const integerQuery = (raw: string | undefined, name: string, fallback: number) => {
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ScimHttpError(400, `${name} must be an integer.`, "invalidValue");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ScimHttpError(400, `${name} is outside the supported range.`, "tooMany");
  }
  return value;
};

const queryFrom = (request: Request): ScimQuery => {
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  if (filter !== null && new TextEncoder().encode(filter).byteLength > 8_192) {
    throw new ScimHttpError(
      400,
      "The SCIM filter exceeds the supported 8192-byte limit.",
      "invalidFilter"
    );
  }
  try {
    return scimQuerySchema.parse({
      ...(filter === null ? {} : { filter }),
      startIndex: integerQuery(
        url.searchParams.get("startIndex") ?? undefined,
        "startIndex",
        1
      ),
      count: integerQuery(url.searchParams.get("count") ?? undefined, "count", 100),
      ...(url.searchParams.has("attributes")
        ? { attributes: url.searchParams.get("attributes") }
        : {}),
      ...(url.searchParams.has("excludedAttributes")
        ? { excludedAttributes: url.searchParams.get("excludedAttributes") }
        : {}),
    });
  } catch (error) {
    if (error instanceof ScimHttpError) throw error;
    throw new ScimHttpError(
      400,
      "The SCIM query parameters are invalid or exceed supported limits.",
      "invalidValue"
    );
  }
};

const responseHeaders = (etag?: string, location?: string) => ({
  "cache-control": "no-store",
  "content-type": "application/scim+json; charset=utf-8",
  ...(etag ? { etag } : {}),
  ...(location ? { location } : {}),
});

const entityTagMatches = (header: string | undefined, etag: string): boolean => {
  if (!header) return false;
  const weakValue = (candidate: string) =>
    candidate.startsWith("W/") ? candidate.slice(2) : candidate;
  const current = weakValue(etag);
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || weakValue(candidate) === current);
};

const jsonResponse = (value: unknown, status = 200, etag?: string, location?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders(etag, location),
  });

const coreError = (error: unknown): ScimHttpError => {
  if (error instanceof ScimHttpError) return error;
  if (error && typeof error === "object") {
    const status = Reflect.get(error, "status");
    const scimType = Reflect.get(error, "scimType");
    const detail = Reflect.get(error, "message");
    if (
      typeof status === "number" &&
      status >= 400 &&
      status <= 599 &&
      typeof detail === "string"
    ) {
      return new ScimHttpError(
        status,
        detail,
        typeof scimType === "string" ? (scimType as ScimType) : undefined
      );
    }
  }
  return new ScimHttpError(
    500,
    "The mock SCIM service could not complete the request."
  );
};

export const createScimHttpApp = (engine: ScimHttpEngine) => {
  const app = new Hono();

  const errorResponse = (error: unknown) => {
    const resolved = coreError(error);
    return jsonResponse(
      {
        schemas: [SCIM_ERROR_SCHEMA],
        status: String(resolved.status),
        ...(resolved.scimType ? { scimType: resolved.scimType } : {}),
        detail: resolved.message,
      },
      resolved.status
    );
  };

  app.onError((error) => errorResponse(error));
  app.use("/scim/v2/*", async (context, next) => {
    assertValidRequestPath(context.req.raw);
    if (!authenticated(context.req.raw)) {
      return new Response(
        JSON.stringify({
          schemas: [SCIM_ERROR_SCHEMA],
          status: "401",
          detail: "A non-empty mock SCIM Bearer credential is required.",
        }),
        {
          status: 401,
          headers: {
            ...responseHeaders(),
            "www-authenticate": 'Bearer realm="mockos-scim"',
          },
        }
      );
    }
    await next();
  });

  app.get("/scim/v2/ServiceProviderConfig", (context) =>
    jsonResponse(engine.serviceProviderConfig(publicBaseUrl(context.req.raw)))
  );
  app.get("/scim/v2/ResourceTypes", (context) =>
    jsonResponse(engine.resourceTypes(publicBaseUrl(context.req.raw)))
  );
  app.get("/scim/v2/ResourceTypes/:id", (context) => {
    const id = routeIdentifier(context.req.param("id"));
    const registry = engine.resourceTypes(publicBaseUrl(context.req.raw));
    const resource = registry.Resources.find(
      (candidate) => Reflect.get(candidate, "id") === id
    );
    if (!resource) {
      throw new ScimHttpError(404, "The requested SCIM resource type was not found.");
    }
    return jsonResponse(resource);
  });
  app.get("/scim/v2/Schemas", (context) =>
    jsonResponse(engine.schemas(publicBaseUrl(context.req.raw)))
  );
  app.get("/scim/v2/Schemas/:id", (context) => {
    const schema = engine.schema(
      routeIdentifier(context.req.param("id"), 2_048),
      publicBaseUrl(context.req.raw)
    );
    if (!schema) {
      throw new ScimHttpError(404, "The requested SCIM schema was not found.");
    }
    return jsonResponse(schema);
  });

  app.get("/scim/v2/Users", (context) =>
    jsonResponse(
      engine.listUsers(queryFrom(context.req.raw), publicBaseUrl(context.req.raw))
    )
  );
  app.post("/scim/v2/Users", async (context) => {
    const input = await parsedBody(context.req.raw, (value) =>
      scimUserInputSchema.parse(value)
    );
    const result = await engine.createUser(input, publicBaseUrl(context.req.raw));
    return jsonResponse(result.resource, 201, result.etag, result.location);
  });
  app.get("/scim/v2/Users/:id", (context) => {
    const result = engine.getUser(
      routeIdentifier(context.req.param("id")),
      publicBaseUrl(context.req.raw)
    );
    if (!result) throw new ScimHttpError(404, "The requested User was not found.");
    if (entityTagMatches(context.req.header("if-none-match"), result.etag)) {
      return new Response(null, {
        status: 304,
        headers: { "cache-control": "no-store", etag: result.etag },
      });
    }
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.put("/scim/v2/Users/:id", async (context) => {
    const input = await parsedBody(context.req.raw, (value) =>
      scimUserInputSchema.parse(value)
    );
    const result = await engine.replaceUser(
      routeIdentifier(context.req.param("id")),
      input,
      context.req.header("if-match"),
      publicBaseUrl(context.req.raw)
    );
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.patch("/scim/v2/Users/:id", async (context) => {
    const patch = await patchBody(context.req.raw, engine);
    const result = await engine.patchUser(
      routeIdentifier(context.req.param("id")),
      patch,
      context.req.header("if-match"),
      publicBaseUrl(context.req.raw)
    );
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.delete("/scim/v2/Users/:id", async (context) => {
    await engine.deleteUser(
      routeIdentifier(context.req.param("id")),
      context.req.header("if-match")
    );
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  });

  app.get("/scim/v2/Groups", (context) =>
    jsonResponse(
      engine.listGroups(queryFrom(context.req.raw), publicBaseUrl(context.req.raw))
    )
  );
  app.post("/scim/v2/Groups", async (context) => {
    const input = await parsedBody(context.req.raw, (value) =>
      scimGroupInputSchema.parse(value)
    );
    const result = await engine.createGroup(input, publicBaseUrl(context.req.raw));
    return jsonResponse(result.resource, 201, result.etag, result.location);
  });
  app.get("/scim/v2/Groups/:id", (context) => {
    const result = engine.getGroup(
      routeIdentifier(context.req.param("id")),
      publicBaseUrl(context.req.raw)
    );
    if (!result) throw new ScimHttpError(404, "The requested Group was not found.");
    if (entityTagMatches(context.req.header("if-none-match"), result.etag)) {
      return new Response(null, {
        status: 304,
        headers: { "cache-control": "no-store", etag: result.etag },
      });
    }
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.put("/scim/v2/Groups/:id", async (context) => {
    const input = await parsedBody(context.req.raw, (value) =>
      scimGroupInputSchema.parse(value)
    );
    const result = await engine.replaceGroup(
      routeIdentifier(context.req.param("id")),
      input,
      context.req.header("if-match"),
      publicBaseUrl(context.req.raw)
    );
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.patch("/scim/v2/Groups/:id", async (context) => {
    const patch = await patchBody(context.req.raw, engine);
    const result = await engine.patchGroup(
      routeIdentifier(context.req.param("id")),
      patch,
      context.req.header("if-match"),
      publicBaseUrl(context.req.raw)
    );
    if (
      engine.groupPatchSuccessStatus === 204 &&
      context.req.query("attributes") === undefined
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          "cache-control": "no-store",
          etag: result.etag,
          location: result.location,
        },
      });
    }
    return jsonResponse(result.resource, 200, result.etag, result.location);
  });
  app.delete("/scim/v2/Groups/:id", async (context) => {
    await engine.deleteGroup(
      routeIdentifier(context.req.param("id")),
      context.req.header("if-match")
    );
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  });

  const disallow = (route: string, allow: string) =>
    app.all(route, () => {
      const response = errorResponse(
        new ScimHttpError(405, "The requested HTTP method is not supported.")
      );
      response.headers.set("allow", allow);
      return response;
    });
  for (const route of [
    "/scim/v2/ServiceProviderConfig",
    "/scim/v2/ResourceTypes",
    "/scim/v2/ResourceTypes/:id",
    "/scim/v2/Schemas",
    "/scim/v2/Schemas/:id",
  ]) {
    disallow(route, "GET");
  }
  disallow("/scim/v2/Users", "GET, POST");
  disallow("/scim/v2/Users/:id", "GET, PUT, PATCH, DELETE");
  disallow("/scim/v2/Groups", "GET, POST");
  disallow("/scim/v2/Groups/:id", "GET, PUT, PATCH, DELETE");

  app.notFound(() =>
    errorResponse(new ScimHttpError(404, "The requested SCIM endpoint was not found."))
  );

  return app;
};
