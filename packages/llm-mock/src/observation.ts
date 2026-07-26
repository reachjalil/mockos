import type { MockLlmErrorKind, MockLlmStopReason } from "@mockos/contracts/mock-llm";

export type MockLlmProviderDialect = "anthropic" | "openai";

export type MockLlmProviderOperation = "chat.completions.create" | "messages.create";

export type MockLlmProviderTerminalOutcome =
  | "completed"
  | "cancelled"
  | "deadline_exceeded"
  | "failed";

export type MockLlmProviderResponseObservation = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: MockLlmStopReason;
  /**
   * Tool names retain plan order and duplicates. Tool inputs and output text
   * are intentionally excluded from provider observations.
   */
  readonly toolNames: readonly string[];
};

type MockLlmProviderObservationStartBase = {
  /**
   * The fresh provider request ID is also the observation identity.
   */
  readonly observationId: string;
  readonly slug: string;
  readonly method: "POST";
  readonly model: string;
  /**
   * Whether the accepted request asked for streaming. Configured provider
   * errors can still be delivered as JSON before response headers.
   */
  readonly stream: boolean;
  readonly turnIndex: number;
};

type MockLlmOpenAiProviderObservationStart = MockLlmProviderObservationStartBase & {
  readonly dialect: "openai";
  readonly operation: "chat.completions.create";
  readonly path: "/chat/completions";
};

type MockLlmAnthropicProviderObservationStart = MockLlmProviderObservationStartBase & {
  readonly dialect: "anthropic";
  readonly operation: "messages.create";
  readonly path: "/v1/messages";
};

type MockLlmProviderObservationResult =
  | {
      /**
       * A response/message ID preallocated for the delivered response plan.
       */
      readonly responseId: string;
      readonly response: MockLlmProviderResponseObservation;
      readonly errorKind?: never;
    }
  | {
      readonly responseId?: never;
      readonly response?: never;
      readonly errorKind: MockLlmErrorKind;
    };

export type MockLlmProviderObservationStart = (
  | MockLlmOpenAiProviderObservationStart
  | MockLlmAnthropicProviderObservationStart
) &
  MockLlmProviderObservationResult;

export type MockLlmProviderObservationFinish = {
  readonly observationId: string;
  readonly outcome: MockLlmProviderTerminalOutcome;
  readonly responseStatus: number;
  readonly durationMilliseconds: number;
};

export const MOCK_LLM_OBSERVATION_RESERVATION_BUDGET_MILLISECONDS = 50;

const PROSPECTIVE_LLM_OBSERVATION_LIFECYCLE_METADATA = {
  pending: {
    outcome: "pending",
    responseStatus: 102,
    durationMilliseconds: 0,
  },
  terminalOutcomes: [
    "completed",
    "cancelled",
    "deadline_exceeded",
    "failed",
  ] satisfies readonly MockLlmProviderTerminalOutcome[],
} as const;

export type MockLlmProviderObservationPrivacyGuard = (
  prospectiveMetadata: unknown
) => boolean;

/**
 * Builds a request-local guard for every value which might become durable
 * observation metadata. Numeric values are checked too: a syntactically valid
 * Mock Credential can contain only decimal digits.
 */
export const createMockLlmProviderObservationPrivacyGuard = (
  secrets: readonly (string | undefined)[]
): MockLlmProviderObservationPrivacyGuard => {
  const candidates = secrets.filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0
  );
  return (root) => {
    if (candidates.length === 0) return true;
    const pending: unknown[] = [root];
    const seen = new WeakSet<object>();
    while (pending.length > 0) {
      const value = pending.pop();
      if (
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "bigint") &&
        candidates.some((secret) => String(value).includes(secret))
      ) {
        return false;
      }
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (candidates.some((secret) => key.includes(secret))) return false;
        pending.push(child);
      }
    }
    return true;
  };
};

/**
 * Provider observation storage is deliberately outside the HTTP adapter. A
 * reserve failure or privacy collision is fail-open; finish is best-effort and
 * scheduled through the supplied edge-lifetime hook.
 */
export type MockLlmProviderObservationHook = {
  readonly reserve: (
    event: MockLlmProviderObservationStart,
    privacyGuard: MockLlmProviderObservationPrivacyGuard
  ) => Promise<void> | void;
  readonly finish: (
    event: MockLlmProviderObservationFinish,
    privacyGuard: MockLlmProviderObservationPrivacyGuard
  ) => Promise<void> | void;
  readonly waitUntil?: (promise: Promise<void>) => void;
};

export const reserveMockLlmProviderObservation = async (
  hook: MockLlmProviderObservationHook | undefined,
  event: MockLlmProviderObservationStart,
  privacyGuard: MockLlmProviderObservationPrivacyGuard,
  additionalProspectiveMetadata: unknown
): Promise<boolean> => {
  if (!hook) return false;
  if (
    !privacyGuard(event) ||
    !privacyGuard(additionalProspectiveMetadata) ||
    !privacyGuard(PROSPECTIVE_LLM_OBSERVATION_LIFECYCLE_METADATA)
  ) {
    return false;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const reservation = Promise.resolve(hook.reserve(event, privacyGuard)).then(
      () => true,
      () => false
    );
    const budget = new Promise<false>((resolve) => {
      timeout = setTimeout(
        () => resolve(false),
        MOCK_LLM_OBSERVATION_RESERVATION_BUDGET_MILLISECONDS
      );
    });
    return await Promise.race([reservation, budget]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

export const scheduleMockLlmProviderObservationFinish = (
  hook: MockLlmProviderObservationHook | undefined,
  reserved: boolean,
  event: MockLlmProviderObservationFinish | Promise<MockLlmProviderObservationFinish>,
  privacyGuard: MockLlmProviderObservationPrivacyGuard
): void => {
  if (!hook || !reserved) return;
  const settled = Promise.resolve(event)
    .then((resolvedEvent) =>
      privacyGuard(resolvedEvent) ? hook.finish(resolvedEvent, privacyGuard) : undefined
    )
    .then(
      () => {},
      () => {}
    );
  try {
    hook.waitUntil?.(settled);
  } catch {
    // Observation lifetime hooks are also fail-open.
  }
};
