import type { EnvironmentDurableObject } from "./environment-do";
import {
  forwardEnvironmentRequest,
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
  }) => Promise<Response | undefined> | Response | undefined;
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
  const intercepted = await hooks.beforeRequest?.({ environmentId, request });
  if (intercepted) return intercepted;
  const id = bindings.ENVIRONMENTS.idFromName(environmentId);
  const stub = bindings.ENVIRONMENTS.get(id);
  const controlAuthorization = bindings.API_KEY
    ? request.headers.get("authorization") === `Bearer ${bindings.API_KEY}`
    : false;
  return stub.fetch(
    forwardEnvironmentRequest(
      request,
      { ...resolution, environmentId },
      { redactAuthorization: controlAuthorization }
    )
  );
};
