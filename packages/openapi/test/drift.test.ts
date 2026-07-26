import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { mockosMcpToolNames } from "@mockos/contracts";
import {
  mockosHttpOperationIds,
  mockosHttpOperations,
} from "@mockos/contracts/operations";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  generateMockLlmAnthropicProviderDocumentation,
  generateMockLlmOpenAiProviderDocumentation,
  generateMockosHttpOperationManifest,
  generateMockosManagementDocumentationCatalog,
  generateMockosManagementOpenApi,
  generateMockosProductCapabilityIndex,
} from "../src/index";

type JsonSchema = Record<string, unknown>;

type CreateApplicationHttpOperation = {
  requestBody: {
    content: {
      "application/json": {
        schema: JsonSchema;
      };
    };
  };
  responses: Record<
    string,
    {
      content?: {
        "application/json"?: {
          schema: JsonSchema;
        };
      };
    }
  >;
};

const deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code" as const;

type RedirectPolicyCase = {
  name: string;
  clientType?: "confidential" | "public";
  grantTypes?: Array<
    "authorization_code" | "refresh_token" | typeof deviceCodeGrantType
  >;
};

const validPublicDeviceCase: RedirectPolicyCase = {
  name: "public device-only application",
  clientType: "public",
  grantTypes: [deviceCodeGrantType],
};

const invalidEmptyRedirectCases: RedirectPolicyCase[] = [
  {
    name: "default confidential authorization-code application",
  },
  {
    name: "explicit confidential device application",
    clientType: "confidential",
    grantTypes: [deviceCodeGrantType],
  },
  {
    name: "public authorization-code application",
    clientType: "public",
    grantTypes: ["authorization_code"],
  },
  {
    name: "public mixed authorization-code and device application",
    clientType: "public",
    grantTypes: ["authorization_code", deviceCodeGrantType],
  },
  {
    name: "public refresh-only application",
    clientType: "public",
    grantTypes: ["refresh_token"],
  },
];

const createApplicationHttpOperation = (
  document: ReturnType<typeof generateMockosManagementOpenApi>
): CreateApplicationHttpOperation => {
  const paths = document.paths as Record<
    string,
    { post?: CreateApplicationHttpOperation }
  >;
  const operation = paths["/environments/{environmentId}/applications"]?.post;
  if (!operation) {
    throw new Error("The generated create_application HTTP operation is missing.");
  }
  return operation;
};

const compileOpenApiSchema = (schema: JsonSchema) => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
};

const collectLocalDocumentRefs = (
  value: unknown,
  path = "#"
): Array<{ path: string; ref: string }> => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectLocalDocumentRefs(entry, `${path}/${index}`)
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const entryPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (key === "$ref" && typeof entry === "string" && entry.startsWith("#")) {
      return [{ path: entryPath, ref: entry }];
    }
    return collectLocalDocumentRefs(entry, entryPath);
  });
};

const resolveLocalDocumentRef = (document: JsonSchema, reference: string): unknown => {
  if (reference === "#") {
    return document;
  }
  if (!reference.startsWith("#/")) {
    throw new Error(`Reference ${JSON.stringify(reference)} is not document-local.`);
  }
  const pointer = decodeURIComponent(reference.slice(1));
  let current: unknown = document;
  for (const encodedToken of pointer.slice(1).split("/")) {
    if (current === null || typeof current !== "object") {
      throw new Error(
        `Reference ${JSON.stringify(reference)} traverses a non-object value.`
      );
    }
    const token = encodedToken.replaceAll("~1", "/").replaceAll("~0", "~");
    const object = current as Record<string, unknown>;
    if (!Object.hasOwn(object, token)) {
      throw new Error(
        `Reference ${JSON.stringify(reference)} has no token ${JSON.stringify(token)}.`
      );
    }
    current = object[token];
  }
  return current;
};

const compileOpenApiDocumentSchema = (document: JsonSchema, schemaReference: string) =>
  compileOpenApiSchema({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document,
    $ref: schemaReference,
  });

