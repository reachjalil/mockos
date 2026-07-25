import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  generateMockosProductCapabilityIndex,
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

  it("keeps F1 and bounded F2 provider/observation slices source-qualified while later workloads stay unavailable", () => {
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
        persistence: "environment-schema-v8",
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
          upgrade: "v7-to-v8",
          rollback: "v7-refuses-v8",
        },
      },
      guide: "docs/mock-llm.md",
      providerDataPlane: {
        status: "openai-and-anthropic-streaming-source-qualified",
        managementConfiguration: "MCP-only",
        manifests: [
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ],
        openAi: generateMockLlmOpenAiProviderDocumentation(),
        anthropic: generateMockLlmAnthropicProviderDocumentation(),
        responsesApi: "unavailable",
        conversationState: "unavailable",
        observationsAndAssertions: {
          status: "bounded-metadata-only-source-qualified",
          managementTools: ["get_request_log", "assert_requests"],
          scope: "successfully-parsed-and-planned-posts-after-response-preflight",
          dialects: ["openai", "anthropic"],
          operations: ["chat.completions.create", "messages.create"],
          lifecycle: {
            reservation: "pending-before-provider-delay-and-response-headers",
            reservationBudgetMilliseconds: 50,
            finalization: "append-once-terminal-overlay-one-logical-row",
            terminalOutcomes: ["completed", "cancelled", "deadline_exceeded", "failed"],
            replay: "exact-idempotent-conflicting-rejected-trimmed-no-op",
            failurePolicy: "fail-open-best-effort-no-provider-response-change",
          },
          metadata: {
            queryAndAssertionMatch: "exact",
            sequence: "greedy-earliest-non-overlapping-append-order",
            serverRevision: "exact-rechecked-plan-selection-revision",
            resultShape: "response-plan-metadata-or-configured-error-kind",
            responseId: "preallocated-response-plan-only-omitted-for-configured-errors",
            stream: "accepted-request-stream-intent-configured-errors-may-return-json",
            durationClock: "monotonic-elapsed-integer-milliseconds",
            persistedTerminal: ["outcome", "responseStatus", "durationMs"],
            pendingCompatibilitySentinel: {
              responseStatus: 102,
              durationMs: 0,
              meaning: "legacy-non-null-columns-not-delivery-metadata",
            },
            streamFrameAndByteCounts: "internal-test-only-not-persisted-or-queryable",
          },
          privacy: {
            requestHeaders: "empty",
            requestBody: "null",
            responseHeaders: "empty",
            responseBody: "null",
            collisionPolicy:
              "skip-entire-observation-when-any-prospective-metadata-contains-request-credential",
            excluded: [
              "prompts",
              "outputs",
              "credentials",
              "headers",
              "tool-inputs",
              "planId",
              "requestHash",
            ],
          },
          evidence: {
            designed: "qualified",
            implemented: "qualified",
            sourceTested: "qualified",
            integrationTested: "qualified-mounted-worker",
            sdkClientQualified:
              "provider-behavior-only-observation-management-via-mounted-mcp",
            actualNetwork: "unqualified",
            hostedSmoke: "unqualified",
            verifiedLive: "unqualified",
            productionReady: "unqualified",
          },
        },
      },
      deployedAcceptance: "unqualified",
    });
    expect(
      catalog.future.mockLlmApis.providerDataPlane.anthropic.response.streaming
    ).toEqual({
      format: "server-sent-events",
      framing: "named-event-and-json-data",
      order:
        "message-start-content-block-start-payload-content-block-stop-message-delta-message-stop",
      doneSentinel: "none",
      initialDelay: "pre-header",
      pacedFrames: "text-delta-and-input-json-delta-only",
      immediateFrames: "message-and-content-block-structural-events",
      payloadEventsPerContentBlock: "zero-or-more",
      maximumDuration: "absolute-includes-initial-pacing-backpressure",
      scheduleAdmissibility: "initial+max(payload-count-minus-one,zero)*delay<maximum",
      payloadFrameCount:
        "unicode-code-point-chunks-of-text-and-canonical-tool-input-json",
      deadlineEquality: "rejected",
      bodySizing: "entire-precomputed-sse-utf8",
      preflightFailure: "generic-json-before-200",
      cancellationOrDeadline: "truncate-without-fabricated-message-stop",
      messageDeltaUsage: "cumulative",
      mockEmittedPing: "none-clients-should-tolerate-upstream",
      configuredError: "provider-json-before-200-even-when-stream-requested",
      configuredMidstreamErrors: "unsupported",
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

  it("declares its partial coverage and keeps evidence dimensions independent", () => {
    const index = generateMockosProductCapabilityIndex();
    const catalog = generateMockosManagementDocumentationCatalog();
    const byId = new Map(
      index.capabilities.map((capability) => [capability.id, capability])
    );

    expect(index).toMatchObject({
      schemaVersion: 1,
      provenance: {
        generator: {
          path: "packages/openapi/src/index.ts",
          export: "generateMockosProductCapabilityIndex",
        },
        relatedArtifacts: [
          "docs/reference/management-operations.v1.json",
          "docs/reference/mock-llm-openai.v1.json",
          "docs/reference/mock-llm-anthropic.v1.json",
        ],
      },
      coverage: {
        status: "partial",
        scope: "f0-f2-agent-dependency-interface-slice",
        rule: "absence-means-unindexed-not-unsupported",
      },
      supportModel: {
        rule: "support-describes-bounded-contract-not-hosted-qualification",
      },
      evidenceModel: {
        tiers: ["source", "hostedCi", "cloudPin", "deployed", "verifiedLive"],
        dimensions: {
          qualification: ["qualified", "unqualified", "not-applicable"],
          coverage: ["full", "partial", "none", "not-applicable"],
          revisionRelation: ["current", "historical", "not-applicable"],
        },
        rule: "tiers-and-dimensions-are-independent-no-implicit-promotion",
      },
    });

    expect(index.coverage.unindexedDomains.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "identity-provider-data-planes",
        "scim-and-provisioning-data-planes",
        "private-cloud-product-surfaces",
      ])
    );
    expect(byId.get("management.mcp")?.support).toBe(
      catalog.managementMcp.status === "implemented" ? "supported" : "unsupported"
    );
    expect(byId.get("management.self-hosted-http")?.support).toBe(
      catalog.selfHostedHttp.status === "implemented" ? "supported" : "unsupported"
    );
    expect(byId.get("mock-llm.openai")?.support).toBe(
      catalog.future.mockLlmApis.providerDataPlane.openAi.status === "source-qualified"
        ? "supported"
        : "partial"
    );
    expect(byId.get("mock-llm.anthropic")?.support).toBe(
      catalog.future.mockLlmApis.providerDataPlane.anthropic.status ===
        "source-qualified"
        ? "supported"
        : "partial"
    );
    expect(byId.get("code-mode")).toMatchObject({
      support:
        catalog.future.codeMode.status === "unavailable" ? "unsupported" : "partial",
      evidence: {
        source: {
          qualification: "qualified",
          coverage: "full",
          revisionRelation: "current",
        },
      },
    });
    expect(byId.get("management.mcp")?.evidence.hostedCi).toMatchObject({
      qualification: "qualified",
      coverage: "partial",
      revisionRelation: "historical",
    });
    expect(byId.get("management.self-hosted-http")?.evidence.hostedCi).toMatchObject({
      qualification: "qualified",
      coverage: "full",
      revisionRelation: "historical",
    });
    expect(byId.get("management.self-hosted-http")?.evidence.deployed).toMatchObject({
      qualification: "unqualified",
      coverage: "none",
      revisionRelation: "historical",
      proofRefs: [],
      contextRefs: ["docs/evidence/m6-workers-dev-smoke.md"],
    });
    expect(byId.get("mock-llm.openai")?.evidence.cloudPin.qualification).toBe(
      catalog.future.mockLlmApis.providerDataPlane.openAi.evidence.cloudPin
    );
    expect(byId.get("mock-llm.anthropic")?.evidence.cloudPin.qualification).toBe(
      catalog.future.mockLlmApis.providerDataPlane.anthropic.evidence.cloudPin
    );
  });

  it("keeps capability records thin and every positive evidence claim provable", () => {
    const index = generateMockosProductCapabilityIndex();
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const ids = index.capabilities.map(({ id }) => id);
    const specificationRefs = index.capabilities.map(
      ({ specificationRef }) => specificationRef
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(specificationRefs).size).toBe(specificationRefs.length);
    expect(index.capabilities.length).toBeGreaterThan(0);

    for (const capability of index.capabilities) {
      expect(capability.scope.length).toBeGreaterThan(0);
      expect(capability.documentation.guide.length).toBeGreaterThan(0);
      expect(capability.documentation.reference.length).toBeGreaterThan(0);
      expect(capability.documentation.limitations).toBe("docs/known-limitations.md");
      expect(capability.limitationRefs.length).toBeGreaterThan(0);

      const refs = [
        capability.specificationRef,
        capability.documentation.guide,
        capability.documentation.quickstart,
        capability.documentation.reference,
        capability.documentation.limitations,
        ...capability.limitationRefs,
        ...capability.provenance.executableAuthorities.map(({ path }) => path),
        ...Object.values(capability.evidence).flatMap((claim) => [
          ...claim.proofRefs,
          ...claim.contextRefs,
        ]),
      ].filter((reference): reference is string => reference !== null);
      for (const reference of refs) {
        const fragmentIndex = reference.indexOf("#");
        const path =
          fragmentIndex === -1 ? reference : reference.slice(0, fragmentIndex);
        expect(
          existsSync(resolve(repositoryRoot, path)),
          `${capability.id} references missing repository path ${path}`
        ).toBe(true);
      }

      for (const [tier, claim] of Object.entries(capability.evidence)) {
        expect(claim.scope.length).toBeGreaterThan(0);
        if (claim.qualification === "qualified") {
          expect(
            claim.proofRefs.length,
            `${capability.id} ${tier} needs proof references`
          ).toBeGreaterThan(0);
        } else {
          expect(
            claim.proofRefs,
            `${capability.id} ${tier} must not imply absent proof`
          ).toEqual([]);
        }
        if (claim.qualification === "unqualified") {
          expect(claim.coverage).toBe("none");
          expect(claim.revisionRelation).not.toBe("not-applicable");
        }
        if (claim.qualification === "not-applicable") {
          expect(claim.coverage).toBe("not-applicable");
          expect(claim.revisionRelation).toBe("not-applicable");
          expect(claim.contextRefs).toEqual([]);
        }
        if (tier === "source" && claim.qualification === "qualified") {
          expect(
            claim.proofRefs.every((reference) => reference.endsWith(".test.ts")),
            `${capability.id} source qualification must cite executable tests`
          ).toBe(true);
        }
      }
    }

    for (const domain of index.coverage.includedDomains) {
      expect(domain.authorityRefs.length).toBeGreaterThan(0);
      for (const reference of domain.authorityRefs) {
        expect(existsSync(resolve(repositoryRoot, reference))).toBe(true);
      }
    }
    for (const domain of index.coverage.unindexedDomains) {
      expect(domain.contextRefs.length).toBeGreaterThan(0);
      for (const reference of domain.contextRefs) {
        expect(existsSync(resolve(repositoryRoot, reference))).toBe(true);
      }
    }

    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain('"inputSchema"');
    expect(serialized).not.toContain('"outputSchema"');
    expect(serialized).not.toContain('"maxBodyBytes"');
    expect(serialized).not.toMatch(/mk_[A-Za-z0-9_-]{32,128}/);
    expect(serialized).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  });
});
