import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ToolDescription = {
  name: string;
  description?: string;
};

export type ToolCallResult = {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
};

export interface ToolClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<ToolDescription[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<ToolCallResult>;
  serverInfo(): { name?: string; version?: string } | undefined;
}

export type McpToolClientOptions = {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export class McpToolClient implements ToolClient {
  readonly #client = new Client({ name: "mockos-cli", version: "0.1.0" });
  readonly #transport: StreamableHTTPClientTransport;
  readonly #timeoutMs: number;
  #connected = false;
  #started = false;

  constructor(options: McpToolClientOptions) {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "User-Agent": "mockos-cli/0.1.0",
    });
    if (options.apiKey) headers.set("Authorization", `Bearer ${options.apiKey}`);
    this.#transport = new StreamableHTTPClientTransport(new URL(options.endpoint), {
      requestInit: { headers },
      fetch: options.fetch,
    });
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    this.#started = true;
    await this.#client.connect(this.#transport, { timeout: this.#timeoutMs });
    this.#connected = true;
  }

  async close(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    try {
      if (this.#transport.sessionId) {
        await this.#transport.terminateSession();
      }
    } finally {
      this.#connected = false;
      await this.#client.close();
    }
  }

  async listTools(): Promise<ToolDescription[]> {
    this.#assertConnected();
    const result = await this.#client.listTools(undefined, {
      timeout: this.#timeoutMs,
    });
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
    }));
  }

  async callTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolCallResult> {
    this.#assertConnected();
    return (await this.#client.callTool({ name, arguments: input }, undefined, {
      timeout: this.#timeoutMs,
    })) as ToolCallResult;
  }

  serverInfo(): { name?: string; version?: string } | undefined {
    const value = this.#client.getServerVersion();
    if (!value) return undefined;
    return { name: value.name, version: value.version };
  }

  #assertConnected(): void {
    if (!this.#connected) throw new Error("mockOS MCP client is not connected");
  }
}

export function unwrapToolResult(result: ToolCallResult): unknown {
  if (result.isError) {
    throw new Error(readTextContent(result.content) ?? "mockOS tool returned an error");
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = readTextContent(result.content);
  if (text === undefined) return { content: result.content };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readTextContent(content: unknown[]): string | undefined {
  const parts: string[] = [];
  for (const item of content) {
    if (
      item !== null &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      parts.push(item.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
