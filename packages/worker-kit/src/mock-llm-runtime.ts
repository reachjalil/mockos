import {
  type MockLlmServerRecord,
  mockLlmMockCredentialSchema,
  mockLlmSlugSchema,
} from "@mockos/contracts";
import { hashSecret, type MockLlmRepository } from "@mockos/core";
import {
  type MockLlmOpenAiCatalog,
  type MockLlmOpenAiRuntimeResult,
  mockLlmValueContainsSecret,
  MockLlmOpenAiRequestError,
  parseMockLlmOpenAiChatRequest,
  planMockLlmResponse,
} from "@mockos/llm-mock";

type MockLlmDefinitionReader = Pick<MockLlmRepository, "get">;

type MockLlmOpenAiRuntimeOptions = {
  readonly platformApiKey?: string;
  readonly hashCredential?: (credential: string) => Promise<string>;
  readonly nowEpochSeconds?: () => number;
};

const sameSecret = (left: string, right: string): boolean => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const failure = <Value>(
  code: Exclude<MockLlmOpenAiRuntimeResult<Value>, { readonly ok: true }>["code"]
): MockLlmOpenAiRuntimeResult<Value> => ({ ok: false, code });

const success = <Value>(value: Value): MockLlmOpenAiRuntimeResult<Value> => ({
  ok: true,
  value,
});

export class EnvironmentMockLlmOpenAiRuntime {
  readonly #definitions: MockLlmDefinitionReader;
  readonly #hashCredential: (credential: string) => Promise<string>;
  readonly #nowEpochSeconds: () => number;
  readonly #platformApiKey?: string;

  constructor(
    definitions: MockLlmDefinitionReader,
    options: MockLlmOpenAiRuntimeOptions = {}
  ) {
    this.#definitions = definitions;
    this.#hashCredential = options.hashCredential ?? hashSecret;
    this.#nowEpochSeconds =
      options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000));
    this.#platformApiKey = options.platformApiKey?.trim() || undefined;
  }

  async #authenticatedServer(
    rawSlug: string,
    rawCredential: string
  ): Promise<MockLlmOpenAiRuntimeResult<MockLlmServerRecord>> {
    const slug = mockLlmSlugSchema.safeParse(rawSlug);
    const credential = mockLlmMockCredentialSchema.safeParse(rawCredential);
    if (!slug.success || !credential.success) return failure("authentication");
    if (this.#platformApiKey && credential.data.includes(this.#platformApiKey)) {
      return failure("authentication");
    }

    // Hash before selecting the current definition so a concurrent key rotation
    // cannot authenticate a request against a stale verifier snapshot.
    const credentialSha256 = await this.#hashCredential(credential.data);
    const server = this.#definitions.get(slug.data);
    if (!server) return failure("server_not_found");
    const dialect = server.spec.dialects.openai;
    if (!dialect.enabled) return failure("dialect_disabled");
    if (
      dialect.authentication.mode === "strict" &&
      !sameSecret(credentialSha256, dialect.authentication.apiKeySha256)
    ) {
      return failure("authentication");
    }
    return success(server);
  }

  async getCatalog(
    slug: string,
    credential: string
  ): Promise<MockLlmOpenAiRuntimeResult<MockLlmOpenAiCatalog>> {
    try {
      const authenticated = await this.#authenticatedServer(slug, credential);
      if (!authenticated.ok) return authenticated;
      return success({
        models: authenticated.value.spec.models.map((model) => ({
          id: model.id,
          createdAtEpochSeconds: model.createdAtEpochSeconds,
        })),
      });
    } catch {
      return failure("internal");
    }
  }

  async planChatCompletion(
    slug: string,
    credential: string,
    request: unknown
  ): Promise<
    MockLlmOpenAiRuntimeResult<Awaited<ReturnType<typeof planMockLlmResponse>>["plan"]>
  > {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const authenticated = await this.#authenticatedServer(slug, credential);
        if (!authenticated.ok) return authenticated;
        if (mockLlmValueContainsSecret(request, [credential, this.#platformApiKey])) {
          return failure("invalid_request");
        }
        const parsed = parseMockLlmOpenAiChatRequest(request);
        const model = authenticated.value.spec.models.find(
          (candidate) => candidate.id === parsed.model
        );
        if (!model) return failure("model_not_found");

        const planned = await planMockLlmResponse({
          behavior: model.behavior,
          requestFingerprintInput: parsed.fingerprint,
          model: model.id,
          createdAtEpochSeconds: this.#nowEpochSeconds(),
          turnIndex: parsed.turnIndex,
          seed: `mock-llm:${authenticated.value.spec.slug}:openai:v1`,
          stateKey: `llm:${authenticated.value.spec.slug}:openai:${model.id}`,
          defaultUsage: authenticated.value.spec.defaultUsage,
          defaultCadence: authenticated.value.spec.defaultCadence,
        });
        const current = this.#definitions.get(authenticated.value.spec.slug);
        if (!current || current.revision !== authenticated.value.revision) {
          // Do not commit a plan selected from a replaced definition. Re-read,
          // re-authenticate, and re-plan against the new current revision.
          continue;
        }
        planned.commit();
        return success(planned.plan);
      } catch (error) {
        return failure(
          error instanceof MockLlmOpenAiRequestError ? "invalid_request" : "internal"
        );
      }
    }
    return failure("internal");
  }
}
