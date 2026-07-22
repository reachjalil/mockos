import { Hono } from "hono";
import { OAuthProtocolError, renderEntraError } from "./errors";
import { renderEntraLoginPage } from "./login";
import type {
  CreateEntraHttpAppOptions,
  EntraAuthorizationRequest,
  EntraHttpEngine,
  EntraTokenRequest,
} from "./types";

export { OAuthProtocolError, renderEntraError } from "./errors";
export { createGraphHttpApp } from "./graph";
export type * from "./graph";
export { renderEntraLoginPage, renderOktaLoginPage } from "./login";
export { createOktaDirectoryApi, OktaApiError } from "./okta-api";
export type * from "./okta-api";
export { createOktaHttpApp, renderOktaDeviceActivationPage } from "./okta";
export type * from "./okta-types";
export { createScimHttpApp, ScimHttpError } from "./scim";
export type * from "./scim";
export type * from "./types";

const noStoreHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      `The request body must contain the following parameter: '${name}'.`
    );
  }
  return value;
};

const optional = (value: string | null | undefined) => value ?? undefined;

const authorizationFromParams = (
  params: URLSearchParams
): EntraAuthorizationRequest => ({
  clientId: required(optional(params.get("client_id")), "client_id"),
  redirectUri: required(optional(params.get("redirect_uri")), "redirect_uri"),
  responseType: required(optional(params.get("response_type")), "response_type"),
  scope: required(optional(params.get("scope")), "scope"),
  responseMode: optional(params.get("response_mode")),
  state: optional(params.get("state")),
  nonce: optional(params.get("nonce")),
  codeChallenge: optional(params.get("code_challenge")),
  codeChallengeMethod: optional(params.get("code_challenge_method")),
  loginHint: optional(params.get("login_hint")),
});

const issuerFromRequest = (request: Request, header: string) => {
  const value = request.headers.get(header)?.trim();
  if (!value) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      `Missing trusted ${header} routing header.`
    );
  }
  try {
    const issuer = new URL(value);
    const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (issuer.protocol !== "https:" && !loopback.has(issuer.hostname)) {
      throw new Error("Issuer must use HTTPS.");
    }
    if (issuer.username || issuer.password || issuer.search || issuer.hash) {
      throw new Error("Issuer must not contain credentials, query, or fragment.");
    }
    return issuer.toString().replace(/\/$/, "");
  } catch (cause) {
    throw new OAuthProtocolError("INVALID_REQUEST", "Invalid issuer base URL.", {
      cause,
    });
  }
};

const publicActionFromRequest = (request: Request, header: string) => {
  const routedPath = request.headers.get(header);
  if (routedPath) {
    if (!routedPath.startsWith("/") || routedPath.startsWith("//")) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        `Invalid trusted ${header} routing header.`
      );
    }
    const parsed = new URL(routedPath, "https://mockos.invalid");
    if (parsed.origin !== "https://mockos.invalid" || parsed.search || parsed.hash) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        `Invalid trusted ${header} routing header.`
      );
    }
    return parsed.pathname;
  }
  return new URL(request.url).pathname;
};

const tenantMatches = (tenant: string, engine: EntraHttpEngine) => {
  if (tenant !== engine.tenantId) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      "The tenant identifier in the request is not valid."
    );
  }
};

const entraJsonError = (error: unknown) => {
  const rendered = renderEntraError(error);
  return new Response(JSON.stringify(rendered.body), {
    status: rendered.status,
    headers: {
      ...noStoreHeaders,
      "content-type": "application/json; charset=UTF-8",
      "x-ms-request-id": rendered.body.trace_id,
    },
  });
};

const tokenRequest = (
  form: FormData,
  request: Request,
  issuerBase: string
): EntraTokenRequest => {
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : undefined;
  };
  const authorization = request.headers.get("authorization");
  let basicClientId: string | undefined;
  let basicClientSecret: string | undefined;
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        basicClientId = decodeURIComponent(decoded.slice(0, separator));
        basicClientSecret = decodeURIComponent(decoded.slice(separator + 1));
      }
    } catch {
      throw new OAuthProtocolError("BAD_CLIENT_SECRET");
    }
  }
  const grantType = required(get("grant_type"), "grant_type");
  const clientId = required(basicClientId ?? get("client_id"), "client_id");
  const clientSecret = basicClientSecret ?? get("client_secret");
  const scope = get("scope");
  const common = {
    issuerBase,
    clientId,
    ...(clientSecret !== undefined ? { clientSecret } : {}),
    ...(scope !== undefined ? { scope } : {}),
  };
  if (grantType === "authorization_code") {
    return {
      ...common,
      grantType,
      code: required(get("code"), "code"),
      redirectUri: required(get("redirect_uri"), "redirect_uri"),
      codeVerifier: required(get("code_verifier"), "code_verifier"),
    };
  }
  if (grantType === "refresh_token") {
    return {
      ...common,
      grantType,
      refreshToken: required(get("refresh_token"), "refresh_token"),
    };
  }
  throw new OAuthProtocolError("UNSUPPORTED_GRANT");
};

