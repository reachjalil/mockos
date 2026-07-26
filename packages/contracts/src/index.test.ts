import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ApplicationRegistration,
  applicationListPageSchema,
  applicationRegistrationSchema,
  applicationSummarySchema,
  assertionSpecSchema,
  assertRequestsToolInputSchema,
  brokenTokenVariantSchema,
  type CreateApplicationInput,
  type CreateApplicationToolInput,
  configureEnvironmentToolInputSchema,
  createApplicationToolInputSchema,
  deleteMockMcpServerToolInputSchema,
  environmentConfigSchema,
  getRequestLogToolInputSchema,
  identitySeedSchema,
  lifecycleResultSchema,
  MAX_MANAGEMENT_LIST_PAGE_SIZE,
  managementListQuerySchema,
  mockosMcpToolNames,
  problemSchema,
  providerIdSchema,
  putMockMcpServerToolInputSchema,
  REQUEST_LOG_LLM_PENDING_DURATION_MS,
  REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
  requestLogEntrySchema,
  requestLogLlmFinalizationSchema,
  resetMockMcpStateToolInputSchema,
  SCIM_BEFORE_COMMIT_INJECTION_POINT,
  SCIM_CORE_USER_SCHEMA,
  SCIM_PATCH_PARSE_INJECTION_POINT,
  scenarioListPageSchema,
  scenarioSpecSchema,
  scimUserInputSchema,
  scimWeakEtag,
  seedIdentitiesToolInputSchema,
  setScenarioToolInputSchema,
} from "./index";

