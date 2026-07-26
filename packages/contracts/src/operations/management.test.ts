import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mockosMcpToolNames } from "../index";
import {
  mockosHttpOperationIds,
  mockosHttpOperations,
  mockosManagementOperations,
  mockosManagementScopes,
  mockosRouterPath,
} from "./index";

describe("management operation registry", () => {
  it("is exhaustive, unique, and aligned with the compatibility tool-name export", () => {
    const entries = Object.entries(mockosManagementOperations);
    expect(entries.map(([key]) => key)).toEqual(mockosMcpToolNames);
    expect(entries.map(([, operation]) => operation.operationId)).toEqual(
      entries.map(([key]) => key)
    );
    expect(new Set(entries.map(([, operation]) => operation.operationId)).size).toBe(
      entries.length
    );
    expect(entries).toHaveLength(27);
  });

  it("describes only live self-hosted HTTP management routes", () => {
    const declaredHttpOperationIds = Object.values(mockosManagementOperations)
      .filter((operation) => "http" in operation)
      .map((operation) => operation.http.operationId);
    expect(new Set(declaredHttpOperationIds).size).toBe(
      declaredHttpOperationIds.length
    );
    expect(mockosHttpOperationIds).toEqual(declaredHttpOperationIds);
    expect(mockosHttpOperationIds).toEqual([
      "delete_environment",
      "configure_environment",
      "seed_identities",
      "create_application",
      "get_environment_discovery",
    ]);

    const routePairs = mockosHttpOperationIds.map((operationId) => {
      const operation = mockosHttpOperations[operationId];
      return `${operation.http.method} ${operation.http.path}`;
    });
    expect(new Set(routePairs).size).toBe(routePairs.length);
    expect(routePairs).toEqual([
      "DELETE /environments/{environmentId}",
      "PUT /environments/{environmentId}",
      "POST /environments/{environmentId}/identities:seed",
      "POST /environments/{environmentId}/applications",
      "GET /environments/{environmentId}/well-known",
    ]);
    expect(mockosHttpOperationIds).toHaveLength(5);
  });

  it("keeps mock-MCP server management MCP-only with explicit safety metadata", () => {
    const toolNames = [
      "put_mock_mcp_server",
      "list_mock_mcp_servers",
      "get_mock_mcp_server",
      "delete_mock_mcp_server",
      "reset_mock_mcp_state",
    ] as const;
    for (const toolName of toolNames) {
      expect("http" in mockosManagementOperations[toolName]).toBe(false);
      expect(mockosManagementOperations[toolName].mcp.annotations.openWorldHint).toBe(
        false
      );
    }

    expect(mockosManagementOperations.put_mock_mcp_server).toMatchObject({
      requiredScopes: ["env:rw"],
      effect: "destructive",
      retry: "idempotent",
      requestSecrets: "redact",
      responseSecrets: "none",
      mcp: {
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
    });
    expect(mockosManagementOperations.put_mock_mcp_server.description).toBe(
      "Creates with expectedRevision null or atomically replaces one environment-local mock MCP server at its current positive revision. Canonical replay succeeds before the revision check. A changed replacement deletes the prior revision's application state and terminates its revision-bound sessions. Replacement is a full definition write, so a bearer Mock Credential must be resupplied or rotated; credentials are accepted only in this write operation and are never returned."
    );
    const putInputJsonSchema = JSON.stringify(
      z.toJSONSchema(mockosManagementOperations.put_mock_mcp_server.mcp.inputSchema, {
        io: "input",
      })
    );
    const putInputSchema = z.toJSONSchema(
      mockosManagementOperations.put_mock_mcp_server.mcp.inputSchema,
      { io: "input" }
    );
    expect(putInputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["expectedRevision", "server"],
      properties: {
        expectedRevision: {
          anyOf: [{ type: "null" }, { type: "integer", minimum: 1 }],
        },
      },
    });
    expect(putInputJsonSchema).toContain('"token"');
    expect(putInputJsonSchema).not.toContain("tokenSha256");
    for (const toolName of [
      "put_mock_mcp_server",
      "get_mock_mcp_server",
      "list_mock_mcp_servers",
    ] as const) {
      const outputJsonSchema = JSON.stringify(
        z.toJSONSchema(mockosManagementOperations[toolName].mcp.outputSchema, {
          io: "output",
        })
      );
      expect(outputJsonSchema).not.toContain("tokenSha256");
      expect(outputJsonSchema).not.toContain('"token"');
    }
    for (const toolName of ["list_mock_mcp_servers", "get_mock_mcp_server"] as const) {
      expect(mockosManagementOperations[toolName]).toMatchObject({
        requiredScopes: ["env:ro"],
        effect: "read",
        retry: "safe",
        requestSecrets: "none",
        responseSecrets: "none",
        mcp: {
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
        },
      });
    }
    for (const toolName of [
      "delete_mock_mcp_server",
      "reset_mock_mcp_state",
    ] as const) {
      expect(mockosManagementOperations[toolName]).toMatchObject({
        requiredScopes: ["env:rw"],
        effect: "destructive",
        retry: "idempotent",
        requestSecrets: "none",
        responseSecrets: "none",
        mcp: {
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
          },
        },
      });
      expect(
        z.toJSONSchema(mockosManagementOperations[toolName].mcp.inputSchema, {
          io: "input",
        })
      ).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["slug", "expectedRevision"],
        properties: {
          expectedRevision: { type: "integer", minimum: 1 },
        },
      });
    }
  });

  it("keeps the blueprint catalog and installer MCP-only with exact safety contracts", () => {
    for (const toolName of [
      "list_mock_mcp_blueprints",
      "get_mock_mcp_blueprint",
      "install_mock_mcp_blueprint",
    ] as const) {
      expect("http" in mockosManagementOperations[toolName]).toBe(false);
      expect(mockosManagementOperations[toolName].requestSecrets).toBe("none");
      expect(mockosManagementOperations[toolName].responseSecrets).toBe("none");
      expect(mockosManagementOperations[toolName].mcp.annotations.openWorldHint).toBe(
        false
      );
    }

    for (const toolName of [
      "list_mock_mcp_blueprints",
      "get_mock_mcp_blueprint",
    ] as const) {
      expect(mockosManagementOperations[toolName]).toMatchObject({
        requiredScopes: ["env:ro"],
        effect: "read",
        retry: "safe",
        mcp: {
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
        },
      });
    }
    expect(mockosManagementOperations.install_mock_mcp_blueprint).toMatchObject({
      requiredScopes: ["env:rw"],
      effect: "destructive",
      retry: "idempotent",
      mcp: {
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    });
    expect(mockosManagementOperations.install_mock_mcp_blueprint.description).toBe(
      "Creates with expectedRevision null or compare-and-swap replaces an environment-local mock MCP server from a built-in deterministic synthetic blueprint, optionally under a caller-selected slug. Canonical replay is idempotent. A changed replacement deletes the prior revision's application state and terminates its revision-bound sessions."
    );

    expect(
      z.toJSONSchema(
        mockosManagementOperations.list_mock_mcp_blueprints.mcp.inputSchema,
        { io: "input" }
      )
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(
      z.toJSONSchema(
        mockosManagementOperations.get_mock_mcp_blueprint.mcp.inputSchema,
        { io: "input" }
      )
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["blueprintId"],
    });
    expect(
      z.toJSONSchema(
        mockosManagementOperations.install_mock_mcp_blueprint.mcp.inputSchema,
        { io: "input" }
      )
    ).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["blueprintId", "expectedRevision"],
      properties: {
        expectedRevision: {
          anyOf: [{ type: "null" }, { type: "integer", minimum: 1 }],
        },
      },
    });
  });

  it("keeps mock-LLM server management MCP-only and credential-safe", () => {
    const toolNames = [
      "put_mock_llm_server",
      "list_mock_llm_servers",
      "get_mock_llm_server",
      "delete_mock_llm_server",
    ] as const;
    for (const toolName of toolNames) {
      expect("http" in mockosManagementOperations[toolName]).toBe(false);
      expect(mockosManagementOperations[toolName].mcp.annotations.openWorldHint).toBe(
        false
      );
    }

    expect(mockosManagementOperations.put_mock_llm_server).toMatchObject({
      requiredScopes: ["env:rw"],
      effect: "mutation",
      retry: "idempotent",
      requestSecrets: "redact",
      responseSecrets: "none",
      mcp: {
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
    });
    const putInputJsonSchema = JSON.stringify(
      z.toJSONSchema(mockosManagementOperations.put_mock_llm_server.mcp.inputSchema, {
        io: "input",
      })
    );
    expect(putInputJsonSchema).toContain('"expectedRevision"');
    expect(putInputJsonSchema).toContain('"apiKey"');
    expect(putInputJsonSchema).not.toContain("apiKeySha256");

    for (const toolName of ["put_mock_llm_server", "get_mock_llm_server"] as const) {
      const outputJsonSchema = JSON.stringify(
        z.toJSONSchema(mockosManagementOperations[toolName].mcp.outputSchema, {
          io: "output",
        })
      );
      expect(outputJsonSchema).not.toContain("apiKeySha256");
      expect(outputJsonSchema).not.toContain('"apiKey"');
      expect(outputJsonSchema).toContain('"configured"');
    }
    const listOutputJsonSchema = JSON.stringify(
      z.toJSONSchema(
        mockosManagementOperations.list_mock_llm_servers.mcp.outputSchema,
        { io: "output" }
      )
    );
    expect(listOutputJsonSchema).not.toContain("apiKeySha256");
    expect(listOutputJsonSchema).not.toContain('"apiKey"');

    for (const toolName of ["list_mock_llm_servers", "get_mock_llm_server"] as const) {
      expect(mockosManagementOperations[toolName]).toMatchObject({
        requiredScopes: ["env:ro"],
        effect: "read",
        retry: "safe",
        requestSecrets: "none",
        responseSecrets: "none",
        mcp: {
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
        },
      });
    }
    expect(mockosManagementOperations.delete_mock_llm_server).toMatchObject({
      requiredScopes: ["env:rw"],
      effect: "destructive",
      retry: "idempotent",
      requestSecrets: "none",
      responseSecrets: "none",
      mcp: {
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
    });
  });

  it("uses known scopes and safe origin-relative path templates", () => {
    for (const operation of Object.values(mockosManagementOperations)) {
      expect(operation.requiredScopes.length).toBeGreaterThan(0);
      expect(new Set(operation.requiredScopes).size).toBe(
        operation.requiredScopes.length
      );
      for (const scope of operation.requiredScopes) {
        expect(mockosManagementScopes).toContain(scope);
      }
      if (!("http" in operation)) continue;
      expect(operation.http.path).toMatch(/^\/(?!\/)/);
      expect(operation.http.path).not.toMatch(/:\/\//);
      expect(mockosRouterPath(operation.http.path)).not.toContain("{");
      const templateParameters = [...operation.http.path.matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      const pathJsonSchema = z.toJSONSchema(operation.http.pathSchema, {
        io: "input",
      }) as { properties?: Record<string, unknown> };
      expect(Object.keys(pathJsonSchema.properties ?? {}).sort()).toEqual(
        templateParameters
      );
    }
  });
});
