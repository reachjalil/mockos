import type { ProviderId, SemanticErrorCode } from "@mockos/contracts";
import {
  type Clock,
  createTenantId,
  type Rng,
  SeededRng,
  SystemClock,
  uuidFromRng,
} from "./determinism";
import { ApplicationRepository, GroupRepository, UserRepository } from "./directory";
import { type JwtPayload, SigningKeyService } from "./keys";
import { OAuthService } from "./oauth";
import { buildOidcDiscovery } from "./oidc";
import {
  getProviderProfile,
  type OidcDiscoveryDocument,
  type ProviderProfile,
  type RenderedProviderError,
} from "./providers";
import { applyMigrations, type SqlRow, type SqlStore } from "./store";

export interface EngineConfig {
  readonly provider: ProviderId;
  readonly seed: string;
  readonly tenantId?: string;
  readonly id?: string;
  readonly name?: string;
  readonly createdAt?: string;
  readonly idleTtlHours?: number;
  readonly requestLogLimit?: number;
}

export interface EngineDependencies {
  readonly store: SqlStore;
  readonly clock?: Clock;
  readonly rng?: Rng;
}

export interface IssueIdTokenInput {
  /** Request-derived final OIDC issuer. */
  readonly issuerBase: string;
  readonly clientId: string;
  readonly userId: string;
  readonly nonce?: string;
  readonly expiresInSeconds?: number;
  readonly groups?: readonly string[];
  readonly roles?: readonly string[];
  readonly additionalClaims?: Readonly<Record<string, unknown>>;
}

type MetaRow = SqlRow & { value: string };

const noIssuerInConfig = (config: EngineConfig): void => {
  const keys = Object.keys(config as unknown as Record<string, unknown>);
  if (keys.some((key) => /^(?:issuer|issuerBase|origin|baseUrl)$/i.test(key))) {
    throw new Error(
      "Issuer URLs are request-derived and must not be engine configuration."
    );
  }
};

/**
 * Runtime-independent identity engine. Construction is synchronous; initialize
 * once before serving requests so migrations and a persistent signing key exist.
 */
export class Engine {
  readonly config: Readonly<EngineConfig>;
  readonly tenantId: string;
  readonly providerId: ProviderId;
  readonly provider: ProviderProfile;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly users: UserRepository;
  readonly groups: GroupRepository;
  readonly applications: ApplicationRepository;
  readonly apps: ApplicationRepository;
  readonly keys: SigningKeyService;
  readonly oauth: OAuthService;
  readonly #store: SqlStore;
  #initialized: Promise<void> | undefined;

  private constructor(config: EngineConfig, dependencies: EngineDependencies) {
    noIssuerInConfig(config);
    if (!config.seed) throw new Error("Engine seed is required.");
    this.config = Object.freeze({ ...config });
    this.tenantId = config.tenantId ?? createTenantId(config.seed);
    this.providerId = config.provider;
    this.provider = getProviderProfile(config.provider);
    this.#store = dependencies.store;
    this.clock = dependencies.clock ?? new SystemClock();
    this.rng = dependencies.rng ?? new SeededRng(`mockos:engine:${config.seed}`);
    this.users = new UserRepository(this.#store, this.clock, this.rng);
    this.groups = new GroupRepository(this.#store, this.clock, this.rng);
    this.applications = new ApplicationRepository(this.#store, this.clock, this.rng);
    this.apps = this.applications;
    this.keys = new SigningKeyService(this.#store, this.clock, this.rng);
    this.oauth = new OAuthService({
      store: this.#store,
      clock: this.clock,
      rng: this.rng,
      tenantId: this.tenantId,
      profile: this.provider,
      applications: this.applications,
      users: this.users,
      groups: this.groups,
      keys: this.keys,
    });
  }

  static create(config: EngineConfig, dependencies: EngineDependencies): Engine {
    return new Engine(config, dependencies);
  }

  initialize(): Promise<void> {
    this.#initialized ??= this.#initialize();
    return this.#initialized;
  }

  async #initialize(): Promise<void> {
    applyMigrations(this.#store);
    this.#bindMetadata("provider", this.providerId);
    this.#bindMetadata("tenant_id", this.tenantId);
    this.#bindMetadata("seed", this.config.seed);
    await this.keys.initialize();
  }

  #bindMetadata(key: string, value: string): void {
    this.#store.run(
      "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
      key,
      value
    );
    const persisted = this.#store.get<MetaRow>(
      "SELECT value FROM meta WHERE key = ?",
      key
    )?.value;
    if (persisted !== value) {
      throw new Error(
        `Engine database is bound to a different ${key.replaceAll("_", " ")}.`
      );
    }
  }

  issuer(finalIssuer: string): string {
    return this.provider.urls.issuer({
      issuerBase: finalIssuer,
      tenantId: this.tenantId,
    });
  }

  discovery(finalIssuer: string): OidcDiscoveryDocument {
    return buildOidcDiscovery(this.provider, {
      issuerBase: finalIssuer,
      tenantId: this.tenantId,
    });
  }

  async jwks() {
    return this.keys.getJwks();
  }

  async issueIdToken(input: IssueIdTokenInput): Promise<string> {
    const application = this.applications.requireByClientId(input.clientId);
    const user = this.users.requireById(input.userId);
    if (!user.accountEnabled || user.softDeletedAt) {
      throw new Error("Cannot mint an ID token for a disabled user.");
    }
    const issuedAt = Math.floor(this.clock.now().getTime() / 1_000);
    const expiresAt =
      issuedAt +
      (input.expiresInSeconds ?? this.provider.tokenPolicy.idTokenLifetimeSeconds);
    const groups =
      input.groups ?? this.groups.listForUser(user.id).map((group) => group.id);
    const claims = this.provider.claims({
      issuer: this.issuer(input.issuerBase),
      tenantId: this.tenantId,
      clientId: application.clientId,
      user,
      issuedAt,
      expiresAt,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      groups,
      ...(input.roles ? { roles: input.roles } : {}),
    });
    return this.keys.sign({
      ...claims,
      ...input.additionalClaims,
      token_use: "id",
    });
  }

  async verifyToken(
    token: string,
    options: {
      readonly issuer?: string;
      readonly audience?: string;
      readonly clockToleranceSeconds?: number;
    } = {}
  ): Promise<JwtPayload> {
    return this.keys.verify(token, {
      clock: this.clock,
      ...options,
    });
  }

  renderError(code: SemanticErrorCode, detail?: string): RenderedProviderError {
    const timestamp = this.clock.now().toISOString();
    return this.provider.errors.render(code, {
      correlationId: uuidFromRng(this.rng),
      traceId: uuidFromRng(this.rng),
      timestamp,
      ...(detail ? { detail } : {}),
    });
  }
}

export const createEngine = (
  config: EngineConfig,
  dependencies: EngineDependencies
): Engine => Engine.create(config, dependencies);
