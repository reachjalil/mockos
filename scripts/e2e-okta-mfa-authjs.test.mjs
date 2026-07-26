import assert from "node:assert/strict";
import test from "node:test";
import {
  classicMfaOidcProviderSequence,
  EXPECTED_OKTA_AUTH_JS_VERSION,
  requireOwnedFactorVerifyUrl,
  SYNTHETIC_TOTP_PASS_CODE,
} from "./e2e-okta-mfa-authjs-contract.mjs";

test("pins the official client and deterministic synthetic factor input", () => {
  assert.equal(EXPECTED_OKTA_AUTH_JS_VERSION, "8.0.1");
  assert.equal(SYNTHETIC_TOTP_PASS_CODE, "000000");
});

test("accepts only the exact returned factor path on the owned Worker", () => {
  const input = {
    authnEndpoint: "https://localhost:8796/e/env_test/api/v1/authn",
    href: "https://localhost:8796/e/env_test/api/v1/authn/factors/mfa_usr_test/verify",
    origin: "https://localhost:8796",
    userId: "usr_test",
  };
  assert.equal(requireOwnedFactorVerifyUrl(input).href, input.href);

  for (const href of [
    "https://attacker.invalid/e/env_test/api/v1/authn/factors/mfa_usr_test/verify",
    "https://localhost:8796/e/env_other/api/v1/authn/factors/mfa_usr_test/verify",
    "https://localhost:8796/e/env_test/api/v1/authn/factors/mfa_usr_other/verify",
    "https://localhost:8796/e/env_test/api/v1/authn/factors/mfa_usr_test/verify?next=https://attacker.invalid",
    "https://user:password@localhost:8796/e/env_test/api/v1/authn/factors/mfa_usr_test/verify",
  ]) {
    assert.throws(
      () => requireOwnedFactorVerifyUrl({ ...input, href }),
      /clean HTTP|owned Authn endpoint/
    );
  }
});

test("describes the complete exact provider sequence", () => {
  const sequence = classicMfaOidcProviderSequence({
    authnPath: "/e/env_test/api/v1/authn",
    authorizationPath: "/e/env_test/oauth2/default/v1/authorize",
    discoveryPath: "/e/env_test/oauth2/default/.well-known/openid-configuration",
    factorVerifyPath: "/e/env_test/api/v1/authn/factors/mfa_usr_test/verify",
    jwksPath: "/e/env_test/oauth2/default/v1/keys",
    revocationPath: "/e/env_test/oauth2/default/v1/revoke",
    tokenPath: "/e/env_test/oauth2/default/v1/token",
  });
  assert.equal(sequence.length, 9);
  assert.deepEqual(
    sequence.map(({ method, status }) => [method, status]),
    [
      ["POST", 200],
      ["POST", 200],
      ["GET", 200],
      ["GET", 302],
      ["POST", 200],
      ["GET", 200],
      ["POST", 200],
      ["POST", 200],
      ["POST", 400],
    ]
  );
});
