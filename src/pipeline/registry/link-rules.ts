// Registry link rules (docs/spec-phase3.md sections 7.2 and 8.3, D53, D61).
// Pure functions over normalised facts, so the link eval replays them with no
// network. Precision comes first: a wrong link puts another company's facts
// on a real company's page, while a missed link only leaves a gap.
//
// Changes from the spec tables, all towards fewer automatic links:
// - D61: a trading-name prefix match never links on its own. It goes to review.
// - Location alone (S2) links only when the matched name has two or more
//   words. Single-word brand names ("Nova") often belong to an unrelated
//   company in the same city.
// - A company whose known country is not GB is not linked to a UK company
//   automatically: the UK company is usually a subsidiary.
// - A grant number (step 0) links only when nothing conflicts, and no other
//   number links automatically while the grant names one.
// - A Form D links a single-word name only when amounts were compared.
// - A Form D whose year of incorporation is more than 2 years from the news
//   founded year conflicts, as for Companies House.

import type { RegistrySearchOutcome } from "@/core/enums";
import {
  normaliseCompanyNumber,
  type CapitalFiling,
  type FormDFacts,
  type LinkCandidateDecision,
  type RegistryCompanyFacts,
} from "@/core/registry";
import { haversineKm, type LatLon } from "@/lib/geo/distance";
import { outcodeCentroid, parseUkPostcode } from "@/lib/geo/postcode";
import { normaliseCompanyName } from "@/lib/normalise";
import {
  allotmentConfirms,
  dayNumber,
  daysBetween,
  formDComparesAmounts,
  formDConfirms,
  isConfirmable,
  isEquityRound,
  type ConfirmableEvent,
} from "./confirm-rules";

// ---------------------------------------------------------------------------
// Names

export type NameMatch = "exact" | "prefix" | "none";

/** Names shorter than this, once normalised, are never searched or matched. */
export const MIN_NAME_LENGTH = 3;

/** `normaliseCompanyName` with "&" read as "and" (spec section 7.2). */
export function registryNormalise(name: string): string {
  return normaliseCompanyName(name.replace(/&/g, " and "));
}

/** Spaces ignored, so "AcmeBio" and "Acme Bio Ltd" are the same name. */
function nameKey(normalised: string): string {
  return normalised.replace(/ /g, "");
}

/** The company's usable names, normalised: at least 3 characters, no duplicates. */
export function usableNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const normalised = registryNormalise(name);
    if (normalised.length < MIN_NAME_LENGTH) continue;
    if (!out.includes(normalised)) out.push(normalised);
  }
  return out;
}

export interface NameMatchDetail {
  match: NameMatch;
  /** The company name (normalised) that matched, or null. */
  companyName: string | null;
  /** True when the exact match was on a previous registry name. */
  viaPreviousName: boolean;
}

export function registryNameMatchDetail(
  companyNames: readonly string[],
  registryName: string,
  previousNames: readonly string[] = [],
): NameMatchDetail {
  const names = usableNames(companyNames);
  const current = registryNormalise(registryName);
  for (const name of names) {
    if (current.length > 0 && nameKey(current) === nameKey(name)) {
      return { match: "exact", companyName: name, viaPreviousName: false };
    }
  }
  for (const previous of previousNames) {
    const key = nameKey(registryNormalise(previous));
    if (key.length === 0) continue;
    const name = names.find((candidate) => nameKey(candidate) === key);
    if (name !== undefined) {
      return { match: "exact", companyName: name, viaPreviousName: true };
    }
  }
  // Previous names count for exact matches only.
  const name = names.find((candidate) => current.startsWith(`${candidate} `));
  if (name !== undefined) {
    return { match: "prefix", companyName: name, viaPreviousName: false };
  }
  return { match: "none", companyName: null, viaPreviousName: false };
}

/**
 * `exact` when the registry name or a previous name equals one of the
 * company's names, `prefix` when the registry name starts with one of them
 * followed by a space, else `none`.
 */
export function registryNameMatch(
  companyNames: readonly string[],
  registryName: string,
  previousNames: readonly string[] = [],
): NameMatch {
  return registryNameMatchDetail(companyNames, registryName, previousNames)
    .match;
}

