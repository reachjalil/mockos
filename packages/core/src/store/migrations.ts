import type { SqlRow, SqlStore } from "./sql-store";

export interface SqlMigration {
  readonly version: number;
  readonly statements: readonly string[];
}

const migrationV1 = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    user_name TEXT NOT NULL,
    normalized_user_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    given_name TEXT,
    family_name TEXT,
    account_enabled INTEGER NOT NULL DEFAULT 1,
    password_hash TEXT NOT NULL,
    password_state TEXT NOT NULL DEFAULT 'valid',
    mfa_state TEXT NOT NULL DEFAULT 'none',
    provider_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    soft_deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS users_external_id_idx ON users(external_id)`,
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    display_name TEXT NOT NULL,
    normalized_display_name TEXT NOT NULL,
    provider_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    soft_deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS groups_name_idx ON groups(normalized_display_name)`,
  `CREATE INDEX IF NOT EXISTS groups_external_id_idx ON groups(external_id)`,
  `CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client_id TEXT NOT NULL UNIQUE,
    secret_hash TEXT,
    redirect_uris TEXT NOT NULL,
    grant_types TEXT NOT NULL,
    app_roles TEXT NOT NULL DEFAULT '[]',
    group_claims_mode TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS role_assignments (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role_value TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS role_assignments_principal_idx
    ON role_assignments(principal_type, principal_id)`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    nonce TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    redeemed_at TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS oauth_codes_expiry_idx ON oauth_codes(expires_at)`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    revoked_at TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx
    ON refresh_tokens(family_id)`,
  `CREATE TABLE IF NOT EXISTS device_codes (
    code_hash TEXT PRIMARY KEY,
    user_code TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    user_id TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_polled_at TEXT
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS signing_keys (
    kid TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    public_jwk TEXT NOT NULL,
    private_jwk TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retired_at TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS signing_keys_status_idx ON signing_keys(status)`,
  `CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    injection_point TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS authn_transactions (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    user_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS request_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,
    provider TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_headers TEXT NOT NULL,
    request_body TEXT,
    response_status INTEGER NOT NULL,
    response_headers TEXT NOT NULL,
    response_body TEXT,
    duration_ms INTEGER NOT NULL,
    correlation_id TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS request_log_timestamp_idx ON request_log(timestamp)`,
  `CREATE TABLE IF NOT EXISTS provisioning_runs (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS provisioning_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES provisioning_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    operation_json TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  )`,
] as const;

const migrationV2 = [
  `CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    jti TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS oauth_access_tokens_expiry_idx
    ON oauth_access_tokens(expires_at)`,
  `ALTER TABLE device_codes
    ADD COLUMN interval_seconds INTEGER NOT NULL DEFAULT 5`,
  `ALTER TABLE device_codes
    ADD COLUMN current_interval_seconds INTEGER NOT NULL DEFAULT 5`,
  `ALTER TABLE device_codes ADD COLUMN consumed_at TEXT`,
] as const;

const migrationV3 = [
  `ALTER TABLE scenarios
    ADD COLUMN evaluations INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE scenarios ADD COLUMN remaining INTEGER`,
  `CREATE INDEX IF NOT EXISTS scenarios_decision_idx
    ON scenarios(enabled, injection_point, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS request_log_filters_idx
    ON request_log(source, provider, method, response_status, sequence DESC)`,
] as const;

const migrationV4 = [
  `ALTER TABLE users
    ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE users
    ADD COLUMN resource_version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE users
    ADD COLUMN scim_json TEXT NOT NULL DEFAULT '{}'`,
  `UPDATE users SET lifecycle_state = CASE
    WHEN soft_deleted_at IS NOT NULL THEN 'deleted'
    WHEN account_enabled = 1 THEN 'active'
    ELSE 'disabled'
  END`,
  `ALTER TABLE groups
    ADD COLUMN resource_version INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE groups
    ADD COLUMN scim_json TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE refresh_tokens ADD COLUMN auth_time INTEGER`,
  `ALTER TABLE refresh_tokens
    ADD COLUMN generation INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE refresh_tokens ADD COLUMN parent_token_hash TEXT`,
  `ALTER TABLE refresh_tokens ADD COLUMN replaced_by_hash TEXT`,
  `UPDATE refresh_tokens
    SET auth_time = CAST(strftime('%s', issued_at) AS INTEGER)
    WHERE auth_time IS NULL`,
  `ALTER TABLE oauth_access_tokens ADD COLUMN family_id TEXT`,
  `CREATE INDEX IF NOT EXISTS users_lifecycle_idx
    ON users(lifecycle_state, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS users_scim_filter_idx
    ON users(normalized_user_name, external_id, lifecycle_state)`,
  `CREATE INDEX IF NOT EXISTS groups_scim_filter_idx
    ON groups(normalized_display_name, external_id, soft_deleted_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_access_tokens_family_idx
    ON oauth_access_tokens(family_id)`,
] as const;