describe("wire contracts", () => {
  it("keeps application client variants statically exact", () => {
    type PublicInput = Extract<CreateApplicationInput, { clientType: "public" }>;
    type ConfidentialInput = Extract<
      CreateApplicationInput,
      { clientType?: "confidential" }
    >;
    type PublicToolInput = Extract<
      CreateApplicationToolInput,
      { clientType: "public" }
    >;
    type PublicRegistration = Extract<
      ApplicationRegistration,
      { clientType: "public" }
    >;
    type ConfidentialRegistration = Extract<
      ApplicationRegistration,
      { clientType: "confidential" }
    >;

    expectTypeOf<PublicInput>().not.toHaveProperty("clientSecret");
    expectTypeOf<PublicToolInput>().not.toHaveProperty("clientSecret");
    expectTypeOf<ConfidentialInput>()
      .toHaveProperty("clientSecret")
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<PublicRegistration>().not.toHaveProperty("clientSecret");
    expectTypeOf<ConfidentialRegistration>()
      .toHaveProperty("clientSecret")
      .toEqualTypeOf<string>();
    expectTypeOf<PublicRegistration>()
      .toHaveProperty("appRoles")
      .toEqualTypeOf<string[]>();
    expectTypeOf<PublicRegistration>()
      .toHaveProperty("groupClaimsMode")
      .toEqualTypeOf<"none" | "security" | "all">();
  });

  it("accepts the two locked provider identifiers", () => {
    expect(providerIdSchema.options).toEqual(["entra", "okta"]);
  });

  it("applies safe seed defaults", () => {
    const seed = identitySeedSchema.parse({
      users: [{ userName: "ada@example.com", displayName: "Ada Lovelace" }],
    });
    expect(seed.users[0]).toMatchObject({
      active: true,
      mfaState: "none",
      password: "Passw0rd!",
      passwordState: "valid",
    });
    expect(seed.groups).toEqual([]);
  });

  it("rejects persisted issuer URLs in environment configuration", () => {
    expect(() =>
      environmentConfigSchema.parse({
        id: "environment_123",
        name: "test",
        provider: "entra",
        seed: "fixed",
        tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
        createdAt: "2026-07-22T00:00:00.000Z",
        issuer: "https://example.invalid/tenant/v2.0",
      })
    ).toThrow();
  });

  it("validates RFC 7807 problem documents", () => {
    expect(
      problemSchema.parse({
        type: "https://mockos.live/problems/not-found",
        title: "Not found",
        status: 404,
        requestId: "req_123",
      }).status
    ).toBe(404);
  });

  it("keeps MCP defaults deterministic", () => {
    expect(
      seedIdentitiesToolInputSchema.parse({
        users: [{ userName: "ada@example.com", displayName: "Ada Lovelace" }],
      })
    ).toMatchObject({
      users: [
        {
          active: true,
          mfaState: "none",
          password: "Passw0rd!",
          passwordState: "valid",
        },
      ],
      groups: [],
    });
    expect(getRequestLogToolInputSchema.parse({}).limit).toBe(100);
    expect(assertRequestsToolInputSchema.parse({}).count).toEqual({ atLeast: 1 });
  });

  it("accepts only bounded JSON objects as MCP request arguments", () => {
    const base = {
      id: "request-1",
      timestamp: "2026-07-23T12:00:00.000Z",
      source: "inbound",
      provider: "mcp",
      protocol: "mcp",
      method: "POST",
      path: "/mcp-mock/server",
      requestHeaders: {},
      requestBody: null,
      responseStatus: 200,
      responseHeaders: {},
      responseBody: null,
      durationMs: 1,
      correlationId: "correlation-1",
      mcpMethod: "tools/call",
      mcpTool: "lookup",
    } as const;
    expect(
      requestLogEntrySchema.parse({
        ...base,
        mcpArguments: { nested: { values: [null, true, 42, "text"] } },
      }).mcpArguments
    ).toEqual({ nested: { values: [null, true, 42, "text"] } });
    expect(() =>
      requestLogEntrySchema.parse({
        ...base,
        mcpArguments: { ["x".repeat(257)]: true },
      })
    ).toThrow();
    expect(() =>
      requestLogEntrySchema.parse({
        ...base,
        mcpArguments: { invalid: 1n },
      })
    ).toThrow();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      assertionSpecSchema.parse({
        mcpArguments: cyclic,
        count: { atLeast: 1 },
      })
    ).toThrow();
  });

  it("accepts the MCP request-cancelled error code in request logs", () => {
    const base = {
      id: "request-cancelled",
      timestamp: "2026-07-23T12:00:00.000Z",
      source: "inbound",
      provider: "mcp",
      protocol: "mcp",
      method: "POST",
      path: "/mcp-mock/server",
      requestHeaders: {},
      requestBody: null,
      responseStatus: 200,
      responseHeaders: {},
      responseBody: null,
      durationMs: 1,
      correlationId: "correlation-cancelled",
      mcpMethod: "tools/call",
      mcpTool: "lookup",
    } as const;

    expect(
      requestLogEntrySchema.parse({
        ...base,
        mcpErrorCode: -32_800,
      }).mcpErrorCode
    ).toBe(-32_800);
    expect(() =>
      requestLogEntrySchema.parse({
        ...base,
        mcpErrorCode: -32_801,
      })
    ).toThrow();
  });

  it("accepts structured response and error LLM observations without bodies", () => {
    const response = requestLogEntrySchema.parse({
      id: "req_openai_1",
      timestamp: "2026-07-23T12:00:00.000Z",
      source: "inbound",
      provider: "openai",
      protocol: "http",
      method: "post",
      path: "/llm-mock/assistant/v1/chat/completions",
      requestHeaders: {},
      requestBody: null,
      responseStatus: REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
      responseHeaders: {},
      responseBody: null,
      durationMs: REQUEST_LOG_LLM_PENDING_DURATION_MS,
      correlationId: "req_openai_1",
      llmDialect: "openai",
      llmOperation: "chat.completions.create",
      llmServerSlug: "assistant",
      llmServerRevision: 1,
      llmModel: "gpt-mock",
      llmStream: false,
      llmTurnIndex: 0,
      llmOutcome: "pending",
      llmResponseId: "chatcmpl-response-1",
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmStopReason: "end_turn",
      llmToolNames: [],
    });
    expect(response).toMatchObject({
      llmStream: false,
      llmTurnIndex: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmToolNames: [],
    });
    const { llmResponseId: _responseId, ...responseWithoutId } = response;
    const configuredErrorEntry = requestLogEntrySchema.parse({
      ...responseWithoutId,
      id: "req_anthropic_1",
      provider: "anthropic",
      path: "/llm-mock/assistant/v1/messages",
      correlationId: "req_anthropic_1",
      llmDialect: "anthropic",
      llmOperation: "messages.create",
      llmInputTokens: undefined,
      llmOutputTokens: undefined,
      llmStopReason: undefined,
      llmToolNames: undefined,
      llmErrorKind: "rate_limit",
    });
    expect(configuredErrorEntry.llmErrorKind).toBe("rate_limit");
    expect(configuredErrorEntry).not.toHaveProperty("llmResponseId");
    expect(
      requestLogLlmFinalizationSchema.parse({
        llmOutcome: "cancelled",
        responseStatus: 200,
        durationMs: 0,
      })
    ).toEqual({
      llmOutcome: "cancelled",
      responseStatus: 200,
      durationMs: 0,
    });
  });

  it("rejects incomplete, mixed, secret-bearing, or dialect-inconsistent LLM metadata", () => {
    const base = {
      id: "req_openai_invalid",
      timestamp: "2026-07-23T12:00:00.000Z",
      source: "inbound",
      provider: "openai",
      protocol: "http",
      method: "POST",
      path: "/llm-mock/assistant/v1/chat/completions",
      requestHeaders: {},
      requestBody: null,
      responseStatus: REQUEST_LOG_LLM_PENDING_RESPONSE_STATUS,
      responseHeaders: {},
      responseBody: null,
      durationMs: REQUEST_LOG_LLM_PENDING_DURATION_MS,
      correlationId: "req_openai_invalid",
      llmDialect: "openai",
      llmOperation: "chat.completions.create",
      llmServerSlug: "assistant",
      llmServerRevision: 1,
      llmModel: "gpt-mock",
      llmStream: true,
      llmTurnIndex: 0,
      llmOutcome: "pending",
      llmResponseId: "chatcmpl-response-invalid",
      llmInputTokens: 1,
      llmOutputTokens: 2,
      llmStopReason: "end_turn",
      llmToolNames: [],
    } as const;

    for (const invalid of [
      { ...base, llmModel: undefined },
      { ...base, provider: "anthropic" },
      { ...base, llmOperation: "messages.create" },
      { ...base, protocol: "mcp" },
      { ...base, mcpMethod: "tools/call", mcpTool: "lookup" },
      { ...base, llmErrorKind: "rate_limit" },
      { ...base, llmResponseId: undefined },
      { ...base, llmOutputTokens: undefined },
      { ...base, responseStatus: 200 },
      { ...base, durationMs: 1 },
      { ...base, requestHeaders: { authorization: "secret" } },
      { ...base, requestBody: '{"messages":["secret"]}' },
      { ...base, responseBody: '{"answer":"secret"}' },
    ]) {
      expect(() => requestLogEntrySchema.parse(invalid)).toThrow();
    }
    expect(() =>
      requestLogLlmFinalizationSchema.parse({
        llmOutcome: "pending",
        responseStatus: 200,
        durationMs: 0,
      })
    ).toThrow();
  });

  it("preserves false and zero values in LLM query and assertion matchers", () => {
    expect(
      getRequestLogToolInputSchema.parse({
        llmDialect: "openai",
        llmStream: false,
        llmTurnIndex: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
      })
    ).toMatchObject({
      llmDialect: "openai",
      llmStream: false,
      llmTurnIndex: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    });
    expect(
      assertionSpecSchema.parse({
        llmStream: false,
        llmTurnIndex: 0,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        sequence: [{ llmOutcome: "completed" }, { llmToolNames: ["lookup", "finish"] }],
      })
    ).toMatchObject({
      llmStream: false,
      llmTurnIndex: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
    });
  });

  it("bounds management pages and keeps application listings secret-free", () => {
    expect(managementListQuerySchema.parse({})).toEqual({
      limit: MAX_MANAGEMENT_LIST_PAGE_SIZE,
    });
    expect(() =>
      managementListQuerySchema.parse({ limit: MAX_MANAGEMENT_LIST_PAGE_SIZE + 1 })
    ).toThrow();
    expect(() =>
      managementListQuerySchema.parse({ cursor: "x".repeat(513) })
    ).toThrow();
    expect(() => managementListQuerySchema.parse({ unexpected: true })).toThrow();

    const summary = {
      id: "app_12345678",
      name: "Console client",
      clientId: "client_123",
      clientType: "confidential" as const,
      redirectUris: ["https://client.example/callback"],
      grantTypes: ["authorization_code" as const],
      appRoles: [],
      groupClaimsMode: "none" as const,
      createdAt: "2026-07-22T12:00:00.000Z",
    };
    expect(applicationSummarySchema.parse(summary)).toEqual(summary);
    expect(() =>
      applicationSummarySchema.parse({
        ...summary,
        clientSecret: "display-once-secret",
      })
    ).toThrow();
    expect(
      applicationRegistrationSchema.parse({
        ...summary,
        clientSecret: "display-once-secret",
      })
    ).toMatchObject({ clientSecret: "display-once-secret" });
    const publicRegistration = applicationRegistrationSchema.parse({
      ...summary,
      clientType: "public",
    });
    expect(publicRegistration).not.toHaveProperty("clientSecret");
    expect(() =>
      applicationRegistrationSchema.parse({
        ...publicRegistration,
        clientSecret: "must-not-exist",
      })
    ).toThrow();
    expect(() =>
      createApplicationToolInputSchema.parse({
        name: "Invalid public service client",
        clientType: "public",
        redirectUris: ["https://client.example/callback"],
        grantTypes: ["client_credentials"],
      })
    ).toThrow();
    expect(() =>
      createApplicationToolInputSchema.parse({
        name: "Invalid public secret client",
        clientType: "public",
        clientSecret: "must-not-exist",
        redirectUris: ["https://client.example/callback"],
      })
    ).toThrow();
    expect(
      createApplicationToolInputSchema.parse({
        name: "Legacy confidential client",
        redirectUris: ["https://client.example/callback"],
      })
    ).toEqual({
      name: "Legacy confidential client",
      clientType: "confidential",
      redirectUris: ["https://client.example/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      appRoles: [],
      groupClaimsMode: "none",
    });
    expect(() =>
      applicationSummarySchema.parse({
        ...summary,
        clientType: "public",
        grantTypes: ["client_credentials"],
      })
    ).toThrow();
    const { clientType: _clientType, ...missingClientType } = summary;
    expect(() => applicationSummarySchema.parse(missingClientType)).toThrow();
    const { appRoles: _appRoles, ...missingAppRoles } = summary;
    expect(() => applicationSummarySchema.parse(missingAppRoles)).toThrow();
    const { groupClaimsMode: _groupClaimsMode, ...missingGroupClaimsMode } = summary;
    expect(() => applicationSummarySchema.parse(missingGroupClaimsMode)).toThrow();
    expect(() =>
      applicationListPageSchema.parse({
        applications: Array.from(
          { length: MAX_MANAGEMENT_LIST_PAGE_SIZE + 1 },
          () => summary
        ),
      })
    ).toThrow();

    const scenario = scenarioSpecSchema.parse({
      id: "bounded-page",
      injectionPoint: "oauth.token",
      action: { type: "error", code: "INVALID_GRANT" },
    });
    expect(() =>
      scenarioListPageSchema.parse({
        scenarios: Array.from(
          { length: MAX_MANAGEMENT_LIST_PAGE_SIZE + 1 },
          () => scenario
        ),
      })
    ).toThrow();
  });

  it("rejects ambiguous or empty assertion count contracts", () => {
    expect(() => assertionSpecSchema.parse({ count: {} })).toThrow(
      "must contain atLeast, atMost, or exactly"
    );
    expect(() =>
      assertionSpecSchema.parse({ count: { atLeast: 2, atMost: 1 } })
    ).toThrow("atLeast cannot be greater than atMost");
    expect(() =>
      assertionSpecSchema.parse({ count: { exactly: 1, atLeast: 1 } })
    ).toThrow("exactly cannot be combined");
    expect(() =>
      assertionSpecSchema.parse({ sequence: [{ path: "/one" }, {}] })
    ).toThrow("must contain at least one matcher");
  });

  it("requires a mutable setting when configuring an environment", () => {
    expect(() => configureEnvironmentToolInputSchema.parse({})).toThrow(
      "At least one environment setting is required."
    );
    expect(() =>
      configureEnvironmentToolInputSchema.parse({ provider: "okta" })
    ).toThrow();
  });

  it("caps injected latency at thirty seconds", () => {
    expect(() =>
      scenarioSpecSchema.parse({
        id: "too-slow",
        injectionPoint: "*",
        action: { type: "delay", milliseconds: 30_001 },
      })
    ).toThrow();
    expect(() =>
      setScenarioToolInputSchema.parse({
        environmentId: "environment_123",
        id: "misrouted-tool-action",
        injectionPoint: "scim.request",
        action: { type: "scim_patch_tolerance", malformedCase: "missing_schemas" },
      })
    ).toThrow(/locked to scim\.patch_parse/);
  });

  it("locks typed SCIM edge actions to reserved internal injection points", () => {
    expect(
      scenarioSpecSchema.parse({
        id: "conflict-once",
        injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
        action: { type: "scim_conflict" },
        remaining: 1,
      })
    ).toMatchObject({
      injectionPoint: SCIM_BEFORE_COMMIT_INJECTION_POINT,
      action: { type: "scim_conflict" },
    });
    expect(
      scenarioSpecSchema.parse({
        id: "tolerate-singleton",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: {
          type: "scim_patch_tolerance",
          malformedCase: "singleton_operations",
        },
      })
    ).toMatchObject({
      action: { malformedCase: "singleton_operations" },
    });

    expect(() =>
      scenarioSpecSchema.parse({
        id: "public-conflict",
        injectionPoint: "scim.request",
        action: { type: "scim_conflict" },
      })
    ).toThrow(/locked to scim\.before_commit/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "catch-all-race",
        injectionPoint: "*",
        action: { type: "scim_soft_delete_race" },
      })
    ).toThrow(/locked to scim\.before_commit/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "generic-internal",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: { type: "delay", milliseconds: 1 },
      })
    ).toThrow(/accepts only its typed SCIM action/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "broad-tolerance",
        injectionPoint: SCIM_PATCH_PARSE_INJECTION_POINT,
        action: {
          type: "scim_patch_tolerance",
          malformedCase: "any_invalid_patch",
        },
      })
    ).toThrow();
  });

  it("locks token scenario actions to the internal before-sign boundary", () => {
    expect(
      scenarioSpecSchema.parse({
        id: "rotate-once",
        injectionPoint: "token.before_sign",
        action: { type: "rotate_signing_key" },
        remaining: 1,
      })
    ).toMatchObject({
      action: { type: "rotate_signing_key" },
      injectionPoint: "token.before_sign",
    });
    expect(
      scenarioSpecSchema.parse({
        id: "skew-forward",
        injectionPoint: "token.before_sign",
        action: { type: "token_clock_skew", seconds: 300 },
      })
    ).toMatchObject({ action: { type: "token_clock_skew", seconds: 300 } });
    expect(() =>
      scenarioSpecSchema.parse({
        id: "wrong-boundary",
        injectionPoint: "oauth.token",
        action: { type: "rotate_signing_key" },
      })
    ).toThrow(/only valid at token\.before_sign/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "wrong-action",
        injectionPoint: "token.before_sign",
        action: { type: "delay", milliseconds: 1 },
      })
    ).toThrow(/requires rotate_signing_key or token_clock_skew/);
    expect(() =>
      scenarioSpecSchema.parse({
        id: "unbounded-skew",
        injectionPoint: "token.before_sign",
        action: { type: "token_clock_skew", seconds: 86_401 },
      })
    ).toThrow();
  });

  it("locks the broken-token variants and management tool names", () => {
    expect(brokenTokenVariantSchema.options).toEqual([
      "expired",
      "wrong_audience",
      "not_yet_valid",
      "bad_signature",
      "wrong_issuer",
    ]);
    expect(mockosMcpToolNames).toEqual([
      "create_environment",
      "list_environments",
      "delete_environment",
      "configure_environment",
      "seed_identities",
      "create_application",
      "mint_token",
      "run_provisioning_cycle",
      "set_scenario",
      "clear_scenario",
      "get_request_log",
      "assert_requests",
      "simulate_lifecycle",
      "get_wellknown_urls",
      "set_current_environment",
      "put_mock_mcp_server",
      "list_mock_mcp_servers",
      "get_mock_mcp_server",
      "delete_mock_mcp_server",
      "reset_mock_mcp_state",
      "list_mock_mcp_blueprints",
      "get_mock_mcp_blueprint",
      "install_mock_mcp_blueprint",
      "put_mock_llm_server",
      "list_mock_llm_servers",
      "get_mock_llm_server",
      "delete_mock_llm_server",
    ]);
    expect(mockosMcpToolNames).toHaveLength(27);
  });

  it("locks mock-MCP mutation intent to create-or-current-revision CAS", () => {
    const server = {
      version: 1,
      slug: "revisioned-server",
      serverInfo: { name: "Revisioned server", version: "1" },
    };
    expect(
      putMockMcpServerToolInputSchema.parse({
        expectedRevision: null,
        server,
      }).expectedRevision
    ).toBeNull();
    expect(
      putMockMcpServerToolInputSchema.parse({
        expectedRevision: 3,
        server,
      }).expectedRevision
    ).toBe(3);
    expect(() => putMockMcpServerToolInputSchema.parse({ server })).toThrow();

    for (const schema of [
      deleteMockMcpServerToolInputSchema,
      resetMockMcpStateToolInputSchema,
    ]) {
      expect(
        schema.parse({ slug: "revisioned-server", expectedRevision: 3 })
      ).toMatchObject({ expectedRevision: 3 });
      expect(() => schema.parse({ slug: "revisioned-server" })).toThrow();
      expect(() =>
        schema.parse({ slug: "revisioned-server", expectedRevision: null })
      ).toThrow();
    }
  });

  it("locks M3 SCIM and lifecycle wire shapes", () => {
    expect(scimWeakEtag(7)).toBe('W/"7"');
    expect(
      scimUserInputSchema.parse({
        schemas: [SCIM_CORE_USER_SCHEMA],
        userName: "ada@example.test",
        active: true,
      })
    ).toMatchObject({ userName: "ada@example.test", active: true });
    expect(
      lifecycleResultSchema.parse({
        userId: "usr_12345678",
        provider: "okta",
        action: "suspend",
        previousState: "active",
        currentState: "suspended",
        changed: true,
        version: 2,
        etag: 'W/"2"',
        revoked: { accessTokens: 1, refreshTokens: 1 },
      })
    ).toMatchObject({ currentState: "suspended", version: 2 });
  });
});
