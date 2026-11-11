import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { strictJsonSchema } from "@/core/json-schema";
import type {
  BudgetGuard,
  EmbeddingClient,
  LlmClient,
  LlmCompleteRequest,
  LlmCompleteResult,
} from "@/core/ports";
import {
  TAG_EMBEDDING_TEMPLATE,
  tagEmbeddingInput,
} from "@/pipeline/embed/embed-tags";
import {
  assignGreedy,
  bandQuestionKey,
  DEFAULT_THEME_BANDS,
  DEFAULT_THEME_THRESHOLD,
  type GreedyTag,
  type ThemeBands,
} from "@/pipeline/themes/cluster";
import {
  askThemeChecks,
  assignWithThemeCheck,
  buildThemeCheckSystemPrompt,
  type CheckQuestion,
  THEME_CHECK_MAX_ROUNDS,
  THEME_CHECK_MODEL,
  THEME_CHECK_PROMPT_VERSION,
  themeCheckSchema,
  type ThemeCheckOutput,
} from "@/pipeline/themes/theme-check";
import {
  costUsdMicros,
  estimateEmbeddingCost,
} from "@/pipeline/extract/pricing";

export const LABELLED_TAGS_PATH = "fixtures/themes/labelled-tags.json";
/** The default embedding model. Others can be evaluated with `--model`. */
export const THEME_EMBEDDING_MODEL = "text-embedding-3-small";
export const THEME_EMBEDDING_DIMENSIONS = 512;
/** One recording per model, size and input template, so they never mix (D46). */
export function themeRecordingPath(
  model = THEME_EMBEDDING_MODEL,
  dimensions = THEME_EMBEDDING_DIMENSIONS,
): string {
  return `fixtures/themes/recorded/${model}-${dimensions}-${TAG_EMBEDDING_TEMPLATE}.json`;
}
export const THEME_RECORDING_PATH = themeRecordingPath();
export const THEME_REPORT_PATH = "docs/theme-eval-results.md";

/** Pairwise F1 the chosen threshold must reach (spec-phase2 section 13, A26). */
export const THEME_F1_TARGET = 0.75;
/** F1 scores this close to the best count as a tie. The higher τ wins (D29). */
export const THEME_TIE_TOLERANCE = 0.01;

/**
 * τ = 0.60, 0.62 ... 0.90. The embedding template raises every similarity
 * and F1 changes fast with τ, so the grid is fine and high (D46). Built from
 * integers to avoid float drift.
 */
export const THEME_THRESHOLDS: readonly number[] = Array.from(
  { length: 16 },
  (_, i) => (60 + i * 2) / 100,
);

const labelledTagSchema = z.object({
  tag: z.string().min(1),
  group: z.string().min(1),
  mentions: z.number().int().positive(),
});
export type LabelledTag = z.infer<typeof labelledTagSchema>;

export const LABELLED_TAGS_SCHEMA = z
  .array(labelledTagSchema)
  .min(1)
  .superRefine((tags, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of tags.entries()) {
      if (seen.has(entry.tag)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "tag"],
          message: `Duplicate tag "${entry.tag}"`,
        });
      }
      seen.add(entry.tag);
    }
  });