const migrationV5 = [
  `ALTER TABLE provisioning_runs ADD COLUMN target_ref TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS provisioning_runs_active_target_idx
    ON provisioning_runs(application_id, target_ref)
    WHERE target_ref IS NOT NULL AND status IN ('queued', 'running')`,
  `CREATE TABLE IF NOT EXISTS provisioning_targets (
    target_ref TEXT PRIMARY KEY,
    target_json TEXT NOT NULL,
    credential_ref TEXT,
    credential_secret TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS provisioning_run_targets (
    run_id TEXT PRIMARY KEY,
    target_ref TEXT NOT NULL,
    target_json TEXT NOT NULL,
    credential_ref TEXT,
    credential_secret TEXT,
    created_at TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS provisioning_run_targets_ref_idx
    ON provisioning_run_targets(target_ref)`,
  `CREATE TABLE IF NOT EXISTS provisioning_watermarks (
    application_id TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    watermark_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (application_id, target_ref)
  ) WITHOUT ROWID`,
] as const;

const migrationV6 = [
  `CREATE TABLE IF NOT EXISTS mock_mcp_servers (
    slug TEXT PRIMARY KEY,
    revision INTEGER NOT NULL
      CHECK (revision >= 1 AND revision <= 9007199254740991),
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS mock_mcp_servers_updated_idx
    ON mock_mcp_servers(updated_at DESC, slug)`,
  `CREATE TABLE IF NOT EXISTS mock_mcp_revision_allocator (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_revision INTEGER NOT NULL
      CHECK (last_revision >= 0 AND last_revision <= 9007199254740991)
  ) WITHOUT ROWID`,
  `INSERT OR IGNORE INTO mock_mcp_revision_allocator (singleton, last_revision)
    VALUES (1, 0)`,
  `UPDATE mock_mcp_revision_allocator
    SET last_revision = COALESCE(
      (SELECT MAX(revision) FROM mock_mcp_servers),
      0
    )
    WHERE singleton = 1
      AND last_revision < COALESCE(
        (SELECT MAX(revision) FROM mock_mcp_servers),
        0
      )`,
  `CREATE TABLE IF NOT EXISTS mock_state (
    server_slug TEXT NOT NULL
      REFERENCES mock_mcp_servers(slug) ON DELETE CASCADE,
    server_revision INTEGER NOT NULL
      CHECK (server_revision >= 1 AND server_revision <= 9007199254740991),
    state_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (server_slug, server_revision, state_key)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS mock_mcp_sessions (
    session_hash TEXT PRIMARY KEY,
    server_slug TEXT NOT NULL
      REFERENCES mock_mcp_servers(slug) ON DELETE CASCADE,
    server_revision INTEGER NOT NULL
      CHECK (server_revision >= 1 AND server_revision <= 9007199254740991),
    protocol_version TEXT NOT NULL,
    initialized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    terminated_at TEXT
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS mock_mcp_sessions_server_idx
    ON mock_mcp_sessions(server_slug, server_revision, expires_at)`,
  `CREATE INDEX IF NOT EXISTS mock_mcp_sessions_expiry_idx
    ON mock_mcp_sessions(expires_at)`,
  `ALTER TABLE request_log ADD COLUMN protocol TEXT`,
  `ALTER TABLE request_log ADD COLUMN mcp_method TEXT`,
  `ALTER TABLE request_log ADD COLUMN mcp_tool TEXT`,
  `ALTER TABLE request_log ADD COLUMN mcp_arguments_json TEXT`,
  `ALTER TABLE request_log ADD COLUMN mcp_error_code INTEGER`,
  `ALTER TABLE request_log ADD COLUMN mcp_tool_is_error INTEGER`,
] as const;

