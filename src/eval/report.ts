import type { EvalCase } from "@/core/eval-fixture";
import type { Recording } from "./recording";
import {
  aggregate,
  missedTargets,
  scoreCase,
  TARGETS,
  type EvalMetrics,
} from "./score";

export interface ModelResult {
  recording: Recording;
  metrics: EvalMetrics;
  costUsdMicros: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  /** Fixture cases added after this recording was made. They are not scored. */
  notRecorded: number;
  /** Cost of 1,000 calls at this recording's average. */
  costPerThousandUsd: number;
  passed: boolean;
}

export function scoreRecording(
  cases: readonly EvalCase[],
  recording: Recording,
): ModelResult {
  // A live run records every case, failed calls included. A case missing from
  // a recording was added to the fixtures later, so it says nothing about the
  // model and is left out rather than counted as a miss.
  const byId = new Map(recording.cases.map((entry) => [entry.id, entry]));
  const recorded = cases.filter((testCase) => byId.has(testCase.id));
  const metrics = aggregate(
    recorded.map((testCase) =>
      scoreCase(testCase, byId.get(testCase.id)?.result ?? null),
    ),
  );
  let costUsdMicros = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let errors = 0;
  for (const entry of recording.cases) {
    costUsdMicros += entry.costUsdMicros;
    inputTokens += entry.inputTokens;
    outputTokens += entry.outputTokens;
    if (entry.error !== null) errors += 1;
  }
  const calls = Math.max(recording.cases.length, 1);
  return {
    recording,
    metrics,
    costUsdMicros,
    inputTokens,
    outputTokens,
    errors,
    notRecorded: cases.length - recorded.length,
    costPerThousandUsd: ((costUsdMicros / calls) * 1000) / 1_000_000,
    passed: errors === 0 && missedTargets(metrics).length === 0,
  };
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/** "6 of 24 (25.0%)". */
function share(part: number, whole: number): string {
  return `${part} of ${whole} (${percent(whole === 0 ? null : part / whole)})`;
}

function citiesStated(result: ModelResult): string {
  return share(
    result.metrics.returnedEventsWithCity,
    result.metrics.returnedEvents,
  );
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

/** Fixed-width table for the terminal. */
export function renderTable(results: readonly ModelResult[]): string {
  const rows = TARGETS.map((target) =>
    [
      target.label,
      `>= ${percent(target.target)}`,
      ...results.map((result) => {
        const value = result.metrics[target.key];
        return percent(typeof value === "number" ? value : null);
      }),
    ].join(" | "),
  );
  const header = ["Metric", "Target", ...results.map((r) => r.recording.model)];
  const footer = [
    [
      "Country coverage",
      "-",
      ...results.map((r) => percent(r.metrics.countryCoverage)),
    ],
    [
      "City coverage",
      "-",
      ...results.map((r) => percent(r.metrics.cityCoverage)),
    ],
    [
      "UK region coverage",
      "-",
      ...results.map((r) => percent(r.metrics.ukRegionCoverage)),
    ],
    ["Events with a city", "-", ...results.map(citiesStated)],
    ["Cases scored", "-", ...results.map((r) => String(r.metrics.cases))],
    ["Extra events", "-", ...results.map((r) => String(r.metrics.extraEvents))],
    ["Errors", "0", ...results.map((r) => String(r.errors))],
    ["Run cost", "< $1", ...results.map((r) => usd(r.costUsdMicros))],
    ["Passed", "-", ...results.map((r) => (r.passed ? "yes" : "NO"))],
  ].map((row) => row.join(" | "));
  return [header.join(" | "), ...rows, ...footer].join("\n");
}

function cheapestPassing(results: readonly ModelResult[]): ModelResult | null {
  const passing = results.filter((result) => result.passed);
  passing.sort((a, b) => a.costPerThousandUsd - b.costPerThousandUsd);
  return passing[0] ?? null;
}

/** The body of `docs/eval-results.md`. */
export function renderReport(
  cases: readonly EvalCase[],
  results: readonly ModelResult[],
): string {
  const relevant = cases.filter((c) => c.expected.isRelevant).length;
  const chosen = cheapestPassing(results);
  const first = results[0];
  const leadSupport = first?.metrics.leadSupport ?? 0;

  const header = `| Metric | Target | ${results.map((r) => `\`${r.recording.model}\``).join(" | ")} |`;
  const divider = `|---|---|${results.map(() => "---").join("|")}|`;
  const rows = TARGETS.map((target) => {
    const cells = results.map((r) => {
      const value = r.metrics[target.key];
      return percent(typeof value === "number" ? value : null);
    });
    return `| ${target.label} | ≥ ${percent(target.target)} | ${cells.join(" | ")} |`;
  });
  const extras = [
    [
      "Country coverage",
      (r: ModelResult) => percent(r.metrics.countryCoverage),
    ],
    ["City coverage", (r: ModelResult) => percent(r.metrics.cityCoverage)],
    [
      "UK region coverage",
      (r: ModelResult) => percent(r.metrics.ukRegionCoverage),
    ],
    ["Events with a city", citiesStated],
    ["Cases scored", (r: ModelResult) => String(r.metrics.cases)],
    [
      "Events not in the fixtures",
      (r: ModelResult) => String(r.metrics.extraEvents),
    ],
    ["Failed calls", (r: ModelResult) => String(r.errors)],
    ["Run cost", (r: ModelResult) => usd(r.costUsdMicros)],
    [
      "Cost per 1,000 items",
      (r: ModelResult) => `$${r.costPerThousandUsd.toFixed(3)}`,
    ],
    ["Met every target", (r: ModelResult) => (r.passed ? "yes" : "no")],
  ] as const;
  const extraRows = extras.map(
    ([label, cell]) => `| ${label} | | ${results.map(cell).join(" | ")} |`,
  );
  const partial = results.filter((r) => r.notRecorded > 0);
  const partialNote =
    partial.length === 0
      ? ""
      : `\nSome recordings predate the newest cases: ${partial.map((r) => `\`${r.recording.model}\` (${r.notRecorded} not recorded)`).join(", ")}. Those cases are left out of that model's scores, not counted as misses.\n`;

  return `# Extraction eval results

Generated by \`pnpm eval\` from the recordings in \`fixtures/extraction/recorded/\`. Recorded: ${results.map((r) => `\`${r.recording.model}\` (prompt ${r.recording.promptVersion}) on ${r.recording.recordedOn}`).join(", ")}.

**Set:** ${cases.length} cases (${relevant} relevant, ${cases.length - relevant} not), real headlines with summaries written in our own words, plus a few invented UK cases for city and region.
${partialNote}
${header}
${divider}
${rows.join("\n")}
${extraRows.join("\n")}

## Model choice

${chosen ? `\`${chosen.recording.model}\` is the cheapest model that met every target.` : "No model met every target."}

## How far to trust these numbers

- With ${cases.length} cases, one wrong answer moves a metric by several points. Treat small gaps between models as noise.
- Lead investor F1 rests on ${leadSupport} expected lead investors, which is too few to mean much.
- Summaries are paraphrased, so these scores are likely higher than on real feed text (D20).
- Country is scored only where the model states one, because the prompt tells it not to guess (D28). City and UK region follow the same rule, and are expected only where the headline or summary states them.
- UK region compares ITL1 regions. The lookup in \`src/eval/score.ts\` knows only the region words in the fixtures.
- "Events with a city" counts every event the model returned. The Phase 1 recording of \`gpt-5.6-luna\` gave a city for 6 of 24 (A28).
- Recordings made with prompt v1 have no regionText, so UK region shows n/a for them.
- This eval covers extraction only. See \`pnpm eval --resolution\` for merging.
`;
}
