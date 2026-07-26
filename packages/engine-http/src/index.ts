import { Hono } from "hono";
import {
  OAuthProtocolError,
  renderEntraDeviceAuthorizationError,
  renderEntraError,
} from "./errors";
import { renderEntraLoginPage } from "./login";
import type {
  CreateEntraHttpAppOptions,
  EntraAuthorizationRequest,
  EntraHttpEngine,
  EntraTokenRequest,
} from "./types";

export {
  OAuthProtocolError,
  renderEntraDeviceAuthorizationError,
  renderEntraError,
} from "./errors";
export type * from "./graph";
export { createGraphHttpApp } from "./graph";
export { renderEntraLoginPage, renderOktaLoginPage } from "./login";
export { createOktaHttpApp, renderOktaDeviceActivationPage } from "./okta";
export type * from "./okta-api";
export { createOktaDirectoryApi, OktaApiError } from "./okta-api";
export type * from "./okta-authn";
export { createOktaAuthnApi } from "./okta-authn";
export type * from "./okta-types";
export type * from "./scim";
export { createScimHttpApp, ScimHttpError } from "./scim";
export type * from "./types";

const noStoreHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code" as const;

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

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

const hasTrustedPublicProtocol = (url: URL): boolean =>
  url.protocol === "https:" ||
  (url.protocol === "http:" && isLoopbackHostname(url.hostname));

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

const trustedBaseFromRequest = (
  request: Request,
  header: string,
  label: string,
  requiredPathSuffix?: string
) => {
  const value = request.headers.get(header)?.trim();
  if (!value) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      `Missing trusted ${label} routing header.`
    );
  }
  try {
    const issuer = new URL(value);
    if (!hasTrustedPublicProtocol(issuer)) {
      throw new Error(`${label} must use HTTPS.`);
    }
    if (issuer.username || issuer.password || issuer.search || issuer.hash) {
      throw new Error(`${label} must not contain credentials, query, or fragment.`);
    }
    const normalized = issuer.toString().replace(/\/$/, "");
    if (
      requiredPathSuffix &&
      !new URL(normalized).pathname.endsWith(requiredPathSuffix)
    ) {
      throw new Error(`${label} must end in ${requiredPathSuffix}.`);
    }
    return normalized;
  } catch (cause) {
    throw new OAuthProtocolError("INVALID_REQUEST", `Invalid trusted ${label} URL.`, {
      cause,
    });
  }
};

