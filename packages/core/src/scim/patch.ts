import {
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_CORE_USER_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  type ScimDialect,
} from "@mockos/contracts";
import { ScimProtocolError } from "./errors";
import {
  evaluateScimFilter,
  parseScimAttributePath,
  parseScimFilter,
  type ScimAttributePath,
  type ScimFilter,
} from "./filter";

export type ScimResourceType = "User" | "Group";
export type ScimPatchStyle = "rfc7644" | ScimDialect["patchStyle"];

export interface ScimPatchLimits {
  readonly maxBytes: number;
  readonly maxOperations: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringBytes: number;
  readonly maxPathBytes: number;
}

export const DEFAULT_SCIM_PATCH_LIMITS: ScimPatchLimits = Object.freeze({
  maxBytes: 1_048_576,
  maxOperations: 100,
  maxDepth: 16,
  maxNodes: 20_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 256,
  maxStringBytes: 16_384,
  maxPathBytes: 2_048,
});

export interface ApplyScimPatchOptions {
  readonly resourceType: ScimResourceType;
  readonly dialect?: ScimPatchStyle | Pick<ScimDialect, "patchStyle">;
  readonly limits?: Partial<ScimPatchLimits>;
}

export interface ScimPatchResult<T extends Readonly<Record<string, unknown>>> {
  readonly resource: T;
  readonly changed: boolean;
}

type MutableRecord = Record<string, unknown>;
type PatchOperationName = "add" | "remove" | "replace";

interface ParsedPatchOperation {
  readonly op: PatchOperationName;
  readonly path?: string;
  readonly hasValue: boolean;
  readonly value?: unknown;
}

interface ParsedPatchPath {
  readonly attributePath: ScimAttributePath;
  readonly filter?: ScimFilter;
  readonly selectedSubAttribute?: string;
}

type AttributeType = "string" | "boolean" | "complex";
type AttributeMutability = "readWrite" | "readOnly" | "writeOnly";

interface AttributeDefinition {
  readonly canonical: string;
  readonly type: AttributeType;
  readonly multi?: boolean;
  readonly required?: boolean;
  readonly mutability?: AttributeMutability;
  readonly maxLength?: number;
  readonly maxItems?: number;
  readonly trim?: boolean;
  readonly url?: boolean;
  readonly allowedValues?: readonly string[];
  readonly allowUnknown?: boolean;
  readonly subAttributes?: Readonly<Record<string, AttributeDefinition>>;
}

interface ResolvedAttribute {
  readonly containerKey?: string;
  readonly definition: AttributeDefinition;
  readonly subDefinition?: AttributeDefinition;
}

const textEncoder = new TextEncoder();
const byteLength = (value: string): number => textEncoder.encode(value).byteLength;
const normalizedName = (value: string): string => value.toLowerCase();

const patchError = (
  detail: string,
  scimType:
    | "invalidSyntax"
    | "invalidPath"
    | "noTarget"
    | "invalidValue"
    | "mutability",
  cause?: unknown
): ScimProtocolError =>
  new ScimProtocolError(
    400,
    detail,
    scimType,
    cause === undefined ? undefined : { cause }
  );

const stringDefinition = (
  canonical: string,
  options: Omit<AttributeDefinition, "canonical" | "type"> = {}
): AttributeDefinition => ({ canonical, type: "string", ...options });

const booleanDefinition = (
  canonical: string,
  options: Omit<AttributeDefinition, "canonical" | "type"> = {}
): AttributeDefinition => ({ canonical, type: "boolean", ...options });

const complexDefinition = (
  canonical: string,
  subAttributes: readonly AttributeDefinition[],
  options: Omit<AttributeDefinition, "canonical" | "type" | "subAttributes"> = {}
): AttributeDefinition => ({
  canonical,
  type: "complex",
  subAttributes: Object.fromEntries(
    subAttributes.map((definition) => [
      normalizedName(definition.canonical),
      definition,
    ])
  ),
  ...options,
});

const genericMultiValueSubAttributes = [
  stringDefinition("value", { maxLength: 2_048 }),
  stringDefinition("display", { maxLength: 1_024 }),
  stringDefinition("type", { maxLength: 128 }),
  booleanDefinition("primary"),
  stringDefinition("$ref", { url: true }),
] as const;

const addressSubAttributes = [
  stringDefinition("formatted", { maxLength: 2_048 }),
  stringDefinition("streetAddress", { maxLength: 1_024 }),
  stringDefinition("locality", { maxLength: 256 }),
  stringDefinition("region", { maxLength: 256 }),
  stringDefinition("postalCode", { maxLength: 128 }),
  stringDefinition("country", { maxLength: 128 }),
  stringDefinition("type", { maxLength: 128 }),
  booleanDefinition("primary"),
] as const;

const nameDefinition = complexDefinition("name", [
  stringDefinition("formatted", { maxLength: 1_024 }),
  stringDefinition("familyName", { maxLength: 256 }),
  stringDefinition("givenName", { maxLength: 256 }),
  stringDefinition("middleName", { maxLength: 256 }),
  stringDefinition("honorificPrefix", { maxLength: 256 }),
  stringDefinition("honorificSuffix", { maxLength: 256 }),
]);

