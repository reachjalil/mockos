import {
  type ApplicationListPage,
  applicationListPageSchema,
  type ApplicationSummary,
  applicationSummarySchema,
  type ManagementListQuery,
  managementListQuerySchema,
} from "@mockos/contracts";
import { type Clock, type Rng, uuidFromRng } from "../determinism";
import { hashSecret, randomId, verifySecret } from "../security";
import {
  decodeManagementListCursor,
  encodeManagementListCursor,
} from "../store/management-list-cursor";
import type { SqlRow, SqlStore } from "../store";
import { idFromUuid, parseJson } from "./shared";

export type OAuthGrantType =
  | "authorization_code"
  | "refresh_token"
  | "client_credentials"
  | "urn:ietf:params:oauth:grant-type:device_code";

export type GroupClaimsMode = "none" | "security" | "all";

export interface ApplicationRecord {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly OAuthGrantType[];
  readonly appRoles: readonly string[];
  readonly groupClaimsMode: GroupClaimsMode;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateApplicationInput {
  readonly id?: string;
  readonly name: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes?: readonly OAuthGrantType[];
  readonly appRoles?: readonly string[];
  readonly groupClaimsMode?: GroupClaimsMode;
}

export interface CreatedApplication extends ApplicationRecord {
  /** Returned once. Only its SHA-256 hash is stored. */
  readonly clientSecret: string;
}

type ApplicationRow = SqlRow & {
  id: string;
  name: string;
  client_id: string;
  secret_hash: string | null;
  redirect_uris: string;
  grant_types: string;
  app_roles: string;
  group_claims_mode: string;
  created_at: string;
  updated_at: string;
};

const selectApplications = `SELECT id, name, client_id, secret_hash,
  redirect_uris, grant_types, app_roles, group_claims_mode, created_at, updated_at
  FROM applications`;

const toApplication = (row: ApplicationRow): ApplicationRecord => ({
  id: row.id,
  name: row.name,
  clientId: row.client_id,
  redirectUris: parseJson<string[]>(row.redirect_uris, []),
  grantTypes: parseJson<OAuthGrantType[]>(row.grant_types, []),
  appRoles: parseJson<string[]>(row.app_roles, []),
  groupClaimsMode: row.group_claims_mode as GroupClaimsMode,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toApplicationSummary = (row: ApplicationRow): ApplicationSummary => {
  const application = toApplication(row);
  return applicationSummarySchema.parse({
    id: application.id,
    name: application.name,
    clientId: application.clientId,
    redirectUris: [...application.redirectUris],
    grantTypes: [...application.grantTypes],
    appRoles: [...application.appRoles],
    groupClaimsMode: application.groupClaimsMode,
    createdAt: application.createdAt,
  });
};

const validateRedirectUris = (redirectUris: readonly string[]): string[] => {
  if (redirectUris.length === 0)
    throw new Error("At least one redirect URI is required.");
  for (const value of redirectUris) new URL(value);
  return [...new Set(redirectUris)];
};

export class ApplicationRepository {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;

  constructor(store: SqlStore, clock: Clock, rng: Rng) {
    this.#store = store;
    this.#clock = clock;
    this.#rng = rng;
  }

  async create(input: CreateApplicationInput): Promise<CreatedApplication> {
    const name = input.name.trim();
    if (!name) throw new Error("Application name is required.");
    const id = input.id ?? idFromUuid("app", uuidFromRng(this.#rng));
    const clientId = input.clientId ?? uuidFromRng(this.#rng);
    const clientSecret = input.clientSecret ?? randomId("mos", this.#rng);
    if (clientSecret.length < 8) throw new Error("Client secret is too short.");
    const redirectUris = validateRedirectUris(input.redirectUris);
    const grantTypes = [
      ...new Set(input.grantTypes ?? ["authorization_code", "refresh_token"]),
    ];
    const now = this.#clock.now().toISOString();
    this.#store.run(
      `INSERT INTO applications (
        id, name, client_id, secret_hash, redirect_uris, grant_types,
        app_roles, group_claims_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name,
      clientId,
      await hashSecret(clientSecret),
      JSON.stringify(redirectUris),
      JSON.stringify(grantTypes),
      JSON.stringify([...new Set(input.appRoles ?? [])]),
      input.groupClaimsMode ?? "none",
      now,
      now
    );
    const created = this.requireByClientId(clientId);
    return { ...created, clientSecret };
  }

  findById(id: string): ApplicationRecord | undefined {
    const row = this.#store.get<ApplicationRow>(
      `${selectApplications} WHERE id = ?`,
      id
    );
    return row ? toApplication(row) : undefined;
  }

  getById(id: string): ApplicationRecord | undefined {
    return this.findById(id);
  }

  findByClientId(clientId: string): ApplicationRecord | undefined {
    const row = this.#store.get<ApplicationRow>(
      `${selectApplications} WHERE client_id = ?`,
      clientId
    );
    return row ? toApplication(row) : undefined;
  }

  getByClientId(clientId: string): ApplicationRecord | undefined {
    return this.findByClientId(clientId);
  }

  requireByClientId(clientId: string): ApplicationRecord {
    const application = this.findByClientId(clientId);
    if (!application) throw new Error(`Unknown OAuth client: ${clientId}`);
    return application;
  }

  list(): ApplicationRecord[] {
    return this.#store
      .all<ApplicationRow>(`${selectApplications} ORDER BY created_at, id`)
      .map(toApplication);
  }

  listPage(input: ManagementListQuery): ApplicationListPage {
    const query = managementListQuerySchema.parse(input);
    const cursor = query.cursor
      ? decodeManagementListCursor("applications", query.cursor)
      : undefined;
    const rows = cursor
      ? this.#store.all<ApplicationRow>(
          `${selectApplications}
           WHERE created_at > ? OR (created_at = ? AND id > ?)
           ORDER BY created_at, id
           LIMIT ?`,
          cursor.createdAt,
          cursor.createdAt,
          cursor.id,
          query.limit + 1
        )
      : this.#store.all<ApplicationRow>(
          `${selectApplications} ORDER BY created_at, id LIMIT ?`,
          query.limit + 1
        );
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return applicationListPageSchema.parse({
      applications: pageRows.map(toApplicationSummary),
      ...(rows.length > query.limit && last
        ? {
            nextCursor: encodeManagementListCursor("applications", {
              createdAt: last.created_at,
              id: last.id,
            }),
          }
        : {}),
    });
  }

  async verifyClientSecret(clientId: string, clientSecret: string): Promise<boolean> {
    const row = this.#store.get<ApplicationRow>(
      `${selectApplications} WHERE client_id = ?`,
      clientId
    );
    return Boolean(
      row &&
        typeof row.secret_hash === "string" &&
        (await verifySecret(clientSecret, row.secret_hash))
    );
  }
}
