import type { SqlValue } from "../store";

export type VersionPrecondition = number | "*" | undefined;

export interface MutationResult<T> {
  readonly record: T;
  readonly changed: boolean;
}

export class DirectoryResourceNotFoundError extends Error {
  readonly code = "DIRECTORY_RESOURCE_NOT_FOUND";
  readonly resourceType: "User" | "Group" | "Application";
  readonly resourceId: string;

  constructor(resourceType: "User" | "Group" | "Application", resourceId: string) {
    super(`${resourceType} '${resourceId}' was not found.`);
    this.name = "DirectoryResourceNotFoundError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

export class DirectoryVersionPreconditionError extends Error {
  readonly code = "DIRECTORY_VERSION_PRECONDITION_FAILED";
  readonly expectedVersion: number;
  readonly currentVersion: number;

  constructor(expectedVersion: number, currentVersion: number) {
    super(
      `Resource version ${expectedVersion} does not match current version ${currentVersion}.`
    );
    this.name = "DirectoryVersionPreconditionError";
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
}

export class DirectoryUniquenessError extends Error {
  readonly code = "DIRECTORY_UNIQUENESS_CONFLICT";
  readonly attribute: string;

  constructor(attribute: string) {
    super(`A resource with the same ${attribute} already exists.`);
    this.name = "DirectoryUniquenessError";
    this.attribute = attribute;
  }
}

export const assertVersionPrecondition = (
  currentVersion: number,
  precondition: VersionPrecondition
): void => {
  if (precondition === undefined || precondition === "*") return;
  if (!Number.isSafeInteger(precondition) || precondition < 1) {
    throw new RangeError("Resource version preconditions must be positive integers.");
  }
  if (precondition !== currentVersion) {
    throw new DirectoryVersionPreconditionError(precondition, currentVersion);
  }
};

export const normalizeName = (value: string): string => value.trim().toLowerCase();

export const asOptionalString = (value: SqlValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

export const parseJson = <T>(value: SqlValue | undefined, fallback: T): T => {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const idFromUuid = (prefix: string, uuid: string): string =>
  `${prefix}_${uuid.replaceAll("-", "")}`;