export function loadLabelledTags(path = LABELLED_TAGS_PATH): LabelledTag[] {
  return LABELLED_TAGS_SCHEMA.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

export const themeRecordingSchema = z.object({
  model: z.string(),
  dimensions: z.number().int().positive(),
  /** `TAG_EMBEDDING_TEMPLATE` at recording time. */
  template: z.string(),
  recordedOn: z.string(),
  inputTokens: z.number(),
  costUsdMicros: z.number(),
  /** Tag text to vector, rounded to 4 decimal places. */
  vectors: z.record(z.string(), z.array(z.number())),
});
export type ThemeRecording = z.infer<typeof themeRecordingSchema>;

/** Reads a recording and checks that it covers every labelled tag. */
export function loadThemeRecording(
  tags: readonly LabelledTag[],
  path = THEME_RECORDING_PATH,
): ThemeRecording {
  const recording = themeRecordingSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  if (recording.template !== TAG_EMBEDDING_TEMPLATE) {
    throw new Error(
      `Recording used template "${recording.template}", not "${TAG_EMBEDDING_TEMPLATE}". Run pnpm eval --themes --live.`,
    );
  }
  for (const { tag } of tags) {
    const vector = recording.vectors[tag];
    if (!vector) throw new Error(`Recording has no vector for "${tag}"`);
    if (vector.length !== recording.dimensions) {
      throw new Error(
        `Vector for "${tag}" is not ${recording.dimensions} long`,
      );
    }
  }
  return recording;
}

export interface ThemeScore {
  /** Same-theme pairs that are also same-group. */
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** 1 when no pair was predicted (nothing wrong was merged). */
  precision: number;
  /** 1 when no pair was expected. */
  recall: number;
  f1: number;
  /** Distinct themes in the assignment. */
  themes: number;
}

function pairs(n: number): number {
  return (n * (n - 1)) / 2;
}

/**
 * Pairwise score over same-group pairs. `expected` maps tag to group id and
 * `assignment` maps tag to theme id. Only tags present in both are scored.
 */
export function scoreThemes(
  expected: Readonly<Record<string, string>>,
  assignment: Readonly<Record<string, string | number>>,
): ThemeScore {
  const groupSizes = new Map<string, number>();
  const themeSizes = new Map<string, number>();
  const cellSizes = new Map<string, number>();
  for (const [tag, group] of Object.entries(expected)) {
    const theme = assignment[tag];
    if (theme === undefined) continue;
    const themeKey = String(theme);
    const cellKey = JSON.stringify([group, themeKey]);
    groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
    themeSizes.set(themeKey, (themeSizes.get(themeKey) ?? 0) + 1);
    cellSizes.set(cellKey, (cellSizes.get(cellKey) ?? 0) + 1);
  }
  const sum = (sizes: Iterable<number>) =>
    [...sizes].reduce((total, n) => total + pairs(n), 0);
  const truePositives = sum(cellSizes.values());
  const predicted = sum(themeSizes.values());
  const real = sum(groupSizes.values());
  const precision = predicted === 0 ? 1 : truePositives / predicted;
  const recall = real === 0 ? 1 : truePositives / real;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    truePositives,
    falsePositives: predicted - truePositives,
    falseNegatives: real - truePositives,
    precision,
    recall,
    f1,
    themes: themeSizes.size,
  };
}

export interface SweepRow extends ThemeScore {
  threshold: number;
}

/** Runs the greedy clustering once per threshold and scores each run. */
export function sweep(
  tags: readonly LabelledTag[],
  embeddings: Readonly<Record<string, readonly number[]>>,
  thresholds: readonly number[] = THEME_THRESHOLDS,
): SweepRow[] {
  const expected: Record<string, string> = {};
  const greedyTags: GreedyTag[] = tags.map((entry, id) => {
    const embedding = embeddings[entry.tag];
    if (!embedding) throw new Error(`No embedding for "${entry.tag}"`);
    expected[entry.tag] = entry.group;
    return { id, slug: entry.tag, mentions: entry.mentions, embedding };
  });
  return thresholds.map((threshold) => {
    const { assignments } = assignGreedy({
      tags: greedyTags,
      themes: [],
      threshold,
    });
    const assignment: Record<string, string> = {};
    for (const item of assignments) {
      // With no starting themes, every target is a theme this run created.
      const theme =
        item.target.kind === "new" ? item.target.index : item.target.id;
      assignment[greedyTags[item.tagId]!.slug] = String(theme);
    }
    return { threshold, ...scoreThemes(expected, assignment) };
  });
}

