import type { Clock, Rng } from "../determinism";
import type { ApplicationRepository, UserRepository } from "../directory";
import type { ProviderProfile } from "../providers";
import { hashSecret, randomId } from "../security";
import type { SqlRow, SqlStore } from "../store";

export const DEVICE_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code" as const;

export type DeviceAuthorizationErrorCode =
  | "access_denied"
  | "authorization_pending"
  | "expired_token"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "slow_down"
  | "unsupported_grant_type";

const deviceErrorDescription: Record<DeviceAuthorizationErrorCode, string> = {
  access_denied: "The end user denied the authorization request.",
  authorization_pending: "The device authorization is pending. Please try again later.",
  expired_token: "The device code has expired.",
  invalid_client: "The client is invalid.",
  invalid_grant: "The device code is invalid or has already been used.",
  invalid_scope: "The requested scope is invalid.",
  slow_down: "You are polling too quickly. Slow down your requests.",
  unsupported_grant_type:
    "The client is not registered for the device authorization grant.",
};

export class DeviceAuthorizationError extends Error {
  readonly error: DeviceAuthorizationErrorCode;
  readonly oauthError: DeviceAuthorizationErrorCode;
  readonly errorDescription: string;
  readonly status = 400;

  constructor(error: DeviceAuthorizationErrorCode, description?: string) {
    const errorDescription = description ?? deviceErrorDescription[error];
    super(errorDescription);
    this.name = "DeviceAuthorizationError";
    this.error = error;
    this.oauthError = error;
    this.errorDescription = errorDescription;
  }

  toBody(): Readonly<Record<string, string>> {
    return { error: this.error, error_description: this.errorDescription };
  }
}

export interface CreateDeviceAuthorizationInput {
  readonly clientId: string;
  readonly scope: string;
  /** Request-derived final OIDC issuer. */
  readonly issuerBase: string;
  /** Trusted request-derived provider directory base. */
  readonly directoryBaseUrl: string;
}

export interface CreatedDeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export interface PollDeviceAuthorizationInput {
  readonly clientId: string;
  readonly deviceCode: string;
}

export interface DeviceAuthorizationGrant {
  readonly clientId: string;
  readonly userId: string;
  readonly scope: string;
}

export interface PreparedDeviceAuthorizationGrant extends DeviceAuthorizationGrant {
  /** Hashed lookup key; the raw device code is never persisted. */
  readonly codeHash: string;
}

export type DeviceAuthorizationCommitOutcome = "success" | "expired" | "invalid";

type DeviceCodeRow = SqlRow & {
  code_hash: string;
  user_code: string;
  client_id: string;
  scope: string;
  status: string;
  user_id: string | null;
  issued_at: string;
  expires_at: string;
  last_polled_at: string | null;
  interval_seconds: number;
  current_interval_seconds: number;
  consumed_at: string | null;
};

const selectDeviceCode = `SELECT code_hash, user_code, client_id, scope, status,
  user_id, issued_at, expires_at, last_polled_at, interval_seconds,
  current_interval_seconds, consumed_at FROM device_codes`;

const normalizeScope = (scope: string): string =>
  [...new Set(scope.trim().split(/\s+/).filter(Boolean))].join(" ");

const userCodeAlphabet = "BCDFGHJKLMNPQRSTVWXYZ23456789";

