import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "@/cli/env";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient } from "@/core/ports";
import { createOpenAiEmbeddingClient } from "@/pipeline/embed/openai-embeddings";
import { extractItem } from "@/pipeline/extract/extract-item";
import { createOpenAiClient } from "@/pipeline/extract/openai-client";
import { EXTRACTION_PROMPT_VERSION } from "@/pipeline/extract/prompt";
import {
  loadCases,
  loadRecordings,
  RECORDINGS_DIR,
  type Recording,
} from "./recording";
import { renderReport, renderTable, scoreRecording } from "./report";
import { renderResolutionReport, runResolutionEval } from "./resolution";
import {
  TAG_EMBEDDING_TEMPLATE,
  TAG_MEANING_TEMPLATE,
} from "@/pipeline/embed/embed-tags";
import type { ThemeBands } from "@/pipeline/themes/cluster";
import {
  THEME_CHECK_MODEL,
  themeCheckPromptVersion,
} from "@/pipeline/themes/theme-check";
import {
  chooseBands,
  chooseThreshold,
  emptyThemeCheckRecording,
  loadLabelledTags,
  loadThemeCheckRecording,
  loadThemeRecording,
  recordThemeChecks,
  recordThemeEmbeddings,
  renderBandTable,
  renderThemeReport,
  renderThemeTable,
  sweep,
  sweepBands,
  THEME_CHECK_MODELS,
  themeBandGridFor,
  THEME_EMBEDDING_DIMENSIONS,
  themeMeaningsPath,
  loadThemeMeanings,
  recordThemeMeanings,
  type CheckReport,
  THEME_EMBEDDING_MODEL,
  THEME_REPORT_PATH,
  themeBandGrid,
  themeCheckRecordingPath,
  themeRecordingPath,
  type ThemeCheckRecording,
} from "./themes";

const REPORT_PATH = "docs/eval-results.md";
const RESOLUTION_REPORT_PATH = "docs/resolution-eval-results.md";
const LIVE_CAP_USD_MICROS = 1_000_000;
/** Cap for one `--themes --check --live` run: the verdicts cost cents. */
const THEME_CHECK_LIVE_CAP_USD_MICROS = 100_000;

const USAGE = `Usage: pnpm eval <mode>

  --replay [--model <id>]        Score committed recordings. No network, no cost
  --live --model <id> [...]      Call the model on every case and record it. Costs money
  --resolution                   Score company and event merging. No network, no cost
  --themes                       Sweep the theme threshold on the recorded embeddings. No network, no cost
  --themes --live                Embed the labelled tags once and record them. Costs well under $0.001
  --themes [--live] --model <id> The same with another embedding model. Prints the sweep; the report stays the default model's
  --themes --describe --live     Record tag meanings and embed the tags with them (D48)
  --themes --check --live [--meanings] [--check-model <id>] [--cap <usd>] [--place --candidates <n>] [--low <τ>... --high <τ>... [--min-score <n>]...] [--rounds <n>]
                                 Record LLM check verdicts for the band grid. Capped at $0.10 a run`;

/** A run-local cap, separate from the production budget table. */
function inMemoryBudget(
  cap = LIVE_CAP_USD_MICROS,
): BudgetGuard & { spent(): number } {
  let spent = 0;
  return {
    assertCanSpend(estimate) {
      if (spent + estimate.usdMicros > cap) {
        return Promise.reject(
          new BudgetExceededError({
            model: estimate.model,
            estimateUsdMicros: estimate.usdMicros,
            spentUsdMicros: spent,
            capUsdMicros: cap,
          }),
        );
      }
      return Promise.resolve();
    },
    record(usage) {
      spent += usage.costUsdMicros;
      return Promise.resolve();
    },
    monthToDate: () =>
      Promise.resolve({ spentUsdMicros: spent, capUsdMicros: cap }),
    spent: () => spent,
  };
}

