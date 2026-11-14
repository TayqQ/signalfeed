import type {
  LlmPurpose,
  LocationPrecision,
  RegistryLinkMethod,
  SectorSource,
  SourceKind,
} from "./enums";

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
  /** True when no LLM key is configured: items are kept for a later run. */
  skipped?: boolean;
  /** Set when the provider itself refused (bad key, no credit, outage). */
  providerError?: string;
}

export interface ResolveStats {
  extractionsResolved: number;
  companiesCreated: number;
  investorsCreated: number;
  eventsCreated: number;
  eventsUpdated: number;
  mergeCandidatesCreated: number;
  /** Extractions that threw while resolving; retried on the next run. */
  extractionsFailed?: number;
  /** News grant reports attached to a grant event (Phase 3, D56). */
  grantReportsAttached?: number;
}

export interface FxStats {
  ratesFetched: number;
  eventsConverted: number;
  eventsMissingRate: number;
}

// Phase 2 step stats (docs/spec-phase2.md section 6).

/** `pnpm ingest grants`: projects and organisations fetched from Gateway to Research. */
export interface GrantCollectStats {
  pagesFetched: number;
  projectsFound: number;
  projectsInserted: number;
  participantsInserted: number;
  /** Participants that are not organisations. They are never stored. */
  participantsSkipped: number;
  orgsFetched: number;
  orgsFailed: number;
  /**
   * Stored participants whose name is not a company form, left without an
   * organisation fetch (no `organisations/{id}` request). Normally 0, because
   * the same rule already stops them being stored.
   */
  orgsSkipped: number;
  /** Set only when the run stopped early on an error that survived retries. */
  errorCount?: number;
  lastError?: string;
}

/** Grant tagging and resolution, the first Phase 2 step of `pnpm ingest run`. */
export interface GrantResolveStats {
  projectsTagged: number;
  participantsResolved: number;
  /** Participants with no grant offer or no start date. */
  participantsSkipped: number;
  companiesCreated: number;
  /** Companies found by company number rather than by name. */
  companiesMatchedByNumber: number;
  eventsCreated: number;
  mergeCandidatesCreated: number;
  /** True when no LLM key is configured: resolution still runs, tagging does not. */
  taggingSkipped?: boolean;
  /** True when the budget guard stopped tagging. */
  budgetPaused?: boolean;
  /** Set when the provider itself refused (bad key, no credit, outage). */
  providerError?: string;
}

export interface EmbedStats {
  tagsEmbedded: number;
  batches: number;
  /** True when no LLM key is configured. */
  skipped?: boolean;
  budgetPaused?: boolean;
  providerError?: string;
}

/** Theme assignment and naming. */
export interface ThemeStats {
  tagsAssigned: number;
  themesCreated: number;
  themesNamed: number;
  /** True when the step did not run, for example after a budget pause upstream. */
  skipped?: boolean;
  /** True when no LLM key is configured: assignment runs, naming does not. */
  namingSkipped?: boolean;
  budgetPaused?: boolean;
  providerError?: string;
}

/** Rows written by a diff rebuild of one derived table. */
export interface DiffCounts {
  inserted: number;
  updated: number;
  deleted: number;
}

/** Rebuild of `company_locations`. */
export interface LocationStats {
  /** Rows after the rebuild, by precision. Zero when skipped. */
  rowsByPrecision: Record<LocationPrecision, number>;
  /** UK city names that matched more than one place. */
  ambiguousCities: number;
  /** UK city names that matched no place in the gazetteer. */
  unmatchedUkCities: number;
  written: DiffCounts;
  /** True when the input fingerprint had not changed. Counts are then zero. */
  skipped?: boolean;
}

/** Rebuild of the derived stats tables (spec section 5.3). */
export interface DerivedStats {
  companyThemes: DiffCounts;
  themeWeeklyStats: DiffCounts;
  weeklyTotals: DiffCounts;
  fundingRoundMomentum: DiffCounts;
  /** True when the input fingerprint had not changed. Counts are then zero. */
  skipped?: boolean;
}

// Phase 3 step stats (docs/spec-phase3.md section 6).

/** `pnpm ingest registry`: Companies House linking and profile refresh. */
export interface RegistryStats {
  companiesSearched: number;
  /** Automatic links made this run. Methods with none may be missing. */
  linkedByMethod: Partial<Record<RegistryLinkMethod, number>>;
  /** Candidate rows recorded for review. */
  candidates: number;
  /** Searches that found nothing usable. */
  none: number;
  /** Companies with no usable name (search outcome `skipped`). */
  companiesSkipped: number;
  profilesFetched: number;
  profilesRefreshed: number;
  filingsStored: number;
  /** Shared-address checks made (cache hits included). */
  addressChecks: number;
  requests: number;
  /** True when Companies House answered 429 twice and the step stopped. */
  rateLimited: boolean;
  /** True when the step stopped at `MAX_CH_REQUESTS_PER_RUN`. */
  stoppedAtLimit: boolean;
  /** Automatic links sent back to review after a refreshed profile conflicted. */
  linksDemoted?: number;
  /** True when no `COMPANIES_HOUSE_API_KEY` is set. Counts are then zero. */
  skipped?: boolean;
}

/** `pnpm ingest formd`: EDGAR daily indexes, Form D filings and CIK links. */
export interface FormDStats {
  daysFetched: number;
  /** Days with no index (weekends, holidays). */
  daysMissing: number;
  filingsFound: number;
  filingsStored: number;
  /** Pooled investment funds: counted, never stored. */
  fundsSkipped: number;
  parseFailures: number;
  linkedByCik: number;
  linkedByName: number;
  candidates: number;
  requests: number;
}

/** Rebuild of `event_confirmations` and `events.evidence` (spec-phase3 section 9). */
export interface ConfirmStats {
  confirmations: DiffCounts;
  /** News events set to `confirmed`. */
  eventsConfirmed: number;
  /** News events set back to `reported`. */
  eventsSetToReported: number;
  /** Records that fitted more than one event, so confirmed none. */
  ambiguousRecords?: number;
  /** True when the input fingerprint had not changed. Counts are then zero. */
  skipped?: boolean;
}

/** Rebuild of `company_sectors` (spec-phase3 section 7.3). */
export interface SectorStats {
  written: DiffCounts;
  /** Rows after the rebuild, by source. Zero when skipped. */
  rowsBySource: Record<SectorSource, number>;
  /** True when the input fingerprint had not changed. Counts are then zero. */
  skipped?: boolean;
}

/**
 * Stored as `ingest_runs.stats`. Phase 2 and Phase 3 fields are optional,
 * because runs stored before them do not have them.
 */
export interface IngestStats {
  collect: CollectStats;
  prefilter: PrefilterStats;
  extract: ExtractStats;
  resolve: ResolveStats;
  fx: FxStats;
  grantCollect?: GrantCollectStats;
  grantResolve?: GrantResolveStats;
  embed?: EmbedStats;
  themes?: ThemeStats;
  locations?: LocationStats;
  stats?: DerivedStats;
  registry?: RegistryStats;
  formD?: FormDStats;
  confirm?: ConfirmStats;
  sectors?: SectorStats;
  spendUsdMicros: number;
  monthToDateUsdMicros: number;
  capGbp: number;
  budgetPaused: boolean;
}
