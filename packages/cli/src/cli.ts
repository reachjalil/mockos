import {
  assertKnownOptions,
  booleanOption,
  CliUsageError,
  integerOption,
  option,
  type ParsedArgs,
  parseArgs,
  requiredOption,
} from "./args.js";
import {
  type CliConfig,
  defaultConfigPath,
  loadConfig,
  removeProfile,
  resolveConnection,
  saveConfig,
  setProfile,
} from "./config.js";
import {
  assertionToJunit,
  type CliIo,
  extractRows,
  jsonLine,
  prettyJson,
  readJson,
  toJsonLines,
  unwrapData,
} from "./io.js";
import { McpToolClient, type ToolClient, unwrapToolResult } from "./mcp-client.js";

export const CLI_VERSION = "0.1.0";

const GLOBAL_OPTIONS = [
  "api-key",
  "config",
  "endpoint",
  "help",
  "json",
  "profile",
  "timeout",
];

const HELP = `🥸 mockOS CLI ${CLI_VERSION}

Usage:
  mockos [global options] <command> [command options]

Connection:
  login                         Save an endpoint and Access Key profile
  logout                        Remove a saved profile
  doctor                        Verify MCP connectivity and list capabilities

Environment lifecycle:
  env create                    Create an environment
  env ensure                    Idempotently create or update an environment
  env list                      List environments
  env delete                    Delete an environment
  env configure                 Apply environment configuration
  env wait                      Wait until an environment is visible
  app create                    Create an OAuth/OIDC application registration
  lifecycle simulate           Apply an Entra or Okta user lifecycle action

Mock configuration and evidence:
  seed                          Seed users and groups from JSON
  scenario set|clear            Configure deterministic fault injection
  mint-token                    Mint a normal or deliberately broken token
  logs dump                     Export request logs as JSON or JSONL
  assert                        Evaluate a request-log assertion; optionally emit JUnit
  wellknown                     Print provider endpoint URLs
  report                        Produce a compact environment evidence report

Blueprints:
  blueprint validate            Validate the portable JSON envelope locally
  blueprint export             Export an environment blueprint
  blueprint apply              Install a blueprint idempotently

Diagnostics:
  mcp tools                     List raw management MCP tools

Global options:
  --endpoint <url>              MCP endpoint (or MOCKOS_ENDPOINT)
  --api-key <key>               Access Key (prefer MOCKOS_API_KEY in CI)
  --profile <name>              Saved profile (or MOCKOS_PROFILE)
  --config <path>               Config path (or MOCKOS_CONFIG)
  --timeout <ms>                Request timeout; default 30000
  --json                        Machine-readable output
  --help                        Show help
  --version                     Show version

Use --json for machine-readable command output.
`;

export type CliDependencies = {
  io: CliIo;
  environment?: NodeJS.ProcessEnv;
  createClient?: (options: {
    endpoint: string;
    apiKey?: string;
    timeoutMs: number;
  }) => ToolClient;
  loadConfig?: (path: string) => Promise<CliConfig>;
  saveConfig?: (path: string, config: CliConfig) => Promise<void>;
};

