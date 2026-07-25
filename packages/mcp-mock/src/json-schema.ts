import type { MockMcpJsonSchema } from "@mockos/contracts";
import type { JsonValue } from "@mockos/contracts/behavior";

const MAX_REPORTED_ISSUES = 32;
const CANONICAL_SCAN_CHUNK_SIZE = 64;
const VALIDATION_WORK_EXHAUSTED_MESSAGE = "validation work budget exceeded";

export const MOCK_MCP_JSON_SCHEMA_VALIDATION_WORK_BUDGET = 50_000;

export type MockMcpSchemaIssue = {
  readonly path: string;
  readonly message: string;
};

export type MockMcpSchemaValidation =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly MockMcpSchemaIssue[] };

type JsonSchema = Readonly<Record<string, JsonValue>>;

type ValidationWorkBudget = {
  exhausted: boolean;
  remaining: number;
};

const spendWork = (budget: ValidationWorkBudget, amount = 1): boolean => {
  if (budget.exhausted) return false;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > budget.remaining) {
    budget.exhausted = true;
    budget.remaining = 0;
    return false;
  }
  budget.remaining -= amount;
  return true;
};

const spendScanWork = (budget: ValidationWorkBudget, codeUnits: number): boolean =>
  spendWork(budget, Math.ceil(codeUnits / CANONICAL_SCAN_CHUNK_SIZE));

const isObject = (value: unknown): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const canonicalJson = (
  value: JsonValue,
  budget: ValidationWorkBudget
): string | undefined => {
  if (!spendWork(budget)) return undefined;
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && !spendScanWork(budget, value.length)) {
      return undefined;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) {
      if (!spendWork(budget)) return undefined;
      const canonicalEntry = canonicalJson(entry, budget);
      if (canonicalEntry === undefined) return undefined;
      parts.push(canonicalEntry);
    }
    return `[${parts.join(",")}]`;
  }
  const keys = Object.keys(value);
  const sortingWork =
    keys.length < 2 ? 0 : Math.ceil(keys.length * Math.log2(keys.length));
  if (!spendWork(budget, sortingWork)) return undefined;
  keys.sort();
  const parts: string[] = [];
  for (const key of keys) {
    if (!spendWork(budget) || !spendScanWork(budget, key.length)) {
      return undefined;
    }
    const canonicalEntry = canonicalJson(value[key] as JsonValue, budget);
    if (canonicalEntry === undefined) return undefined;
    parts.push(`${JSON.stringify(key)}:${canonicalEntry}`);
  }
  return `{${parts.join(",")}}`;
};

const equalJson = (
  left: JsonValue,
  right: JsonValue,
  budget: ValidationWorkBudget
): boolean | undefined => {
  const leftCanonical = canonicalJson(left, budget);
  if (leftCanonical === undefined) return undefined;
  const rightCanonical = canonicalJson(right, budget);
  if (rightCanonical === undefined || !spendWork(budget)) return undefined;
  return leftCanonical === rightCanonical;
};

const enumContains = (
  enumeration: readonly JsonValue[],
  value: JsonValue,
  budget: ValidationWorkBudget
): boolean | undefined => {
  const valueCanonical = canonicalJson(value, budget);
  if (valueCanonical === undefined) return undefined;
  for (const candidate of enumeration) {
    const candidateCanonical = canonicalJson(candidate, budget);
    if (candidateCanonical === undefined || !spendWork(budget)) return undefined;
    if (valueCanonical === candidateCanonical) return true;
  }
  return false;
};

const childPath = (
  path: string,
  segment: string | number,
  budget: ValidationWorkBudget
): string | undefined => {
  if (typeof segment === "number") {
    const renderedSegment = String(segment);
    if (!spendScanWork(budget, path.length + renderedSegment.length + 2)) {
      return undefined;
    }
    return `${path}[${renderedSegment}]`;
  }
  if (!spendScanWork(budget, segment.length)) return undefined;
  const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment);
  const maximumRenderedSegmentLength = isIdentifier
    ? segment.length + 1
    : segment.length * 6 + 2;
  if (!spendScanWork(budget, path.length + maximumRenderedSegmentLength)) {
    return undefined;
  }
  return isIdentifier ? `${path}.${segment}` : `${path}[${JSON.stringify(segment)}]`;
};

