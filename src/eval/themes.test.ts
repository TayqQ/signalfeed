import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "@/core/errors";
import type { BudgetGuard, LlmClient, LlmCompleteRequest } from "@/core/ports";
import {
  TAG_EMBEDDING_TEMPLATE,
  tagEmbeddingInput,
} from "@/pipeline/embed/embed-tags";
import { createFakeEmbeddingClient } from "@/pipeline/embed/testing";
import { themeCheckPromptVersion } from "@/pipeline/themes/theme-check";
import {
  bandQuestionKey,
  DEFAULT_THEME_BANDS,
  DEFAULT_THEME_THRESHOLD,
} from "@/pipeline/themes/cluster";
import {
  type BandRow,
  chooseBands,
  chooseThreshold,
  costPerQuestion,
  costPerRun,
  emptyThemeCheckRecording,
  loadThemeCheckRecording,
  recordThemeChecks,
  sweepBands,
  themeBandGrid,
  THEME_BAND_GRID,
  THEME_PRECISION_TARGET,
  themeCheckRecordingPath,
  type LabelledTag,
  LABELLED_TAGS_SCHEMA,
  loadLabelledTags,
  loadThemeRecording,
  recordThemeEmbeddings,
  renderThemeReport,
  round4,
  scoreThemes,
  sweep,
  THEME_F1_TARGET,
  THEME_RECORDING_PATH,
  THEME_THRESHOLDS,
  type SweepRow,
} from "./themes";

const expected = { a1: "a", a2: "a", a3: "a", b1: "b", b2: "b" };

describe("scoreThemes", () => {
  it("scores a perfect assignment 1", () => {
    const score = scoreThemes(expected, {
      a1: 0,
      a2: 0,
      a3: 0,
      b1: 1,
      b2: 1,
    });
    expect(score.f1).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.themes).toBe(2);
  });

  it("gives precision equal to the share of same-group pairs when all tags share a theme", () => {
    const score = scoreThemes(expected, {
      a1: "x",
      a2: "x",
      a3: "x",
      b1: "x",
      b2: "x",
    });
    // 3 + 1 same-group pairs out of 10 pairs.
    expect(score.precision).toBeCloseTo(4 / 10);
    expect(score.recall).toBe(1);
    expect(score.themes).toBe(1);
    expect(score.falsePositives).toBe(6);
  });

  it("gives recall 0 when every tag is alone", () => {
    const score = scoreThemes(expected, {
      a1: 1,
      a2: 2,
      a3: 3,
      b1: 4,
      b2: 5,
    });
    expect(score.recall).toBe(0);
    expect(score.f1).toBe(0);
    expect(score.themes).toBe(5);
    expect(score.falseNegatives).toBe(4);
  });

  it("counts a split group as missed pairs only", () => {
    const score = scoreThemes(expected, {
      a1: 0,
      a2: 0,
      a3: 9,
      b1: 1,
      b2: 1,
    });
    expect(score.precision).toBe(1);
    expect(score.recall).toBeCloseTo(2 / 4);
  });
});

