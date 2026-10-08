import type { LlmPurpose, SourceKind } from "./enums";

/** ISO 4217 currency code, upper case (e.g. "GBP", "USD", "EUR"). */
export type CurrencyCode = string;

/** An amount in integer minor units (pence, cents) with its ISO 4217 currency. */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

/** A configured news source, as seeded into the `sources` table. */
export interface SourceConfig {
  slug: string;
  name: string;
  kind: SourceKind;
  url: string;
  /** Higher wins ties when canonical event fields are recomputed. */
  priority: number;
  enabled: boolean;
}

/** One item returned by a collector, before it is stored. */
export interface CollectedItem {
  sourceSlug: string;
  externalId: string;
  url: string;
  title: string;
  /** Feed-provided summary. Used only as LLM input, never displayed. */
  summary: string | null;
  publishedAt: Date | null;
}

/** Price of one model in USD per million tokens. */
export interface ModelPrice {
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

/** Worst-case cost of an LLM call, checked by the budget guard before the call. */
export interface CostEstimate {
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  usdMicros: number;
}

/** Actual usage of one LLM call, recorded in `llm_usage`. */
export interface UsageRecord {
  purpose: LlmPurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  sourceItemId?: number;
  ingestRunId?: number;
}

/** ECB reference rates for one day, as units of each currency per 1 EUR. */
export interface FxRates {
  /** The rate date (YYYY-MM-DD) the provider actually returned. */
  date: string;
  perEur: Record<CurrencyCode, number>;
}

export interface CollectStats {
  sourcesAttempted: number;
  sourcesNotModified: number;
  sourcesFailed: number;
  itemsFound: number;
  itemsInserted: number;
}

export interface PrefilterStats {
  itemsChecked: number;
  itemsPassed: number;
  itemsFilteredOut: number;
}

export interface ExtractStats {
  itemsAttempted: number;
  itemsExtracted: number;
  itemsRelevant: number;
  /** Calls that failed validation or the API and will be retried. */
  itemsErrored: number;
  /** Items that reached the attempt limit and became `failed`. */
  itemsFailed: number;
}

export interface ResolveStats {
  extractionsResolved: number;
  companiesCreated: number;
  investorsCreated: number;
  eventsCreated: number;
  eventsUpdated: number;
  mergeCandidatesCreated: number;
}

export interface FxStats {
  ratesFetched: number;
  eventsConverted: number;
  eventsMissingRate: number;
}

/** Stored as `ingest_runs.stats`. */
export interface IngestStats {
  collect: CollectStats;
  prefilter: PrefilterStats;
  extract: ExtractStats;
  resolve: ResolveStats;
  fx: FxStats;
  spendUsdMicros: number;
  monthToDateUsdMicros: number;
  capGbp: number;
  budgetPaused: boolean;
}