const metaDefinition = complexDefinition(
  "meta",
  [
    stringDefinition("resourceType"),
    stringDefinition("created"),
    stringDefinition("lastModified"),
    stringDefinition("location", { url: true }),
    stringDefinition("version"),
  ],
  { mutability: "readOnly" }
);

const schemasDefinition: AttributeDefinition = {
  ...stringDefinition("schemas", { mutability: "readOnly" }),
  multi: true,
  maxItems: 10,
};

const userDefinitions = [
  schemasDefinition,
  stringDefinition("id", { maxLength: 128, mutability: "readOnly" }),
  stringDefinition("externalId", { maxLength: 256 }),
  stringDefinition("userName", {
    maxLength: 320,
    required: true,
    trim: true,
  }),
  nameDefinition,
  stringDefinition("displayName", { maxLength: 256 }),
  stringDefinition("nickName", { maxLength: 256 }),
  stringDefinition("profileUrl", { url: true }),
  stringDefinition("title", { maxLength: 256 }),
  stringDefinition("userType", { maxLength: 256 }),
  stringDefinition("preferredLanguage", { maxLength: 128 }),
  stringDefinition("locale", { maxLength: 128 }),
  stringDefinition("timezone", { maxLength: 128 }),
  booleanDefinition("active"),
  stringDefinition("password", { maxLength: 4_096, mutability: "writeOnly" }),
  ...[
    "emails",
    "phoneNumbers",
    "ims",
    "photos",
    "entitlements",
    "roles",
    "x509Certificates",
  ].map((name) =>
    complexDefinition(name, genericMultiValueSubAttributes, {
      multi: true,
      maxItems: 100,
      allowUnknown: true,
    })
  ),
  complexDefinition("addresses", addressSubAttributes, {
    multi: true,
    maxItems: 100,
  }),
  complexDefinition("groups", genericMultiValueSubAttributes, {
    multi: true,
    maxItems: 10_000,
    mutability: "readOnly",
  }),
  metaDefinition,
] as const;

const groupMemberDefinition = complexDefinition(
  "members",
  [
    stringDefinition("value", { maxLength: 128, required: true }),
    stringDefinition("$ref", { url: true }),
    stringDefinition("display", { maxLength: 256 }),
    stringDefinition("type", { maxLength: 16, allowedValues: ["User"] }),
  ],
  { multi: true, maxItems: 10_000 }
);

const groupDefinitions = [
  schemasDefinition,
  stringDefinition("id", { maxLength: 128, mutability: "readOnly" }),
  stringDefinition("externalId", { maxLength: 256 }),
  stringDefinition("displayName", {
    maxLength: 256,
    required: true,
    trim: true,
  }),
  groupMemberDefinition,
  metaDefinition,
] as const;

const enterpriseDefinition = complexDefinition(SCIM_ENTERPRISE_USER_SCHEMA, [
  stringDefinition("employeeNumber", { maxLength: 256 }),
  stringDefinition("costCenter", { maxLength: 256 }),
  stringDefinition("organization", { maxLength: 256 }),
  stringDefinition("division", { maxLength: 256 }),
  stringDefinition("department", { maxLength: 256 }),
  complexDefinition("manager", [
    stringDefinition("value", { maxLength: 128 }),
    stringDefinition("$ref", { url: true }),
    stringDefinition("displayName", { maxLength: 256 }),
  ]),
]);

const definitionMap = (
  definitions: readonly AttributeDefinition[]
): Readonly<Record<string, AttributeDefinition>> =>
  Object.fromEntries(
    definitions.map((definition) => [normalizedName(definition.canonical), definition])
  );

const userDefinitionMap = definitionMap(userDefinitions);
const groupDefinitionMap = definitionMap(groupDefinitions);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const matchingKeys = (
  record: Readonly<Record<string, unknown>>,
  name: string
): string[] => {
  const normalized = normalizedName(name);
  return Object.keys(record).filter((key) => normalizedName(key) === normalized);
};

const findKey = (
  record: Readonly<Record<string, unknown>>,
  name: string,
  scimType: "invalidSyntax" | "invalidValue" = "invalidValue"
): string | undefined => {
  const matches = matchingKeys(record, name);
  if (matches.length > 1) {
    throw patchError(`Ambiguous case variants for SCIM attribute ${name}.`, scimType);
  }
  return matches[0];
};

const readField = (
  record: Readonly<Record<string, unknown>>,
  name: string,
  required: boolean
): { readonly exists: boolean; readonly value?: unknown } => {
  const key = findKey(record, name, "invalidSyntax");
  if (key === undefined) {
    if (required)
      throw patchError(`Missing required PatchOp field ${name}.`, "invalidSyntax");
    return { exists: false };
  }
  return { exists: true, value: record[key] };
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!deepEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
};