describe("sweep and chooseThreshold", () => {
  // Two close tags in group g1, one far tag in g2.
  const tags: LabelledTag[] = [
    { tag: "one", group: "g1", mentions: 5 },
    { tag: "uno", group: "g1", mentions: 4 },
    { tag: "other", group: "g2", mentions: 3 },
  ];
  const embeddings = {
    one: [1, 0],
    uno: [0.9, 0.436],
    other: [0, 1],
  };

  it("merges the close pair only below their similarity", () => {
    const rows = sweep(tags, embeddings, [0.5, 0.95]);
    expect(rows[0]).toMatchObject({ threshold: 0.5, themes: 2, f1: 1 });
    expect(rows[1]).toMatchObject({ threshold: 0.95, themes: 3, recall: 0 });
  });

  it("throws when an embedding is missing", () => {
    expect(() => sweep(tags, { one: [1, 0] })).toThrow(/uno/);
  });

  it("covers 0.60 to 0.90 in steps of 0.02", () => {
    expect(THEME_THRESHOLDS).toEqual([
      0.6, 0.62, 0.64, 0.66, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84,
      0.86, 0.88, 0.9,
    ]);
    expect(THEME_THRESHOLDS).toContain(DEFAULT_THEME_THRESHOLD);
  });

  it("prefers the higher threshold on a near tie", () => {
    const base = {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      themes: 1,
    };
    const rows: SweepRow[] = [
      { ...base, threshold: 0.5, f1: 0.8 },
      { ...base, threshold: 0.6, f1: 0.795 },
      { ...base, threshold: 0.7, f1: 0.7 },
    ];
    expect(chooseThreshold(rows).threshold).toBe(0.6);
    expect(chooseThreshold(rows, 0).threshold).toBe(0.5);
  });
});

describe("labelled fixture", () => {
  const tags = loadLabelledTags();
  const groupOf = new Map(tags.map((entry) => [entry.tag, entry.group]));

  it("has about 200 tags in market-sized groups", () => {
    const groups = new Set(tags.map((entry) => entry.group));
    expect(tags.length).toBeGreaterThanOrEqual(180);
    expect(tags.length).toBeLessThanOrEqual(240);
    expect(groups.size).toBeGreaterThanOrEqual(60);
    expect(groups.size).toBeLessThanOrEqual(100);
  });

  it("keeps tags lowercase, unique and trimmed", () => {
    for (const { tag } of tags) {
      expect(tag).toBe(tag.toLowerCase().trim());
    }
    expect(new Set(tags.map((entry) => entry.tag)).size).toBe(tags.length);
  });

  it("puts most tags in groups of two or more", () => {
    // A group of one tests that a tag stays apart (README).
    const sizes = new Map<string, number>();
    for (const { group } of tags) sizes.set(group, (sizes.get(group) ?? 0) + 1);
    const grouped = tags.filter(({ group }) => sizes.get(group)! >= 2);
    expect(grouped.length / tags.length).toBeGreaterThanOrEqual(0.75);
    expect(
      [...sizes.values()].filter((size) => size >= 2).length,
    ).toBeGreaterThanOrEqual(40);
  });

  it("holds the tricky pairs the spec names", () => {
    expect(groupOf.get("ai agents")).toBe(groupOf.get("agentic ai"));
    expect(groupOf.get("e-commerce")).toBe(groupOf.get("ecommerce"));
    expect(groupOf.get("insurtech")).not.toBe(groupOf.get("pet insurance"));
    expect(groupOf.get("battery recycling")).not.toBe(
      groupOf.get("payment rails"),
    );
    expect(groupOf.get("battery recycling")).not.toBe(
      groupOf.get("battery storage"),
    );
    expect(groupOf.get("solar panels")).not.toBe(groupOf.get("offshore wind"));
    expect(groupOf.get("ai agents")).not.toBe(groupOf.get("llmops"));
    expect(groupOf.get("neobank")).not.toBe(groupOf.get("embedded finance"));
  });

  it("rejects duplicate tags", () => {
    const entry = { tag: "x", group: "g", mentions: 1 };
    expect(LABELLED_TAGS_SCHEMA.safeParse([entry, entry]).success).toBe(false);
  });
});

function recordingBudget(cap = Infinity) {
  const records: Parameters<BudgetGuard["record"]>[0][] = [];
  const budget: BudgetGuard = {
    assertCanSpend(estimate) {
      if (estimate.usdMicros > cap) {
        return Promise.reject(
          new BudgetExceededError({
            model: estimate.model,
            estimateUsdMicros: estimate.usdMicros,
            spentUsdMicros: 0,
            capUsdMicros: cap,
          }),
        );
      }
      return Promise.resolve();
    },
    record(usage) {
      records.push(usage);
      return Promise.resolve();
    },
    monthToDate: () =>
      Promise.resolve({ spentUsdMicros: 0, capUsdMicros: cap }),
  };
  return { budget, records };
}

