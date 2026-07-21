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

export const oktaErrorCatalog: ErrorCatalog = {
  render(
    code: SemanticErrorCode,
    context: ProviderErrorContext
  ): RenderedProviderError {
    const errorCode = oktaErrorCode[code];
    const rateLimited = code === "RATE_LIMITED";
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
              "x-rate-limit-reset": "1",
            }
          : {}),
      },
      body: {
        errorCode,
        errorSummary:
          context.detail ??
          (rateLimited
            ? "API call exceeded rate limit due to too many requests."
            : "Authentication failed or the request is invalid."),
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
};

const oktaDiscovery = (context: ProviderUrlContext): OidcDiscoveryDocument => ({
  issuer: oktaUrls.issuer(context),
  authorization_endpoint: oktaUrls.authorization(context),
  token_endpoint: oktaUrls.token(context),
  jwks_uri: oktaUrls.jwks(context),
  userinfo_endpoint: oktaUrls.userInfo(context),
  response_types_supported: ["code"],
  response_modes_supported: ["query", "form_post"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email", "groups", "offline_access"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
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
    "groups",
  ],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
});

/** Okta is intentionally a substrate skeleton until the M2 fidelity pass. */
export const oktaProfile: ProviderProfile = {
  id: "okta",
  displayName: "Okta",
  urls: oktaUrls,
  discovery: oktaDiscovery,
  claims: (context) => ({
    aud: context.clientId,
    iss: context.issuer,
    iat: context.issuedAt,
    exp: context.expiresAt,
    sub: context.user.id,
    name: context.user.displayName,
    preferred_username: context.user.userName,
    email: context.user.userName,
    ...(context.nonce ? { nonce: context.nonce } : {}),
    ...(context.groups?.length ? { groups: [...context.groups] } : {}),
  }),
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
  },
};
