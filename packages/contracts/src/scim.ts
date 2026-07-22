import { z } from "zod";

export const SCIM_CORE_USER_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:User" as const;
export const SCIM_CORE_GROUP_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:Group" as const;
export const SCIM_ENTERPRISE_USER_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" as const;
export const SCIM_LIST_RESPONSE_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse" as const;
export const SCIM_PATCH_OP_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp" as const;
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error" as const;

export const scimVersionSchema = z.number().int().min(1);
export type ScimVersion = z.infer<typeof scimVersionSchema>;

export const scimWeakEtag = (version: number): string => {
  const parsed = scimVersionSchema.parse(version);
  return `W/"${parsed}"`;
};

export const scimMetaSchema = z
  .object({
    resourceType: z.enum(["User", "Group"]),
    created: z.iso.datetime(),
    lastModified: z.iso.datetime(),
    location: z.url(),
    version: z.string().regex(/^W\/"[1-9][0-9]*"$/),
  })
  .strict();
export type ScimMeta = z.infer<typeof scimMetaSchema>;

export const scimNameSchema = z
  .object({
    formatted: z.string().max(1024).optional(),
    familyName: z.string().max(256).optional(),
    givenName: z.string().max(256).optional(),
    middleName: z.string().max(256).optional(),
    honorificPrefix: z.string().max(256).optional(),
    honorificSuffix: z.string().max(256).optional(),
  })
  .strict();

export const scimMultiValueSchema = z
  .object({
    value: z.string().max(2048).optional(),
    display: z.string().max(1024).optional(),
    type: z.string().max(128).optional(),
    primary: z.boolean().optional(),
    $ref: z.url().optional(),
  })
  .passthrough();

export const scimAddressSchema = z
  .object({
    formatted: z.string().max(2048).optional(),
    streetAddress: z.string().max(1024).optional(),
    locality: z.string().max(256).optional(),
    region: z.string().max(256).optional(),
    postalCode: z.string().max(128).optional(),
    country: z.string().max(128).optional(),
    type: z.string().max(128).optional(),
    primary: z.boolean().optional(),
  })
  .strict();