async function recordModel(
  model: string,
  llm: LlmClient,
  budget: BudgetGuard,
): Promise<Recording> {
  const cases = [];
  for (const testCase of loadCases()) {
    try {
      const extraction = await extractItem({
        item: {
          title: testCase.headline,
          summary: testCase.summary,
          url: testCase.url,
          sourceName: testCase.sourceSlug,
          publishedAt: new Date(testCase.publishedAt),
        },
        llm,
        budget,
        model,
        purpose: "eval",
      });
      cases.push({
        id: testCase.id,
        result: extraction.result,
        error: null,
        inputTokens: extraction.usage.inputTokens,
        outputTokens: extraction.usage.outputTokens,
        costUsdMicros: extraction.costUsdMicros,
      });
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      const known = error instanceof ExtractionValidationError;
      const message = error instanceof Error ? error.message : String(error);
      // A rejected key or empty balance would otherwise score as 30 bad answers.
      if (
        !known &&
        typeof (error as { status?: unknown }).status === "number"
      ) {
        throw error;
      }
      cases.push({
        id: testCase.id,
        result: null,
        error: message,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      });
    }
  }
  return {
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    recordedOn: new Date().toISOString().slice(0, 10),
    cases,
  };
}

/** The embedding templates the eval knows, plain first (D46, D48). */
const THEME_TEMPLATES = [TAG_EMBEDDING_TEMPLATE, TAG_MEANING_TEMPLATE] as const;

async function themeReport(model = THEME_EMBEDDING_MODEL): Promise<boolean> {
  const tags = loadLabelledTags();
  const path = themeRecordingPath(model);
  if (!existsSync(path)) {
    console.error(`No recording at ${path}. Run pnpm eval --themes --live.`);
    return false;
  }
  const recording = loadThemeRecording(tags, path);
  const rows = sweep(tags, recording.vectors);
  console.log(renderThemeTable(rows, chooseThreshold(rows)));
  // The committed report always describes the default model.
  if (model !== THEME_EMBEDDING_MODEL) return true;

  const checks: CheckReport[] = [];
  for (const checkModel of THEME_CHECK_MODELS)
    for (const template of THEME_TEMPLATES) {
      const embeddingPath = themeRecordingPath(
        model,
        THEME_EMBEDDING_DIMENSIONS,
        template,
      );
      if (!existsSync(embeddingPath)) continue;
      const embeddings = loadThemeRecording(tags, embeddingPath, template);
      const embeddingRows = sweep(tags, embeddings.vectors);
      // One recording per prompt variant: band mode and each placing size.
      const byVersion = new Map<string, ThemeBands[]>();
      for (const bands of themeBandGridFor(checkModel, template)) {
        const version = themeCheckPromptVersion(bands);
        byVersion.set(version, [...(byVersion.get(version) ?? []), bands]);
      }
      for (const grid of byVersion.values()) {
        const mode = grid[0]!;
        const checkPath = themeCheckRecordingPath(
          checkModel,
          embeddingPath,
          mode,
        );
        if (!existsSync(checkPath)) {
          console.log(`No LLM check verdicts at ${checkPath}.`);
          continue;
        }
        const checkRecording = loadThemeCheckRecording(checkPath, mode);
        const { rows: bandRows } = await sweepBands(
          tags,
          embeddings.vectors,
          checkRecording,
          grid,
        );
        const chosen = bandRows.some((row) => row.missing === 0)
          ? chooseBands(bandRows)
          : undefined;
        console.log(
          `\nTemplate ${template}, prompt ${checkRecording.promptVersion}`,
        );
        console.log(
          renderBandTable(bandRows, chosen, tags.length, checkRecording),
        );
        checks.push({
          template,
          embeddings,
          embeddingOnly: chooseThreshold(embeddingRows),
          rows: bandRows,
          recording: checkRecording,
          meanings:
            template === TAG_MEANING_TEMPLATE && existsSync(themeMeaningsPath())
              ? loadThemeMeanings()
              : undefined,
        });
      }
    }
  writeFileSync(
    THEME_REPORT_PATH,
    renderThemeReport(rows, tags, recording, checks),
  );
  console.log(`\nWrote ${THEME_REPORT_PATH}`);
  return true;
}

function parseTaus(
  values: readonly string[] | undefined,
): number[] | undefined {
  if (!values?.length) return undefined;
  return values.map((value) => {
    const tau = Number(value);
    if (!Number.isFinite(tau) || tau <= 0 || tau >= 1) {
      throw new Error(`Not a threshold: ${value}`);
    }
    return tau;
  });
}

