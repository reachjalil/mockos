import { describe, expect, it } from "vitest";
import {
  classifyDifferences,
  compareCase,
  diffSequences,
  diffValues,
  type DivergenceLedgerEntry,
  verdictFor,
} from "./compare.js";
import { decodeJwtForComparison, normalizeObservation, VOLATILE } from "./normalize.js";
import {
  createObservingFetch,
  createParitySink,
  type ParityObservation,
  parseBody,
} from "./observation.js";

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const jwt = (payload: unknown, header: unknown = { alg: "RS256", kid: "k1" }) =>
  `${base64Url(header)}.${base64Url(payload)}.c2lnbmF0dXJl`;

const observation = (
  overrides: Partial<ParityObservation> = {}
): ParityObservation => ({
  method: "POST",
  path: "/oauth2/v2.0/token",
  query: {},
  requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
  requestBody: null,
  status: 200,
  responseHeaders: { "content-type": "application/json" },
  responseBody: {},
  ...overrides,
});

describe("parity observation", () => {
  it("parses form and JSON bodies into comparable structures", () => {
    expect(parseBody("application/x-www-form-urlencoded", "b=2&a=1&a=3")).toEqual({
      a: ["1", "3"],
      b: ["2"],
    });
    expect(parseBody("application/json; charset=utf-8", '{"a":1}')).toEqual({ a: 1 });
    expect(parseBody("application/problem+json", '{"a":1}')).toEqual({ a: 1 });
    expect(parseBody("text/html", "<html>")).toBe("<html>");
    expect(parseBody("application/json", "")).toBeNull();
  });

  it("keeps a malformed JSON body visible instead of comparing it as an object", () => {
    expect(parseBody("application/json", "{oops")).toEqual({
      __unparseableJson: "{oops",
    });
  });

  it("records an exchange without consuming the caller's body", async () => {
    const sink = createParitySink();
    const observing = createObservingFetch(sink, async (request) => {
      // The SDK under test must still be able to read the request body.
      await (request as Request).text();
      return new Response('{"ok":true}', {
        status: 201,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    });

    const response = await observing("https://tenant.example/token?b=2&a=1", {
      method: "POST",
      body: "grant_type=refresh_token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(sink.observations).toHaveLength(1);
    expect(sink.observations[0]).toMatchObject({
      method: "POST",
      path: "/token",
      query: { a: ["1"], b: ["2"] },
      requestBody: { grant_type: ["refresh_token"] },
      status: 201,
      responseHeaders: { "cache-control": "no-store" },
      responseBody: { ok: true },
    });
  });

  it("keeps only headers that carry comparable protocol meaning", async () => {
    const sink = createParitySink();
    const observing = createObservingFetch(
      sink,
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://app.example/cb?code=abc",
            "x-ms-request-id": "trace-1",
            "set-cookie": "session=secret",
          },
        })
    );
    await observing("https://tenant.example/authorize");

    const headers = sink.observations[0]?.responseHeaders ?? {};
    expect(headers).toHaveProperty("location");
    expect(headers).not.toHaveProperty("x-ms-request-id");
    expect(headers).not.toHaveProperty("set-cookie");
  });
});

describe("parity normalisation", () => {
  it("replaces volatile claims rather than deleting them", () => {
    const normalized = normalizeObservation(
      observation({ responseBody: { iat: 1, exp: 2, scope: "openid" } })
    );
    expect(normalized.responseBody).toEqual({
      exp: VOLATILE,
      iat: VOLATILE,
      scope: "openid",
    });
  });

  it("substitutes known literals everywhere they appear, longest first", () => {
    const normalized = normalizeObservation(
      observation({
        path: "/tenant-abc/oauth2/v2.0/token",
        responseBody: { iss: "https://login.example/tenant-abc/v2.0" },
      }),
      { literals: { "tenant-abc": "{tenant}" } }
    );
    expect(normalized.path).toBe("/{tenant}/oauth2/v2.0/token");
    expect(normalized.responseBody).toEqual({
      iss: "https://login.example/{tenant}/v2.0",
    });
  });

  it("decodes JWTs so claim sets compare instead of opaque strings", () => {
    const normalized = normalizeObservation(
      observation({
        responseBody: {
          access_token: jwt({ aud: "client-1", scp: "openid", iat: 111 }),
          refresh_token: "opaque-value",
        },
      })
    );
    expect(normalized.responseBody).toEqual({
      access_token: {
        __jwt: {
          header: { alg: "RS256", kid: VOLATILE },
          payload: { aud: "client-1", iat: VOLATILE, scp: "openid" },
        },
      },
      refresh_token: VOLATILE,
    });
  });

  it("treats a non-JWT in a token field as a difference, not a claim set", () => {
    const normalized = normalizeObservation(
      observation({ responseBody: { id_token: "not-a-jwt" } })
    );
    expect(normalized.responseBody).toEqual({ id_token: VOLATILE });
    expect(decodeJwtForComparison("not-a-jwt")).toBeNull();
  });
});

describe("parity comparison", () => {
  it("reports leaf differences with dotted paths", () => {
    expect(diffValues({ a: { b: 1 }, c: 2 }, { a: { b: 9 }, c: 2 })).toEqual([
      { path: "a.b", live: 1, mock: 9 },
    ]);
  });

  it("reports a missing key rather than ignoring it", () => {
    expect(diffValues({ a: 1 }, {})).toEqual([{ path: "a", live: 1, mock: undefined }]);
  });

  it("flags an extra or missing provider call", () => {
    const differences = diffSequences([observation()], []);
    expect(differences).toContainEqual({ path: "sequence.length", live: 1, mock: 0 });
  });

  it("classifies an unexplained difference as a defect", () => {
    const result = compareCase({
      caseId: "entra-token-error",
      provider: "entra",
      live: [observation({ responseBody: { error: "invalid_grant" } })],
      mock: [observation({ responseBody: { error: "invalid_client" } })],
      ledger: [],
    });
    expect(result.verdict).toBe("defect");
    expect(result.differences[0]).toMatchObject({
      path: "sequence[0].responseBody.error",
      ledgerId: null,
    });
  });

  it("classifies a ledgered intentional difference as a known divergence", () => {
    const ledger: DivergenceLedgerEntry[] = [
      {
        id: "D-30",
        provider: "okta",
        caseId: "*",
        field: "responseBody.access_token.__jwt.payload.aud",
        intentional: true,
        reason: "mockOS uses client_id as the access-token audience.",
        owner: "identity",
        openedAt: "2026-07-26",
      },
    ];
    const result = compareCase({
      caseId: "okta-token",
      provider: "okta",
      live: [
        observation({ responseBody: { access_token: jwt({ aud: "api://default" }) } }),
      ],
      mock: [observation({ responseBody: { access_token: jwt({ aud: "client-1" }) } })],
      ledger,
    });
    expect(result.verdict).toBe("known-divergence");
    expect(result.differences[0]?.ledgerId).toBe("D-30");
  });

  it("does not let one provider's ledger entry excuse another provider", () => {
    const ledger: DivergenceLedgerEntry[] = [
      {
        id: "D-30",
        provider: "okta",
        caseId: "*",
        field: "*",
        intentional: true,
        reason: "Okta only.",
        owner: "identity",
        openedAt: "2026-07-26",
      },
    ];
    const result = compareCase({
      caseId: "entra-token",
      provider: "entra",
      live: [observation({ status: 400 })],
      mock: [observation({ status: 200 })],
      ledger,
    });
    expect(result.verdict).toBe("defect");
  });

  it("treats a ledger entry that admits a defect as a defect", () => {
    const classified = classifyDifferences(
      "entra-error",
      "entra",
      [{ path: "sequence[0].responseBody.error_codes[0]", live: 70000, mock: 54005 }],
      [
        {
          id: "D-25",
          provider: "entra",
          caseId: "*",
          field: "responseBody.error_codes*",
          intentional: false,
          reason: "Two conflicting Entra error catalogs; unresolved.",
          owner: "identity",
          openedAt: "2026-07-26",
        },
      ]
    );
    expect(classified[0]?.ledgerId).toBe("D-25");
    expect(verdictFor(classified)).toBe("defect");
  });

  it("matches identical sequences", () => {
    const result = compareCase({
      caseId: "entra-discovery",
      provider: "entra",
      live: [observation()],
      mock: [observation()],
      ledger: [],
    });
    expect(result.verdict).toBe("match");
    expect(result.differences).toEqual([]);
  });
});