export const scimEnterpriseUserSchema = z
  .object({
    employeeNumber: z.string().max(256).optional(),
    costCenter: z.string().max(256).optional(),
    organization: z.string().max(256).optional(),
    division: z.string().max(256).optional(),
    department: z.string().max(256).optional(),
    manager: z
      .object({
        value: z.string().max(128).optional(),
        $ref: z.url().optional(),
        displayName: z.string().max(256).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const scimUserShape = {
  schemas: z.array(z.string().min(1)).min(1).max(10),
  id: z.string().min(1).max(128).optional(),
  externalId: z.string().max(256).optional(),
  userName: z.string().trim().min(1).max(320),
  name: scimNameSchema.optional(),
  displayName: z.string().max(256).optional(),
  nickName: z.string().max(256).optional(),
  profileUrl: z.url().optional(),
  title: z.string().max(256).optional(),
  userType: z.string().max(256).optional(),
  preferredLanguage: z.string().max(128).optional(),
  locale: z.string().max(128).optional(),
  timezone: z.string().max(128).optional(),
  active: z.boolean().optional(),
  password: z.string().max(4096).optional(),
  emails: z.array(scimMultiValueSchema).max(100).optional(),
  phoneNumbers: z.array(scimMultiValueSchema).max(100).optional(),
  ims: z.array(scimMultiValueSchema).max(100).optional(),
  photos: z.array(scimMultiValueSchema).max(100).optional(),
  addresses: z.array(scimAddressSchema).max(100).optional(),
  groups: z.array(scimMultiValueSchema).max(10_000).optional(),
  entitlements: z.array(scimMultiValueSchema).max(100).optional(),
  roles: z.array(scimMultiValueSchema).max(100).optional(),
  x509Certificates: z.array(scimMultiValueSchema).max(100).optional(),
  [SCIM_ENTERPRISE_USER_SCHEMA]: scimEnterpriseUserSchema.optional(),
};

export const scimUserInputSchema = z.object(scimUserShape).strict();
export type ScimUserInput = z.infer<typeof scimUserInputSchema>;

export const scimUserResourceSchema = z
  .object({
    ...scimUserShape,
    id: z.string().min(1).max(128),
    active: z.boolean(),
    meta: scimMetaSchema,
  })
  .strict();
export type ScimUserResource = z.infer<typeof scimUserResourceSchema>;

export const scimGroupMemberSchema = z
  .object({
    value: z.string().min(1).max(128),
    $ref: z.url().optional(),
    display: z.string().max(256).optional(),
    type: z.enum(["User"]).optional(),
  })
  .strict();

const scimGroupShape = {
  schemas: z.array(z.string().min(1)).min(1).max(10),
  id: z.string().min(1).max(128).optional(),
  externalId: z.string().max(256).optional(),
  displayName: z.string().trim().min(1).max(256),
  members: z.array(scimGroupMemberSchema).max(10_000).optional(),
};

export const scimGroupInputSchema = z.object(scimGroupShape).strict();
export type ScimGroupInput = z.infer<typeof scimGroupInputSchema>;

export const scimGroupResourceSchema = z
  .object({
    ...scimGroupShape,
    id: z.string().min(1).max(128),
    members: z.array(scimGroupMemberSchema).max(10_000),
    meta: scimMetaSchema,
  })
  .strict();
export type ScimGroupResource = z.infer<typeof scimGroupResourceSchema>;

export const scimListResponseSchema = z
  .object({
    schemas: z.tuple([z.literal(SCIM_LIST_RESPONSE_SCHEMA)]),
    totalResults: z.number().int().min(0),
    startIndex: z.number().int().min(1),
    itemsPerPage: z.number().int().min(0),
    Resources: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
export type ScimListResponse = z.infer<typeof scimListResponseSchema>;

export const scimPatchOperationSchema = z
  .object({
    op: z.enum(["add", "remove", "replace"]),
    path: z.string().trim().min(1).max(2048).optional(),
    value: z.unknown().optional(),
  })
  .strict();

export const scimPatchRequestSchema = z
  .object({
    schemas: z.tuple([z.literal(SCIM_PATCH_OP_SCHEMA)]),
    Operations: z.array(scimPatchOperationSchema).min(1).max(100),
  })
  .strict();
export type ScimPatchRequest = z.infer<typeof scimPatchRequestSchema>;

export const scimTypeSchema = z.enum([
  "invalidFilter",
  "tooMany",
  "uniqueness",
  "mutability",
  "invalidSyntax",
  "invalidPath",
  "noTarget",
  "invalidValue",
  "invalidVers",
  "sensitive",
]);
export type ScimType = z.infer<typeof scimTypeSchema>;

export const scimErrorSchema = z
  .object({
    schemas: z.tuple([z.literal(SCIM_ERROR_SCHEMA)]),
    status: z.string().regex(/^[1-5][0-9]{2}$/),
    scimType: scimTypeSchema.optional(),
    detail: z.string().min(1).max(2048),
  })
  .strict();
export type ScimError = z.infer<typeof scimErrorSchema>;

export const scimQuerySchema = z
  .object({
    filter: z.string().min(1).max(8192).optional(),
    startIndex: z.number().int().min(1).default(1),
    count: z.number().int().min(0).max(200).default(100),
    attributes: z.string().max(4096).optional(),
    excludedAttributes: z.string().max(4096).optional(),
  })
  .strict();
export type ScimQuery = z.infer<typeof scimQuerySchema>;

export const scimDialectSchema = z
  .object({
    patchStyle: z.enum(["entra", "okta"]),
    acceptsEnterpriseExtension: z.boolean(),
    groupPatchSuccessStatus: z.union([z.literal(200), z.literal(204)]),
    supportsPathlessReplace: z.boolean(),
  })
  .strict();
export type ScimDialect = z.infer<typeof scimDialectSchema>;
