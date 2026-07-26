import { describe, expect, it } from "vitest";
import {
  inspectMockMcpResourceTemplateMatch,
  matchMockMcpResourceTemplate,
} from "./resource-template";

describe("Level-1 resource-template matching", () => {
  it("matches exact literals, percent-decodes values, and rejects raw reserved data", () => {
    const template = "mockos://literal.+/{id}/profile?fixed=true";

    expect(
      matchMockMcpResourceTemplate(
        template,
        "mockos://literal.+/ada%2Flovelace/profile?fixed=true"
      )
    ).toEqual({ id: "ada/lovelace" });
    expect(
      matchMockMcpResourceTemplate(
        template,
        "mockos://literalX+/ada%2Flovelace/profile?fixed=true"
      )
    ).toBeUndefined();
    expect(
      matchMockMcpResourceTemplate(
        template,
        "mockos://literal.+/ada/lovelace/profile?fixed=true"
      )
    ).toBeUndefined();
    expect(
      matchMockMcpResourceTemplate("mockos://literal.+/{id}", "mockos://literal.+/%ZZ")
    ).toBeUndefined();
  });

  it("supports empty simple expansions and deterministic adjacent captures", () => {
    expect(
      matchMockMcpResourceTemplate("mockos://users/{id}", "mockos://users/")
    ).toEqual({ id: "" });
    expect(
      matchMockMcpResourceTemplate(
        "mockos://adjacent/{first}{second}/tail",
        "mockos://adjacent//tail"
      )
    ).toEqual({ first: "", second: "" });
    expect(
      matchMockMcpResourceTemplate(
        "mockos://adjacent/{first}{second}/tail",
        "mockos://adjacent/value/tail"
      )
    ).toEqual({ first: "", second: "value" });
  });

  it("bounds adversarial adjacent-variable near misses with linear work", () => {
    const variables = Array.from({ length: 20 }, (_, index) => `v${index}`);
    const template = `mockos://linear/${variables
      .map((variable) => `{${variable}}`)
      .join("")}/expected`;
    const encodedValue = "a".repeat(900);
    const nearMiss = `mockos://linear/${encodedValue}/expecteX`;
    const inspection = inspectMockMcpResourceTemplateMatch(template, nearMiss);

    expect(nearMiss.length).toBeLessThanOrEqual(1_024);
    expect(inspection.values).toBeUndefined();
    expect(inspection.operations).toBeLessThan(75_000);

    const matched = inspectMockMcpResourceTemplateMatch(
      template,
      "mockos://linear/alpha%2Fbeta/expected"
    );
    expect(matched.values).toEqual(
      Object.fromEntries([
        ...variables.slice(0, -1).map((variable) => [variable, ""]),
        [variables.at(-1), "alpha/beta"],
      ])
    );
  });
});
