import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type {
  CollectStats,
  ConfirmStats,
  DerivedStats,
  EmbedStats,
  ExtractStats,
  FormDStats,
  FxStats,
  GrantCollectStats,
  GrantResolveStats,
  IngestStats,
  LocationStats,
  PrefilterStats,
  RegistryStats,
  ResolveStats,
  SectorStats,
  ThemeStats,
} from "@/core/domain";
import type { IngestStatus, IngestTrigger, SourceKind } from "@/core/enums";
import {
  BudgetExceededError,
  ExtractionValidationError,
  UnknownModelPriceError,
} from "@/core/errors";
import type {
  BudgetGuard,
  Clock,
  Collector,
  EmbeddingClient,
  FxProvider,
  LlmClient,
} from "@/core/ports";
import type { Db } from "@/db/client";
import {
  EMBEDDING_DIMENSIONS,
  acquisitions,
  events,
  fundingRounds,
  ingestRuns,
  investors,
  mergeCandidates,
} from "@/db/schema";
import { embedTagsStep, tagEmbeddingIdentity } from "./embed/embed-tags";
import { extractItem } from "./extract/extract-item";
import { collectFormDStep } from "./filings/collect-form-d";
import type { EdgarClient } from "./filings/edgar-client";
import { linkFormDFilings } from "./filings/link-form-d";
import { emptyFormDStats } from "./filings/store-form-d";
import { isCandidate } from "./extract/prefilter";
import { estimateCost } from "./extract/pricing";
import {
  collectGrantsStep,
  type CollectGrantsOptions,
} from "./grants/collect-grants";
import type { GtrClient } from "./grants/gtr-client";
import {
  relinkGrantReports,
  type RelinkGrantsResult,
} from "./grants/relink-grants";
import { resolveGrantsStep } from "./grants/resolve-grants";
import { tagGrantsStep } from "./grants/tag-grants";
import {
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "./extract/prompt";
import { type IngestLock, withIngestLock } from "./lock";
import type { ChClient } from "./registry/ch-client";
import { confirmStep } from "./registry/confirm-events";
import { registryStep as companiesHouseStep } from "./registry/registry-step";
import { recomputeEvent } from "./resolve/canonicalise";
import { resolveExtraction } from "./resolve/resolve-extraction";
import { RobotsSkipError } from "@/lib/robots";
import { SOURCES } from "./sources";
import {
  StepTimer,
  TimeLimit,
  timed,
  timeLimitedBudget,
  type TimingStats,
} from "./step-timing";
import { rebuildCompanyLocations } from "./stats/company-locations";
import { rebuildCompanySectors } from "./stats/company-sectors";
import { rebuildStatsStep } from "./stats/rebuild-stats";
import {
  insertExtraction,
  listUnresolvedExtractions,
} from "./store/extractions";
import { getRatesOnOrBefore, upsertRates } from "./store/fx-rates";
import { finishRun, startRun } from "./store/ingest-runs";
import {
  insertCollectedItems,
  listItemsForReextract,
  listPendingItems,
  markExtracted,
  markFilteredOut,
  recordFailure,
  type PipelineSourceItem,
} from "./store/source-items";
import {
  listEnabledSources,
  updateFetchState,
  upsertSources,
} from "./store/sources";
import { assignThemesStep } from "./themes/assign-themes";
import { nameThemesStep } from "./themes/name-themes";
import type { ThemeCheckDeps } from "./themes/theme-check";

/** Much larger than any real backlog; keeps one query from being unbounded. */
const STEP_BATCH_LIMIT = 5000;
const FX_LOOKBACK_DAYS = 7;

/** Default time limits (D67), used when the config has none. */
export const DEFAULT_INGEST_MINUTES = 12;
export const DEFAULT_ENRICH_MINUTES = 15;

/** A `running` row this old, found inside the lock, belongs to a stopped job. */
export const ABANDONED_AFTER_MINUTES = 60;
export const ABANDONED_ERROR =
  "abandoned: the job was stopped before it finished";

/** What a run stores: the usual stats, plus step timings and the time-limit flag. */
export type RunStats = Omit<IngestStats, "collect"> & {
  collect: RunCollectStats;
} & Partial<TimingStats>;

/**
 * Collect stats plus feeds skipped by robots.txt (D68). A skipped feed is not
 * a failure: it was disallowed, or the host's robots.txt could not be read.
 */
export type RunCollectStats = CollectStats & { sourcesSkippedRobots: number };

/**
 * Source kinds `collectStep` has a collector for. Other enabled sources, such
 * as `ukri-gtr` (collected by `pnpm ingest grants`), are left alone.
 */
export const COLLECTED_SOURCE_KINDS: readonly SourceKind[] = ["rss"];

export interface PipelineConfig {
  /** Extraction model, also used for grant tagging and theme naming. */
  model: string;
  /** Theme check model (D49). Absent: the extraction model. */
  themeCheckModel?: string;
  maxExtractionsPerRun: number;
  /** `MAX_INGEST_MINUTES_PER_RUN`. The hourly run uses 12 when missing. */
  maxIngestMinutesPerRun?: number;
  /** `MAX_ENRICH_MINUTES_PER_RUN`. `enrich` uses 15 when missing. */
  maxEnrichMinutesPerRun?: number;
  capGbp: number;
  embeddingModel: string;
  maxEmbeddingsPerRun: number;
  maxThemeNamesPerRun: number;
  maxGrantTaggingsPerRun: number;
  /** `MAX_GRANT_ORG_FETCHES_PER_RUN`. */
  maxGrantOrgFetchesPerRun: number;
  /** `MAX_CH_REQUESTS_PER_RUN`. */
  maxChRequestsPerRun: number;
  /** `MAX_CH_MINUTES_PER_RUN`. The registry step uses 17 when missing. */
  maxChMinutesPerRun?: number;
  /** `MAX_EDGAR_DAYS_PER_RUN`. */
  maxEdgarDaysPerRun: number;
  /** `MAX_EDGAR_REQUESTS_PER_RUN`. */
  maxEdgarRequestsPerRun: number;
}

export interface PipelineDeps {
  db: Db;
  collector: Collector;
  /** Null when no key is configured: new items wait for a later run. */
  llm: LlmClient | null;
  /** The theme check client, bound to `config.themeCheckModel`. Absent: `llm`. */
  themeCheckLlm?: LlmClient | null;
  /** Null when no key is configured: tags wait for a later run. */
  embedder: EmbeddingClient | null;
  /** Gateway to Research. Used only by `pnpm ingest grants`, never by `run`. */
  gtr: GtrClient;
  /**
   * Companies House. Null without `COMPANIES_HOUSE_API_KEY`. Used only by
   * `pnpm ingest registry`, never by `run`.
   */
  companiesHouse: ChClient | null;
  /**
   * SEC EDGAR. Null when `HTTP_CONTACT` has no email address. Used only by
   * `pnpm ingest formd`, never by `run`.
   */
  edgar: EdgarClient | null;
  budget: BudgetGuard;
  fx: FxProvider;
  clock: Clock;
  config: PipelineConfig;
  /** Never receives secrets or article text. */
  log: (message: string) => void;
  runId?: number;
  /**
   * Set by the runs that have a time limit (D67). Loops check it between
   * items, never inside one. Absent: no limit, as for single steps by hand.
   */
  limit?: TimeLimit;
  /** Set by the runs that time their steps. Absent: nothing is logged. */
  timer?: StepTimer;
}

export type ExtractStepResult = ExtractStats & { budgetPaused: boolean };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Refusals that say nothing about the item, so they must not use up its attempts. */
function isProviderError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, name } = error as { status?: unknown; name?: unknown };
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return true;
  }
  return (
    typeof status === "number" &&
    (status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 429 ||
      status >= 500)
  );
}

