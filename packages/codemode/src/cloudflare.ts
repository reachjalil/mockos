import {
  openApiMcpServer,
  type OpenApiMcpServerOptions,
} from "@cloudflare/codemode/mcp";
import { requireMockosCodeModeEnabled } from "./index.js";

export type CreateMockosCodeModeServerOptions = OpenApiMcpServerOptions & {
  enabled?: boolean;
};

export const createMockosCodeModeServer = (
  options: CreateMockosCodeModeServerOptions
): ReturnType<typeof openApiMcpServer> => {
  const { enabled, ...upstreamOptions } = options;
  requireMockosCodeModeEnabled(enabled);
  return openApiMcpServer(upstreamOptions);
};
