import { mockosMcpToolNames } from "../index";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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