export async function collectStep(
  deps: PipelineDeps,
): Promise<RunCollectStats> {
  const stats: RunCollectStats = {
    sourcesAttempted: 0,
    sourcesNotModified: 0,
    sourcesFailed: 0,
    sourcesSkippedRobots: 0,
    itemsFound: 0,
    itemsInserted: 0,
  };
  for (const source of await listEnabledSources(
    deps.db,
    COLLECTED_SOURCE_KINDS,
  )) {
    stats.sourcesAttempted += 1;
    try {
      const result = await deps.collector.collect(source.config, {
        etag: source.etag,
        lastModified: source.lastModified,
      });
      if (result.notModified) {
        stats.sourcesNotModified += 1;
      } else {
        stats.itemsFound += result.items.length;
        const { inserted } = await insertCollectedItems(
          deps.db,
          source.id,
          result.items,
        );
        stats.itemsInserted += inserted;
      }
      await updateFetchState(deps.db, source.id, {
        etag: result.etag,
        lastModified: result.lastModified,
        fetchedAt: deps.clock.now(),
      });
    } catch (error) {
      if (error instanceof RobotsSkipError) {
        stats.sourcesSkippedRobots += 1;
        deps.log(
          error.reason === "disallowed"
            ? `Feed ${source.config.slug} skipped: disallowed by robots.txt`
            : `Feed ${source.config.slug} skipped: robots.txt refused or unavailable, retrying next run`,
        );
        continue;
      }
      stats.sourcesFailed += 1;
      deps.log(`Feed ${source.config.slug} failed: ${describe(error)}`);
    }
  }
  return stats;
}

export async function prefilterStep(
  deps: PipelineDeps,
): Promise<PrefilterStats> {
  const items = await listPendingItems(deps.db, STEP_BATCH_LIMIT);
  const rejected = items.filter(
    (item) => !isCandidate({ title: item.title, summary: item.summary }),
  );
  await markFilteredOut(
    deps.db,
    rejected.map((item) => item.id),
  );
  return {
    itemsChecked: items.length,
    itemsPassed: items.length - rejected.length,
    itemsFilteredOut: rejected.length,
  };
}

async function extractOne(
  deps: PipelineDeps,
  llm: LlmClient,
  item: PipelineSourceItem,
  purposeRunId: number | undefined,
) {
  const extraction = await extractItem({
    item: {
      title: item.title,
      summary: item.summary,
      url: item.url,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
    },
    llm,
    budget: deps.budget,
    model: deps.config.model,
    sourceItemId: item.id,
    ingestRunId: purposeRunId,
  });
  const stored = await insertExtraction(deps.db, {
    sourceItemId: item.id,
    promptVersion: extraction.promptVersion,
    model: extraction.model,
    result: extraction.result,
    isRelevant: extraction.result.isRelevant,
    inputTokens: extraction.usage.inputTokens,
    outputTokens: extraction.usage.outputTokens,
    costUsdMicros: extraction.costUsdMicros,
  });
  return { extraction, stored };
}

export async function extractStep(
  deps: PipelineDeps,
): Promise<ExtractStepResult> {
  const stats: ExtractStepResult = {
    itemsAttempted: 0,
    itemsExtracted: 0,
    itemsRelevant: 0,
    itemsErrored: 0,
    itemsFailed: 0,
    budgetPaused: false,
  };
  if (!deps.llm) {
    deps.log("No LLM key configured: items stay pending for a later run.");
    return { ...stats, skipped: true };
  }

  const items = await listPendingItems(
    deps.db,
    deps.config.maxExtractionsPerRun,
  );
  for (const item of items) {
    // Between items only: an item's LLM call and its writes always finish.
    if (deps.limit?.reached()) {
      deps.log(
        "Time limit reached: extraction stopped, the rest stays pending.",
      );
      break;
    }
    stats.itemsAttempted += 1;
    try {
      const { extraction } = await extractOne(deps, deps.llm, item, deps.runId);
      await markExtracted(deps.db, item.id);
      stats.itemsExtracted += 1;
      if (extraction.result.isRelevant) stats.itemsRelevant += 1;
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        stats.itemsAttempted -= 1;
        stats.budgetPaused = true;
        deps.log(`Budget reached: ${error.message}`);
        break;
      }
      if (error instanceof UnknownModelPriceError) throw error;
      if (isProviderError(error)) {
        stats.itemsAttempted -= 1;
        stats.providerError = describe(error);
        deps.log(`LLM provider refused: ${stats.providerError}`);
        break;
      }
      stats.itemsErrored += 1;
      const message =
        error instanceof ExtractionValidationError
          ? error.message
          : describe(error);
      await recordFailure(deps.db, item.id, message);
      if (item.attempts + 1 >= 3) stats.itemsFailed += 1;
    }
  }
  return stats;
}

