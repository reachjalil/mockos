import type { ProviderId, ScimDialect, SemanticErrorCode } from "@mockos/contracts";
import type { UserRecord } from "../directory";

export interface ProviderUrlContext {
  /** Request-derived final OIDC issuer. Never persist this value. */
  readonly issuerBase: string;
  readonly tenantId: string;
}

export interface ProviderUrls {
  issuer(context: ProviderUrlContext): string;
  authorization(context: ProviderUrlContext): string;
  token(context: ProviderUrlContext): string;
  jwks(context: ProviderUrlContext): string;
  userInfo(context: ProviderUrlContext): string;
  discovery(context: ProviderUrlContext): string;
  introspection?(context: ProviderUrlContext): string;
  revocation?(context: ProviderUrlContext): string;
  deviceAuthorization?(context: ProviderUrlContext): string;
  activation?(context: ProviderUrlContext): string;
}

export interface ProviderErrorContext {
  readonly correlationId: string;
  readonly traceId: string;
  readonly timestamp: string;
  readonly detail?: string;
  /** API errors and OAuth protocol errors use different Okta wire shapes. */
  readonly surface?: "api" | "oauth";
}

export interface RenderedProviderError {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface ErrorCatalog {
  render(code: SemanticErrorCode, context: ProviderErrorContext): RenderedProviderError;
}

export interface ClaimMapperContext {
  readonly issuer: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly user: UserRecord;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce?: string;
  readonly groups?: readonly string[];
  readonly groupNames?: readonly string[];
  readonly roles?: readonly string[];
  readonly tokenKind?: "access" | "id";
  readonly scopes?: readonly string[];
  readonly tokenId?: string;
  readonly authTime?: number;
  readonly accessTokenHash?: string;
}

export type ClaimMapper = (
  context: ClaimMapperContext
) => Readonly<Record<string, unknown>>;

export interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly userinfo_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly response_modes_supported: readonly string[];
  readonly subject_types_supported: readonly string[];
  readonly id_token_signing_alg_values_supported: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly claims_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly [key: string]: unknown;
}

export interface TokenPolicy {
  readonly accessTokenLifetimeSeconds: number;
  readonly idTokenLifetimeSeconds: number;
  readonly authorizationCodeLifetimeSeconds: number;
  readonly refreshTokenLifetimeSeconds: number;
  readonly scopeClaimFormat?: "string" | "array";
  readonly includeTokenUseClaim?: boolean;
  readonly accessTokenIdPrefix?: string;
  readonly idTokenIdPrefix?: string;
}

export interface ProviderProfile {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly urls: ProviderUrls;
  discovery(context: ProviderUrlContext): OidcDiscoveryDocument;
  readonly claims: ClaimMapper;
  readonly errors: ErrorCatalog;
  readonly scimDialect: ScimDialect;
  readonly provisioning: Readonly<Record<string, unknown>>;
  readonly loginPage: Readonly<Record<string, unknown>>;
  readonly authn?: Readonly<Record<string, unknown>>;
  readonly tokenPolicy: TokenPolicy;
}

export const normalizeIssuerBase = (value: string): string => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Issuer base must not contain credentials, a query, or a fragment."
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
};

export const appendIssuerPath = (base: string, path: string): string =>
  `${normalizeIssuerBase(base)}/${path.replace(/^\/+/, "")}`;
