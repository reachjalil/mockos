import { mockMcpJsonSchemaSchema } from "@mockos/contracts";
import { describe, expect, it } from "vitest";
import {
  MOCK_MCP_JSON_SCHEMA_VALIDATION_WORK_BUDGET,
  validateMockMcpJsonSchema,
} from "./json-schema";
import {
  createTestHarness,
  initialize,
  rpc,
  serverRecord,
  textToolResult,
} from "./test-support";

const pathologicalInputSchema = () =>
  mockMcpJsonSchemaSchema.parse({
    type: "object",
    properties: {
      values: {
        type: "array",
        items: {
          allOf: Array.from({ length: 8 }, () => ({
            anyOf: [
              { type: "null" },
              { type: "boolean" },
              { type: "string" },
              { type: "array" },
              { type: "object" },
              { type: "integer", minimum: 10 },
              { type: "integer", maximum: 0 },
              { type: "integer" },
            ],
          })),
        },
      },
    },
    required: ["values"],
    additionalProperties: false,
  });

describe("mock MCP JSON Schema validation", () => {
  it("supports the accepted assertion subset within the work budget", () => {
    const schema = mockMcpJsonSchemaSchema.parse({
      type: "object",
      properties: {
        fixed: {
          const: { alpha: 1, nested: [true, null] },
        },
        selected: {
          enum: [
            { kind: "first", value: 1 },
            { kind: "second", value: 2 },
          ],
        },
        records: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "object",
            properties: {
              id: { type: "integer", minimum: 1 },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        variant: {
          oneOf: [
            { type: "string", minLength: 2 },
            { type: "integer", minimum: 1 },
          ],
        },
        nested: {
          allOf: [
            { type: "object" },
            {
              anyOf: [{ required: ["enabled"] }, { required: ["fallback"] }],
            },
          ],
          not: { type: "null" },
        },
      },
      required: ["fixed", "selected", "records", "variant", "nested"],
      additionalProperties: false,
    });

    expect(
      validateMockMcpJsonSchema(schema, {
        fixed: { nested: [true, null], alpha: 1 },
        selected: { value: 2, kind: "second" },
        records: [{ id: 1 }, { id: 2 }],
        variant: "ok",
        nested: { enabled: true },
      })
    ).toEqual({ valid: true, issues: [] });

    const invalid = validateMockMcpJsonSchema(schema, {
      fixed: { nested: [true, null], alpha: 1 },
      selected: { kind: "missing" },
      records: [{ id: 1 }, { id: 1 }],
      variant: false,
      nested: {},
      extra: true,
    });
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error("Expected schema validation to fail.");
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.selected",
          message: "must equal one of the configured values",
        }),
        expect.objectContaining({
          path: "$.records",
          message: "must contain unique items",
        }),
        expect.objectContaining({
          path: "$.variant",
          message: "must satisfy exactly one oneOf schema",
        }),
        expect.objectContaining({
          path: "$.nested",
          message: "must satisfy at least one anyOf schema",
        }),
        expect.objectContaining({
          path: "$.extra",
          message: "is not an allowed property",
        }),
      ])
    );
  });

  it("shares one deterministic budget across speculative composition branches", () => {
    const schema = pathologicalInputSchema();
    const validation = validateMockMcpJsonSchema(schema, {
      values: Array.from({ length: 400 }, () => 1),
    });

    expect(MOCK_MCP_JSON_SCHEMA_VALIDATION_WORK_BUDGET).toBe(50_000);
    expect(validation).toEqual({
      valid: false,
      issues: [{ path: "$", message: "validation work budget exceeded" }],
    });
    if (validation.valid) throw new Error("Expected schema validation to fail.");
    expect(Object.isFrozen(validation.issues)).toBe(true);
    expect(Object.isFrozen(validation.issues[0])).toBe(true);
  });

  it("charges repeated long property-name scans across composition branches", () => {
    const schema = mockMcpJsonSchemaSchema.parse({
      type: "object",
      allOf: Array.from({ length: 8 }, () => ({
        allOf: Array.from({ length: 8 }, () => ({
          type: "object",
          additionalProperties: false,
        })),
      })),
    });
    const attackerControlledKey = "x".repeat(200_000);
    const value = { [attackerControlledKey]: true };

    expect(JSON.stringify(value).length).toBeLessThan(256 * 1024);
    expect(validateMockMcpJsonSchema(schema, value)).toEqual({
      valid: false,
      issues: [{ path: "$", message: "validation work budget exceeded" }],
    });
  });

  it("charges repeated nested path construction below a long property name", () => {
    const schema = mockMcpJsonSchemaSchema.parse({
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "integer" },
      },
    });
    const attackerControlledKey = "x".repeat(200_000);
    const value = {
      [attackerControlledKey]: Array.from({ length: 4_000 }, () => 1),
    };
    const wireBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "budgeted", arguments: value },
    });

    expect(new TextEncoder().encode(wireBody).byteLength).toBeLessThan(256 * 1024);
    expect(validateMockMcpJsonSchema(schema, value)).toEqual({
      valid: false,
      issues: [{ path: "$", message: "validation work budget exceeded" }],
    });
  });

  it("maps budget exhaustion to a bounded tools/call isError result", async () => {
    const harness = createTestHarness(
      serverRecord({
        tools: [
          {
            name: "budgeted",
            inputSchema: pathologicalInputSchema(),
            behavior: {
              version: 1,
              type: "static",
              value: textToolResult("must not execute"),
            },
          },
        ],
      })
    );
    const { sessionId } = await initialize(harness);

    const response = await rpc(
      harness,
      {
        jsonrpc: "2.0",
        id: 81,
        method: "tools/call",
        params: {
          name: "budgeted",
          arguments: {
            values: Array.from({ length: 400 }, () => 1),
          },
        },
      },
      sessionId
    );
    const body = (await response.json()) as {
      readonly result?: {
        readonly content?: readonly {
          readonly text?: string;
          readonly type: string;
        }[];
        readonly isError?: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content).toEqual([
      {
        type: "text",
        text: "Tool arguments do not match inputSchema.",
      },
      {
        type: "text",
        text: "$ validation work budget exceeded",
      },
    ]);
    expect(JSON.stringify(body).length).toBeLessThan(512);
  });
});
