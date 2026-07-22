import type { ScimType } from "@mockos/contracts";

export class ScimProtocolError extends Error {
  readonly status: number;
  readonly scimType?: ScimType;

  constructor(
    status: number,
    detail: string,
    scimType?: ScimType,
    options?: ErrorOptions
  ) {
    super(detail, options);
    this.name = "ScimProtocolError";
    this.status = status;
    this.scimType = scimType;
  }
}

export type ScimVersionPrecondition = number | "*" | undefined;

const assertVersion = (version: number): number => {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ScimProtocolError(
      400,
      "A SCIM resource version must be a positive safe integer.",
      "invalidVers"
    );
  }
  return version;
};

export const formatScimEtag = (version: number): string =>
  `W/"${assertVersion(version)}"`;

export const parseScimEtag = (etag: string): number => {
  const match = /^(?:W\/)?"([1-9][0-9]*)"$/.exec(etag.trim());
  if (!match) {
    throw new ScimProtocolError(400, "Malformed SCIM entity tag.", "invalidVers");
  }
  const version = Number(match[1]);
  return assertVersion(version);
};

export const parseScimIfMatch = (
  header: string | null | undefined
): ScimVersionPrecondition => {
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === "*") return "*";
  if (!trimmed || trimmed.includes(",")) {
    throw new ScimProtocolError(400, "Malformed If-Match header.", "invalidVers");
  }
  return parseScimEtag(trimmed);
};

export const assertScimIfMatch = (
  precondition: ScimVersionPrecondition,
  currentVersion: number
): void => {
  const current = assertVersion(currentVersion);
  if (precondition === undefined || precondition === "*" || precondition === current) {
    return;
  }
  throw new ScimProtocolError(
    412,
    `Resource version ${precondition} does not match the current version ${current}.`
  );
};
