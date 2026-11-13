// The Form D collection step (spec-phase3 sections 6 and 8.2, D51, D58).
// Walks EDGAR daily form indexes, oldest day first, and stores every Form D
// and D/A that is not a pooled investment fund. A day is recorded `done` only
// when every filing in it was processed, so a stopped run resumes cleanly.
// Linking is a separate pass (`link-form-d.ts`).

import type { FormDStats } from "@/core/domain";
import type { Clock } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  EdgarHttpError,
  EdgarThrottledError,
  type EdgarClient,
} from "./edgar-client";
import { parseFormD } from "./form-d-xml";
import {
  accessionFromFileName,
  formDRows,
  parseFormIndex,
  type FormIndexRow,
} from "./form-index";
import {
  earliestRecordedDay,
  emptyFormDStats,
  ensureEdgarSource,
  latestDoneDay,
  recordIndexDay,
  recordedDays,
  storeFormDFiling,
  storedAccessions,
} from "./store-form-d";

/** First run with no `since`: start this many days before today. */
export const FIRST_RUN_DAYS = 7;
/**
 * A weekday index younger than this (in days before today) may still appear,
 * so a 404 is retried by the next run. Older weekday 404s are holidays.
 */
export const RECENT_INDEX_DAYS = 3;
/**
 * Unrecorded days this recent are looked at again, even before the latest
 * done day, so a recent 404 left for the next run is not forgotten. Recorded
 * days cost no request.
 */
export const RECHECK_DAYS = 14;

const EASTERN = "America/New_York";
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface CollectFormDOptions {
  db: Db;
  edgar: EdgarClient;
  clock: Clock;
  /** First day to collect (`yyyy-mm-dd`). Days already recorded are skipped. */
  since?: string;
  /** Days whose index is requested in this run. */
  maxDays: number;
  /** Requests in this run, indexes and filings together. */
  maxRequests: number;
  log?: (message: string) => void;
  /** Added to in place. A new one when missing. */
  stats?: FormDStats;
}