const withLimits = (
  overrides: Partial<ScimPatchLimits> | undefined
): ScimPatchLimits => {
  const limits = { ...DEFAULT_SCIM_PATCH_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
};

const validateBoundedJson = (value: unknown, limits: ScimPatchLimits): void => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw patchError("PatchOp request must be acyclic JSON.", "invalidSyntax", error);
  }
  if (serialized === undefined || byteLength(serialized) > limits.maxBytes) {
    throw patchError(
      `PatchOp request exceeds the ${limits.maxBytes}-byte limit or is not JSON.`,
      "invalidSyntax"
    );
  }

  let nodes = 0;
  const ancestors = new Set<unknown>();
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw patchError(
        `PatchOp exceeds the ${limits.maxNodes}-node limit.`,
        "invalidValue"
      );
    }
    if (depth > limits.maxDepth) {
      throw patchError(
        `PatchOp exceeds the ${limits.maxDepth}-level limit.`,
        "invalidValue"
      );
    }
    if (typeof current === "string") {
      if (byteLength(current) > limits.maxStringBytes) {
        throw patchError(
          `PatchOp string exceeds the ${limits.maxStringBytes}-byte limit.`,
          "invalidValue"
        );
      }
      return;
    }
    if (
      current === null ||
      typeof current === "boolean" ||
      (typeof current === "number" && Number.isFinite(current))
    ) {
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maxArrayLength) {
        throw patchError(
          `PatchOp array exceeds the ${limits.maxArrayLength}-item limit.`,
          "invalidValue"
        );
      }
      if (ancestors.has(current)) {
        throw patchError("PatchOp request must be acyclic JSON.", "invalidSyntax");
      }
      ancestors.add(current);
      for (const item of current) visit(item, depth + 1);
      ancestors.delete(current);
      return;
    }
    if (!isRecord(current)) {
      throw patchError("PatchOp contains a non-JSON value.", "invalidSyntax");
    }
    const keys = Object.keys(current);
    if (keys.length > limits.maxObjectKeys) {
      throw patchError(
        `PatchOp object exceeds the ${limits.maxObjectKeys}-key limit.`,
        "invalidValue"
      );
    }
    if (ancestors.has(current)) {
      throw patchError("PatchOp request must be acyclic JSON.", "invalidSyntax");
    }
    ancestors.add(current);
    for (const key of keys) {
      if (byteLength(key) > limits.maxStringBytes) {
        throw patchError("PatchOp contains an overlong object key.", "invalidValue");
      }
      visit(current[key], depth + 1);
    }
    ancestors.delete(current);
  };
  visit(value, 0);
};

const parsePatchRequest = (
  request: unknown,
  limits: ScimPatchLimits
): readonly ParsedPatchOperation[] => {
  validateBoundedJson(request, limits);
  if (!isRecord(request)) {
    throw patchError("PatchOp request must be a JSON object.", "invalidSyntax");
  }
  const allowedTopLevel = new Set(["schemas", "operations"]);
  if (Object.keys(request).some((key) => !allowedTopLevel.has(normalizedName(key)))) {
    throw patchError("PatchOp request contains an unknown field.", "invalidSyntax");
  }
  const schemas = readField(request, "schemas", true).value;
  if (
    !Array.isArray(schemas) ||
    schemas.length !== 1 ||
    typeof schemas[0] !== "string" ||
    normalizedName(schemas[0]) !== normalizedName(SCIM_PATCH_OP_SCHEMA)
  ) {
    throw patchError(
      "PatchOp schemas must contain only the PatchOp schema URI.",
      "invalidSyntax"
    );
  }
  const operations = readField(request, "Operations", true).value;
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > limits.maxOperations
  ) {
    throw patchError(
      `PatchOp Operations must contain between 1 and ${limits.maxOperations} entries.`,
      "invalidSyntax"
    );
  }

  return operations.map((rawOperation, index) => {
    if (!isRecord(rawOperation)) {
      throw patchError(
        `PatchOp operation ${index + 1} must be an object.`,
        "invalidSyntax"
      );
    }
    const allowedOperationFields = new Set(["op", "path", "value"]);
    if (
      Object.keys(rawOperation).some(
        (key) => !allowedOperationFields.has(normalizedName(key))
      )
    ) {
      throw patchError(
        `PatchOp operation ${index + 1} has an unknown field.`,
        "invalidSyntax"
      );
    }
    const rawOp = readField(rawOperation, "op", true).value;
    if (typeof rawOp !== "string") {
      throw patchError(
        `PatchOp operation ${index + 1} has an invalid op.`,
        "invalidSyntax"
      );
    }
    const op = normalizedName(rawOp);
    if (op !== "add" && op !== "remove" && op !== "replace") {
      throw patchError(`Unsupported PatchOp operation: ${rawOp}.`, "invalidSyntax");
    }
    const rawPath = readField(rawOperation, "path", false);
    if (
      rawPath.exists &&
      (typeof rawPath.value !== "string" || !rawPath.value.trim())
    ) {
      throw patchError(
        `PatchOp operation ${index + 1} has an invalid path.`,
        "invalidPath"
      );
    }
    const rawValue = readField(rawOperation, "value", false);
    if (op !== "remove" && !rawValue.exists) {
      throw patchError(`PatchOp ${op} operation requires a value.`, "invalidValue");
    }
    if (!rawPath.exists && op === "remove") {
      throw patchError("PatchOp remove operation requires a path.", "invalidPath");
    }
    if (!rawPath.exists && rawValue.exists && !isRecord(rawValue.value)) {
      throw patchError(
        `Pathless PatchOp ${op} value must be an object.`,
        "invalidValue"
      );
    }
    return {
      op,
      ...(rawPath.exists ? { path: (rawPath.value as string).trim() } : {}),
      hasValue: rawValue.exists,
      ...(rawValue.exists ? { value: rawValue.value } : {}),
    };
  });
};

