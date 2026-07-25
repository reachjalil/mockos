import { type MockLlmServerRecord, mockLlmServerRecordSchema } from "@mockos/contracts";
import type { BehaviorSpec } from "@mockos/contracts/behavior";
import { hashSecret } from "@mockos/core";
import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentMockLlmAnthropicRuntime,
  EnvironmentMockLlmOpenAiRuntime,
} from "./mock-llm-runtime";

const OPENAI_KEY = "synthetic-openai-provider-key";
const ROTATED_OPENAI_KEY = "rotated-openai-provider-key";
const ANTHROPIC_KEY = "synthetic-anthropic-provider-key";
const ROTATED_ANTHROPIC_KEY = "rotated-anthropic-provider-key";
const PLATFORM_ACCESS_KEY = "synthetic-platform-access-key";

type Authentication =
  | { readonly mode: "accept_any" }
  | { readonly mode: "strict"; readonly apiKey: string };

const serverRecord = async (
  input: {
    readonly authentication?: Authentication;
    readonly anthropicAuthentication?: Authentication;
    readonly behavior?: BehaviorSpec;
    readonly model?: string;
    readonly revision?: number;
  } = {}
): Promise<MockLlmServerRecord> => {
  const authentication = input.authentication ?? { mode: "accept_any" as const };
  const anthropicAuthentication = input.anthropicAuthentication;
  const persistedAuthentication = async (value: Authentication) =>
    value.mode === "accept_any"
      ? value
      : {
          mode: "strict" as const,
          apiKeySha256: await hashSecret(value.apiKey),
        };
  return mockLlmServerRecordSchema.parse({
    spec: {
      version: 1,
      slug: "agent-tests",
      name: "Agent tests",
      dialects: {
        openai: {
          enabled: true,
          authentication: await persistedAuthentication(authentication),
        },
        anthropic: anthropicAuthentication
          ? {
              enabled: true,
              authentication: await persistedAuthentication(anthropicAuthentication),
            }
          : { enabled: false },
      },
      models: [
        {
          id: input.model ?? "mockos-text-1",
          displayName: "Mock text",
          createdAtEpochSeconds: 123,
          behavior:
            input.behavior ??
            ({
              version: 1,
              type: "static",
              value: "Hello from current definition.",
            } satisfies BehaviorSpec),
        },
      ],
      defaultUsage: { inputTokens: 4, outputTokens: 2 },
      defaultCadence: {
        chunkDelayMilliseconds: 0,
        chunkSize: 256,
        maximumDurationMilliseconds: 60_000,
      },
    },
    revision: input.revision ?? 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  });
};