/** Today's date in US Eastern time, `yyyy-mm-dd`. EDGAR days follow it. */
export function easternToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayMs(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`Invalid day: ${day}`);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid day: ${day}`);
  }
  return ms;
}

export function addDays(day: string, days: number): string {
  return new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

function isWeekend(day: string): boolean {
  const weekday = new Date(dayMs(day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * The first day to look at. Without `since`: the day after the latest done
 * day, but never later than 14 days ago (or the first recorded day), so a
 * recent weekday that answered 404 is tried again. On a first run, 7 days ago.
 */
async function startDay(
  db: Db,
  today: string,
  since: string | undefined,
): Promise<string> {
  if (since !== undefined) {
    dayMs(since);
    return since;
  }
  const latest = await latestDoneDay(db);
  if (latest === null) return addDays(today, -FIRST_RUN_DAYS);
  const next = addDays(latest, 1);
  // Never earlier than the first recorded day: rechecking is not a backfill.
  const first = (await earliestRecordedDay(db)) ?? latest;
  const window = addDays(today, -RECHECK_DAYS);
  const recheck = window > first ? window : first;
  return next < recheck ? next : recheck;
}

interface DayResult {
  /** True when the run must stop: the request limit or a throttle. */
  stop: boolean;
}

interface CollectContext {
  db: Db;
  edgar: EdgarClient;
  now: Date;
  sourceId: number;
  stats: FormDStats;
  log: (message: string) => void;
  canRequest: () => boolean;
}

/**
 * One filing: fetch, parse and store. A missing document or a parse failure
 * counts as processed: retrying would give the same answer.
 */
async function collectFiling(
  ctx: CollectContext,
  row: FormIndexRow,
  accession: string,
  counts: { funds: number },
): Promise<void> {
  const { stats, log } = ctx;
  const result = await ctx.edgar.getFormD(row.cik, accession);
  if (result.status === "missing") {
    // The index lists it but the document is not there. Retrying will not help.
    stats.parseFailures += 1;
    log(`formd: ${accession} has no primary_doc.xml`);
    return;
  }
  let parsed;
  try {
    parsed = parseFormD(result.xml, {
      accessionNumber: accession,
      filedOn: row.dateFiled,
    });
  } catch (error) {
    stats.parseFailures += 1;
    const message = error instanceof Error ? error.message : "unknown error";
    log(`formd: ${accession} could not be parsed: ${message}`);
    return;
  }
  const outcome = await storeFormDFiling(ctx.db, ctx.sourceId, parsed, ctx.now);
  if (outcome === "stored") stats.filingsStored += 1;
  if (outcome === "fund") {
    stats.fundsSkipped += 1;
    counts.funds += 1;
  }
}

async function collectDay(
  ctx: CollectContext,
  day: string,
  today: string,
): Promise<DayResult> {
  const { db, stats, log } = ctx;
  const index = await ctx.edgar.getFormIndex(day);
  if (index.status === "missing") {
    const old = dayMs(today) - dayMs(day) > RECENT_INDEX_DAYS * DAY_MS;
    if (isWeekend(day) || old) {
      await recordIndexDay(db, {
        day,
        status: "missing",
        formDFound: 0,
        formDStored: 0,
        fundSkipped: 0,
        now: ctx.now,
      });
      stats.daysMissing += 1;
    } else {
      log(`formd: no index for ${day} yet; left for the next run`);
    }
    return { stop: false };
  }
  stats.daysFetched += 1;

  const rows = formDRows(parseFormIndex(index.text));
  stats.filingsFound += rows.length;
  const byAccession = new Map<string, FormIndexRow>();
  for (const row of rows) {
    const accession = accessionFromFileName(row.fileName);
    if (accession === null) {
      stats.parseFailures += 1;
      log(`formd: ${day} index row has no accession number: ${row.fileName}`);
      continue;
    }
    if (!byAccession.has(accession)) byAccession.set(accession, row);
  }
  const accessions = [...byAccession.keys()];
  const already = await storedAccessions(db, accessions);

  const counts = { funds: 0 };
  let complete = true;
  let stop = false;
  for (const [accession, row] of byAccession) {
    if (already.has(accession)) continue;
    if (!ctx.canRequest()) {
      complete = false;
      stop = true;
      break;
    }
    try {
      await collectFiling(ctx, row, accession, counts);
    } catch (error) {
      // An HTTP error leaves the day open, so the next run tries it again.
      complete = false;
      if (error instanceof EdgarThrottledError) {
        log(`formd: ${error.message}; stopping`);
        stop = true;
        break;
      }
      if (!(error instanceof EdgarHttpError)) throw error;
      log(`formd: ${accession} not fetched: ${error.message}`);
    }
  }

  if (complete) {
    const stored = await storedAccessions(db, accessions);
    await recordIndexDay(db, {
      day,
      status: "done",
      formDFound: rows.length,
      formDStored: stored.size,
      fundSkipped: counts.funds,
      now: ctx.now,
    });
  }
  return { stop };
}

/**
 * Collects Form D filings for days not yet recorded, oldest first, up to
 * yesterday in US Eastern time. Stops before `maxRequests` would be passed.
 * Returns `FormDStats` with the link counts left at zero.
 */
export async function collectFormDStep(
  options: CollectFormDOptions,
): Promise<FormDStats> {
  const { db, edgar, clock } = options;
  const log = options.log ?? (() => undefined);
  const stats = options.stats ?? emptyFormDStats();
  const now = clock.now();
  const today = easternToday(now);
  const yesterday = addDays(today, -1);
  const startCount = edgar.requestCount();
  const used = () => edgar.requestCount() - startCount;

  const from = await startDay(db, today, options.since);
  if (from > yesterday) return stats;
  const recorded = await recordedDays(db, from, yesterday);
  const todo = daysFrom(from, yesterday).filter((day) => !recorded.has(day));
  if (todo.length === 0) return stats;

  const ctx: CollectContext = {
    db,
    edgar,
    now,
    sourceId: await ensureEdgarSource(db),
    stats,
    log,
    canRequest: () => used() < options.maxRequests,
  };

  let daysTried = 0;
  for (const day of todo) {
    if (daysTried >= options.maxDays) break;
    if (!ctx.canRequest()) {
      log(`formd: request limit of ${options.maxRequests} reached`);
      break;
    }
    daysTried += 1;
    let result: DayResult;
    try {
      result = await collectDay(ctx, day, today);
    } catch (error) {
      if (
        !(error instanceof EdgarThrottledError) &&
        !(error instanceof EdgarHttpError)
      ) {
        throw error;
      }
      // An index the SEC would not serve: stop, and try again next run.
      log(`formd: ${error.message}; stopping`);
      break;
    }
    if (result.stop) {
      log(`formd: stopped during ${day}; it will be finished next run`);
      break;
    }
  }

  stats.requests += used();
  return stats;
}