const issuerFromRequest = (request: Request, header: string) =>
  trustedBaseFromRequest(request, header, "issuer base");

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
  const deviceError = renderEntraDeviceAuthorizationError(error);
  if (deviceError) {
    return new Response(JSON.stringify(deviceError.body), {
      status: deviceError.status,
      headers: {
        ...noStoreHeaders,
        "content-type": "application/json; charset=UTF-8",
      },
    });
  }
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
  issuerBase: string,
  graphBaseUrl: string
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
    graphBaseUrl,
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
  if (grantType === "device_code" || grantType === DEVICE_CODE_GRANT_TYPE) {
    return {
      ...common,
      grantType: DEVICE_CODE_GRANT_TYPE,
      deviceCode: required(get("device_code"), "device_code"),
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

export const renderEntraDeviceActivationPage = (
  input: { userCode?: string; username?: string },
  options: {
    action: string;
    error?: string;
    outcome?: "approved" | "denied";
  }
) => {
  const message =
    options.outcome === "approved"
      ? '<div class="success" role="status">Device authorized. You may return to your device.</div>'
      : options.outcome === "denied"
        ? '<div class="notice" role="status">Device authorization declined. You may close this page.</div>'
        : options.error
          ? `<div class="error" role="alert">${escapeHtml(options.error)}</div>`
          : "";
  const form = options.outcome
    ? ""
    : `<form method="post" action="${escapeHtml(options.action)}">
        <label for="user-code">Code</label>
        <input id="user-code" name="user_code" type="text" autocomplete="one-time-code" required value="${escapeHtml(input.userCode ?? "")}">
        <label for="username">Username</label>
        <input id="username" name="username" type="email" autocomplete="username" required value="${escapeHtml(input.username ?? "")}">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <div class="actions">
          <button class="secondary" type="submit" name="decision" value="deny">Decline</button>
          <button type="submit" name="decision" value="approve">Continue</button>
        </div>
      </form>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Sign in on this device · mockOS test environment</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #1b1b1b; background: #f5f5f5; }
      main { width: min(440px, 100%); padding: 42px 44px; border: 1px solid #d7d7d7; background: #fff; box-shadow: 0 2px 7px rgb(0 0 0 / 14%); }
      .brand { font-size: 21px; font-weight: 650; letter-spacing: -.03em; }
      .provider { margin: 28px 0 0; color: #0067b8; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      h1 { margin: 8px 0; font-size: 25px; font-weight: 600; }
      .hint { margin: 0 0 24px; color: #5f5f5f; font-size: 14px; line-height: 1.5; }
      label { display: block; margin-top: 16px; font-size: 14px; }
      input { width: 100%; padding: 10px 2px; border: 0; border-bottom: 1px solid #666; font: inherit; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 28px; }
      button { min-width: 108px; border: 0; padding: 9px 18px; color: #fff; background: #0067b8; font: inherit; font-weight: 600; }
      button.secondary { color: #1b1b1b; background: #e5e5e5; }
      .error, .success, .notice { margin-top: 18px; padding: 10px 12px; font-size: 14px; }
      .error { border-left: 3px solid #a4262c; color: #8a2025; background: #fdf3f4; }
      .success { border-left: 3px solid #107c10; color: #0d640d; background: #f1f8f1; }
      .notice { border-left: 3px solid #666; color: #444; background: #f5f5f5; }
      footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid #e5e5e5; color: #666; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand" aria-label="mockOS"><span aria-hidden="true">🥸</span> mockOS</div>
      <p class="provider">Microsoft Entra simulation</p>
      <h1>Sign in on this device</h1>
      <p class="hint">Use a seeded mockOS identity. Never enter production credentials.</p>
      ${message}
      ${form}
      <footer>Test environment · Synthetic identities only</footer>
    </main>
  </body>
</html>`;
};

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
  directoryBaseHeader = "x-mockos-directory-base",
  engine,
  graphBaseHeader = "x-mockos-graph-base",
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

  app.post("/:tenant/oauth2/v2.0/devicecode", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    try {
      const form = await context.req.formData();
      const get = (key: string) => {
        const value = form.get(key);
        return typeof value === "string" ? value : undefined;
      };
      const result = await engine.createDeviceAuthorization({
        clientId: required(get("client_id"), "client_id"),
        directoryBaseUrl: trustedBaseFromRequest(
          context.req.raw,
          directoryBaseHeader,
          "directory base"
        ),
        issuerBase: issuerFromRequest(context.req.raw, issuerHeader),
        scope: required(get("scope"), "scope"),
      });
      return context.json(
        {
          device_code: result.deviceCode,
          user_code: result.userCode,
          verification_uri: result.verificationUri,
          expires_in: result.expiresIn,
          interval: result.interval,
          message: `To sign in, use a web browser to open the page ${result.verificationUri} and enter the code ${result.userCode} to authenticate.`,
        },
        200,
        noStoreHeaders
      );
    } catch (error) {
      return entraJsonError(error);
    }
  });

  app.get("/devicelogin", (context) =>
    context.html(
      renderEntraDeviceActivationPage(
        { userCode: optional(context.req.query("user_code")) },
        { action: publicActionFromRequest(context.req.raw, publicPathHeader) }
      ),
      200,
      noStoreHeaders
    )
  );

  app.post("/devicelogin", async (context) => {
    const form = await context.req.formData();
    const get = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : undefined;
    };
    const userCode = required(get("user_code"), "user_code");
    const decision = required(get("decision"), "decision");
    const action = publicActionFromRequest(context.req.raw, publicPathHeader);
    const username = required(get("username"), "username");
    const password = required(get("password"), "password");
    try {
      if (decision === "deny") {
        await engine.denyDeviceAuthorization({ userCode, username, password });
        return context.html(
          renderEntraDeviceActivationPage({ userCode }, { action, outcome: "denied" }),
          200,
          noStoreHeaders
        );
      }
      if (decision !== "approve") {
        throw new OAuthProtocolError(
          "INVALID_REQUEST",
          "The decision must be either 'approve' or 'deny'."
        );
      }
      await engine.activateDeviceAuthorization({
        userCode,
        username,
        password,
      });
      return context.html(
        renderEntraDeviceActivationPage(
          { userCode, username },
          { action, outcome: "approved" }
        ),
        200,
        noStoreHeaders
      );
    } catch (error) {
      const renderedDeviceError = renderEntraDeviceAuthorizationError(error);
      const rendered = renderedDeviceError ?? renderEntraError(error);
      return context.html(
        renderEntraDeviceActivationPage(
          { userCode, username },
          {
            action,
            error: rendered.body.error_description.split(" Trace ID:")[0],
          }
        ),
        rendered.status === 429 ? 429 : 400,
        noStoreHeaders
      );
    }
  });

  app.post("/:tenant/oauth2/v2.0/token", async (context) => {
    tenantMatches(context.req.param("tenant"), engine);
    const form = await context.req.formData();
    try {
      const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
      const graphBaseUrl = trustedBaseFromRequest(
        context.req.raw,
        graphBaseHeader,
        "Graph base",
        "/graph/v1.0"
      );
      const result = await engine.token(
        tokenRequest(form, context.req.raw, issuerBase, graphBaseUrl)
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
