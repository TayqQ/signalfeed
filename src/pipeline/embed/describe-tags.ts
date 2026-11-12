// Tag meanings (D48, option 2): the LLM writes a short plain-English meaning
// for a tag, and the embedding input carries both, so jargon such as "baas"
// lands near what it means. The theme eval measured this and it did not beat
// the plain template, so the pipeline does not call it. Every call goes
// through `BudgetGuard`.

import { z } from "zod";
import type { LlmPurpose } from "@/core/enums";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient, LlmTokenUsage } from "@/core/ports";
import { costUsdMicros, estimateCost } from "../extract/pricing";

/**
 * Bump with any change to the prompt or schema. It is part of the meaning
 * embedding template, so vectors from another version never mix.
 */
export const TAG_MEANING_PROMPT_VERSION = "meaning-v1";
export const TAG_MEANINGS_SCHEMA_NAME = "tag_meanings";
/** Tags per LLM call. */
export const TAG_MEANING_BATCH_SIZE = 40;
/** Longer meanings are cut at a word boundary. The prompt asks for far less. */
export const TAG_MEANING_MAX_LENGTH = 160;
const TAG_MEANING_MIN_LENGTH = 3;

/**
 * Strict output of one call. Plain strings only, with no length keywords:
 * OpenAI strict mode may reject them. Length is checked in code.
 */
export const tagMeaningsSchema = z.strictObject({
  tags: z.array(
    z.strictObject({
      id: z.number().int(),
      meaning: z
        .string()
        .describe("6 to 15 words: the product or service the tag stands for"),
      broad: z
        .boolean()
        .describe("True if the tag is a sector word spanning many markets"),
    }),
  ),
});

export function buildTagMeaningSystemPrompt(): string {
  // The examples are deliberately not tags from the labelled eval fixture.
  return [
    "You explain startup tags for a UK startup news site.",
    "For each tag, write what it means in plain British English, in 6 to 15 words: the product or service, and who buys it if that helps.",
    "Expand abbreviations and explain jargon. For example, crm: software that companies use to manage customer relationships and sales pipelines.",
    "Describe the market, not a company. Never name companies, products or people.",
    "Also say whether the tag is broad: a sector word that spans many different products and markets, such as fintech, cleantech, healthtech or retail. A broad tag's meaning says so, for example: technology sector spanning many financial products and services.",
    "A specific product or service is not broad, even when it is a large market. Customer relationship management, heat pumps and payroll software are not broad.",
    "Return one answer for every tag id.",
  ].join("\n");
}

export function buildTagMeaningUserPrompt(labels: readonly string[]): string {
  return JSON.stringify({
    tags: labels.map((tag, index) => ({ id: index + 1, tag })),
  });
}

/** About 30 tokens a meaning, plus room for reasoning. */
export function meaningMaxOutputTokens(batchSize: number): number {
  return 4000 + 60 * batchSize;
}

/** A meaning on one line, cut at a word boundary to the maximum length. */
export function cleanMeaning(raw: string): string | null {
  let meaning = raw.replace(/\s+/g, " ").trim();
  if (meaning.length > TAG_MEANING_MAX_LENGTH) {
    const cut = meaning.slice(0, TAG_MEANING_MAX_LENGTH);
    const space = cut.lastIndexOf(" ");
    meaning = (space > 0 ? cut.slice(0, space) : cut).trim();
  }
  meaning = meaning.replace(/[\s.;,:]+$/, "");
  return meaning.length >= TAG_MEANING_MIN_LENGTH ? meaning : null;
}

/** What the LLM says about one tag. */
export interface TagMeaning {
  meaning: string;
  /** A sector word that spans many markets. */
  broad: boolean;
}

/** Meanings by label from one call's output. Ids not asked and repeats are left out. */
export function acceptedMeanings(
  data: unknown,
  labels: readonly string[],
): Map<string, TagMeaning> {
  const meanings = new Map<string, TagMeaning>();
  const parsed = tagMeaningsSchema.safeParse(data);
  if (!parsed.success) return meanings;
  for (const { id, meaning, broad } of parsed.data.tags) {
    const label = labels[id - 1];
    if (label === undefined || meanings.has(label)) continue;
    const clean = cleanMeaning(meaning);
    if (clean) meanings.set(label, { meaning: clean, broad });
  }
  return meanings;
}

export interface DescribeTagsDeps {
  llm: LlmClient;
  budget: BudgetGuard;
  /** For pricing and the usage row. The client is already bound to it. */
  model: string;
  purpose: LlmPurpose;
  runId?: number;
  batchSize?: number;
}

export interface DescribeTagsResult {
  meanings: Map<string, TagMeaning>;
  calls: number;
  /** Labels sent with no usable meaning back. They are asked again next time. */
  invalid: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  /** True when the budget refused a call. Labels not sent have no meaning. */
  budgetPaused?: boolean;
}

function isTokenUsage(value: unknown): value is LlmTokenUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  return (
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number"
  );
}

/**
 * Asks for the meaning of each label, in batches, through the budget guard.
 * A budget refusal stops the asking and is reported. Invalid output is
 * recorded as spend and leaves those labels without a meaning. Any other
 * error, such as a provider refusal, is thrown.
 */
export async function describeTags(
  labels: readonly string[],
  deps: DescribeTagsDeps,
): Promise<DescribeTagsResult> {
  const { llm, budget, model, purpose, runId } = deps;
  const batchSize = deps.batchSize ?? TAG_MEANING_BATCH_SIZE;
  const result: DescribeTagsResult = {
    meanings: new Map(),
    calls: 0,
    invalid: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
  const system = buildTagMeaningSystemPrompt();

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

  for (let start = 0; start < labels.length; start += batchSize) {
    const batch = labels.slice(start, start + batchSize);
    const user = buildTagMeaningUserPrompt(batch);
    const maxOutputTokens = meaningMaxOutputTokens(batch.length);
    try {
      await budget.assertCanSpend(
        estimateCost({ model, system, user, maxOutputTokens }),
      );
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        result.budgetPaused = true;
        return result;
      }
      throw error;
    }

    result.calls += 1;
    try {
      const completion = await llm.complete({
        system,
        user,
        schema: tagMeaningsSchema,
        schemaName: TAG_MEANINGS_SCHEMA_NAME,
        maxOutputTokens,
      });
      await record(completion.usage);
      const accepted = acceptedMeanings(completion.data, batch);
      for (const [label, meaning] of accepted) {
        result.meanings.set(label, meaning);
      }
      result.invalid += batch.length - accepted.size;
    } catch (error) {
      if (error instanceof ExtractionValidationError) {
        // Tokens already billed when the adapter rejects the model JSON.
        const usage = (error as { usage?: unknown }).usage;
        if (isTokenUsage(usage)) await record(usage);
        result.invalid += batch.length;
        continue;
      }
      throw error;
    }
  }
  return result;
}
