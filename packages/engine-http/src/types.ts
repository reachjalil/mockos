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

type EntraTokenRequestBase = {
  clientId: string;
  clientSecret?: string;
  graphBaseUrl: string;
  issuerBase: string;
};

export type EntraAuthorizationCodeTokenRequest = EntraTokenRequestBase & {
  code: string;
  codeVerifier: string;
  grantType: "authorization_code";
  redirectUri: string;
  scope?: string;
};

export type EntraRefreshTokenRequest = EntraTokenRequestBase & {
  grantType: "refresh_token";
  refreshToken: string;
  scope?: string;
};

export type EntraDeviceCodeTokenRequest = EntraTokenRequestBase & {
  deviceCode: string;
  grantType: "urn:ietf:params:oauth:grant-type:device_code";
};

export type EntraTokenRequest =
  | EntraAuthorizationCodeTokenRequest
  | EntraRefreshTokenRequest
  | EntraDeviceCodeTokenRequest;

export type EntraDeviceAuthorizationRequest = {
  clientId: string;
  directoryBaseUrl: string;
  issuerBase: string;
  scope: string;
};

export type EntraDeviceAuthorizationResult = {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
};

export type EntraDeviceActivationRequest = {
  password: string;
  userCode: string;
  username: string;
};

export type EntraDeviceDenialRequest = EntraDeviceActivationRequest;

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
  activateDeviceAuthorization(input: EntraDeviceActivationRequest): Awaitable<void>;
  authorize(input: EntraAuthorizationLogin): Awaitable<EntraAuthorizationResult>;
  createDeviceAuthorization(
    input: EntraDeviceAuthorizationRequest
  ): Awaitable<EntraDeviceAuthorizationResult>;
  denyDeviceAuthorization(input: EntraDeviceDenialRequest): Awaitable<void>;
  discovery(issuerBase: string): Awaitable<Record<string, unknown>>;
  jwks(): Awaitable<JsonWebKeySet>;
  token(input: EntraTokenRequest): Awaitable<EntraTokenResult>;
  validateAuthorizationRequest?(input: EntraAuthorizationRequest): Awaitable<void>;
}

export type CreateEntraHttpAppOptions = {
  directoryBaseHeader?: string;
  engine: EntraHttpEngine;
  graphBaseHeader?: string;
  issuerHeader?: string;
  publicPathHeader?: string;
};