export async function resolveStep(deps: PipelineDeps): Promise<ResolveStats> {
  const stats: ResolveStats = {
    extractionsResolved: 0,
    companiesCreated: 0,
    investorsCreated: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    mergeCandidatesCreated: 0,
    extractionsFailed: 0,
    grantReportsAttached: 0,
  };
  const before = await resolutionCounts(deps.db);
  const pending = await listUnresolvedExtractions(deps.db, STEP_BATCH_LIMIT);
  for (const extraction of pending) {
    if (deps.limit?.reached()) {
      deps.log("Time limit reached: resolve stopped, the rest waits.");
      break;
    }
    try {
      const outcome = await resolveExtraction(deps.db, extraction.id);
      if (outcome.alreadyResolved) continue;
      stats.extractionsResolved += 1;
      stats.companiesCreated += outcome.companiesCreated;
      stats.eventsCreated += outcome.eventsCreated;
      stats.eventsUpdated += outcome.eventsUpdated;
      stats.grantReportsAttached =
        (stats.grantReportsAttached ?? 0) + outcome.grantReportsAttached;
    } catch (error) {
      stats.extractionsFailed = (stats.extractionsFailed ?? 0) + 1;
      deps.log(
        `Resolve of extraction ${extraction.id} failed: ${describe(error)}`,
      );
    }
  }
  const after = await resolutionCounts(deps.db);
  stats.investorsCreated = after.investors - before.investors;
  stats.mergeCandidatesCreated = after.candidates - before.candidates;
  return stats;
}

async function resolutionCounts(db: Db) {
  const [row] = await db
    .select({
      investors: sql<number>`(select count(*)::int from ${investors})`,
      candidates: sql<number>`(select count(*)::int from ${mergeCandidates})`,
    })
    .from(sql`(select 1) as one`);
  return { investors: row?.investors ?? 0, candidates: row?.candidates ?? 0 };
}

function shiftDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Weekends, holidays and today's unpublished rate all have no row, so walk back. */
async function fetchRatesNear(
  deps: PipelineDeps,
  date: string,
): Promise<boolean> {
  for (let back = 0; back <= FX_LOOKBACK_DAYS; back += 1) {
    try {
      await upsertRates(
        deps.db,
        await deps.fx.getRates(shiftDays(date, -back)),
      );
      return true;
    } catch (error) {
      deps.log(`No FX rates for ${shiftDays(date, -back)}: ${describe(error)}`);
    }
  }
  return false;
}

export async function fxStep(deps: PipelineDeps): Promise<FxStats> {
  const stats: FxStats = {
    ratesFetched: 0,
    eventsConverted: 0,
    eventsMissingRate: 0,
  };

  // The budget guard converts its GBP cap with the latest stored rate.
  const today = deps.clock.now().toISOString().slice(0, 10);
  if (!(await getRatesOnOrBefore(deps.db, today, 1))) {
    if (await fetchRatesNear(deps, today)) stats.ratesFetched += 1;
  }

  const unconverted = await deps.db
    .select({ id: events.id, announcedOn: events.announcedOn })
    .from(events)
    .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .leftJoin(acquisitions, eq(acquisitions.eventId, events.id))
    .where(
      or(
        and(
          isNotNull(fundingRounds.amountMinor),
          isNull(fundingRounds.amountUsdMinor),
        ),
        and(
          isNotNull(acquisitions.priceMinor),
          isNull(acquisitions.priceUsdMinor),
        ),
      ),
    );

  for (const event of unconverted) {
    if (deps.limit?.reached()) {
      deps.log("Time limit reached: FX conversion stopped, the rest waits.");
      break;
    }
    if (!(await getRatesOnOrBefore(deps.db, event.announcedOn))) {
      if (await fetchRatesNear(deps, event.announcedOn))
        stats.ratesFetched += 1;
    }
    await recomputeEvent(deps.db, event.id, {
      getRatesOnOrBefore: (db, date) => getRatesOnOrBefore(db, date),
    });
    const converted = await deps.db
      .select({
        funding: fundingRounds.amountUsdMinor,
        price: acquisitions.priceUsdMinor,
      })
      .from(events)
      .leftJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .leftJoin(acquisitions, eq(acquisitions.eventId, events.id))
      .where(eq(events.id, event.id));
    if (converted[0]?.funding != null || converted[0]?.price != null) {
      stats.eventsConverted += 1;
    } else {
      stats.eventsMissingRate += 1;
    }
  }
  return stats;
}

// Phase 2 steps (spec-phase2 section 6). Each one catches its own errors, so
// a failing optional step never loses what earlier steps did.

/** What a Phase 2 step returns to the run. */
export interface StepOutcome<T> {
  /** Absent only when the step failed before it could count anything. */
  stats?: T;
  /** Failures, each prefixed with the step name. Empty when all went well. */
  errors: string[];
  /** True when the steps after this one must not spend: a budget pause or a provider refusal. */
  stopsPaidSteps: boolean;
}

export interface PaidStepOptions {
  /** False after a budget pause or provider refusal earlier in the run. */
  paidAllowed: boolean;
}

function failure(step: string, error: unknown): string {
  return `${step}: ${describe(error)}`;
}

/** The provider message for refusals, so they show as `providerError`. */
function providerMessage(error: unknown): string | undefined {
  return isProviderError(error) ? describe(error) : undefined;
}

/**
 * Step 8: tag new grant projects (paid, needs a key), then turn new grant
 * participants into companies and events (free, always runs).
 */