/** The row with the best F1. Rows within the tolerance tie, and the higher τ wins. */
export function chooseThreshold(
  rows: readonly SweepRow[],
  tolerance = THEME_TIE_TOLERANCE,
): SweepRow {
  if (rows.length === 0) throw new Error("Need at least one sweep row");
  const best = Math.max(...rows.map((row) => row.f1));
  const close = rows.filter((row) => best - row.f1 <= tolerance);
  return close.reduce((a, b) => (b.threshold > a.threshold ? b : a));
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Embeds every labelled tag in one call through the budget guard (purpose
 * `eval`) and returns a recording. The caller saves it.
 */
export async function recordThemeEmbeddings(options: {
  tags: readonly LabelledTag[];
  embedder: EmbeddingClient;
  budget: BudgetGuard;
  model?: string;
  dimensions?: number;
  today?: Date;
}): Promise<ThemeRecording> {
  const {
    tags,
    embedder,
    budget,
    model = THEME_EMBEDDING_MODEL,
    dimensions = THEME_EMBEDDING_DIMENSIONS,
    today = new Date(),
  } = options;
  // The same text production embeds (embed-tags.ts), keyed back by tag.
  const inputs = tags.map((entry) => tagEmbeddingInput(entry.tag));
  // A BudgetExceededError propagates: the live step stops rather than skips.
  await budget.assertCanSpend(estimateEmbeddingCost(model, inputs));
  const result = await embedder.embed({ inputs, dimensions });
  if (result.vectors.length !== inputs.length) {
    throw new Error("Embedding client returned the wrong number of vectors");
  }
  const cost = costUsdMicros(model, {
    inputTokens: result.usage.inputTokens,
    outputTokens: 0,
  });
  await budget.record({
    purpose: "eval",
    model,
    inputTokens: result.usage.inputTokens,
    outputTokens: 0,
    costUsdMicros: cost,
  });
  const vectors: Record<string, number[]> = {};
  for (const [index, entry] of tags.entries()) {
    vectors[entry.tag] = result.vectors[index]!.map(round4);
  }
  return {
    model,
    dimensions,
    template: TAG_EMBEDDING_TEMPLATE,
    recordedOn: today.toISOString().slice(0, 10),
    inputTokens: result.usage.inputTokens,
    costUsdMicros: cost,
    vectors,
  };
}

function fixed(value: number): string {
  return value.toFixed(3);
}

export function renderThemeTable(
  rows: readonly SweepRow[],
  chosen: SweepRow,
): string {
  const lines = [
    "| τ | Themes | Precision | Recall | F1 | Wrong merges | Missed merges |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
      const mark = row.threshold === chosen.threshold ? " **←**" : "";
      return `| ${row.threshold.toFixed(2)}${mark} | ${row.themes} | ${fixed(row.precision)} | ${fixed(row.recall)} | ${fixed(row.f1)} | ${row.falsePositives} | ${row.falseNegatives} |`;
    }),
  ];
  return lines.join("\n");
}

export function renderThemeReport(
  rows: readonly SweepRow[],
  tags: readonly LabelledTag[],
  recording: ThemeRecording,
  check?: { rows: readonly BandRow[]; recording: ThemeCheckRecording },
): string {
  const chosen = chooseThreshold(rows);
  const current = rows.find((row) => row.threshold === DEFAULT_THEME_THRESHOLD);
  const sizes = new Map<string, number>();
  for (const { group } of tags) sizes.set(group, (sizes.get(group) ?? 0) + 1);
  const groups = sizes.size;
  const singles = [...sizes.values()].filter((size) => size === 1).length;
  const currentLine = current
    ? `- **Default in code (\`DEFAULT_THEME_THRESHOLD\`):** ${DEFAULT_THEME_THRESHOLD.toFixed(2)}, F1 ${fixed(current.f1)}${current.f1 >= THEME_F1_TARGET ? "" : " (below target)"}`
    : `- **Default in code (\`DEFAULT_THEME_THRESHOLD\`):** ${DEFAULT_THEME_THRESHOLD.toFixed(2)}, not on the sweep grid`;
  return `# Theme clustering eval

Pairwise precision, recall and F1 of the greedy centroid clustering (spec-phase2 section 7.1) on ${tags.length} labelled tags in ${groups} expected groups (${singles} of them a single tag). The groups follow the market rule in \`fixtures/themes/README.md\`. Generated by \`pnpm eval --themes\`. Do not edit by hand.

- **Embeddings:** ${recording.model}, ${recording.dimensions} dimensions, template \`${recording.template}\` (each tag is sent as "${tagEmbeddingInput("<tag>")}"), recorded ${recording.recordedOn} (${recording.inputTokens} tokens, $${(recording.costUsdMicros / 1_000_000).toFixed(6)})
- **Target:** F1 at least ${THEME_F1_TARGET.toFixed(2)} (A26)
- **Best by rule:** τ = ${chosen.threshold.toFixed(2)}, F1 ${fixed(chosen.f1)}. The rule takes the best F1 and prefers the higher τ within ${THEME_TIE_TOLERANCE} of it (D29).
${currentLine}

${renderThemeTable(rows, chosen)}

Precision is the share of same-theme pairs that are same-group. Recall is the share of same-group pairs that share a theme. A wrong merge is a same-theme pair from different groups. A missed merge is a same-group pair split across themes. The arrow marks the best τ by the rule.
${check ? `\n${renderCheckSection(check.rows, tags, check.recording)}` : ""}`;
}

