import {
  MOCK_MCP_MAX_URI_LENGTH,
  MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES,
  mockMcpUriTemplateSchema,
  mockMcpUriTemplateVariables,
} from "@mockos/contracts";
import type { JsonValue } from "@mockos/contracts/behavior";

const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export class MockMcpResourceTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockMcpResourceTemplateError";
  }
}

type CompiledResourceTemplate = {
  readonly literals: readonly string[];
  readonly variables: readonly string[];
};

type MatchWork = {
  operations: number;
};

type CaptureNode = {
  readonly end: number;
  readonly previous: CaptureNode | null;
  readonly start: number;
  readonly variableIndex: number;
};

type ActiveCapture = {
  readonly previous: CaptureNode | null;
  readonly start: number;
};

export type MockMcpResourceTemplateMatchInspection = {
  readonly operations: number;
  readonly values: Readonly<Record<string, JsonValue>> | undefined;
};

const recordOperation = (work: MatchWork, amount = 1): void => {
  work.operations += amount;
};

const compileLevelOneTemplate = (uriTemplate: string): CompiledResourceTemplate => {
  const parsed = mockMcpUriTemplateSchema.safeParse(uriTemplate);
  if (!parsed.success) {
    throw new MockMcpResourceTemplateError(
      parsed.error.issues[0]?.message ??
        "Resource templates must be bounded Level 1 absolute URIs."
    );
  }

  const variables = [...mockMcpUriTemplateVariables(parsed.data)];
  if (variables.length < 1 || variables.length > MOCK_MCP_MAX_URI_TEMPLATE_VARIABLES) {
    throw new MockMcpResourceTemplateError(
      "A resource template requires at least one Level 1 expression."
    );
  }

  const literals: string[] = [];
  let offset = 0;
  for (const variable of variables) {
    const opening = uriTemplate.indexOf("{", offset);
    const closing = opening < 0 ? -1 : uriTemplate.indexOf("}", opening + 1);
    if (
      opening < 0 ||
      closing < 0 ||
      uriTemplate.slice(opening + 1, closing) !== variable
    ) {
      throw new MockMcpResourceTemplateError("Resource template parsing failed.");
    }
    literals.push(uriTemplate.slice(offset, opening));
    offset = closing + 1;
  }
  literals.push(uriTemplate.slice(offset));

  return {
    literals: Object.freeze(literals),
    variables: Object.freeze(variables),
  };
};

const exactLiteralAt = (
  input: string,
  literal: string,
  offset: number,
  work: MatchWork
): boolean => {
  if (offset + literal.length > input.length) return false;
  for (let index = 0; index < literal.length; index += 1) {
    recordOperation(work);
    if (input[offset + index] !== literal[index]) return false;
  }
  return true;
};

/**
 * Marks every literal start with KMP. Across all template literals this costs
 * O(variableCount * uriLength + templateLength), with both terms contract-bounded.
 */
const literalStartPositions = (
  input: string,
  literal: string,
  work: MatchWork
): Uint8Array => {
  const starts = new Uint8Array(input.length + 1);
  if (literal.length === 0) {
    starts.fill(1);
    recordOperation(work, starts.length);
    return starts;
  }

  const prefix = new Uint16Array(literal.length);
  let matched = 0;
  for (let index = 1; index < literal.length; index += 1) {
    recordOperation(work);
    while (matched > 0 && literal[index] !== literal[matched]) {
      recordOperation(work);
      matched = prefix[matched - 1] ?? 0;
    }
    if (literal[index] === literal[matched]) matched += 1;
    prefix[index] = matched;
  }

  matched = 0;
  for (let index = 0; index < input.length; index += 1) {
    recordOperation(work);
    while (matched > 0 && input[index] !== literal[matched]) {
      recordOperation(work);
      matched = prefix[matched - 1] ?? 0;
    }
    if (input[index] === literal[matched]) matched += 1;
    if (matched === literal.length) {
      starts[index - literal.length + 1] = 1;
      matched = prefix[matched - 1] ?? 0;
    }
  }
  return starts;
};

const isAsciiAlphaNumeric = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a);

const isHexadecimal = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x46) ||
  (code >= 0x61 && code <= 0x66);

/**
 * Returns one encoded Level-1 expansion token width. Simple expansion admits
 * unreserved characters and complete percent triplets only; zero means a raw
 * reserved, non-ASCII, or malformed percent character cannot be consumed.
 */
