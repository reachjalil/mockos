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

interface EntraErrorDefinition {
  readonly aadsts: number;
  readonly oauthError: string;
  readonly status: number;
  readonly summary: string;
}

const entraErrors: Record<SemanticErrorCode, EntraErrorDefinition> = {
  BAD_CLIENT_SECRET: {
    aadsts: 7000215,
    oauthError: "invalid_client",
    status: 401,
    summary: "Invalid client secret is provided.",
  },
  BAD_REDIRECT_URI: {
    aadsts: 50011,
    oauthError: "invalid_request",
    status: 400,
    summary:
      "The redirect URI specified in the request does not match the application.",
  },
  CODE_ALREADY_REDEEMED: {
    aadsts: 54005,
    oauthError: "invalid_grant",
    status: 400,
    summary: "OAuth2 Authorization code was already redeemed.",
  },
  INVALID_AUTHORIZATION_CODE: {
    aadsts: 70000,
    oauthError: "invalid_grant",
    status: 400,
    summary: "The provided authorization code is invalid or has expired.",
  },
  INVALID_GRANT: {
    aadsts: 70000,
    oauthError: "invalid_grant",
    status: 400,
    summary: "The provided authorization grant is invalid.",
  },
  INVALID_REQUEST: {
    aadsts: 900144,
    oauthError: "invalid_request",
    status: 400,
    summary: "The request body must contain the required parameter.",
  },
  INVALID_SCOPE: {
    aadsts: 70011,
    oauthError: "invalid_scope",
    status: 400,
    summary: "The provided value for the scope parameter is not valid.",
  },
  LOCKED_OUT: {
    aadsts: 50053,
    oauthError: "access_denied",
    status: 400,
    summary: "The account is locked.",
  },
  MFA_REQUIRED: {
    aadsts: 50076,
    oauthError: "interaction_required",
    status: 400,
    summary: "Multi-factor authentication is required.",
  },
  PASSWORD_EXPIRED: {
    aadsts: 50055,
    oauthError: "invalid_grant",
    status: 400,
    summary: "The password is expired.",
  },
  RATE_LIMITED: {
    aadsts: 90055,
    oauthError: "temporarily_unavailable",
    status: 429,
    summary: "The service has throttled the request.",
  },
  UNSUPPORTED_GRANT: {
    aadsts: 70003,
    oauthError: "unsupported_grant_type",
    status: 400,
    summary: "The application requested an unsupported grant type.",
  },
  USER_DISABLED: {
    aadsts: 50057,
    oauthError: "invalid_grant",
    status: 400,
    summary: "The user account is disabled.",
  },
};

export const entraErrorCatalog: ErrorCatalog = {
  render(
    code: SemanticErrorCode,
    context: ProviderErrorContext
  ): RenderedProviderError {
    const definition = entraErrors[code];
    const description = `AADSTS${definition.aadsts}: ${
      context.detail ?? definition.summary
    } Trace ID: ${context.traceId} Correlation ID: ${
      context.correlationId
    } Timestamp: ${context.timestamp}`;
    return {
      status: definition.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        pragma: "no-cache",
        ...(definition.status === 429 ? { "retry-after": "1" } : {}),
      },
      body: {
        error: definition.oauthError,
        error_description: description,
        error_codes: [definition.aadsts],
        timestamp: context.timestamp,
        trace_id: context.traceId,
        correlation_id: context.correlationId,
      },
    };
  },
};

const entraAuthority = (issuerBase: string): string => {
  const issuer = normalizeIssuerBase(issuerBase);
  return issuer.endsWith("/v2.0") ? issuer.slice(0, -"/v2.0".length) : issuer;
};

const entraUrls = {
  issuer: ({ issuerBase }: ProviderUrlContext) => normalizeIssuerBase(issuerBase),
  authorization: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(entraAuthority(issuerBase), "oauth2/v2.0/authorize"),
  token: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(entraAuthority(issuerBase), "oauth2/v2.0/token"),
  jwks: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(entraAuthority(issuerBase), "discovery/v2.0/keys"),
  userInfo: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(entraAuthority(issuerBase), "openid/userinfo"),
  discovery: ({ issuerBase }: ProviderUrlContext) =>
    appendIssuerPath(issuerBase, ".well-known/openid-configuration"),
};

const entraDiscovery = (context: ProviderUrlContext): OidcDiscoveryDocument => ({
  issuer: entraUrls.issuer(context),
  authorization_endpoint: entraUrls.authorization(context),
  token_endpoint: entraUrls.token(context),
  jwks_uri: entraUrls.jwks(context),
  userinfo_endpoint: entraUrls.userInfo(context),
  response_types_supported: ["code"],
  response_modes_supported: ["query", "form_post"],
  subject_types_supported: ["pairwise"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  token_endpoint_auth_methods_supported: [
    "client_secret_post",
    "client_secret_basic",
    "none",
  ],
  claims_supported: [
    "sub",
    "iss",
    "aud",
    "exp",
    "iat",
    "nbf",
    "nonce",
    "name",
    "preferred_username",
    "oid",
    "tid",
    "groups",
    "roles",
  ],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  cloud_instance_name: "mockos.live",
  tenant_region_scope: "EU",
});

export const entraProfile: ProviderProfile = {
  id: "entra",
  displayName: "Microsoft Entra ID",
  urls: entraUrls,
  discovery: entraDiscovery,
  claims: (context) => ({
    aud: context.clientId,
    iss: context.issuer,
    iat: context.issuedAt,
    nbf: context.issuedAt,
    exp: context.expiresAt,
    sub: context.user.id,
    oid: context.user.id,
    tid: context.tenantId,
    ver: "2.0",
    name: context.user.displayName,
    preferred_username: context.user.userName,
    upn: context.user.userName,
    ...(context.user.givenName ? { given_name: context.user.givenName } : {}),
    ...(context.user.familyName ? { family_name: context.user.familyName } : {}),
    ...(context.nonce ? { nonce: context.nonce } : {}),
    ...(context.groups?.length ? { groups: [...context.groups] } : {}),
    ...(context.roles?.length ? { roles: [...context.roles] } : {}),
  }),
  errors: entraErrorCatalog,
  scimDialect: { patchStyle: "entra", acceptsEnterpriseExtension: true },
  provisioning: { usersBeforeGroups: true, deprovision: "disable_then_delete" },
  loginPage: { theme: "entra", productName: "Microsoft" },
  tokenPolicy: {
    accessTokenLifetimeSeconds: 3_600,
    idTokenLifetimeSeconds: 3_600,
    authorizationCodeLifetimeSeconds: 600,
    refreshTokenLifetimeSeconds: 90 * 24 * 3_600,
  },
};