export async function grantResolveStep(
  deps: PipelineDeps,
  { paidAllowed }: PaidStepOptions,
): Promise<StepOutcome<GrantResolveStats>> {
  const stats: GrantResolveStats = {
    projectsTagged: 0,
    participantsResolved: 0,
    participantsSkipped: 0,
    companiesCreated: 0,
    companiesMatchedByNumber: 0,
    eventsCreated: 0,
    mergeCandidatesCreated: 0,
  };
  const errors: string[] = [];

  if (!deps.llm || !paidAllowed) {
    stats.taggingSkipped = true;
  } else {
    // The guard refuses between batches once the time limit has passed.
    const guard = timeLimitedBudget(deps.budget, deps.limit);
    try {
      const tagged = await timed(
        deps.timer,
        "grantTagging",
        () =>
          tagGrantsStep({
            db: deps.db,
            llm: deps.llm!,
            budget: guard.budget,
            model: deps.config.model,
            maxProjects: deps.config.maxGrantTaggingsPerRun,
            runId: deps.runId,
          }),
        (result) => `${result.projectsTagged} projects`,
      );
      stats.projectsTagged = tagged.projectsTagged;
      if (tagged.budgetPaused) {
        if (guard.tripped()) {
          deps.log("Time limit reached: grant tagging stopped.");
        } else {
          stats.budgetPaused = true;
          deps.log("Budget reached: grant tagging paused.");
        }
      }
    } catch (error) {
      stats.providerError = providerMessage(error);
      errors.push(failure("grant tagging", error));
    }
  }

  try {
    // Free and local, so it runs even after the time limit. It has no
    // per-item hook yet (D67): its work is bounded by the backlog.
    const resolved = await timed(
      deps.timer,
      "grantResolution",
      () =>
        resolveGrantsStep({
          db: deps.db,
          now: () => deps.clock.now(),
        }),
      (result) => `${result.participantsResolved} participants`,
    );
    stats.participantsResolved = resolved.participantsResolved;
    stats.participantsSkipped = resolved.participantsSkipped;
    stats.companiesCreated = resolved.companiesCreated;
    stats.companiesMatchedByNumber = resolved.companiesMatchedByNumber;
    stats.eventsCreated = resolved.eventsCreated;
    stats.mergeCandidatesCreated = resolved.mergeCandidatesCreated;
  } catch (error) {
    errors.push(failure("grant resolution", error));
  }

  return {
    stats,
    errors,
    stopsPaidSteps: Boolean(stats.budgetPaused || stats.providerError),
  };
}

/** Step 9: embed tags with no embedding from the current model. */
export async function embedStep(
  deps: PipelineDeps,
  { paidAllowed }: PaidStepOptions,
): Promise<StepOutcome<EmbedStats>> {
  if (!deps.embedder || !paidAllowed) {
    return {
      stats: { tagsEmbedded: 0, batches: 0, skipped: true },
      errors: [],
      stopsPaidSteps: false,
    };
  }
  const embedder = deps.embedder;
  const guard = timeLimitedBudget(deps.budget, deps.limit);
  try {
    const stats = await timed(
      deps.timer,
      "embed",
      () =>
        embedTagsStep({
          db: deps.db,
          embedder,
          budget: guard.budget,
          model: deps.config.embeddingModel,
          dimensions: EMBEDDING_DIMENSIONS,
          maxTags: deps.config.maxEmbeddingsPerRun,
          runId: deps.runId,
        }),
      (result) => `${result.tagsEmbedded} tags`,
    );
    if (stats.budgetPaused && guard.tripped()) {
      deps.log("Time limit reached: embedding stopped.");
      return {
        stats: { tagsEmbedded: stats.tagsEmbedded, batches: stats.batches },
        errors: [],
        stopsPaidSteps: false,
      };
    }
    if (stats.budgetPaused) deps.log("Budget reached: embedding paused.");
    return {
      stats,
      errors: [],
      stopsPaidSteps: Boolean(stats.budgetPaused),
    };
  } catch (error) {
    const providerError = providerMessage(error);
    return {
      stats: { tagsEmbedded: 0, batches: 0, providerError },
      errors: [failure("embedding", error)],
      stopsPaidSteps: providerError !== undefined,
    };
  }
}

/**
 * The theme check runs on its own model when one is configured, and falls
 * back to the extraction model for the rest of the run if that fails (D49).
 */
function themeCheckDeps(
  deps: PipelineDeps,
  llm: LlmClient,
  budget: BudgetGuard,
): ThemeCheckDeps {
  const model = deps.config.themeCheckModel ?? deps.config.model;
  const own = deps.themeCheckLlm && model !== deps.config.model;
  return {
    llm: own ? deps.themeCheckLlm! : llm,
    model: own ? model : deps.config.model,
    budget,
    purpose: "theme_naming",
    runId: deps.runId,
    fallbackLlm: own ? { llm, model: deps.config.model } : undefined,
  };
}

/**
 * Step 10: assign embedded tags to themes (free), then name themes (paid,
 * needs a key). After a pause or refusal earlier in the run the whole step
 * waits for the next run.
 */