const matchesType = (value: JsonValue, type: JsonValue | undefined): boolean => {
  switch (type) {
    case undefined:
      return true;
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      return false;
  }
};

const asSchemas = (value: JsonValue | undefined): readonly JsonSchema[] =>
  Array.isArray(value) ? (value.filter(isObject) as JsonSchema[]) : [];

const validateInternal = (
  schema: JsonSchema,
  value: JsonValue,
  path: string,
  issues: MockMcpSchemaIssue[],
  collect: boolean,
  budget: ValidationWorkBudget
): boolean => {
  if (!spendWork(budget)) return false;
  let valid = true;
  const fail = (message: string, at = path): void => {
    valid = false;
    if (collect && issues.length < MAX_REPORTED_ISSUES) {
      issues.push({ path: at, message });
    }
  };

  if (!matchesType(value, schema.type)) {
    fail(`must be ${String(schema.type)}`);
    return false;
  }

  if (Object.hasOwn(schema, "const")) {
    const matches = equalJson(value, schema.const as JsonValue, budget);
    if (matches === undefined) return false;
    if (!matches) fail("must equal the configured constant");
  }
  if (Array.isArray(schema.enum)) {
    const matches = enumContains(schema.enum, value, budget);
    if (matches === undefined) return false;
    if (!matches) fail("must equal one of the configured values");
  }

  const allOf = asSchemas(schema.allOf);
  for (const child of allOf) {
    if (!spendWork(budget)) return false;
    if (!validateInternal(child, value, path, issues, collect, budget)) {
      if (budget.exhausted) return false;
      valid = false;
    }
  }

  const anyOf = asSchemas(schema.anyOf);
  if (anyOf.length > 0) {
    let matched = false;
    for (const child of anyOf) {
      if (!spendWork(budget)) return false;
      if (validateInternal(child, value, path, [], false, budget)) {
        matched = true;
        break;
      }
      if (budget.exhausted) return false;
    }
    if (!matched) fail("must satisfy at least one anyOf schema");
  }

  const oneOf = asSchemas(schema.oneOf);
  if (oneOf.length > 0) {
    let matches = 0;
    for (const child of oneOf) {
      if (!spendWork(budget)) return false;
      if (validateInternal(child, value, path, [], false, budget)) {
        matches += 1;
        if (matches > 1) break;
      }
      if (budget.exhausted) return false;
    }
    if (matches !== 1) fail("must satisfy exactly one oneOf schema");
  }

  if (isObject(schema.not)) {
    if (!spendWork(budget)) return false;
    const excluded = validateInternal(schema.not, value, path, [], false, budget);
    if (budget.exhausted) return false;
    if (excluded) fail("must not satisfy the excluded schema");
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" || typeof schema.maxLength === "number") {
      if (!spendScanWork(budget, value.length)) return false;
      const length = [...value].length;
      if (typeof schema.minLength === "number" && length < schema.minLength) {
        fail(`must contain at least ${schema.minLength} characters`);
      }
      if (typeof schema.maxLength === "number" && length > schema.maxLength) {
        fail(`must contain at most ${schema.maxLength} characters`);
      }
    }
    // Current contracts reject regex and format vocabularies. Persisted draft
    // records fail closed rather than evaluating user-authored regular expressions.
    if (schema.pattern !== undefined || schema.format !== undefined) {
      fail("uses an unsupported pattern or format assertion");
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      fail(`must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      fail(`must be at most ${schema.maximum}`);
    }
    if (
      typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum
    ) {
      fail(`must be greater than ${schema.exclusiveMinimum}`);
    }
    if (
      typeof schema.exclusiveMaximum === "number" &&
      value >= schema.exclusiveMaximum
    ) {
      fail(`must be less than ${schema.exclusiveMaximum}`);
    }
    if (typeof schema.multipleOf === "number") {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * 16) {
        fail(`must be a multiple of ${schema.multipleOf}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      fail(`must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      fail(`must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const entry of value) {
        if (!spendWork(budget)) return false;
        const canonicalEntry = canonicalJson(entry, budget);
        if (
          canonicalEntry === undefined ||
          !spendScanWork(budget, canonicalEntry.length)
        ) {
          return false;
        }
        if (seen.has(canonicalEntry)) {
          fail("must contain unique items");
          break;
        }
        seen.add(canonicalEntry);
      }
    }
    if (isObject(schema.items)) {
      for (const [index, entry] of value.entries()) {
        if (!spendWork(budget)) return false;
        const entryPath = childPath(path, index, budget);
        if (entryPath === undefined) return false;
        if (
          !validateInternal(schema.items, entry, entryPath, issues, collect, budget)
        ) {
          if (budget.exhausted) return false;
          valid = false;
        }
      }
    }
  }

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (
      typeof schema.minProperties === "number" &&
      keys.length < schema.minProperties
    ) {
      fail(`must contain at least ${schema.minProperties} properties`);
    }
    if (
      typeof schema.maxProperties === "number" &&
      keys.length > schema.maxProperties
    ) {
      fail(`must contain at most ${schema.maxProperties} properties`);
    }

    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const required of schema.required) {
        if (
          !spendWork(budget) ||
          (typeof required === "string" && !spendScanWork(budget, required.length))
        ) {
          return false;
        }
        if (typeof required === "string" && !Object.hasOwn(value, required)) {
          const requiredPath = childPath(path, required, budget);
          if (requiredPath === undefined) return false;
          fail("is required", requiredPath);
        }
      }
    }

    for (const key of keys) {
      if (!spendWork(budget) || !spendScanWork(budget, key.length)) return false;
      const entry = value[key] as JsonValue;
      const propertySchema = properties[key];
      if (isObject(propertySchema)) {
        const propertyPath = childPath(path, key, budget);
        if (propertyPath === undefined) return false;
        if (
          !validateInternal(
            propertySchema,
            entry,
            propertyPath,
            issues,
            collect,
            budget
          )
        ) {
          if (budget.exhausted) return false;
          valid = false;
        }
      } else if (schema.additionalProperties === false) {
        const propertyPath = childPath(path, key, budget);
        if (propertyPath === undefined) return false;
        fail("is not an allowed property", propertyPath);
      } else if (isObject(schema.additionalProperties)) {
        const propertyPath = childPath(path, key, budget);
        if (propertyPath === undefined) return false;
        if (
          !validateInternal(
            schema.additionalProperties,
            entry,
            propertyPath,
            issues,
            collect,
            budget
          )
        ) {
          if (budget.exhausted) return false;
          valid = false;
        }
      }
    }
  }

  return valid;
};

/**
 * Executes the exact assertion subset accepted by the version-one mock-MCP
 * contract. Annotation-only keywords are intentionally inert.
 */
export const validateMockMcpJsonSchema = (
  schema: MockMcpJsonSchema,
  value: JsonValue
): MockMcpSchemaValidation => {
  const issues: MockMcpSchemaIssue[] = [];
  const budget: ValidationWorkBudget = {
    exhausted: false,
    remaining: MOCK_MCP_JSON_SCHEMA_VALIDATION_WORK_BUDGET,
  };
  const valid = validateInternal(schema, value, "$", issues, true, budget);
  if (budget.exhausted) {
    return {
      valid: false,
      issues: Object.freeze([
        Object.freeze({
          path: "$",
          message: VALIDATION_WORK_EXHAUSTED_MESSAGE,
        }),
      ]),
    };
  }
  return valid
    ? { valid: true, issues: [] }
    : { valid: false, issues: Object.freeze(issues) };
};
