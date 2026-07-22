import type { BrokenTokenVariant } from "@mockos/contracts";

export interface BrokenTokenContext {
  readonly clientId: string;
  readonly nowEpochSeconds: number;
}

/** Deterministic claim overrides for each locked negative-token fixture. */
export const brokenTokenClaimOverrides = (
  variant: BrokenTokenVariant | undefined,
  context: BrokenTokenContext
): Readonly<Record<string, unknown>> => {
  switch (variant) {
    case "expired":
      return {
        iat: context.nowEpochSeconds - 3_600,
        nbf: context.nowEpochSeconds - 3_600,
        exp: context.nowEpochSeconds - 60,
      };
    case "wrong_audience":
      return {
        aud: `https://wrong-audience.mockos.invalid/${encodeURIComponent(
          context.clientId
        )}`,
      };
    case "not_yet_valid":
      return {
        nbf: context.nowEpochSeconds + 3_600,
        exp: context.nowEpochSeconds + 7_200,
      };
    case "wrong_issuer":
      return { iss: "https://wrong-issuer.mockos.invalid" };
    case "bad_signature":
    case undefined:
      return {};
  }
};

export const corruptJwtSignature = (token: string): string => {
  const parts = token.split(".");
  const signature = parts[2];
  if (parts.length !== 3 || !signature) throw new Error("Expected a compact JWT.");
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  return parts.join(".");
};
