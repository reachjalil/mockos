import { Hono } from "hono";
import { OAuthProtocolError } from "./errors";
import { renderOktaLoginPage } from "./login";
import type {
  CreateOktaHttpAppOptions,
  OktaAuthorizationRequest,
  OktaHttpEngine,
  OktaRenderedError,
  OktaTokenResult,
} from "./okta-types";

const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code" as const;

const noStoreHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
};

const optional = (value: string | null | undefined) => value ?? undefined;

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      `The request must contain the following parameter: '${name}'.`
    );
  }
  return value;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

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
  if (!routedPath) return new URL(request.url).pathname;
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
};

const paramsFromForm = (form: FormData) => {
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.append(key, value);
  }
  return params;
};

const authorizationFromParams = (params: URLSearchParams): OktaAuthorizationRequest => {
  const responseType = required(optional(params.get("response_type")), "response_type");
  if (responseType !== "code") {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      "Only response_type=code is supported."
    );
  }
  const responseMode = optional(params.get("response_mode"));
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
  const codeChallenge = required(
    optional(params.get("code_challenge")),
    "code_challenge"
  );
  const codeChallengeMethod = required(
    optional(params.get("code_challenge_method")),
    "code_challenge_method"
  );
  if (codeChallengeMethod !== "S256") {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      "PKCE with code_challenge_method=S256 is required."
    );
  }
  return {
    clientId: required(optional(params.get("client_id")), "client_id"),
    redirectUri: required(optional(params.get("redirect_uri")), "redirect_uri"),
    responseType,
    scope: required(optional(params.get("scope")), "scope"),
    codeChallenge,
    codeChallengeMethod,
    ...(responseMode ? { responseMode } : {}),
    ...(optional(params.get("state")) ? { state: optional(params.get("state")) } : {}),
    ...(optional(params.get("nonce")) ? { nonce: optional(params.get("nonce")) } : {}),
    ...(optional(params.get("login_hint"))
      ? { loginHint: optional(params.get("login_hint")) }
      : {}),
  };
};

const formValue = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

const basicCredentials = (request: Request) => {
  const authorization = request.headers.get("authorization");
  if (!authorization) return {};
  if (!authorization.startsWith("Basic ")) {
    throw new OAuthProtocolError("BAD_CLIENT_SECRET");
  }
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) throw new Error("Missing Basic credential separator.");
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch (cause) {
    throw new OAuthProtocolError("BAD_CLIENT_SECRET", undefined, { cause });
  }
};

const clientCredentials = (form: FormData, request: Request) => {
  const basic = basicCredentials(request);
  const formClientId = formValue(form, "client_id");
  if (basic.clientId && formClientId && basic.clientId !== formClientId) {
    throw new OAuthProtocolError(
      "INVALID_REQUEST",
      "Conflicting client credentials were provided."
    );
  }
  return {
    clientId: required(basic.clientId ?? formClientId, "client_id"),
    clientSecret: basic.clientSecret ?? formValue(form, "client_secret"),
  };
};

const responseHeaders = (
  rendered: OktaRenderedError,
  defaults: Readonly<Record<string, string>> = {}
) => {
  const headers = new Headers(defaults);
  for (const [name, value] of Object.entries(rendered.headers ?? {})) {
    headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=UTF-8");
  }
  return headers;
};

const errorResponse = async (engine: OktaHttpEngine, error: unknown) => {
  const rendered = await engine.renderError(error);
  return new Response(JSON.stringify(rendered.body), {
    status: rendered.status,
    headers: responseHeaders(rendered, noStoreHeaders),
  });
};

const renderedErrorMessage = (rendered: OktaRenderedError) => {
  const description = rendered.body.error_description;
  if (typeof description === "string") return description;
  const summary = rendered.body.errorSummary;
  if (typeof summary === "string") return summary;
  return "The request could not be completed.";
};

const tokenResponse = (result: OktaTokenResult) => ({
  token_type: result.tokenType ?? "Bearer",
  expires_in: result.expiresIn,
  scope: result.scope,
  access_token: result.accessToken,
  ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
  ...(result.idToken ? { id_token: result.idToken } : {}),
});

