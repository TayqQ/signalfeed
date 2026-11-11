// The LLM check for tags in the similarity band (spec-phase2 section 7.1, D47).
// The greedy pass runs with the verdicts known so far. Band tags with no
// verdict are asked in batches, and the pass runs again, until nothing new is
// asked. Every call goes through `BudgetGuard`. A refusal or error stops the
// asking, and the rest fall back to the embedding-only rule.

import { z } from "zod";
import type { LlmPurpose } from "@/core/enums";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient, LlmTokenUsage } from "@/core/ports";
import { costUsdMicros, estimateCost } from "../extract/pricing";
import {
  DEFAULT_THEME_THRESHOLD,
  assignGreedy,
  type BandQuestion,
  type BandVerdict,
  type GreedyResult,
  type GreedyTag,
  type GreedyTheme,
  type ThemeBands,
} from "./cluster";

/** Bump with any change to the prompt or schema: recorded verdicts then stop matching. */
export const THEME_CHECK_PROMPT_VERSION = "theme-check-v2";
export const THEME_CHECK_SCHEMA_NAME = "theme_check";
/** The model the check was evaluated with (D47). */
export const THEME_CHECK_MODEL = "gpt-5.6-luna";
/** Band tags per LLM call. Small enough that one cut-off answer loses little. */
export const THEME_CHECK_BATCH_SIZE = 20;
/** Greedy passes that may ask new questions. Later questions fall back. */
export const THEME_CHECK_MAX_ROUNDS = 6;

/**
 * Strict output of one check call. `match` is the candidate number (1, 2 or
 * 3) or 0 for none. No string length keywords: OpenAI strict mode may reject them.
 */
export const themeCheckSchema = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      id: z.number().int(),
      match: z
        .number()
        .int()
        .describe("The candidate number the tag belongs to, or 0 for none"),
    }),
  ),
});
export type ThemeCheckOutput = z.infer<typeof themeCheckSchema>;

/** What one question shows the LLM. `BandQuestion` from `cluster.ts` fits. */
export interface CheckQuestion {
  key: string;
  tag: string;
  candidates: readonly { tags: readonly string[] }[];
}

export function buildThemeCheckSystemPrompt(): string {
  // The examples are deliberately not tags from the labelled eval fixture.
  return [
    "You sort startup tags into markets for a UK startup news site.",
    "A market is one specific product or service, named the way a founder would in one phrase. Markets are narrow. An industry or a sector is not a market.",
    "For each tag you get up to 3 candidate themes. Each candidate is a list of tags already in it, most common first. Judge a candidate by its first tags.",
    "Answer with the number of the candidate whose market the tag is, or 0.",
    "Same market, so join:",
    "- synonyms, spelling variants and abbreviations: crm and customer relationship management; hr software and hris;",
    "- the same product seen from another role: making, installing, financing, servicing or writing software for it. Heat pump installation and heat pump financing are both heat pumps.",
    "Different market, so answer 0:",
    "- a neighbouring product in the same industry: heat pumps and smart thermostats; payroll software and expense management; grocery delivery and restaurant delivery; the vehicles and the chargers for them;",
    "- a tag that shares a word but not the product: fraud detection and leak detection; data centres and data labelling;",
    "- a sector word, a word that spans many products, such as fintech, healthtech, cleantech, regtech, legaltech, proptech, insurtech, edtech, agritech, food tech, space tech, construction tech, digital health or logistics. A sector word joins only its own synonyms. It never joins a specific market or another sector word, and a specific market never joins it.",
    "When in doubt, answer 0. A wrong match does more harm than a missed one, because people can merge two themes later.",
    "Return one verdict for every tag id.",
  ].join("\n");
}

export function buildThemeCheckUserPrompt(
  batch: readonly CheckQuestion[],
): string {
  return JSON.stringify({
    tags: batch.map((question, index) => ({
      id: index + 1,
      tag: question.tag,
      candidates: question.candidates.map((candidate, n) => ({
        n: n + 1,
        tags: candidate.tags,
      })),
    })),
  });
}

/**
 * About 15 tokens a verdict plus room for reasoning, which `gpt-5.6-luna`
 * counts as output. The live eval saw answers cut off at 2,600 tokens.
 */
export function checkMaxOutputTokens(batchSize: number): number {
  return 4000 + 50 * batchSize;
}

/**
 * Verdicts by question key from one call's output. Ids that were not asked,
 * repeats and numbers past the candidate list are left out.
 */
