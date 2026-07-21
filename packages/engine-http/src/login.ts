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

const favicon =
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#14231f"/>
  <circle cx="9.5" cy="11.5" r="5.5" fill="none" stroke="#f7f5ef" stroke-width="2.5"/>
  <circle cx="22.5" cy="11.5" r="5.5" fill="none" stroke="#f7f5ef" stroke-width="2.5"/>
  <path d="M15 11.5h2" fill="none" stroke="#f7f5ef" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M16 22c-3-2.5-7-3-10-1 2 4.5 6.5 5.5 10 3 3.5 2.5 8 1.5 10-3-3-2-7-1.5-10 1Z" fill="#f7f5ef"/>
</svg>`);

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
    <meta name="robots" content="noindex,nofollow">
    <link rel="icon" href="data:image/svg+xml,${favicon}">
    <title>Sign in · mockOS test environment</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system,
        BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #14231f;
        background: #eef2f0; padding: 24px; }
      main { width: min(460px, 100%); background: #fff; padding: 40px; border: 1px solid #cdd5d1;
        border-radius: 16px; box-shadow: 0 18px 50px rgb(20 35 31 / 10%); }
      .brand { display: flex; align-items: center; gap: 12px; }
      .brand svg { width: 40px; height: 40px; flex: 0 0 auto; }
      .wordmark { font-size: 21px; font-weight: 750; letter-spacing: -.04em; }
      .environment { margin-left: auto; border: 1px solid #b8cbc4; border-radius: 999px;
        color: #2f6b5a; background: #f2f7f5; padding: 5px 9px; font-size: 10px;
        font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
      .provider { margin: 30px 0 0; color: #2f6b5a; font-size: 12px; font-weight: 700;
        letter-spacing: .06em; text-transform: uppercase; }
      h1 { font-size: 26px; font-weight: 700; letter-spacing: -.025em; margin: 8px 0; }
      .hint { margin: 0 0 24px; color: #66736e; font-size: 14px; line-height: 1.5; }
      label { display: block; margin-top: 16px; font-size: 14px; }
      input[type="email"], input[type="text"], input[type="password"] { width: 100%; border: 0;
        border-bottom: 1px solid #87948f; padding: 10px 2px; font: inherit; outline: none; }
      input:focus { border-bottom: 2px solid #2f6b5a; }
      button { display: block; margin: 28px 0 0 auto; border: 0; border-radius: 7px; color: #fff;
        background: #2f6b5a; padding: 10px 28px; font: inherit; font-weight: 650; cursor: pointer; }
      button:hover { background: #245547; }
      button:focus-visible { outline: 3px solid #2f6b5a; outline-offset: 3px; }
      .error { margin-top: 18px; border-left: 3px solid #a53a3a; color: #7f2929;
        background: #fcf4f3; padding: 10px 12px; font-size: 14px; }
      footer { margin-top: 32px; padding-top: 18px; border-top: 1px solid #e4e8e6;
        color: #66736e; font-size: 12px; }
      @media (max-width: 520px) {
        body { padding: 0; background: #fff; }
        main { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; padding: 32px 24px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand" aria-label="mockOS">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#14231f"></rect>
          <circle cx="9.5" cy="11.5" r="5.5" fill="none" stroke="#f7f5ef" stroke-width="2.5"></circle>
          <circle cx="22.5" cy="11.5" r="5.5" fill="none" stroke="#f7f5ef" stroke-width="2.5"></circle>
          <path d="M15 11.5h2" fill="none" stroke="#f7f5ef" stroke-width="2.5" stroke-linecap="round"></path>
          <path d="M16 22c-3-2.5-7-3-10-1 2 4.5 6.5 5.5 10 3 3.5 2.5 8 1.5 10-3-3-2-7-1.5-10 1Z" fill="#f7f5ef"></path>
        </svg>
        <span class="wordmark">mockOS</span>
        <span class="environment">Test environment</span>
      </div>
      <p class="provider">Microsoft Entra ID simulation</p>
      <h1>Sign in</h1>
      <p class="hint">Use a seeded mockOS identity. Never enter production credentials.</p>
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
      <footer><span aria-hidden="true">🥸</span> mockOS · Synthetic identities only</footer>
    </main>
  </body>
</html>`;
};