function wordCount(normalised: string): number {
  return normalised.split(" ").filter((word) => word.length > 0).length;
}

// ---------------------------------------------------------------------------
// Dates

function addDays(date: string, days: number): string {
  const day = dayNumber(date);
  if (day === null) return date;
  return new Date((day + days) * 86_400_000).toISOString().slice(0, 10);
}

/** The first and last day an event may have happened, by its precision. */
function eventPeriod(
  event: ConfirmableEvent,
): { start: string; end: string } | null {
  if (dayNumber(event.announcedOn) === null) return null;
  const year = Number(event.announcedOn.slice(0, 4));
  const month = Number(event.announcedOn.slice(5, 7));
  if (event.datePrecision === "day") {
    return { start: event.announcedOn, end: event.announcedOn };
  }
  if (event.datePrecision === "month") {
    const start = `${event.announcedOn.slice(0, 7)}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function roundLabel(event: ConfirmableEvent): string {
  if (event.type !== "funding_round") return event.type.replace(/_/g, " ");
  if (event.roundType === null || event.roundType === "unknown") return "round";
  return event.roundType.replace(/_/g, " ");
}

function daysText(days: number): string {
  if (days === 0) return "same day as";
  const unit = Math.abs(days) === 1 ? "day" : "days";
  return `${Math.abs(days)} ${unit} ${days < 0 ? "before" : "after"}`;
}

// ---------------------------------------------------------------------------
// Companies House: company facts and conflicts

/** A place for the location signal: a point, or a postcode district. */
export interface LinkLocation {
  /** A town or district name, for the reason text. */
  label: string;
  lat?: number | null;
  lon?: number | null;
  outcode?: string | null;
}

export interface ChLinkCompany {
  /** The company name first, then its aliases. */
  names: string[];
  countryCode: string | null;
  /** A founded year stated by news. Never one taken from a registry. */
  foundedYear: number | null;
  /** All of the company's events. */
  events: ConfirmableEvent[];
  /** A news or grant location. Never one taken from the registered office. */
  location: LinkLocation | null;
  /** Full postcodes of the company's grant participants. */
  grantPostcodes: string[];
  /** A company number given by a grant record (Phase 2). */
  grantCompanyNumber: string | null;
  /** Numbers a manual decision rejected for this company. */
  rejectedNumbers: string[];
}

export interface ChLinkCandidate {
  profile: RegistryCompanyFacts;
  /** Capital filings, or null when not fetched yet. An empty list means none filed. */
  filings: CapitalFiling[] | null;
  /** The office postcode is shared by many active companies (section 7.3). */
  officePostcodeShared: boolean;
}

export interface ChLinkInput {
  company: ChLinkCompany;
  /** Profiles of the search matches, in search order. */
  candidates: ChLinkCandidate[];
  /** Numbers already `linked` to other companies. */
  linkedToOthers: Iterable<string>;
}

/** Company types with no share capital, which cannot raise equity (section 7.2). */
export const NO_SHARE_CAPITAL_TYPES: ReadonlySet<string> = new Set([
  "private-limited-guarant-nsc",
  "private-limited-guarant-nsc-limited-exemption",
  "private-unlimited-nsc",
  "llp",
  "limited-partnership",
  "scottish-partnership",
  "charitable-incorporated-organisation",
  "scottish-charitable-incorporated-organisation",
  "industrial-and-provident-society",
  "registered-society-non-jurisdictional",
  "royal-charter",
]);

/** How far apart a news founded year and the incorporation year may be. */
export const FOUNDED_YEAR_TOLERANCE = 2;
/** Most distance between the office district and the company's town for S2. */
export const LOCATION_MAX_KM = 25;
/** Most prefix candidates sent to review. */
export const MAX_PREFIX_CANDIDATES = 3;

/**
 * The conflicts that rule a registry company out (section 7.2, step 2), except
 * "taken", which depends on other companies. Event dates are read generously
 * for the company: an event counts from the start to the end of its period.
 */
export function chConflicts(
  company: Pick<ChLinkCompany, "events" | "foundedYear">,
  profile: RegistryCompanyFacts,
): string[] {
  const conflicts: string[] = [];
  const periods = company.events
    .map(eventPeriod)
    .filter((period) => period !== null);

  if (periods.length > 0 && dayNumber(profile.incorporatedOn) !== null) {
    const earliestEnd = periods.map((p) => p.end).sort()[0] ?? "";
    if (profile.incorporatedOn > earliestEnd) {
      conflicts.push(
        `too young: incorporated ${profile.incorporatedOn}, after the first event (${earliestEnd})`,
      );
    }
  }

  if (
    periods.length > 0 &&
    profile.ceasedOn !== null &&
    dayNumber(profile.ceasedOn) !== null
  ) {
    const latestStart =
      periods
        .map((p) => p.start)
        .sort()
        .at(-1) ?? "";
    if (profile.ceasedOn < latestStart) {
      conflicts.push(
        `closed too early: ceased ${profile.ceasedOn}, before the latest event (${latestStart})`,
      );
    }
  }

  const equity = company.events.filter(isEquityRound);
  if (
    profile.accountsType === "dormant" &&
    profile.accountsMadeUpTo !== null &&
    dayNumber(profile.accountsMadeUpTo) !== null
  ) {
    const yearEnd = profile.accountsMadeUpTo;
    const yearStart = addDays(
      `${Number(yearEnd.slice(0, 4)) - 1}${yearEnd.slice(4)}`,
      1,
    );
    const inside = equity.find((event) => {
      const period = eventPeriod(event);
      return (
        period !== null && period.start >= yearStart && period.end <= yearEnd
      );
    });
    if (inside) {
      conflicts.push(
        `dormant through a round: dormant accounts to ${yearEnd}, ${roundLabel(inside)} ${inside.announcedOn}`,
      );
    }
  }

  if (equity.length > 0 && NO_SHARE_CAPITAL_TYPES.has(profile.companyType)) {
    conflicts.push(
      `no share capital (${profile.companyType}) but an equity round`,
    );
  }

  if (
    company.foundedYear !== null &&
    dayNumber(profile.incorporatedOn) !== null
  ) {
    const incorporated = Number(profile.incorporatedOn.slice(0, 4));
    if (Math.abs(incorporated - company.foundedYear) > FOUNDED_YEAR_TOLERANCE) {
      conflicts.push(
        `founded year disagrees: news ${company.foundedYear}, incorporated ${incorporated}`,
      );
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Companies House: support signals

function officeOutcode(profile: RegistryCompanyFacts): string | null {
  if (profile.officeOutcode) return profile.officeOutcode.trim().toUpperCase();
  if (!profile.officePostcode) return null;
  return parseUkPostcode(profile.officePostcode)?.outcode ?? null;
}

/** S1: a grant participant's postcode equals the office postcode, or its outcode. */
export function grantPostcodeSignal(
  company: Pick<ChLinkCompany, "grantPostcodes">,
  candidate: Pick<ChLinkCandidate, "profile" | "officePostcodeShared">,
): string | null {
  const office = candidate.profile.officePostcode
    ? parseUkPostcode(candidate.profile.officePostcode)
    : null;
  const outcode = office?.outcode ?? officeOutcode(candidate.profile);
  if (outcode === null) return null;
  let sameOutcode = false;
  for (const text of company.grantPostcodes) {
    const grant = parseUkPostcode(text);
    if (!grant) continue;
    if (
      office &&
      grant.outcode === office.outcode &&
      grant.incode === office.incode
    ) {
      return `S1 grant postcode is the office postcode (${outcode})`;
    }
    if (grant.outcode === outcode) sameOutcode = true;
  }
  // A shared office postcode says little about where a company is: only a
  // full postcode match counts there.
  if (sameOutcode && !candidate.officePostcodeShared) {
    return `S1 grant postcode in the office district ${outcode}`;
  }
  return null;
}

function locationPoint(location: LinkLocation): LatLon | null {
  if (
    location.lat !== null &&
    location.lat !== undefined &&
    location.lon !== null &&
    location.lon !== undefined
  ) {
    return { lat: location.lat, lon: location.lon };
  }
  if (location.outcode) {
    const centroid = outcodeCentroid(location.outcode);
    if (centroid) return { lat: centroid.lat, lon: centroid.lon };
  }
  return null;
}

/** S2: the office district's centroid is within 25 km of the company's town. Ignored for a shared office postcode. */
export function locationSignal(
  company: Pick<ChLinkCompany, "location">,
  candidate: Pick<ChLinkCandidate, "profile" | "officePostcodeShared">,
): string | null {
  if (company.location === null || candidate.officePostcodeShared) return null;
  const outcode = officeOutcode(candidate.profile);
  if (outcode === null) return null;
  const office = outcodeCentroid(outcode);
  const place = locationPoint(company.location);
  if (!office || !place) return null;
  const km = haversineKm(place, { lat: office.lat, lon: office.lon });
  if (km > LOCATION_MAX_KM) return null;
  return `S2 ${outcode} ${Math.round(km)} km from ${company.location.label}`;
}

/**
 * S3: an SH01 allotted 120 days before to 30 days after an equity round. Null
 * when no filing fits; undefined when filings are not fetched yet.
 */
export function filingSignal(
  company: Pick<ChLinkCompany, "events">,
  candidate: Pick<ChLinkCandidate, "filings">,
): string | null | undefined {
  if (candidate.filings === null) return undefined;
  let best: {
    days: number;
    filing: CapitalFiling;
    event: ConfirmableEvent;
  } | null = null;
  for (const filing of candidate.filings) {
    for (const event of company.events) {
      const result = allotmentConfirms(event, filing);
      if (!result.confirms || result.daysFromEvent === null) continue;
      if (
        best === null ||
        Math.abs(result.daysFromEvent) < Math.abs(best.days)
      ) {
        best = { days: result.daysFromEvent, filing, event };
      }
    }
  }
  if (best === null) return null;
  return `S3 ${best.filing.type.toUpperCase()} ${best.filing.actionDate ?? ""}, ${daysText(best.days)} ${roundLabel(best.event)} ${best.event.announcedOn}`;
}

function foundedYearNote(
  company: Pick<ChLinkCompany, "foundedYear">,
  profile: RegistryCompanyFacts,
): string | null {
  if (company.foundedYear === null) return null;
  return Number(profile.incorporatedOn.slice(0, 4)) === company.foundedYear
    ? `founded ${company.foundedYear} as incorporated`
    : null;
}

// ---------------------------------------------------------------------------
// Companies House: the decision

export interface ChLinkResult {
  outcome: RegistrySearchOutcome;
  /** One decision per distinct candidate number, in input order. */
  decisions: LinkCandidateDecision[];
  /**
   * Candidates whose capital filings are not fetched but could change the
   * decision. Fetch them and decide again.
   */
  needsFilings: string[];
  /** Numbers linked to another company that this one also matches exactly: merge candidates. */
  mergeCandidates: Array<{ registryId: string; reason: string }>;
  reason: string;
}

interface Assessed {
  number: string;
  candidate: ChLinkCandidate;
  name: NameMatchDetail;
  rejected: boolean;
  conflicts: string[];
}

function nameText(detail: NameMatchDetail): string {
  if (detail.match === "exact") {
    return detail.viaPreviousName ? "exact previous name" : "exact name";
  }
  return detail.match === "prefix" ? "prefix name" : "no name match";
}

function joinReason(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part) => part).join("; ");
}

function availableSignals(
  company: ChLinkCompany,
  candidate: ChLinkCandidate,
): { s1: string | null; s2: string | null; s3: string | null | undefined } {
  return {
    s1: grantPostcodeSignal(company, candidate),
    s2: locationSignal(company, candidate),
    s3: filingSignal(company, candidate),
  };
}

/**
 * Decides a company's Companies House link (section 7.2, steps 0, 2, 3, 4).
 * Returns a decision for every candidate, the overall outcome, and which
 * candidates need capital filings before the decision is final.
 */
export function decideChLink(input: ChLinkInput): ChLinkResult {
  const { company } = input;
  const linkedToOthers = new Set(
    [...input.linkedToOthers].map((n) => normaliseCompanyNumber(n) ?? n),
  );
  const rejected = new Set(
    company.rejectedNumbers.map((n) => normaliseCompanyNumber(n) ?? n),
  );
  const grantNumber = company.grantCompanyNumber
    ? (normaliseCompanyNumber(company.grantCompanyNumber) ??
      company.grantCompanyNumber)
    : null;

  const seen = new Set<string>();
  const assessed: Assessed[] = [];
  for (const candidate of input.candidates) {
    const number =
      normaliseCompanyNumber(candidate.profile.companyNumber) ??
      candidate.profile.companyNumber;
    if (seen.has(number)) continue;
    seen.add(number);
    const name = registryNameMatchDetail(
      company.names,
      candidate.profile.name,
      candidate.profile.previousNames,
    );
    const conflicts = chConflicts(company, candidate.profile);
    if (linkedToOthers.has(number)) {
      conflicts.push("taken: already linked to another company");
    }
    assessed.push({
      number,
      candidate,
      name,
      rejected: rejected.has(number),
      conflicts,
    });
  }

  const decisions = new Map<string, LinkCandidateDecision>();
  const needsFilings: string[] = [];
  const mergeCandidates: ChLinkResult["mergeCandidates"] = [];

  for (const item of assessed) {
    if (
      item.name.match === "exact" &&
      linkedToOthers.has(item.number) &&
      !item.rejected
    ) {
      mergeCandidates.push({
        registryId: item.number,
        reason: `same Companies House number (${item.number})`,
      });
    }
  }

  const finish = (fallback: string): ChLinkResult => {
    const list = assessed.map(
      (item) =>
        decisions.get(item.number) ?? {
          outcome: "none" as const,
          registryId: item.number,
          reason: fallback,
        },
    );
    const linked = list.find((d) => d.outcome === "linked");
    const candidates = list.filter((d) => d.outcome === "candidate");
    const outcome = linked
      ? "linked"
      : candidates.length > 0
        ? "candidates"
        : "none";
    const reason = linked
      ? linked.reason
      : candidates.length > 0
        ? `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} for review`
        : mergeCandidates.length > 0
          ? `no link; merge candidate: ${mergeCandidates.map((m) => m.reason).join(", ")}`
          : "no candidate left";
    return { outcome, decisions: list, needsFilings, mergeCandidates, reason };
  };

  if (usableNames(company.names).length === 0) {
    for (const item of assessed) {
      decisions.set(item.number, {
        outcome: "none",
        registryId: item.number,
        reason: "skipped: no name of at least 3 characters",
      });
    }
    const result = finish("skipped");
    return { ...result, outcome: "skipped", reason: "no usable name" };
  }

  // Reasons for candidates that are out before the decision table.
  for (const item of assessed) {
    if (item.rejected) {
      decisions.set(item.number, {
        outcome: "none",
        registryId: item.number,
        reason: "rejected by a manual decision",
      });
    } else if (item.name.match === "none" && item.number !== grantNumber) {
      decisions.set(item.number, {
        outcome: "none",
        registryId: item.number,
        reason: "no name match",
      });
    } else if (item.conflicts.length > 0) {
      decisions.set(item.number, {
        outcome: "none",
        registryId: item.number,
        reason: joinReason([nameText(item.name), ...item.conflicts]),
      });
    }
  }

  // Step 0: a number from a grant record.
  if (grantNumber !== null) {
    const item = assessed.find((a) => a.number === grantNumber);
    if (item && !item.rejected) {
      if (item.name.match === "exact" && item.conflicts.length === 0) {
        decisions.set(item.number, {
          outcome: "linked",
          registryId: item.number,
          method: "grant_number",
          reason: joinReason([
            `grant number, ${nameText(item.name)}`,
            foundedYearNote(company, item.candidate.profile),
          ]),
        });
        return finish("the grant number decided");
      }
      if (!linkedToOthers.has(item.number)) {
        decisions.set(item.number, {
          outcome: "candidate",
          registryId: item.number,
          reason: joinReason([
            item.name.match === "exact"
              ? "grant number"
              : "grant number, name differs",
            ...item.conflicts,
          ]),
        });
      }
    }
  }

  const open = assessed.filter(
    (a) => !a.rejected && a.conflicts.length === 0 && a.number !== grantNumber,
  );
  const exact = open.filter((a) => a.name.match === "exact");
  const prefix = open.filter((a) => a.name.match === "prefix");
  const grantNote =
    grantNumber !== null && !rejected.has(grantNumber)
      ? `the grant gives number ${grantNumber}`
      : null;
  const foreign =
    company.countryCode !== null && company.countryCode.toUpperCase() !== "GB"
      ? `company country is ${company.countryCode.toUpperCase()}`
      : null;

  if (exact.length === 1) {
    const item = exact[0];
    if (item === undefined) return finish("no candidate left");
    const signals = availableSignals(company, item.candidate);
    const words = wordCount(item.name.companyName ?? "");
    const blocker = grantNote ?? foreign;
    const s3Matters =
      blocker === null &&
      signals.s1 === null &&
      company.events.some(isConfirmable);
    if (signals.s3 === undefined && s3Matters) needsFilings.push(item.number);
    const notes = [
      signals.s1,
      signals.s3,
      signals.s2,
      foundedYearNote(company, item.candidate.profile),
    ];
    const base = nameText(item.name);
    let method: "name_grant_postcode" | "name_filing" | "name_location" | null =
      null;
    let reviewWhy: string | null = blocker;
    if (blocker === null) {
      if (signals.s1) method = "name_grant_postcode";
      else if (signals.s3) method = "name_filing";
      else if (signals.s2 && words >= 2) method = "name_location";
      else if (signals.s2) {
        reviewWhy = "single-word name: location alone is not enough";
      } else if (signals.s3 === undefined && s3Matters) {
        reviewWhy = "no signal yet: capital filings not fetched";
      } else {
        reviewWhy = "no supporting signal";
      }
    }
    if (method !== null) {
      decisions.set(item.number, {
        outcome: "linked",
        registryId: item.number,
        method,
        reason: joinReason([base, ...notes]),
      });
    } else {
      decisions.set(item.number, {
        outcome: "candidate",
        registryId: item.number,
        reason: joinReason([base, reviewWhy, ...notes]),
      });
    }
    return finish("an exact candidate decided");
  }

  if (exact.length > 1) {
    for (const item of exact) {
      const signals = availableSignals(company, item.candidate);
      decisions.set(item.number, {
        outcome: "candidate",
        registryId: item.number,
        reason: joinReason([
          nameText(item.name),
          `${exact.length} exact candidates`,
          signals.s1,
          signals.s3,
          signals.s2,
        ]),
      });
    }
    return finish("exact candidates decided");
  }

  // No exact candidate: prefix matches go to review (D61), never linked.
  for (const item of prefix.slice(0, MAX_PREFIX_CANDIDATES)) {
    const signals = availableSignals(company, item.candidate);
    decisions.set(item.number, {
      outcome: "candidate",
      registryId: item.number,
      reason: joinReason([
        nameText(item.name),
        "trading name: review",
        signals.s1,
        signals.s3,
        signals.s2,
      ]),
    });
  }
  return finish(
    prefix.length > MAX_PREFIX_CANDIDATES
      ? "more than three prefix candidates"
      : "no candidate left",
  );
}

// ---------------------------------------------------------------------------
// SEC Form D (section 8.3)

export interface FormDLinkCompany {
  companyId: number;
  /** The company name first, then its aliases. Non-merged companies only. */
  names: string[];
  countryCode: string | null;
  /** The CIK the company is linked to, if any. */
  secCik: string | null;
  /** A founded year stated by news. */
  foundedYear: number | null;
  events: ConfirmableEvent[];
  /** CIKs a manual decision rejected for this company. */
  rejectedCiks?: string[];
}

export type FormDLinkResult =
  | { outcome: "owned"; companyId: number; reason: string }
  | {
      outcome: "linked";
      companyId: number;
      method: "form_d_round";
      eventId: number;
      reason: string;
    }
  | { outcome: "candidate"; companyId: number; reason: string }
  | { outcome: "none"; companyId: null; reason: string };

/** A funding round this close to the filing makes a review candidate. */
export const FORM_D_CANDIDATE_DAYS = 365;

function formDConflicts(
  filing: FormDFacts,
  company: FormDLinkCompany,
): string[] {
  const conflicts: string[] = [];
  if (
    company.countryCode !== null &&
    company.countryCode.toUpperCase() !== "US"
  ) {
    conflicts.push(`country ${company.countryCode.toUpperCase()}`);
  }
  if (company.secCik !== null && company.secCik !== filing.cik) {
    conflicts.push(`linked to CIK ${company.secCik}`);
  }
  if ((company.rejectedCiks ?? []).includes(filing.cik)) {
    conflicts.push("rejected by a manual decision");
  }
  if (
    company.foundedYear !== null &&
    filing.yearOfInc !== null &&
    Math.abs(filing.yearOfInc - company.foundedYear) > FOUNDED_YEAR_TOLERANCE
  ) {
    conflicts.push(
      `founded year disagrees: news ${company.foundedYear}, incorporated ${filing.yearOfInc}`,
    );
  }
  return conflicts;
}

/**
 * Decides which company a Form D belongs to (section 8.3): by CIK, else by
 * exact name with no conflict, linked only when the filing confirms a round.
 */
export function decideFormDLink(
  filing: FormDFacts,
  companies: readonly FormDLinkCompany[],
): FormDLinkResult {
  const owner = companies.find((company) => company.secCik === filing.cik);
  if (owner) {
    return {
      outcome: "owned",
      companyId: owner.companyId,
      reason: `already linked to CIK ${filing.cik}`,
    };
  }

  const issuer = registryNormalise(filing.issuerName);
  if (issuer.length < MIN_NAME_LENGTH) {
    return {
      outcome: "none",
      companyId: null,
      reason: "issuer name too short",
    };
  }
  const named = companies.filter((company) =>
    usableNames(company.names).some(
      (name) => nameKey(name) === nameKey(issuer),
    ),
  );
  if (named.length === 0) {
    return { outcome: "none", companyId: null, reason: "no exact name match" };
  }
  const left = named.filter((c) => formDConflicts(filing, c).length === 0);
  if (left.length === 0) {
    const first = named[0];
    const why = first ? formDConflicts(filing, first).join(", ") : "";
    return { outcome: "none", companyId: null, reason: `conflict: ${why}` };
  }
  if (left.length > 1) {
    return {
      outcome: "none",
      companyId: null,
      reason: `${left.length} companies share the name`,
    };
  }
  const company = left[0];
  if (company === undefined) {
    return { outcome: "none", companyId: null, reason: "no company left" };
  }

  let best: {
    event: ConfirmableEvent;
    days: number;
    compared: boolean;
  } | null = null;
  for (const event of company.events) {
    const result = formDConfirms(event, filing);
    if (!result.confirms || result.daysFromEvent === null) continue;
    if (
      best === null ||
      Math.abs(result.daysFromEvent) < Math.abs(best.days) ||
      (Math.abs(result.daysFromEvent) === Math.abs(best.days) &&
        event.id < best.event.id)
    ) {
      best = {
        event,
        days: result.daysFromEvent,
        compared: formDComparesAmounts(event, filing),
      };
    }
  }

  if (best !== null) {
    const words = wordCount(issuer);
    const amountNote = best.compared ? "amounts agree" : "amounts not compared";
    const reason = joinReason([
      "exact name",
      `Form D first sale ${filing.dateOfFirstSale ?? ""}, ${daysText(best.days)} ${roundLabel(best.event)} ${best.event.announcedOn}`,
      amountNote,
    ]);
    if (best.compared || words >= 2) {
      return {
        outcome: "linked",
        companyId: company.companyId,
        method: "form_d_round",
        eventId: best.event.id,
        reason,
      };
    }
    return {
      outcome: "candidate",
      companyId: company.companyId,
      reason: joinReason([
        reason,
        "single-word name: a date alone is not enough",
      ]),
    };
  }

  const near = company.events.find((event) => {
    if (event.type !== "funding_round") return false;
    const days = daysBetween(event.announcedOn, filing.filedOn);
    return days !== null && Math.abs(days) <= FORM_D_CANDIDATE_DAYS;
  });
  if (near) {
    return {
      outcome: "candidate",
      companyId: company.companyId,
      reason: `exact name; ${roundLabel(near)} ${near.announcedOn} within ${FORM_D_CANDIDATE_DAYS} days of the filing, not confirmed`,
    };
  }
  return {
    outcome: "none",
    companyId: null,
    reason: "exact name, but no funding round near the filing",
  };
}
