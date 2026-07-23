import { env } from "cloudflare:workers";
import {
  type ApplicationListPage,
  type ApplicationRegistration,
  type ScenarioListPage,
  type ScenarioSpec,
  scenarioSpecSchema,
} from "@mockos/contracts";
import { describe, expect, it } from "vitest";

type ManagementEnvironmentStub = {
  clearScenario(scenarioId?: string): Promise<{ cleared: number }>;
  configure(input: Record<string, unknown>): Promise<unknown>;
  createApplication(input: Record<string, unknown>): Promise<ApplicationRegistration>;
  listApplications(input: {
    limit: number;
    cursor?: string;
  }): Promise<ApplicationListPage>;
  listScenarios(input: { limit: number; cursor?: string }): Promise<ScenarioListPage>;
  purge(): Promise<void>;
  setScenario(input: ScenarioSpec): Promise<ScenarioSpec>;
};

const environment = (environmentId: string): ManagementEnvironmentStub => {
  const namespace = Reflect.get(env, "ENVIRONMENTS") as {
    get(id: DurableObjectId): ManagementEnvironmentStub;
    idFromName(name: string): DurableObjectId;
  };
  return namespace.get(namespace.idFromName(environmentId));
};

describe("management Durable Object reads", () => {
  it("pages applications without replaying secrets and manages scenario snapshots", async () => {
    const environmentId = "management-rpc-test-01";
    const target = environment(environmentId);
    await target.purge();
    try {
      await target.configure({
        id: environmentId,
        name: "Management RPC integration",
        provider: "entra",
        seed: "management-rpc-integration",
        tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
        createdAt: "2026-07-22T12:00:00.000Z",
        idleTtlHours: 168,
        requestLogLimit: 10_000,
      });

      const firstCreated = await target.createApplication({
        name: "Application A",
        clientId: "management-client-a",
        clientSecret: "display-once-secret-a",
        redirectUris: ["https://client.example/a/callback"],
        grantTypes: ["authorization_code"],
        appRoles: [],
        groupClaimsMode: "none",
      });
      const secondCreated = await target.createApplication({
        name: "Application B",
        clientId: "management-client-b",
        clientSecret: "display-once-secret-b",
        redirectUris: ["https://client.example/b/callback"],
        grantTypes: ["client_credentials"],
        appRoles: ["Reader"],
        groupClaimsMode: "security",
      });
      expect(firstCreated.clientSecret).toBe("display-once-secret-a");
      expect(secondCreated.clientSecret).toBe("display-once-secret-b");

      const firstApplications = await target.listApplications({ limit: 1 });
      expect(firstApplications.applications).toHaveLength(1);
      expect(firstApplications.nextCursor).toBeTypeOf("string");
      const secondApplications = await target.listApplications({
        limit: 1,
        cursor: firstApplications.nextCursor,
      });
      expect(secondApplications.applications).toHaveLength(1);
      expect(secondApplications.nextCursor).toBeUndefined();
      const serializedApplications = JSON.stringify([
        firstApplications,
        secondApplications,
      ]);
      expect(serializedApplications).not.toContain("clientSecret");
      expect(serializedApplications).not.toContain("secret_hash");
      expect(serializedApplications).not.toContain("display-once-secret-a");
      expect(serializedApplications).not.toContain("display-once-secret-b");

      const scenarioA = scenarioSpecSchema.parse({
        id: "scenario-a",
        injectionPoint: "oauth.token",
        action: { type: "error", code: "INVALID_GRANT" },
      });
      const scenarioB = scenarioSpecSchema.parse({
        id: "scenario-b",
        injectionPoint: "oauth.token",
        action: { type: "delay", milliseconds: 25 },
      });
      await target.setScenario(scenarioA);
      await target.setScenario(scenarioB);

      const firstScenarios = await target.listScenarios({ limit: 1 });
      expect(firstScenarios.scenarios.map(({ id }) => id)).toEqual(["scenario-a"]);
      expect(firstScenarios.nextCursor).toBeTypeOf("string");
      const secondScenarios = await target.listScenarios({
        limit: 1,
        cursor: firstScenarios.nextCursor,
      });
      expect(secondScenarios.scenarios.map(({ id }) => id)).toEqual(["scenario-b"]);

      await target.setScenario(
        scenarioSpecSchema.parse({
          ...scenarioA,
          action: { type: "delay", milliseconds: 10 },
          enabled: false,
        })
      );
      expect((await target.listScenarios({ limit: 25 })).scenarios[0]).toMatchObject({
        id: "scenario-a",
        enabled: false,
        action: { type: "delay", milliseconds: 10 },
      });
      await expect(target.clearScenario("scenario-a")).resolves.toEqual({ cleared: 1 });
      expect(
        (await target.listScenarios({ limit: 25 })).scenarios.map(({ id }) => id)
      ).toEqual(["scenario-b"]);
    } finally {
      await target.purge();
    }
  });
});