export async function themesStep(
  deps: PipelineDeps,
  { paidAllowed }: PaidStepOptions,
): Promise<StepOutcome<ThemeStats>> {
  const stats: ThemeStats = {
    tagsAssigned: 0,
    themesCreated: 0,
    themesNamed: 0,
  };
  if (!paidAllowed) {
    return {
      stats: { ...stats, skipped: true },
      errors: [],
      stopsPaidSteps: false,
    };
  }
  const errors: string[] = [];
  const guard = timeLimitedBudget(deps.budget, deps.limit);

  try {
    // Tags and themes store the model plus the input template. With a key,
    // tags in the similarity band get an LLM check (D47).
    const assigned = await timed(
      deps.timer,
      "themesAssign",
      () =>
        assignThemesStep({
          db: deps.db,
          model: tagEmbeddingIdentity(deps.config.embeddingModel),
          check: deps.llm
            ? themeCheckDeps(deps, deps.llm, guard.budget)
            : undefined,
        }),
      (result) => `${result.tagsAssigned} tags`,
    );
    stats.tagsAssigned = assigned.tagsAssigned;
    stats.themesCreated = assigned.themesCreated;
    const check = assigned.check;
    if (check && (check.calls > 0 || check.fallback)) {
      deps.log(
        `Theme check: ${check.questions} questions in ${check.calls} calls; ${check.joined} joined, ${check.rejected} kept apart, ${check.fallbacks} fell back to the embedding rule.`,
      );
    }
    if (check?.fallback === "budget" && guard.tripped()) {
      deps.log("Time limit reached: theme check stopped.");
    } else if (check?.fallback === "budget") {
      stats.budgetPaused = true;
      deps.log("Budget reached: theme check paused.");
    } else if (check?.fallback === "error") {
      stats.providerError = providerMessage(check.error);
      errors.push(failure("theme check", check.error));
    }
  } catch (error) {
    errors.push(failure("theme assignment", error));
  }

  if (!deps.llm) {
    stats.namingSkipped = true;
  } else if (stats.budgetPaused || stats.providerError || guard.tripped()) {
    // The check was refused, or time ran out: naming waits for the next run.
  } else {
    const llm = deps.llm;
    try {
      const named = await timed(
        deps.timer,
        "themesName",
        () =>
          nameThemesStep({
            db: deps.db,
            llm,
            budget: guard.budget,
            model: deps.config.model,
            maxThemes: deps.config.maxThemeNamesPerRun,
            runId: deps.runId,
            clock: deps.clock,
          }),
        (result) => `${result.themesNamed} themes`,
      );
      stats.themesNamed = named.themesNamed;
      if (named.budgetPaused && guard.tripped()) {
        deps.log("Time limit reached: theme naming stopped.");
      } else if (named.budgetPaused) {
        stats.budgetPaused = true;
        deps.log("Budget reached: theme naming paused.");
      }
    } catch (error) {
      stats.providerError = providerMessage(error);
      errors.push(failure("theme naming", error));
    }
  }

  return {
    stats,
    errors,
    stopsPaidSteps: Boolean(stats.budgetPaused || stats.providerError),
  };
}

/** Step 11: rebuild `company_locations` when its inputs changed. Free. */
export async function locationsStep(
  deps: PipelineDeps,
  { force = false }: { force?: boolean } = {},
): Promise<StepOutcome<LocationStats>> {
  try {
    const stats = await rebuildCompanyLocations({
      db: deps.db,
      clock: deps.clock,
      force,
      log: deps.log,
    });
    return { stats, errors: [], stopsPaidSteps: false };
  } catch (error) {
    return { errors: [failure("locations", error)], stopsPaidSteps: false };
  }
}

/** Step 12: rebuild the derived stats tables when their inputs changed. Free. */
export async function derivedStatsStep(
  deps: PipelineDeps,
  { force = false }: { force?: boolean } = {},
): Promise<StepOutcome<DerivedStats>> {
  try {
    const stats = await rebuildStatsStep({
      db: deps.db,
      clock: deps.clock,
      force,
    });
    return { stats, errors: [], stopsPaidSteps: false };
  } catch (error) {
    return { errors: [failure("stats", error)], stopsPaidSteps: false };
  }
}

// Phase 3 steps (spec-phase3 section 6). The local ones run in `run`; the
// registry and Form D steps run only from their own commands, in the daily
// workflow. Each catches its own errors, like the Phase 2 steps.

/**
 * Step 13: rebuild `event_confirmations` and `events.evidence`. Local, free.
 * `confirmStep` logs one line per ambiguous record, so the lines are counted.
 */
export async function confirmEventsStep(
  deps: PipelineDeps,
  { force = false }: { force?: boolean } = {},
): Promise<StepOutcome<ConfirmStats>> {
  let ambiguousRecords = 0;
  try {
    const stats = await confirmStep({
      db: deps.db,
      clock: deps.clock,
      force,
      log: (message) => {
        ambiguousRecords += 1;
        deps.log(message);
      },
    });
    return {
      stats: { ...stats, ambiguousRecords },
      errors: [],
      stopsPaidSteps: false,
    };
  } catch (error) {
    return { errors: [failure("confirm", error)], stopsPaidSteps: false };
  }
}

/** Step 14: rebuild `company_sectors` when its inputs changed. Local, free. */
export async function sectorsStep(
  deps: PipelineDeps,
  { force = false }: { force?: boolean } = {},
): Promise<StepOutcome<SectorStats>> {
  try {
    const stats = await rebuildCompanySectors({
      db: deps.db,
      clock: deps.clock,
      force,
    });
    return { stats, errors: [], stopsPaidSteps: false };
  } catch (error) {
    return { errors: [failure("sectors", error)], stopsPaidSteps: false };
  }
}

/** The line `refreshProfiles` logs for each automatic link it demotes. */
const DEMOTED_LINE = /link demoted to review/;

/**
 * The Companies House step. Skipped without a client. Rate limits and the
 * request limit end it early with a normal result.
 */
export async function companiesHouseRegistryStep(
  deps: PipelineDeps,
  { maxRequests }: { maxRequests?: number } = {},
): Promise<StepOutcome<RegistryStats>> {
  let linksDemoted = 0;
  try {
    const stats = await companiesHouseStep({
      db: deps.db,
      client: deps.companiesHouse,
      clock: deps.clock,
      maxRequests: maxRequests ?? deps.config.maxChRequestsPerRun,
      maxMinutes: deps.config.maxChMinutesPerRun,
      log: (message) => {
        if (DEMOTED_LINE.test(message)) linksDemoted += 1;
        deps.log(message);
      },
    });
    return {
      stats: stats.skipped ? stats : { ...stats, linksDemoted },
      errors: [],
      stopsPaidSteps: false,
    };
  } catch (error) {
    return { errors: [failure("registry", error)], stopsPaidSteps: false };
  }
}

