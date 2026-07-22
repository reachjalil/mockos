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

export const requireServingWorkerVersion = (health, expectedVersionId) => {
  if (
    !health ||
    typeof health !== "object" ||
    Array.isArray(health) ||
    typeof expectedVersionId !== "string" ||
    !expectedVersionId ||
    health.workerVersionId !== expectedVersionId
  ) {
    throw new Error(
      `Expected the live Worker request to be served by version ${expectedVersionId}.`
    );
  }
  return expectedVersionId;
};

export const resolveTaggedWorkerVersion = (versions, tag) => {
  if (!Array.isArray(versions) || typeof tag !== "string" || !tag) {
    throw new Error("Worker version evidence requires a version list and tag.");
  }
  const matches = versions.filter(
    (version) => version?.annotations?.["workers/tag"] === tag
  );
  if (matches.length !== 1 || typeof matches[0]?.id !== "string") {
    throw new Error(`Expected exactly one Worker version tagged ${tag}.`);
  }
  return matches[0].id;
};

export const requireSingleActiveWorkerVersion = (deployment) => {
  const versions = deployment?.versions;
  const version = Array.isArray(versions) ? versions[0] : undefined;
  if (
    versions?.length !== 1 ||
    typeof version?.version_id !== "string" ||
    !version.version_id ||
    version.percentage !== 100
  ) {
    throw new Error("Expected exactly one Worker version to hold 100% traffic.");
  }
  return version.version_id;
};

export const requireActiveWorkerVersion = (deployment, expectedVersionId) => {
  if (requireSingleActiveWorkerVersion(deployment) !== expectedVersionId) {
    throw new Error(
      `Expected Worker version ${expectedVersionId} to hold exactly 100% traffic.`
    );
  }
  return expectedVersionId;
};
