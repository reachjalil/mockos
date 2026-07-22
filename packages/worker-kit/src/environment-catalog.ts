import { DurableObject } from "cloudflare:workers";
import {
  type EnvironmentConfig,
  environmentConfigSchema,
  environmentIdSchema,
} from "@mockos/contracts";

const ENVIRONMENT_PREFIX = "environment:";

type CatalogState = "active" | "deleting" | "reserved";

type CatalogRecord = {
  environment: EnvironmentConfig;
  state: CatalogState;
};

const keyFor = (environmentId: string) =>
  `${ENVIRONMENT_PREFIX}${environmentIdSchema.parse(environmentId)}`;

const parseRecord = (value: unknown): CatalogRecord => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid environment catalog record.");
  }
  const state = Reflect.get(value, "state");
  if (state !== "active" && state !== "deleting" && state !== "reserved") {
    throw new Error("Invalid environment catalog state.");
  }
  return {
    environment: environmentConfigSchema.parse(Reflect.get(value, "environment")),
    state,
  };
};

/**
 * Strongly consistent account-level index for Environment Durable Objects.
 *
 * One catalog instance is addressed by account id. The environment itself
 * remains the source of identity and protocol state; this object only owns
 * lifecycle discovery and ownership checks.
 */
export class EnvironmentCatalogDurableObject extends DurableObject {
  async reserveEnvironment(input: EnvironmentConfig): Promise<boolean> {
    const environment = environmentConfigSchema.parse(input);
    const key = keyFor(environment.id);
    return this.ctx.storage.transaction(async (transaction) => {
      if ((await transaction.get(key)) !== undefined) return false;
      await transaction.put(key, {
        environment,
        state: "reserved",
      } satisfies CatalogRecord);
      return true;
    });
  }

  async activateEnvironment(environmentId: string): Promise<EnvironmentConfig> {
    const key = keyFor(environmentId);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored === undefined) {
        throw new Error(`Environment '${environmentId}' is not reserved.`);
      }
      const record = parseRecord(stored);
      if (record.state === "deleting") {
        throw new Error(`Environment '${environmentId}' is being deleted.`);
      }
      if (record.state === "active") return record.environment;
      const active = { ...record, state: "active" } satisfies CatalogRecord;
      await transaction.put(key, active);
      return active.environment;
    });
  }

  async registerEnvironment(input: EnvironmentConfig): Promise<EnvironmentConfig> {
    const environment = environmentConfigSchema.parse(input);
    const key = keyFor(environment.id);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored !== undefined) {
        const record = parseRecord(stored);
        if (record.state !== "active") {
          throw new Error(
            `Environment '${environment.id}' cannot be registered while ${record.state}.`
          );
        }
      }
      await transaction.put(key, {
        environment,
        state: "active",
      } satisfies CatalogRecord);
      return environment;
    });
  }

  async getEnvironment(environmentId: string): Promise<EnvironmentConfig | undefined> {
    const stored = await this.ctx.storage.get(keyFor(environmentId));
    if (stored === undefined) return undefined;
    const record = parseRecord(stored);
    return record.state === "active" ? record.environment : undefined;
  }

  async listEnvironments(): Promise<EnvironmentConfig[]> {
    const stored = await this.ctx.storage.list({ prefix: ENVIRONMENT_PREFIX });
    return [...stored.values()]
      .map(parseRecord)
      .filter((record) => record.state === "active")
      .map((record) => record.environment)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async beginDeleteEnvironment(
    environmentId: string
  ): Promise<EnvironmentConfig | undefined> {
    const key = keyFor(environmentId);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored === undefined) return undefined;
      const record = parseRecord(stored);
      await transaction.put(key, {
        ...record,
        state: "deleting",
      } satisfies CatalogRecord);
      return record.environment;
    });
  }

  async restoreEnvironment(input: EnvironmentConfig): Promise<EnvironmentConfig> {
    const environment = environmentConfigSchema.parse(input);
    const key = keyFor(environment.id);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored === undefined) return environment;
      const record = parseRecord(stored);
      if (record.state === "reserved") {
        throw new Error(`Environment '${environment.id}' is still reserved.`);
      }
      if (record.state === "active") return record.environment;
      await transaction.put(key, {
        environment,
        state: "active",
      } satisfies CatalogRecord);
      return environment;
    });
  }

  async cancelEnvironmentReservation(environmentId: string): Promise<void> {
    const key = keyFor(environmentId);
    await this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored === undefined) return;
      if (parseRecord(stored).state !== "reserved") {
        throw new Error(`Environment '${environmentId}' is not reserved.`);
      }
      await transaction.delete(key);
    });
  }

  async completeDeleteEnvironment(environmentId: string): Promise<void> {
    const key = keyFor(environmentId);
    await this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get(key);
      if (stored === undefined) return;
      if (parseRecord(stored).state !== "deleting") {
        throw new Error(`Environment '${environmentId}' is not being deleted.`);
      }
      await transaction.delete(key);
    });
  }

  override fetch(): Response {
    return new Response("Not found.", { status: 404 });
  }
}