export interface FormDStepOptions {
  since?: string;
  maxDays?: number;
  maxRequests?: number;
}

/**
 * Form D collection, then linking. Linking runs even when collection
 * failed, so filings stored earlier are still linked.
 */
export async function formDStep(
  deps: PipelineDeps,
  edgar: EdgarClient,
  options: FormDStepOptions = {},
): Promise<StepOutcome<FormDStats>> {
  const stats = emptyFormDStats();
  const errors: string[] = [];
  try {
    await collectFormDStep({
      db: deps.db,
      edgar,
      clock: deps.clock,
      since: options.since,
      maxDays: options.maxDays ?? deps.config.maxEdgarDaysPerRun,
      maxRequests: options.maxRequests ?? deps.config.maxEdgarRequestsPerRun,
      log: deps.log,
      stats,
    });
  } catch (error) {
    errors.push(failure("formd collection", error));
  }
  try {
    await linkFormDFilings({
      db: deps.db,
      now: deps.clock.now(),
      stats,
      log: deps.log,
    });
  } catch (error) {
    errors.push(failure("formd linking", error));
  }
  return { stats, errors, stopsPaidSteps: false };
}

export interface RunSummary {
  ran: boolean;
  status?: IngestStatus;
  runId?: number;
  stats?: RunStats;
}

async function spendSoFar(budget: BudgetGuard): Promise<number> {
  const { spentUsdMicros } = await budget.monthToDate();
  return spentUsdMicros;
}

/**
 * Marks `running` rows started over an hour ago as failed. Call it inside the
 * lock: while the lock is held no other run is alive, so such a row belongs to
 * a job that was cancelled or killed before it could finish (D67).
 */
export async function closeAbandonedRuns(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MINUTES * 60_000);
  const closed = await db
    .update(ingestRuns)
    .set({ status: "failed", error: ABANDONED_ERROR, finishedAt: now })
    .where(
      and(eq(ingestRuns.status, "running"), lt(ingestRuns.startedAt, cutoff)),
    )
    .returning({ id: ingestRuns.id });
  return closed.length;
}

/** Closes abandoned runs, then records the start of this one. Inside the lock. */
async function beginRun(deps: PipelineDeps, trigger: IngestTrigger) {
  const closed = await closeAbandonedRuns(deps.db, deps.clock.now());
  if (closed > 0) {
    deps.log(`Closed ${closed} abandoned run${closed === 1 ? "" : "s"}.`);
  }
  return startRun(deps.db, trigger);
}

/** The note on a rebuild step's log line. */
function rebuildNote(outcome: StepOutcome<{ skipped?: boolean }>) {
  if (!outcome.stats) return "failed";
  return outcome.stats.skipped ? "no change" : "rebuilt";
}

/**
 * One locked, idempotent hourly run: what must be fresh every hour (collect,
 * prefilter, extract, resolve, FX), then the cheap database-only rebuilds
 * (locations, stats, confirmations, sectors) so a new round is labelled within
 * the hour. Grant tagging and resolution, embeddings and themes are slow and
 * paid; they run in `runEnrich` (D67). Stops between items at
 * `MAX_INGEST_MINUTES_PER_RUN`; the rebuilds always run. Spec section 7 and
 * spec-phase3 section 6.
 */
export async function runAll(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
): Promise<RunSummary> {
  const locked = await withIngestLock(lock, async () => {
    const run = await beginRun(deps, trigger);
    const timer = new StepTimer(deps.clock, deps.log);
    const limit = new TimeLimit(
      deps.clock,
      deps.config.maxIngestMinutesPerRun ?? DEFAULT_INGEST_MINUTES,
    );
    const scoped: PipelineDeps = { ...deps, runId: run.id, timer, limit };
    try {
      await upsertSources(deps.db, SOURCES);
      const spentBefore = await spendSoFar(deps.budget);
      const collect = await timer.time(
        "collect",
        () => collectStep(scoped),
        (r) => `${r.itemsInserted} new items`,
      );
      const prefilter = await timer.time(
        "prefilter",
        () => prefilterStep(scoped),
        (r) => `${r.itemsChecked} items`,
      );
      const { budgetPaused: extractPaused, ...extract } = await timer.time(
        "extract",
        () => extractStep(scoped),
        (r) => `${r.itemsExtracted} items`,
      );
      const resolve = await timer.time(
        "resolve",
        () => resolveStep(scoped),
        (r) => `${r.extractionsResolved} extractions`,
      );
      const fx = await timer.time(
        "fx",
        () => fxStep(scoped),
        (r) => `${r.eventsConverted} events`,
      );

      // The cheap rebuilds always run, even after the time limit.
      const errors: string[] = [];
      const track = <T>(outcome: StepOutcome<T>): T | undefined => {
        errors.push(...outcome.errors);
        return outcome.stats;
      };
      const locations = track(
        await timer.time("locations", () => locationsStep(scoped), rebuildNote),
      );
      const stats = track(
        await timer.time("stats", () => derivedStatsStep(scoped), rebuildNote),
      );
      const confirm = track(
        await timer.time(
          "confirm",
          () => confirmEventsStep(scoped),
          rebuildNote,
        ),
      );
      const sectors = track(
        await timer.time("sectors", () => sectorsStep(scoped), rebuildNote),
      );
      for (const message of errors) deps.log(`Step failed: ${message}`);
      const monthToDate = await spendSoFar(deps.budget);

      const budgetPaused = extractPaused;
      const runStats: RunStats = {
        collect,
        prefilter,
        extract,
        resolve,
        fx,
        locations,
        stats,
        confirm,
        sectors,
        spendUsdMicros: monthToDate - spentBefore,
        monthToDateUsdMicros: monthToDate,
        capGbp: deps.config.capGbp,
        budgetPaused,
        stepMs: timer.stepMs,
        ...(limit.hit ? { stoppedAtTime: true } : {}),
      };
      const problems = [
        ...(extract.providerError
          ? [`extraction: ${extract.providerError}`]
          : []),
        ...errors,
      ];
      let status: IngestStatus = "succeeded";
      if (budgetPaused) status = "budget_paused";
      if (problems.length > 0) status = "failed";
      await finishRun(deps.db, run.id, {
        status,
        stats: runStats,
        error: problems.length > 0 ? problems.join("; ") : null,
      });
      return { ran: true, status, runId: run.id, stats: runStats };
    } catch (error) {
      await finishRun(deps.db, run.id, {
        status: "failed",
        stats: null,
        error: describe(error),
      });
      throw error;
    }
  });
  return locked.ran ? locked.result : { ran: false };
}