// The LLM check (D47). Verdicts are recorded once and replayed for free.

/**
 * Band settings swept by `pnpm eval --themes`. Each needs recorded verdicts;
 * the grid is small because every new question is a paid call (D47).
 */
export const THEME_BAND_GRID: readonly ThemeBands[] = [
  { low: 0.72, high: 0.84 },
  { low: 0.72, high: 0.88 },
  { low: 0.74, high: 0.88 },
  { low: 0.76, high: 0.88 },
];
/** Band rows with F1 this close to the best tie. The higher precision wins. */
export const THEME_BAND_TIE_TOLERANCE = 0.01;
/** New tags a production run might see, for the cost estimate. */
export const THEME_COST_TAGS = 300;

/** Every pair with low below high. */
export function themeBandGrid(
  lows: readonly number[],
  highs: readonly number[],
): ThemeBands[] {
  return lows.flatMap((low) =>
    highs.filter((high) => high > low).map((high) => ({ low, high })),
  );
}

function sameBands(a: ThemeBands, b: ThemeBands): boolean {
  return a.low === b.low && a.high === b.high;
}

/** A hash of the system prompt and schema, so an unbumped edit is caught. */
export function themeCheckPromptHash(): string {
  return createHash("sha256")
    .update(buildThemeCheckSystemPrompt())
    .update(JSON.stringify(strictJsonSchema(themeCheckSchema)))
    .digest("hex")
    .slice(0, 16);
}

/**
 * One file per check model, prompt version and embedding recording. Verdicts
 * inside are keyed by the exact question the LLM saw (`bandQuestionKey`), so a
 * change of band or embedding that changes a question finds no verdict.
 */
export function themeCheckRecordingPath(
  model = THEME_CHECK_MODEL,
  embeddingPath = THEME_RECORDING_PATH,
): string {
  return `fixtures/themes/recorded/check-${model}-${THEME_CHECK_PROMPT_VERSION}-${basename(embeddingPath, ".json")}.json`;
}

export const themeCheckRecordingSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  promptHash: z.string(),
  /** The embedding recording the questions came from. */
  embeddings: z.string(),
  recordedOn: z.string(),
  calls: z.number().int().nonnegative(),
  /** Questions sent, including any with no usable verdict. */
  questions: z.number().int().nonnegative(),
  /** Questions sent with no usable verdict back, for example cut off output. */
  invalid: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsdMicros: z.number().int().nonnegative(),
  /** Question key to the chosen candidate index, or null for none. */
  verdicts: z.record(z.string(), z.number().int().nonnegative().nullable()),
});
export type ThemeCheckRecording = z.infer<typeof themeCheckRecordingSchema>;

export function emptyThemeCheckRecording(
  embeddingPath = THEME_RECORDING_PATH,
  model = THEME_CHECK_MODEL,
): ThemeCheckRecording {
  return {
    model,
    promptVersion: THEME_CHECK_PROMPT_VERSION,
    promptHash: themeCheckPromptHash(),
    embeddings: basename(embeddingPath),
    recordedOn: "",
    calls: 0,
    questions: 0,
    invalid: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
    verdicts: {},
  };
}

/** Reads recorded verdicts and refuses them if the prompt has changed. */
export function loadThemeCheckRecording(
  path = themeCheckRecordingPath(),
): ThemeCheckRecording {
  const recording = themeCheckRecordingSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  if (
    recording.promptVersion !== THEME_CHECK_PROMPT_VERSION ||
    recording.promptHash !== themeCheckPromptHash()
  ) {
    throw new Error(
      `Recorded verdicts in ${path} were made with another prompt. Run pnpm eval --themes --check --live.`,
    );
  }
  return recording;
}

