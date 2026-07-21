/**
 * M2 owns the concrete tool registration. This deliberately handler-agnostic
 * boundary exists in M0 so private control-plane code can only depend inward.
 */
export type MockosToolDependencies = {
  accountId: string;
  listEnvironments(): Promise<Array<{ id: string; name: string }>>;
};

export const MCP_IMPLEMENTATION_MILESTONE = "M2" as const;
