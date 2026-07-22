import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:8787/mcp";

export type Profile = {
  endpoint: string;
  apiKey?: string;
};

export type CliConfig = {
  version: 1;
  activeProfile: string;
  profiles: Record<string, Profile>;
};

export type ResolvedConnection = {
  endpoint: string;
  apiKey?: string;
  profile: string;
  endpointSource: "option" | "environment" | "profile" | "default";
  credentialSource: "option" | "environment" | "profile" | "none";
};

export function defaultConfigPath(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const configRoot = environment.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configRoot, "mockos", "config.json");
}

export function emptyConfig(): CliConfig {
  return { version: 1, activeProfile: "default", profiles: {} };
}

export async function loadConfig(path: string): Promise<CliConfig> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    throw error;
  }

  const value = JSON.parse(source) as Partial<CliConfig>;
  if (
    value.version !== 1 ||
    typeof value.activeProfile !== "string" ||
    value.profiles === undefined ||
    typeof value.profiles !== "object" ||
    Array.isArray(value.profiles)
  ) {
    throw new Error(`Unsupported or invalid mockOS config at ${path}`);
  }
  validateProfileName(value.activeProfile);
  for (const [name, profile] of Object.entries(value.profiles)) {
    validateProfileName(name);
    if (
      profile === null ||
      typeof profile !== "object" ||
      typeof profile.endpoint !== "string" ||
      (profile.apiKey !== undefined && typeof profile.apiKey !== "string")
    ) {
      throw new Error(`Invalid profile ${name} in ${path}`);
    }
    validateEndpoint(profile.endpoint);
  }
  return value as CliConfig;
}

export async function saveConfig(path: string, config: CliConfig): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function setProfile(
  config: CliConfig,
  name: string,
  profile: Profile
): CliConfig {
  validateProfileName(name);
  validateEndpoint(profile.endpoint);
  return {
    version: 1,
    activeProfile: name,
    profiles: { ...config.profiles, [name]: profile },
  };
}

export function removeProfile(config: CliConfig, name: string): CliConfig {
  const profiles = { ...config.profiles };
  delete profiles[name];
  return {
    version: 1,
    activeProfile: config.activeProfile === name ? "default" : config.activeProfile,
    profiles,
  };
}

export function resolveConnection(input: {
  config: CliConfig;
  environment?: NodeJS.ProcessEnv;
  profile?: string;
  endpoint?: string;
  apiKey?: string;
}): ResolvedConnection {
  const environment = input.environment ?? process.env;
  const profile =
    input.profile ?? environment.MOCKOS_PROFILE ?? input.config.activeProfile;
  validateProfileName(profile);
  const stored = input.config.profiles[profile];
  const endpoint =
    input.endpoint ??
    environment.MOCKOS_ENDPOINT ??
    stored?.endpoint ??
    DEFAULT_ENDPOINT;
  validateEndpoint(endpoint);

  return {
    endpoint,
    apiKey: input.apiKey ?? environment.MOCKOS_API_KEY ?? stored?.apiKey,
    profile,
    endpointSource: input.endpoint
      ? "option"
      : environment.MOCKOS_ENDPOINT
        ? "environment"
        : stored?.endpoint
          ? "profile"
          : "default",
    credentialSource: input.apiKey
      ? "option"
      : environment.MOCKOS_API_KEY
        ? "environment"
        : stored?.apiKey
          ? "profile"
          : "none",
  };
}

function validateEndpoint(value: string): void {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" &&
    endpoint.hostname !== "127.0.0.1" &&
    endpoint.hostname !== "localhost" &&
    endpoint.hostname !== "[::1]"
  ) {
    throw new Error("mockOS endpoint must use HTTPS unless it is localhost");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("mockOS endpoint must not contain embedded credentials");
  }
}

function validateProfileName(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) {
    throw new Error(`Invalid profile name: ${value}`);
  }
}