const checkPromptSchema = z.object({
  tags: z.array(
    z.object({
      id: z.number().int(),
      tag: z.string(),
      candidates: z.array(z.object({ tags: z.array(z.string()) })),
    }),
  ),
});

/** Recorded answers: question key to verdict. */
export interface RecordedVerdicts {
  verdicts: Readonly<Record<string, number | null>>;
}

/**
 * An `LlmClient` that answers check prompts from recorded verdicts. Questions
 * with no verdict are left out of the answer, so the method falls back for
 * them, and are collected in `missing`. Usage is zero: replay costs nothing.
 */
export function createReplayCheckClient({
  verdicts,
}: RecordedVerdicts): LlmClient & { missing: Map<string, CheckQuestion> } {
  const missing = new Map<string, CheckQuestion>();
  return {
    missing,
    complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>> {
      const prompt = checkPromptSchema.parse(JSON.parse(request.user));
      const answers: ThemeCheckOutput["verdicts"] = [];
      for (const item of prompt.tags) {
        const key = bandQuestionKey(item.tag, item.candidates);
        const verdict = verdicts[key];
        if (verdict === undefined) {
          missing.set(key, {
            key,
            tag: item.tag,
            candidates: item.candidates,
          });
          continue;
        }
        answers.push({
          id: item.id,
          match: verdict === null ? 0 : verdict + 1,
        });
      }
      return Promise.resolve({
        data: request.schema.parse({ verdicts: answers }),
        usage: { inputTokens: 0, outputTokens: 0 },
        model: THEME_CHECK_MODEL,
      });
    },
  };
}

/** A budget that allows everything and keeps nothing. For replay. */
const freeBudget: BudgetGuard = {
  assertCanSpend: () => Promise.resolve(),
  record: () => Promise.resolve(),
  monthToDate: () => Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 0 }),
};

function greedyTagsFor(
  tags: readonly LabelledTag[],
  embeddings: Readonly<Record<string, readonly number[]>>,
): { greedyTags: GreedyTag[]; expected: Record<string, string> } {
  const expected: Record<string, string> = {};
  const greedyTags = tags.map((entry, id) => {
    const embedding = embeddings[entry.tag];
    if (!embedding) throw new Error(`No embedding for "${entry.tag}"`);
    expected[entry.tag] = entry.group;
    return { id, slug: entry.tag, mentions: entry.mentions, embedding };
  });
  return { greedyTags, expected };
}

export interface BandRow extends ThemeScore {
  low: number;
  high: number;
  /** LLM calls and questions the method made for the labelled tags. */
  calls: number;
  questions: number;
  /** Band tags placed by the embedding-only fallback. */
  fallbacks: number;
  /** Questions with no recorded verdict. The row is incomplete when above 0. */
  missing: number;
}

export interface SweepBandsResult {
  rows: BandRow[];
  missing: Map<string, CheckQuestion>;
}

/**
 * Runs the full method, embeddings plus the LLM check, once per band pair.
 * The check goes through the production code with `llm` answering. Returns
 * the rows and every question that had no answer.
 */
export async function sweepBands(
  tags: readonly LabelledTag[],
  embeddings: Readonly<Record<string, readonly number[]>>,
  recorded: RecordedVerdicts,
  grid: readonly ThemeBands[] = THEME_BAND_GRID,
  /** Passes that may ask. Recording uses fewer, to ask one pass at a time. */
  maxRounds = THEME_CHECK_MAX_ROUNDS,
): Promise<SweepBandsResult> {
  const { greedyTags, expected } = greedyTagsFor(tags, embeddings);
  const rows: BandRow[] = [];
  const missing = new Map<string, CheckQuestion>();
  for (const bands of grid) {
    const llm = createReplayCheckClient(recorded);
    const { greedy, stats } = await assignWithThemeCheck({
      tags: greedyTags,
      themes: [],
      threshold: DEFAULT_THEME_THRESHOLD,
      bands,
      maxRounds,
      check: {
        llm,
        budget: freeBudget,
        model: THEME_CHECK_MODEL,
        purpose: "eval",
      },
    });
    const assignment: Record<string, string> = {};
    for (const item of greedy.assignments) {
      const theme =
        item.target.kind === "new" ? item.target.index : item.target.id;
      assignment[greedyTags[item.tagId]!.slug] = String(theme);
    }
    for (const [key, question] of llm.missing) missing.set(key, question);
    rows.push({
      ...bands,
      ...scoreThemes(expected, assignment),
      calls: stats?.calls ?? 0,
      questions: stats?.questions ?? 0,
      fallbacks: stats?.fallbacks ?? 0,
      missing: llm.missing.size,
    });
  }
  return { rows, missing };
}

