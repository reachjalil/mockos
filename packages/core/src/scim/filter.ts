import { ScimProtocolError } from "./errors";

export type ScimComparisonOperator =
  | "eq"
  | "ne"
  | "co"
  | "sw"
  | "ew"
  | "gt"
  | "ge"
  | "lt"
  | "le";

export type ScimComparisonValue = string | number | boolean | null;

export interface ScimAttributePath {
  readonly schema?: string;
  readonly attribute: string;
  readonly subAttribute?: string;
}

export type ScimFilter =
  | {
      readonly type: "comparison";
      readonly path: ScimAttributePath;
      readonly operator: ScimComparisonOperator;
      readonly value: ScimComparisonValue;
    }
  | {
      readonly type: "presence";
      readonly path: ScimAttributePath;
    }
  | {
      readonly type: "valuePath";
      readonly path: ScimAttributePath;
      readonly filter: ScimFilter;
    }
  | {
      readonly type: "not";
      readonly filter: ScimFilter;
    }
  | {
      readonly type: "and";
      readonly left: ScimFilter;
      readonly right: ScimFilter;
    }
  | {
      readonly type: "or";
      readonly left: ScimFilter;
      readonly right: ScimFilter;
    };

export interface ScimFilterLimits {
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxPathBytes: number;
  readonly maxLiteralBytes: number;
}

export const DEFAULT_SCIM_FILTER_LIMITS: ScimFilterLimits = Object.freeze({
  maxBytes: 8_192,
  maxTokens: 256,
  maxDepth: 16,
  maxNodes: 128,
  maxPathBytes: 2_048,
  maxLiteralBytes: 4_096,
});

type FilterToken =
  | { readonly type: "word"; readonly value: string; readonly offset: number }
  | {
      readonly type: "literal";
      readonly value: ScimComparisonValue;
      readonly offset: number;
    }
  | {
      readonly type:
        | "leftParenthesis"
        | "rightParenthesis"
        | "leftBracket"
        | "rightBracket";
      readonly offset: number;
    }
  | { readonly type: "eof"; readonly offset: number };

const textEncoder = new TextEncoder();
const byteLength = (value: string): number => textEncoder.encode(value).byteLength;

const invalidFilter = (detail: string, cause?: unknown): ScimProtocolError =>
  new ScimProtocolError(
    400,
    detail,
    "invalidFilter",
    cause === undefined ? undefined : { cause }
  );

const withLimits = (
  overrides: Partial<ScimFilterLimits> | undefined
): ScimFilterLimits => {
  const limits = { ...DEFAULT_SCIM_FILTER_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
};

const tokenName = (token: FilterToken): string => {
  if (token.type === "word") return token.value;
  if (token.type === "literal") return JSON.stringify(token.value);
  if (token.type === "leftParenthesis") return "(";
  if (token.type === "rightParenthesis") return ")";
  if (token.type === "leftBracket") return "[";
  if (token.type === "rightBracket") return "]";
  return "end of filter";
};

const tokenize = (input: string, limits: ScimFilterLimits): FilterToken[] => {
  if (!input.trim()) throw invalidFilter("A SCIM filter cannot be empty.");
  if (byteLength(input) > limits.maxBytes) {
    throw invalidFilter(`SCIM filter exceeds the ${limits.maxBytes}-byte limit.`);
  }

  const tokens: FilterToken[] = [];
  const push = (token: FilterToken): void => {
    if (token.type !== "eof" && tokens.length >= limits.maxTokens) {
      throw invalidFilter(`SCIM filter exceeds the ${limits.maxTokens}-token limit.`);
    }
    tokens.push(token);
  };

  let offset = 0;
  while (offset < input.length) {
    const character = input[offset];
    if (character === undefined) break;
    if (/\s/u.test(character)) {
      offset += 1;
      continue;
    }
    const punctuation: Readonly<
      Record<
        string,
        "leftParenthesis" | "rightParenthesis" | "leftBracket" | "rightBracket"
      >
    > = {
      "(": "leftParenthesis",
      ")": "rightParenthesis",
      "[": "leftBracket",
      "]": "rightBracket",
    };
    const punctuationType = punctuation[character];
    if (punctuationType) {
      push({ type: punctuationType, offset });
      offset += 1;
      continue;
    }
    if (character === '"') {
      const start = offset;
      offset += 1;
      let escaped = false;
      let closed = false;
      while (offset < input.length) {
        const current = input[offset];
        if (current === undefined) break;
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === '"') {
          offset += 1;
          closed = true;
          break;
        }
        offset += 1;
      }
      if (!closed)
        throw invalidFilter(`Unterminated string literal at offset ${start}.`);
      const encoded = input.slice(start, offset);
      if (byteLength(encoded) > limits.maxLiteralBytes) {
        throw invalidFilter(
          `SCIM filter literal exceeds the ${limits.maxLiteralBytes}-byte limit.`
        );
      }
      try {
        const value: unknown = JSON.parse(encoded);
        if (typeof value !== "string") throw new TypeError("Expected a string.");
        push({ type: "literal", value, offset: start });
      } catch (error) {
        throw invalidFilter(`Invalid string literal at offset ${start}.`, error);
      }
      continue;
    }

    const start = offset;
    while (offset < input.length) {
      const current = input[offset];
      if (current === undefined || /[\s()[\]]/u.test(current)) break;
      offset += 1;
    }
    const raw = input.slice(start, offset);
    if (!raw) throw invalidFilter(`Unexpected character at offset ${start}.`);
    if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(raw)) {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw invalidFilter(`Numeric literal at offset ${start} is out of range.`);
      }
      push({ type: "literal", value, offset: start });
      continue;
    }
    if (raw === "true" || raw === "false" || raw === "null") {
      push({
        type: "literal",
        value: raw === "null" ? null : raw === "true",
        offset: start,
      });
      continue;
    }
    push({ type: "word", value: raw, offset: start });
  }
  push({ type: "eof", offset: input.length });
  return tokens;
};

