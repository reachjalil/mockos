import type { EnvironmentConfig } from "@mockos/contracts";

export type PublicLocationBindings = {
  readonly BASE_DOMAIN?: string;
  readonly ENTRA_HOST?: string;
  readonly HOSTING_MODE: string;
  readonly PATH_PREFIX?: string;
  readonly PUBLIC_ORIGIN: string;
};

const normalizePathPrefix = (value: string | undefined) => {
  const prefix = value?.trim() || "/e";
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/+$/, "");
};

const normalizedOrigin = (value: string) => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "PUBLIC_ORIGIN must be an origin without credentials or query data."
    );
  }
  return url.origin;
};

/** Derives trusted issuer and directory locations from operator-owned bindings. */
export const publicLocationForEnvironment = (
  environment: EnvironmentConfig,
  bindings: PublicLocationBindings
) => {
  const origin = normalizedOrigin(bindings.PUBLIC_ORIGIN);
  if (bindings.HOSTING_MODE === "path") {
    const publicBase = `${origin}${normalizePathPrefix(bindings.PATH_PREFIX)}/${environment.id}`;
    return {
      publicBase,
      directoryBaseUrl: publicBase,
      issuerBase:
        environment.provider === "entra"
          ? `${publicBase}/${environment.tenantId}/v2.0`
          : `${publicBase}/oauth2/default`,
      ...(environment.provider === "entra"
        ? { graphBaseUrl: `${publicBase}/graph/v1.0` }
        : {}),
    };
  }
  if (bindings.HOSTING_MODE !== "subdomain") {
    throw new Error("HOSTING_MODE must be path or subdomain.");
  }
  const baseDomain = bindings.BASE_DOMAIN?.trim().toLowerCase().replace(/\.$/, "");
  if (!baseDomain) throw new Error("BASE_DOMAIN is required in subdomain mode.");
  const protocol = new URL(origin).protocol;
  if (environment.provider === "entra") {
    const entraHost =
      bindings.ENTRA_HOST?.trim().toLowerCase().replace(/\.$/, "") ??
      `login.${baseDomain}`;
    const publicBase = `${protocol}//${entraHost}`;
    const directoryBaseUrl = `${protocol}//${environment.id}.${baseDomain}`;
    return {
      publicBase,
      directoryBaseUrl,
      issuerBase: `${publicBase}/${environment.tenantId}/v2.0`,
      graphBaseUrl: `${directoryBaseUrl}/graph/v1.0`,
    };
  }
  const publicBase = `${protocol}//${environment.id}.${baseDomain}`;
  return {
    publicBase,
    directoryBaseUrl: publicBase,
    issuerBase: `${publicBase}/oauth2/default`,
  };
};