/**
 * The complete row with the best F1. Rows within the tolerance tie: the
 * higher precision wins, because a person can merge two themes later but a
 * wrong merge misleads until someone notices it.
 */
export function chooseBands(
  rows: readonly BandRow[],
  tolerance = THEME_BAND_TIE_TOLERANCE,
): BandRow {
  const complete = rows.filter((row) => row.missing === 0);
  if (complete.length === 0) throw new Error("No band row has every verdict");
  const best = Math.max(...complete.map((row) => row.f1));
  const close = complete.filter((row) => best - row.f1 <= tolerance);
  return close.reduce((a, b) =>
    b.precision > a.precision ||
    (b.precision === a.precision && b.questions < a.questions)
      ? b
      : a,
  );
}

/** Average recorded cost of one question, in USD micros. */
export function costPerQuestion(recording: ThemeCheckRecording): number {
  return recording.questions === 0
    ? 0
    : recording.costUsdMicros / recording.questions;
}

/** Estimated cost for `THEME_COST_TAGS` new tags, in USD micros. */
export function costPerRun(
  row: BandRow,
  tagCount: number,
  recording: ThemeCheckRecording,
): number {
  return (
    (row.questions / tagCount) * THEME_COST_TAGS * costPerQuestion(recording)
  );
}

export interface RecordChecksResult {
  recording: ThemeCheckRecording;
  /** Paid calls made by this run. */
  calls: number;
  costUsdMicros: number;
  /** Set when a budget refusal or an error stopped the recording. */
  stopped?: string;
}

/**
 * Fills in missing verdicts for every band pair on the grid, one pass of the
 * method at a time, as production would ask them. Each paid round replays all
 * pairs up to the current pass, gathers the questions with no verdict and asks
 * them live in batches, purpose `eval`. Asking only the earliest pass with
 * gaps avoids paying for questions that a fallback made up. Stops when no
 * pass has gaps or after `maxRounds` paid rounds.
 */
export async function recordThemeChecks(options: {
  tags: readonly LabelledTag[];
  embeddings: Readonly<Record<string, readonly number[]>>;
  recording: ThemeCheckRecording;
  llm: LlmClient;
  budget: BudgetGuard;
  grid?: readonly ThemeBands[];
  maxRounds?: number;
  today?: Date;
  /** Called after each paid round, so the caller can save as it goes. */
  onRound?: (
    round: number,
    asked: number,
    costUsdMicros: number,
    recording: ThemeCheckRecording,
  ) => void;
}): Promise<RecordChecksResult> {
  const {
    tags,
    embeddings,
    llm,
    budget,
    grid = THEME_BAND_GRID,
    maxRounds = 12,
    today = new Date(),
    onRound,
  } = options;
  const recording: ThemeCheckRecording = {
    ...options.recording,
    verdicts: { ...options.recording.verdicts },
  };
  const result: RecordChecksResult = { recording, calls: 0, costUsdMicros: 0 };
  const deps = {
    llm,
    budget,
    model: recording.model,
    purpose: "eval" as const,
  };
  let pass = 1;
  for (let round = 1; round <= maxRounds;) {
    const { missing } = await sweepBands(
      tags,
      embeddings,
      recording,
      grid,
      pass,
    );
    let asked;
    if (missing.size > 0) {
      asked = await askThemeChecks([...missing.values()], deps);
      for (const [key, verdict] of asked.verdicts) {
        recording.verdicts[key] = verdict;
      }
    } else if (pass < THEME_CHECK_MAX_ROUNDS) {
      pass += 1;
      continue;
    } else {
      break;
    }
    recording.invalid += asked.invalid;
    recording.calls += asked.calls;
    recording.questions += asked.sent;
    recording.inputTokens += asked.inputTokens;
    recording.outputTokens += asked.outputTokens;
    recording.costUsdMicros += asked.costUsdMicros;
    recording.recordedOn = today.toISOString().slice(0, 10);
    result.calls += asked.calls;
    result.costUsdMicros += asked.costUsdMicros;
    onRound?.(round, asked.sent, result.costUsdMicros, recording);
    round += 1;
    if (asked.fallback) {
      result.stopped =
        asked.error instanceof Error ? asked.error.message : asked.fallback;
      break;
    }
  }
  return result;
}

