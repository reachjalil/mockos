import {
  assertBehaviorSpecBounds,
  type BehaviorSpec,
  type JsonValue,
  jsonValueSchema,
  parseBehaviorSpec,
} from "@mockos/contracts/behavior";
import {
  type MockLlmPlan,
  mockLlmCadenceSchema,
  mockLlmModelSchema,
  mockLlmUsageSchema,
  parseMockLlmPlan,
} from "@mockos/contracts/mock-llm";
import {
  type BehaviorStateAccess,
  evaluateBehavior,
  type ScriptBehaviorExecutor,
  sha256,
  sha256Base64Url,
} from "@mockos/core";
import { canonicalMockLlmJson } from "./canonical-json";

const SENSITIVE_NORMALIZED_REQUEST_FIELD =
  /(?:authorization|authentication|cookie|password|secret|apikey|credential|privatekey|bearer)/u;
const CREDENTIAL_NORMALIZED_REQUEST_FIELD =
  /^(?:[a-z0-9]*token|jwt|assertion|clientassertion|samlassertion|(?:access|refresh|session|auth|authorization|bearer|id|api|oauth\d*|csrf|client|xapi)tokens|token(?:value|secret))$/u;
const RESPONSE_DIRECTIVE_FIELDS = new Set([
  "segments",
  "stopReason",
  "stopSequence",
  "usage",
  "cadence",
]);
const RESPONSE_CADENCE_FIELDS = new Set([
  "chunkDelayMilliseconds",
  "chunkSize",
  "maximumDurationMilliseconds",
]);
const MOCK_LLM_MAX_FINGERPRINT_BYTES = 256 * 1024;
const MOCK_LLM_MAX_FINGERPRINT_DEPTH = 24;
const MOCK_LLM_MAX_FINGERPRINT_NODES = 10_000;

export type MockLlmUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type MockLlmCadenceDefaults = {
  readonly chunkDelayMilliseconds: number;
  readonly chunkSize: number;
  readonly maximumDurationMilliseconds: number;
};

export type MockLlmPlanningInput = {
  readonly behavior: BehaviorSpec;
  /**
   * Canonical, normalized protocol input only. Headers and credentials are forbidden
   * because this object becomes part of the stable request fingerprint.
   */
  readonly requestFingerprintInput: Readonly<Record<string, JsonValue>>;
  readonly model: string;
  readonly createdAtEpochSeconds: number;
  readonly turnIndex: number;
  readonly seed: string;
  readonly defaultUsage: MockLlmUsage;
  readonly defaultCadence: MockLlmCadenceDefaults;
  /**
   * Defaults to request-derived stateless sequence selection. A future persistence
   * owner may inject revision-bound state explicitly.
   */
  readonly state?: BehaviorStateAccess;
  readonly stateKey?: string;
  readonly scripts?: ScriptBehaviorExecutor;
};

export type MockLlmPlanningResult = {
  readonly plan: MockLlmPlan;
  readonly stateWrites: Readonly<Record<string, JsonValue>>;
  commit(): void;
};

export class MockLlmPlanningError extends Error {
  constructor(
    readonly code:
      | "invalid_fingerprint_input"
      | "invalid_behavior_input"
      | "invalid_planning_metadata"
      | "sensitive_request_field"
      | "invalid_response_directive"
      | "provider_error_leak",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MockLlmPlanningError";
  }
}

const deepFreeze = <Value>(root: Value): Value => {
  if (!root || typeof root !== "object") return root;
  const pending: object[] = [root];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") pending.push(child);
    }
    Object.freeze(value);
  }
  return root;
};

const canonicalClone = <Value>(value: Value): Value =>
  JSON.parse(canonicalMockLlmJson(value)) as Value;

const normalizedFieldName = (field: string): string =>
  field.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();

const isSensitiveFingerprintField = (field: string): boolean => {
  const normalized = normalizedFieldName(field);
  return (
    SENSITIVE_NORMALIZED_REQUEST_FIELD.test(normalized) ||
    CREDENTIAL_NORMALIZED_REQUEST_FIELD.test(normalized)
  );
};

const parseCredentialFreeFingerprint = (
  value: unknown
): Readonly<Record<string, JsonValue>> => {
  try {
    assertBehaviorSpecBounds(value, {
      maximumBytes: MOCK_LLM_MAX_FINGERPRINT_BYTES,
      maximumDepth: MOCK_LLM_MAX_FINGERPRINT_DEPTH,
      maximumNodes: MOCK_LLM_MAX_FINGERPRINT_NODES,
    });
  } catch (cause) {
    throw new MockLlmPlanningError(
      "invalid_fingerprint_input",
      "The normalized LLM request exceeds its fingerprint bounds.",
      { cause }
    );
  }

  let parsed: JsonValue;
  try {
    parsed = jsonValueSchema.parse(value);
  } catch (cause) {
    throw new MockLlmPlanningError(
      "invalid_fingerprint_input",
      "The normalized LLM request must be a finite JSON object.",
      { cause }
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MockLlmPlanningError(
      "invalid_fingerprint_input",
      "The normalized LLM request must be a JSON object."
    );
  }

  const detached = canonicalClone(parsed);
  const pending: JsonValue[] = [detached];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (isSensitiveFingerprintField(key)) {
        throw new MockLlmPlanningError(
          "sensitive_request_field",
          "Sensitive request fields cannot be included in an LLM fingerprint."
        );
      }
      pending.push(child);
    }
  }
  return deepFreeze(detached);
};

