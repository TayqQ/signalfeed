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
  DEFAULT_THEME_BANDS,
  DEFAULT_THEME_THRESHOLD,
  THEME_CHECK_MAX_CANDIDATES,
  THEME_CHECK_MIN_SCORE,
  assignGreedy,
  bandQuestionKey,
  type BandQuestion,
  type BandVerdict,
  type GreedyResult,
  type GreedyTag,
  type GreedyTheme,
  type ThemeBands,
} from "./cluster";

/** Bump with any change to the prompt or schema: recorded verdicts then stop matching. */
export const THEME_CHECK_PROMPT_VERSION = "theme-check-v4";
/** The graded prompt's schema name (D48). */
export const THEME_SCORES_SCHEMA_NAME = "theme_scores";
/** The one-answer prompt's schema name (D47), the default. */
export const THEME_CHECK_SCHEMA_NAME = "theme_check";
/** The one-answer prompt chosen in D47 and kept as the default in D49. */
export const THEME_PICK_PROMPT_VERSION = "theme-check-v2";
/** The model the check was evaluated with (D47). */
export const THEME_CHECK_MODEL = "gpt-5.6-luna";
/** Band tags per LLM call. Small enough that one cut-off answer loses little. */
export const THEME_CHECK_BATCH_SIZE = 20;
/** Greedy passes that may ask new questions. Later questions fall back. */
export const THEME_CHECK_MAX_ROUNDS = 10;
/** Scores run from 0 (unrelated) to this (synonyms). */
export const THEME_CHECK_MAX_SCORE = 10;

/**
 * Strict output of one check call: a score for each candidate, in order. No
 * string length keywords or array size keywords: OpenAI strict mode may
 * reject them. The count and range are checked in code (`acceptedVerdicts`).
 */
export const themeCheckSchema = z.strictObject({
  verdicts: z.array(
    z.strictObject({
      id: z.number().int(),
      scores: z
        .array(z.number().int())
        .describe(
          "One score from 0 to 10 for each candidate, in candidate order",
        ),
    }),
  ),
});
export type ThemeCheckOutput = z.infer<typeof themeCheckSchema>;

/** Candidate scores for one question, in candidate order. */
export type CheckScores = readonly number[];

/** What one question shows the LLM. `BandQuestion` from `cluster.ts` fits. */
export interface CheckQuestion {
  key: string;
  tag: string;
  candidates: readonly { tags: readonly string[] }[];
}

/** The prompt for placing every tag among many candidates (D48, option 3). */
export const THEME_PLACE_PROMPT_VERSION = "theme-place-v1";

/** True when the setting uses graded scores rather than one answer. */
export function usesScores(bands: ThemeBands): boolean {
  return Boolean(bands.scores || bands.pairScores);
}

/** The prompt version for a band setting. */
export function themeCheckPromptVersion(bands: ThemeBands): string {
  if (bands.pairScores) {
    return `${THEME_PLACE_PROMPT_VERSION}-c${bands.candidates ?? THEME_CHECK_MAX_CANDIDATES}`;
  }
  return bands.scores ? THEME_CHECK_PROMPT_VERSION : THEME_PICK_PROMPT_VERSION;
}

/** The strict output schema for a band setting. */
export function themeCheckSchemaFor(bands: ThemeBands): z.ZodType {
  return usesScores(bands) ? themeCheckSchema : themePickSchema;
}

/** The system prompt for a band setting. */
export function themeCheckSystemPrompt(bands: ThemeBands): string {
  if (!usesScores(bands)) return buildThemePickSystemPrompt();
  if (!bands.pairScores) return buildThemeCheckSystemPrompt();
  return buildThemeCheckSystemPrompt().replace(
    "you get up to 3 candidate themes",
    `you get up to ${bands.candidates ?? THEME_CHECK_MAX_CANDIDATES} candidate themes, the closest by meaning first`,
  );
}

/**
 * Strict output of the one-answer prompt (D47): `match` is the candidate
 * number, or 0 for none. No string length keywords.
 */
