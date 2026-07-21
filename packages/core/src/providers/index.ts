import type { ProviderId, SemanticErrorCode } from "@mockos/contracts";
import { entraProfile } from "./entra";
import { oktaProfile } from "./okta";
import type { ProviderErrorContext, ProviderProfile } from "./types";

export * from "./entra";
export * from "./okta";
export * from "./types";

const profiles: Readonly<Record<ProviderId, ProviderProfile>> = {
  entra: entraProfile,
  okta: oktaProfile,
};

export const getProviderProfile = (provider: ProviderId): ProviderProfile =>
  profiles[provider];

export const renderProviderError = (
  provider: ProviderId | ProviderProfile,
  code: SemanticErrorCode,
  context: ProviderErrorContext
) =>
  (typeof provider === "string"
    ? getProviderProfile(provider)
    : provider
  ).errors.render(code, context);