/**
 * Stats for a run that does none of the Phase 1 steps: their parts are zero,
 * so the stored stats keep the shape the status page reads.
 */
async function emptyRunStats(deps: PipelineDeps): Promise<RunStats> {
  return {
    collect: {
      sourcesAttempted: 0,
      sourcesNotModified: 0,
      sourcesFailed: 0,
      sourcesSkippedRobots: 0,
      itemsFound: 0,
      itemsInserted: 0,
    },
    prefilter: { itemsChecked: 0, itemsPassed: 0, itemsFilteredOut: 0 },
    extract: {
      itemsAttempted: 0,
      itemsExtracted: 0,
      itemsRelevant: 0,
      itemsErrored: 0,
      itemsFailed: 0,
      ...(deps.llm ? {} : { skipped: true }),
    },
    resolve: {
      extractionsResolved: 0,
      companiesCreated: 0,
      investorsCreated: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      mergeCandidatesCreated: 0,
    },
    fx: { ratesFetched: 0, eventsConverted: 0, eventsMissingRate: 0 },
    spendUsdMicros: 0,
    monthToDateUsdMicros: await spendSoFar(deps.budget),
    capGbp: deps.config.capGbp,
    budgetPaused: false,
  };
}

/**
 * One locked, recorded run of a free command. `body` returns the stats and
 * any step failures; a failure marks the run `failed` but keeps the stats.
 * An unexpected error marks it `failed` and is rethrown.
 */
async function recordedRun(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
  body: (scoped: PipelineDeps) => Promise<{
    stats: RunStats;
    errors: string[];
    warnings?: string[];
    /** A budget pause makes a clean run `budget_paused`. */
    budgetPaused?: boolean;
  }>,
): Promise<RunSummary> {
  const locked = await withIngestLock(lock, async () => {
    const run = await beginRun(deps, trigger);
    const scoped: PipelineDeps = { ...deps, runId: run.id };
    try {
      const {
        stats,
        errors,
        warnings = [],
        budgetPaused = false,
      } = await body(scoped);
      for (const message of errors) deps.log(`Step failed: ${message}`);
      for (const message of warnings)
        deps.log(`Step stopped early: ${message}`);
      let status: IngestStatus = "succeeded";
      if (budgetPaused) status = "budget_paused";
      if (errors.length > 0) status = "failed";
      // A warning keeps the run green but leaves its text on the run row.
      const notes = errors.length > 0 ? errors : warnings;
      await finishRun(deps.db, run.id, {
        status,
        stats,
        error: notes.length > 0 ? notes.join("; ") : null,
      });
      return { ran: true, status, runId: run.id, stats };
    } catch (error) {
      await finishRun(deps.db, run.id, {
        status: "failed",
        stats: null,
        error: describe(error),
      });
      throw error;
    }
  });
  return locked.ran ? locked.result : { ran: false };
}

export type GrantsRunOptions = Pick<
  CollectGrantsOptions,
  "since" | "maxPages" | "maxOrgFetches"
>;

/**
 * `pnpm ingest grants`: one locked, recorded run that fetches new Innovate UK
 * projects and organisations from Gateway to Research. Free, so it needs no
 * key. Tagging and resolution happen in `enrich`, the next step of the daily workflow.
 */
export async function runGrants(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
  options: GrantsRunOptions = {},
): Promise<RunSummary> {
  return recordedRun(deps, lock, trigger, async (scoped) => {
    // Unlike the Phase 3 steps, a failure with nothing fetched is thrown, as
    // before. A page that fails after retries is a warning: data is kept.
    const grantCollect: GrantCollectStats = await collectGrantsStep({
      db: scoped.db,
      gtr: scoped.gtr,
      since: options.since,
      maxPages: options.maxPages,
      maxOrgFetches:
        options.maxOrgFetches ?? deps.config.maxGrantOrgFetchesPerRun,
      now: () => scoped.clock.now(),
    });
    return {
      stats: { ...(await emptyRunStats(scoped)), grantCollect },
      errors: [],
      warnings: grantCollect.lastError
        ? [`grants stopped early: ${grantCollect.lastError}`]
        : [],
    };
  });
}

/**
 * `pnpm ingest enrich`: the slow, paid work that used to run every hour, now
 * in the daily workflow (D67). In order: grant tagging, grant resolution, tag
 * embedding, then theme assignment and naming. A budget pause or provider
 * refusal stops the paid steps after it. Stops at
 * `MAX_ENRICH_MINUTES_PER_RUN`, between batches and between steps. The
 * rebuilds of locations, stats, confirmations and sectors that depend on it
 * happen in the next hourly run.
 */
