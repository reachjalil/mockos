export type ParsedArgs = {
  command: string[];
  options: Map<string, string[]>;
};

const OPTION_NAME = /^[a-z][a-z0-9-]*$/;

export class CliUsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options = new Map<string, string[]>();
  let parseOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (!parseOptions || !token.startsWith("--")) {
      command.push(token);
      continue;
    }

    const separator = token.indexOf("=");
    const name = token.slice(2, separator === -1 ? undefined : separator);
    if (!OPTION_NAME.test(name)) {
      throw new CliUsageError(`Invalid option: ${token}`);
    }

    let value: string;
    if (separator !== -1) {
      value = token.slice(separator + 1);
    } else {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = "true";
      }
    }

    const values = options.get(name) ?? [];
    values.push(value);
    options.set(name, values);
  }

  return { command, options };
}

export function option(
  args: ParsedArgs,
  name: string,
  fallback?: string
): string | undefined {
  return args.options.get(name)?.at(-1) ?? fallback;
}

export function requiredOption(args: ParsedArgs, name: string): string {
  const value = option(args, name);
  if (value === undefined || value === "true" || value.length === 0) {
    throw new CliUsageError(`Missing required option --${name}`);
  }
  return value;
}

export function booleanOption(args: ParsedArgs, name: string): boolean {
  const value = option(args, name);
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliUsageError(`--${name} must be true or false`);
}

export function integerOption(
  args: ParsedArgs,
  name: string,
  fallback?: number
): number | undefined {
  const value = option(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CliUsageError(`--${name} must be an integer`);
  }
  return parsed;
}

export function assertKnownOptions(args: ParsedArgs, names: string[]): void {
  const known = new Set(names);
  for (const name of args.options.keys()) {
    if (!known.has(name)) {
      throw new CliUsageError(`Unknown option --${name}`);
    }
  }
}
