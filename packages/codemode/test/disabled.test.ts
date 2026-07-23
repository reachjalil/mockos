import type { OpenApiMcpServerOptions } from "@cloudflare/codemode/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openApiMcpServer } = vi.hoisted(() => ({
  openApiMcpServer: vi.fn(),
}));

vi.mock("@cloudflare/codemode/mcp", () => ({ openApiMcpServer }));

import {
  MOCKOS_CODE_MODE_DEFAULT_ENABLED,
  MockosCodeModeDisabledError,
} from "../src/index";
import { createMockosCodeModeServer } from "../src/cloudflare";

const upstreamOptions = {
  spec: { openapi: "3.0.3", paths: {} },
  executor: {
    execute: vi.fn().mockResolvedValue({ result: null }),
  },
  request: vi.fn().mockResolvedValue({ ok: true }),
} satisfies OpenApiMcpServerOptions;

describe("Code Mode feature guard", () => {
  beforeEach(() => openApiMcpServer.mockReset());

  it("is disabled by default and never reaches the experimental factory", () => {
    expect(MOCKOS_CODE_MODE_DEFAULT_ENABLED).toBe(false);
    expect(() => createMockosCodeModeServer(upstreamOptions)).toThrow(
      MockosCodeModeDisabledError
    );
    expect(openApiMcpServer).not.toHaveBeenCalled();
  });

  it("requires literal explicit enablement before delegating", () => {
    const sentinel = { server: true };
    openApiMcpServer.mockReturnValue(sentinel);
    expect(createMockosCodeModeServer({ ...upstreamOptions, enabled: true })).toBe(
      sentinel
    );
    expect(openApiMcpServer).toHaveBeenCalledOnce();
  });
});