const attributeNamePattern = /^[A-Za-z$][A-Za-z0-9_$-]*$/u;

export const parseScimAttributePath = (
  input: string,
  options: {
    readonly maxBytes?: number;
    readonly errorType?: "invalidFilter" | "invalidPath";
  } = {}
): ScimAttributePath => {
  const maxBytes = options.maxBytes ?? DEFAULT_SCIM_FILTER_LIMITS.maxPathBytes;
  const fail = (detail: string): never => {
    throw new ScimProtocolError(400, detail, options.errorType ?? "invalidFilter");
  };
  if (!input || byteLength(input) > maxBytes) {
    return fail(`Invalid or overlong SCIM attribute path: ${input || "<empty>"}.`);
  }

  const lastColon = input.lastIndexOf(":");
  const schema = lastColon >= 0 ? input.slice(0, lastColon) : undefined;
  const attributePart = lastColon >= 0 ? input.slice(lastColon + 1) : input;
  if (schema !== undefined && (!schema || /\s|[()[\]]/u.test(schema))) {
    return fail(`Invalid SCIM schema URI in attribute path: ${input}.`);
  }
  const pieces = attributePart.split(".");
  if (
    pieces.length < 1 ||
    pieces.length > 2 ||
    pieces.some((piece) => !attributeNamePattern.test(piece))
  ) {
    return fail(`Invalid SCIM attribute path: ${input}.`);
  }
  const attribute = pieces[0];
  if (!attribute) return fail(`Invalid SCIM attribute path: ${input}.`);
  const subAttribute = pieces[1];
  return {
    ...(schema === undefined ? {} : { schema }),
    attribute,
    ...(subAttribute === undefined ? {} : { subAttribute }),
  };
};

class FilterParser {
  readonly #tokens: readonly FilterToken[];
  readonly #limits: ScimFilterLimits;
  #cursor = 0;
  #nodeCount = 0;

  constructor(tokens: readonly FilterToken[], limits: ScimFilterLimits) {
    this.#tokens = tokens;
    this.#limits = limits;
  }

  parse(): ScimFilter {
    const result = this.#parseOr(0, false);
    const token = this.#peek();
    if (token.type !== "eof") {
      throw invalidFilter(
        `Unexpected ${tokenName(token)} at offset ${token.offset}; expected end of filter.`
      );
    }
    return result;
  }

