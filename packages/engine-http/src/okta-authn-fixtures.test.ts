import { Engine, FixedClock, SeededRng } from "@mockos/core";
import {
  assertFixtureResults,
  loadFixtures,
  NodeSqlStore,
  runFixtures,
} from "@mockos/testkit";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOktaAuthnApi } from "./okta-authn";

describe("Okta Classic Authn conformance fixtures", () => {
  it("executes every implemented primary-authentication and factor fixture", async () => {
    const directory = fileURLToPath(
      new URL("../../testkit/fixtures/okta/authn", import.meta.url)
    );
    const fixtures = await loadFixtures(
      (await readdir(directory))
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(directory, file))
    );
    expect(fixtures).toHaveLength(7);
    expect(fixtures.every(({ area }) => area === "authn")).toBe(true);
    expect(fixtures.every(({ status }) => status === "implemented")).toBe(true);

    const store = new NodeSqlStore();
    try {
      const engine = Engine.create(
        { provider: "okta", seed: "okta-authn-fixtures" },
        {
          store,
          clock: new FixedClock("2026-07-22T12:00:00.000Z"),
          rng: new SeededRng("okta-authn-fixtures"),
        }
      );
      await engine.initialize();
      await engine.users.create({
        userName: "success.authn@example.test",
        displayName: "Success Authn",
        password: "SyntheticPassw0rd!",
      });
      await engine.users.create({
        userName: "mfa.authn@example.test",
        displayName: "MFA Authn",
        password: "SyntheticPassw0rd!",
        mfaState: "required",
      });
      await engine.users.create({
        userName: "expired.authn@example.test",
        displayName: "Expired Authn",
        password: "SyntheticPassw0rd!",
        passwordState: "expired",
      });
      await engine.users.create({
        userName: "locked.authn@example.test",
        displayName: "Locked Authn",
        password: "SyntheticPassw0rd!",
        lifecycleState: "suspended",
      });

      const app = createOktaAuthnApi({
        engine: engine.authn,
        requestId: () => "req_authn_fixture",
      });
      const results = await runFixtures(fixtures, async (fixture) => {
        let path = fixture.request.path;
        let body = fixture.request.body;
        if (path === "/api/v1/authn/factors/{factorId}/verify") {
          const primary = await app.request(
            "https://fixture.mockos.test/api/v1/authn",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                username: "mfa.authn@example.test",
                password: "SyntheticPassw0rd!",
              }),
            }
          );
          expect(primary.status).toBe(200);
          const transaction = (await primary.json()) as {
            stateToken?: unknown;
            _embedded?: {
              factor?: Array<{
                _links?: { verify?: { href?: unknown } };
              }>;
            };
          };
          const stateToken = transaction.stateToken;
          const verifyHref = transaction._embedded?.factor?.[0]?._links?.verify?.href;
          if (typeof stateToken !== "string" || typeof verifyHref !== "string") {
            throw new Error(
              "The MFA fixture prerequisite did not return a factor verification action."
            );
          }
          const verifyUrl = new URL(verifyHref);
          expect(verifyUrl.origin).toBe("https://fixture.mockos.test");
          path = verifyUrl.pathname;
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error("The factor fixture body must be an object.");
          }
          body = { ...body, stateToken };
        }
        const headers = new Headers(fixture.request.headers);
        const response = await app.request(`https://fixture.mockos.test${path}`, {
          method: fixture.request.method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          body: text ? (JSON.parse(text) as unknown) : undefined,
        };
      });
      expect(() => assertFixtureResults(results)).not.toThrow();
    } finally {
      store.close();
    }
  });
});
