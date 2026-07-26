import type { JsonValue } from "@mockos/contracts/behavior";
import {
  createMockLlmAnthropicFetchHandler,
  createMockLlmOpenAiFetchHandler,
  type MockLlmAnthropicCatalog,
  type MockLlmAnthropicRuntimeResult,
  type MockLlmOpenAiCatalog,
  type MockLlmOpenAiRuntimeResult,
  type MockLlmProviderObservationFinish,
  type MockLlmProviderObservationHook,
  type MockLlmProviderObservationStart,
} from "@mockos/llm-mock";
import type { EnvironmentDurableObject } from "./environment-do";
import {
  forwardEnvironmentRequest,
  graphBaseUrlForEnvironment,
  type HostResolverConfig,
  resolveEnvironmentRequest,
} from "./host-resolver";
import type { EnvironmentMockLlmPlanSelection } from "./mock-llm-runtime";

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
  waitUntil?: (promise: Promise<void>) => void;
};

type MockLlmEnvironmentObservationRpc = {
  reserveMockLlmObservation(
    serverRevision: number,
    requestPath: string,
    observation: MockLlmProviderObservationStart
  ): Promise<void>;
  finalizeMockLlmObservation(
    observation: MockLlmProviderObservationFinish
  ): Promise<void>;
};

type MockLlmOpenAiEnvironmentRpc = MockLlmEnvironmentObservationRpc & {
  getMockLlmOpenAiCatalog(
    slug: string,
    credential: string
  ): Promise<MockLlmOpenAiRuntimeResult<MockLlmOpenAiCatalog>>;
  planMockLlmOpenAiChatCompletion(
    slug: string,
    credential: string,
    request: JsonValue
  ): Promise<MockLlmOpenAiRuntimeResult<EnvironmentMockLlmPlanSelection>>;
};

type MockLlmAnthropicEnvironmentRpc = MockLlmEnvironmentObservationRpc & {
  getMockLlmAnthropicCatalog(
    slug: string,
    credential: string
  ): Promise<MockLlmAnthropicRuntimeResult<MockLlmAnthropicCatalog>>;
  planMockLlmAnthropicMessage(
    slug: string,
    credential: string,
    request: JsonValue
  ): Promise<MockLlmAnthropicRuntimeResult<EnvironmentMockLlmPlanSelection>>;
};

type SelectedServerRevision = {
  current: number | undefined;
};

const createObservationHook = (
  rpc: MockLlmEnvironmentObservationRpc,
  requestPath: string,
  selectedServerRevision: SelectedServerRevision,
  waitUntil: ProtocolRequestHooks["waitUntil"]
): MockLlmProviderObservationHook => ({
  reserve: (observation, privacyGuard) => {
    const serverRevision = selectedServerRevision.current;
    if (serverRevision === undefined) {
      throw new Error("The selected mock LLM server revision is unavailable.");
    }
    if (
      !privacyGuard({
        requestPath,
        serverRevision,
        source: "inbound",
        protocol: "http",
        pendingOutcome: "pending",
        pendingResponseStatus: 102,
        pendingDurationMilliseconds: 0,
      })
    ) {
      throw new Error("Prospective LLM observation metadata contains a credential.");
    }
    return rpc.reserveMockLlmObservation(serverRevision, requestPath, observation);
  },
  finish: (observation) => rpc.finalizeMockLlmObservation(observation),
  ...(waitUntil ? { waitUntil } : {}),
});

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
    const requestPath = new URL(request.url).pathname;
    const selectedServerRevision: SelectedServerRevision = {
      current: undefined,
    };
    if (resolution.dialect === "anthropic") {
      const mockLlm = stub as unknown as MockLlmAnthropicEnvironmentRpc;
      const handler = createMockLlmAnthropicFetchHandler({
        ...(bindings.API_KEY ? { platformApiKey: bindings.API_KEY } : {}),
        observation: createObservationHook(
          mockLlm,
          requestPath,
          selectedServerRevision,
          hooks.waitUntil
        ),
        runtime: {
          getCatalog: (input) =>
            mockLlm.getMockLlmAnthropicCatalog(input.slug, input.credential),
          planMessage: async (input) => {
            selectedServerRevision.current = undefined;
            const result = await mockLlm.planMockLlmAnthropicMessage(
              input.slug,
              input.credential,
              input.request
            );
            if (!result.ok) return result;
            selectedServerRevision.current = result.value.serverRevision;
            return { ok: true, value: result.value.plan };
          },
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
      observation: createObservationHook(
        mockLlm,
        requestPath,
        selectedServerRevision,
        hooks.waitUntil
      ),
      runtime: {
        getCatalog: (input) =>
          mockLlm.getMockLlmOpenAiCatalog(input.slug, input.credential),
        planChatCompletion: async (input) => {
          selectedServerRevision.current = undefined;
          const result = await mockLlm.planMockLlmOpenAiChatCompletion(
            input.slug,
            input.credential,
            input.request
          );
          if (!result.ok) return result;
          selectedServerRevision.current = result.value.serverRevision;
          return { ok: true, value: result.value.plan };
        },
      },
    });
    return handler(request, {
      slug: resolution.slug,
      providerPath: resolution.providerPath,
    });
  }
  const authorization = request.headers.get("authorization");
  const bearer = authorization && /^Bearer +([^\s]+)$/i.exec(authorization)?.[1];
  const controlAuthorization = bindings.API_KEY ? bearer === bindings.API_KEY : false;
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
