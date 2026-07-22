export type OktaAwaitable<T> = Promise<T> | T;

export type OktaAuthorizationRequest = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  loginHint?: string;
  nonce?: string;
  redirectUri: string;
  responseMode?: "form_post" | "query";
  responseType: "code";
  scope: string;
  state?: string;
};

export type OktaAuthorizationLogin = OktaAuthorizationRequest & {
  password: string;
  username: string;
};

export type OktaAuthorizationResult = {
  code: string;
};

export type OktaAuthorizationCodeTokenRequest = {
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  grantType: "authorization_code";
  issuerBase: string;
  redirectUri: string;
};

export type OktaDeviceCodeTokenRequest = {
  clientId: string;
  deviceCode: string;
  grantType: "urn:ietf:params:oauth:grant-type:device_code";
  issuerBase: string;
};

export type OktaTokenResult = {
  accessToken: string;
  expiresIn: number;
  idToken?: string;
  refreshToken?: string;
  scope: string;
  tokenType?: string;
};

export type OktaDeviceAuthorizationRequest = {
  clientId: string;
  issuerBase: string;
  scope: string;
};

export type OktaDeviceAuthorizationResult = {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
};

export type OktaDeviceActivationRequest = {
  password: string;
  userCode: string;
  username: string;
};

export type OktaIntrospectionRequest = {
  clientId: string;
  clientSecret?: string;
  issuerBase: string;
  token: string;
  tokenTypeHint?: string;
};

export type OktaIntrospectionResult =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly aud: string;
      readonly client_id: string;
      readonly exp: number;
      readonly iat: number;
      readonly iss: string;
      readonly jti?: string;
      readonly scope: string;
      readonly sub: string;
      readonly token_type: "Bearer" | "refresh_token";
      readonly uid: string;
      readonly username: string;
    };

export type OktaRevocationRequest = {
  clientId: string;
  clientSecret?: string;
  token: string;
  tokenTypeHint?: string;
};

export type OktaRenderedError = {
  body: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
  status: number;
};

export interface OktaHttpEngine {
  activateDeviceAuthorization(input: OktaDeviceActivationRequest): OktaAwaitable<void>;
  authorize(input: OktaAuthorizationLogin): OktaAwaitable<OktaAuthorizationResult>;
  createDeviceAuthorization(
    input: OktaDeviceAuthorizationRequest
  ): OktaAwaitable<OktaDeviceAuthorizationResult>;
  discovery(issuerBase: string): OktaAwaitable<Record<string, unknown>>;
  introspect(input: OktaIntrospectionRequest): OktaAwaitable<OktaIntrospectionResult>;
  jwks(issuerBase: string): OktaAwaitable<{ readonly keys: readonly JsonWebKey[] }>;
  pollDeviceAuthorization(
    input: OktaDeviceCodeTokenRequest
  ): OktaAwaitable<OktaTokenResult>;
  redeemAuthorizationCode(
    input: OktaAuthorizationCodeTokenRequest
  ): OktaAwaitable<OktaTokenResult>;
  renderError(error: unknown): OktaAwaitable<OktaRenderedError>;
  revoke(input: OktaRevocationRequest): OktaAwaitable<void>;
  validateAuthorizationRequest?(input: OktaAuthorizationRequest): OktaAwaitable<void>;
}

export type CreateOktaHttpAppOptions = {
  authorizationServerId?: string;
  engine: OktaHttpEngine;
  issuerHeader?: string;
  publicPathHeader?: string;
};
