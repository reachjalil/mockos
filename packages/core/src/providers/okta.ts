import type { SemanticErrorCode } from "@mockos/contracts";
import type {
  ErrorCatalog,
  OidcDiscoveryDocument,
  ProviderErrorContext,
  ProviderProfile,
  ProviderUrlContext,
  RenderedProviderError,
} from "./types";
import { appendIssuerPath, normalizeIssuerBase } from "./types";

const oktaErrorCode: Record<SemanticErrorCode, string> = {
  BAD_CLIENT_SECRET: "E0000004",
  BAD_REDIRECT_URI: "E0000001",
  CODE_ALREADY_REDEEMED: "E0000011",
  INVALID_AUTHORIZATION_CODE: "E0000011",
  INVALID_GRANT: "E0000011",
  INVALID_REQUEST: "E0000001",
  INVALID_SCOPE: "E0000001",
  LOCKED_OUT: "E0000004",
  MFA_REQUIRED: "E0000068",
  PASSWORD_EXPIRED: "E0000080",
  RATE_LIMITED: "E0000047",
  UNSUPPORTED_GRANT: "E0000001",
  USER_DISABLED: "E0000004",
};

const oktaOAuthError: Record<SemanticErrorCode, string> = {
  BAD_CLIENT_SECRET: "invalid_client",
  BAD_REDIRECT_URI: "invalid_grant",
  CODE_ALREADY_REDEEMED: "invalid_grant",
  INVALID_AUTHORIZATION_CODE: "invalid_grant",
  INVALID_GRANT: "invalid_grant",
  INVALID_REQUEST: "invalid_request",
  INVALID_SCOPE: "invalid_scope",
  LOCKED_OUT: "access_denied",
  MFA_REQUIRED: "interaction_required",
  PASSWORD_EXPIRED: "invalid_grant",
  RATE_LIMITED: "temporarily_unavailable",
  UNSUPPORTED_GRANT: "unsupported_grant_type",
  USER_DISABLED: "invalid_grant",
};

const oktaApiSummary: Record<SemanticErrorCode, string> = {
  BAD_CLIENT_SECRET: "Authentication failed",
  BAD_REDIRECT_URI: "Api validation failed: redirectUri",
  CODE_ALREADY_REDEEMED: "Invalid token provided",
  INVALID_AUTHORIZATION_CODE: "Invalid token provided",
  INVALID_GRANT: "Invalid token provided",
  INVALID_REQUEST: "Api validation failed: request",
  INVALID_SCOPE: "Api validation failed: scope",
  LOCKED_OUT: "Authentication failed",
  MFA_REQUIRED: "Invalid Passcode/Answer",
  PASSWORD_EXPIRED: "The password is expired.",
  RATE_LIMITED: "API call exceeded rate limit due to too many requests.",
  UNSUPPORTED_GRANT: "Api validation failed: grant_type",
  USER_DISABLED: "Authentication failed",
};

const oktaOAuthSummary: Record<SemanticErrorCode, string> = {
  BAD_CLIENT_SECRET: "Client authentication failed.",
  BAD_REDIRECT_URI: "The redirect URI does not match the authorization request.",
  CODE_ALREADY_REDEEMED: "The authorization code has already been used.",
  INVALID_AUTHORIZATION_CODE: "The authorization code is invalid or expired.",
  INVALID_GRANT: "The provided authorization grant is invalid.",
  INVALID_REQUEST: "The OAuth request is invalid.",
  INVALID_SCOPE: "The requested scope is invalid.",
  LOCKED_OUT: "The resource owner account is locked.",
  MFA_REQUIRED: "Additional user interaction is required.",
  PASSWORD_EXPIRED: "The resource owner password is expired.",
  RATE_LIMITED: "The authorization server is temporarily unavailable.",
  UNSUPPORTED_GRANT: "The requested grant type is not supported.",
  USER_DISABLED: "The resource owner account is disabled.",
};

export const oktaErrorCatalog: ErrorCatalog = {
  render(
    code: SemanticErrorCode,
    context: ProviderErrorContext
  ): RenderedProviderError {
    if (context.surface === "oauth") {
      const error = oktaOAuthError[code];
      return {
        status:
          code === "BAD_CLIENT_SECRET" ? 401 : code === "RATE_LIMITED" ? 429 : 400,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          pragma: "no-cache",
          "x-okta-request-id": context.correlationId,
          ...(code === "BAD_CLIENT_SECRET"
            ? { "www-authenticate": 'Basic realm="Okta"' }
            : {}),
          ...(code === "RATE_LIMITED" ? { "retry-after": "1" } : {}),
        },
        body: {
          error,
          error_description: context.detail ?? oktaOAuthSummary[code],
        },
      };
    }
    const errorCode = oktaErrorCode[code];
    const rateLimited = code === "RATE_LIMITED";
    const reset = Math.floor(new Date(context.timestamp).getTime() / 1_000) + 60;
    return {
      status: rateLimited ? 429 : code === "BAD_CLIENT_SECRET" ? 401 : 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-okta-request-id": context.correlationId,
        ...(rateLimited
          ? {
              "x-rate-limit-limit": "60",
              "x-rate-limit-remaining": "0",
              "x-rate-limit-reset": String(reset),
            }
          : {}),
      },
      body: {
        errorCode,
        errorSummary: context.detail ?? oktaApiSummary[code],
        errorLink: errorCode,
        errorId: context.correlationId,
        errorCauses: [],
      },
    };
  },
};