/** Prints each rejected answer, so cut-off output shows in the run log. */
function loggingClient(llm: LlmClient): LlmClient {
  return {
    async complete(request) {
      try {
        return await llm.complete(request);
      } catch (error) {
        if (error instanceof ExtractionValidationError) {
          const usage = (error as { usage?: unknown }).usage;
          console.error(
            `Rejected answer: ${error.issues.map((issue) => issue.message).join("; ")} ${JSON.stringify(usage)}`,
          );
        }
        throw error;
      }
    },
  };
}

/** Records missing LLM check verdicts for the band grid, then reports. */
async function recordChecks(
  apiKey: string,
  grid: readonly ThemeBands[],
  template: string,
  checkModel: string,
  capUsdMicros: number,
  maxRounds?: number,
): Promise<boolean> {
  const tags = loadLabelledTags();
  const embeddingPath = themeRecordingPath(
    THEME_EMBEDDING_MODEL,
    THEME_EMBEDDING_DIMENSIONS,
    template,
  );
  const embeddings = loadThemeRecording(tags, embeddingPath, template).vectors;
  const mode = grid[0];
  if (!mode) throw new Error("The band grid is empty");
  const path = themeCheckRecordingPath(checkModel, embeddingPath, mode);
  const existing: ThemeCheckRecording = existsSync(path)
    ? loadThemeCheckRecording(path, mode)
    : emptyThemeCheckRecording(embeddingPath, checkModel, mode);
  const budget = inMemoryBudget(capUsdMicros);
  const save = (recording: ThemeCheckRecording) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
  };
  const result = await recordThemeChecks({
    tags,
    embeddings,
    recording: existing,
    llm: loggingClient(createOpenAiClient({ apiKey, model: checkModel })),
    maxRounds,
    budget,
    grid,
    // Saved after every paid round, so an interrupted run keeps its verdicts.
    onRound: (round, asked, cost, recording) => {
      save(recording);
      console.log(
        `Round ${round}: asked ${asked} questions. Spend so far: $${(cost / 1_000_000).toFixed(6)}`,
      );
    },
  });
  save(result.recording);
  console.log(
    `Recorded verdicts in ${result.calls} calls. Spend: $${(budget.spent() / 1_000_000).toFixed(6)}`,
  );
  if (result.stopped) console.error(`Stopped early: ${result.stopped}`);
  return (await themeReport()) && !result.stopped;
}

