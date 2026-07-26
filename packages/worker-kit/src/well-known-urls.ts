import { type WellKnownUrls, wellKnownUrlsSchema } from "@mockos/contracts";
import type { ProviderProfile } from "@mockos/core";
import { trustedPublicUrl } from "./trusted-public-url";

export type WellKnownUrlLocation = {
  readonly directoryBaseUrl: string;
  readonly graphBaseUrl?: string;
  readonly issuerBase: string;
};

export const buildWellKnownUrls = (
  provider: ProviderProfile,
  tenantId: string,
  location: WellKnownUrlLocation
): WellKnownUrls => {
  const issuerBase = trustedPublicUrl(location.issuerBase, "Well-known issuer base");
  const directoryBaseUrl = trustedPublicUrl(
    location.directoryBaseUrl,
    "Well-known directory base",
    { protocol: new URL(issuerBase).protocol }
  );
  const context = { issuerBase, tenantId };
  const urls = provider.urls;
  const graphBaseUrl =
    provider.id === "entra"
      ? trustedPublicUrl(location.graphBaseUrl ?? "", "Well-known Graph base", {
          pathSuffix: "/graph/v1.0",
          protocol: new URL(issuerBase).protocol,
        })
      : undefined;
  if (
    graphBaseUrl &&
    graphBaseUrl !== `${directoryBaseUrl.replace(/\/+$/, "")}/graph/v1.0`
  ) {
    throw new Error("Well-known Graph base must belong to the directory base.");
  }
  return wellKnownUrlsSchema.parse({
    issuer: urls.issuer(context),
    openidConfiguration: urls.discovery(context),
    authorizationEndpoint: urls.authorization(context),
    tokenEndpoint: urls.token(context),
    jwksUri: urls.jwks(context),
    scimBaseUrl: `${directoryBaseUrl.replace(/\/+$/, "")}/scim/v2`,
    ...(provider.id === "entra"
      ? { graphBaseUrl }
      : {
          oktaApiBaseUrl: `${directoryBaseUrl.replace(/\/+$/, "")}/api/v1`,
          oktaAuthnEndpoint: `${directoryBaseUrl.replace(/\/+$/, "")}/api/v1/authn`,
        }),
    ...(urls.userInfo ? { userinfoEndpoint: urls.userInfo(context) } : {}),
    ...(urls.introspection
      ? { introspectionEndpoint: urls.introspection(context) }
      : {}),
    ...(urls.revocation ? { revocationEndpoint: urls.revocation(context) } : {}),
    ...(urls.deviceAuthorization
      ? { deviceAuthorizationEndpoint: urls.deviceAuthorization(context) }
      : {}),
  });
};
