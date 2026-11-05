import { describe, expect, it } from "vitest";
import type { EvalCase, EvalExpectedEvent } from "@/core/eval-fixture";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import { aggregate, missedTargets, scoreCase } from "./score";

function expectedEvent(
  overrides: Partial<EvalExpectedEvent> = {},
): EvalExpectedEvent {
  return {
    type: "funding_round",
    companyName: "Acme",
    countryCode: null,
    roundType: "seed",
    amountText: "$4M",
    leadInvestors: [],
    investors: [],
    acquirerName: null,
    ...overrides,
  };
}

function evalCase(events: EvalExpectedEvent[], isRelevant = true): EvalCase {
  return {
    id: "case",
    sourceSlug: "tech-eu",
    url: "https://example.com/a",
    headline: "Acme raises $4M seed",
    summary: "Acme raised money.",
    publishedAt: "2026-10-08T12:00:00+00:00",
    expected: { isRelevant, events },
  };
}

function actualEvent(
  overrides: {
    name?: string;
    countryCode?: string | null;
    roundType?: "seed" | "series_a";
    amountText?: string | null;
    investors?: Array<{ name: string; isLead: boolean }>;
  } = {},
): ExtractedEventV1 {
  return {
    type: "funding_round",
    company: {
      name: overrides.name ?? "Acme",
      websiteDomain: null,
      description: null,
      countryCode: overrides.countryCode ?? null,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding: {
      roundType: overrides.roundType ?? "seed",
      roundLabel: null,
      amountText:
        overrides.amountText === undefined
          ? "$4 million"
          : overrides.amountText,
      currencyHint: null,
      investors: (overrides.investors ?? []).map((investor) => ({
        ...investor,
        kind: "vc",
      })),
      includesIndividualAngels: false,
    },
    acquisition: null,
    launch: null,
  };
}

function actual(events: ExtractedEventV1[]): ExtractionV1 {
  return { isRelevant: events.length > 0, events };
}

describe("scoreCase", () => {
  it("scores a correct funding event and compares amounts by value", () => {
    const score = scoreCase(
      evalCase([expectedEvent()]),
      actual([actualEvent()]),
    );
    expect(score.relevance).toEqual({ hits: 1, total: 1 });
    expect(score.companyName).toEqual({ hits: 1, total: 1 });
    expect(score.eventType).toEqual({ hits: 1, total: 1 });
    expect(score.roundType).toEqual({ hits: 1, total: 1 });
    expect(score.amount).toEqual({ hits: 1, total: 1 });
  });

  it("marks a wrong amount, round type and company name as misses", () => {
    const wrongAmount = scoreCase(
      evalCase([expectedEvent()]),
      actual([
        actualEvent({ amountText: "€4 million", roundType: "series_a" }),
      ]),
    );
    expect(wrongAmount.amount.hits).toBe(0);
    expect(wrongAmount.roundType.hits).toBe(0);

    const wrongName = scoreCase(
      evalCase([expectedEvent()]),
      actual([actualEvent({ name: "Other" })]),
    );
    expect(wrongName.companyName).toEqual({ hits: 0, total: 1 });
    expect(wrongName.extraEvents).toBe(1);
  });

  it("scores lead investors over normalised names", () => {
    const score = scoreCase(
      evalCase([
        expectedEvent({ leadInvestors: ["Example Ventures", "Beta"] }),
      ]),
      actual([
        actualEvent({
          investors: [
            { name: "EXAMPLE VENTURES", isLead: true },
            { name: "Gamma", isLead: true },
            { name: "Beta", isLead: false },
          ],
        }),
      ]),
    );
    expect(score.leadTruePositives).toBe(1);
    expect(score.leadFalsePositives).toBe(1);
    expect(score.leadFalseNegatives).toBe(1);
    expect(aggregate([score]).leadF1).toBeCloseTo(0.5);
    expect(aggregate([score]).leadSupport).toBe(2);
  });

  it("does not punish a model for declining to guess a country", () => {
    const stated = scoreCase(
      evalCase([expectedEvent({ countryCode: "GB" })]),
      actual([actualEvent({ countryCode: "gb" })]),
    );
    const wrong = scoreCase(
      evalCase([expectedEvent({ countryCode: "GB" })]),
      actual([actualEvent({ countryCode: "US" })]),
    );
    const abstained = scoreCase(
      evalCase([expectedEvent({ countryCode: "GB" })]),
      actual([actualEvent({ countryCode: null })]),
    );
    const metrics = aggregate([stated, wrong, abstained]);
    expect(metrics.country).toBeCloseTo(0.5);
    expect(metrics.countryCoverage).toBeCloseTo(2 / 3);
  });

  it("pairs events by company in a roundup with two events", () => {
    const score = scoreCase(
      evalCase([
        expectedEvent({ companyName: "Fonoa", amountText: "$110 million" }),
        expectedEvent({ companyName: "Manna", amountText: "$50 million" }),
      ]),
      actual([
        actualEvent({ name: "Manna", amountText: "$50M" }),
        actualEvent({ name: "Fonoa", amountText: "$110M" }),
      ]),
    );
    expect(score.companyName).toEqual({ hits: 2, total: 2 });
    expect(score.amount).toEqual({ hits: 2, total: 2 });
    expect(score.extraEvents).toBe(0);
  });

  it("counts a failed call as a miss", () => {
    const score = scoreCase(evalCase([expectedEvent()]), null);
    expect(score.relevance.hits).toBe(0);
    expect(score.companyName).toEqual({ hits: 0, total: 1 });
  });

  it("measures prefilter recall on relevant cases only", () => {
    const relevant = scoreCase(evalCase([expectedEvent()]), actual([]));
    const irrelevant = scoreCase(evalCase([], false), actual([]));
    expect(relevant.prefilterRecall).toEqual({ hits: 1, total: 1 });
    expect(irrelevant.prefilterRecall).toEqual({ hits: 0, total: 0 });
  });
});

describe("missedTargets", () => {
  it("lists a metric under its target and ignores empty metrics", () => {
    const missed = scoreCase(
      evalCase([expectedEvent()]),
      actual([actualEvent({ amountText: "€4 million" })]),
    );
    const metrics = aggregate([missed]);
    expect(metrics.country).toBeNull();
    expect(missedTargets(metrics).map((target) => target.key)).toEqual([
      "amount",
    ]);
  });
});
