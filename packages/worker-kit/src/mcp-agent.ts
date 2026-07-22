import type { EnvironmentConfig, ProviderId } from "@mockos/contracts";
import { createTenantId } from "@mockos/core";
import {
  type MockosToolDependencies,
  MockosToolError,
  registerMockosTools,
} from "@mockos/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { EnvironmentCatalogDurableObject } from "./environment-catalog";
import type { EnvironmentDurableObject } from "./environment-do";

export const SELF_HOSTED_ACCOUNT_ID = "self-hosted";

export type MockosMcpState = {
  currentEnvironmentId: string | null;
};

export type MockosMcpBindings = {
  BASE_DOMAIN?: string;
  ENTRA_HOST?: string;
  ENVIRONMENT_CATALOG: DurableObjectNamespace<EnvironmentCatalogDurableObject>;
  ENVIRONMENTS: DurableObjectNamespace<EnvironmentDurableObject>;
  HOSTING_MODE: string;
  PATH_PREFIX?: string;
  PUBLIC_ORIGIN: string;
  TID_INDEX?: KVNamespace;
};

const normalizePathPrefix = (value: string | undefined) => {
  const prefix = value?.trim() || "/e";
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/+$/, "");
};

const normalizedOrigin = (value: string) => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "PUBLIC_ORIGIN must be an origin without credentials or query data."
    );
  }
  return url.origin;
};

const publicLocation = (
  environment: EnvironmentConfig,
  bindings: MockosMcpBindings
) => {
  const origin = normalizedOrigin(bindings.PUBLIC_ORIGIN);
  if (bindings.HOSTING_MODE === "path") {
    const publicBase = `${origin}${normalizePathPrefix(bindings.PATH_PREFIX)}/${environment.id}`;
    return {
      publicBase,
      issuerBase:
        environment.provider === "entra"
          ? `${publicBase}/${environment.tenantId}/v2.0`
          : `${publicBase}/oauth2/default`,
    };
  }
  if (bindings.HOSTING_MODE !== "subdomain") {
    throw new Error("HOSTING_MODE must be path or subdomain.");
  }
  const baseDomain = bindings.BASE_DOMAIN?.trim().toLowerCase().replace(/\.$/, "");
  if (!baseDomain) throw new Error("BASE_DOMAIN is required in subdomain mode.");
  const protocol = new URL(origin).protocol;
  if (environment.provider === "entra") {
    const entraHost =
      bindings.ENTRA_HOST?.trim().toLowerCase().replace(/\.$/, "") ??
      `login.${baseDomain}`;
    const publicBase = `${protocol}//${entraHost}`;
    return {
      publicBase,
      issuerBase: `${publicBase}/${environment.tenantId}/v2.0`,
    };
  }
  const publicBase = `${protocol}//${environment.id}.${baseDomain}`;
  return { publicBase, issuerBase: `${publicBase}/oauth2/default` };
};

const newEnvironmentConfig = (
  input: { name: string; provider: ProviderId; seed: string },
  environmentId: string
): EnvironmentConfig => ({
  id: environmentId,
  name: input.name,
  provider: input.provider,
  seed: input.seed,
  tenantId: createTenantId(input.seed),
  createdAt: new Date().toISOString(),
  idleTtlHours: 24 * 7,
  requestLogLimit: 10_000,
});

