import type { Money } from "@/core/domain";
import type { EvalCase, EvalExpectedEvent } from "@/core/eval-fixture";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import { parseAmountText } from "@/lib/money";
import { normaliseCompanyName, normaliseInvestorName } from "@/lib/normalise";
import { isCandidate } from "@/pipeline/extract/prefilter";

/** A numerator and denominator, kept apart so totals can be summed. */
export interface Tally {
  hits: number;
  total: number;
}

export interface CaseScore {
  id: string;
  relevance: Tally;
  eventType: Tally;
  companyName: Tally;
  roundType: Tally;
  amount: Tally;
  country: Tally;
  /** Expected a country the fixture text does not have to state; model returned null. */
  countryAbstained: number;
  leadTruePositives: number;
  leadFalsePositives: number;
  leadFalseNegatives: number;
  /** Events the model returned that match no expected event. */
  extraEvents: number;
  prefilterRecall: Tally;
}

export interface EvalMetrics {
  cases: number;
  relevance: number | null;
  eventType: number | null;
  companyName: number | null;
  roundType: number | null;
  amount: number | null;
  /** Accuracy over the countries the model chose to state. */
  country: number | null;
  /** Share of expected countries the model stated at all. */
  countryCoverage: number | null;
  leadF1: number | null;
  /** Sample behind `leadF1`, because a score over a handful of names means little. */
  leadSupport: number;
  extraEvents: number;
  prefilterRecall: number | null;
}

export interface MetricTarget {
  key: keyof EvalMetrics;
  label: string;
  target: number;
}

/** Spec section 10. */
export const TARGETS: readonly MetricTarget[] = [
  { key: "relevance", label: "Relevance", target: 0.95 },
  { key: "eventType", label: "Event type", target: 0.95 },
  { key: "companyName", label: "Company name", target: 0.9 },
  { key: "roundType", label: "Round type", target: 0.85 },
  { key: "amount", label: "Amount and currency", target: 0.9 },
  { key: "leadF1", label: "Lead investors (F1)", target: 0.8 },
  { key: "country", label: "Country, when stated", target: 0.8 },
  { key: "prefilterRecall", label: "Prefilter recall", target: 1 },
];

function emptyTally(): Tally {
  return { hits: 0, total: 0 };
}

function add(tally: Tally, hit: boolean): void {
  tally.total += 1;
  if (hit) tally.hits += 1;
}

function sameMoney(left: Money | null, right: Money | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.amountMinor === right.amountMinor && left.currency === right.currency
  );
}

function actualAmount(event: ExtractedEventV1): Money | null {
  if (event.funding) {
    return parseAmountText(
      event.funding.amountText,
      event.funding.currencyHint,
    );
  }
  if (event.acquisition) {
    return parseAmountText(
      event.acquisition.priceText,
      event.acquisition.currencyHint,
    );
  }
  return null;
}

function nameSet(names: readonly string[]): Set<string> {
  return new Set(names.map(normaliseInvestorName).filter(Boolean));
}

function scoreEvent(
  score: CaseScore,
  expected: EvalExpectedEvent,
  actual: ExtractedEventV1,
): void {
  add(score.eventType, actual.type === expected.type);

  if (expected.type === "funding_round" && expected.roundType !== null) {
    add(score.roundType, actual.funding?.roundType === expected.roundType);
  }

  if (expected.type !== "launch") {
    add(
      score.amount,
      sameMoney(parseAmountText(expected.amountText), actualAmount(actual)),
    );
  }

  if (expected.countryCode !== null) {
    const stated = actual.company.countryCode?.trim().toUpperCase() || null;
    if (stated === null) score.countryAbstained += 1;
    else add(score.country, stated === expected.countryCode);
  }

  if (expected.type === "funding_round") {
    const wanted = nameSet(expected.leadInvestors);
    const found = nameSet(
      (actual.funding?.investors ?? [])
        .filter((investor) => investor.isLead)
        .map((investor) => investor.name),
    );
    for (const name of found) {
      if (wanted.has(name)) score.leadTruePositives += 1;
      else score.leadFalsePositives += 1;
    }
    for (const name of wanted) {
      if (!found.has(name)) score.leadFalseNegatives += 1;
    }
  }
}

/**
 * Scores one case. `actual` is null when the call failed, which counts as a
 * miss on everything the case expected. Events are paired by normalised
 * company name, so a wrong name also loses that event's other metrics.
 */
export function scoreCase(
  testCase: EvalCase,
  actual: ExtractionV1 | null,
): CaseScore {
  const { expected } = testCase;
  const score: CaseScore = {
    id: testCase.id,
    relevance: emptyTally(),
    eventType: emptyTally(),
    companyName: emptyTally(),
    roundType: emptyTally(),
    amount: emptyTally(),
    country: emptyTally(),
    countryAbstained: 0,
    leadTruePositives: 0,
    leadFalsePositives: 0,
    leadFalseNegatives: 0,
    extraEvents: 0,
    prefilterRecall: emptyTally(),
  };

  add(score.relevance, actual?.isRelevant === expected.isRelevant);
  if (expected.isRelevant) {
    add(
      score.prefilterRecall,
      isCandidate({ title: testCase.headline, summary: testCase.summary }),
    );
  }

  const unmatched = [...(actual?.events ?? [])];
  for (const event of expected.events) {
    const wanted = normaliseCompanyName(event.companyName);
    const index = unmatched.findIndex(
      (candidate) => normaliseCompanyName(candidate.company.name) === wanted,
    );
    const match = index === -1 ? null : unmatched.splice(index, 1)[0];
    add(score.companyName, Boolean(match));
    if (match) scoreEvent(score, event, match);
  }
  score.extraEvents = unmatched.length;
  return score;
}

function ratio(tally: Tally): number | null {
  return tally.total === 0 ? null : tally.hits / tally.total;
}

function sum(
  scores: readonly CaseScore[],
  pick: (s: CaseScore) => Tally,
): Tally {
  const total = emptyTally();
  for (const score of scores) {
    const tally = pick(score);
    total.hits += tally.hits;
    total.total += tally.total;
  }
  return total;
}

export function aggregate(scores: readonly CaseScore[]): EvalMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let abstained = 0;
  let extra = 0;
  for (const score of scores) {
    truePositives += score.leadTruePositives;
    falsePositives += score.leadFalsePositives;
    falseNegatives += score.leadFalseNegatives;
    abstained += score.countryAbstained;
    extra += score.extraEvents;
  }

  const support = truePositives + falseNegatives;
  const denominator = 2 * truePositives + falsePositives + falseNegatives;
  const country = sum(scores, (s) => s.country);
  const expectedCountries = country.total + abstained;

  return {
    cases: scores.length,
    relevance: ratio(sum(scores, (s) => s.relevance)),
    eventType: ratio(sum(scores, (s) => s.eventType)),
    companyName: ratio(sum(scores, (s) => s.companyName)),
    roundType: ratio(sum(scores, (s) => s.roundType)),
    amount: ratio(sum(scores, (s) => s.amount)),
    country: ratio(country),
    countryCoverage:
      expectedCountries === 0 ? null : country.total / expectedCountries,
    leadF1: denominator === 0 ? null : (2 * truePositives) / denominator,
    leadSupport: support,
    extraEvents: extra,
    prefilterRecall: ratio(sum(scores, (s) => s.prefilterRecall)),
  };
}

/** Targets missed. A metric with no data is not a miss. */
export function missedTargets(metrics: EvalMetrics): MetricTarget[] {
  return TARGETS.filter((target) => {
    const value = metrics[target.key];
    return typeof value === "number" && value < target.target;
  });
}
