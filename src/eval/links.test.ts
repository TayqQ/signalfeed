import { describe, expect, it } from "vitest";
import { loadLinkCases, runLinkEval } from "./links";

// Targets from spec-phase3 section 12. Never relabel a case to pass: change a
// rule, and say why in docs/link-eval-results.md.
describe("link eval", () => {
  const result = runLinkEval();

  it("makes no wrong automatic link", () => {
    expect(result.wrong.map((r) => r.id)).toEqual([]);
    expect(result.total.precision).toBe(1);
  });

  it("keeps auto-link recall at 50% or more", () => {
    expect(result.total.recall).toBeGreaterThanOrEqual(0.5);
  });

  it("decides the same when filings are fetched only on demand", () => {
    expect(result.fetchMismatches.map((r) => r.id)).toEqual([]);
  });

  it("covers the hard cases the task asks for", () => {
    const cases = loadLinkCases();
    const tags = new Set(cases.flatMap((c) => c.tags));
    for (const tag of [
      "worked-example",
      "short-name",
      "trading-name",
      "holdings",
      "dormant",
      "dissolved-namesake",
      "re-registered",
      "too-young",
      "founded-year",
      "shared-address",
      "taken",
      "previous-name",
      "scottish",
      "northern-irish",
      "punctuation",
      "ltd-limited",
      "same-name-different-company",
      "form-d",
      "country-hint",
    ]) {
      expect(tags, tag).toContain(tag);
    }
    expect(cases.length).toBeGreaterThanOrEqual(55);
    expect(
      cases.filter((c) => c.kind === "sec_form_d").length,
    ).toBeGreaterThanOrEqual(10);
  });
});