export function acceptedVerdicts(
  data: unknown,
  batch: readonly CheckQuestion[],
): Map<string, BandVerdict> {
  const verdicts = new Map<string, BandVerdict>();
  const parsed = themeCheckSchema.safeParse(data);
  if (!parsed.success) return verdicts;
  for (const { id, match } of parsed.data.verdicts) {
    const question = batch[id - 1];
    if (!question || verdicts.has(question.key)) continue;
    if (match === 0) verdicts.set(question.key, null);
    else if (match >= 1 && match <= question.candidates.length) {
      verdicts.set(question.key, match - 1);
    }
  }
  return verdicts;
}

export interface ThemeCheckDeps {
  llm: LlmClient;
  budget: BudgetGuard;
  /** For pricing and the usage row. The client is already bound to it. */
  model: string;
  purpose: LlmPurpose;
  runId?: number;
  batchSize?: number;
}

export type ThemeCheckFallback = "budget" | "error";

export interface AskResult<V = BandVerdict> {
  verdicts: Map<string, V>;
  calls: number;
  /** Questions sent. Fewer than asked when a refusal stopped the asking. */
  sent: number;
  /** Questions sent with no usable verdict back. */
  invalid: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  /** Why asking stopped early. Questions not sent have no verdict. */
  fallback?: ThemeCheckFallback;
  error?: unknown;
}

function isTokenUsage(value: unknown): value is LlmTokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.inputTokens === "number" &&
    Number.isFinite(usage.inputTokens) &&
    typeof usage.outputTokens === "number" &&
    Number.isFinite(usage.outputTokens)
  );
}

interface AskSpec<Q, V> {
  system: string;
  user: (batch: readonly Q[]) => string;
  schema: z.ZodType;
  schemaName: string;
  accept: (data: unknown, batch: readonly Q[]) => Map<string, V>;
}

