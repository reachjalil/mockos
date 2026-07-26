import type { z } from "zod";

export const mockosManagementScopes = ["env:ro", "env:rw"] as const;
export type MockosManagementScope = (typeof mockosManagementScopes)[number];

export type MockosHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type MockosToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type MockosOperationEffect = "read" | "mutation" | "destructive" | "outbound";

export type MockosRetryPolicy = "safe" | "idempotent" | "never";

export type MockosSecretPolicy = "none" | "redact" | "display-once";

export type MockosMcpOperation = {
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  annotations: MockosToolAnnotations;
};

export type MockosHttpOperation = {
  operationId: string;
  title?: string;
  description?: string;
  method: MockosHttpMethod;
  path: `/${string}`;
  successStatus: number;
  pathSchema?: z.ZodType;
  querySchema?: z.ZodType;
  bodySchema?: z.ZodType;
  responseSchema: z.ZodType;
};

export type MockosManagementOperation = {
  operationId: string;
  title: string;
  description: string;
  requiredScopes: readonly MockosManagementScope[];
  effect: MockosOperationEffect;
  retry: MockosRetryPolicy;
  requestSecrets: MockosSecretPolicy;
  responseSecrets: MockosSecretPolicy;
  mcp: MockosMcpOperation;
  http?: MockosHttpOperation;
};

export const defineMockosManagementOperation = <
  const Operation extends MockosManagementOperation,
>(
  operation: Operation
): Operation => operation;

export const mockosRouterPath = (path: `/${string}`): `/${string}` => {
  const routed = path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, ":$1");
  if (!routed.startsWith("/")) {
    throw new Error("A mockOS operation path must be origin-relative.");
  }
  return routed as `/${string}`;
};
