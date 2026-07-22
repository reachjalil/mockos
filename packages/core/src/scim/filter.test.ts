import { describe, expect, it } from "vitest";
import {
  assertScimIfMatch,
  formatScimEtag,
  parseScimEtag,
  parseScimIfMatch,
  ScimProtocolError,
} from "./errors";
import { evaluateScimFilter, parseScimFilter } from "./filter";

const resource = {
  userName: "Ada@Example.test",
  active: true,
  age: 42,
  empty: "",
  emails: [
    { type: "work", value: "ada@corp.test", primary: true },
    { type: "home", value: "ada@example.test", primary: false },
  ],
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    department: "Research",
  },
};

const matches = (filter: string): boolean =>
  evaluateScimFilter(parseScimFilter(filter), resource);

const expectScimType = (
  callback: () => unknown,
  scimType: string | undefined,
  status = 400
): void => {
  try {
    callback();
    throw new Error("Expected a SCIM protocol error.");
  } catch (error) {
    expect(error).toBeInstanceOf(ScimProtocolError);
    expect(error).toMatchObject({ status, scimType });
  }
};

describe("SCIM filter parser and evaluator", () => {
  it("parses case-insensitive operators and JSON primitive literals", () => {
    expect(matches('USERNAME EQ "ada@example.test"')).toBe(true);
    expect(matches("active eq true")).toBe(true);
    expect(matches("active ne false")).toBe(true);
    expect(matches("age eq 42")).toBe(true);
    expect(matches("missing eq null")).toBe(false);
  });

  it.each([
    ['userName co "@example"', true],
    ['userName sw "ADA@"', true],
    ['userName ew ".TEST"', true],
    ["age gt 41", true],
    ["age ge 42", true],
    ["age lt 43", true],
    ["age le 42", true],
    ["age gt 42", false],
  ])("evaluates %s", (filter, expected) => {
    expect(matches(filter)).toBe(expected);
  });

  it("honors logical precedence, grouping, and not", () => {
    expect(matches('userName eq "nobody" and age lt 1 or active eq true')).toBe(true);
    expect(matches('(userName eq "nobody" or active eq true) and age lt 1')).toBe(
      false
    );
    expect(matches('not (userName eq "nobody")')).toBe(true);
  });

  it("uses same-element semantics for valuePath filters", () => {
    expect(matches('emails[type eq "work" and value ew "corp.test"]')).toBe(true);
    expect(matches('emails[type eq "work" and value ew "example.test"]')).toBe(false);
    expect(matches('emails[type eq "home" or primary eq true]')).toBe(true);
  });

  it("resolves sub-attributes and schema-qualified attributes case-insensitively", () => {
    expect(matches('emails.value co "CORP"')).toBe(true);
    expect(
      matches(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:Department eq "research"'
      )
    ).toBe(true);
  });

  it("implements presence and keeps missing attributes false for ne", () => {
    expect(matches("userName pr")).toBe(true);
    expect(matches("active pr")).toBe(true);
    expect(matches("empty pr")).toBe(false);
    expect(matches("missing pr")).toBe(false);
    expect(matches('missing ne "anything"')).toBe(false);
  });

  it("supports explicit caseExact evaluation without mutating input", () => {
    const before = structuredClone(resource);
    const filter = parseScimFilter('userName eq "ada@example.test"');
    expect(evaluateScimFilter(filter, resource, { caseExactPaths: ["userName"] })).toBe(
      false
    );
    expect(resource).toEqual(before);
  });

  it("decodes escaped JSON strings", () => {
    expect(
      evaluateScimFilter(parseScimFilter('value eq "line\\nfeed"'), {
        value: "line\nfeed",
      })
    ).toBe(true);
  });

  it("rejects malformed, unsupported, and nested valuePath expressions", () => {
    for (const filter of [
      "userName eq ada",
      'userName regex "ada"',
      'userName eq "unterminated',
      'emails[type eq "work"',
      'emails[values[type eq "work"]]',
      "()",
    ]) {
      expectScimType(() => parseScimFilter(filter), "invalidFilter");
    }
  });

  it("enforces byte, token, node, path, literal, and nesting bounds", () => {
    expectScimType(
      () => parseScimFilter('userName eq "Ada"', { maxBytes: 4 }),
      "invalidFilter"
    );
    expectScimType(
      () => parseScimFilter('userName eq "Ada"', { maxTokens: 2 }),
      "invalidFilter"
    );
    expectScimType(
      () => parseScimFilter('userName eq "Ada" or active eq true', { maxNodes: 2 }),
      "invalidFilter"
    );
    expectScimType(
      () => parseScimFilter('longAttribute eq "Ada"', { maxPathBytes: 4 }),
      "invalidFilter"
    );
    expectScimType(
      () => parseScimFilter('userName eq "Ada"', { maxLiteralBytes: 3 }),
      "invalidFilter"
    );
    expectScimType(
      () => parseScimFilter("not (not (active eq true))", { maxDepth: 1 }),
      "invalidFilter"
    );
  });
});

describe("SCIM entity-tag helpers", () => {
  it("formats and parses canonical weak and accepted strong entity tags", () => {
    expect(formatScimEtag(7)).toBe('W/"7"');
    expect(parseScimEtag('W/"7"')).toBe(7);
    expect(parseScimEtag('"8"')).toBe(8);
    expect(parseScimIfMatch(undefined)).toBeUndefined();
    expect(parseScimIfMatch(null)).toBeUndefined();
    expect(parseScimIfMatch("*")).toBe("*");
  });

  it("rejects malformed or unsafe versions and stale preconditions", () => {
    for (const etag of ["", 'W/"0"', 'W/"01"', 'W/"1", W/"2"', "7"]) {
      expectScimType(() => parseScimIfMatch(etag), "invalidVers");
    }
    expectScimType(
      () => assertScimIfMatch(parseScimIfMatch('W/"6"'), 7),
      undefined,
      412
    );
    expect(() => assertScimIfMatch(undefined, 7)).not.toThrow();
    expect(() => assertScimIfMatch("*", 7)).not.toThrow();
    expect(() => assertScimIfMatch(7, 7)).not.toThrow();
  });
});
