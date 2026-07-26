export const EXPECTED_OKTA_AUTH_JS_VERSION = "8.0.1";
export const SYNTHETIC_TOTP_PASS_CODE = "000000";

const requireCleanUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new Error(`${label} must be an absolute URL.`, { cause });
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["http:", "https:"].includes(parsed.protocol)
  ) {
    throw new Error(`${label} must be a clean HTTP(S) URL.`);
  }
  return parsed;
};

export const requireOwnedFactorVerifyUrl = ({
  authnEndpoint,
  href,
  origin,
  userId,
}) => {
  const ownedOrigin = requireCleanUrl(origin, "Owned Worker origin");
  if (ownedOrigin.pathname !== "/") {
    throw new Error("Owned Worker origin must not include a path.");
  }
  const authn = requireCleanUrl(authnEndpoint, "Okta Authn endpoint");
  if (authn.origin !== ownedOrigin.origin) {
    throw new Error("Okta Authn endpoint escaped the owned Worker authority.");
  }
  const target = requireCleanUrl(href, "Okta factor verification link");
  const expected = new URL(
    `${authn.pathname.replace(/\/$/, "")}/factors/${encodeURIComponent(
      `mfa_${userId}`
    )}/verify`,
    ownedOrigin
  );
  if (target.href !== expected.href) {
    throw new Error(
      "Okta factor verification link did not match the seeded user on the owned Authn endpoint."
    );
  }
  return target;
};

export const classicMfaOidcProviderSequence = ({
  authnPath,
  authorizationPath,
  discoveryPath,
  factorVerifyPath,
  jwksPath,
  revocationPath,
  tokenPath,
}) => [
  { source: "inbound", method: "POST", path: authnPath, status: 200 },
  { source: "inbound", method: "POST", path: factorVerifyPath, status: 200 },
  { source: "inbound", method: "GET", path: discoveryPath, status: 200 },
  { source: "inbound", method: "GET", path: authorizationPath, status: 302 },
  { source: "inbound", method: "POST", path: tokenPath, status: 200 },
  { source: "inbound", method: "GET", path: jwksPath, status: 200 },
  { source: "inbound", method: "POST", path: tokenPath, status: 200 },
  { source: "inbound", method: "POST", path: revocationPath, status: 200 },
  { source: "inbound", method: "POST", path: tokenPath, status: 400 },
];
