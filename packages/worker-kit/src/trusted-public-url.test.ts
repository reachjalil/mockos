import { describe, expect, it } from "vitest";
import { trustedPublicUrl } from "./trusted-public-url";

describe("trustedPublicUrl", () => {
  it.each([
    "https://mockos.example/environment",
    "http://localhost:8787/environment",
    "http://127.0.0.1:8787/environment",
    "http://127.42.19.7:8787/environment",
    "http://[::1]:8787/environment",
  ])("allows HTTPS or loopback HTTP: %s", (value) => {
    expect(trustedPublicUrl(value, "Public URL")).toBe(value);
  });

  it.each([
    "http://mockos.example/environment",
    "ftp://localhost/environment",
    "ws://127.0.0.1/environment",
    "file:///environment",
  ])("rejects an untrusted transport: %s", (value) => {
    expect(() => trustedPublicUrl(value, "Public URL")).toThrow(
      "trusted HTTPS or loopback URL"
    );
  });

  it("preserves protocol, path, and metadata constraints", () => {
    expect(() =>
      trustedPublicUrl("http://127.42.19.7/graph/v1.0", "Graph base", {
        protocol: "https:",
      })
    ).toThrow("trusted HTTPS or loopback URL");
    expect(() =>
      trustedPublicUrl("https://mockos.example/not-graph", "Graph base", {
        pathSuffix: "/graph/v1.0",
      })
    ).toThrow("must end in /graph/v1.0");
    expect(() =>
      trustedPublicUrl("https://user@mockos.example/graph/v1.0", "Graph base")
    ).toThrow("trusted HTTPS or loopback URL");
  });
});
