import { describe, expect, it } from "vitest";
import { publicLocationForEnvironment } from "./public-location";

const environment = {
  id: "entra-subdomain-01",
  name: "Entra subdomain",
  provider: "entra" as const,
  seed: "entra-subdomain",
  tenantId: "0f6f4756-741d-4a4b-83b2-5f2e37ec621d",
  createdAt: "2026-07-22T12:00:00.000Z",
  idleTtlHours: 168,
  requestLogLimit: 10_000,
};

describe("management MCP public token location", () => {
  it("separates the Entra login issuer from the environment Graph host", () => {
    expect(
      publicLocationForEnvironment(environment, {
        HOSTING_MODE: "subdomain",
        PUBLIC_ORIGIN: "https://control.id.mockos.live",
        BASE_DOMAIN: "id.mockos.live",
        ENTRA_HOST: "login.id.mockos.live",
      })
    ).toEqual({
      publicBase: "https://login.id.mockos.live",
      directoryBaseUrl: "https://entra-subdomain-01.id.mockos.live",
      issuerBase:
        "https://login.id.mockos.live/0f6f4756-741d-4a4b-83b2-5f2e37ec621d/v2.0",
      graphBaseUrl: "https://entra-subdomain-01.id.mockos.live/graph/v1.0",
    });
  });
});
