import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompanyEvent, FundingRoundEvent } from "@/core/read-models";
import { describeCompanyLocation } from "./company-location";
import {
  CompanyMomentum,
  describeRoundMomentum,
  describeRoundMomentumLong,
} from "./company-momentum";

function round(
  id: number,
  announcedOn: string,
  momentum: FundingRoundEvent["momentum"],
): CompanyEvent {
  return {
    id,
    type: "funding_round",
    announcedOn,
    datePrecision: "day",
    sources: [],
    roundType: "seed",
    roundLabel: null,
    amount: null,
    amountGbpMinor: null,
    amountUsdMinor: null,
    fxRate: null,
    fxRateDate: null,
    includesIndividualAngels: false,
    investors: [],
    momentum,
  } as unknown as CompanyEvent;
}

// The spec's example company (section 8.3), read on 2026-11-11.
const events: CompanyEvent[] = [
  round(1, "2025-03-10", {
    equityRoundNumber: 1,
    monthsSincePrevious: null,
    stepUpRatio: null,
    stepUpBasisOn: null,
  }),
  round(2, "2026-01-20", {
    equityRoundNumber: 2,
    monthsSincePrevious: 10,
    stepUpRatio: null,
    stepUpBasisOn: null,
  }),
  round(3, "2026-09-05", {
    equityRoundNumber: 3,
    monthsSincePrevious: 7,
    stepUpRatio: 5.3,
    stepUpBasisOn: "2025-03-10",
  }),
];

describe("CompanyMomentum", () => {
  it("summarises the spec example company", () => {
    render(<CompanyMomentum events={events} roundsInLast24Months={3} />);
    expect(
      screen.getByText(
        "3 rounds in the last 24 months; the latest was 5.3× the March 2025 round, 7 months after the previous one.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/History starts/)).toBeNull();
  });

  it("says history is short for a first recorded round", () => {
    render(
      <CompanyMomentum events={events.slice(0, 1)} roundsInLast24Months={1} />,
    );
    expect(
      screen.getByText("1 round in the last 24 months."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /First round we have recorded\. History starts in November 2026/,
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing without an equity round", () => {
    const { container } = render(<CompanyMomentum events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("round momentum text", () => {
  it("handles first, repeat, null step-up and non-equity rounds", () => {
    expect(
      describeRoundMomentum({
        equityRoundNumber: 1,
        monthsSincePrevious: null,
        stepUpRatio: null,
        stepUpBasisOn: null,
      }),
    ).toBe("First recorded round");
    expect(
      describeRoundMomentum({
        equityRoundNumber: 2,
        monthsSincePrevious: 1,
        stepUpRatio: null,
        stepUpBasisOn: null,
      }),
    ).toBe("Round 2 · 1 month after the last");
    expect(describeRoundMomentum(null)).toBeNull();
  });

  it("gives the long form for the timeline", () => {
    expect(
      describeRoundMomentumLong({
        equityRoundNumber: 3,
        monthsSincePrevious: 7,
        stepUpRatio: 5.3,
        stepUpBasisOn: "2025-03-10",
      }),
    ).toBe(
      "Equity round 3 we have recorded, 7 months after the previous one, 5.3× the March 2025 round.",
    );
  });
});

describe("describeCompanyLocation", () => {
  const none = { city: null, countryCode: null };
  it("formats town, region only, and postcode district", () => {
    expect(
      describeCompanyLocation(
        {
          precision: "town",
          ukRegion: "yorkshire-and-the-humber",
          placeName: "Leeds",
          outcode: null,
          countryCode: "GB",
        },
        none,
      ),
    ).toBe("Leeds, Yorkshire and The Humber");
    expect(
      describeCompanyLocation(
        {
          precision: "region",
          ukRegion: "scotland",
          placeName: null,
          outcode: null,
          countryCode: "GB",
        },
        none,
      ),
    ).toBe("Scotland");
    expect(
      describeCompanyLocation(
        {
          precision: "outcode",
          ukRegion: "north-west",
          placeName: null,
          outcode: "L35",
          countryCode: "GB",
        },
        none,
      ),
    ).toBe("Postcode district L35");
  });

  it("falls back to the news city", () => {
    expect(
      describeCompanyLocation(null, { city: "Paris", countryCode: "FR" }),
    ).toBe("Paris, France");
  });
});