const environmentId = () =>
  `env_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

const missingEnvironment = (environmentId: string) =>
  new MockosToolError({
    type: "https://mockos.live/problems/environment-not-found",
    title: "Environment not found",
    status: 404,
    detail: `Environment '${environmentId}' is not available to this account.`,
    code: "ENVIRONMENT_NOT_FOUND",
  });

/** Stateful, authenticated management MCP. Each transport session owns its cursor. */
export class MockosMcpAgent extends McpAgent<MockosMcpBindings, MockosMcpState> {
  server = new McpServer({ name: "mockOS", version: "0.1.0" });
  override initialState: MockosMcpState = { currentEnvironmentId: null };

  async init(): Promise<void> {
    registerMockosTools(this.server, this.#dependencies());
  }

  #catalog() {
    const id = this.env.ENVIRONMENT_CATALOG.idFromName(SELF_HOSTED_ACCOUNT_ID);
    return this.env.ENVIRONMENT_CATALOG.get(id);
  }

  #environment(environmentId: string) {
    return this.env.ENVIRONMENTS.get(this.env.ENVIRONMENTS.idFromName(environmentId));
  }

  async #requireEnvironment(environmentId: string) {
    const environment = await this.#catalog().getEnvironment(environmentId);
    if (!environment) throw missingEnvironment(environmentId);
    return environment;
  }

  #dependencies(): MockosToolDependencies {
    return {
      accountId: SELF_HOSTED_ACCOUNT_ID,
      createEnvironment: async (input) => {
        const catalog = this.#catalog();
        let config: EnvironmentConfig | undefined;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const candidate = newEnvironmentConfig(input, environmentId());
          if (await catalog.reserveEnvironment(candidate)) {
            config = candidate;
            break;
          }
        }
        if (!config) throw new Error("Could not allocate a unique environment id.");

        const environment = this.#environment(config.id);
        try {
          const configured = await environment.configure(config);
          if (this.env.TID_INDEX) {
            await this.env.TID_INDEX.put(`tid:${configured.tenantId}`, configured.id);
          }
          await catalog.activateEnvironment(config.id);
          return configured;
        } catch (error) {
          try {
            await environment.purge();
            if (this.env.TID_INDEX) {
              await this.env.TID_INDEX.delete(`tid:${config.tenantId}`);
            }
            await catalog.cancelEnvironmentReservation(config.id);
          } catch {
            // Preserve the original provisioning error.
          }
          throw error;
        }
      },
      listEnvironments: () => this.#catalog().listEnvironments(),
      deleteEnvironment: async (environmentId) => {
        const catalog = this.#catalog();
        const environment = await catalog.beginDeleteEnvironment(environmentId);
        if (!environment) return;
        let purged = false;
        try {
          await this.#environment(environmentId).purge();
          purged = true;
          if (this.env.TID_INDEX) {
            await this.env.TID_INDEX.delete(`tid:${environment.tenantId}`);
          }
          await catalog.completeDeleteEnvironment(environmentId);
        } catch (error) {
          if (!purged) await catalog.restoreEnvironment(environment);
          throw error;
        }
      },
      configureEnvironment: async (environmentId, patch) => {
        await this.#requireEnvironment(environmentId);
        const configured =
          await this.#environment(environmentId).updateConfiguration(patch);
        await this.#catalog().registerEnvironment(configured);
        return configured;
      },
      seedIdentities: async (environmentId, seed) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).seed(seed);
      },
      createApplication: async (environmentId, input) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).createApplication(input);
      },
      mintToken: async (environmentId, input) => {
        const config = await this.#requireEnvironment(environmentId);
        const { issuerBase } = publicLocation(config, this.env);
        return this.#environment(environmentId).mintToken(input, issuerBase);
      },
      setScenario: async (environmentId, scenario) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).setScenario(scenario);
      },
      clearScenario: async (environmentId, scenarioId) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).clearScenario(scenarioId);
      },
      getRequestLog: async (environmentId, query) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).getRequestLog(query);
      },
      assertRequests: async (environmentId, assertion) => {
        await this.#requireEnvironment(environmentId);
        return this.#environment(environmentId).assertRequests(assertion);
      },
      getWellKnownUrls: async (environmentId) => {
        const config = await this.#requireEnvironment(environmentId);
        const location = publicLocation(config, this.env);
        return this.#environment(environmentId).getWellKnownUrls(
          location.publicBase,
          location.issuerBase
        );
      },
      getCurrentEnvironmentId: async () => {
        const currentEnvironmentId = this.state.currentEnvironmentId;
        if (!currentEnvironmentId) return null;
        if (await this.#catalog().getEnvironment(currentEnvironmentId)) {
          return currentEnvironmentId;
        }
        this.setState({ currentEnvironmentId: null });
        return null;
      },
      setCurrentEnvironmentId: async (environmentId) => {
        if (environmentId) await this.#requireEnvironment(environmentId);
        this.setState({ currentEnvironmentId: environmentId });
      },
    };
  }
}