const parsePatchPath = (path: string, limits: ScimPatchLimits): ParsedPatchPath => {
  if (byteLength(path) > limits.maxPathBytes) {
    throw patchError(
      `PatchOp path exceeds the ${limits.maxPathBytes}-byte limit.`,
      "invalidPath"
    );
  }
  const open = path.indexOf("[");
  if (open < 0) {
    return {
      attributePath: parseScimAttributePath(path, {
        maxBytes: limits.maxPathBytes,
        errorType: "invalidPath",
      }),
    };
  }

  let close = -1;
  let quoted = false;
  let escaped = false;
  for (let index = open + 1; index < path.length; index += 1) {
    const character = path[index];
    if (character === undefined) break;
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "]" && !quoted) {
      close = index;
      break;
    } else if (character === "[" && !quoted) {
      throw patchError(
        "Nested PatchOp valuePath expressions are invalid.",
        "invalidPath"
      );
    }
  }
  if (close < 0 || quoted) {
    throw patchError("Unterminated PatchOp valuePath expression.", "invalidPath");
  }
  const base = path.slice(0, open).trim();
  const filterSource = path.slice(open + 1, close).trim();
  const suffix = path.slice(close + 1).trim();
  if (!base || !filterSource || (suffix && !suffix.startsWith("."))) {
    throw patchError("Invalid PatchOp valuePath expression.", "invalidPath");
  }
  const attributePath = parseScimAttributePath(base, {
    maxBytes: limits.maxPathBytes,
    errorType: "invalidPath",
  });
  if (attributePath.subAttribute !== undefined) {
    throw patchError(
      "PatchOp valuePath must target a top-level attribute.",
      "invalidPath"
    );
  }
  let filter: ScimFilter;
  try {
    filter = parseScimFilter(filterSource, {
      maxBytes: limits.maxPathBytes,
      maxLiteralBytes: limits.maxStringBytes,
    });
  } catch (error) {
    if (error instanceof ScimProtocolError) {
      throw patchError(
        `Invalid PatchOp valuePath filter: ${error.message}`,
        "invalidPath",
        error
      );
    }
    throw error;
  }
  let selectedSubAttribute: string | undefined;
  if (suffix) {
    const parsedSuffix = parseScimAttributePath(suffix.slice(1), {
      maxBytes: limits.maxPathBytes,
      errorType: "invalidPath",
    });
    if (parsedSuffix.schema || parsedSuffix.subAttribute) {
      throw patchError(
        "PatchOp valuePath may select only one sub-attribute.",
        "invalidPath"
      );
    }
    selectedSubAttribute = parsedSuffix.attribute;
  }
  if (path.slice(close + 1).includes("[")) {
    throw patchError("PatchOp path contains more than one valuePath.", "invalidPath");
  }
  return {
    attributePath,
    filter,
    ...(selectedSubAttribute ? { selectedSubAttribute } : {}),
  };
};

const definitionsFor = (
  resourceType: ScimResourceType
): Readonly<Record<string, AttributeDefinition>> =>
  resourceType === "User" ? userDefinitionMap : groupDefinitionMap;

const resolveAttribute = (
  resourceType: ScimResourceType,
  path: ScimAttributePath,
  selectedSubAttribute?: string
): ResolvedAttribute => {
  let definitions = definitionsFor(resourceType);
  let containerKey: string | undefined;
  if (path.schema) {
    const normalizedSchema = normalizedName(path.schema);
    const expectedCore = normalizedName(
      resourceType === "User" ? SCIM_CORE_USER_SCHEMA : SCIM_CORE_GROUP_SCHEMA
    );
    if (normalizedSchema === normalizedName(SCIM_ENTERPRISE_USER_SCHEMA)) {
      if (resourceType !== "User") {
        throw patchError(
          "Enterprise User attributes cannot be applied to Groups.",
          "invalidPath"
        );
      }
      definitions = enterpriseDefinition.subAttributes ?? {};
      containerKey = SCIM_ENTERPRISE_USER_SCHEMA;
    } else if (normalizedSchema !== expectedCore) {
      throw patchError(`Unsupported SCIM schema URI: ${path.schema}.`, "invalidPath");
    }
  }
  const definition = definitions[normalizedName(path.attribute)];
  if (!definition) {
    throw patchError(`Unknown SCIM attribute: ${path.attribute}.`, "invalidPath");
  }
  const requestedSubAttribute = selectedSubAttribute ?? path.subAttribute;
  let subDefinition: AttributeDefinition | undefined;
  if (requestedSubAttribute) {
    subDefinition = definition.subAttributes?.[normalizedName(requestedSubAttribute)];
    if (!subDefinition) {
      throw patchError(
        `Unknown SCIM sub-attribute: ${definition.canonical}.${requestedSubAttribute}.`,
        "invalidPath"
      );
    }
  }
  return {
    ...(containerKey ? { containerKey } : {}),
    definition,
    ...(subDefinition ? { subDefinition } : {}),
  };
};