export class DeviceAuthorizationService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #rng: Rng;
  readonly #tenantId: string;
  readonly #profile: ProviderProfile;
  readonly #applications: ApplicationRepository;
  readonly #users: UserRepository;

  constructor(options: {
    readonly store: SqlStore;
    readonly clock: Clock;
    readonly rng: Rng;
    readonly tenantId: string;
    readonly profile: ProviderProfile;
    readonly applications: ApplicationRepository;
    readonly users: UserRepository;
  }) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#rng = options.rng;
    this.#tenantId = options.tenantId;
    this.#profile = options.profile;
    this.#applications = options.applications;
    this.#users = options.users;
  }

  async create(
    input: CreateDeviceAuthorizationInput
  ): Promise<CreatedDeviceAuthorization> {
    this.#requireDeviceClient(input.clientId);
    const scope = normalizeScope(input.scope);
    if (!scope) throw new DeviceAuthorizationError("invalid_scope");
    const deviceAuthorization = this.#profile.urls.deviceAuthorization;
    const activation = this.#profile.urls.activation;
    const policy = this.#profile.deviceAuthorizationPolicy;
    if (!deviceAuthorization || !activation || !policy) {
      throw new DeviceAuthorizationError("unsupported_grant_type");
    }

    const deviceCode = randomId("device", this.#rng);
    const userCode = [...this.#rng.bytes(8)]
      .map((byte) => userCodeAlphabet[byte % userCodeAlphabet.length])
      .join("");
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + policy.lifetimeSeconds * 1_000);
    this.#store.run(
      `INSERT INTO device_codes (
        code_hash, user_code, client_id, scope, status, issued_at, expires_at,
        interval_seconds, current_interval_seconds
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      await hashSecret(deviceCode),
      userCode,
      input.clientId,
      scope,
      now.toISOString(),
      expiresAt.toISOString(),
      policy.intervalSeconds,
      policy.intervalSeconds
    );
    const context = {
      issuerBase: input.issuerBase,
      directoryBaseUrl: input.directoryBaseUrl,
      tenantId: this.#tenantId,
    };
    const verificationUri = activation(context);
    return {
      deviceCode,
      userCode,
      verificationUri,
      ...(policy.includeVerificationUriComplete
        ? {
            verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(
              userCode
            )}`,
          }
        : {}),
      expiresIn: policy.lifetimeSeconds,
      interval: policy.intervalSeconds,
    };
  }

  activate(userCode: string, userId: string): void {
    const row = this.#findByUserCode(userCode);
    this.#assertActivatable(row);
    const user = this.#users.findById(userId);
    if (!user?.accountEnabled || user.softDeletedAt) {
      throw new DeviceAuthorizationError(
        "access_denied",
        "The user cannot authorize this device."
      );
    }
    const result = this.#store.run(
      `UPDATE device_codes SET status = 'approved', user_id = ?
       WHERE user_code = ? AND status = 'pending'`,
      user.id,
      row.user_code
    );
    if (result.changes !== 1) throw new DeviceAuthorizationError("invalid_grant");
  }

  deny(userCode: string): void {
    const row = this.#findByUserCode(userCode);
    this.#assertActivatable(row);
    const result = this.#store.run(
      `UPDATE device_codes SET status = 'denied'
       WHERE user_code = ? AND status = 'pending'`,
      row.user_code
    );
    if (result.changes !== 1) throw new DeviceAuthorizationError("invalid_grant");
  }

  async poll(
    input: PollDeviceAuthorizationInput
  ): Promise<PreparedDeviceAuthorizationGrant> {
    this.#requireDeviceClient(input.clientId);
    const codeHash = await hashSecret(input.deviceCode);
    const row = this.#store.get<DeviceCodeRow>(
      `${selectDeviceCode} WHERE code_hash = ?`,
      codeHash
    );
    if (!row || row.client_id !== input.clientId) {
      throw new DeviceAuthorizationError("invalid_grant");
    }
    const now = this.#clock.now();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      this.#store.run(
        "UPDATE device_codes SET status = 'expired' WHERE code_hash = ?",
        codeHash
      );
      throw new DeviceAuthorizationError("expired_token");
    }
    if (row.status === "consumed" || row.consumed_at) {
      throw new DeviceAuthorizationError("invalid_grant");
    }

    const lastPoll = row.last_polled_at
      ? new Date(row.last_polled_at).getTime()
      : undefined;
    if (
      lastPoll !== undefined &&
      now.getTime() - lastPoll < row.current_interval_seconds * 1_000
    ) {
      this.#store.run(
        `UPDATE device_codes
         SET last_polled_at = ?, current_interval_seconds = ?
         WHERE code_hash = ?`,
        now.toISOString(),
        row.current_interval_seconds + 5,
        codeHash
      );
      throw new DeviceAuthorizationError("slow_down");
    }

    if (row.status === "pending") {
      this.#store.run(
        "UPDATE device_codes SET last_polled_at = ? WHERE code_hash = ?",
        now.toISOString(),
        codeHash
      );
      throw new DeviceAuthorizationError("authorization_pending");
    }
    if (row.status === "denied") {
      throw new DeviceAuthorizationError("access_denied");
    }
    if (row.status !== "approved" || !row.user_id) {
      throw new DeviceAuthorizationError(
        row.status === "expired" ? "expired_token" : "invalid_grant"
      );
    }

    return {
      codeHash,
      clientId: row.client_id,
      userId: row.user_id,
      scope: row.scope,
    };
  }

  /**
   * Conditionally consumes an approved grant. OAuthService calls this inside
   * the same store transaction that persists the prepared token grant.
   */
  commit(grant: PreparedDeviceAuthorizationGrant): DeviceAuthorizationCommitOutcome {
    const row = this.#store.get<DeviceCodeRow>(
      `${selectDeviceCode} WHERE code_hash = ?`,
      grant.codeHash
    );
    if (
      !row ||
      row.client_id !== grant.clientId ||
      row.user_id !== grant.userId ||
      row.scope !== grant.scope ||
      row.status !== "approved" ||
      row.consumed_at
    ) {
      return "invalid";
    }
    const now = this.#clock.now();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      this.#store.run(
        `UPDATE device_codes SET status = 'expired'
         WHERE code_hash = ? AND status = 'approved'`,
        grant.codeHash
      );
      return "expired";
    }
    const consumed = this.#store.run(
      `UPDATE device_codes SET status = 'consumed', consumed_at = ?
       WHERE code_hash = ? AND client_id = ? AND user_id = ? AND scope = ?
         AND status = 'approved' AND consumed_at IS NULL`,
      now.toISOString(),
      grant.codeHash,
      grant.clientId,
      grant.userId,
      grant.scope
    );
    return consumed.changes === 1 ? "success" : "invalid";
  }

  #requireDeviceClient(clientId: string): void {
    const application = this.#applications.findByClientId(clientId);
    if (!application) throw new DeviceAuthorizationError("invalid_client");
    const policy = this.#profile.deviceAuthorizationPolicy;
    if (!policy) throw new DeviceAuthorizationError("unsupported_grant_type");
    if (!policy.allowedClientTypes.includes(application.clientType)) {
      throw new DeviceAuthorizationError(
        "invalid_client",
        `${this.#profile.displayName} does not allow ${application.clientType} clients to use device authorization.`
      );
    }
    if (!application.grantTypes.includes(DEVICE_CODE_GRANT_TYPE)) {
      throw new DeviceAuthorizationError("unsupported_grant_type");
    }
  }

  #findByUserCode(userCode: string): DeviceCodeRow {
    const row = this.#store.get<DeviceCodeRow>(
      `${selectDeviceCode} WHERE user_code = ?`,
      userCode.trim().toUpperCase()
    );
    if (!row) throw new DeviceAuthorizationError("invalid_grant");
    return row;
  }

  #assertActivatable(row: DeviceCodeRow): void {
    if (new Date(row.expires_at).getTime() <= this.#clock.now().getTime()) {
      throw new DeviceAuthorizationError("expired_token");
    }
    if (row.status !== "pending") {
      throw new DeviceAuthorizationError("invalid_grant");
    }
  }
}
