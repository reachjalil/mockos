import {
  type ScimPatchToleranceCase,
  type ScenarioSpec,
  scenarioSpecSchema,
  type SemanticErrorCode,
} from "@mockos/contracts";
import { type Clock, SeededRng } from "../determinism";
import { utf8Encode } from "../security";
import type { SqlRow, SqlStore } from "../store";

export type ScenarioDecision =
  | { readonly type: "pass" }
  | {
      readonly type: "delay";
      readonly scenarioId: string;
      readonly injectionPoint: string;
      readonly milliseconds: number;
    }
  | {
      readonly type: "error";
      readonly scenarioId: string;
      readonly injectionPoint: string;
      readonly code: SemanticErrorCode;
    }
  | {
      readonly type: "mutate";
      readonly scenarioId: string;
      readonly injectionPoint: string;
      readonly patch: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "scim_conflict" | "scim_soft_delete_race";
      readonly scenarioId: string;
      readonly injectionPoint: string;
    }
  | {
      readonly type: "scim_patch_tolerance";
      readonly scenarioId: string;
      readonly injectionPoint: string;
      readonly malformedCase: ScimPatchToleranceCase;
    };

type ScenarioRow = SqlRow & {
  id: string;
  injection_point: string;
  spec_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  evaluations: number;
  remaining: number | null;
};

const selectScenarios = `SELECT id, injection_point, spec_json, enabled,
  created_at, updated_at, evaluations, remaining FROM scenarios`;

export const MAX_SCENARIO_DELAY_MS = 30_000;
export const MAX_SCENARIO_SPEC_BYTES = 64 * 1_024;

const serializedBytes = (value: string): number => utf8Encode(value).byteLength;

const normalizeSpec = (
  value: unknown
): {
  readonly spec: ScenarioSpec;
  readonly serialized: string;
} => {
  const parsed = scenarioSpecSchema.parse(value);
  if (
    parsed.action.type === "delay" &&
    parsed.action.milliseconds > MAX_SCENARIO_DELAY_MS
  ) {
    throw new Error(
      `Scenario delay cannot exceed ${MAX_SCENARIO_DELAY_MS} milliseconds.`
    );
  }
  let serialized: string;
  let patchSerialized: string | undefined;
  try {
    serialized = JSON.stringify(parsed);
    patchSerialized =
      parsed.action.type === "mutate" ? JSON.stringify(parsed.action.patch) : undefined;
  } catch (cause) {
    throw new Error("Scenario specification must be JSON-serializable.", { cause });
  }
  if (
    serializedBytes(serialized) > MAX_SCENARIO_SPEC_BYTES ||
    (patchSerialized !== undefined &&
      serializedBytes(patchSerialized) > MAX_SCENARIO_SPEC_BYTES)
  ) {
    throw new Error(
      `Serialized scenario specifications and patches cannot exceed ${MAX_SCENARIO_SPEC_BYTES} bytes.`
    );
  }
  return {
    spec: scenarioSpecSchema.parse(JSON.parse(serialized)),
    serialized,
  };
};

const parseStoredSpec = (row: ScenarioRow): ScenarioSpec => {
  try {
    return normalizeSpec(JSON.parse(row.spec_json)).spec;
  } catch (cause) {
    throw new Error(`Stored scenario ${row.id} is invalid.`, { cause });
  }
};

const currentSpec = (row: ScenarioRow): ScenarioSpec => {
  const parsed = parseStoredSpec(row);
  const { remaining: storedDefault, ...base } = parsed;
  const remaining = row.remaining ?? storedDefault;
  return scenarioSpecSchema.parse({
    ...base,
    enabled: row.enabled === 1,
    ...(remaining !== undefined && remaining > 0 ? { remaining } : {}),
  });
};

/**
 * Deterministic scenario evaluator. A literal `*` injection point is the
 * documented catch-all and is considered only after exact matches.
 */
export class ScenarioService {
  readonly #store: SqlStore;
  readonly #clock: Clock;
  readonly #seed: string;

