import { describe, expect, it } from "vitest";
import { compareCase, type DivergenceLedgerEntry } from "./compare.js";
import {
  createObservingFetch,
  createParitySink,
  type ParityObservation,
} from "./observation.js";

/**
 * Mock-versus-mock self-test.
 *
 * Runs the whole parity pipeline — observe, normalise, diff, classify — with
 * mockOS-shaped responses on *both* sides. It needs no tenant, no credential,
 * and no network, and it must report a clean match.
 *
 * If this is green, the machine is correct and the only missing ingredient for
 * real evidence is a token. If it goes red, the harness is broken and every
 * live verdict it produces would be untrustworthy.
 */

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** Two targets issue different signatures, key ids, and claim values. */
const token = (tenant: string, issuedAt: number) =>
  `${base64Url({ alg: "RS256", kid: `key-${issuedAt}` })}.${base64Url({
    aud: "client-1",
    iss: `https://login.example/${tenant}/v2.0`,
    sub: "user-1",
    tid: tenant,
    iat: issuedAt,
    exp: issuedAt + 3600,
    jti: `jti-${issuedAt}`,
  })}.${base64Url({ sig: issuedAt })}`;

/** A provider double whose volatile values differ per target, as real ones do. */
const provider =
  (tenant: string, issuedAt: number) =>
  async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return Response.json(
        {
          issuer: `https://login.example/${tenant}/v2.0`,
          token_endpoint: `https://login.example/${tenant}/oauth2/v2.0/token`,
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
        },
        { headers: { "cache-control": "no-store" } }
      );
    }
    return Response.json(
      {
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile",
        access_token: token(tenant, issuedAt),
        refresh_token: `refresh-${issuedAt}`,
      },
      { headers: { "cache-control": "no-store" } }
    );
  };

const runScenario = async (tenant: string, issuedAt: number) => {
  const sink = createParitySink();
  const observing = createObservingFetch(sink, provider(tenant, issuedAt));
  await observing(
    `https://login.example/${tenant}/v2.0/.well-known/openid-configuration`
  );
  await observing(`https://login.example/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=authorization_code&code=abc",
  });
  return sink.observations as readonly ParityObservation[];
};

describe("parity self-test (mock versus mock)", () => {
  it("reports a clean match across two targets with different volatile values", async () => {
    const left = await runScenario("tenant-left", 1_700_000_000);
    const right = await runScenario("tenant-right", 1_800_000_000);

    const result = compareCase({
      caseId: "entra-discovery",
      provider: "entra",
      live: left,
      mock: right,
      ledger: [],
      liveNormalize: { literals: { "tenant-left": "{tenant}" } },
      mockNormalize: { literals: { "tenant-right": "{tenant}" } },
    });

    expect(result.differences).toEqual([]);
    expect(result.verdict).toBe("match");
  });

  it("catches a genuine behavioural difference through the same pipeline", async () => {
    const left = await runScenario("tenant-left", 1_700_000_000);
    const right = await runScenario("tenant-right", 1_800_000_000);
    // One target drops a scope: a real parity failure, not a volatile value.
    const mutated = right.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            responseBody: {
              ...(entry.responseBody as Record<string, unknown>),
              scope: "openid",
            },
          }
        : entry
    );

    const result = compareCase({
      caseId: "entra-token",
      provider: "entra",
      live: left,
      mock: mutated,
      ledger: [],
      liveNormalize: { literals: { "tenant-left": "{tenant}" } },
      mockNormalize: { literals: { "tenant-right": "{tenant}" } },
    });

    expect(result.verdict).toBe("defect");
    expect(result.differences).toEqual([
      {
        path: "sequence[1].responseBody.scope",
        live: "openid profile",
        mock: "openid",
        ledgerId: null,
        intentional: false,
      },
    ]);
  });

  it("downgrades that same difference to a known divergence once ledgered", async () => {
    const left = await runScenario("tenant-left", 1_700_000_000);
    const right = await runScenario("tenant-right", 1_800_000_000);
    const mutated = right.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            responseBody: {
              ...(entry.responseBody as Record<string, unknown>),
              scope: "openid",
            },
          }
        : entry
    );
    const ledger: DivergenceLedgerEntry[] = [
      {
        id: "D-TEST",
        provider: "entra",
        caseId: "entra-token",
        field: "responseBody.scope",
        intentional: true,
        reason: "mockOS echoes the requested scope verbatim.",
        owner: "identity",
        openedAt: "2026-07-26",
      },
    ];

    const result = compareCase({
      caseId: "entra-token",
      provider: "entra",
      live: left,
      mock: mutated,
      ledger,
      liveNormalize: { literals: { "tenant-left": "{tenant}" } },
      mockNormalize: { literals: { "tenant-right": "{tenant}" } },
    });

    expect(result.verdict).toBe("known-divergence");
    expect(result.differences[0]?.ledgerId).toBe("D-TEST");
  });
});