export const themePickSchema = z.strictObject({
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

/** The one-answer prompt (D47). Its text must not change: recordings hash it. */
export function buildThemePickSystemPrompt(): string {
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

/**
 * One-answer verdicts as scores, so both prompts share one join rule: the
 * chosen candidate scores 10 and the rest 0. Ids not asked, repeats and
 * numbers past the candidate list are left out.
 */
export function acceptedPicks(
  data: unknown,
  batch: readonly CheckQuestion[],
): Map<string, CheckScores> {
  const verdicts = new Map<string, CheckScores>();
  const parsed = themePickSchema.safeParse(data);
  if (!parsed.success) return verdicts;
  for (const { id, match } of parsed.data.verdicts) {
    const question = batch[id - 1];
    if (!question || verdicts.has(question.key)) continue;
    if (match < 0 || match > question.candidates.length) continue;
    verdicts.set(
      question.key,
      question.candidates.map((_, i) =>
        i + 1 === match ? THEME_CHECK_MAX_SCORE : 0,
      ),
    );
  }
  return verdicts;
}

export function buildThemeCheckSystemPrompt(): string {
  // The examples are deliberately not tags from the labelled eval fixture.
  return [
    "You sort startup tags into markets for a UK startup news site.",
    "Think of a market map of startups. A market is one box on that map: one kind of product or service that a buyer buys to do one job, named the way a founder would in a short phrase.",
    "For each tag you get up to 3 candidate themes. Each candidate is a list of tags already in it, most common first. Judge a candidate by its first tags.",
    "Score every candidate from 0 to 10 for how close the tag is to the candidate's market. Use the whole scale:",
    "- 10: the same thing: a synonym, spelling variant or abbreviation (crm and customer relationship management; hris and hr software).",
    "- 8 or 9: the same product seen from another role: making, installing, financing, servicing or writing software for it (heat pump installation and heat pump financing).",
    "- 6 or 7: a narrower part of the same product: a sub-type, technique or feature that does the same job for the same buyer (applicant tracking and recruiting software; transaction monitoring and anti-money laundering).",
    "- 4 or 5: a sibling: a different product for a related job, in the same area or for the same customers (hiring software and payroll software; heat pumps and smart thermostats; the vehicles and the chargers for them; chip design software and chip fabrication).",
    "- 2 or 3: only the same broad sector.",
    "- 0 or 1: unrelated, or the tags only share a word (fraud detection and leak detection).",
    "Sector words span many markets: fintech, healthtech, cleantech, regtech, legaltech, proptech, insurtech, edtech, agritech, food tech, space tech, construction tech, digital health, logistics and the like. A sector word scores 10 against its own synonyms and 3 or less against anything else, in both directions: a specific market scores 3 or less against a candidate led by a sector word.",
    "Return one verdict for every tag id, with exactly one score per candidate.",
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
 * About 25 tokens a verdict plus room for reasoning, which `gpt-5.6-luna`
 * counts as output. The live eval saw answers cut off at 2,600 tokens.
 */
export function checkMaxOutputTokens(batchSize: number): number {
  return 4000 + 60 * batchSize;
}

/**
 * Scores by question key from one call's output. Ids that were not asked,
 * repeats, and answers with the wrong number of scores or a score out of
 * range are left out.
 */
export function acceptedVerdicts(
  data: unknown,
  batch: readonly CheckQuestion[],
): Map<string, CheckScores> {
  const verdicts = new Map<string, CheckScores>();
  const parsed = themeCheckSchema.safeParse(data);
  if (!parsed.success) return verdicts;
  for (const { id, scores } of parsed.data.verdicts) {
    const question = batch[id - 1];
    if (!question || verdicts.has(question.key)) continue;
    if (scores.length !== question.candidates.length) continue;
    if (scores.some((s) => s < 0 || s > THEME_CHECK_MAX_SCORE)) continue;
    verdicts.set(question.key, scores);
  }
  return verdicts;
}

/**
 * The verdict from scores: the best-scoring candidate (the first on a tie)
 * when its score is at least `minScore`, otherwise none.
 */
export function verdictFromScores(
  scores: CheckScores,
  minScore: number,
): BandVerdict {
  let best = -1;
  for (const [index, score] of scores.entries()) {
    if (best === -1 || score > scores[best]!) best = index;
  }
  return best !== -1 && scores[best]! >= minScore ? best : null;
}

export interface ThemeCheckDeps {
  llm: LlmClient;
  budget: BudgetGuard;
  /** For pricing and the usage row. The client is already bound to it. */
  model: string;
  purpose: LlmPurpose;
  runId?: number;
  batchSize?: number;
  /**
   * Used instead of `llm` from the first call that fails with an error other
   * than invalid output (D49). Typically the cheaper default model.
   */
  fallbackLlm?: { llm: LlmClient; model: string };
}

export type ThemeCheckFallback = "budget" | "error";

export interface AskResult<V = CheckScores> {
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
  /** The fallback model, when the main model failed and asking switched to it. */
  switched?: string;
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
  const { budget, purpose, runId } = deps;
  let { llm, model } = deps;
  let fallbackLlm = deps.fallbackLlm;
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

  for (let start = 0; start < questions.length;) {
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
        start += batchSize;
        continue;
      }
      if (fallbackLlm) {
        // Switch for the rest of the run and ask this batch again.
        ({ llm, model } = fallbackLlm);
        fallbackLlm = undefined;
        result.switched = model;
        result.sent -= batch.length;
        continue;
      }
      result.fallback = "error";
      result.error = error;
      return result;
    }
    start += batchSize;
  }
  return result;
}

/**
 * Asks the LLM about each band tag, in batches, through the budget guard,
 * with the prompt for `mode`. Answers come back as scores either way.
 */
export function askThemeChecks(
  questions: readonly CheckQuestion[],
  deps: ThemeCheckDeps,
  mode: ThemeBands = DEFAULT_THEME_BANDS,
): Promise<AskResult> {
  const scores = usesScores(mode);
  return askInBatches(questions, deps, {
    system: themeCheckSystemPrompt(mode),
    user: buildThemeCheckUserPrompt,
    schema: themeCheckSchemaFor(mode),
    schemaName: scores ? THEME_SCORES_SCHEMA_NAME : THEME_CHECK_SCHEMA_NAME,
    accept: scores ? acceptedVerdicts : acceptedPicks,
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
  /** Set when the check model failed and the fallback model took over. */
  switchedTo?: string;
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
  let deps: ThemeCheckDeps = check;

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
  // Placing mode: scores are kept per tag and candidate theme, so a new
  // candidate is asked about alone and the rest are not asked again.
  const pairs = new Map<string, number>();
  const pairKey = (question: BandQuestion, ref: string) =>
    `${question.tagId}|${ref}`;
  const minScore = bands.minScore ?? THEME_CHECK_MIN_SCORE;
  const pairVerdictFor = (question: BandQuestion): BandVerdict | undefined => {
    const scores = question.candidates.map((c) =>
      pairs.get(pairKey(question, c.ref)),
    );
    if (scores.some((score) => score === undefined)) return undefined;
    return verdictFromScores(scores as number[], minScore);
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
      check: {
        bands,
        verdictFor: bands.pairScores ? pairVerdictFor : verdictFor,
      },
    });

    const fresh: BandQuestion[] = [];
    for (const question of greedy.unanswered) {
      if (bands.pairScores) {
        // Ask only about candidates never asked for this tag.
        const candidates = question.candidates.filter(
          (c) => !asked.has(pairKey(question, c.ref)),
        );
        if (candidates.length === 0) continue;
        for (const c of candidates) asked.add(pairKey(question, c.ref));
        fresh.push({
          ...question,
          candidates,
          key: bandQuestionKey(question.tag, candidates),
        });
        continue;
      }
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

    const answer = await askThemeChecks(fresh, deps, bands);
    if (answer.switched && deps.fallbackLlm) {
      // Later passes stay on the fallback model.
      deps = {
        ...deps,
        llm: deps.fallbackLlm.llm,
        model: deps.fallbackLlm.model,
        fallbackLlm: undefined,
      };
      stats.switchedTo = answer.switched;
    }
    stats.questions += answer.sent;
    for (const question of fresh) {
      const scores = answer.verdicts.get(question.key);
      if (scores === undefined) continue;
      if (bands.pairScores) {
        for (const [i, c] of question.candidates.entries()) {
          pairs.set(pairKey(question, c.ref), scores[i]!);
        }
        continue;
      }
      const verdict = verdictFromScores(scores, minScore);
      chosen.set(
        question.refKey,
        verdict === null ? null : question.candidates[verdict]!.ref,
      );
    }
    addAsk(stats, answer);
  }
}
