import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type {
  CollectStats,
  ExtractStats,
  FxStats,
  IngestStats,
  PrefilterStats,
  ResolveStats,
} from "@/core/domain";
import type { IngestStatus, IngestTrigger } from "@/core/enums";
import {
  BudgetExceededError,
  ExtractionValidationError,
  UnknownModelPriceError,
} from "@/core/errors";
import type {
  BudgetGuard,
  Clock,
  Collector,
  FxProvider,
  LlmClient,
} from "@/core/ports";
import type { Db } from "@/db/client";
import {
  acquisitions,
  events,
  fundingRounds,
  investors,
  mergeCandidates,
} from "@/db/schema";
import { extractItem } from "./extract/extract-item";
import { isCandidate } from "./extract/prefilter";
import { estimateCost } from "./extract/pricing";
import {
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "./extract/prompt";
import { type IngestLock, withIngestLock } from "./lock";
import { recomputeEvent } from "./resolve/canonicalise";
import { resolveExtraction } from "./resolve/resolve-extraction";
import { SOURCES } from "./sources";
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

/** Much larger than any real backlog; keeps one query from being unbounded. */
const STEP_BATCH_LIMIT = 5000;
const FX_LOOKBACK_DAYS = 7;

export interface PipelineConfig {
  model: string;
  maxExtractionsPerRun: number;
  capGbp: number;
}

export interface PipelineDeps {
  db: Db;
  collector: Collector;
  /** Null when no key is configured: new items wait for a later run. */
  llm: LlmClient | null;
  budget: BudgetGuard;
  fx: FxProvider;
  clock: Clock;
  config: PipelineConfig;
  /** Never receives secrets or article text. */
  log: (message: string) => void;
  runId?: number;
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

export async function collectStep(deps: PipelineDeps): Promise<CollectStats> {
  const stats: CollectStats = {
    sourcesAttempted: 0,
    sourcesNotModified: 0,
    sourcesFailed: 0,
    itemsFound: 0,
    itemsInserted: 0,
  };
  for (const source of await listEnabledSources(deps.db)) {
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
  };
  const before = await resolutionCounts(deps.db);
  const pending = await listUnresolvedExtractions(deps.db, STEP_BATCH_LIMIT);
  for (const extraction of pending) {
    try {
      const outcome = await resolveExtraction(deps.db, extraction.id);
      if (outcome.alreadyResolved) continue;
      stats.extractionsResolved += 1;
      stats.companiesCreated += outcome.companiesCreated;
      stats.eventsCreated += outcome.eventsCreated;
      stats.eventsUpdated += outcome.eventsUpdated;
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

export interface RunSummary {
  ran: boolean;
  status?: IngestStatus;
  runId?: number;
  stats?: IngestStats;
}

async function spendSoFar(budget: BudgetGuard): Promise<number> {
  const { spentUsdMicros } = await budget.monthToDate();
  return spentUsdMicros;
}

/** One locked, idempotent ingest run. Spec section 7. */
export async function runAll(
  deps: PipelineDeps,
  lock: IngestLock,
  trigger: IngestTrigger,
): Promise<RunSummary> {
  const locked = await withIngestLock(lock, async () => {
    const run = await startRun(deps.db, trigger);
    const scoped: PipelineDeps = { ...deps, runId: run.id };
    try {
      await upsertSources(deps.db, SOURCES);
      const spentBefore = await spendSoFar(deps.budget);
      const collect = await collectStep(scoped);
      const prefilter = await prefilterStep(scoped);
      const { budgetPaused, ...extract } = await extractStep(scoped);
      const resolve = await resolveStep(scoped);
      const fx = await fxStep(scoped);
      const monthToDate = await spendSoFar(deps.budget);

      const stats: IngestStats = {
        collect,
        prefilter,
        extract,
        resolve,
        fx,
        spendUsdMicros: monthToDate - spentBefore,
        monthToDateUsdMicros: monthToDate,
        capGbp: deps.config.capGbp,
        budgetPaused,
      };
      let status: IngestStatus = "succeeded";
      if (budgetPaused) status = "budget_paused";
      if (extract.providerError) status = "failed";
      await finishRun(deps.db, run.id, {
        status,
        stats,
        error: extract.providerError ?? null,
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