const resolvePathlessAttribute = (
  resourceType: ScimResourceType,
  name: string
): ResolvedAttribute => {
  if (normalizedName(name) === normalizedName(SCIM_ENTERPRISE_USER_SCHEMA)) {
    if (resourceType !== "User") {
      throw patchError(
        "Enterprise User attributes cannot be applied to Groups.",
        "invalidPath"
      );
    }
    return { definition: enterpriseDefinition };
  }
  if (name.includes(":")) {
    throw patchError(`Unknown SCIM extension attribute: ${name}.`, "invalidPath");
  }
  return resolveAttribute(
    resourceType,
    parseScimAttributePath(name, { errorType: "invalidPath" })
  );
};

const normalizeSingleValue = (
  definition: AttributeDefinition,
  value: unknown,
  path: string
): unknown => {
  if (definition.type === "string") {
    if (typeof value !== "string") {
      throw patchError(`${path} must be a string.`, "invalidValue");
    }
    const normalized = definition.trim ? value.trim() : value;
    if (definition.required && !normalized) {
      throw patchError(`${path} cannot be empty.`, "invalidValue");
    }
    if (
      definition.maxLength !== undefined &&
      normalized.length > definition.maxLength
    ) {
      throw patchError(
        `${path} exceeds its ${definition.maxLength}-character limit.`,
        "invalidValue"
      );
    }
    if (definition.url) {
      try {
        new URL(normalized);
      } catch (error) {
        throw patchError(`${path} must be an absolute URL.`, "invalidValue", error);
      }
    }
    if (
      definition.allowedValues &&
      !definition.allowedValues.some(
        (allowed) => normalizedName(allowed) === normalizedName(normalized)
      )
    ) {
      throw patchError(
        `${path} must be one of: ${definition.allowedValues.join(", ")}.`,
        "invalidValue"
      );
    }
    return normalized;
  }
  if (definition.type === "boolean") {
    if (typeof value !== "boolean") {
      throw patchError(`${path} must be a boolean.`, "invalidValue");
    }
    return value;
  }
  if (!isRecord(value)) {
    throw patchError(`${path} must be a complex object.`, "invalidValue");
  }
  const result: MutableRecord = {};
  const seen = new Set<string>();
  for (const [providedName, providedValue] of Object.entries(value)) {
    const normalizedProvidedName = normalizedName(providedName);
    if (seen.has(normalizedProvidedName)) {
      throw patchError(`${path} contains ambiguous case variants.`, "invalidValue");
    }
    seen.add(normalizedProvidedName);
    const subDefinition = definition.subAttributes?.[normalizedProvidedName];
    if (!subDefinition) {
      if (!definition.allowUnknown) {
        throw patchError(
          `Unknown SCIM attribute ${path}.${providedName}.`,
          "invalidPath"
        );
      }
      result[providedName] = structuredClone(providedValue);
      continue;
    }
    result[subDefinition.canonical] = normalizeValue(
      subDefinition,
      providedValue,
      `${path}.${subDefinition.canonical}`
    );
  }
  for (const subDefinition of Object.values(definition.subAttributes ?? {})) {
    if (
      subDefinition.required &&
      findKey(result, subDefinition.canonical) === undefined
    ) {
      throw patchError(
        `${path}.${subDefinition.canonical} is required.`,
        "invalidValue"
      );
    }
  }
  return result;
};

const normalizeValue = (
  definition: AttributeDefinition,
  value: unknown,
  path: string
): unknown => {
  if (!definition.multi) return normalizeSingleValue(definition, value, path);
  const values = Array.isArray(value) ? value : [value];
  if (definition.maxItems !== undefined && values.length > definition.maxItems) {
    throw patchError(
      `${path} exceeds its ${definition.maxItems}-item limit.`,
      "invalidValue"
    );
  }
  return values.map((item) =>
    normalizeSingleValue({ ...definition, multi: false }, item, path)
  );
};

const getContainer = (
  resource: MutableRecord,
  containerKey: string | undefined,
  create: boolean
): MutableRecord | undefined => {
  if (!containerKey) return resource;
  const existingKey = findKey(resource, containerKey);
  if (existingKey === undefined) {
    if (!create) return undefined;
    resource[containerKey] = {};
    return resource[containerKey] as MutableRecord;
  }
  const existing = resource[existingKey];
  if (!isRecord(existing)) {
    throw patchError(
      `SCIM extension ${containerKey} must be an object.`,
      "invalidValue"
    );
  }
  return existing as MutableRecord;
};

const getAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute
): {
  readonly container?: MutableRecord;
  readonly key?: string;
  readonly value?: unknown;
} => {
  const container = getContainer(resource, resolved.containerKey, false);
  if (!container) return {};
  const key = findKey(container, resolved.definition.canonical);
  return {
    container,
    ...(key === undefined ? {} : { key, value: container[key] }),
  };
};

const setAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute,
  value: unknown
): void => {
  const container = getContainer(resource, resolved.containerKey, true);
  if (!container) throw new Error("SCIM container creation failed.");
  const key = findKey(container, resolved.definition.canonical);
  container[key ?? resolved.definition.canonical] = value;
};

const deleteAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute
): boolean => {
  const found = getAttribute(resource, resolved);
  if (!found.container || found.key === undefined) return false;
  delete found.container[found.key];
  if (resolved.containerKey && Object.keys(found.container).length === 0) {
    const extensionKey = findKey(resource, resolved.containerKey);
    if (extensionKey !== undefined) delete resource[extensionKey];
  }
  return true;
};

const assertMutable = (
  definition: AttributeDefinition,
  currentValue: unknown,
  incomingValue: unknown,
  op: PatchOperationName
): boolean => {
  if (definition.mutability !== "readOnly") return true;
  if (
    op !== "remove" &&
    currentValue !== undefined &&
    deepEqual(currentValue, incomingValue)
  ) {
    return false;
  }
  throw patchError(
    `SCIM attribute ${definition.canonical} is read-only.`,
    "mutability"
  );
};

const normalizePrimary = (values: unknown[], preferredIndex?: number): void => {
  const primaryIndexes = values.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const key = findKey(value, "primary");
    return key !== undefined && value[key] === true ? [index] : [];
  });
  if (primaryIndexes.length <= 1 && preferredIndex === undefined) return;
  const winner = preferredIndex ?? primaryIndexes.at(-1);
  if (winner === undefined) return;
  values.forEach((value, index) => {
    if (!isRecord(value)) return;
    const record = value as MutableRecord;
    const key = findKey(record, "primary");
    if (index === winner) {
      record[key ?? "primary"] = true;
    } else if (key !== undefined && record[key] === true) {
      record[key] = false;
    }
  });
};

const deduplicate = (values: unknown[], definition: AttributeDefinition): unknown[] => {
  if (definition.canonical === "members") {
    const seen = new Set<string>();
    return values.filter((value) => {
      if (!isRecord(value)) return true;
      const key = findKey(value, "value");
      const identifier = key === undefined ? undefined : value[key];
      if (typeof identifier !== "string") return true;
      if (seen.has(identifier)) return false;
      seen.add(identifier);
      return true;
    });
  }
  return values.filter(
    (value, index) =>
      values.findIndex((candidate) => deepEqual(candidate, value)) === index
  );
};

const applyToWholeAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute,
  op: PatchOperationName,
  value: unknown,
  hasValue: boolean
): void => {
  const current = getAttribute(resource, resolved);
  const definition = resolved.definition;
  if (op === "remove") {
    if (definition.required) {
      throw patchError(
        `Required SCIM attribute ${definition.canonical} cannot be removed.`,
        "invalidValue"
      );
    }
    assertMutable(definition, current.value, undefined, op);
    if (!deleteAttribute(resource, resolved)) {
      throw patchError(`No target found for ${definition.canonical}.`, "noTarget");
    }
    return;
  }
  if (!hasValue) throw patchError(`PatchOp ${op} requires a value.`, "invalidValue");
  const normalized = normalizeValue(definition, value, definition.canonical);
  if (!assertMutable(definition, current.value, normalized, op)) return;

  if (op === "add" && definition.multi && current.value !== undefined) {
    if (!Array.isArray(current.value) || !Array.isArray(normalized)) {
      throw patchError(`${definition.canonical} must be multi-valued.`, "invalidValue");
    }
    const combined = deduplicate(
      [...structuredClone(current.value), ...structuredClone(normalized)],
      definition
    );
    normalizePrimary(combined);
    if (definition.maxItems !== undefined && combined.length > definition.maxItems) {
      throw patchError(
        `${definition.canonical} exceeds its ${definition.maxItems}-item limit.`,
        "invalidValue"
      );
    }
    setAttribute(resource, resolved, combined);
    return;
  }
  if (
    op === "add" &&
    definition.type === "complex" &&
    !definition.multi &&
    isRecord(current.value) &&
    isRecord(normalized)
  ) {
    setAttribute(resource, resolved, { ...current.value, ...normalized });
    return;
  }
  if (Array.isArray(normalized)) normalizePrimary(normalized);
  setAttribute(resource, resolved, normalized);
};

const applyToSubAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute,
  op: PatchOperationName,
  value: unknown,
  hasValue: boolean
): void => {
  const definition = resolved.definition;
  const subDefinition = resolved.subDefinition;
  if (!subDefinition) throw new Error("Missing resolved SCIM sub-attribute.");
  const found = getAttribute(resource, resolved);
  const values = definition.multi
    ? Array.isArray(found.value)
      ? found.value
      : undefined
    : found.value === undefined
      ? undefined
      : [found.value];
  if (!values || values.length === 0) {
    throw patchError(`No target found for ${definition.canonical}.`, "noTarget");
  }
  if (op !== "remove" && !hasValue) {
    throw patchError(`PatchOp ${op} requires a value.`, "invalidValue");
  }
  const normalized =
    op === "remove"
      ? undefined
      : normalizeValue(
          subDefinition,
          value,
          `${definition.canonical}.${subDefinition.canonical}`
        );
  if (definition.mutability === "readOnly") {
    throw patchError(
      `SCIM attribute ${definition.canonical} is read-only.`,
      "mutability"
    );
  }
  assertMutable(subDefinition, undefined, normalized, op);

  let targets = 0;
  let preferredPrimaryIndex: number | undefined;
  values.forEach((item, index) => {
    if (!isRecord(item)) {
      throw patchError(
        `${definition.canonical} must contain complex values.`,
        "invalidValue"
      );
    }
    const record = item as MutableRecord;
    const key = findKey(record, subDefinition.canonical);
    if (op === "remove") {
      if (key !== undefined) {
        delete record[key];
        targets += 1;
      }
    } else {
      record[key ?? subDefinition.canonical] = structuredClone(normalized);
      targets += 1;
      if (subDefinition.canonical === "primary" && normalized === true) {
        preferredPrimaryIndex ??= index;
      }
    }
  });
  if (targets === 0) {
    throw patchError(
      `No target found for ${definition.canonical}.${subDefinition.canonical}.`,
      "noTarget"
    );
  }
  if (definition.multi && preferredPrimaryIndex !== undefined) {
    normalizePrimary(values, preferredPrimaryIndex);
  }
  setAttribute(resource, resolved, definition.multi ? values : values[0]);
};

const applyEntraMemberRemoval = (
  resource: MutableRecord,
  resolved: ResolvedAttribute,
  value: unknown
): void => {
  if (resolved.definition.canonical !== "members" || !Array.isArray(value)) {
    throw patchError(
      "Entra member removal requires an array of member values.",
      "invalidValue"
    );
  }
  const identifiers = new Set(
    value.map((item) => {
      if (!isRecord(item)) {
        throw patchError(
          "Entra member removal values must be objects.",
          "invalidValue"
        );
      }
      const key = findKey(item, "value");
      const identifier = key === undefined ? undefined : item[key];
      if (typeof identifier !== "string" || !identifier) {
        throw patchError(
          "Entra member removal requires a member value.",
          "invalidValue"
        );
      }
      return identifier;
    })
  );
  const found = getAttribute(resource, resolved);
  if (!Array.isArray(found.value)) {
    throw patchError("No target found for members.", "noTarget");
  }
  const retained = found.value.filter((member) => {
    if (!isRecord(member)) return true;
    const key = findKey(member, "value");
    return key === undefined || !identifiers.has(String(member[key]));
  });
  if (retained.length === found.value.length) {
    throw patchError("No target found for the requested members.", "noTarget");
  }
  setAttribute(resource, resolved, retained);
};

const applyToFilteredAttribute = (
  resource: MutableRecord,
  resolved: ResolvedAttribute,
  path: ParsedPatchPath,
  op: PatchOperationName,
  value: unknown,
  hasValue: boolean
): void => {
  const definition = resolved.definition;
  if (!definition.multi || definition.type !== "complex" || !path.filter) {
    throw patchError(
      "A PatchOp valuePath must target a multi-valued complex attribute.",
      "invalidPath"
    );
  }
  const found = getAttribute(resource, resolved);
  if (!Array.isArray(found.value)) {
    throw patchError(`No target found for ${definition.canonical}.`, "noTarget");
  }
  if (definition.mutability === "readOnly") {
    throw patchError(
      `SCIM attribute ${definition.canonical} is read-only.`,
      "mutability"
    );
  }
  const matchingIndexes = found.value.flatMap((item, index) =>
    evaluateScimFilter(path.filter as ScimFilter, item) ? [index] : []
  );
  if (matchingIndexes.length === 0) {
    throw patchError(
      `No target matched ${definition.canonical}'s valuePath.`,
      "noTarget"
    );
  }

  const values = found.value as unknown[];
  const subDefinition = resolved.subDefinition;
  if (subDefinition) {
    if (op !== "remove" && !hasValue) {
      throw patchError(`PatchOp ${op} requires a value.`, "invalidValue");
    }
    const normalized =
      op === "remove"
        ? undefined
        : normalizeValue(
            subDefinition,
            value,
            `${definition.canonical}.${subDefinition.canonical}`
          );
    assertMutable(subDefinition, undefined, normalized, op);
    let preferredPrimaryIndex: number | undefined;
    let targets = 0;
    for (const index of matchingIndexes) {
      const item = values[index];
      if (!isRecord(item)) {
        throw patchError(
          `${definition.canonical} must contain complex values.`,
          "invalidValue"
        );
      }
      const record = item as MutableRecord;
      const key = findKey(record, subDefinition.canonical);
      if (op === "remove") {
        if (key !== undefined) {
          delete record[key];
          targets += 1;
        }
      } else {
        record[key ?? subDefinition.canonical] = structuredClone(normalized);
        targets += 1;
        if (subDefinition.canonical === "primary" && normalized === true) {
          preferredPrimaryIndex ??= index;
        }
      }
    }
    if (targets === 0) {
      throw patchError(
        `No target found for ${definition.canonical}.${subDefinition.canonical}.`,
        "noTarget"
      );
    }
    if (preferredPrimaryIndex !== undefined)
      normalizePrimary(values, preferredPrimaryIndex);
    setAttribute(resource, resolved, values);
    return;
  }

  if (op === "remove") {
    const matching = new Set(matchingIndexes);
    setAttribute(
      resource,
      resolved,
      values.filter((_item, index) => !matching.has(index))
    );
    return;
  }
  if (!hasValue) throw patchError(`PatchOp ${op} requires a value.`, "invalidValue");
  const replacementDefinition = { ...definition, multi: false };
  const normalized = normalizeSingleValue(
    replacementDefinition,
    value,
    definition.canonical
  );
  if (op === "add") {
    if (!isRecord(normalized)) {
      throw patchError("Filtered add requires a complex value.", "invalidValue");
    }
    for (const index of matchingIndexes) {
      const item = values[index];
      if (!isRecord(item)) {
        throw patchError(
          `${definition.canonical} must contain complex values.`,
          "invalidValue"
        );
      }
      values[index] = { ...item, ...structuredClone(normalized) };
    }
  } else {
    for (const index of matchingIndexes) values[index] = structuredClone(normalized);
  }
  normalizePrimary(values);
  setAttribute(resource, resolved, deduplicate(values, definition));
};

