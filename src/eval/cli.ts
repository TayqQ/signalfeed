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
import type { ThemeBands } from "@/pipeline/themes/cluster";
import { THEME_CHECK_MODEL } from "@/pipeline/themes/theme-check";
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
  THEME_BAND_GRID,
  THEME_EMBEDDING_MODEL,
  THEME_RECORDING_PATH,
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
const THEME_CHECK_LIVE_CAP_USD_MICROS = 50_000;

const USAGE = `Usage: pnpm eval <mode>

  --replay [--model <id>]        Score committed recordings. No network, no cost
  --live --model <id> [...]      Call the model on every case and record it. Costs money
  --resolution                   Score company and event merging. No network, no cost
  --themes                       Sweep the theme threshold on the recorded embeddings. No network, no cost
  --themes --live                Embed the labelled tags once and record them. Costs well under $0.001
  --themes [--live] --model <id> The same with another embedding model. Prints the sweep; the report stays the default model's
  --themes --check --live [--low <τ>... --high <τ>...] [--rounds <n>]
                                 Record LLM check verdicts for the band grid. Capped at $0.05 a run`;

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

  let check: Parameters<typeof renderThemeReport>[3];
  const checkPath = themeCheckRecordingPath();
  if (existsSync(checkPath)) {
    const checkRecording = loadThemeCheckRecording(checkPath);
    const { rows: bandRows } = await sweepBands(
      tags,
      recording.vectors,
      checkRecording,
    );
    const chosen = bandRows.some((row) => row.missing === 0)
      ? chooseBands(bandRows)
      : undefined;
    console.log("");
    console.log(renderBandTable(bandRows, chosen, tags.length, checkRecording));
    check = { rows: bandRows, recording: checkRecording };
  } else {
    console.log(`No LLM check verdicts at ${checkPath}.`);
  }
  writeFileSync(
    THEME_REPORT_PATH,
    renderThemeReport(rows, tags, recording, check),
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
  maxRounds?: number,
): Promise<boolean> {
  const tags = loadLabelledTags();
  const embeddings = loadThemeRecording(tags).vectors;
  const path = themeCheckRecordingPath();
  const existing: ThemeCheckRecording = existsSync(path)
    ? loadThemeCheckRecording(path)
    : emptyThemeCheckRecording(THEME_RECORDING_PATH);
  const budget = inMemoryBudget(THEME_CHECK_LIVE_CAP_USD_MICROS);
  const save = (recording: ThemeCheckRecording) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
  };
  const result = await recordThemeChecks({
    tags,
    embeddings,
    recording: existing,
    llm: loggingClient(
      createOpenAiClient({ apiKey, model: THEME_CHECK_MODEL }),
    ),
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
      low: { type: "string", multiple: true },
      high: { type: "string", multiple: true },
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
    if (values.check) {
      const lows = parseTaus(values.low);
      const highs = parseTaus(values.high);
      const grid = lows && highs ? themeBandGrid(lows, highs) : THEME_BAND_GRID;
      const rounds = values.rounds ? Number(values.rounds) : undefined;
      return (await recordChecks(apiKey, grid, rounds)) ? 0 : 1;
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