export async function runEnrich(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
): Promise<RunSummary> {
  return recordedRun(deps, lock, trigger, async (base) => {
    const timer = new StepTimer(deps.clock, deps.log);
    const limit = new TimeLimit(
      deps.clock,
      deps.config.maxEnrichMinutesPerRun ?? DEFAULT_ENRICH_MINUTES,
    );
    const scoped: PipelineDeps = { ...base, timer, limit };
    const errors: string[] = [];
    let paidAllowed = true;
    const track = <T>(outcome: StepOutcome<T>): T | undefined => {
      errors.push(...outcome.errors);
      if (outcome.stopsPaidSteps) paidAllowed = false;
      return outcome.stats;
    };
    const spentBefore = await spendSoFar(deps.budget);
    const empty = await emptyRunStats(scoped);

    const grantResolve = track(await grantResolveStep(scoped, { paidAllowed }));
    let embed: EmbedStats | undefined;
    if (limit.reached()) {
      deps.log("step embed: skipped, time limit reached");
      embed = { tagsEmbedded: 0, batches: 0, skipped: true };
    } else {
      embed = track(await embedStep(scoped, { paidAllowed }));
    }
    let themes: ThemeStats | undefined;
    if (limit.reached()) {
      deps.log("step themes: skipped, time limit reached");
      themes = {
        tagsAssigned: 0,
        themesCreated: 0,
        themesNamed: 0,
        skipped: true,
      };
    } else {
      themes = track(await themesStep(scoped, { paidAllowed }));
    }

    const monthToDate = await spendSoFar(deps.budget);
    const budgetPaused = Boolean(
      grantResolve?.budgetPaused || embed?.budgetPaused || themes?.budgetPaused,
    );
    return {
      stats: {
        ...empty,
        grantResolve,
        embed,
        themes,
        spendUsdMicros: monthToDate - spentBefore,
        monthToDateUsdMicros: monthToDate,
        budgetPaused,
        stepMs: timer.stepMs,
        ...(limit.hit ? { stoppedAtTime: true } : {}),
      },
      errors,
      budgetPaused,
    };
  });
}

export interface RegistryRunOptions {
  /** Overrides `MAX_CH_REQUESTS_PER_RUN` (backfills). */
  maxRequests?: number;
}

/**
 * `pnpm ingest registry`: the Companies House step, then confirm, locations
 * and sectors, so new links show in the same run. Without a key the run is
 * recorded with `registry.skipped` and nothing else runs. A failing step
 * never stops the ones after it.
 */
export async function runRegistry(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
  options: RegistryRunOptions = {},
): Promise<RunSummary> {
  return recordedRun(deps, lock, trigger, async (scoped) => {
    const errors: string[] = [];
    const track = <T>(outcome: StepOutcome<T>): T | undefined => {
      errors.push(...outcome.errors);
      return outcome.stats;
    };
    const base = await emptyRunStats(scoped);
    const registry = track(
      await companiesHouseRegistryStep(scoped, {
        maxRequests: options.maxRequests,
      }),
    );
    if (registry?.skipped) return { stats: { ...base, registry }, errors };

    const confirm = track(await confirmEventsStep(scoped));
    const locations = track(await locationsStep(scoped));
    const sectors = track(await sectorsStep(scoped));
    return {
      stats: { ...base, registry, confirm, locations, sectors },
      errors,
    };
  });
}

/** `HTTP_CONTACT` has no email address, so EDGAR may not be called. */
export class FormDContactError extends Error {
  constructor() {
    super(
      "formd needs HTTP_CONTACT to contain an email address (SEC EDGAR fair access). Nothing was fetched.",
    );
    this.name = "FormDContactError";
  }
}

export type FormDRunOptions = FormDStepOptions;

/**
 * `pnpm ingest formd`: collect Form D filings, link issuers, then confirm.
 * Refuses, before taking the lock or recording a run, when `HTTP_CONTACT`
 * has no email address.
 */
export async function runFormD(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
  options: FormDRunOptions = {},
): Promise<RunSummary> {
  const edgar = deps.edgar;
  if (!edgar) throw new FormDContactError();
  return recordedRun(deps, lock, trigger, async (scoped) => {
    const errors: string[] = [];
    const track = <T>(outcome: StepOutcome<T>): T | undefined => {
      errors.push(...outcome.errors);
      return outcome.stats;
    };
    const base = await emptyRunStats(scoped);
    const formD = track(await formDStep(scoped, edgar, options));
    const confirm = track(await confirmEventsStep(scoped));
    return { stats: { ...base, formD, confirm }, errors };
  });
}

/**
 * `pnpm ingest relink-grants`: the one-off relink of news grant reports to
 * grant events (spec-phase3 section 9.4). Run under the lock by the CLI.
 */
export function relinkGrantsStep(
  deps: PipelineDeps,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<RelinkGrantsResult> {
  return relinkGrantReports({
    db: deps.db,
    now: () => deps.clock.now(),
    dryRun,
  });
}

export interface ReextractOptions {
  promptVersion: string;
  limit: number;
  dryRun: boolean;
  yes: boolean;
}

export interface ReextractSummary {
  items: number;
  estimatedUsdMicros: number;
  extracted: number;
  dryRun: boolean;
}

/**
 * Explicit re-extraction (D9). A dry run only estimates. A real run needs
 * `yes`, stays subject to the cap, and re-resolves each item.
 */
export async function reextractStep(
  deps: PipelineDeps,
  options: ReextractOptions,
): Promise<ReextractSummary> {
  if (options.promptVersion !== EXTRACTION_PROMPT_VERSION) {
    throw new Error(
      `This build's prompt is ${EXTRACTION_PROMPT_VERSION}, not ${options.promptVersion}`,
    );
  }
  const items = await listItemsForReextract(deps.db, {
    promptVersion: options.promptVersion,
    limit: options.limit,
  });
  let estimatedUsdMicros = 0;
  for (const item of items) {
    estimatedUsdMicros += estimateCost({
      model: deps.config.model,
      system: buildSystemPrompt(),
      user: buildUserPrompt({
        title: item.title,
        summary: item.summary,
        url: item.url,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
      }),
      maxOutputTokens: 1200,
    }).usdMicros;
  }
  const summary: ReextractSummary = {
    items: items.length,
    estimatedUsdMicros,
    extracted: 0,
    dryRun: options.dryRun,
  };
  if (options.dryRun) return summary;
  if (!options.yes) {
    throw new Error("Re-extraction spends money: pass --yes or --dry-run.");
  }
  if (!deps.llm) throw new Error("Re-extraction needs OPENAI_API_KEY.");

  for (const item of items) {
    const { stored } = await extractOne(deps, deps.llm, item, deps.runId);
    await resolveExtraction(deps.db, stored.id);
    summary.extracted += 1;
  }
  return summary;
}
