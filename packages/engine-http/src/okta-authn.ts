import { OktaAuthnError, type OktaAuthnResult, type UserRecord } from "@mockos/core";
import { Hono } from "hono";

const MAX_AUTHN_BODY_BYTES = 64 * 1_024;
const MAX_AUTHN_USERNAME_BYTES = 320;
const MAX_AUTHN_PASSWORD_BYTES = 4 * 1_024;
const MAX_AUTHN_TOKEN_BYTES = 512;
const textEncoder = new TextEncoder();

const noStoreHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

export type OktaAuthnEngine = {
  authenticate(input: {
    readonly password: string;
    readonly userName: string;
  }): Promise<OktaAuthnResult> | OktaAuthnResult;
  cancel(stateToken: string): Promise<void> | void;
  getTransaction(stateToken: string): Promise<OktaAuthnResult> | OktaAuthnResult;
};

export type CreateOktaAuthnApiOptions = {
  readonly engine: OktaAuthnEngine;
  readonly requestId?: () => string;
};

class OktaAuthnHttpError extends Error {
  readonly errorCode: string;
  readonly status: number;

  constructor(errorCode: string, message: string, status: number) {
    super(message);
    this.name = "OktaAuthnHttpError";
    this.errorCode = errorCode;
    this.status = status;
  }
}

const errorDetails = (error: unknown) => {
  if (error instanceof OktaAuthnHttpError) return error;
  if (error instanceof OktaAuthnError) {
    return error.code === "INVALID_CREDENTIALS"
      ? new OktaAuthnHttpError("E0000004", "Authentication failed", 401)
      : new OktaAuthnHttpError("E0000011", "Invalid token provided", 401);
  }
  return new OktaAuthnHttpError(
    "E0000009",
    "The mock authentication service could not complete the request.",
    500
  );
};

const errorResponse = (error: unknown, requestId: () => string): Response => {
  const details = errorDetails(error);
  const id = requestId();
  return Response.json(
    {
      errorCode: details.errorCode,
      errorSummary: details.message,
      errorLink: details.errorCode,
      errorId: id,
      errorCauses: [],
    },
    {
      status: details.status,
      headers: {
        ...noStoreHeaders,
        "x-okta-request-id": id,
      },
    }
  );
};

const boundedJsonObject = async (
  request: Request
): Promise<Record<string, unknown>> => {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new OktaAuthnHttpError(
      "E0000003",
      "The request body was not well-formed.",
      400
    );
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new OktaAuthnHttpError(
        "E0000003",
        "The request body was not well-formed.",
        400
      );
    }
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > MAX_AUTHN_BODY_BYTES) {
      throw new OktaAuthnHttpError("E0000001", "Api validation failed", 413);
    }
  }
  if (!request.body) {
    throw new OktaAuthnHttpError(
      "E0000003",
      "The request body was not well-formed.",
      400
    );
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_AUTHN_BODY_BYTES) {
        await reader.cancel();
        throw new OktaAuthnHttpError("E0000001", "Api validation failed", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OktaAuthnHttpError) throw error;
    throw new OktaAuthnHttpError(
      "E0000003",
      "The request body was not well-formed.",
      400
    );
  } finally {
    reader.releaseLock();
  }
};

const boundedString = (
  value: unknown,
  name: "password" | "stateToken" | "username"
): string => {
  const candidate =
    typeof value === "string" && name === "username" ? value.trim() : value;
  const maximum =
    name === "username"
      ? MAX_AUTHN_USERNAME_BYTES
      : name === "password"
        ? MAX_AUTHN_PASSWORD_BYTES
        : MAX_AUTHN_TOKEN_BYTES;
  if (
    typeof candidate !== "string" ||
    !candidate ||
    textEncoder.encode(candidate).byteLength > maximum
  ) {
    throw new OktaAuthnHttpError("E0000001", "Api validation failed", 400);
  }
  return candidate;
};

const stateTokenFrom = (body: Record<string, unknown>): string => {
  const token = boundedString(body.stateToken, "stateToken");
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new OktaAuthnHttpError("E0000001", "Api validation failed", 400);
  }
  return token;
};

const primaryInputFrom = (body: Record<string, unknown>) => {
  if (body.stateToken !== undefined) {
    throw new OktaAuthnHttpError("E0000001", "Api validation failed", 400);
  }
  return {
    userName: boundedString(body.username, "username"),
    password: boundedString(body.password, "password"),
  };
};

