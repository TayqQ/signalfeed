import { describe, expect, it } from "vitest";
import { runResolutionEval } from "./resolution";

// Floors, not targets: they stop a change making merging worse without anyone
// noticing. Raise them when the resolver improves. Never lower them to pass.
describe("resolution eval", () => {
  it("keeps precision and recall on the hand-written set", async () => {
    const result = await runResolutionEval();
    expect(result.company.precision).toBeGreaterThanOrEqual(
      FLOOR.companyPrecision,
    );
    expect(result.company.recall).toBeGreaterThanOrEqual(FLOOR.companyRecall);
    expect(result.event.precision).toBeGreaterThanOrEqual(FLOOR.eventPrecision);
    expect(result.event.recall).toBeGreaterThanOrEqual(FLOOR.eventRecall);
  }, 60_000);
});

const FLOOR = {
  companyPrecision: 0.9,
  companyRecall: 0.9,
  eventPrecision: 0.9,
  eventRecall: 0.9,
};