const emptyRedirectApplicationInput = (testCase: RedirectPolicyCase) => ({
  name: testCase.name,
  redirectUris: [],
  ...(testCase.clientType === undefined ? {} : { clientType: testCase.clientType }),
  ...(testCase.grantTypes === undefined ? {} : { grantTypes: testCase.grantTypes }),
});

const emptyRedirectApplicationRegistration = (testCase: RedirectPolicyCase) => ({
  name: "Device application",
  id: "app-device",
  clientId: "client-device",
  redirectUris: [],
  appRoles: [],
  groupClaimsMode: "none",
  createdAt: "2026-07-26T00:00:00Z",
  ...(testCase.clientType === undefined ? {} : { clientType: testCase.clientType }),
  ...(testCase.clientType === "confidential" ? { clientSecret: "secret-device" } : {}),
  ...(testCase.grantTypes === undefined ? {} : { grantTypes: testCase.grantTypes }),
});

describe("management OpenAPI generation", () => {
  it("emits OpenAPI 3.1 Schema Objects governed by the OAS base dialect", () => {
    const document = generateMockosManagementOpenApi();
    const serialized = JSON.stringify(document);

    expect(document).toMatchObject({
      openapi: "3.1.0",
      jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    });
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"$defs"');
    expect(serialized).not.toContain('"nullable"');
    expect(serialized).toContain('"if"');
    expect(serialized).toContain('"else"');
    expect(serialized).toContain('"contains"');
    expect(serialized).toContain('"const"');
  });

  it("resolves every local ref from the full OpenAPI document and preserves recursive JSON values", () => {
    const document = generateMockosManagementOpenApi();
    const localRefs = collectLocalDocumentRefs(document);
    const recursiveComponentRef =
      "#/components/schemas/GetEnvironmentDiscoveryResponse200Definition1";

    expect(localRefs.length).toBeGreaterThan(0);
    for (const reference of localRefs) {
      expect(
        () => resolveLocalDocumentRef(document, reference.ref),
        `${reference.path} -> ${reference.ref}`
      ).not.toThrow();
    }
    expect(localRefs.map(({ ref }) => ref)).toContain(recursiveComponentRef);
    expect(
      collectLocalDocumentRefs(
        resolveLocalDocumentRef(document, recursiveComponentRef)
      ).map(({ ref }) => ref)
    ).toContain(recursiveComponentRef);

    const wellKnownResponseRef =
      "#/paths/~1environments~1{environmentId}~1well-known/get/responses/200/content/application~1json/schema";
    const validate = compileOpenApiDocumentSchema(document, wellKnownResponseRef);
    const response = {
      data: {
        issuer: "https://mock.example/e/env-device",
        authorization_endpoint:
          "https://mock.example/e/env-device/oauth2/v2.0/authorize",
        token_endpoint: "https://mock.example/e/env-device/oauth2/v2.0/token",
        jwks_uri: "https://mock.example/e/env-device/.well-known/jwks.json",
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        claims_supported: ["sub"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        mockos_nested_extension: {
          values: [null, true, 42, "recursive", { deeper: ["value"] }],
        },
      },
      meta: { requestId: "request-openapi-document" },
    };

    expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
  });

  it("enforces redirect-free device-only semantics in the HTTP request Schema Object", () => {
    const operation = createApplicationHttpOperation(generateMockosManagementOpenApi());
    const validate = compileOpenApiSchema(
      operation.requestBody.content["application/json"].schema
    );

    expect(
      validate(emptyRedirectApplicationInput(validPublicDeviceCase)),
      JSON.stringify(validate.errors)
    ).toBe(true);
    for (const testCase of invalidEmptyRedirectCases) {
      expect(
        validate(emptyRedirectApplicationInput(testCase)),
        `${testCase.name}: ${JSON.stringify(validate.errors)}`
      ).toBe(false);
    }
  });

  it("enforces redirect-free device-only semantics in the HTTP response Schema Object", () => {
    const operation = createApplicationHttpOperation(generateMockosManagementOpenApi());
    const responseSchema =
      operation.responses["201"]?.content?.["application/json"]?.schema;
    if (!responseSchema) {
      throw new Error("The create_application 201 response Schema Object is missing.");
    }
    const validate = compileOpenApiSchema(responseSchema);
    const envelope = (data: Record<string, unknown>) => ({
      data,
      meta: { requestId: "request-openapi-31" },
    });

    expect(
      validate(envelope(emptyRedirectApplicationRegistration(validPublicDeviceCase))),
      JSON.stringify(validate.errors)
    ).toBe(true);
    for (const testCase of invalidEmptyRedirectCases) {
      expect(
        validate(envelope(emptyRedirectApplicationRegistration(testCase))),
        `${testCase.name}: ${JSON.stringify(validate.errors)}`
      ).toBe(false);
    }
  });

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

  it("documents exactly the 27 management tools and five implemented HTTP routes", () => {
    const catalog = generateMockosManagementDocumentationCatalog();

    expect(catalog.managementMcp.toolCount).toBe(27);
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
      managementDefinitions: {
        status: "source-implemented",
        interface: "MCP-only",
        toolIds: [
          "put_mock_mcp_server",
          "list_mock_mcp_servers",
          "get_mock_mcp_server",
          "delete_mock_mcp_server",
          "reset_mock_mcp_state",
          "list_mock_mcp_blueprints",
          "get_mock_mcp_blueprint",
          "install_mock_mcp_blueprint",
        ],
        persistence: "environment-schema-v6",
        bearerCredentials: "write-only-server-scoped",
        putContract: {
          expectedRevision: "required-null-create-or-positive-replace",
          replay: "canonical-before-cas",
          identicalDeleteRecreate: "converges-to-current-generation-without-mutation",
          replacement: "full-definition",
          changedReplacementEffect: "deletes-state-and-terminates-revision-sessions",
          bearerCredentialReplacement: "resupply-or-rotate",
          safeViewWriteShape: "unsupported",
          revisionMismatch: "typed-409-for-changed-definition",
        },
        resetContract: {
          expectedRevision: "required-positive",
          behavior: "atomic-cas",
          preserves: "definition-revision-and-sessions",
          exactReplay: "cleared-zero",
          missing: "typed-404",
          revisionMismatch: "typed-409",
        },
        deleteContract: {
          expectedRevision: "required-positive",
          behavior: "atomic-cas",
          removes: "definition-state-and-sessions",
          success: "deleted-true",
          missingOrReplay: "typed-404",
          revisionMismatch: "typed-409",
        },
        validation: {
          topLevelArguments: "strict-secret-safe",
          definitionFailures: "credential-free-generic",
          bearerCredentialReuse:
            "rejected-from-all-other-definition-keys-and-string-values",
          dependencyResultCredentialReflection: "fail-closed",
          revision: "positive-safe-integer",
        },
        blueprintCatalog: {
          status: "source-qualified",
          interface: "MCP-only",
          schemaVersion: 1,
          catalogScope: "built-in-secret-free-server-definition-presets",
          artifact: "docs/reference/mock-mcp-blueprints.v1.json",
          canonicalSource: "packages/core/src/mock-mcp/blueprints.ts",
          blueprintIds: ["salesforce/hosted-mcp/sobject-reads"],
          provenance: "documentation-derived-at-recorded-review-date",
          fidelity: "deterministic-synthetic-no-provider-network",
          outputWireParity: "unqualified",
          portableBlueprintSystem: "not-f5-export-import-apply-or-gallery",
          installContract: {
            expectedRevision: "required-null-create-or-positive-replace",
            slug: "default-or-validated-override",
            replay: "canonical-before-cas",
            changedReplacementEffect: "deletes-state-and-terminates-revision-sessions",
            dependencyResultValidation: "exact-full-public-spec-match",
            credentials: "none",
          },
        },
      },
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
        persistence: "environment-baseline-schema",
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
          "docs/reference/mock-mcp-blueprints.v1.json",
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