describe("recordThemeEmbeddings", () => {
  const tags: LabelledTag[] = [
    { tag: "ai agents", group: "a", mentions: 3 },
    { tag: "agentic ai", group: "a", mentions: 2 },
  ];

  it("embeds once with the production template, rounds to 4 places and records spend as eval", async () => {
    const embedder = createFakeEmbeddingClient();
    const { budget, records } = recordingBudget();
    const recording = await recordThemeEmbeddings({
      tags,
      embedder,
      budget,
      dimensions: 8,
      today: new Date("2026-11-12T10:00:00Z"),
    });
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]).toMatchObject({
      inputs: [tagEmbeddingInput("ai agents"), tagEmbeddingInput("agentic ai")],
      dimensions: 8,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ purpose: "eval", outputTokens: 0 });
    expect(recording.recordedOn).toBe("2026-11-12");
    expect(recording.template).toBe(TAG_EMBEDDING_TEMPLATE);
    expect(Object.keys(recording.vectors)).toEqual(["ai agents", "agentic ai"]);
    expect(recording.dimensions).toBe(8);
    for (const vector of Object.values(recording.vectors)) {
      expect(vector).toHaveLength(8);
      for (const value of vector) expect(value).toBe(round4(value));
    }
    // The recording must load back against the same tags.
    expect(() => sweep(tags, recording.vectors)).not.toThrow();
  });

  it("stops before embedding when the budget refuses", async () => {
    const embedder = createFakeEmbeddingClient();
    const { budget } = recordingBudget(0);
    await expect(
      recordThemeEmbeddings({ tags, embedder, budget, dimensions: 8 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(embedder.calls).toHaveLength(0);
  });
});

describe("loadThemeRecording", () => {
  const tags: LabelledTag[] = [{ tag: "ai agents", group: "a", mentions: 1 }];

  function write(template: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "themes-")), "rec.json");
    writeFileSync(
      path,
      JSON.stringify({
        model: "m",
        dimensions: 2,
        template,
        recordedOn: "2026-11-12",
        inputTokens: 1,
        costUsdMicros: 0,
        vectors: { "ai agents": [1, 0] },
      }),
    );
    return path;
  }

  it("loads a recording made with the current template", () => {
    expect(
      loadThemeRecording(tags, write(TAG_EMBEDDING_TEMPLATE)).template,
    ).toBe(TAG_EMBEDDING_TEMPLATE);
  });

  it("refuses a recording made with another template", () => {
    expect(() => loadThemeRecording(tags, write("bare"))).toThrow(/template/);
  });
});

describe("renderThemeReport", () => {
  it("shows the sweep, the best τ and the default", () => {
    const tags = loadLabelledTags().slice(0, 4);
    const embeddings: Record<string, number[]> = {};
    for (const [i, entry] of tags.entries()) {
      embeddings[entry.tag] = [1, i];
    }
    const rows = sweep(tags, embeddings);
    const body = renderThemeReport(rows, tags, {
      model: "text-embedding-3-small",
      dimensions: 2,
      template: TAG_EMBEDDING_TEMPLATE,
      recordedOn: "2026-11-12",
      inputTokens: 10,
      costUsdMicros: 0,
      vectors: embeddings,
    });
    expect(body).toContain("| τ |");
    expect(body).toContain("Best by rule");
    expect(body).toContain(DEFAULT_THEME_THRESHOLD.toFixed(2));
    expect(body.match(/^\| 0\.\d\d/gm)).toHaveLength(THEME_THRESHOLDS.length);
  });
});

