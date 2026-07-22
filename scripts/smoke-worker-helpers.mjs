const decodeJwtPart = (value) =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

export const jwtParts = (token) => {
  if (typeof token !== "string") throw new Error("Expected a JWT string.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Expected a compact JWT with three non-empty parts.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    encodedHeader,
    encodedPayload,
    encodedSignature,
    header: decodeJwtPart(encodedHeader),
    claims: decodeJwtPart(encodedPayload),
  };
};

export const verifyJwtSignature = async (token, jwks) => {
  const { encodedHeader, encodedPayload, encodedSignature, header } = jwtParts(token);
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(encodedSignature, "base64url"),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
};

export const requireTrustedGroupFallback = ({ claims, graphBaseUrl, userId }) => {
  if (Object.hasOwn(claims, "groups")) {
    throw new Error("The overage token unexpectedly retained inline groups.");
  }
  if (claims._claim_names?.groups !== "src1") {
    throw new Error("The overage token did not select the groups claim source.");
  }
  const actual = claims._claim_sources?.src1?.endpoint;
  const expected = `${graphBaseUrl.replace(/\/+$/, "")}/users/${encodeURIComponent(
    userId
  )}/getMemberObjects`;
  if (actual !== expected) {
    throw new Error(
      "The overage claim source was not the trusted environment endpoint."
    );
  }
  return actual;
};

export const requireNoSecretLeak = (value, secrets, label) => {
  for (const secret of secrets) {
    if (typeof secret !== "string" || !secret) {
      throw new Error(`Expected every ${label} sentinel to be a non-empty string.`);
    }
    if (value.includes(secret)) {
      throw new Error(`${label} exposed a synthetic secret sentinel.`);
    }
  }
};
