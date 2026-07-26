import { entraProfile, oktaProfile } from "@mockos/core";
import { describe, expect, it } from "vitest";
import { buildWellKnownUrls } from "./well-known-urls";

const tenantId = "0f6f4756-741d-4a4b-83b2-5f2e37ec621d";

describe("provider well-known URL projection", () => {
  it("omits UserInfo when the provider does not export that route", () => {
    const entra = buildWellKnownUrls(entraProfile, tenantId, {
      directoryBaseUrl: "https://entra.example/e/test",
      graphBaseUrl: "https://entra.example/e/test/graph/v1.0",
      issuerBase: `https://login.example/${tenantId}/v2.0`,
    });
    const okta = buildWellKnownUrls(oktaProfile, tenantId, {
      directoryBaseUrl: "https://okta.example/e/test",
      issuerBase: "https://okta.example/e/test/oauth2/default",
    });

    expect(entra).not.toHaveProperty("userinfoEndpoint");
    expect(okta).not.toHaveProperty("userinfoEndpoint");
  });

  it("includes UserInfo only when a provider exports the route", () => {
    const provider = {
      ...oktaProfile,
      urls: {
        ...oktaProfile.urls,
        userInfo: () => "https://okta.example/e/test/oauth2/default/v1/userinfo",
      },
    };

    expect(
      buildWellKnownUrls(provider, tenantId, {
        directoryBaseUrl: "https://okta.example/e/test",
        issuerBase: "https://okta.example/e/test/oauth2/default",
      })
    ).toHaveProperty(
      "userinfoEndpoint",
      "https://okta.example/e/test/oauth2/default/v1/userinfo"
    );
  });
});