/** Records tag meanings, then embeds every tag with its meaning (D48). */
async function recordMeanings(apiKey: string): Promise<boolean> {
  const tags = loadLabelledTags();
  const path = themeMeaningsPath();
  const budget = inMemoryBudget(THEME_CHECK_LIVE_CAP_USD_MICROS);
  const meanings = await recordThemeMeanings({
    tags,
    recording: existsSync(path) ? loadThemeMeanings(path) : undefined,
    llm: loggingClient(
      createOpenAiClient({ apiKey, model: THEME_CHECK_MODEL }),
    ),
    budget,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(meanings, null, 2)}\n`);
  const missing = tags.filter((entry) => !meanings.meanings[entry.tag]);
  console.log(
    `Recorded ${Object.keys(meanings.meanings).length} meanings. Spend so far: $${(budget.spent() / 1_000_000).toFixed(6)}`,
  );
  if (missing.length > 0) {
    console.error(`${missing.length} tags have no meaning yet. Run again.`);
    return false;
  }
  const recording = await recordThemeEmbeddings({
    tags,
    embedder: createOpenAiEmbeddingClient({
      apiKey,
      model: THEME_EMBEDDING_MODEL,
    }),
    budget,
    meanings: meanings.meanings,
  });
  const embeddingPath = themeRecordingPath(
    THEME_EMBEDDING_MODEL,
    THEME_EMBEDDING_DIMENSIONS,
    TAG_MEANING_TEMPLATE,
  );
  writeFileSync(embeddingPath, `${JSON.stringify(recording, null, 2)}\n`);
  const rows = sweep(tags, recording.vectors);
  console.log(renderThemeTable(rows, chooseThreshold(rows)));
  console.log(
    `Embedded ${tags.length} tags with meanings. Spend: $${(budget.spent() / 1_000_000).toFixed(6)}`,
  );
  return true;
}

async function recordThemes(
  apiKey: string,
  model = THEME_EMBEDDING_MODEL,
): Promise<boolean> {
  const budget = inMemoryBudget();
  const recording = await recordThemeEmbeddings({
    tags: loadLabelledTags(),
    embedder: createOpenAiEmbeddingClient({ apiKey, model }),
    budget,
    model,
  });
  const path = themeRecordingPath(model);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(
    `Recorded ${Object.keys(recording.vectors).length} tags. Spend: $${(budget.spent() / 1_000_000).toFixed(6)}`,
  );
  return await themeReport(model);
}

function report(models?: readonly string[]): boolean {
  const cases = loadCases();
  const recordings = loadRecordings().filter(
    (recording) => !models?.length || models.includes(recording.model),
  );
  if (recordings.length === 0) {
    console.error("No recordings yet. Run pnpm eval --live --model <id>.");
    return false;
  }
  const results = recordings.map((recording) =>
    scoreRecording(cases, recording),
  );
  console.log(renderTable(results));
  writeFileSync(REPORT_PATH, renderReport(cases, results));
  console.log(`\nWrote ${REPORT_PATH}`);
  return results.some((result) => result.passed);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean", default: false },
      replay: { type: "boolean", default: false },
      resolution: { type: "boolean", default: false },
      themes: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      describe: { type: "boolean", default: false },
      meanings: { type: "boolean", default: false },
      place: { type: "boolean", default: false },
      candidates: { type: "string" },
      "check-model": { type: "string" },
      cap: { type: "string" },
      low: { type: "string", multiple: true },
      high: { type: "string", multiple: true },
      "min-score": { type: "string", multiple: true },
      rounds: { type: "string" },
      model: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  if (values.resolution) {
    const result = await runResolutionEval();
    const body = renderResolutionReport(result);
    writeFileSync(RESOLUTION_REPORT_PATH, body);
    console.log(body);
    return 0;
  }

  if (values.themes) {
    if ((values.model?.length ?? 0) > 1) {
      console.error("--themes takes at most one --model.");
      return 1;
    }
    const themeModel = values.model?.[0] ?? THEME_EMBEDDING_MODEL;
    if (!values.live) return (await themeReport(themeModel)) ? 0 : 1;
    loadDotEnv();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("--themes --live needs OPENAI_API_KEY.");
      return 1;
    }
    if (values.describe) return (await recordMeanings(apiKey)) ? 0 : 1;
    if (values.check) {
      const checkModel = values["check-model"] ?? THEME_CHECK_MODEL;
      if (!(THEME_CHECK_MODELS as readonly string[]).includes(checkModel)) {
        console.error(`Unknown check model ${checkModel}.`);
        return 1;
      }
      const template = values.meanings
        ? TAG_MEANING_TEMPLATE
        : TAG_EMBEDDING_TEMPLATE;
      const lows = parseTaus(values.low);
      const highs = parseTaus(values.high);
      const minScores = values["min-score"]?.map(Number);
      const candidates = values.candidates
        ? Number(values.candidates)
        : undefined;
      const grid = (
        lows && highs
          ? themeBandGrid(lows, highs, minScores ?? [undefined])
          : themeBandGridFor(checkModel, template)
      ).map((bands) =>
        values.place ? { ...bands, candidates, pairScores: true } : bands,
      );
      const rounds = values.rounds ? Number(values.rounds) : undefined;
      const capUsdMicros = values.cap
        ? Math.round(Number(values.cap) * 1_000_000)
        : THEME_CHECK_LIVE_CAP_USD_MICROS;
      return (await recordChecks(
        apiKey,
        grid,
        template,
        checkModel,
        capUsdMicros,
        rounds,
      ))
        ? 0
        : 1;
    }
    return (await recordThemes(apiKey, themeModel)) ? 0 : 1;
  }

  if (values.replay) return report(values.model) ? 0 : 1;

  if (values.live) {
    loadDotEnv();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("--live needs OPENAI_API_KEY.");
      return 1;
    }
    if (!values.model?.length) {
      console.error("--live needs at least one --model.");
      return 1;
    }
    const budget = inMemoryBudget();
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    for (const model of values.model) {
      const llm = createOpenAiClient({ apiKey, model });
      const recording = await recordModel(model, llm, budget);
      writeFileSync(
        join(RECORDINGS_DIR, `${model}.json`),
        `${JSON.stringify(recording, null, 2)}\n`,
      );
    }
    console.log(`Total spend: $${(budget.spent() / 1_000_000).toFixed(4)}`);
    return report() ? 0 : 1;
  }

  console.log(USAGE);
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
