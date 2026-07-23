import {
  mockosHttpOperationIds,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
import { describe, expect, it } from "vitest";
import {
  generateMockosHttpOperationManifest,
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
});
