import type { SemanticErrorCode } from "@mockos/contracts";

type ErrorDefinition = {
  aadsts: number;
  description: string;
  oauth: string;
  status: number;
};

const errorDefinitions: Record<SemanticErrorCode, ErrorDefinition> = {
  BAD_CLIENT_SECRET: {
    aadsts: 7000215,
    description: "Invalid client secret is provided.",
    oauth: "invalid_client",
    status: 401,
  },
  BAD_REDIRECT_URI: {
    aadsts: 50011,
    description:
      "The redirect URI specified in the request does not match the application.",
    oauth: "invalid_request",
    status: 400,
  },
  CODE_ALREADY_REDEEMED: {
    aadsts: 70000,
    description: "The authorization code has already been redeemed.",
    oauth: "invalid_grant",
    status: 400,
  },
  INVALID_AUTHORIZATION_CODE: {
    aadsts: 70000,
    description: "The provided authorization code is invalid or has expired.",
    oauth: "invalid_grant",
    status: 400,
  },
  INVALID_GRANT: {
    aadsts: 50126,
    description: "Error validating credentials due to invalid username or password.",
    oauth: "invalid_grant",
    status: 400,
  },
  INVALID_REQUEST: {
    aadsts: 900144,
    description: "The request body must contain the required parameter.",
    oauth: "invalid_request",
    status: 400,
  },
  INVALID_SCOPE: {
    aadsts: 70011,
    description: "The provided request must include a valid scope.",
    oauth: "invalid_scope",
    status: 400,
  },
  LOCKED_OUT: {
    aadsts: 50053,
    description: "The account is locked because of repeated sign-in attempts.",
    oauth: "invalid_grant",
    status: 400,
  },
  MFA_REQUIRED: {
    aadsts: 50076,
    description: "Multi-factor authentication is required.",
    oauth: "interaction_required",
    status: 400,
  },
  PASSWORD_EXPIRED: {
    aadsts: 50055,
    description: "The password is expired.",
    oauth: "invalid_grant",
    status: 400,
  },
  RATE_LIMITED: {
    aadsts: 90055,
    description: "The request was throttled. Try again later.",
    oauth: "temporarily_unavailable",
    status: 429,
  },
  UNSUPPORTED_GRANT: {
    aadsts: 70003,
    description: "The application requested an unsupported grant type.",
    oauth: "unsupported_grant_type",
    status: 400,
  },
  USER_DISABLED: {
    aadsts: 50057,
    description: "The user account is disabled.",
    oauth: "invalid_grant",
    status: 400,
  },
};

export class OAuthProtocolError extends Error {
  readonly semanticCode: SemanticErrorCode;
  readonly oauthError?: string;
  readonly status?: number;

  constructor(
    semanticCode: SemanticErrorCode,
    message?: string,
    options: { oauthError?: string; status?: number; cause?: unknown } = {}
  ) {
    super(message ?? errorDefinitions[semanticCode].description, {
      cause: options.cause,
    });
    this.name = "OAuthProtocolError";
    this.semanticCode = semanticCode;
    this.oauthError = options.oauthError;
    this.status = options.status;
  }
}

const semanticCodes = new Set<SemanticErrorCode>(
  Object.keys(errorDefinitions) as SemanticErrorCode[]
);

const getSemanticCode = (error: unknown): SemanticErrorCode => {
  if (error instanceof OAuthProtocolError) return error.semanticCode;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && semanticCodes.has(code as SemanticErrorCode)) {
      return code as SemanticErrorCode;
    }
  }
  return "INVALID_REQUEST";
};

const getMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};

export type EntraErrorBody = {
  correlation_id: string;
  error: string;
  error_codes: number[];
  error_description: string;
  timestamp: string;
  trace_id: string;
};

export type RenderedEntraError = {
  body: EntraErrorBody;
  semanticCode: SemanticErrorCode;
  status: number;
};

export const renderEntraError = (
  error: unknown,
  options: { now?: Date; correlationId?: string; traceId?: string } = {}
): RenderedEntraError => {
  const semanticCode = getSemanticCode(error);
  const definition = errorDefinitions[semanticCode];
  const now = options.now ?? new Date();
  const timestamp = now.toISOString().replace("T", " ").replace("Z", "Z");
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const traceId = options.traceId ?? crypto.randomUUID();
  const oauthError =
    error instanceof OAuthProtocolError && error.oauthError
      ? error.oauthError
      : definition.oauth;
  const description = getMessage(error, definition.description);
  return {
    semanticCode,
    status:
      error instanceof OAuthProtocolError && error.status
        ? error.status
        : definition.status,
    body: {
      error: oauthError,
      error_description: `AADSTS${definition.aadsts}: ${description} Trace ID: ${traceId} Correlation ID: ${correlationId} Timestamp: ${timestamp}`,
      error_codes: [definition.aadsts],
      timestamp,
      trace_id: traceId,
      correlation_id: correlationId,
    },
  };
};
