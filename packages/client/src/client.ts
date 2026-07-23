import {
  type ApplicationRegistration,
  type CreateApplicationInput,
  type EnvironmentConfig,
  type IdentitySeed,
  type SeedIdentitiesResult,
  problemSchema,
} from "@mockos/contracts";
import {
  type MockosHttpOperation,
  type MockosHttpOperationId as ContractMockosHttpOperationId,
  type OidcDiscoveryDocument,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
import type { z } from "zod";
import { MockosApiError, MockosProtocolError } from "./errors.js";
import {
  type GeneratedMockosHttpOperationId,
  generatedMockosHttpOperations,
} from "./generated.js";

type HttpOperations = typeof mockosHttpOperations;
export type MockosHttpOperationId = ContractMockosHttpOperationId;

type HttpDefinition<OperationId extends MockosHttpOperationId> =
  HttpOperations[OperationId] extends {
    http: infer Http;
  }
    ? Http
    : never;

type SchemaAt<Http, Key extends PropertyKey> = Key extends keyof Http
  ? Http[Key]
  : never;

type SchemaInput<Schema> = Schema extends z.ZodType ? z.input<Schema> : never;
type SchemaOutput<Schema> = [Schema] extends [never]
  ? never
  : Schema extends z.ZodType
    ? z.output<Schema>
    : never;

type InputField<Key extends string, Schema> = [Schema] extends [never]
  ? { [Field in Key]?: never }
  : Schema extends z.ZodType
    ? { [Field in Key]: SchemaInput<Schema> }
    : { [Field in Key]?: never };

export type MockosHttpOperationInput<OperationId extends MockosHttpOperationId> =
  InputField<"path", SchemaAt<HttpDefinition<OperationId>, "pathSchema">> &
    InputField<"query", SchemaAt<HttpDefinition<OperationId>, "querySchema">> &
    InputField<"body", SchemaAt<HttpDefinition<OperationId>, "bodySchema">>;

export type MockosHttpOperationOutput<OperationId extends MockosHttpOperationId> =
  SchemaOutput<SchemaAt<HttpDefinition<OperationId>, "responseSchema">>;

export type MockosClientOptions = {
  endpoint: string | URL;
  accessKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export type MockosRequestOptions = {
  signal?: AbortSignal;
};

const normalizedEndpoint = (input: string | URL): URL => {
  const endpoint = new URL(input);
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new TypeError("mockOS client endpoint must use http or https.");
  }
  if (endpoint.username || endpoint.password) {
    throw new TypeError("mockOS client endpoint cannot contain credentials.");
  }
  if (endpoint.search || endpoint.hash) {
    throw new TypeError("mockOS client endpoint cannot contain a query or fragment.");
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/`;
  return endpoint;
};

const relativeOperationPath = (
  template: string,
  rawPath: unknown,
  pathSchema: z.ZodType | undefined
): string => {
  if (
    !template.startsWith("/") ||
    template.startsWith("//") ||
    template.includes("://")
  ) {
    throw new MockosProtocolError(
      "The generated mockOS operation path is not origin-relative."
    );
  }
  const path = pathSchema ? pathSchema.parse(rawPath) : {};
  const parameters =
    path !== null && typeof path === "object" ? (path as Record<string, unknown>) : {};
  const rendered = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => {
    const value = parameters[name];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new MockosProtocolError(`Missing generated path parameter: ${name}.`);
    }
    return encodeURIComponent(String(value));
  });
  if (rendered.includes("{") || rendered.includes("}")) {
    throw new MockosProtocolError("The generated mockOS path template is invalid.");
  }
  return rendered;
};

const appendQuery = (url: URL, query: unknown): void => {
  if (query === undefined) return;
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    throw new MockosProtocolError("A mockOS operation query must be an object.");
  }
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined) continue;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new MockosProtocolError(`Unsupported generated query value for ${key}.`);
      }
      url.searchParams.append(key, String(value));
    }
  }
};

const requestSignal = (
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("mockOS request timed out.", "TimeoutError")),
    timeoutMs
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardAbort);
    },
  };
};

const responseJson = async (
  response: Response,
  signal: AbortSignal
): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    throw new MockosProtocolError(
      `mockOS returned non-JSON content with status ${response.status}.`,
      response.status
    );
  }
};

export class MockosClient {
  readonly #endpoint: URL;
  readonly #accessKey?: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: MockosClientOptions) {
    this.#endpoint = normalizedEndpoint(options.endpoint);
    const accessKey = options.accessKey?.trim();
    if (options.accessKey !== undefined && !accessKey) {
      throw new TypeError("mockOS accessKey cannot be empty.");
    }
    this.#accessKey = accessKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new TypeError("mockOS timeoutMs must be a positive integer.");
    }
  }

  async request<OperationId extends MockosHttpOperationId>(
    operationId: OperationId,
    input: MockosHttpOperationInput<OperationId>,
    options: MockosRequestOptions = {}
  ): Promise<MockosHttpOperationOutput<OperationId>> {
    const operation = mockosHttpOperations[operationId];
    if (operation === undefined || typeof operation !== "object") {
      throw new MockosProtocolError(`${String(operationId)} is not an HTTP operation.`);
    }
    const http = operation.http as MockosHttpOperation;
    const generated =
      generatedMockosHttpOperations[operationId as GeneratedMockosHttpOperationId];
    if (!generated || generated.operationId !== operationId) {
      throw new MockosProtocolError(
        `Generated metadata is missing for ${String(operationId)}.`
      );
    }

    const rawInput = input as Record<string, unknown>;
    const path = relativeOperationPath(generated.path, rawInput.path, http.pathSchema);
    const url = new URL(path.slice(1), this.#endpoint);
    const query = http.querySchema ? http.querySchema.parse(rawInput.query) : undefined;
    appendQuery(url, query);

    const headers = new Headers({ Accept: "application/json" });
    if (this.#accessKey) {
      headers.set("Authorization", `Bearer ${this.#accessKey}`);
    }
    let body: string | undefined;
    if (http.bodySchema) {
      body = JSON.stringify(http.bodySchema.parse(rawInput.body));
      headers.set("Content-Type", "application/json");
    }

    const { signal, cleanup } = requestSignal(options.signal, this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: generated.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
      });

      if (!response.ok) {
        const rawProblem = await responseJson(response, signal);
        const parsedProblem = problemSchema.safeParse(rawProblem);
        if (!parsedProblem.success || parsedProblem.data.status !== response.status) {
          throw new MockosProtocolError(
            `mockOS returned an invalid problem document with status ${response.status}.`,
            response.status
          );
        }
        throw new MockosApiError(parsedProblem.data, response.status);
      }
      if (response.status !== generated.successStatus) {
        throw new MockosProtocolError(
          `mockOS returned ${response.status}; ${generated.operationId} requires ${generated.successStatus}.`,
          response.status
        );
      }
      const rawOutput =
        generated.successStatus === 204
          ? undefined
          : await responseJson(response, signal);
      const parsedOutput = http.responseSchema.safeParse(rawOutput);
      if (!parsedOutput.success) {
        throw new MockosProtocolError(
          `mockOS returned an invalid success document for ${generated.operationId}.`,
          response.status
        );
      }
      return parsedOutput.data as MockosHttpOperationOutput<OperationId>;
    } finally {
      cleanup();
    }
  }

  configureEnvironment(
    environmentId: string,
    config: EnvironmentConfig,
    options?: MockosRequestOptions
  ) {
    return this.request(
      "configure_environment",
      { path: { environmentId }, body: config },
      options
    );
  }

  seedIdentities(
    environmentId: string,
    seed: IdentitySeed,
    options?: MockosRequestOptions
  ): Promise<{ data: SeedIdentitiesResult; meta: { requestId: string } }> {
    return this.request(
      "seed_identities",
      { path: { environmentId }, body: seed },
      options
    );
  }

  createApplication(
    environmentId: string,
    application: CreateApplicationInput,
    options?: MockosRequestOptions
  ): Promise<{ data: ApplicationRegistration; meta: { requestId: string } }> {
    return this.request(
      "create_application",
      { path: { environmentId }, body: application },
      options
    );
  }

  getEnvironmentDiscovery(
    environmentId: string,
    issuerBase: string,
    options?: MockosRequestOptions
  ): Promise<{ data: OidcDiscoveryDocument; meta: { requestId: string } }> {
    return this.request(
      "get_environment_discovery",
      {
        path: { environmentId },
        query: { issuer_base: issuerBase },
      },
      options
    );
  }

  deleteEnvironment(environmentId: string, options?: MockosRequestOptions) {
    return this.request("delete_environment", { path: { environmentId } }, options);
  }
}
