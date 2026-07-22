import { environmentIdSchema } from "@mockos/contracts";

export type HostingMode = "path" | "subdomain";

export type HostResolverConfig = {
  baseDomain?: string;
  entraHost?: string;
  hostingMode: HostingMode;
  pathPrefix?: string;
};

export type EnvironmentLocator =
  | { environmentId: string; type: "environment" }
  | { tenantId: string; type: "tenant" };

export type ResolvedEnvironmentRequest = {
  environmentId?: string;
  forwardedPath: string;
  graphBaseUrl?: string;
  issuerBase: string;
  locator: EnvironmentLocator;
  provider: "entra" | "graph" | "okta" | "scim";
  publicBase: string;
  tenantId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");

const normalizePrefix = (value: string | undefined) => {
  const prefix = value?.trim() || "/e";
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/+$/, "");
};

const classifyPath = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first && UUID_PATTERN.test(first)) {
    return { provider: "entra" as const, tenantId: first.toLowerCase() };
  }
  if (
    pathname === "/activate" ||
    pathname.startsWith("/oauth2/") ||
    pathname === "/api/v1" ||
    pathname.startsWith("/api/v1/")
  ) {
    return { provider: "okta" as const };
  }
  if (pathname === "/scim/v2" || pathname.startsWith("/scim/v2/")) {
    return { provider: "scim" as const };
  }
  if (pathname === "/graph/v1.0" || pathname.startsWith("/graph/v1.0/")) {
    return { provider: "graph" as const };
  }
  return undefined;
};

const pathModeResolution = (
  url: URL,
  config: HostResolverConfig
): ResolvedEnvironmentRequest | undefined => {
  const prefix = normalizePrefix(config.pathPrefix);
  if (!url.pathname.startsWith(`${prefix}/`)) return undefined;
  const rest = url.pathname.slice(prefix.length + 1);
  const slash = rest.indexOf("/");
  if (slash < 1) return undefined;
  const environmentId = rest.slice(0, slash);
  if (!environmentIdSchema.safeParse(environmentId).success) return undefined;
  const forwardedPath = rest.slice(slash) || "/";
  const classification = classifyPath(forwardedPath);
  if (!classification) return undefined;
  const publicBase = `${url.origin}${prefix}/${environmentId}`;
  const issuerBase =
    classification.provider === "entra"
      ? `${publicBase}/${classification.tenantId}/v2.0`
      : classification.provider === "okta"
        ? `${publicBase}/oauth2/default`
        : publicBase;
  return {
    environmentId,
    forwardedPath,
    ...(classification.provider === "entra"
      ? { graphBaseUrl: `${publicBase}/graph/v1.0` }
      : {}),
    issuerBase,
    locator: { type: "environment", environmentId },
    provider: classification.provider,
    publicBase,
    tenantId: classification.tenantId,
  };
};

const subdomainModeResolution = (
  url: URL,
  config: HostResolverConfig
): ResolvedEnvironmentRequest | undefined => {
  const baseDomain = config.baseDomain && normalizeHost(config.baseDomain);
  if (!baseDomain) {
    throw new Error("baseDomain is required in subdomain hosting mode.");
  }
  const hostname = normalizeHost(url.hostname);
  const entraHost = normalizeHost(config.entraHost ?? `login.${baseDomain}`);
  const classification = classifyPath(url.pathname);
  if (hostname === entraHost) {
    if (classification?.provider !== "entra") return undefined;
    return {
      forwardedPath: url.pathname,
      issuerBase: `${url.origin}/${classification.tenantId}/v2.0`,
      locator: { type: "tenant", tenantId: classification.tenantId },
      provider: "entra",
      publicBase: url.origin,
      tenantId: classification.tenantId,
    };
  }
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return undefined;
  const environmentId = hostname.slice(0, -suffix.length);
  if (!environmentIdSchema.safeParse(environmentId).success) return undefined;
  if (!classification || classification.provider === "entra") return undefined;
  return {
    environmentId,
    forwardedPath: url.pathname,
    issuerBase:
      classification.provider === "okta" ? `${url.origin}/oauth2/default` : url.origin,
    locator: { type: "environment", environmentId },
    provider: classification.provider,
    publicBase: url.origin,
  };
};

/**
 * Resolves only the configured tenancy mode. It intentionally never falls back
 * from subdomain to path routing (or vice versa), keeping the public issuer
 * stable and preventing a Host header from selecting a different tenant mode.
 */
export const resolveEnvironmentRequest = (
  input: Request | URL | string,
  config: HostResolverConfig
): ResolvedEnvironmentRequest | undefined => {
  const url =
    input instanceof Request
      ? new URL(input.url)
      : input instanceof URL
        ? input
        : new URL(input);
  return config.hostingMode === "path"
    ? pathModeResolution(url, config)
    : subdomainModeResolution(url, config);
};

export const graphBaseUrlForEnvironment = (
  resolution: ResolvedEnvironmentRequest,
  environmentId: string,
  config: HostResolverConfig
): string | undefined => {
  if (resolution.provider !== "entra") return undefined;
  if (!environmentIdSchema.safeParse(environmentId).success) {
    throw new Error("A valid environment ID is required for the Graph base URL.");
  }
  if (config.hostingMode === "path") {
    return resolution.graphBaseUrl ?? `${resolution.publicBase}/graph/v1.0`;
  }
  const baseDomain = config.baseDomain && normalizeHost(config.baseDomain);
  if (!baseDomain) {
    throw new Error("baseDomain is required in subdomain hosting mode.");
  }
  return `${new URL(resolution.issuerBase).protocol}//${environmentId}.${baseDomain}/graph/v1.0`;
};

export const forwardEnvironmentRequest = (
  request: Request,
  resolution: ResolvedEnvironmentRequest,
  options: { redactAuthorization?: boolean } = {}
) => {
  const url = new URL(request.url);
  url.pathname = resolution.forwardedPath;
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-mockos-")) headers.delete(name);
  }
  headers.set("x-mockos-issuer-base", resolution.issuerBase);
  headers.set("x-mockos-public-path", new URL(request.url).pathname);
  if (resolution.graphBaseUrl) {
    headers.set("x-mockos-graph-base", resolution.graphBaseUrl);
  }
  if (resolution.environmentId) {
    headers.set("x-mockos-env", resolution.environmentId);
  }
  if (options.redactAuthorization) {
    headers.set("x-mockos-redact-authorization", "true");
  }
  return new Request(url, {
    body: request.body,
    headers,
    method: request.method,
    redirect: request.redirect,
  });
};