const expansionTokenWidth = (
  input: string,
  offset: number,
  work: MatchWork
): 0 | 1 | 3 => {
  recordOperation(work);
  const code = input.charCodeAt(offset);
  if (
    isAsciiAlphaNumeric(code) ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5f ||
    code === 0x7e
  ) {
    return 1;
  }
  if (
    code === 0x25 &&
    offset + 2 < input.length &&
    isHexadecimal(input.charCodeAt(offset + 1)) &&
    isHexadecimal(input.charCodeAt(offset + 2))
  ) {
    return 3;
  }
  return 0;
};

const matchCompiledTemplate = (
  compiled: CompiledResourceTemplate,
  uri: string,
  work: MatchWork
): readonly string[] | undefined => {
  const prefix = compiled.literals[0];
  if (prefix === undefined || !exactLiteralAt(uri, prefix, 0, work)) {
    return undefined;
  }

  let reachable: Array<CaptureNode | null | undefined> = Array.from({
    length: uri.length + 1,
  });
  reachable[prefix.length] = null;

  for (
    let variableIndex = 0;
    variableIndex < compiled.variables.length;
    variableIndex += 1
  ) {
    const literal = compiled.literals[variableIndex + 1];
    if (literal === undefined) return undefined;
    const literalStarts = literalStartPositions(uri, literal, work);
    const active: Array<ActiveCapture | undefined> = Array.from({
      length: uri.length + 1,
    });
    const next: Array<CaptureNode | undefined> = Array.from({
      length: uri.length + 1,
    });

    for (let position = 0; position <= uri.length; position += 1) {
      recordOperation(work);
      const previous = reachable[position];
      if (previous !== undefined && active[position] === undefined) {
        active[position] = { previous, start: position };
      }
      const candidate = active[position];
      if (!candidate) continue;

      if (literalStarts[position] === 1) {
        const end = position + literal.length;
        next[end] = {
          end: position,
          previous: candidate.previous,
          start: candidate.start,
          variableIndex,
        };
      }

      if (position < uri.length) {
        const width = expansionTokenWidth(uri, position, work);
        if (width > 0 && active[position + width] === undefined) {
          active[position + width] = candidate;
        }
      }
    }
    reachable = next;
  }

  let node = reachable[uri.length];
  if (node === undefined || node === null) return undefined;
  const encodedValues: string[] = Array.from({
    length: compiled.variables.length,
  });
  while (node) {
    encodedValues[node.variableIndex] = uri.slice(node.start, node.end);
    node = node.previous;
  }
  return Object.freeze(encodedValues);
};

const decodedTemplateValues = (
  compiled: CompiledResourceTemplate,
  encodedValues: readonly string[]
): Readonly<Record<string, JsonValue>> | undefined => {
  const values: Record<string, JsonValue> = {};
  for (const [index, variable] of compiled.variables.entries()) {
    const encoded = encodedValues[index];
    if (encoded === undefined) return undefined;
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
    if (Object.hasOwn(values, variable) && values[variable] !== decoded) {
      return undefined;
    }
    values[variable] = decoded;
  }
  return Object.freeze(values);
};

/**
 * Internal deterministic-work inspection used by conformance tests. It is not
 * re-exported from the package entry point.
 */
export const inspectMockMcpResourceTemplateMatch = (
  uriTemplate: string,
  uri: string
): MockMcpResourceTemplateMatchInspection => {
  if (uri.length < 1 || uri.length > MOCK_MCP_MAX_URI_LENGTH || !URI_SCHEME.test(uri)) {
    return { operations: 0, values: undefined };
  }
  const compiled = compileLevelOneTemplate(uriTemplate);
  const work: MatchWork = { operations: 0 };
  const encodedValues = matchCompiledTemplate(compiled, uri, work);
  return {
    operations: work.operations,
    values:
      encodedValues === undefined
        ? undefined
        : decodedTemplateValues(compiled, encodedValues),
  };
};

/** Throws unless a template uses the intentionally small RFC 6570 Level 1 subset. */
export const assertMockMcpLevelOneResourceTemplate = (uriTemplate: string): void => {
  compileLevelOneTemplate(uriTemplate);
};

/**
 * Matches one concrete URI and returns detached template values. Ambiguous
 * adjacent expressions use leftmost-minimal expansion, so earlier variables
 * are empty when possible. Reserved characters must arrive percent-encoded.
 */
export const matchMockMcpResourceTemplate = (
  uriTemplate: string,
  uri: string
): Readonly<Record<string, JsonValue>> | undefined =>
  inspectMockMcpResourceTemplateMatch(uriTemplate, uri).values;