const oktaUrls = {
  issuer: ({ issuerBase }: ProviderUrlContext) => normalizeIssuerBase(issuerBase),
  authorization: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/authorize"),
  token: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/token"),
  jwks: ({ issuerBase }: ProviderUrlContext) => appendIssuerPath(issuerBase, "v1/keys"),
  userInfo: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/userinfo"),
  discovery: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, ".well-known/openid-configuration"),
  introspection: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/introspect"),
  revocation: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/revoke"),
  deviceAuthorization: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, "v1/device/authorize"),
  activation: ({ issuerBase }: ProviderUrlContext) => {
    const issuer = new URL(normalizeIssuerBase(issuerBase));
    issuer.pathname = issuer.pathname.replace(/\/oauth2\/[^/]+$/, "");
    issuer.pathname = `${issuer.pathname.replace(/\/+$/, "")}/activate`;
    return issuer.toString().replace(/\/$/, "");
  },
};

const oktaDiscovery = (context: ProviderUrlContext): OidcDiscoveryDocument => ({
  issuer: oktaUrls.issuer(context),
  authorization_endpoint: oktaUrls.authorization(context),
  token_endpoint: oktaUrls.token(context),
  jwks_uri: oktaUrls.jwks(context),
  userinfo_endpoint: oktaUrls.userInfo(context),
  introspection_endpoint: oktaUrls.introspection(context),
  revocation_endpoint: oktaUrls.revocation(context),
  device_authorization_endpoint: oktaUrls.deviceAuthorization(context),
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email", "groups", "offline_access"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  introspection_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
  ],
  revocation_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
  ],
  claims_supported: [
    "sub",
    "iss",
    "aud",
    "exp",
    "iat",
    "nonce",
    "name",
    "preferred_username",
    "email",
    "email_verified",
    "given_name",
    "family_name",
    "groups",
    "auth_time",
    "acr",
    "at_hash",
    "idp",
    "jti",
    "ver",
    "amr",
    "cid",
    "uid",
    "scp",
  ],
  grant_types_supported: [
    "authorization_code",
    "urn:ietf:params:oauth:grant-type:device_code",
  ],
  code_challenge_methods_supported: ["S256"],
});

export const oktaProfile: ProviderProfile = {
  id: "okta",
  displayName: "Okta",
  urls: oktaUrls,
  discovery: oktaDiscovery,
  claims: (context) => {
    const scopes = new Set(context.scopes ?? ["openid", "profile", "email", "groups"]);
    const access = context.tokenKind === "access";
    return {
      aud: context.clientId,
      iss: context.issuer,
      iat: context.issuedAt,
      exp: context.expiresAt,
      sub: context.user.id,
      ...(context.tokenId ? { jti: context.tokenId } : {}),
      ver: 1,
      ...(access
        ? {
            cid: context.clientId,
            uid: context.user.id,
            auth_time: context.authTime ?? context.issuedAt,
            acr: "urn:okta:loa:1fa:any",
          }
        : {
            auth_time: context.authTime ?? context.issuedAt,
            amr: ["pwd"],
            idp: context.tenantId,
            ...(context.accessTokenHash ? { at_hash: context.accessTokenHash } : {}),
          }),
      ...(scopes.has("profile")
        ? {
            name: context.user.displayName,
            preferred_username: context.user.userName,
            ...(context.user.givenName ? { given_name: context.user.givenName } : {}),
            ...(context.user.familyName
              ? { family_name: context.user.familyName }
              : {}),
          }
        : {}),
      ...(scopes.has("email")
        ? { email: context.user.userName, email_verified: true }
        : {}),
      ...(context.nonce ? { nonce: context.nonce } : {}),
      ...(scopes.has("groups") && (context.groupNames?.length || context.groups?.length)
        ? { groups: [...(context.groupNames ?? context.groups ?? [])] }
        : {}),
    };
  },
  errors: oktaErrorCatalog,
  scimDialect: { patchStyle: "okta", acceptsEnterpriseExtension: true },
  provisioning: { usersBeforeGroups: true, deprovision: "deactivate" },
  loginPage: { theme: "okta", productName: "Okta" },
  authn: { classic: true },
  tokenPolicy: {
    accessTokenLifetimeSeconds: 3_600,
    idTokenLifetimeSeconds: 3_600,
    authorizationCodeLifetimeSeconds: 300,
    refreshTokenLifetimeSeconds: 90 * 24 * 3_600,
    scopeClaimFormat: "array",
    includeTokenUseClaim: false,
    accessTokenIdPrefix: "AT.",
    idTokenIdPrefix: "ID.",
  },
};
