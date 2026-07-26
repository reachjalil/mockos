import { type NormalizeOptions, normalizeObservation } from "./normalize.js";
import type { ParityObservation } from "./observation.js";

export type ParityVerdict =
  /** Live and mock agree after normalisation. */
  | "match"
  /** They differ, and every difference is ledgered as intentional. */
  | "known-divergence"
  /** They differ in a way nothing explains. A bug to file. */
  | "defect"
  /** No live capture exists yet. Never render this as a pass. */
  | "not-captured"
  /** mockOS deliberately does not implement this. */
  | "out-of-scope";

export interface DivergenceLedgerEntry {
  /** Stable id, e.g. "D-25". */
  readonly id: string;
  readonly provider: string;
  /** Case id this applies to, or "*" for every case. */
  readonly caseId: string;
  /** Dotted field path. A trailing "*" matches any deeper path. */
  readonly field: string;
  /** False means a known defect that is tracked but not yet fixed. */
  readonly intentional: boolean;
  readonly reason: string;
  readonly owner: string;
  readonly openedAt: string;
}

export interface ParityDifference {
  readonly path: string;
  readonly live: unknown;
  readonly mock: unknown;
}

export interface ClassifiedDifference extends ParityDifference {
  readonly ledgerId: string | null;
  readonly intentional: boolean;
}

export interface ParityCaseResult {
  readonly caseId: string;
  readonly verdict: ParityVerdict;
  readonly differences: readonly ClassifiedDifference[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Collects every leaf difference between two normalised values. */
export const diffValues = (
  live: unknown,
  mock: unknown,
  path = ""
): ParityDifference[] => {
  if (Array.isArray(live) || Array.isArray(mock)) {
    if (!Array.isArray(live) || !Array.isArray(mock)) {
      return [{ path, live, mock }];
    }
    const differences: ParityDifference[] = [];
    const length = Math.max(live.length, mock.length);
    for (let index = 0; index < length; index += 1) {
      differences.push(...diffValues(live[index], mock[index], `${path}[${index}]`));
    }
    return differences;
  }

  if (isRecord(live) && isRecord(mock)) {
    const differences: ParityDifference[] = [];
    for (const key of [
      ...new Set([...Object.keys(live), ...Object.keys(mock)]),
    ].sort()) {
      differences.push(
        ...diffValues(live[key], mock[key], path === "" ? key : `${path}.${key}`)
      );
    }
    return differences;
  }

  if (!Object.is(live, mock)) return [{ path, live, mock }];
  return [];
};

/** Compares one exchange, field by field. */
export const diffObservations = (
  live: ParityObservation,
  mock: ParityObservation
): ParityDifference[] => diffValues(live, mock);

/**
 * Compares ordered exchanges. A length mismatch is reported as a difference on
 * the sequence itself rather than silently truncating, because extra or missing
 * provider calls are exactly the kind of divergence this suite exists to catch.
 */
export const diffSequences = (
  live: readonly ParityObservation[],
  mock: readonly ParityObservation[]
): ParityDifference[] => {
  const differences: ParityDifference[] = [];
  if (live.length !== mock.length) {
    differences.push({ path: "sequence.length", live: live.length, mock: mock.length });
  }
  const length = Math.min(live.length, mock.length);
  for (let index = 0; index < length; index += 1) {
    differences.push(...diffValues(live[index], mock[index], `sequence[${index}]`));
  }
  return differences;
};

const fieldMatches = (pattern: string, path: string): boolean => {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix);
  }
  return pattern === path;
};

/**
 * Normalised sequence paths carry an index (`sequence[3].responseBody.iss`).
 * Ledger entries are written against the field, not the position, so the index
 * is stripped before matching.
 */
const ledgerPath = (path: string) => path.replace(/^sequence\[\d+\]\./, "");

export const classifyDifferences = (
  caseId: string,
  provider: string,
  differences: readonly ParityDifference[],
  ledger: readonly DivergenceLedgerEntry[]
): ClassifiedDifference[] =>
  differences.map((difference) => {
    const entry = ledger.find(
      (candidate) =>
        candidate.provider === provider &&
        (candidate.caseId === "*" || candidate.caseId === caseId) &&
        fieldMatches(candidate.field, ledgerPath(difference.path))
    );
    return {
      ...difference,
      ledgerId: entry?.id ?? null,
      intentional: entry?.intentional ?? false,
    };
  });

/**
 * Produces the verdict for one case.
 *
 * A difference explained by an intentional ledger entry is a known divergence.
 * Anything unexplained — or explained by an entry that admits it is a defect —
 * is a defect.
 */
export const verdictFor = (
  differences: readonly ClassifiedDifference[]
): Exclude<ParityVerdict, "not-captured" | "out-of-scope"> => {
  if (differences.length === 0) return "match";
  return differences.every((difference) => difference.intentional)
    ? "known-divergence"
    : "defect";
};

/**
 * Compares one case end to end.
 *
 * Normalisation happens here rather than in the caller: comparing raw
 * observations would leave JWTs opaque and volatile claims mismatched, so a
 * forgotten normalise step would silently turn every case into a defect.
 * Each side gets its own literals, since tenant and client ids differ by target.
 */
export const compareCase = (input: {
  readonly caseId: string;
  readonly provider: string;
  readonly live: readonly ParityObservation[];
  readonly mock: readonly ParityObservation[];
  readonly ledger: readonly DivergenceLedgerEntry[];
  readonly liveNormalize?: NormalizeOptions;
  readonly mockNormalize?: NormalizeOptions;
}): ParityCaseResult => {
  const live = input.live.map((entry) =>
    normalizeObservation(entry, input.liveNormalize ?? {})
  );
  const mock = input.mock.map((entry) =>
    normalizeObservation(entry, input.mockNormalize ?? {})
  );
  const differences = classifyDifferences(
    input.caseId,
    input.provider,
    diffSequences(live, mock),
    input.ledger
  );
  return {
    caseId: input.caseId,
    verdict: verdictFor(differences),
    differences,
  };
};
