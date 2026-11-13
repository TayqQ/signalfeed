import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EVAL_CASES_SCHEMA,
  type EvalCase,
  type EvalExpectedEvent,
} from "@/core/eval-fixture";
import type { ExtractedEventV2, ExtractionV2 } from "@/core/extraction-schema";
import {
  aggregate,
  missedTargets,
  scoreCase,
  TARGETS,
  ukRegionOf,
} from "./score";

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
    city?: string | null;
    regionText?: string | null;
    roundType?: "seed" | "series_a";
    amountText?: string | null;
    investors?: Array<{ name: string; isLead: boolean }>;
  } = {},
): ExtractedEventV2 {
  return {
    type: "funding_round",
    company: {
      name: overrides.name ?? "Acme",
      websiteDomain: null,
      description: null,
      countryCode: overrides.countryCode ?? null,
      city: overrides.city ?? null,
      regionText: overrides.regionText ?? null,
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

function actual(events: ExtractedEventV2[]): ExtractionV2 {
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

  it("scores a stated city after normalising case, accents and spaces", () => {
    const expected = evalCase([expectedEvent({ city: "Malmö" })]);
    const right = scoreCase(
      expected,
      actual([actualEvent({ city: "  malmo " })]),
    );
    const wrong = scoreCase(expected, actual([actualEvent({ city: "Lund" })]));
    const abstained = scoreCase(expected, actual([actualEvent()]));
    const metrics = aggregate([right, wrong, abstained]);
    expect(metrics.city).toBeCloseTo(0.5);
    expect(metrics.cityCoverage).toBeCloseTo(2 / 3);
  });

  it("does not score a city the fixture text does not state", () => {
    for (const city of [undefined, null]) {
      const score = scoreCase(
        evalCase([expectedEvent({ city })]),
        actual([actualEvent({ city: "Leeds" })]),
      );
      expect(score.city).toEqual({ hits: 0, total: 0 });
      expect(score.cityAbstained).toBe(0);
    }
    expect(aggregate([]).cityCoverage).toBeNull();
  });

  it("counts every returned event with a city, matched or not", () => {
    const score = scoreCase(
      evalCase([expectedEvent()]),
      actual([
        actualEvent({ city: "Leeds" }),
        actualEvent({ name: "Other", city: " " }),
      ]),
    );
    expect(score.returnedEvents).toBe(2);
    expect(score.returnedEventsWithCity).toBe(1);
  });

  it("compares UK regions as ITL1 regions", () => {
    const expected = evalCase([expectedEvent({ regionText: "Scottish" })]);
    const sameRegion = scoreCase(
      expected,
      actual([actualEvent({ regionText: "Scotland" })]),
    );
    const otherRegion = scoreCase(
      expected,
      actual([actualEvent({ regionText: "Wales" })]),
    );
    const unknownWord = scoreCase(
      expected,
      actual([actualEvent({ regionText: "Caledonia" })]),
    );
    const abstained = scoreCase(expected, actual([actualEvent()]));
    const metrics = aggregate([
      sameRegion,
      otherRegion,
      unknownWord,
      abstained,
    ]);
    expect(metrics.ukRegion).toBeCloseTo(1 / 3);
    expect(metrics.ukRegionCoverage).toBeCloseTo(3 / 4);
  });

  it("scores null for the region of an upgraded V1 result", () => {
    const score = scoreCase(
      evalCase([expectedEvent({ regionText: "Yorkshire" })]),
      actual([actualEvent()]),
    );
    expect(score.ukRegion).toEqual({ hits: 0, total: 0 });
    expect(score.ukRegionAbstained).toBe(1);
    expect(aggregate([score]).ukRegion).toBeNull();
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

describe("ukRegionOf", () => {
  it("maps nation and county words to ITL1 slugs", () => {
    expect(ukRegionOf("Scottish")).toBe("scotland");
    expect(ukRegionOf(" WALES ")).toBe("wales");
    expect(ukRegionOf("Yorkshire")).toBe("yorkshire-and-the-humber");
    expect(ukRegionOf("Northern  Irish")).toBe("northern-ireland");
    expect(ukRegionOf("Cornwall")).toBe("south-west");
    expect(ukRegionOf("the Midlands")).toBeNull();
    expect(ukRegionOf("Bavaria")).toBeNull();
  });

  it("knows every region word in the fixtures", () => {
    const cases: EvalCase[] = EVAL_CASES_SCHEMA.parse(
      JSON.parse(readFileSync("fixtures/extraction/cases.json", "utf8")),
    );
    const words = cases.flatMap((c) =>
      c.expected.events.flatMap((e) => (e.regionText ? [e.regionText] : [])),
    );
    expect(words.length).toBeGreaterThanOrEqual(4);
    for (const word of words) expect(ukRegionOf(word)).not.toBeNull();
  });
});

describe("TARGETS", () => {
  it("adds city and UK region at 90%", () => {
    expect(TARGETS.find((t) => t.key === "city")?.target).toBe(0.9);
    expect(TARGETS.find((t) => t.key === "ukRegion")?.target).toBe(0.9);
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
