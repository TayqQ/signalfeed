import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "@/cli/env";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient } from "@/core/ports";
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

const REPORT_PATH = "docs/eval-results.md";
const RESOLUTION_REPORT_PATH = "docs/resolution-eval-results.md";
const LIVE_CAP_USD_MICROS = 1_000_000;

const USAGE = `Usage: pnpm eval <mode>

  --replay [--model <id>]        Score committed recordings. No network, no cost
  --live --model <id> [...]      Call the model on every case and record it. Costs money
  --resolution                   Score company and event merging. No network, no cost`;

/** A run-local cap, separate from the production budget table. */
function inMemoryBudget(): BudgetGuard & { spent(): number } {
  let spent = 0;
  return {
    assertCanSpend(estimate) {
      if (spent + estimate.usdMicros > LIVE_CAP_USD_MICROS) {
        return Promise.reject(
          new BudgetExceededError({
            model: estimate.model,
            estimateUsdMicros: estimate.usdMicros,
            spentUsdMicros: spent,
            capUsdMicros: LIVE_CAP_USD_MICROS,
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
      Promise.resolve({
        spentUsdMicros: spent,
        capUsdMicros: LIVE_CAP_USD_MICROS,
      }),
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
