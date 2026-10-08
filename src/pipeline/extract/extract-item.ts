import {
  EXTRACTION_SCHEMA_NAME,
  EXTRACTION_SCHEMA_V1,
  type ExtractionV1,
} from "@/core/extraction-schema";
import { ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient, LlmTokenUsage } from "@/core/ports";
import { costUsdMicros, estimateCost } from "./pricing";
import {
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
  type ExtractionPromptInput,
} from "./prompt";

export interface ExtractItemArgs {
  item: ExtractionPromptInput;
  llm: LlmClient;
  budget: BudgetGuard;
  model: string;
  maxOutputTokens?: number;
}

export interface ExtractItemResult {
  result: ExtractionV1;
  usage: LlmTokenUsage;
  costUsdMicros: number;
  promptVersion: typeof EXTRACTION_PROMPT_VERSION;
  model: string;
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

/** Tokens already billed when the adapter rejects the model JSON. */
function usageConsumedBeforeValidation(
  error: ExtractionValidationError,
): LlmTokenUsage | undefined {
  const usage = (error as { usage?: unknown }).usage;
  return isTokenUsage(usage) ? usage : undefined;
}

export async function extractItem({
  item,
  llm,
  budget,
  model,
  maxOutputTokens = 1200,
}: ExtractItemArgs): Promise<ExtractItemResult> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(item);
  const estimate = estimateCost({ model, system, user, maxOutputTokens });
  await budget.assertCanSpend(estimate);

  const record = async (usage: LlmTokenUsage): Promise<number> => {
    const actualCostUsdMicros = costUsdMicros(model, usage);
    await budget.record({
      purpose: "extraction",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsdMicros: actualCostUsdMicros,
    });
    return actualCostUsdMicros;
  };

  try {
    const completion = await llm.complete({
      system,
      user,
      schema: EXTRACTION_SCHEMA_V1,
      schemaName: EXTRACTION_SCHEMA_NAME,
      maxOutputTokens,
    });
    const actualCostUsdMicros = await record(completion.usage);
    return {
      result: completion.data,
      usage: completion.usage,
      costUsdMicros: actualCostUsdMicros,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model,
    };
  } catch (error) {
    if (error instanceof ExtractionValidationError) {
      const usage = usageConsumedBeforeValidation(error);
      if (usage) await record(usage);
    }
    throw error;
  }
}
