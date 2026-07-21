import type {
  ClaimMapperContext,
  OidcDiscoveryDocument,
  ProviderProfile,
  ProviderUrlContext,
} from "../providers";

export const buildOidcDiscovery = (
  profile: ProviderProfile,
  context: ProviderUrlContext
): OidcDiscoveryDocument => profile.discovery(context);

export const mapOidcClaims = (
  profile: ProviderProfile,
  context: ClaimMapperContext
): Readonly<Record<string, unknown>> => profile.claims(context);
