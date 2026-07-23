import { mockosMcpToolNames } from "@mockos/contracts";
import {
  mockosHttpOperationIds,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
import { describe, expect, it } from "vitest";
import {
  generateMockosHttpOperationManifest,
  generateMockosManagementDocumentationCatalog,
  generateMockosManagementOpenApi,
} from "../src/index";

describe("management OpenAPI generation", () => {
  it("contains exactly the live HTTP operation registry", () => {
    const document = generateMockosManagementOpenApi();
    const paths = document.paths as Record<
      string,
      Record<string, { operationId: string; "x-mockos-scopes": string[] }>
    >;
    const generated = Object.entries(paths)
      .flatMap(([path, pathItem]) =>
        Object.entries(pathItem).map(([method, operation]) => ({
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path,
          scopes: operation["x-mockos-scopes"],
        }))
      )
      .sort((left, right) => left.operationId.localeCompare(right.operationId));

    const expected = [...mockosHttpOperationIds]
      .map((operationId) => {
        const operation = mockosHttpOperations[operationId];
        return {
          operationId: operation.http.operationId,
          method: operation.http.method,
          path: operation.http.path,
          scopes: [...operation.requiredScopes],
        };
      })
      .sort((left, right) => left.operationId.localeCompare(right.operationId));

    expect(generated).toEqual(expected);
  });

  it("produces the checked client authorization manifest from the same source", () => {
    const manifest = generateMockosHttpOperationManifest();
    expect(Object.keys(manifest)).toEqual([...mockosHttpOperationIds].sort());
    for (const [operationId, entry] of Object.entries(manifest)) {
      expect(entry.operationId).toBe(operationId);
      expect(entry.path).toMatch(/^\/(?!\/)/);
      expect(entry.path).not.toContain("://");
      expect(entry.requiredScopes.length).toBeGreaterThan(0);
    }
  });

  it("documents exactly the 15 management tools and five implemented HTTP routes", () => {
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(catalog.managementMcp.toolCount).toBe(15);
    expect(catalog.managementMcp.tools.map(({ operationId }) => operationId)).toEqual(
      mockosMcpToolNames
    );
    expect(
      catalog.managementMcp.tools.every(({ mcp }) => mcp.status === "implemented")
    ).toBe(true);

    expect(catalog.selfHostedHttp.routeCount).toBe(5);
    expect(
      catalog.selfHostedHttp.operations.map(({ operationId }) => operationId)
    ).toEqual([...mockosHttpOperationIds].sort());
    expect(
      catalog.managementMcp.tools.filter(({ http }) => http !== null)
    ).toHaveLength(5);
  });

  it("keeps future MCP workloads unavailable and uses inert secret placeholders", () => {
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(catalog.managementMcp.scopeEnforcement).toBe("metadata-only");
    expect(catalog.future.mockMcpServers).toEqual({
      status: "unavailable",
      phase: "F1",
    });
    expect(catalog.future.codeMode.status).toBe("unavailable");
    expect(Object.values(catalog.placeholders)).toEqual([
      "$MOCKOS_API_KEY",
      "$MOCKOS_MCP_ENDPOINT",
      "$MOCKOS_SYNTHETIC_CREDENTIAL",
    ]);
    for (const placeholder of Object.values(catalog.placeholders)) {
      expect(placeholder).toMatch(/^\$[A-Z][A-Z0-9_]+$/);
    }

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toMatch(/mk_[A-Za-z0-9_-]{32,128}/);
    expect(serialized).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  });
});