const appendAuthorizationResult = (
  redirectUri: string,
  result: { code: string },
  state: string | undefined
) => {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", result.code);
  if (state) redirect.searchParams.set("state", state);
  return redirect.toString();
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const assertResponseMode = (responseMode: string | undefined) => {
  if (
    responseMode !== undefined &&
    responseMode !== "query" &&
    responseMode !== "form_post"
  ) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      "Only response_mode=query and response_mode=form_post are supported."
    );
  }
};

const authorizationResponse = (
  input: EntraAuthorizationRequest,
  result: { code: string }
): Response => {
  if (input.responseMode === "form_post") {
    const state = input.state
      ? `<input type="hidden" name="state" value="${escapeHtml(input.state)}">`
      : "";
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Continue</title></head><body><form id="response" method="post" action="${escapeHtml(input.redirectUri)}"><input type="hidden" name="code" value="${escapeHtml(result.code)}">${state}<noscript><button type="submit">Continue</button></noscript></form><script>document.getElementById("response").submit()</script></body></html>`,
      {
        status: 200,
        headers: { ...noStoreHeaders, "content-type": "text/html; charset=UTF-8" },
      }
    );
  }
  return Response.redirect(
    appendAuthorizationResult(input.redirectUri, result, input.state),
    302
  );
};

export const createEntraHttpApp = ({
  engine,
  issuerHeader = "x-mockos-issuer-base",
  publicPathHeader = "x-mockos-public-path",
}: CreateEntraHttpAppOptions) => {
  const app = new Hono();

  app.onError((error) => entraJsonError(error));

  app.get("/:tenant/v2.0/.well-known/openid-configuration", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
    return context.json(await engine.discovery(issuerBase), 200, noStoreHeaders);
  });

  app.get("/:tenant/discovery/v2.0/keys", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    return context.json(await engine.jwks(), 200, {
      "cache-control": "public, max-age=300",
    });
  });

  app.get("/:tenant/oauth2/v2.0/authorize", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    const input = authorizationFromParams(new URL(context.req.url).searchParams);
    if (input.responseType !== "code") {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        "Only response_type=code is supported."
      );
    }
    assertResponseMode(input.responseMode);
    await engine.validateAuthorizationRequest?.(input);
    return context.html(
      renderEntraLoginPage(input, {
        action: publicActionFromRequest(context.req.raw, publicPathHeader),
      }),
      200,
      { "cache-control": "no-store" }
    );
  });

  app.post("/:tenant/oauth2/v2.0/authorize", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    const form = await context.req.formData();
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params.append(key, value);
    }
    const input = authorizationFromParams(params);
    const username = required(optional(params.get("username")), "username");
    const password = required(optional(params.get("password")), "password");
    try {
      assertResponseMode(input.responseMode);
      await engine.validateAuthorizationRequest?.(input);
      const result = await engine.authorize({ ...input, username, password });
      return authorizationResponse(input, result);
    } catch (error) {
      const rendered = renderEntraError(error);
      return context.html(
        renderEntraLoginPage(
          { ...input, loginHint: username },
          {
            action: publicActionFromRequest(context.req.raw, publicPathHeader),
            error: rendered.body.error_description.split(" Trace ID:")[0],
          }
        ),
        rendered.status === 429 ? 429 : 400,
        { "cache-control": "no-store" }
      );
    }
  });

  app.post("/:tenant/oauth2/v2.0/token", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    const form = await context.req.formData();
    try {
      const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
      const result = await engine.token(
        tokenRequest(form, context.req.raw, issuerBase)
      );
      return context.json(
        {
          token_type: result.tokenType ?? "Bearer",
          scope: result.scope,
          expires_in: result.expiresIn,
          ext_expires_in: result.extExpiresIn ?? result.expiresIn,
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          id_token: result.idToken,
        },
        200,
        noStoreHeaders
      );
    } catch (error) {
      return entraJsonError(error);
    }
  });

  app.notFound(() =>
    entraJsonError(
      new OAuthProtocolError(
        "INVALID_REQUEST",
        "The requested endpoint was not found.",
        {
          status: 404,
        }
      )
    )
  );

  return app;
};
