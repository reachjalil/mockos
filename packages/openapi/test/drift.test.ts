import { mockosMcpToolNames } from "@mockos/contracts";
import {
  mockosHttpOperationIds,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
import { describe, expect, it } from "vitest";
import {
  generateMockLlmAnthropicProviderDocumentation,
  generateMockLlmOpenAiProviderDocumentation,
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

  it("documents exactly the 24 management tools and five implemented HTTP routes", () => {
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(catalog.managementMcp.toolCount).toBe(24);
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

  it("keeps F1 and the bounded F2 provider slice source-qualified while later workloads stay unavailable", () => {
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(catalog.managementMcp.scopeEnforcement).toBe("metadata-only");
    expect(catalog.future.mockMcpServers).toEqual({
      status: "source-qualified",
      phase: "F1",
      testedProtocolVersion: "2025-11-25",
      pathEndpoint: "/e/{environmentId}/mcp-mock/{slug}",
      subdomainEndpoint: "https://{environmentId}.{baseDomain}/mcp-mock/{slug}",
      deployedAcceptance: "unqualified",
    });
    expect(catalog.future.mockLlmApis).toEqual({
      status: "partial-source-qualified",
      phase: "F2",
      managementDefinitions: {
        status: "source-implemented",
        interface: "MCP-only",
        toolIds: [
          "put_mock_llm_server",
          "list_mock_llm_servers",
          "get_mock_llm_server",
          "delete_mock_llm_server",
        ],
        persistence: "environment-schema-v7",
        strictCredentials: "write-only-provider-scoped",
        putContract: {
          expectedRevision: "required-null-create-or-positive-replace",
          replacement: "full-definition",
          strictCredentialReplacement: "resupply-or-rotate-every-enabled-provider",
          safeViewWriteShape: "unsupported",
        },
        deleteContract: {
          expectedRevision: "required-positive",
          behavior: "atomic-cas",
          missingOrReplay: "deleted-false",
          revisionMismatch: "typed-409",
        },
        validation: {
          staticBehavior: "bounded-neutral-plan",
          topLevelArguments: "strict-secret-safe",
          platformAccessKey: "reject-substring-in-definition-keys-and-string-values",
        },
        schemaCompatibility: {
          upgrade: "v6-to-v7",
          rollback: "v6-refuses-v7",
        },
      },
      guide: "docs/mock-llm.md",
      providerDataPlane: {
        status: "openai-and-anthropic-non-streaming-source-qualified",
        managementConfiguration: "MCP-only",
        manifests: [
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ],
        openAi: generateMockLlmOpenAiProviderDocumentation(),
        anthropic: generateMockLlmAnthropicProviderDocumentation(),
        responsesApi: "unavailable",
        conversationState: "unavailable",
        observationsAndAssertions: "unavailable",
      },
      deployedAcceptance: "unqualified",
    });
    expect(catalog.future.codeMode.status).toBe("unavailable");
    expect(Object.values(catalog.placeholders)).toEqual([
      "$MOCKOS_API_KEY",
      "$MOCKOS_MCP_ENDPOINT",
      "$MOCKOS_SYNTHETIC_CREDENTIAL",
      "$MOCKOS_OPENAI_MOCK_CREDENTIAL",
      "$MOCKOS_ANTHROPIC_MOCK_CREDENTIAL",
    ]);
    for (const placeholder of Object.values(catalog.placeholders)) {
      expect(placeholder).toMatch(/^\$[A-Z][A-Z0-9_]+$/);
    }

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toMatch(/mk_[A-Za-z0-9_-]{32,128}/);
    expect(serialized).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  });
});