function money(usdMicros: number): string {
  return `$${(usdMicros / 1_000_000).toFixed(4)}`;
}

export function renderBandTable(
  rows: readonly BandRow[],
  chosen: BandRow | undefined,
  tagCount: number,
  recording: ThemeCheckRecording,
): string {
  const lines = [
    `| τ_low | τ_high | Themes | Precision | Recall | F1 | Wrong merges | Missed merges | LLM calls | Questions | Cost per ${THEME_COST_TAGS} tags |`,
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => {
      const mark = chosen && sameBands(row, chosen) ? " **←**" : "";
      const scores =
        row.missing > 0
          ? `| ${row.themes} | – | – | – | – | – |`
          : `| ${row.themes} | ${fixed(row.precision)} | ${fixed(row.recall)} | ${fixed(row.f1)} | ${row.falsePositives} | ${row.falseNegatives} |`;
      return `| ${row.low.toFixed(2)}${mark} | ${row.high.toFixed(2)} ${scores} ${row.calls} | ${row.questions} | ${money(costPerRun(row, tagCount, recording))} |`;
    }),
  ];
  return lines.join("\n");
}

function describeBands(bands: ThemeBands): string {
  return `τ_low ${bands.low.toFixed(2)}, τ_high ${bands.high.toFixed(2)}`;
}

function renderCheckSection(
  rows: readonly BandRow[],
  tags: readonly LabelledTag[],
  recording: ThemeCheckRecording,
): string {
  const complete = rows.some((row) => row.missing === 0);
  const chosen = complete ? chooseBands(rows) : undefined;
  const current = rows.find((row) => sameBands(row, DEFAULT_THEME_BANDS));
  const currentLine =
    current && current.missing === 0
      ? `- **Default in code (\`DEFAULT_THEME_BANDS\`):** ${describeBands(DEFAULT_THEME_BANDS)}. F1 ${fixed(current.f1)}${current.f1 >= THEME_F1_TARGET ? "" : " (below target)"}`
      : `- **Default in code (\`DEFAULT_THEME_BANDS\`):** ${describeBands(DEFAULT_THEME_BANDS)}. Not scored on this grid`;
  const chosenLine = chosen
    ? `- **Best by rule:** ${describeBands(chosen)}. F1 ${fixed(chosen.f1)} (precision ${fixed(chosen.precision)}, recall ${fixed(chosen.recall)}). The rule takes the best F1 and prefers the higher precision within ${THEME_BAND_TIE_TOLERANCE} of it.`
    : "- **Best by rule:** none. Some verdicts are missing.";
  return `## With the LLM check (D47)

The full method: a tag whose best similarity is at least τ_high joins that theme, below τ_low it starts a new one, and in between ${recording.model} chooses among up to 3 candidate themes or none. Band tags with no verdict fall back to τ = ${DEFAULT_THEME_THRESHOLD.toFixed(2)}.

- **Verdicts:** ${recording.model}, prompt \`${recording.promptVersion}\`, recorded ${recording.recordedOn} from \`${recording.embeddings}\`: ${Object.keys(recording.verdicts).length} verdicts. ${recording.questions} questions in ${recording.calls} calls, ${recording.invalid} of them with no usable answer, ${recording.inputTokens} input and ${recording.outputTokens} output tokens, ${money(recording.costUsdMicros)}.
${chosenLine}
${currentLine}

${renderBandTable(rows, chosen, tags.length, recording)}

LLM calls and questions are for these ${tags.length} tags, starting with no themes. The method runs the greedy pass, asks the new band questions, and runs again until nothing new is asked, so a tag can be asked more than once. The cost per ${THEME_COST_TAGS} tags scales the questions by tag count at the recorded average of $${(costPerQuestion(recording) / 1_000_000).toFixed(6)} a question. A dash marks a row with missing verdicts.
`;
}
