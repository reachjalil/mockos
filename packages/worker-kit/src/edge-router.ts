import type { JsonValue } from "@mockos/contracts/behavior";
import type { MockLlmPlan } from "@mockos/contracts/mock-llm";
import {
  createMockLlmAnthropicFetchHandler,
  createMockLlmOpenAiFetchHandler,
  type MockLlmAnthropicCatalog,
  type MockLlmAnthropicRuntimeResult,
  type MockLlmOpenAiCatalog,
  type MockLlmOpenAiRuntimeResult,
} from "@mockos/llm-mock";
import type { EnvironmentDurableObject } from "./environment-do";
import {
  forwardEnvironmentRequest,
  graphBaseUrlForEnvironment,
  type HostResolverConfig,
  resolveEnvironmentRequest,
} from "./host-resolver";

export type EnvironmentRoutingBindings = {
  API_KEY?: string;
  ENVIRONMENTS: DurableObjectNamespace<EnvironmentDurableObject>;
  TID_INDEX?: KVNamespace;
};

export type ProtocolRequestHooks = {
  beforeRequest?: (input: {
    environmentId: string;
    request: Request;
    resolution: ReturnType<typeof resolveEnvironmentRequest>;
  }) => Promise<Response | undefined> | Response | undefined;
};

type MockLlmOpenAiEnvironmentRpc = {
  getMockLlmOpenAiCatalog(
    slug: string,
    credential: string
  ): Promise<MockLlmOpenAiRuntimeResult<MockLlmOpenAiCatalog>>;
  planMockLlmOpenAiChatCompletion(
    slug: string,
    credential: string,
    request: JsonValue
  ): Promise<MockLlmOpenAiRuntimeResult<MockLlmPlan>>;
};

type MockLlmAnthropicEnvironmentRpc = {
  getMockLlmAnthropicCatalog(
    slug: string,
    credential: string
  ): Promise<MockLlmAnthropicRuntimeResult<MockLlmAnthropicCatalog>>;
  planMockLlmAnthropicMessage(
    slug: string,
    credential: string,
    request: JsonValue
  ): Promise<MockLlmAnthropicRuntimeResult<MockLlmPlan>>;
};

const resolveEnvironmentId = async (
  locator: ReturnType<typeof resolveEnvironmentRequest>,
  bindings: EnvironmentRoutingBindings
) => {
  if (!locator) return undefined;
  if (locator.locator.type === "environment") {
    return locator.locator.environmentId;
  }
  return bindings.TID_INDEX?.get(`tid:${locator.locator.tenantId}`);
};

/**
 * Routes raw protocol traffic to the environment DO. The only mutation is the
 * path-prefix removal plus trusted routing headers consumed inside the DO.
 */
export const routeEnvironmentRequest = async (
  request: Request,
  bindings: EnvironmentRoutingBindings,
  config: HostResolverConfig,
  hooks: ProtocolRequestHooks = {}
): Promise<Response | undefined> => {
  const resolution = resolveEnvironmentRequest(request, config);
  if (!resolution) return undefined;
  const environmentId = await resolveEnvironmentId(resolution, bindings);
  if (!environmentId) {
    return new Response("Environment not found.", { status: 404 });
  }
  const intercepted = await hooks.beforeRequest?.({
    environmentId,
    request,
    resolution,
  });
  if (intercepted) return intercepted;
  const id = bindings.ENVIRONMENTS.idFromName(environmentId);
  const stub = bindings.ENVIRONMENTS.get(id);
  if (resolution.kind === "mock-llm") {
    if (resolution.dialect === "anthropic") {
      const mockLlm = stub as unknown as MockLlmAnthropicEnvironmentRpc;
      const handler = createMockLlmAnthropicFetchHandler({
        ...(bindings.API_KEY ? { platformApiKey: bindings.API_KEY } : {}),
        runtime: {
          getCatalog: (input) =>
            mockLlm.getMockLlmAnthropicCatalog(input.slug, input.credential),
          planMessage: (input) =>
            mockLlm.planMockLlmAnthropicMessage(
              input.slug,
              input.credential,
              input.request
            ),
        },
      });
      return handler(request, {
        slug: resolution.slug,
        providerPath: resolution.providerPath,
      });
    }
    const mockLlm = stub as unknown as MockLlmOpenAiEnvironmentRpc;
    const handler = createMockLlmOpenAiFetchHandler({
      ...(bindings.API_KEY ? { platformApiKey: bindings.API_KEY } : {}),
      runtime: {
        getCatalog: (input) =>
          mockLlm.getMockLlmOpenAiCatalog(input.slug, input.credential),
        planChatCompletion: (input) =>
          mockLlm.planMockLlmOpenAiChatCompletion(
            input.slug,
            input.credential,
            input.request
          ),
      },
    });
    return handler(request, {
      slug: resolution.slug,
      providerPath: resolution.providerPath,
    });
  }
  const controlAuthorization = bindings.API_KEY
    ? request.headers.get("authorization") === `Bearer ${bindings.API_KEY}`
    : false;
  const routedResolution =
    resolution.kind === "mock-mcp"
      ? resolution
      : {
          ...resolution,
          environmentId,
          graphBaseUrl: graphBaseUrlForEnvironment(resolution, environmentId, config),
        };
  return stub.fetch(
    forwardEnvironmentRequest(request, routedResolution, {
      redactAuthorization: controlAuthorization,
    })
  );
};