/** Asks about each question in batches, through the budget guard. */
async function askInBatches<Q, V>(
  questions: readonly Q[],
  deps: ThemeCheckDeps,
  spec: AskSpec<Q, V>,
): Promise<AskResult<V>> {
  const { llm, budget, model, purpose, runId } = deps;
  const batchSize = deps.batchSize ?? THEME_CHECK_BATCH_SIZE;
  const result: AskResult<V> = {
    verdicts: new Map(),
    calls: 0,
    sent: 0,
    invalid: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
  const { system } = spec;

  const record = async (usage: LlmTokenUsage) => {
    const cost = costUsdMicros(model, usage);
    result.inputTokens += usage.inputTokens;
    result.outputTokens += usage.outputTokens;
    result.costUsdMicros += cost;
    await budget.record({
      purpose,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsdMicros: cost,
      ingestRunId: runId,
    });
  };

  for (let start = 0; start < questions.length; start += batchSize) {
    const batch = questions.slice(start, start + batchSize);
    const user = spec.user(batch);
    const maxOutputTokens = checkMaxOutputTokens(batch.length);
    try {
      await budget.assertCanSpend(
        estimateCost({ model, system, user, maxOutputTokens }),
      );
    } catch (error) {
      result.fallback =
        error instanceof BudgetExceededError ? "budget" : "error";
      result.error = error;
      return result;
    }

    result.calls += 1;
    result.sent += batch.length;
    try {
      const completion = await llm.complete({
        system,
        user,
        schema: spec.schema,
        schemaName: spec.schemaName,
        maxOutputTokens,
      });
      await record(completion.usage);
      const accepted = spec.accept(completion.data, batch);
      for (const [key, verdict] of accepted) result.verdicts.set(key, verdict);
      result.invalid += batch.length - accepted.size;
    } catch (error) {
      if (error instanceof ExtractionValidationError) {
        // Tokens already billed when the adapter rejects the model JSON.
        const usage = (error as { usage?: unknown }).usage;
        if (isTokenUsage(usage)) await record(usage);
        result.invalid += batch.length;
        continue;
      }
      result.fallback = "error";
      result.error = error;
      return result;
    }
  }
  return result;
}

/** Asks the LLM about each band tag, in batches, through the budget guard. */
export function askThemeChecks(
  questions: readonly CheckQuestion[],
  deps: ThemeCheckDeps,
): Promise<AskResult> {
  return askInBatches(questions, deps, {
    system: buildThemeCheckSystemPrompt(),
    user: buildThemeCheckUserPrompt,
    schema: themeCheckSchema,
    schemaName: THEME_CHECK_SCHEMA_NAME,
    accept: acceptedVerdicts,
  });
}

export interface ThemeCheckStats {
  /** Greedy passes run. */
  rounds: number;
  calls: number;
  /** Distinct tag questions sent to the LLM. */
  questions: number;
  /** Band tags the final pass joined to a candidate by a verdict. */
  joined: number;
  /** Band tags the final pass started a theme for by a verdict of none. */
  rejected: number;
  /** Band tags the final pass placed by the embedding-only fallback. */
  fallbacks: number;
  /** Questions sent with no usable verdict back. */
  invalid: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  /** Set when a budget refusal or an error stopped the asking. */
  fallback?: ThemeCheckFallback;
  /** The message, for `fallback: "error"`. */
  errorMessage?: string;
  /** The error itself, so the caller can tell a provider refusal apart. */
  error?: unknown;
}

export interface AssignWithCheckInput {
  tags: readonly GreedyTag[];
  themes: readonly GreedyTheme[];
  /** Embedding-only τ: the rule with no client, and the fallback in the band. */
  threshold?: number;
  bands: ThemeBands;
  /** Absent: embedding only, as before D47. */
  check?: ThemeCheckDeps;
  maxRounds?: number;
}

export interface AssignWithCheckResult {
  greedy: GreedyResult;
  /** Absent when no LLM client was given. */
  stats?: ThemeCheckStats;
}

function addAsk<V>(stats: ThemeCheckStats, answer: AskResult<V>): void {
  stats.calls += answer.calls;
  stats.invalid += answer.invalid;
  stats.inputTokens += answer.inputTokens;
  stats.outputTokens += answer.outputTokens;
  stats.costUsdMicros += answer.costUsdMicros;
  if (answer.fallback) {
    stats.fallback = answer.fallback;
    stats.error = answer.error;
    if (answer.fallback === "error") {
      stats.errorMessage =
        answer.error instanceof Error
          ? answer.error.message
          : String(answer.error);
    }
  }
}

/**
 * Greedy assignment with the two-band LLM check. Runs the greedy pass with the
 * verdicts so far, asks the new band questions, and repeats until a pass asks
 * nothing new. Never throws for a refused or failed call: those tags fall back
 * to the embedding-only rule.
 */
export async function assignWithThemeCheck({
  tags,
  themes,
  threshold = DEFAULT_THEME_THRESHOLD,
  bands,
  check,
  maxRounds = THEME_CHECK_MAX_ROUNDS,
}: AssignWithCheckInput): Promise<AssignWithCheckResult> {
  if (!check) {
    return { greedy: assignGreedy({ tags, themes, threshold }) };
  }

  // By `refKey`: the chosen candidate's ref, or null for none. A verdict
  // stands while the tag's candidate set is the same, even as members change.
  const chosen = new Map<string, string | null>();
  const asked = new Set<string>();
  const verdictFor = (question: BandQuestion): BandVerdict | undefined => {
    const ref = chosen.get(question.refKey);
    if (ref === undefined) return undefined;
    if (ref === null) return null;
    const index = question.candidates.findIndex((c) => c.ref === ref);
    return index === -1 ? undefined : index;
  };
  const stats: ThemeCheckStats = {
    rounds: 0,
    calls: 0,
    questions: 0,
    joined: 0,
    rejected: 0,
    fallbacks: 0,
    invalid: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };

  for (;;) {
    stats.rounds += 1;
    const greedy = assignGreedy({
      tags,
      themes,
      threshold,
      check: { bands, verdictFor },
    });

    const fresh: BandQuestion[] = [];
    for (const question of greedy.unanswered) {
      if (asked.has(question.refKey)) continue;
      asked.add(question.refKey);
      fresh.push(question);
    }

    if (fresh.length === 0 || stats.fallback || stats.rounds > maxRounds) {
      for (const assignment of greedy.assignments) {
        if (assignment.decision === "fallback") stats.fallbacks += 1;
        if (assignment.decision === "llm_join") stats.joined += 1;
        if (assignment.decision === "llm_new") stats.rejected += 1;
      }
      return { greedy, stats };
    }

    const answer = await askThemeChecks(fresh, check);
    stats.questions += answer.sent;
    for (const question of fresh) {
      const verdict = answer.verdicts.get(question.key);
      if (verdict === undefined) continue;
      chosen.set(
        question.refKey,
        verdict === null ? null : question.candidates[verdict]!.ref,
      );
    }
    addAsk(stats, answer);
  }
}