const publicAuthnBase = (request: Request): string => {
  const requestUrl = new URL(request.url);
  const routedPath = request.headers.get("x-mockos-public-path");
  if (routedPath !== null) {
    if (!routedPath.startsWith("/") || routedPath.startsWith("//")) {
      throw new OktaAuthnHttpError(
        "E0000003",
        "The routed Okta public path is malformed.",
        400
      );
    }
    const parsed = new URL(routedPath, requestUrl.origin);
    const marker = "/api/v1/authn";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (
      parsed.origin !== requestUrl.origin ||
      parsed.search ||
      parsed.hash ||
      markerIndex < 0
    ) {
      throw new OktaAuthnHttpError(
        "E0000003",
        "The routed Okta public path is malformed.",
        400
      );
    }
    requestUrl.pathname = parsed.pathname.slice(0, markerIndex + marker.length);
  } else {
    requestUrl.pathname = "/api/v1/authn";
  }
  requestUrl.search = "";
  requestUrl.hash = "";
  return requestUrl.toString().replace(/\/$/, "");
};

const postLink = (href: string, name?: string) => ({
  ...(name ? { name } : {}),
  href,
  hints: { allow: ["POST"] },
});

const embeddedUser = (user: UserRecord) => ({
  id: user.id,
  passwordChanged: user.updatedAt,
  profile: {
    login: user.userName,
    firstName: user.givenName ?? null,
    lastName: user.familyName ?? null,
    locale: "en_US",
    timeZone: "America/Los_Angeles",
  },
});

const renderResult = (result: OktaAuthnResult, request: Request) => {
  const base = publicAuthnBase(request);
  if (result.status === "LOCKED_OUT") {
    return {
      status: result.status,
      _links: {
        next: postLink(`${base}/recovery/unlock`, "unlock"),
      },
    };
  }
  if (result.status === "SUCCESS") {
    return {
      expiresAt: result.expiresAt,
      status: result.status,
      sessionToken: result.sessionToken,
      _embedded: { user: embeddedUser(result.user) },
    };
  }
  if (result.status === "MFA_REQUIRED") {
    const factorId = `mfa_${result.user.id}`;
    return {
      stateToken: result.stateToken,
      expiresAt: result.expiresAt,
      status: result.status,
      _embedded: {
        user: embeddedUser(result.user),
        factors: [
          {
            id: factorId,
            factorType: "token:software:totp",
            provider: "OKTA",
            vendorName: "OKTA",
            profile: {},
            _links: {
              verify: postLink(
                `${base}/factors/${encodeURIComponent(factorId)}/verify`
              ),
            },
          },
        ],
      },
      _links: {
        cancel: postLink(`${base}/cancel`),
      },
    };
  }
  return {
    stateToken: result.stateToken,
    expiresAt: result.expiresAt,
    status: result.status,
    _embedded: {
      user: embeddedUser(result.user),
      policy: {
        complexity: {
          minLength: 8,
          minLowerCase: 1,
          minUpperCase: 1,
          minNumber: 1,
          minSymbol: 0,
        },
      },
    },
    _links: {
      next: postLink(`${base}/credentials/change_password`, "changePassword"),
      cancel: postLink(`${base}/cancel`),
    },
  };
};

export const createOktaAuthnApi = ({
  engine,
  requestId = () => crypto.randomUUID(),
}: CreateOktaAuthnApiOptions) => {
  const app = new Hono();

  app.onError((error) => errorResponse(error, requestId));

  app.post("/api/v1/authn", async (context) => {
    const body = await boundedJsonObject(context.req.raw);
    const result =
      body.stateToken === undefined
        ? await engine.authenticate(primaryInputFrom(body))
        : body.username !== undefined || body.password !== undefined
          ? (() => {
              throw new OktaAuthnHttpError("E0000001", "Api validation failed", 400);
            })()
          : await engine.getTransaction(stateTokenFrom(body));
    return context.json(renderResult(result, context.req.raw), 200, noStoreHeaders);
  });

  app.post("/api/v1/authn/cancel", async (context) => {
    const body = await boundedJsonObject(context.req.raw);
    if (body.username !== undefined || body.password !== undefined) {
      throw new OktaAuthnHttpError("E0000001", "Api validation failed", 400);
    }
    await engine.cancel(stateTokenFrom(body));
    return context.body(null, 200, noStoreHeaders);
  });

  const methodNotAllowed = (allow: string) => () => {
    const response = errorResponse(
      new OktaAuthnHttpError(
        "E0000022",
        "The endpoint does not support the provided HTTP method.",
        405
      ),
      requestId
    );
    response.headers.set("allow", allow);
    return response;
  };
  app.all("/api/v1/authn", methodNotAllowed("POST"));
  app.all("/api/v1/authn/cancel", methodNotAllowed("POST"));

  app.notFound(() =>
    errorResponse(
      new OktaAuthnHttpError("E0000008", "The requested path was not found", 404),
      requestId
    )
  );

  return app;
};
