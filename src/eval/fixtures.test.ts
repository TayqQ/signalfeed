import { describe, expect, it } from "vitest";
import cases from "../../fixtures/extraction/cases.json";
import { EVAL_CASES_SCHEMA } from "@/core/eval-fixture";

describe("extraction fixtures", () => {
  const parsed = EVAL_CASES_SCHEMA.parse(cases);

  it("has at least 25 cases", () => {
    expect(parsed.length).toBeGreaterThanOrEqual(25);
  });

  it("has at least 4 irrelevant cases", () => {
    const irrelevant = parsed.filter((c) => !c.expected.isRelevant);
    expect(irrelevant.length).toBeGreaterThanOrEqual(4);
  });

  it("has at least 3 acquisition cases", () => {
    const acquisitions = parsed.filter(
      (c) =>
        c.expected.isRelevant &&
        c.expected.events.some((e) => e.type === "acquisition"),
    );
    expect(acquisitions.length).toBeGreaterThanOrEqual(3);
  });
});
