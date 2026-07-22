import assert from "node:assert/strict";
import test from "node:test";
import {
  jwtParts,
  requireActiveWorkerVersion,
  requireNoSecretLeak,
  requireSingleActiveWorkerVersion,
  requireTrustedGroupFallback,
  resolveTaggedWorkerVersion,
  verifyJwtSignature,
} from "./smoke-worker-helpers.mjs";

const base64Url = (value) => Buffer.from(value).toString("base64url");

test("JWT helper verifies the selected kid and rejects a changed signature", async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", kid: "kid-test" }));
  const encodedPayload = base64Url(JSON.stringify({ sub: "usr_test" }));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const token = `${signingInput}.${base64Url(signature)}`;
  const jwks = { keys: [{ ...publicJwk, kid: "kid-test" }] };

  assert.equal(jwtParts(token).header.kid, "kid-test");
  assert.equal(await verifyJwtSignature(token, jwks), true);
  const changed = `${signingInput}.${base64Url(new Uint8Array(signature).fill(0))}`;
  assert.equal(await verifyJwtSignature(changed, jwks), false);
});

test("group fallback helper accepts only the exact same-environment endpoint", () => {
  const claims = {
    _claim_names: { groups: "src1" },
    _claim_sources: {
      src1: {
        endpoint:
          "https://mockos.test/e/env_test/graph/v1.0/users/usr_test/getMemberObjects",
      },
    },
  };
  assert.equal(
    requireTrustedGroupFallback({
      claims,
      graphBaseUrl: "https://mockos.test/e/env_test/graph/v1.0",
      userId: "usr_test",
    }),
    claims._claim_sources.src1.endpoint
  );
  assert.throws(
    () =>
      requireTrustedGroupFallback({
        claims: {
          ...claims,
          _claim_sources: {
            src1: { endpoint: "https://attacker.example/getMemberObjects" },
          },
        },
        graphBaseUrl: "https://mockos.test/e/env_test/graph/v1.0",
        userId: "usr_test",
      }),
    /trusted environment endpoint/
  );
});

test("redaction sentinel helper fails closed on a leaked secret", () => {
  requireNoSecretLeak('{"password":"[REDACTED]"}', ["SyntheticSecret"], "log");
  assert.throws(
    () => requireNoSecretLeak("SyntheticSecret", ["SyntheticSecret"], "log"),
    /exposed a synthetic secret sentinel/
  );
});

test("deployment evidence resolves one exact tag and requires 100% active traffic", () => {
  const versions = [
    { id: "version-old", annotations: { "workers/tag": "old" } },
    { id: "version-m6", annotations: { "workers/tag": "m6-run" } },
  ];
  assert.equal(resolveTaggedWorkerVersion(versions, "m6-run"), "version-m6");
  assert.throws(
    () =>
      resolveTaggedWorkerVersion(
        [...versions, { id: "duplicate", annotations: { "workers/tag": "m6-run" } }],
        "m6-run"
      ),
    /exactly one/
  );
  assert.equal(
    requireSingleActiveWorkerVersion({
      versions: [{ version_id: "version-old", percentage: 100 }],
    }),
    "version-old"
  );
  assert.equal(
    requireActiveWorkerVersion(
      { versions: [{ version_id: "version-m6", percentage: 100 }] },
      "version-m6"
    ),
    "version-m6"
  );
  assert.throws(
    () =>
      requireActiveWorkerVersion(
        { versions: [{ version_id: "version-m6", percentage: 90 }] },
        "version-m6"
      ),
    /100% traffic/
  );
  assert.throws(
    () =>
      requireSingleActiveWorkerVersion({
        versions: [
          { version_id: "version-old", percentage: 50 },
          { version_id: "version-m6", percentage: 50 },
        ],
      }),
    /exactly one/
  );
});
