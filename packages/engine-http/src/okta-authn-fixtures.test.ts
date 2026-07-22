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
  it("executes every implemented primary-authentication fixture", async () => {
    const directory = fileURLToPath(
      new URL("../../testkit/fixtures/okta/authn", import.meta.url)
    );
    const fixtures = await loadFixtures(
      (await readdir(directory))
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(directory, file))
    );
    expect(fixtures).toHaveLength(5);
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
        const headers = new Headers(fixture.request.headers);
        const response = await app.request(
          `https://fixture.mockos.test${fixture.request.path}`,
          {
            method: fixture.request.method,
            headers,
            ...(fixture.request.body === undefined
              ? {}
              : { body: JSON.stringify(fixture.request.body) }),
          }
        );
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