const authorizationRedirect = (
  input: OktaAuthorizationRequest,
  code: string
): Response => {
  if (input.responseMode === "form_post") {
    const state = input.state
      ? `<input type="hidden" name="state" value="${escapeHtml(input.state)}">`
      : "";
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Continue</title></head><body><form id="response" method="post" action="${escapeHtml(input.redirectUri)}"><input type="hidden" name="code" value="${escapeHtml(code)}">${state}<noscript><button type="submit">Continue</button></noscript></form><script>document.getElementById("response").submit()</script></body></html>`,
      {
        status: 200,
        headers: { ...noStoreHeaders, "content-type": "text/html; charset=UTF-8" },
      }
    );
  }
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set("code", code);
  if (input.state) redirect.searchParams.set("state", input.state);
  return Response.redirect(redirect.toString(), 302);
};

export const renderOktaDeviceActivationPage = (
  input: { userCode?: string; username?: string },
  options: { action: string; error?: string; success?: boolean }
) => {
  const message = options.success
    ? '<div class="success" role="status">Device authorized. You may return to your device.</div>'
    : options.error
      ? `<div class="error" role="alert">${escapeHtml(options.error)}</div>`
      : "";
  const form = options.success
    ? ""
    : `<form method="post" action="${escapeHtml(options.action)}">
        <label for="user-code">Device code</label>
        <input id="user-code" name="user_code" type="text" autocomplete="one-time-code" required value="${escapeHtml(input.userCode ?? "")}">
        <label for="username">Username</label>
        <input id="username" name="username" type="email" autocomplete="username" required value="${escapeHtml(input.username ?? "")}">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Authorize device</button>
      </form>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Device activation · mockOS test environment</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #14231f; background: #eef2f0; }
      main { width: min(460px, 100%); padding: 40px; border: 1px solid #cdd5d1; border-radius: 16px; background: #fff; box-shadow: 0 18px 50px rgb(20 35 31 / 10%); }
      .brand { font-size: 21px; font-weight: 750; letter-spacing: -.04em; }
      .provider { margin: 28px 0 0; color: #2f6b5a; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      h1 { margin: 8px 0; font-size: 26px; }
      .hint { margin: 0 0 24px; color: #66736e; font-size: 14px; line-height: 1.5; }
      label { display: block; margin-top: 16px; font-size: 14px; }
      input { width: 100%; padding: 10px 2px; border: 0; border-bottom: 1px solid #87948f; font: inherit; }
      button { display: block; margin: 28px 0 0 auto; border: 0; border-radius: 7px; padding: 10px 24px; color: #fff; background: #2f6b5a; font: inherit; font-weight: 650; }
      .error, .success { margin-top: 18px; padding: 10px 12px; font-size: 14px; }
      .error { border-left: 3px solid #a53a3a; color: #7f2929; background: #fcf4f3; }
      .success { border-left: 3px solid #2f6b5a; color: #245547; background: #f2f7f5; }
      footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid #e4e8e6; color: #66736e; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand" aria-label="mockOS"><span aria-hidden="true">🥸</span> mockOS</div>
      <p class="provider">Okta simulation</p>
      <h1>Activate a device</h1>
      <p class="hint">Use a seeded mockOS identity. Never enter production credentials.</p>
      ${message}
      ${form}
      <footer>Test environment · Synthetic identities only</footer>
    </main>
  </body>
</html>`;
};

export const createOktaHttpApp = ({
  authorizationServerId = "default",
  engine,
  issuerHeader = "x-mockos-issuer-base",
  publicPathHeader = "x-mockos-public-path",
}: CreateOktaHttpAppOptions) => {
  const app = new Hono();

  const assertAuthorizationServer = (actual: string) => {
    if (actual !== authorizationServerId) {
      throw new OAuthProtocolError(
        "INVALID_REQUEST",
        "The requested authorization server was not found.",
        { status: 404 }
      );
    }
  };

  app.onError((error) => errorResponse(engine, error));

  app.get(
    "/oauth2/:authorizationServerId/.well-known/openid-configuration",
    async (context) => {
      assertAuthorizationServer(context.req.param("authorizationServerId"));
      const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
      return context.json(await engine.discovery(issuerBase), 200, noStoreHeaders);
    }
  );

  app.get("/oauth2/:authorizationServerId/v1/keys", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
    return context.json(await engine.jwks(issuerBase), 200, {
      "cache-control": "public, max-age=300",
    });
  });

  app.get("/oauth2/:authorizationServerId/v1/authorize", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    const input = authorizationFromParams(new URL(context.req.url).searchParams);
    await engine.validateAuthorizationRequest?.(input);
    return context.html(
      renderOktaLoginPage(input, {
        action: publicActionFromRequest(context.req.raw, publicPathHeader),
      }),
      200,
      noStoreHeaders
    );
  });

  app.post("/oauth2/:authorizationServerId/v1/authorize", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    const params = paramsFromForm(await context.req.formData());
    const input = authorizationFromParams(params);
    const username = required(optional(params.get("username")), "username");
    const password = required(optional(params.get("password")), "password");
    try {
      await engine.validateAuthorizationRequest?.(input);
      const result = await engine.authorize({ ...input, username, password });
      return authorizationRedirect(input, result.code);
    } catch (error) {
      const rendered = await engine.renderError(error);
      return context.html(
        renderOktaLoginPage(
          { ...input, loginHint: username },
          {
            action: publicActionFromRequest(context.req.raw, publicPathHeader),
            error: renderedErrorMessage(rendered),
          }
        ),
        rendered.status === 429 ? 429 : 400,
        noStoreHeaders
      );
    }
  });

  app.post("/oauth2/:authorizationServerId/v1/token", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    try {
      const form = await context.req.formData();
      const issuerBase = issuerFromRequest(context.req.raw, issuerHeader);
      const { clientId, clientSecret } = clientCredentials(form, context.req.raw);
      const grantType = required(formValue(form, "grant_type"), "grant_type");
      const result =
        grantType === "authorization_code"
          ? await engine.redeemAuthorizationCode({
              grantType,
              issuerBase,
              clientId,
              ...(clientSecret ? { clientSecret } : {}),
              code: required(formValue(form, "code"), "code"),
              redirectUri: required(formValue(form, "redirect_uri"), "redirect_uri"),
              codeVerifier: required(formValue(form, "code_verifier"), "code_verifier"),
            })
          : grantType === DEVICE_CODE_GRANT_TYPE
            ? await engine.pollDeviceAuthorization({
                grantType,
                issuerBase,
                clientId,
                deviceCode: required(formValue(form, "device_code"), "device_code"),
              })
            : (() => {
                throw new OAuthProtocolError("UNSUPPORTED_GRANT");
              })();
      return context.json(tokenResponse(result), 200, noStoreHeaders);
    } catch (error) {
      return errorResponse(engine, error);
    }
  });

  app.post("/oauth2/:authorizationServerId/v1/device/authorize", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    try {
      const form = await context.req.formData();
      const { clientId } = clientCredentials(form, context.req.raw);
      const result = await engine.createDeviceAuthorization({
        clientId,
        issuerBase: issuerFromRequest(context.req.raw, issuerHeader),
        scope: required(formValue(form, "scope"), "scope"),
      });
      return context.json(
        {
          device_code: result.deviceCode,
          user_code: result.userCode,
          verification_uri: result.verificationUri,
          verification_uri_complete: result.verificationUriComplete,
          expires_in: result.expiresIn,
          interval: result.interval,
        },
        200,
        noStoreHeaders
      );
    } catch (error) {
      return errorResponse(engine, error);
    }
  });

  app.get("/activate", (context) =>
    context.html(
      renderOktaDeviceActivationPage(
        { userCode: optional(context.req.query("user_code")) },
        { action: publicActionFromRequest(context.req.raw, publicPathHeader) }
      ),
      200,
      noStoreHeaders
    )
  );

  app.post("/activate", async (context) => {
    const form = await context.req.formData();
    const userCode = required(formValue(form, "user_code"), "user_code");
    const username = required(formValue(form, "username"), "username");
    const password = required(formValue(form, "password"), "password");
    const action = publicActionFromRequest(context.req.raw, publicPathHeader);
    try {
      await engine.activateDeviceAuthorization({
        userCode,
        username,
        password,
      });
      return context.html(
        renderOktaDeviceActivationPage(
          { userCode, username },
          { action, success: true }
        ),
        200,
        noStoreHeaders
      );
    } catch (error) {
      const rendered = await engine.renderError(error);
      return context.html(
        renderOktaDeviceActivationPage(
          { userCode, username },
          { action, error: renderedErrorMessage(rendered) }
        ),
        rendered.status === 429 ? 429 : 400,
        noStoreHeaders
      );
    }
  });

  app.post("/oauth2/:authorizationServerId/v1/introspect", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    try {
      const form = await context.req.formData();
      const { clientId, clientSecret } = clientCredentials(form, context.req.raw);
      const result = await engine.introspect({
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        issuerBase: issuerFromRequest(context.req.raw, issuerHeader),
        token: required(formValue(form, "token"), "token"),
        ...(formValue(form, "token_type_hint")
          ? { tokenTypeHint: formValue(form, "token_type_hint") }
          : {}),
      });
      return context.json(result, 200, noStoreHeaders);
    } catch (error) {
      return errorResponse(engine, error);
    }
  });

  app.post("/oauth2/:authorizationServerId/v1/revoke", async (context) => {
    assertAuthorizationServer(context.req.param("authorizationServerId"));
    try {
      const form = await context.req.formData();
      const { clientId, clientSecret } = clientCredentials(form, context.req.raw);
      await engine.revoke({
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        token: required(formValue(form, "token"), "token"),
        ...(formValue(form, "token_type_hint")
          ? { tokenTypeHint: formValue(form, "token_type_hint") }
          : {}),
      });
      return new Response(null, { status: 200, headers: noStoreHeaders });
    } catch (error) {
      return errorResponse(engine, error);
    }
  });

  app.notFound(() =>
    errorResponse(
      engine,
      new OAuthProtocolError(
        "INVALID_REQUEST",
        "The requested endpoint was not found.",
        { status: 404 }
      )
    )
  );

  return app;
};
