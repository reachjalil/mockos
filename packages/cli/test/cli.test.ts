import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { type CliConfig, emptyConfig } from "../src/config.js";
import type { CliIo } from "../src/io.js";
import type { ToolCallResult, ToolClient, ToolDescription } from "../src/mcp-client.js";

class FakeClient implements ToolClient {
  connected = false;
  closed = false;
  calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  tools: ToolDescription[] = [];
  results = new Map<string, unknown>();

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async listTools(): Promise<ToolDescription[]> {
    return this.tools;
  }

  async callTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    this.calls.push({ name, input });
    const value = this.results.get(name) ?? { ok: true };
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
    };
  }

  serverInfo(): { name?: string; version?: string } {
    return { name: "mockos", version: "test" };
  }
}

function harness(input?: { stdin?: string; now?: number }) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const files = new Map<string, string>();
  let now = input?.now ?? Date.parse("2026-07-22T00:00:00.000Z");
  const io: CliIo = {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    readStdin: async () => input?.stdin ?? "",
    readFile: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing test file ${path}`);
      return value;
    },
    writeFile: async (path, value) => {
      files.set(path, value);
    },
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
  };
  return { io, stdout, stderr, files };
}

function dependencies(client: FakeClient, io: CliIo) {
  return {
    io,
    environment: {},
    createClient: () => client,
    loadConfig: async () => emptyConfig(),
    saveConfig: async () => undefined,
  };
}

describe("mockOS CLI", () => {
  it("prints help without reading configuration or connecting", async () => {
    const test = harness();
    const exitCode = await runCli([], {
      io: test.io,
      environment: {},
      loadConfig: async () => {
        throw new Error("should not load config");
      },
    });

    expect(exitCode).toBe(0);
    expect(test.stdout.join("")).toContain("🥸 mockOS CLI");
    expect(test.stderr).toEqual([]);
  });

  it("stores login profiles without printing the key", async () => {
    const test = harness({ stdin: "mk_secret\n" });
    let saved: CliConfig | undefined;
    const exitCode = await runCli(
      [
        "login",
        "--endpoint",
        "https://example.test/mcp",
        "--api-key-stdin",
        "--profile",
        "ci",
      ],
      {
        io: test.io,
        environment: {},
        loadConfig: async () => emptyConfig(),
        saveConfig: async (_path, value) => {
          saved = value;
        },
      }
    );

    expect(exitCode).toBe(0);
    expect(saved?.profiles.ci).toEqual({
      endpoint: "https://example.test/mcp",
      apiKey: "mk_secret",
    });
    expect(test.stdout.join("")).not.toContain("mk_secret");
  });

  it("maps env create to the management MCP contract", async () => {
    const test = harness();
    const client = new FakeClient();
    client.tools = [{ name: "create_environment" }];
    client.results.set("create_environment", { id: "env_12345678" });

    const exitCode = await runCli(
      ["env", "create", "--name", "CI", "--provider", "okta", "--seed", "42", "--json"],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(client.calls).toEqual([
      {
        name: "create_environment",
        input: { name: "CI", provider: "okta", seed: "42" },
      },
    ]);
    expect(JSON.parse(test.stdout.join(""))).toEqual({ id: "env_12345678" });
    expect(client.closed).toBe(true);
  });

  it("exports request logs as JSONL", async () => {
    const test = harness();
    const client = new FakeClient();
    client.tools = [{ name: "get_request_log" }];
    client.results.set("get_request_log", {
      data: [
        { id: "one", responseStatus: 200 },
        { id: "two", responseStatus: 429 },
      ],
    });

    const exitCode = await runCli(
      ["logs", "dump", "--env", "env_12345678", "--out", "requests.jsonl"],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(test.files.get("requests.jsonl")?.trim().split("\n")).toHaveLength(2);
    expect(test.stdout).toEqual([]);
  });

  it("maps file-backed Stage A commands to flattened MCP inputs", async () => {
    const test = harness();
    test.files.set(
      "identities.json",
      JSON.stringify({
        users: [{ userName: "ada@example.test", displayName: "Ada" }],
        groups: [],
      })
    );
    test.files.set(
      "application.json",
      JSON.stringify({
        name: "Target app",
        redirectUris: ["https://target.example/callback"],
      })
    );
    test.files.set(
      "scenario.json",
      JSON.stringify({
        id: "rate-limit",
        injectionPoint: "oauth.token",
        action: { type: "error", code: "RATE_LIMITED" },
      })
    );
    const client = new FakeClient();
    client.tools = [
      { name: "seed_identities" },
      { name: "create_application" },
      { name: "set_scenario" },
    ];
    const deps = dependencies(client, test.io);

    expect(
      await runCli(["seed", "--env", "env_12345678", "--file", "identities.json"], deps)
    ).toBe(0);
    expect(
      await runCli(
        ["app", "create", "--env", "env_12345678", "--file", "application.json"],
        deps
      )
    ).toBe(0);
    expect(
      await runCli(
        ["scenario", "set", "--env", "env_12345678", "--file", "scenario.json"],
        deps
      )
    ).toBe(0);

    expect(client.calls).toEqual([
      {
        name: "seed_identities",
        input: {
          environmentId: "env_12345678",
          users: [{ userName: "ada@example.test", displayName: "Ada" }],
          groups: [],
        },
      },
      {
        name: "create_application",
        input: {
          environmentId: "env_12345678",
          name: "Target app",
          redirectUris: ["https://target.example/callback"],
        },
      },
      {
        name: "set_scenario",
        input: {
          environmentId: "env_12345678",
          id: "rate-limit",
          injectionPoint: "oauth.token",
          action: { type: "error", code: "RATE_LIMITED" },
        },
      },
    ]);
  });

  it("maps lifecycle simulation to the M3 management contract", async () => {
    const test = harness();
    const client = new FakeClient();
    client.tools = [{ name: "simulate_lifecycle" }];
    client.results.set("simulate_lifecycle", {
      userId: "usr_12345678",
      previousState: "active",
      currentState: "suspended",
      changed: true,
    });

    const exitCode = await runCli(
      [
        "lifecycle",
        "simulate",
        "--env",
        "env_12345678",
        "--user",
        "usr_12345678",
        "--action",
        "suspend",
        "--json",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(client.calls).toEqual([
      {
        name: "simulate_lifecycle",
        input: {
          environmentId: "env_12345678",
          userId: "usr_12345678",
          action: "suspend",
        },
      },
    ]);
  });

  it("runs provisioning without placing the target credential in argv", async () => {
    const test = harness();
    test.files.set("target-token.txt", "synthetic-scim-token\n");
    const client = new FakeClient();
    client.tools = [{ name: "run_provisioning_cycle" }];
    client.results.set("run_provisioning_cycle", {
      data: {
        id: "run_12345678",
        unsafeDependencyEcho: "synthetic-scim-token",
      },
    });

    const exitCode = await runCli(
      [
        "provision",
        "run",
        "--env",
        "env_12345678",
        "--app-id",
        "app_12345678",
        "--mode",
        "full",
        "--target-ref",
        "target-app",
        "--target-url",
        "https://target.example/scim/v2",
        "--target-token-file",
        "target-token.txt",
        "--save-target",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(client.calls).toEqual([
      {
        name: "run_provisioning_cycle",
        input: {
          environmentId: "env_12345678",
          appId: "app_12345678",
          mode: "full",
          target: {
            kind: "inline",
            target: {
              ref: "target-app",
              baseUrl: "https://target.example/scim/v2",
              auth: { kind: "bearer", token: "synthetic-scim-token" },
            },
            save: true,
          },
        },
      },
    ]);
    expect(test.stdout.join("")).not.toContain("synthetic-scim-token");
    expect(test.stdout.join("")).toContain("[REDACTED]");
    expect(test.stderr).toEqual([]);
  });

  it("rejects platform keys from stdin before calling the provisioning tool", async () => {
    const platformKey = "mk_platform_key_must_stay_private";
    const test = harness({ stdin: `${platformKey}\n` });
    const client = new FakeClient();
    client.tools = [{ name: "run_provisioning_cycle" }];

    const exitCode = await runCli(
      [
        "provision",
        "run",
        "--env",
        "env_12345678",
        "--app-id",
        "app_12345678",
        "--target-ref",
        "target-app",
        "--target-url",
        "https://target.example/scim/v2",
        "--target-token-file",
        "-",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(2);
    expect(client.calls).toEqual([]);
    expect(test.stdout.join("")).not.toContain(platformKey);
    expect(test.stderr.join("")).not.toContain(platformKey);
    expect(test.stderr.join("")).toContain("Access Key cannot be used");
  });

  it.each(["stdin", "file"] as const)(
    "rejects an exact non-prefixed active platform key read from %s",
    async (source) => {
      const platformKey = "local-mockos-only";
      const test = harness({
        ...(source === "stdin" ? { stdin: `${platformKey}\n` } : {}),
      });
      if (source === "file") {
        test.files.set("target-token.txt", `${platformKey}\n`);
      }
      const client = new FakeClient();
      client.tools = [{ name: "run_provisioning_cycle" }];
      const baseDependencies = dependencies(client, test.io);
      const configuredDependencies =
        source === "stdin"
          ? {
              ...baseDependencies,
              environment: { MOCKOS_API_KEY: platformKey },
            }
          : {
              ...baseDependencies,
              loadConfig: async (): Promise<CliConfig> => ({
                version: 1,
                activeProfile: "default",
                profiles: {
                  default: {
                    endpoint: "https://mockos.example.test/mcp",
                    apiKey: platformKey,
                  },
                },
              }),
            };

      const exitCode = await runCli(
        [
          "provision",
          "run",
          "--env",
          "env_12345678",
          "--app-id",
          "app_12345678",
          "--target-ref",
          "target-app",
          "--target-url",
          "https://target.example/scim/v2",
          "--target-token-file",
          source === "stdin" ? "-" : "target-token.txt",
        ],
        configuredDependencies
      );

      expect(exitCode).toBe(2);
      expect(client.calls).toEqual([]);
      expect(test.stdout.join("")).not.toContain(platformKey);
      expect(test.stderr.join("")).not.toContain(platformKey);
      expect(test.stderr.join("")).toContain("Access Key cannot be used");
    }
  );

  it("does not offer a target-token argv option", async () => {
    const targetToken = "synthetic-token-must-not-appear";
    const test = harness();
    const client = new FakeClient();
    client.tools = [{ name: "run_provisioning_cycle" }];

    const exitCode = await runCli(
      [
        "provision",
        "run",
        "--env",
        "env_12345678",
        "--app-id",
        "app_12345678",
        "--target-ref",
        "target-app",
        "--target-url",
        "https://target.example/scim/v2",
        "--target-token",
        targetToken,
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(2);
    expect(client.calls).toEqual([]);
    expect(test.stderr.join("")).toContain("Unknown option --target-token");
    expect(test.stderr.join("")).not.toContain(targetToken);
  });

  it("redacts a target credential echoed by a remote provisioning error", async () => {
    const targetToken = "synthetic-target-token";
    const test = harness({ stdin: targetToken });
    const client = new FakeClient();
    client.tools = [{ name: "run_provisioning_cycle" }];
    client.callTool = async (name, input) => {
      client.calls.push({ name, input });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Remote target rejected ${targetToken}`,
          },
        ],
      };
    };

    const exitCode = await runCli(
      [
        "provision",
        "run",
        "--env",
        "env_12345678",
        "--app-id",
        "app_12345678",
        "--target-ref",
        "target-app",
        "--target-url",
        "https://target.example/scim/v2",
        "--target-token-file",
        "-",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(1);
    expect(test.stderr.join("")).toContain("[REDACTED]");
    expect(test.stderr.join("")).not.toContain(targetToken);
  });

  it("runs a saved provisioning target without reading stdin", async () => {
    const test = harness({ stdin: "must-not-be-read" });
    const client = new FakeClient();
    client.tools = [{ name: "run_provisioning_cycle" }];

    expect(
      await runCli(
        [
          "provision",
          "run",
          "--env",
          "env_12345678",
          "--app-id",
          "app_12345678",
          "--target-ref",
          "saved-target",
        ],
        dependencies(client, test.io)
      )
    ).toBe(0);
    expect(client.calls).toEqual([
      {
        name: "run_provisioning_cycle",
        input: {
          environmentId: "env_12345678",
          appId: "app_12345678",
          mode: "incremental",
          target: { kind: "saved", targetRef: "saved-target" },
        },
      },
    ]);
  });

  it("returns a distinct assertion exit code and writes JUnit", async () => {
    const test = harness();
    test.files.set("assertion.json", JSON.stringify({ path: "/token" }));
    const client = new FakeClient();
    client.tools = [{ name: "assert_requests" }];
    client.results.set("assert_requests", {
      data: { pass: false, matched: 0, message: "No matching request" },
    });

    const exitCode = await runCli(
      [
        "assert",
        "--env",
        "env_12345678",
        "--spec",
        "assertion.json",
        "--junit",
        "results.xml",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(3);
    expect(client.calls).toEqual([
      {
        name: "assert_requests",
        input: { environmentId: "env_12345678", path: "/token" },
      },
    ]);
    expect(test.files.get("results.xml")).toContain('failures="1"');
    expect(test.files.get("results.xml")).toContain("No matching request");
  });

  it("flattens report assertions to the management MCP contract", async () => {
    const test = harness({ now: Date.parse("2026-07-22T12:00:00.000Z") });
    test.files.set(
      "report-assertion.json",
      JSON.stringify({ method: "POST", status: 429, count: { exactly: 1 } })
    );
    const client = new FakeClient();
    client.tools = [{ name: "get_request_log" }, { name: "assert_requests" }];
    client.results.set("get_request_log", { data: { entries: [] } });
    client.results.set("assert_requests", {
      data: { pass: true, matched: 1, message: "Matched one request" },
    });

    const exitCode = await runCli(
      ["report", "--env", "env_12345678", "--spec", "report-assertion.json"],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(client.calls.at(-1)).toEqual({
      name: "assert_requests",
      input: {
        environmentId: "env_12345678",
        method: "POST",
        status: 429,
        count: { exactly: 1 },
      },
    });
  });

  it("waits until the environment appears", async () => {
    const test = harness();
    const client = new FakeClient();
    client.tools = [{ name: "list_environments" }];
    let attempt = 0;
    client.callTool = async (name, input) => {
      client.calls.push({ name, input });
      attempt += 1;
      const value = {
        environments: attempt === 1 ? [] : [{ id: "env_12345678", status: "ready" }],
        currentEnvironmentId: null,
      };
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    };

    const exitCode = await runCli(
      [
        "env",
        "wait",
        "--env",
        "env_12345678",
        "--wait-timeout",
        "1000",
        "--interval",
        "50",
      ],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(0);
    expect(client.calls).toHaveLength(2);
  });

  it("fails clearly when a later-milestone tool is unavailable", async () => {
    const test = harness();
    const client = new FakeClient();

    const exitCode = await runCli(
      ["env", "ensure", "--slug", "pull-123"],
      dependencies(client, test.io)
    );

    expect(exitCode).toBe(1);
    expect(test.stderr.join("")).toContain("does not advertise ensure_environment");
  });

  it("closes the transport when MCP initialization fails", async () => {
    const test = harness();
    const client = new FakeClient();
    client.connect = async () => {
      throw new Error("initialization failed");
    };

    const exitCode = await runCli(["doctor"], dependencies(client, test.io));

    expect(exitCode).toBe(1);
    expect(client.closed).toBe(true);
    expect(test.stderr.join("")).toContain("initialization failed");
  });
});
