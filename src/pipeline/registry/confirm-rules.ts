// Confirmation rules (docs/spec-phase3.md section 9.2, D54). Pure functions:
// an official record confirms a news round when its date falls in a window
// around the round. The link rules (S3 and the Form D link) use the same
// windows, so the rules exist in one place.

import type {
  DatePrecision,
  EventType,
  RecordKind,
  RoundType,
} from "@/core/enums";
import type { CapitalFiling, FormDFacts } from "@/core/registry";

/** The event facts the rules read. Dates are YYYY-MM-DD. */
export interface ConfirmableEvent {
  id: number;
  type: EventType;
  roundType: RoundType | null;
  announcedOn: string;
  datePrecision: DatePrecision;
  /** The news amount in US cents, or null when unknown. */
  amountUsdMinor: number | null;
}

export interface ConfirmationCheck {
  confirms: boolean;
  /** True only when the record's amount agrees (Form D within 15%). */
  confirmsAmount: boolean;
  /** Record date minus event date, in days. Negative means before. Null when not comparable. */
  daysFromEvent: number | null;
}

/** SH01 allotment date: 120 days before to 30 days after the round. */
export const ALLOTMENT_WINDOW = { before: 120, after: 30 } as const;
/** Form D date of first sale: 180 days before to 45 days after the round. */
export const FORM_D_WINDOW = { before: 180, after: 45 } as const;
/** Form D amounts further apart than this do not confirm. */
export const FORM_D_AMOUNT_TOLERANCE = 0.5;
/** Form D amounts this close confirm the amount too. */
export const FORM_D_AMOUNT_CONFIRM = 0.15;

export const RULE_CH_ALLOTMENT = "ch_allotment_window";
export const RULE_FORM_D = "sec_form_d_window";

const DAY_MS = 86_400_000;
const NO_MATCH: ConfirmationCheck = {
  confirms: false,
  confirmsAmount: false,
  daysFromEvent: null,
};

/** Whole days since 1970-01-01 for a YYYY-MM-DD date, or null if invalid. */
export function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ms / DAY_MS;
}

/** Days from `from` to `to`. Null if either date is invalid. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** An equity funding round: not `debt` and not `grant`. */
export function isEquityRound(
  event: Pick<ConfirmableEvent, "type" | "roundType">,
): boolean {
  return (
    event.type === "funding_round" &&
    event.roundType !== "debt" &&
    event.roundType !== "grant"
  );
}

/**
 * The date a window is measured from: the announced day, or the first of the
 * month for a `month` event. Null for `year` precision, which is too vague.
 */
export function eventAnchor(
  event: Pick<ConfirmableEvent, "announcedOn" | "datePrecision">,
): string | null {
  if (dayNumber(event.announcedOn) === null) return null;
  if (event.datePrecision === "day") return event.announcedOn;
  if (event.datePrecision === "month") {
    return `${event.announcedOn.slice(0, 7)}-01`;
  }
  return null;
}

/** An equity round with `day` or `month` precision, so a record can confirm it. */
export function isConfirmable(event: ConfirmableEvent): boolean {
  return isEquityRound(event) && eventAnchor(event) !== null;
}

function offsetInWindow(
  event: ConfirmableEvent,
  recordDate: string | null,
  window: { before: number; after: number },
): number | null {
  if (recordDate === null || !isConfirmable(event)) return null;
  const anchor = eventAnchor(event);
  if (anchor === null) return null;
  const days = daysBetween(anchor, recordDate);
  if (days === null) return null;
  return days >= -window.before && days <= window.after ? days : null;
}

/** Relative gap between two amounts: |a - b| / max(a, b). */
export function amountGap(a: number, b: number): number {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  return larger === 0 ? 0 : Math.abs(a - b) / larger;
}

/** C1, C2, C6: an SH01 allotment date inside the window. The amount is never compared. */
export function allotmentConfirms(
  event: ConfirmableEvent,
  filing: CapitalFiling,
): ConfirmationCheck {
  if (filing.type.toUpperCase() !== "SH01") return NO_MATCH;
  const days = offsetInWindow(event, filing.actionDate, ALLOTMENT_WINDOW);
  if (days === null) return NO_MATCH;
  return { confirms: true, confirmsAmount: false, daysFromEvent: days };
}