  #node<T extends ScimFilter>(node: T): T {
    this.#nodeCount += 1;
    if (this.#nodeCount > this.#limits.maxNodes) {
      throw invalidFilter(
        `SCIM filter exceeds the ${this.#limits.maxNodes}-node limit.`
      );
    }
    return node;
  }

  #assertDepth(depth: number): void {
    if (depth > this.#limits.maxDepth) {
      throw invalidFilter(
        `SCIM filter exceeds the ${this.#limits.maxDepth}-level limit.`
      );
    }
  }

  #peek(): FilterToken {
    return this.#tokens[this.#cursor] ?? { type: "eof", offset: 0 };
  }

  #take(): FilterToken {
    const token = this.#peek();
    this.#cursor += 1;
    return token;
  }

  #word(value: string): boolean {
    const token = this.#peek();
    return token.type === "word" && token.value.toLowerCase() === value;
  }

  #parseOr(depth: number, inValuePath: boolean): ScimFilter {
    this.#assertDepth(depth);
    let left = this.#parseAnd(depth, inValuePath);
    while (this.#word("or")) {
      this.#take();
      left = this.#node({
        type: "or",
        left,
        right: this.#parseAnd(depth, inValuePath),
      });
    }
    return left;
  }

  #parseAnd(depth: number, inValuePath: boolean): ScimFilter {
    let left = this.#parseNot(depth, inValuePath);
    while (this.#word("and")) {
      this.#take();
      left = this.#node({
        type: "and",
        left,
        right: this.#parseNot(depth, inValuePath),
      });
    }
    return left;
  }

  #parseNot(depth: number, inValuePath: boolean): ScimFilter {
    if (!this.#word("not")) return this.#parsePrimary(depth, inValuePath);
    this.#take();
    this.#assertDepth(depth + 1);
    return this.#node({
      type: "not",
      filter: this.#parseNot(depth + 1, inValuePath),
    });
  }

  #parsePrimary(depth: number, inValuePath: boolean): ScimFilter {
    const first = this.#take();
    if (first.type === "leftParenthesis") {
      this.#assertDepth(depth + 1);
      const result = this.#parseOr(depth + 1, inValuePath);
      const closing = this.#take();
      if (closing.type !== "rightParenthesis") {
        throw invalidFilter(
          `Expected ) at offset ${closing.offset}, found ${tokenName(closing)}.`
        );
      }
      return result;
    }
    if (first.type !== "word") {
      throw invalidFilter(
        `Expected an attribute path at offset ${first.offset}, found ${tokenName(first)}.`
      );
    }

    const path = parseScimAttributePath(first.value, {
      maxBytes: this.#limits.maxPathBytes,
    });
    if (this.#peek().type === "leftBracket") {
      if (inValuePath) {
        throw invalidFilter("Nested SCIM valuePath filters are not supported.");
      }
      if (path.subAttribute !== undefined) {
        throw invalidFilter(
          "A SCIM valuePath must begin with a multi-valued attribute."
        );
      }
      this.#take();
      this.#assertDepth(depth + 1);
      const filter = this.#parseOr(depth + 1, true);
      const closing = this.#take();
      if (closing.type !== "rightBracket") {
        throw invalidFilter(
          `Expected ] at offset ${closing.offset}, found ${tokenName(closing)}.`
        );
      }
      return this.#node({ type: "valuePath", path, filter });
    }

    const operator = this.#take();
    if (operator.type !== "word") {
      throw invalidFilter(
        `Expected an operator at offset ${operator.offset}, found ${tokenName(operator)}.`
      );
    }
    const normalizedOperator = operator.value.toLowerCase();
    if (normalizedOperator === "pr") return this.#node({ type: "presence", path });
    if (
      normalizedOperator !== "eq" &&
      normalizedOperator !== "ne" &&
      normalizedOperator !== "co" &&
      normalizedOperator !== "sw" &&
      normalizedOperator !== "ew" &&
      normalizedOperator !== "gt" &&
      normalizedOperator !== "ge" &&
      normalizedOperator !== "lt" &&
      normalizedOperator !== "le"
    ) {
      throw invalidFilter(`Unsupported SCIM filter operator: ${operator.value}.`);
    }
    const value = this.#take();
    if (value.type !== "literal") {
      throw invalidFilter(
        `Expected a JSON literal at offset ${value.offset}, found ${tokenName(value)}.`
      );
    }
    return this.#node({
      type: "comparison",
      path,
      operator: normalizedOperator,
      value: value.value,
    });
  }
}

