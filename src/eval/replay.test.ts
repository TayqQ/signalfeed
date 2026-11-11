import { describe, expect, it } from "vitest";
import { loadCases, loadRecordings } from "./recording";
import { renderReport, scoreRecording } from "./report";
import { missedTargets } from "./score";

const recordings = loadRecordings();
const defaultModel = process.env.EXTRACTION_MODEL ?? "gpt-5.6-luna";

describe("recorded extraction runs", () => {
  it.skipIf(recordings.length === 0)(
    "keep scoring every recording without errors",
    () => {
      const cases = loadCases();
      const ids = new Set(cases.map((c) => c.id));
      for (const recording of recordings) {
        const result = scoreRecording(cases, recording);
        const recorded = recording.cases.filter((c) => ids.has(c.id)).length;
        expect(result.metrics.cases).toBe(recorded);
        expect(result.notRecorded).toBe(cases.length - recorded);
      }
    },
  );

  it.skipIf(recordings.length === 0)(
    "read every recording as V2, with null regions from prompt v1",
    () => {
      for (const recording of recordings) {
        for (const entry of recording.cases) {
          for (const event of entry.result?.events ?? []) {
            expect(event.company).toHaveProperty("regionText");
            if (recording.promptVersion === "v1") {
              expect(event.company.regionText).toBeNull();
            }
          }
        }
      }
    },
  );

  it.skipIf(recordings.length === 0)(
    "report city and UK region in the rendered results",
    () => {
      const cases = loadCases();
      const body = renderReport(
        cases,
        recordings.map((recording) => scoreRecording(cases, recording)),
      );
      expect(body).toContain("| City, when stated | ≥ 90.0% |");
      expect(body).toContain("| UK region, when stated | ≥ 90.0% |");
      expect(body).toContain("| City coverage |");
      expect(body).toContain("| UK region coverage |");
      expect(body).toContain("| Events with a city |");
    },
  );

  const recorded = recordings.find((r) => r.model === defaultModel);
  it.skipIf(!recorded)("the default model meets every target", () => {
    if (!recorded) return;
    const { metrics } = scoreRecording(loadCases(), recorded);
    expect(missedTargets(metrics)).toEqual([]);
  });
});