const chatRequest = (
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> => ({
  model: "mockos-text-1",
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

const messageRequest = (
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> => ({
  model: "mockos-text-1",
  max_tokens: 128,
  messages: [{ role: "user", content: "Hello" }],
  ...overrides,
});

describe("environment mock OpenAI runtime", () => {
  it("requires a bounded Bearer Mock Credential even in accept-any mode", async () => {
    const record = await serverRecord();
    const definitions = { get: vi.fn(() => record) };
    const runtime = new EnvironmentMockLlmOpenAiRuntime(definitions);

    await expect(runtime.getCatalog("agent-tests", OPENAI_KEY)).resolves.toEqual({
      ok: true,
      value: {
        models: [{ id: "mockos-text-1", createdAtEpochSeconds: 123 }],
      },
    });
    await expect(runtime.getCatalog("agent-tests", "short")).resolves.toEqual({
      ok: false,
      code: "authentication",
    });
  });

  it("compares strict credentials against only the current OpenAI verifier", async () => {
    const record = await serverRecord({
      authentication: { mode: "strict", apiKey: OPENAI_KEY },
    });
    const runtime = new EnvironmentMockLlmOpenAiRuntime({
      get: vi.fn(() => record),
    });

    expect(await runtime.getCatalog("agent-tests", OPENAI_KEY)).toMatchObject({
      ok: true,
    });
    expect(await runtime.getCatalog("agent-tests", ROTATED_OPENAI_KEY)).toEqual({
      ok: false,
      code: "authentication",
    });
  });

  it("accepts another valid synthetic value in accept-any, but rejects cross-provider strict and platform credentials", async () => {
    const [acceptAnyRecord, strictRecord] = await Promise.all([
      serverRecord(),
      serverRecord({
        authentication: { mode: "strict", apiKey: OPENAI_KEY },
      }),
    ]);
    const acceptAny = new EnvironmentMockLlmOpenAiRuntime(
      { get: vi.fn(() => acceptAnyRecord) },
      { platformApiKey: PLATFORM_ACCESS_KEY }
    );
    const strict = new EnvironmentMockLlmOpenAiRuntime(
      { get: vi.fn(() => strictRecord) },
      { platformApiKey: PLATFORM_ACCESS_KEY }
    );

    await expect(strict.getCatalog("agent-tests", ANTHROPIC_KEY)).resolves.toEqual({
      ok: false,
      code: "authentication",
    });
    await expect(
      acceptAny.getCatalog("agent-tests", ANTHROPIC_KEY)
    ).resolves.toMatchObject({
      ok: true,
    });
    for (const providerRuntime of [acceptAny, strict]) {
      await expect(
        providerRuntime.getCatalog("agent-tests", PLATFORM_ACCESS_KEY)
      ).resolves.toEqual({
        ok: false,
        code: "authentication",
      });
    }
  });

  it("hashes before reading the current definition during credential rotation", async () => {
    const oldRecord = await serverRecord({
      authentication: { mode: "strict", apiKey: OPENAI_KEY },
      revision: 1,
    });
    const rotatedRecord = await serverRecord({
      authentication: { mode: "strict", apiKey: ROTATED_OPENAI_KEY },
      revision: 2,
    });
    let current = oldRecord;
    const definitions = { get: vi.fn(() => current) };
    const runtime = new EnvironmentMockLlmOpenAiRuntime(definitions, {
      hashCredential: async (credential) => {
        current = rotatedRecord;
        return hashSecret(credential);
      },
    });

    expect(await runtime.getCatalog("agent-tests", ROTATED_OPENAI_KEY)).toMatchObject({
      ok: true,
    });
    expect(definitions.get).toHaveBeenCalledTimes(1);
  });

  it("rejects the platform Access Key and credential reflection without returning it", async () => {
    const record = await serverRecord();
    const runtime = new EnvironmentMockLlmOpenAiRuntime(
      { get: vi.fn(() => record) },
      { platformApiKey: "platform-access-key" }
    );

    expect(
      await runtime.getCatalog("agent-tests", "prefix-platform-access-key-suffix")
    ).toEqual({ ok: false, code: "authentication" });
    expect(
      await runtime.planChatCompletion(
        "agent-tests",
        OPENAI_KEY,
        chatRequest({
          messages: [
            {
              role: "user",
              content: `Do not echo ${OPENAI_KEY}`,
            },
          ],
        })
      )
    ).toEqual({ ok: false, code: "invalid_request" });
  });

  it("plans from normalized request state without credential-coupled identity", async () => {
    const record = await serverRecord();
    const runtime = new EnvironmentMockLlmOpenAiRuntime(
      { get: vi.fn(() => record) },
      { nowEpochSeconds: () => 1_800_000_000 }
    );
    const result = await runtime.planChatCompletion(
      "agent-tests",
      OPENAI_KEY,
      chatRequest({
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Previous answer" },
          { role: "user", content: "Second" },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "response",
        createdAtEpochSeconds: 1_800_000_000,
        turnIndex: 1,
        seed: "mock-llm:agent-tests:openai:v1",
        segments: [{ type: "text", text: "Hello from current definition." }],
      },
    });
    expect(JSON.stringify(result)).not.toContain(OPENAI_KEY);
  });

  it("discards a stale plan and replans against a concurrently replaced definition", async () => {
    const oldRecord = await serverRecord({
      revision: 1,
      behavior: { version: 1, type: "static", value: "Old response." },
    });
    const newRecord = await serverRecord({
      revision: 2,
      behavior: { version: 1, type: "static", value: "New response." },
    });
    const reads = [oldRecord, newRecord, newRecord, newRecord];
    const definitions = {
      get: vi.fn(() => reads.shift() ?? newRecord),
    };
    const runtime = new EnvironmentMockLlmOpenAiRuntime(definitions, {
      nowEpochSeconds: () => 1_800_000_000,
    });

    const result = await runtime.planChatCompletion(
      "agent-tests",
      OPENAI_KEY,
      chatRequest()
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        segments: [{ type: "text", text: "New response." }],
      },
    });
    expect(definitions.get).toHaveBeenCalledTimes(4);
  });

  it("fails safely for a missing model or unstable definition", async () => {
    const records = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((revision) => serverRecord({ revision }))
    );
    const unstable = new EnvironmentMockLlmOpenAiRuntime({
      get: vi.fn(() => records.shift()),
    });
    expect(
      await unstable.planChatCompletion("agent-tests", OPENAI_KEY, chatRequest())
    ).toEqual({ ok: false, code: "internal" });

    const stableRecord = await serverRecord();
    const stable = new EnvironmentMockLlmOpenAiRuntime({
      get: vi.fn(() => stableRecord),
    });
    expect(
      await stable.planChatCompletion(
        "agent-tests",
        OPENAI_KEY,
        chatRequest({ model: "missing-model" })
      )
    ).toEqual({ ok: false, code: "model_not_found" });
  });
});

describe("environment mock Anthropic runtime", () => {
  it("does not fall back to an enabled OpenAI dialect", async () => {
    const record = await serverRecord();
    const runtime = new EnvironmentMockLlmAnthropicRuntime({
      get: vi.fn(() => record),
    });

    await expect(runtime.getCatalog("agent-tests", OPENAI_KEY)).resolves.toEqual({
      ok: false,
      code: "dialect_disabled",
    });
  });

  it("returns the Anthropic catalog in accept-any mode", async () => {
    const record = await serverRecord({
      anthropicAuthentication: { mode: "accept_any" },
    });
    const runtime = new EnvironmentMockLlmAnthropicRuntime({
      get: vi.fn(() => record),
    });

    await expect(runtime.getCatalog("agent-tests", ANTHROPIC_KEY)).resolves.toEqual({
      ok: true,
      value: {
        models: [
          {
            id: "mockos-text-1",
            displayName: "Mock text",
            createdAtEpochSeconds: 123,
          },
        ],
      },
    });
    await expect(runtime.getCatalog("agent-tests", OPENAI_KEY)).resolves.toMatchObject({
      ok: true,
    });
    await expect(runtime.getCatalog("agent-tests", "short")).resolves.toEqual({
      ok: false,
      code: "authentication",
    });
  });

  it("selects only the current verifier for each strict dialect", async () => {
    const record = await serverRecord({
      authentication: { mode: "strict", apiKey: OPENAI_KEY },
      anthropicAuthentication: { mode: "strict", apiKey: ANTHROPIC_KEY },
    });
    const definitions = { get: vi.fn(() => record) };
    const openai = new EnvironmentMockLlmOpenAiRuntime(definitions);
    const anthropic = new EnvironmentMockLlmAnthropicRuntime(definitions);

    await expect(openai.getCatalog("agent-tests", OPENAI_KEY)).resolves.toMatchObject({
      ok: true,
    });
    await expect(openai.getCatalog("agent-tests", ANTHROPIC_KEY)).resolves.toEqual({
      ok: false,
      code: "authentication",
    });
    await expect(
      anthropic.getCatalog("agent-tests", ANTHROPIC_KEY)
    ).resolves.toMatchObject({ ok: true });
    await expect(anthropic.getCatalog("agent-tests", OPENAI_KEY)).resolves.toEqual({
      ok: false,
      code: "authentication",
    });
  });

  it("hashes before reading the current Anthropic verifier during rotation", async () => {
    const oldRecord = await serverRecord({
      anthropicAuthentication: { mode: "strict", apiKey: ANTHROPIC_KEY },
      revision: 1,
    });
    const rotatedRecord = await serverRecord({
      anthropicAuthentication: {
        mode: "strict",
        apiKey: ROTATED_ANTHROPIC_KEY,
      },
      revision: 2,
    });
    let current = oldRecord;
    const definitions = { get: vi.fn(() => current) };
    const runtime = new EnvironmentMockLlmAnthropicRuntime(definitions, {
      hashCredential: async (credential) => {
        current = rotatedRecord;
        return hashSecret(credential);
      },
    });

    await expect(
      runtime.getCatalog("agent-tests", ROTATED_ANTHROPIC_KEY)
    ).resolves.toMatchObject({ ok: true });
    expect(definitions.get).toHaveBeenCalledTimes(1);
  });

  it("parses bounded Messages input and plans with Anthropic identity", async () => {
    const record = await serverRecord({
      anthropicAuthentication: { mode: "accept_any" },
    });
    const runtime = new EnvironmentMockLlmAnthropicRuntime(
      { get: vi.fn(() => record) },
      { nowEpochSeconds: () => 1_800_000_000 }
    );

    const result = await runtime.planMessage(
      "agent-tests",
      ANTHROPIC_KEY,
      messageRequest({
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Previous answer" },
          { role: "user", content: "Second" },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "response",
        createdAtEpochSeconds: 1_800_000_000,
        turnIndex: 1,
        seed: "mock-llm:agent-tests:anthropic:v1",
        segments: [{ type: "text", text: "Hello from current definition." }],
      },
    });
    expect(JSON.stringify(result)).not.toContain(ANTHROPIC_KEY);
    await expect(
      runtime.planMessage(
        "agent-tests",
        ANTHROPIC_KEY,
        messageRequest({ max_tokens: 0 })
      )
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it("rejects platform and reflected credentials before planning", async () => {
    const record = await serverRecord({
      anthropicAuthentication: { mode: "accept_any" },
    });
    const runtime = new EnvironmentMockLlmAnthropicRuntime(
      { get: vi.fn(() => record) },
      { platformApiKey: PLATFORM_ACCESS_KEY }
    );

    await expect(
      runtime.getCatalog("agent-tests", `prefix-${PLATFORM_ACCESS_KEY}-suffix`)
    ).resolves.toEqual({ ok: false, code: "authentication" });
    await expect(
      runtime.planMessage(
        "agent-tests",
        ANTHROPIC_KEY,
        messageRequest({
          messages: [
            {
              role: "user",
              content: `Do not echo ${ANTHROPIC_KEY}`,
            },
          ],
        })
      )
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it("discards a stale Anthropic plan and replans against the current revision", async () => {
    const oldRecord = await serverRecord({
      anthropicAuthentication: { mode: "accept_any" },
      revision: 1,
      behavior: { version: 1, type: "static", value: "Old response." },
    });
    const newRecord = await serverRecord({
      anthropicAuthentication: { mode: "accept_any" },
      revision: 2,
      behavior: { version: 1, type: "static", value: "New response." },
    });
    const reads = [oldRecord, newRecord, newRecord, newRecord];
    const definitions = {
      get: vi.fn(() => reads.shift() ?? newRecord),
    };
    const runtime = new EnvironmentMockLlmAnthropicRuntime(definitions, {
      nowEpochSeconds: () => 1_800_000_000,
    });

    await expect(
      runtime.planMessage("agent-tests", ANTHROPIC_KEY, messageRequest())
    ).resolves.toMatchObject({
      ok: true,
      value: {
        segments: [{ type: "text", text: "New response." }],
      },
    });
    expect(definitions.get).toHaveBeenCalledTimes(4);
  });
});