const migrationV7 = [
  `CREATE TABLE IF NOT EXISTS mock_llm_servers (
    slug TEXT PRIMARY KEY,
    revision INTEGER NOT NULL
      CHECK (revision >= 1 AND revision <= 9007199254740991),
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS mock_llm_servers_updated_idx
    ON mock_llm_servers(updated_at DESC, slug)`,
  `CREATE TABLE IF NOT EXISTS mock_llm_revision_allocator (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_revision INTEGER NOT NULL
      CHECK (last_revision >= 0 AND last_revision <= 9007199254740991)
  ) WITHOUT ROWID`,
  `INSERT OR IGNORE INTO mock_llm_revision_allocator (singleton, last_revision)
    VALUES (1, 0)`,
  `UPDATE mock_llm_revision_allocator
    SET last_revision = COALESCE(
      (SELECT MAX(revision) FROM mock_llm_servers),
      0
    )
    WHERE singleton = 1
      AND last_revision < COALESCE(
        (SELECT MAX(revision) FROM mock_llm_servers),
        0
      )`,
] as const;

const migrationV8 = [
  `ALTER TABLE request_log ADD COLUMN llm_dialect TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_operation TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_server_slug TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_server_revision INTEGER`,
  `ALTER TABLE request_log ADD COLUMN llm_model TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_stream INTEGER`,
  `ALTER TABLE request_log ADD COLUMN llm_turn_index INTEGER`,
  `ALTER TABLE request_log ADD COLUMN llm_outcome TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_response_id TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_input_tokens INTEGER`,
  `ALTER TABLE request_log ADD COLUMN llm_output_tokens INTEGER`,
  `ALTER TABLE request_log ADD COLUMN llm_stop_reason TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_tool_names_json TEXT`,
  `ALTER TABLE request_log ADD COLUMN llm_error_kind TEXT`,
  `CREATE TABLE IF NOT EXISTS request_log_llm_terminal (
    request_id TEXT PRIMARY KEY
      REFERENCES request_log(id) ON DELETE CASCADE,
    llm_outcome TEXT NOT NULL
      CHECK (llm_outcome IN (
        'completed', 'cancelled', 'deadline_exceeded', 'failed'
      )),
    response_status INTEGER NOT NULL
      CHECK (response_status >= 100 AND response_status <= 599),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
  ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS request_log_llm_filters_idx
    ON request_log(
      llm_dialect, llm_operation, llm_server_slug, llm_model, llm_stream,
      llm_turn_index, sequence DESC
    )`,
] as const;

export const CORE_MIGRATIONS: readonly SqlMigration[] = [
  { version: 1, statements: migrationV1 },
  { version: 2, statements: migrationV2 },
  { version: 3, statements: migrationV3 },
  { version: 4, statements: migrationV4 },
  { version: 5, statements: migrationV5 },
  { version: 6, statements: migrationV6 },
  { version: 7, statements: migrationV7 },
  { version: 8, statements: migrationV8 },
];

type UserVersionRow = SqlRow & { user_version: number };

const assertMigrationOrder = (migrations: readonly SqlMigration[]) => {
  let previous = 0;
  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.version) ||
      migration.version !== previous + 1
    ) {
      throw new Error("SQL migrations must have contiguous positive versions.");
    }
    previous = migration.version;
  }
};

export const getSchemaVersion = (store: SqlStore): number =>
  Number(store.get<UserVersionRow>("PRAGMA user_version")?.user_version ?? 0);

/** Applies every pending migration atomically, one version at a time. */
export const applyMigrations = (
  store: SqlStore,
  migrations: readonly SqlMigration[] = CORE_MIGRATIONS
): number => {
  assertMigrationOrder(migrations);
  const current = getSchemaVersion(store);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than supported version ${latest}.`
    );
  }

  let applied = current;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (migration.version !== applied + 1) {
      throw new Error(`Cannot apply migration ${migration.version} after ${applied}.`);
    }
    store.transaction(() => {
      for (const statement of migration.statements) store.run(statement);
      store.run(`PRAGMA user_version = ${migration.version}`);
    });
    applied = migration.version;
  }
  return applied;
};
