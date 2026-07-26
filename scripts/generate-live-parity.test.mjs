import assert from "node:assert/strict";
import { test } from "node:test";
import { isStale, render, validate } from "./generate-live-parity.mjs";

const caseEntry = (overrides = {}) => ({
  id: "okta-discovery",
  provider: "okta",
  tier: "a",
  area: "OIDC metadata",
  capability: "Discovery document fields",
  enforcement: "advisory",
  status: "not-captured",
  capturedAt: null,
  ...overrides,
});

const manifestWith = (cases) => ({
  schemaVersion: 1,
  title: "t",
  status: "s",
  lastReviewed: "2026-07-26",
  cases,
  outOfScope: ["SAML"],
});

const ledgerWith = (entries) => ({
  schemaVersion: 1,
  title: "t",
  status: "s",
  lastReviewed: "2026-07-26",
  entries,
});

const ledgerEntry = (overrides = {}) => ({
  id: "D-01",
  provider: "okta",
  caseId: "*",
  field: "responseBody.x",
  intentional: true,
  reason: "Deliberate.",
  owner: "identity",
  openedAt: "2026-07-26",
  ...overrides,
});

test("accepts the checked-in manifest and ledger shape", () => {
  assert.doesNotThrow(() =>
    validate(manifestWith([caseEntry()]), ledgerWith([ledgerEntry()]))
  );
});

test("refuses a not-captured case that claims a capture date", () => {
  assert.throws(
    () =>
      validate(
        manifestWith([caseEntry({ status: "not-captured", capturedAt: "2026-07-26" })]),
        ledgerWith([])
      ),
    /not-captured but carries a capturedAt/
  );
});

test("requires a capture date for any case claiming a real verdict", () => {
  for (const status of ["match", "known-divergence", "defect"]) {
    assert.throws(
      () =>
        validate(
          manifestWith([caseEntry({ status, capturedAt: null })]),
          ledgerWith([])
        ),
      /requires a capturedAt date/,
      `status ${status} must require a capture date`
    );
  }
});

test("rejects an unknown verdict, tier, or enforcement value", () => {
  assert.throws(
    () => validate(manifestWith([caseEntry({ status: "passed" })]), ledgerWith([])),
    /is not a known verdict/
  );
  assert.throws(
    () => validate(manifestWith([caseEntry({ tier: "c" })]), ledgerWith([])),
    /tier must be/
  );
  assert.throws(
    () =>
      validate(manifestWith([caseEntry({ enforcement: "blocking" })]), ledgerWith([])),
    /enforcement must be/
  );
});

test("rejects duplicate case ids and duplicate ledger ids", () => {
  assert.throws(
    () => validate(manifestWith([caseEntry(), caseEntry()]), ledgerWith([])),
    /is duplicated/
  );
  assert.throws(
    () =>
      validate(
        manifestWith([caseEntry()]),
        ledgerWith([ledgerEntry(), ledgerEntry({ field: "other" })])
      ),
    /ids must be unique/
  );
});

test("rejects a ledger entry pointing at an unknown case", () => {
  assert.throws(
    () =>
      validate(
        manifestWith([caseEntry()]),
        ledgerWith([ledgerEntry({ caseId: "does-not-exist" })])
      ),
    /is not a known case id/
  );
});

test("requires every ledger entry to explain itself", () => {
  assert.throws(
    () =>
      validate(
        manifestWith([caseEntry()]),
        ledgerWith([ledgerEntry({ reason: "  " })])
      ),
    /must explain the divergence/
  );
});

test("never counts a not-captured case as compared", () => {
  const report = render(
    manifestWith([caseEntry(), caseEntry({ id: "okta-jwks" })]),
    ledgerWith([]),
    Date.parse("2026-07-26T00:00:00Z")
  );
  assert.match(report, /Cases defined: \*\*2\*\*/);
  assert.match(report, /Compared against a real tenant: \*\*0\*\*/);
  assert.match(report, /Not yet captured: \*\*2\*\*/);
});

test("marks a capture older than ninety days as stale", () => {
  const now = Date.parse("2026-07-26T00:00:00Z");
  assert.equal(isStale("2026-07-01", now), false);
  assert.equal(isStale("2026-01-01", now), true);
  const report = render(
    manifestWith([caseEntry({ status: "match", capturedAt: "2026-01-01" })]),
    ledgerWith([]),
    now
  );
  assert.match(report, /2026-01-01 \(stale\)/);
});

test("separates intentional divergences from tracked defects in the summary", () => {
  const report = render(
    manifestWith([caseEntry()]),
    ledgerWith([
      ledgerEntry({ id: "D-01", intentional: true }),
      ledgerEntry({ id: "D-25", intentional: false, field: "responseBody.y" }),
    ]),
    Date.parse("2026-07-26T00:00:00Z")
  );
  assert.match(report, /1 intentional, 1 tracked defects/);
});
