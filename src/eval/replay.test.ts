import { describe, expect, it } from "vitest";
import { loadCases, loadRecordings } from "./recording";
import { scoreRecording } from "./report";
import { missedTargets } from "./score";

const recordings = loadRecordings();
const defaultModel = process.env.EXTRACTION_MODEL ?? "gpt-5.6-luna";

describe("recorded extraction runs", () => {
  it.skipIf(recordings.length === 0)(
    "keep scoring every recording without errors",
    () => {
      const cases = loadCases();
      for (const recording of recordings) {
        const { metrics } = scoreRecording(cases, recording);
        expect(metrics.cases).toBe(cases.length);
      }
    },
  );

  const recorded = recordings.find((r) => r.model === defaultModel);
  it.skipIf(!recorded)("the default model meets every target", () => {
    if (!recorded) return;
    const { metrics } = scoreRecording(loadCases(), recorded);
    expect(missedTargets(metrics)).toEqual([]);
  });
});