const applyPathOperation = (
  resource: MutableRecord,
  resourceType: ScimResourceType,
  dialect: ScimPatchStyle,
  operation: ParsedPatchOperation,
  limits: ScimPatchLimits
): void => {
  if (!operation.path) throw new Error("Missing parsed PatchOp path.");
  const path = parsePatchPath(operation.path, limits);
  const resolved = resolveAttribute(
    resourceType,
    path.attributePath,
    path.selectedSubAttribute
  );
  if (
    dialect === "entra" &&
    resourceType === "Group" &&
    operation.op === "remove" &&
    !path.filter &&
    !resolved.subDefinition &&
    operation.hasValue
  ) {
    applyEntraMemberRemoval(resource, resolved, operation.value);
    return;
  }
  if (path.filter) {
    applyToFilteredAttribute(
      resource,
      resolved,
      path,
      operation.op,
      operation.value,
      operation.hasValue
    );
  } else if (resolved.subDefinition) {
    applyToSubAttribute(
      resource,
      resolved,
      operation.op,
      operation.value,
      operation.hasValue
    );
  } else {
    applyToWholeAttribute(
      resource,
      resolved,
      operation.op,
      operation.value,
      operation.hasValue
    );
  }
};

const applyPathlessOperation = (
  resource: MutableRecord,
  resourceType: ScimResourceType,
  operation: ParsedPatchOperation
): void => {
  if (!isRecord(operation.value)) {
    throw patchError(
      `Pathless PatchOp ${operation.op} value must be an object.`,
      "invalidValue"
    );
  }
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(operation.value)) {
    const normalized = normalizedName(name);
    if (seen.has(normalized)) {
      throw patchError(
        "Pathless PatchOp contains ambiguous case variants.",
        "invalidValue"
      );
    }
    seen.add(normalized);
    const resolved = resolvePathlessAttribute(resourceType, name);
    applyToWholeAttribute(resource, resolved, operation.op, value, true);
  }
};

const validateRequiredAttributes = (
  resource: MutableRecord,
  resourceType: ScimResourceType
): void => {
  for (const definition of Object.values(definitionsFor(resourceType))) {
    if (!definition.required) continue;
    const key = findKey(resource, definition.canonical);
    if (key === undefined) {
      throw patchError(
        `Required SCIM attribute ${definition.canonical} is missing.`,
        "invalidValue"
      );
    }
    normalizeValue(definition, resource[key], definition.canonical);
  }
};

const patchStyle = (dialect: ApplyScimPatchOptions["dialect"]): ScimPatchStyle => {
  if (!dialect) return "rfc7644";
  return typeof dialect === "string" ? dialect : dialect.patchStyle;
};

export const applyScimPatch = <T extends Readonly<Record<string, unknown>>>(
  resource: T,
  request: unknown,
  options: ApplyScimPatchOptions
): ScimPatchResult<T> => {
  const limits = withLimits(options.limits);
  const operations = parsePatchRequest(request, limits);
  let working: MutableRecord;
  try {
    working = structuredClone(resource) as MutableRecord;
  } catch (error) {
    throw patchError("SCIM resource must be cloneable JSON.", "invalidValue", error);
  }
  const dialect = patchStyle(options.dialect);
  for (const operation of operations) {
    if (operation.path) {
      applyPathOperation(working, options.resourceType, dialect, operation, limits);
    } else {
      applyPathlessOperation(working, options.resourceType, operation);
    }
  }
  validateRequiredAttributes(working, options.resourceType);
  return {
    resource: working as T,
    changed: !deepEqual(resource, working),
  };
};
