import type { EntraAuthorizationRequest } from "./types";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const hidden = (name: string, value: string | undefined) =>
  value === undefined
    ? ""
    : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

export const renderEntraLoginPage = (
  input: EntraAuthorizationRequest,
  options: { action: string; error?: string }
) => {
  const error = options.error
    ? `<div class="error" role="alert">${escapeHtml(options.error)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Sign in to your account</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", Arial, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #1b1b1b;
        background: linear-gradient(135deg, #f3f2f1 0%, #e6f2fb 52%, #f8edfa 100%); }
      main { width: min(440px, calc(100vw - 32px)); background: #fff; padding: 44px;
        box-shadow: 0 2px 8px rgb(0 0 0 / 14%); }
      .mark { display: grid; grid-template-columns: repeat(2, 11px); gap: 2px; width: 24px; }
      .mark span { height: 11px; background: #f25022; }
      .mark span:nth-child(2) { background: #7fba00; }
      .mark span:nth-child(3) { background: #00a4ef; }
      .mark span:nth-child(4) { background: #ffb900; }
      h1 { font-size: 24px; font-weight: 600; margin: 28px 0 8px; }
      .hint { margin: 0 0 24px; color: #605e5c; font-size: 14px; }
      label { display: block; margin-top: 16px; font-size: 14px; }
      input[type="email"], input[type="text"], input[type="password"] { width: 100%; border: 0;
        border-bottom: 1px solid #666; padding: 9px 2px; font: inherit; outline: none; }
      input:focus { border-bottom: 2px solid #0067b8; }
      button { display: block; margin: 28px 0 0 auto; border: 0; color: #fff; background: #0067b8;
        padding: 9px 28px; font: inherit; cursor: pointer; }
      button:hover { background: #005da6; }
      .error { margin-top: 18px; color: #a4262c; font-size: 14px; }
      footer { margin-top: 30px; color: #605e5c; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-label="Microsoft"><span></span><span></span><span></span><span></span></div>
      <h1>Sign in</h1>
      <p class="hint">Use a seeded mockOS identity. No credentials leave this environment.</p>
      ${error}
      <form method="post" action="${escapeHtml(options.action)}">
        ${hidden("client_id", input.clientId)}
        ${hidden("redirect_uri", input.redirectUri)}
        ${hidden("response_type", input.responseType)}
        ${hidden("response_mode", input.responseMode)}
        ${hidden("scope", input.scope)}
        ${hidden("state", input.state)}
        ${hidden("nonce", input.nonce)}
        ${hidden("code_challenge", input.codeChallenge)}
        ${hidden("code_challenge_method", input.codeChallengeMethod)}
        <label for="username">Email, phone, or Skype</label>
        <input id="username" name="username" type="email" autocomplete="username" required
          value="${escapeHtml(input.loginHint ?? "")}">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Sign in</button>
      </form>
      <footer>mockOS.live · Entra ID test environment</footer>
    </main>
  </body>
</html>`;
};