export async function runCli(
  argv: string[],
  dependencies: CliDependencies
): Promise<number> {
  const environment = dependencies.environment ?? process.env;
  try {
    if (argv.includes("--version")) {
      dependencies.io.stdout(`${CLI_VERSION}\n`);
      return 0;
    }
    const args = parseArgs(argv);
    const command = args.command.join(" ");
    if (command === "" || booleanOption(args, "help")) {
      dependencies.io.stdout(HELP);
      return 0;
    }

    const configPath =
      valueOption(args, "config") ??
      environment.MOCKOS_CONFIG ??
      defaultConfigPath(environment);
    const readConfig = dependencies.loadConfig ?? loadConfig;
    const writeConfig = dependencies.saveConfig ?? saveConfig;

    if (command === "login") {
      return await login(args, dependencies.io, configPath, readConfig, writeConfig);
    }
    if (command === "logout") {
      return await logout(args, dependencies.io, configPath, readConfig, writeConfig);
    }
    if (command === "blueprint validate") {
      return await validateBlueprint(args, dependencies.io);
    }

    const config = await readConfig(configPath);
    const connection = resolveConnection({
      config,
      environment,
      profile: valueOption(args, "profile"),
      endpoint: valueOption(args, "endpoint"),
      apiKey: valueOption(args, "api-key"),
    });
    const timeoutMs = integerOption(args, "timeout", 30_000) ?? 30_000;
    if (timeoutMs < 100 || timeoutMs > 15 * 60_000) {
      throw new CliUsageError("--timeout must be between 100 and 900000 milliseconds");
    }
    const client = (
      dependencies.createClient ?? ((options) => new McpToolClient(options))
    )({
      endpoint: connection.endpoint,
      ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
      timeoutMs,
    });

    try {
      await client.connect();
      const result = await runConnectedCommand(
        command,
        args,
        client,
        dependencies.io,
        connection
      );
      return result;
    } finally {
      await client.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.io.stderr(`mockos: ${message}\n`);
    return error instanceof CliUsageError ? error.exitCode : 1;
  }
}

async function runConnectedCommand(
  command: string,
  args: ParsedArgs,
  client: ToolClient,
  io: CliIo,
  connection: ReturnType<typeof resolveConnection>
): Promise<number> {
  switch (command) {
    case "doctor": {
      assertOptions(args);
      const tools = await client.listTools();
      emit(
        {
          ok: true,
          endpoint: connection.endpoint,
          endpointSource: connection.endpointSource,
          authenticated: connection.credentialSource !== "none",
          credentialSource: connection.credentialSource,
          profile: connection.profile,
          server: client.serverInfo() ?? null,
          tools: tools.map((tool) => tool.name).sort(),
        },
        args,
        io
      );
      return 0;
    }
    case "mcp tools": {
      assertOptions(args);
      emit(await client.listTools(), args, io);
      return 0;
    }
    case "env create": {
      assertOptions(args, ["name", "provider", "seed"]);
      const input = compact({
        name: requiredOption(args, "name"),
        provider: valueOption(args, "provider") ?? "entra",
        seed: valueOption(args, "seed") ?? "mockos",
      });
      return emitTool(await call(client, "create_environment", input), args, io);
    }
    case "env ensure": {
      assertOptions(args, [
        "slug",
        "name",
        "provider",
        "seed",
        "ttl",
        "blueprint",
        "idempotency-key",
      ]);
      const blueprint = valueOption(args, "blueprint");
      const input = compact({
        slug: requiredOption(args, "slug"),
        name: valueOption(args, "name"),
        provider: valueOption(args, "provider") ?? "entra",
        seed: valueOption(args, "seed") ?? "mockos",
        ttlHours: integerOption(args, "ttl"),
        blueprint: blueprint ? await readJson(blueprint, io) : undefined,
        idempotencyKey: valueOption(args, "idempotency-key"),
      });
      return emitTool(await call(client, "ensure_environment", input), args, io);
    }
    case "env list": {
      assertOptions(args);
      return emitTool(await call(client, "list_environments", {}), args, io);
    }
    case "env delete": {
      assertOptions(args, ["env", "idempotency-key"]);
      return emitTool(
        await call(
          client,
          "delete_environment",
          compact({
            environmentId: requiredOption(args, "env"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "env configure": {
      assertOptions(args, ["env", "file", "expected-version", "idempotency-key"]);
      const configuration = await readJson(requiredOption(args, "file"), io);
      return emitTool(
        await call(
          client,
          "configure_environment",
          compact({
            ...configuration,
            environmentId: requiredOption(args, "env"),
            expectedVersion: integerOption(args, "expected-version"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "env wait": {
      assertOptions(args, ["env", "wait-timeout", "interval"]);
      return await waitForEnvironment(args, client, io);
    }
    case "seed": {
      assertOptions(args, ["env", "file", "idempotency-key"]);
      const identities = await readJson(requiredOption(args, "file"), io);
      return emitTool(
        await call(
          client,
          "seed_identities",
          compact({
            ...identities,
            environmentId: requiredOption(args, "env"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "scenario set": {
      assertOptions(args, ["env", "file", "idempotency-key"]);
      const scenario = await readJson(requiredOption(args, "file"), io);
      return emitTool(
        await call(
          client,
          "set_scenario",
          compact({
            ...scenario,
            environmentId: requiredOption(args, "env"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "scenario clear": {
      assertOptions(args, ["env", "id", "idempotency-key"]);
      return emitTool(
        await call(
          client,
          "clear_scenario",
          compact({
            environmentId: requiredOption(args, "env"),
            scenarioId: valueOption(args, "id"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "app create": {
      assertOptions(args, ["env", "file", "idempotency-key"]);
      const application = await readJson(requiredOption(args, "file"), io);
      return emitTool(
        await call(
          client,
          "create_application",
          compact({
            ...application,
            environmentId: requiredOption(args, "env"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    case "lifecycle simulate": {
      assertOptions(args, ["env", "user", "action"]);
      return emitTool(
        await call(client, "simulate_lifecycle", {
          environmentId: requiredOption(args, "env"),
          userId: requiredOption(args, "user"),
          action: requiredOption(args, "action"),
        }),
        args,
        io
      );
    }
    case "mint-token": {
      assertOptions(args, ["env", "client-id", "subject", "audience", "broken"]);
      return emitTool(
        await call(
          client,
          "mint_token",
          compact({
            environmentId: requiredOption(args, "env"),
            clientId: requiredOption(args, "client-id"),
            subject: requiredOption(args, "subject"),
            audience: valueOption(args, "audience"),
            broken: valueOption(args, "broken"),
          })
        ),
        args,
        io
      );
    }
    case "logs dump": {
      assertOptions(args, [
        "env",
        "source",
        "provider",
        "method",
        "path",
        "status",
        "limit",
        "cursor",
        "format",
        "out",
      ]);
      const value = await call(
        client,
        "get_request_log",
        compact({
          environmentId: requiredOption(args, "env"),
          source: valueOption(args, "source"),
          provider: valueOption(args, "provider"),
          method: valueOption(args, "method"),
          path: valueOption(args, "path"),
          status: integerOption(args, "status"),
          limit: integerOption(args, "limit"),
          cursor: valueOption(args, "cursor"),
        })
      );
      const format = valueOption(args, "format") ?? "jsonl";
      if (format !== "json" && format !== "jsonl") {
        throw new CliUsageError("--format must be json or jsonl");
      }
      const rendered =
        format === "jsonl" ? toJsonLines(unwrapData(value)) : prettyJson(value);
      const outputPath = valueOption(args, "out");
      if (outputPath) await io.writeFile(outputPath, rendered);
      else io.stdout(rendered);
      return 0;
    }
    case "assert": {
      assertOptions(args, ["env", "spec", "junit"]);
      const spec = await readJson(requiredOption(args, "spec"), io);
      const value = await call(
        client,
        "assert_requests",
        compact({ ...spec, environmentId: requiredOption(args, "env") })
      );
      const junit = valueOption(args, "junit");
      if (junit) await io.writeFile(junit, assertionToJunit(value));
      emit(value, args, io);
      return assertionPassed(value) ? 0 : 3;
    }
    case "wellknown": {
      assertOptions(args, ["env"]);
      return emitTool(
        await call(client, "get_wellknown_urls", {
          environmentId: requiredOption(args, "env"),
        }),
        args,
        io
      );
    }
    case "report": {
      assertOptions(args, ["env", "spec", "out"]);
      return await report(args, client, io);
    }
    case "blueprint export": {
      assertOptions(args, ["env", "out", "include-state"]);
      const value = await call(client, "export_blueprint", {
        environmentId: requiredOption(args, "env"),
        includeState: booleanOption(args, "include-state"),
      });
      const rendered = prettyJson(value);
      const outputPath = valueOption(args, "out");
      if (outputPath) await io.writeFile(outputPath, rendered);
      else io.stdout(rendered);
      return 0;
    }
    case "blueprint apply": {
      assertOptions(args, ["file", "slug", "ttl", "idempotency-key"]);
      const blueprint = await readJson(requiredOption(args, "file"), io);
      return emitTool(
        await call(
          client,
          "install_blueprint",
          compact({
            blueprint,
            slug: valueOption(args, "slug"),
            ttlHours: integerOption(args, "ttl"),
            idempotencyKey: valueOption(args, "idempotency-key"),
          })
        ),
        args,
        io
      );
    }
    default:
      throw new CliUsageError(`Unknown command: ${command}`);
  }
}

async function login(
  args: ParsedArgs,
  io: CliIo,
  configPath: string,
  readConfig: (path: string) => Promise<CliConfig>,
  writeConfig: (path: string, config: CliConfig) => Promise<void>
): Promise<number> {
  assertOptions(args, ["api-key-stdin"]);
  const profileName = valueOption(args, "profile") ?? "default";
  const endpoint = valueOption(args, "endpoint");
  if (!endpoint) throw new CliUsageError("login requires --endpoint");
  let apiKey = valueOption(args, "api-key");
  if (booleanOption(args, "api-key-stdin")) apiKey = (await io.readStdin()).trim();
  if (!apiKey) throw new CliUsageError("login requires --api-key or --api-key-stdin");
  const config = setProfile(await readConfig(configPath), profileName, {
    endpoint,
    apiKey,
  });
  await writeConfig(configPath, config);
  io.stdout(`Saved mockOS profile ${profileName} in ${configPath}\n`);
  return 0;
}

async function logout(
  args: ParsedArgs,
  io: CliIo,
  configPath: string,
  readConfig: (path: string) => Promise<CliConfig>,
  writeConfig: (path: string, config: CliConfig) => Promise<void>
): Promise<number> {
  assertOptions(args);
  const config = await readConfig(configPath);
  const profileName = valueOption(args, "profile") ?? config.activeProfile;
  await writeConfig(configPath, removeProfile(config, profileName));
  io.stdout(`Removed mockOS profile ${profileName}\n`);
  return 0;
}

async function validateBlueprint(args: ParsedArgs, io: CliIo): Promise<number> {
  assertOptions(args, ["file"]);
  const blueprint = await readJson(requiredOption(args, "file"), io);
  const errors: string[] = [];
  if (typeof blueprint.blueprintVersion !== "string") {
    errors.push("blueprintVersion must be a string");
  }
  if (typeof blueprint.name !== "string" || blueprint.name.trim().length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (
    blueprint.environment === null ||
    typeof blueprint.environment !== "object" ||
    Array.isArray(blueprint.environment)
  ) {
    errors.push("environment must be an object");
  }
  const result = { valid: errors.length === 0, errors };
  emit(result, args, io);
  return errors.length === 0 ? 0 : 2;
}

async function waitForEnvironment(
  args: ParsedArgs,
  client: ToolClient,
  io: CliIo
): Promise<number> {
  const environmentId = requiredOption(args, "env");
  const waitTimeout = integerOption(args, "wait-timeout", 60_000) ?? 60_000;
  const interval = integerOption(args, "interval", 1_000) ?? 1_000;
  if (waitTimeout < 0 || interval < 50) {
    throw new CliUsageError(
      "--wait-timeout must be non-negative and --interval at least 50"
    );
  }
  const deadline = io.now() + waitTimeout;
  while (io.now() <= deadline) {
    const value = await call(client, "list_environments", {});
    const rows = extractRows(unwrapData(value));
    const found = rows.find(
      (row) =>
        row !== null &&
        typeof row === "object" &&
        "id" in row &&
        row.id === environmentId
    );
    if (found) {
      emit(found, args, io);
      return 0;
    }
    const remaining = deadline - io.now();
    if (remaining <= 0) break;
    await io.sleep(Math.min(interval, remaining));
  }
  throw new Error(`Timed out waiting for environment ${environmentId}`);
}

async function report(
  args: ParsedArgs,
  client: ToolClient,
  io: CliIo
): Promise<number> {
  const environmentId = requiredOption(args, "env");
  const logs = await call(client, "get_request_log", { environmentId });
  let assertion: unknown;
  const specPath = valueOption(args, "spec");
  if (specPath) {
    const spec = await readJson(specPath, io);
    assertion = await call(client, "assert_requests", {
      ...spec,
      environmentId,
    });
  }
  const rows = extractRows(unwrapData(logs));
  const value = {
    environmentId,
    generatedAt: new Date(io.now()).toISOString(),
    requestCount: rows.length,
    sources: countBy(rows, "source"),
    statuses: countBy(rows, "responseStatus"),
    ...(assertion === undefined ? {} : { assertion }),
  };
  const rendered = prettyJson(value);
  const outputPath = valueOption(args, "out");
  if (outputPath) await io.writeFile(outputPath, rendered);
  else io.stdout(rendered);
  return assertion === undefined || assertionPassed(assertion) ? 0 : 3;
}

async function call(
  client: ToolClient,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const tools = await client.listTools();
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(
      `Server does not advertise ${name}; run "mockos doctor" and upgrade the server if this command belongs to a later milestone`
    );
  }
  return unwrapToolResult(await client.callTool(name, input));
}

function emitTool(value: unknown, args: ParsedArgs, io: CliIo): number {
  emit(value, args, io);
  return 0;
}

function emit(value: unknown, args: ParsedArgs, io: CliIo): void {
  if (booleanOption(args, "json")) {
    io.stdout(jsonLine(value));
    return;
  }
  if (typeof value === "string") {
    io.stdout(`${value}${value.endsWith("\n") ? "" : "\n"}`);
    return;
  }
  io.stdout(prettyJson(value));
}

function assertionPassed(value: unknown): boolean {
  const result = unwrapData(value);
  return Boolean(
    result && typeof result === "object" && "pass" in result && result.pass === true
  );
}

function countBy(rows: unknown[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = (row as Record<string, unknown>)[key];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const label = String(value);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}

function valueOption(args: ParsedArgs, name: string): string | undefined {
  const value = option(args, name);
  if (value === "true") throw new CliUsageError(`--${name} requires a value`);
  return value;
}

function assertOptions(args: ParsedArgs, commandOptions: string[] = []): void {
  assertKnownOptions(args, [...GLOBAL_OPTIONS, ...commandOptions]);
}