type SnapshotPlanningInput = Omit<
  MockLlmPlanningInput,
  | "behavior"
  | "requestFingerprintInput"
  | "defaultUsage"
  | "defaultCadence"
  | "state"
  | "scripts"
> & {
  readonly behavior: BehaviorSpec;
  readonly requestFingerprintInput: Readonly<Record<string, JsonValue>>;
  readonly defaultUsage: MockLlmUsage;
  readonly defaultCadence: MockLlmCadenceDefaults;
  readonly state: BehaviorStateAccess;
  readonly scripts?: ScriptBehaviorExecutor;
};

const bindBehaviorState = (state: BehaviorStateAccess): BehaviorStateAccess => {
  const read = state.read.bind(state);
  const write = state.write.bind(state);
  const transaction = state.transaction.bind(
    state
  ) as BehaviorStateAccess["transaction"];
  return Object.freeze({ read, write, transaction });
};

const bindScriptExecutor = (scripts: ScriptBehaviorExecutor): ScriptBehaviorExecutor =>
  Object.freeze({
    execute: scripts.execute.bind(scripts),
  });

const parsePlanningMetadata = (
  input: MockLlmPlanningInput
): Pick<
  SnapshotPlanningInput,
  | "model"
  | "createdAtEpochSeconds"
  | "turnIndex"
  | "seed"
  | "defaultUsage"
  | "defaultCadence"
> => {
  try {
    if (
      !Number.isSafeInteger(input.createdAtEpochSeconds) ||
      input.createdAtEpochSeconds < 0 ||
      !Number.isSafeInteger(input.turnIndex) ||
      input.turnIndex < 0 ||
      typeof input.seed !== "string" ||
      input.seed.length < 1 ||
      input.seed.length > 256
    ) {
      throw new TypeError("Invalid mock LLM identity metadata.");
    }
    const cadence = mockLlmCadenceSchema.parse({
      ...input.defaultCadence,
      initialDelayMilliseconds: 0,
    });
    return {
      model: mockLlmModelSchema.parse(input.model),
      createdAtEpochSeconds: input.createdAtEpochSeconds,
      turnIndex: input.turnIndex,
      seed: input.seed,
      defaultUsage: deepFreeze(mockLlmUsageSchema.parse(input.defaultUsage)),
      defaultCadence: Object.freeze({
        chunkDelayMilliseconds: cadence.chunkDelayMilliseconds,
        chunkSize: cadence.chunkSize,
        maximumDurationMilliseconds: cadence.maximumDurationMilliseconds,
      }),
    };
  } catch (cause) {
    throw new MockLlmPlanningError(
      "invalid_planning_metadata",
      "Mock LLM identity, usage, and cadence defaults must satisfy the neutral plan contract.",
      { cause }
    );
  }
};

/**
 * Detaches all caller-owned planning data synchronously. The first asynchronous
 * boundary is the request hash, so later caller mutations cannot change evaluation
 * or plan identity while planning is in flight.
 */
const snapshotPlanningInput = (input: MockLlmPlanningInput): SnapshotPlanningInput => {
  const requestFingerprintInput = parseCredentialFreeFingerprint(
    input.requestFingerprintInput
  );
  let behavior: BehaviorSpec;
  try {
    behavior = deepFreeze(canonicalClone(parseBehaviorSpec(input.behavior)));
  } catch (cause) {
    throw new MockLlmPlanningError(
      "invalid_behavior_input",
      "The mock LLM behavior must be a valid bounded behavior document.",
      { cause }
    );
  }

  const metadata = parsePlanningMetadata(input);
  const state = bindBehaviorState(
    input.state ?? createStatelessTurnBehaviorState(metadata.turnIndex)
  );
  return Object.freeze({
    behavior,
    requestFingerprintInput,
    ...metadata,
    state,
    ...(input.stateKey === undefined ? {} : { stateKey: input.stateKey }),
    ...(input.scripts === undefined
      ? {}
      : { scripts: bindScriptExecutor(input.scripts) }),
  });
};

/**
 * Selects a shared sequence by the explicit request turn and discards its staged
 * cursor write. This is the F2 default: no implicit conversation or transport state.
 */
