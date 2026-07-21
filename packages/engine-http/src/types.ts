export type Awaitable<T> = Promise<T> | T;

export type EntraAuthorizationRequest = {
  clientId: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  loginHint?: string;
  nonce?: string;
  redirectUri: string;
  responseMode?: string;
  responseType: string;
  scope: string;
  state?: string;
};

export type EntraAuthorizationLogin = EntraAuthorizationRequest & {
  password: string;
  username: string;
};

export type EntraAuthorizationResult = {
  code: string;
};

export type EntraTokenRequest = {
  clientId: string;
  clientSecret?: string;
  code?: string;
  codeVerifier?: string;
  grantType: string;
  issuerBase: string;
  redirectUri?: string;
  refreshToken?: string;
  scope?: string;
};

export type EntraTokenResult = {
  accessToken: string;
  expiresIn: number;
  extExpiresIn?: number;
  idToken?: string;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
};

export type JsonWebKeySet = { readonly keys: readonly JsonWebKey[] };

export interface EntraHttpEngine {
  readonly tenantId: string;
  authorize(input: EntraAuthorizationLogin): Awaitable<EntraAuthorizationResult>;
  discovery(issuerBase: string): Awaitable<Record<string, unknown>>;
  jwks(): Awaitable<JsonWebKeySet>;
  token(input: EntraTokenRequest): Awaitable<EntraTokenResult>;
  validateAuthorizationRequest?(input: EntraAuthorizationRequest): Awaitable<void>;
}

export type CreateEntraHttpAppOptions = {
  engine: EntraHttpEngine;
  issuerHeader?: string;
  publicPathHeader?: string;
};
