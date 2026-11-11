import type { CostEstimate, ModelPrice } from "@/core/domain";
import { UnknownModelPriceError } from "@/core/errors";
import type { LlmTokenUsage } from "@/core/ports";

/**
 * USD per 1M tokens for the extraction models in docs/sources.md A10
 * (OpenAI docs snapshots, 8 Oct and 10 Nov 2026). Retired models stay listed so
 * stored usage rows can still be priced.
 */
export const MODEL_PRICES: ModelPrice[] = [
  { model: "gpt-4.1-nano", inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  { model: "gpt-4.1-mini", inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
  { model: "gpt-4o-mini", inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
  { model: "o4-mini", inputUsdPerMillion: 1.1, outputUsdPerMillion: 4.4 },
  // OpenAI pricing page, 10 Nov 2026. gpt-4.1-nano shut down 23 Oct 2026;
  // gpt-4o-mini and gpt-4.1-mini snapshots shut down 14 Jan 2027.
  { model: "gpt-5.6-luna", inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  { model: "gpt-5.4-nano", inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.25 },
  { model: "gpt-5.4-mini", inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5 },
  // Embeddings price input only. OpenAI pricing page, checked 11 Nov 2026 (A15).
  {
    model: "text-embedding-3-small",
    inputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
  },
  // OpenAI pricing page, checked 11 Nov 2026. Evaluated for themes; not the default.
  {
    model: "text-embedding-3-large",
    inputUsdPerMillion: 0.13,
    outputUsdPerMillion: 0,
  },
];

export interface EstimateCostInput {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
}

function priceFor(model: string): ModelPrice {
  const price = MODEL_PRICES.find((entry) => entry.model === model);
  if (!price) throw new UnknownModelPriceError(model);
  return price;
}

/** characters/4 × 1.2, rounded up so the budget check does not under-count. */
export function estimateInputTokens(system: string, user: string): number {
  const characters = system.length + user.length;
  return Math.ceil((characters * 3) / 10);
}

function usdMicrosForTokens(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice,
): number {
  const inputMicrosPerMillion = Math.round(
    price.inputUsdPerMillion * 1_000_000,
  );
  const outputMicrosPerMillion = Math.round(
    price.outputUsdPerMillion * 1_000_000,
  );
  const micros =
    inputTokens * inputMicrosPerMillion + outputTokens * outputMicrosPerMillion;
  return Math.ceil(micros / 1_000_000);
}

export function estimateCost({
  model,
  system,
  user,
  maxOutputTokens,
}: EstimateCostInput): CostEstimate {
  const price = priceFor(model);
  const estimatedInputTokens = estimateInputTokens(system, user);
  return {
    model,
    estimatedInputTokens,
    maxOutputTokens,
    usdMicros: usdMicrosForTokens(estimatedInputTokens, maxOutputTokens, price),
  };
}

export function costUsdMicros(model: string, usage: LlmTokenUsage): number {
  return usdMicrosForTokens(
    usage.inputTokens,
    usage.outputTokens,
    priceFor(model),
  );
}

/**
 * Worst-case cost of one embedding call. Uses the same characters × 0.3 rule as
 * `estimateInputTokens`, rounded up. Refuses a model with no price.
 */
export function estimateEmbeddingCost(
  model: string,
  inputs: readonly string[],
): CostEstimate {
  const price = priceFor(model);
  const characters = inputs.reduce((total, text) => total + text.length, 0);
  const estimatedInputTokens = Math.ceil((characters * 3) / 10);
  return {
    model,
    estimatedInputTokens,
    maxOutputTokens: 0,
    usdMicros: usdMicrosForTokens(estimatedInputTokens, 0, price),
  };
}