describe("recorded embeddings replay", () => {
  const recorded = existsSync(THEME_RECORDING_PATH);
  if (!recorded) {
    console.warn(
      `Skipped: no recording at ${THEME_RECORDING_PATH}. The maintainer runs pnpm eval --themes --live to create it.`,
    );
  }

  it.skipIf(!recorded)(
    "uses the best embedding-only τ by rule as the default and fallback",
    () => {
      const tags = loadLabelledTags();
      const rows = sweep(tags, loadThemeRecording(tags).vectors);
      expect(chooseThreshold(rows).threshold).toBe(DEFAULT_THEME_THRESHOLD);
    },
  );
});

describe("theme check eval", () => {
  const tags: LabelledTag[] = [
    { tag: "one", group: "g1", mentions: 5 },
    { tag: "uno", group: "g1", mentions: 4 },
    { tag: "other", group: "g2", mentions: 3 },
  ];
  // "uno" is 0.8 from "one": in the band. "other" is far from both.
  const embeddings = {
    one: [1, 0, 0],
    uno: [0.8, 0.6, 0],
    other: [0, 0, 1],
  };
  const bands = [{ low: 0.7, high: 0.9 }];
  const unoKey = bandQuestionKey("uno", [{ tags: ["one"] }]);

  it("builds the grid from pairs with low below high", () => {
    expect(themeBandGrid([0.7, 0.8], [0.8, 0.9])).toEqual([
      { low: 0.7, high: 0.8 },
      { low: 0.7, high: 0.9 },
      { low: 0.8, high: 0.9 },
    ]);
  });

  it("replays a recorded verdict through the production method", async () => {
    const join = await sweepBands(
      tags,
      embeddings,
      { verdicts: { [unoKey]: [9] } },
      bands,
    );
    expect(join.rows[0]).toMatchObject({
      f1: 1,
      themes: 2,
      calls: 1,
      questions: 1,
      missing: 0,
    });
    const apart = await sweepBands(
      tags,
      embeddings,
      { verdicts: { [unoKey]: [2] } },
      bands,
    );
    expect(apart.rows[0]).toMatchObject({ recall: 0, themes: 3, missing: 0 });
  });

  it("lists questions with no verdict and marks the row incomplete", async () => {
    const { rows, missing } = await sweepBands(
      tags,
      embeddings,
      { verdicts: {} },
      bands,
    );
    expect(rows[0]!.missing).toBe(1);
    expect([...missing.keys()]).toEqual([unoKey]);
    expect(() => chooseBands(rows)).toThrow(/verdict/);
  });

  it("records missing verdicts live, as eval spend, until none are missing", async () => {
    const requests: string[] = [];
    const llm: LlmClient = {
      complete<T>(request: LlmCompleteRequest<T>) {
        requests.push(request.user);
        const { tags: items } = JSON.parse(request.user) as {
          tags: { id: number }[];
        };
        return Promise.resolve({
          data: request.schema.parse({
            verdicts: items.map((item) => ({ id: item.id, match: 1 })),
          }),
          usage: { inputTokens: 1000, outputTokens: 100 },
          model: "gpt-5.6-luna",
        });
      },
    };
    const { budget, records } = recordingBudget();
    const result = await recordThemeChecks({
      tags,
      embeddings,
      recording: emptyThemeCheckRecording(),
      llm,
      budget,
      grid: bands,
      today: new Date("2026-11-12T10:00:00Z"),
    });
    expect(requests).toHaveLength(1);
    expect(result.recording.verdicts).toEqual({ [unoKey]: [10] });
    expect(result.recording).toMatchObject({
      calls: 1,
      questions: 1,
      inputTokens: 1000,
      outputTokens: 100,
      recordedOn: "2026-11-12",
    });
    expect(records.map((row) => row.purpose)).toEqual(["eval"]);
    expect(result.costUsdMicros).toBe(records[0]!.costUsdMicros);

    const again = await recordThemeChecks({
      tags,
      embeddings,
      recording: result.recording,
      llm,
      budget,
      grid: bands,
    });
    expect(again.calls).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("stops recording on a budget refusal and keeps what it has", async () => {
    const llm: LlmClient = {
      complete: () => Promise.reject(new Error("must not be called")),
    };
    const { budget } = recordingBudget(0);
    const result = await recordThemeChecks({
      tags,
      embeddings,
      recording: emptyThemeCheckRecording(),
      llm,
      budget,
      grid: bands,
    });
    expect(result.calls).toBe(0);
    expect(result.stopped).toBeDefined();
    expect(result.recording.verdicts).toEqual({});
  });

  it("prefers higher precision among rows close to the best F1", () => {
    const base = {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      recall: 1,
      themes: 1,
      calls: 1,
      questions: 1,
      merged: 0,
      fallbacks: 0,
      missing: 0,
    };
    const rows: BandRow[] = [
      { ...base, low: 0.6, high: 0.9, f1: 0.8, precision: 0.7 },
      { ...base, low: 0.7, high: 0.9, f1: 0.795, precision: 0.9 },
      { ...base, low: 0.8, high: 0.9, f1: 0.7, precision: 1 },
      { ...base, low: 0.5, high: 0.9, f1: 0.95, precision: 1, missing: 2 },
    ];
    expect(chooseBands(rows)).toMatchObject({ low: 0.7 });
    expect(chooseBands(rows, 0)).toMatchObject({ low: 0.6 });
  });

  it("refuses verdicts recorded with another prompt", () => {
    const path = join(mkdtempSync(join(tmpdir(), "themes-")), "check.json");
    writeFileSync(
      path,
      JSON.stringify({ ...emptyThemeCheckRecording(), promptHash: "old" }),
    );
    expect(() => loadThemeCheckRecording(path)).toThrow(/another prompt/);
  });

  it("estimates the cost per run from the recorded cost per question", () => {
    const recording = {
      ...emptyThemeCheckRecording(),
      questions: 100,
      costUsdMicros: 5000,
    };
    expect(costPerQuestion(recording)).toBe(50);
    const row = { questions: 30 } as BandRow;
    expect(costPerRun(row, 150, recording)).toBe((30 / 150) * 300 * 50);
  });
});

describe("recorded verdicts replay", () => {
  const checkPath = themeCheckRecordingPath(
    undefined,
    THEME_RECORDING_PATH,
    DEFAULT_THEME_BANDS,
  );
  const recorded = existsSync(THEME_RECORDING_PATH) && existsSync(checkPath);
  if (!recorded) {
    console.warn(
      `Skipped: no verdicts at ${checkPath}. The maintainer runs pnpm eval --themes --check --live to create them.`,
    );
  }
  const defaultMode = themeCheckPromptVersion(DEFAULT_THEME_BANDS);

  it.skipIf(!recorded)(
    `reaches F1 ${THEME_F1_TARGET} and precision ${THEME_PRECISION_TARGET} at the defaults`,
    async () => {
      const tags = loadLabelledTags();
      const { rows } = await sweepBands(
        tags,
        loadThemeRecording(tags).vectors,
        loadThemeCheckRecording(checkPath, DEFAULT_THEME_BANDS),
        [DEFAULT_THEME_BANDS],
      );
      expect(rows[0]!.missing).toBe(0);
      expect(rows[0]!.f1).toBeGreaterThanOrEqual(THEME_F1_TARGET);
      expect(rows[0]!.precision).toBeGreaterThanOrEqual(THEME_PRECISION_TARGET);
    },
  );

  it.skipIf(!recorded)(
    "uses the best bands on the grid by rule as the default",
    async () => {
      const tags = loadLabelledTags();
      const { rows } = await sweepBands(
        tags,
        loadThemeRecording(tags).vectors,
        loadThemeCheckRecording(checkPath, DEFAULT_THEME_BANDS),
        THEME_BAND_GRID.filter(
          (bands) => themeCheckPromptVersion(bands) === defaultMode,
        ),
      );
      expect(chooseBands(rows)).toMatchObject(DEFAULT_THEME_BANDS);
    },
  );
});