/**
 * C3, C4, C5: a Form D date of first sale inside the window. When the news
 * amount and a Form D amount are both known, the news amount must be within
 * 50% of total sold or total offering; within 15% also confirms the amount.
 */
export function formDConfirms(
  event: ConfirmableEvent,
  filing: FormDFacts,
): ConfirmationCheck {
  const days = offsetInWindow(event, filing.dateOfFirstSale, FORM_D_WINDOW);
  if (days === null) return NO_MATCH;
  const news = event.amountUsdMinor;
  const filed = [filing.totalSoldUsdMinor, filing.totalOfferingUsdMinor].filter(
    (amount): amount is number => amount !== null && amount > 0,
  );
  if (news === null || news <= 0 || filed.length === 0) {
    return { confirms: true, confirmsAmount: false, daysFromEvent: days };
  }
  const closest = Math.min(...filed.map((amount) => amountGap(news, amount)));
  if (closest > FORM_D_AMOUNT_TOLERANCE) return NO_MATCH;
  return {
    confirms: true,
    confirmsAmount: closest <= FORM_D_AMOUNT_CONFIRM,
    daysFromEvent: days,
  };
}

/** True when a Form D compared amounts (the news amount and a Form D amount are known). */
export function formDComparesAmounts(
  event: Pick<ConfirmableEvent, "amountUsdMinor">,
  filing: FormDFacts,
): boolean {
  return (
    event.amountUsdMinor !== null &&
    event.amountUsdMinor > 0 &&
    [filing.totalSoldUsdMinor, filing.totalOfferingUsdMinor].some(
      (amount) => amount !== null && amount > 0,
    )
  );
}

export type ConfirmationRecord =
  | { kind: "ch_allotment"; id: string; filing: CapitalFiling }
  | { kind: "sec_form_d"; id: string; filing: FormDFacts };

export interface RecordAssignment {
  eventId: number;
  recordKind: Extract<RecordKind, "ch_allotment" | "sec_form_d">;
  recordId: string;
  rule: string;
  recordDate: string;
  confirmsAmount: boolean;
  daysFromEvent: number;
}

function check(
  event: ConfirmableEvent,
  record: ConfirmationRecord,
): ConfirmationCheck {
  return record.kind === "ch_allotment"
    ? allotmentConfirms(event, record.filing)
    : formDConfirms(event, record.filing);
}

function recordDateOf(record: ConfirmationRecord): string {
  return record.kind === "ch_allotment"
    ? (record.filing.actionDate ?? "")
    : (record.filing.dateOfFirstSale ?? "");
}

/**
 * Each record confirms at most one event: the nearest by date, then the lower
 * event id. An event may be confirmed by several records. Sorted by event id,
 * then record kind and id.
 */
export function assignRecords(
  events: readonly ConfirmableEvent[],
  records: readonly ConfirmationRecord[],
): RecordAssignment[] {
  const assignments: RecordAssignment[] = [];
  for (const record of records) {
    let best: { event: ConfirmableEvent; result: ConfirmationCheck } | null =
      null;
    for (const event of events) {
      const result = check(event, record);
      if (!result.confirms || result.daysFromEvent === null) continue;
      if (best === null) {
        best = { event, result };
        continue;
      }
      const distance = Math.abs(result.daysFromEvent);
      const bestDistance = Math.abs(best.result.daysFromEvent ?? 0);
      if (
        distance < bestDistance ||
        (distance === bestDistance && event.id < best.event.id)
      ) {
        best = { event, result };
      }
    }
    if (best === null || best.result.daysFromEvent === null) continue;
    assignments.push({
      eventId: best.event.id,
      recordKind: record.kind,
      recordId: record.id,
      rule: record.kind === "ch_allotment" ? RULE_CH_ALLOTMENT : RULE_FORM_D,
      recordDate: recordDateOf(record),
      confirmsAmount: best.result.confirmsAmount,
      daysFromEvent: best.result.daysFromEvent,
    });
  }
  return assignments.sort(
    (a, b) =>
      a.eventId - b.eventId ||
      a.recordKind.localeCompare(b.recordKind) ||
      a.recordId.localeCompare(b.recordId),
  );
}