  constructor(options: {
    readonly store: SqlStore;
    readonly clock: Clock;
    readonly seed: string;
  }) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#seed = options.seed;
  }

  /** Sets a scenario, replacing the complete specification when its ID exists. */
  set(spec: ScenarioSpec): ScenarioSpec {
    const { spec: normalized, serialized } = normalizeSpec(spec);
    const now = this.#clock.now().toISOString();
    this.#store.run(
      `INSERT INTO scenarios (
        id, injection_point, spec_json, enabled, created_at, updated_at,
        evaluations, remaining
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        injection_point = excluded.injection_point,
        spec_json = excluded.spec_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        evaluations = 0,
        remaining = excluded.remaining`,
      normalized.id,
      normalized.injectionPoint,
      serialized,
      normalized.enabled ? 1 : 0,
      now,
      now,
      normalized.remaining ?? null
    );
    return normalized;
  }

  replace(spec: ScenarioSpec): ScenarioSpec {
    return this.set(spec);
  }

  list(): ScenarioSpec[] {
    return this.#store
      .all<ScenarioRow>(`${selectScenarios} ORDER BY created_at, id`)
      .map(currentSpec);
  }

  /** Clears one scenario by ID, or every scenario when the ID is omitted. */
  clear(scenarioId?: string): number {
    const result = scenarioId
      ? this.#store.run("DELETE FROM scenarios WHERE id = ?", scenarioId)
      : this.#store.run("DELETE FROM scenarios");
    return result.changes;
  }

  decide(
    injectionPoint: string,
    _context: Readonly<Record<string, unknown>> = {}
  ): ScenarioDecision {
    return this.#decide(injectionPoint, true);
  }

  /** Reserved internal seams use exact-only evaluation and never consume `*`. */
  decideExact(
    injectionPoint: string,
    _context: Readonly<Record<string, unknown>> = {}
  ): ScenarioDecision {
    return this.#decide(injectionPoint, false);
  }

  #decide(injectionPoint: string, includeCatchAll: boolean): ScenarioDecision {
    if (!injectionPoint || injectionPoint.length > 128) {
      throw new Error("Injection point must contain 1 to 128 characters.");
    }
    return this.#store.transaction(() => {
      const rows = this.#store.all<ScenarioRow>(
        `${selectScenarios}
         WHERE enabled = 1 AND ${
           includeCatchAll
             ? "(injection_point = ? OR injection_point = '*')"
             : "injection_point = ?"
}
         ORDER BY CASE WHEN injection_point = ? THEN 0 ELSE 1 END,
           created_at, id`,
        injectionPoint,
        injectionPoint
      );
      for (const row of rows) {
        const spec = parseStoredSpec(row);
        const evaluation = Number(row.evaluations);
        if (!Number.isSafeInteger(evaluation) || evaluation < 0) {
          throw new Error(`Stored scenario ${row.id} has an invalid evaluation count.`);
        }
        const draw = new SeededRng(
          `mockos:scenario:${this.#seed}:${row.id}:${evaluation}`
        ).next();
        const fires = draw < spec.probability;
        const remaining = row.remaining ?? spec.remaining;
        const nextRemaining =
          fires && remaining !== undefined ? remaining - 1 : remaining;
        const enabled = nextRemaining === 0 ? 0 : 1;
        const updated = this.#store.run(
          `UPDATE scenarios
           SET evaluations = ?, remaining = ?, enabled = ?
           WHERE id = ? AND enabled = 1 AND evaluations = ?`,
          evaluation + 1,
          nextRemaining ?? null,
          enabled,
          row.id,
          evaluation
        );
        if (updated.changes !== 1) {
          throw new Error(`Scenario ${row.id} changed during evaluation.`);
        }
        if (!fires) continue;
        const common = {
          scenarioId: row.id,
          injectionPoint: row.injection_point,
        };
        switch (spec.action.type) {
          case "delay":
            return { ...common, ...spec.action };
          case "error":
            return { ...common, ...spec.action };
          case "mutate":
            return {
              ...common,
              type: "mutate",
              patch: { ...spec.action.patch },
            };
          case "scim_conflict":
          case "scim_soft_delete_race":
          case "scim_patch_tolerance":
            return { ...common, ...spec.action };
        }
      }
      return { type: "pass" };
    });
  }
}