export const createStatelessTurnBehaviorState = (
  turnIndex: number
): BehaviorStateAccess => ({
  read: (key) => (key.startsWith("sequence:") ? turnIndex : undefined),
  write: () => undefined,
  transaction: (callback) => callback(),
});

const jsonRecord = (
  value: JsonValue | undefined
): Record<string, JsonValue> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;

const responseCandidate = (
  value: JsonValue,
  common: {
    readonly planId: string;
    readonly requestHash: string;
    readonly model: string;
    readonly createdAtEpochSeconds: number;
    readonly turnIndex: number;
    readonly seed: string;
  },
  input: SnapshotPlanningInput,
  initialDelayMilliseconds: number
): Record<string, unknown> => {
  const directive: Record<string, JsonValue> | undefined =
    typeof value === "string"
      ? {
          segments: [{ type: "text", text: value }],
        }
      : jsonRecord(value);
  if (!directive) {
    throw new MockLlmPlanningError(
      "invalid_response_directive",
      "An LLM response behavior must return text or a neutral response directive."
    );
  }
  const unexpectedField = Object.keys(directive).find(
    (field) => !RESPONSE_DIRECTIVE_FIELDS.has(field)
  );
  if (unexpectedField !== undefined) {
    throw new MockLlmPlanningError(
      "invalid_response_directive",
      "An LLM response directive contains an unsupported field."
    );
  }
  const cadence = jsonRecord(directive.cadence);
  if (directive.cadence !== undefined && cadence === undefined) {
    throw new MockLlmPlanningError(
      "invalid_response_directive",
      "An LLM response directive cadence must be an object."
    );
  }
  const unexpectedCadenceField = cadence
    ? Object.keys(cadence).find((field) => !RESPONSE_CADENCE_FIELDS.has(field))
    : undefined;
  if (unexpectedCadenceField !== undefined) {
    throw new MockLlmPlanningError(
      "invalid_response_directive",
      "An LLM response directive contains an unsupported cadence field."
    );
  }
  return {
    ...directive,
    version: 1,
    kind: "response",
    ...common,
    stopReason: directive.stopReason ?? "end_turn",
    usage: directive.usage ?? input.defaultUsage,
    cadence: {
      ...input.defaultCadence,
      ...cadence,
      initialDelayMilliseconds,
    },
  };
};

export const planMockLlmResponse = async (
  input: MockLlmPlanningInput
): Promise<MockLlmPlanningResult> => {
  const snapshot = snapshotPlanningInput(input);
  const requestHash = await sha256(
    canonicalMockLlmJson(snapshot.requestFingerprintInput)
  );
  const evaluation = await evaluateBehavior(snapshot.behavior, {
    input: snapshot.requestFingerprintInput,
    state: snapshot.state,
    stateKey: snapshot.stateKey ?? `llm:${snapshot.model}`,
    invocationKey: requestHash,
    ...(snapshot.scripts ? { scripts: snapshot.scripts } : {}),
  });

  if (
    evaluation.outcome.kind === "error" &&
    (evaluation.outcome.status !== undefined ||
      evaluation.outcome.details !== undefined)
  ) {
    throw new MockLlmPlanningError(
      "provider_error_leak",
      "Neutral LLM errors cannot contain an HTTP status or provider details."
    );
  }

  const placeholderPlanId = `llmp_${"A".repeat(43)}`;
  const common = {
    planId: placeholderPlanId,
    requestHash,
    model: snapshot.model,
    createdAtEpochSeconds: snapshot.createdAtEpochSeconds,
    turnIndex: snapshot.turnIndex,
    seed: snapshot.seed,
  };
  const candidateWithPlaceholder: Record<string, unknown> =
    evaluation.outcome.kind === "error"
      ? {
          version: 1,
          kind: "error",
          ...common,
          initialDelayMilliseconds: evaluation.delayMilliseconds,
          error: {
            kind: evaluation.outcome.code,
            message: evaluation.outcome.message,
          },
        }
      : responseCandidate(
          evaluation.outcome.value,
          common,
          snapshot,
          evaluation.delayMilliseconds
        );
  const identityCandidate = Object.fromEntries(
    Object.entries(candidateWithPlaceholder).filter(([key]) => key !== "planId")
  );
  const planId = `llmp_${await sha256Base64Url(
    canonicalMockLlmJson(identityCandidate)
  )}`;
  const candidate = {
    ...candidateWithPlaceholder,
    planId,
  };

  let plan: MockLlmPlan;
  try {
    plan = parseMockLlmPlan(candidate);
  } catch (cause) {
    throw new MockLlmPlanningError(
      "invalid_response_directive",
      "The behavior result is not a valid neutral LLM plan.",
      { cause }
    );
  }
  return {
    plan: deepFreeze(plan),
    stateWrites: evaluation.stateWrites,
    commit: evaluation.commit,
  };
};
