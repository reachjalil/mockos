import { describe, expect, it } from "vitest";
import { routeEnvironmentRequest } from "@mockos/worker-kit/routing";

describe("@mockos/worker-kit routing entrypoint", () => {
  it("loads the environment router without evaluating Worker-only entrypoints", () => {
    expect(routeEnvironmentRequest).toBeTypeOf("function");
  });
});