export const parseScimFilter = (
  input: string,
  overrides?: Partial<ScimFilterLimits>
): ScimFilter => {
  const limits = withLimits(overrides);
  return new FilterParser(tokenize(input, limits), limits).parse();
};

export interface ScimFilterEvaluationOptions {
  readonly caseExact?: (path: ScimAttributePath) => boolean;
  readonly caseExactPaths?: ReadonlySet<string> | readonly string[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getCaseInsensitive = (
  value: Readonly<Record<string, unknown>>,
  name: string
): unknown => {
  const normalized = name.toLowerCase();
  const key = Object.keys(value).find(
    (candidate) => candidate.toLowerCase() === normalized
  );
  return key === undefined ? undefined : value[key];
};

const flattenPresent = (value: unknown): unknown[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.filter((item) => item !== undefined) : [value];
};

const resolvePath = (
  resource: unknown,
  path: ScimAttributePath
): readonly unknown[] => {
  if (!isRecord(resource)) return [];
  const container = path.schema ? getCaseInsensitive(resource, path.schema) : resource;
  if (!isRecord(container)) return [];
  const attributeValue = getCaseInsensitive(container, path.attribute);
  const values = flattenPresent(attributeValue);
  if (!path.subAttribute) return values;
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    return flattenPresent(getCaseInsensitive(value, path.subAttribute as string));
  });
};

export const formatScimAttributePath = (path: ScimAttributePath): string =>
  `${path.schema ? `${path.schema}:` : ""}${path.attribute}${
    path.subAttribute ? `.${path.subAttribute}` : ""
  }`;

const isCaseExact = (
  path: ScimAttributePath,
  options: ScimFilterEvaluationOptions
): boolean => {
  if (options.caseExact?.(path)) return true;
  const configured = options.caseExactPaths;
  if (!configured) return false;
  const normalized = formatScimAttributePath(path).toLowerCase();
  if (Array.isArray(configured)) {
    return configured.some((item) => item.toLowerCase() === normalized);
  }
  for (const item of configured) if (item.toLowerCase() === normalized) return true;
  return false;
};

const compare = (
  candidate: unknown,
  operator: ScimComparisonOperator,
  expected: ScimComparisonValue,
  caseExact: boolean
): boolean => {
  if (operator === "co" || operator === "sw" || operator === "ew") {
    if (typeof candidate !== "string" || typeof expected !== "string") return false;
    const left = caseExact ? candidate : candidate.toLowerCase();
    const right = caseExact ? expected : expected.toLowerCase();
    if (operator === "co") return left.includes(right);
    if (operator === "sw") return left.startsWith(right);
    return left.endsWith(right);
  }

  let left = candidate;
  let right: unknown = expected;
  if (typeof left === "string" && typeof right === "string" && !caseExact) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }
  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  if (
    (typeof left !== "string" || typeof right !== "string") &&
    (typeof left !== "number" || typeof right !== "number")
  ) {
    return false;
  }
  if (operator === "gt") return left > right;
  if (operator === "ge") return left >= right;
  if (operator === "lt") return left < right;
  return left <= right;
};

const isPresent = (value: unknown): boolean => {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(isPresent);
  if (isRecord(value)) return Object.values(value).some(isPresent);
  return true;
};

export const evaluateScimFilter = (
  filter: ScimFilter,
  resource: unknown,
  options: ScimFilterEvaluationOptions = {}
): boolean => {
  if (filter.type === "and") {
    return (
      evaluateScimFilter(filter.left, resource, options) &&
      evaluateScimFilter(filter.right, resource, options)
    );
  }
  if (filter.type === "or") {
    return (
      evaluateScimFilter(filter.left, resource, options) ||
      evaluateScimFilter(filter.right, resource, options)
    );
  }
  if (filter.type === "not") {
    return !evaluateScimFilter(filter.filter, resource, options);
  }
  if (filter.type === "valuePath") {
    return resolvePath(resource, filter.path).some(
      (value) => isRecord(value) && evaluateScimFilter(filter.filter, value, options)
    );
  }
  const values = resolvePath(resource, filter.path);
  if (filter.type === "presence") return values.some(isPresent);
  if (values.length === 0) return false;
  const exact = isCaseExact(filter.path, options);
  return values.some((candidate) =>
    compare(candidate, filter.operator, filter.value, exact)
  );
};
