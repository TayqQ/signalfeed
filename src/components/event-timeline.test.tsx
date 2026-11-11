import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  AcquisitionEvent,
  FundingRoundEvent,
  LaunchEvent,
} from "@/core/read-models";
import { EventTimeline } from "./event-timeline";

const base = {
  datePrecision: "day" as const,
  evidence: "reported" as const,
  sourceCount: 1,
};

const funding: FundingRoundEvent = {
  ...base,
  id: 1,
  type: "funding_round",
  announcedOn: "2026-03-01",
  roundType: "seed",
  roundLabel: null,
  amount: { amountMinor: 400_000_000, currency: "GBP" },
  amountUsdMinor: 500_000_000,
  amountGbpMinor: 400_000_000,
  fxRateDate: "2026-03-01",
  includesIndividualAngels: false,
  investors: [
    { slug: "beta", name: "Beta", role: "participant" },
    { slug: "alpha", name: "Alpha", role: "lead" },
  ],
  sourceCount: 2,
  sources: [
    {
      title: "Acme raises £4M",
      url: "https://a.test/1",
      sourceName: "Tech.eu",
      publishedAt: "2026-03-01T10:00:00.000Z",
    },
    {
      title: "Acme lands seed",
      url: "https://b.test/2",
      sourceName: "UKTN",
      publishedAt: null,
    },
  ],
};

const acquisition: AcquisitionEvent = {
  ...base,
  id: 2,
  type: "acquisition",
  announcedOn: "2026-08-01",
  acquirer: { slug: "bigcorp", name: "Bigcorp" },
  acquirerName: "Bigcorp Inc",
  price: null,
  priceUsdMinor: null,
  priceGbpMinor: null,
  fxRateDate: null,
  sources: [],
};

const launch: LaunchEvent = {
  ...base,
  id: 3,
  type: "launch",
  announcedOn: "2026-05-01",
  kind: "product",
  productName: "Thing",
  url: "https://acme.test/thing",
  externalRef: null,
  sources: [],
};

describe("EventTimeline", () => {
  it("shows the company's age at each event when the founded year is known", () => {
    render(<EventTimeline events={[launch]} foundedYear={2023} />);
    expect(screen.getByText(/company age 3 years/)).toBeInTheDocument();
  });

  it("leaves the age out when the founded year is unknown", () => {
    render(<EventTimeline events={[launch]} />);
    expect(screen.queryByText(/company age/)).not.toBeInTheDocument();
  });

  it("marks the lead and lists it first, with every source linked", () => {
    render(<EventTimeline events={[funding]} />);
    expect(screen.getByText("(lead)")).toBeInTheDocument();
    const investors = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/investors/"));
    expect(investors[0]).toHaveTextContent("Alpha");

    const source = screen.getByRole("link", { name: "Acme raises £4M" });
    expect(source).toHaveAttribute("href", "https://a.test/1");
    expect(source).toHaveAttribute("rel", "noopener");
    expect(
      screen.getByRole("link", { name: "Acme lands seed" }),
    ).toBeInTheDocument();
  });

  it("links a resolved acquirer", () => {
    render(<EventTimeline events={[acquisition]} />);
    expect(screen.getByRole("link", { name: "Bigcorp" })).toHaveAttribute(
      "href",
      "/companies/bigcorp",
    );
    expect(screen.getByText("Price not reported")).toBeInTheDocument();
  });

  it("links a launch to its product", () => {
    render(<EventTimeline events={[launch]} />);
    expect(screen.getByRole("link", { name: "Thing" })).toHaveAttribute(
      "href",
      "https://acme.test/thing",
    );
  });

  it("orders events newest first", () => {
    render(<EventTimeline events={[funding, launch, acquisition]} />);
    const items = screen.getAllByRole("listitem");
    const dates = items
      .map((item) => item.textContent ?? "")
      .filter((text) => /2026/.test(text))
      .map((text) => /(\d+ \w{3} 2026)/.exec(text)?.[1]);
    expect(dates[0]).toBe("1 Aug 2026");
    expect(dates.at(-1)).toContain("2026");
  });

  it("marks an approximate date", () => {
    render(<EventTimeline events={[{ ...launch, datePrecision: "month" }]} />);
    expect(screen.getByText("Around May 2026")).toBeInTheDocument();
  });
});

describe("EventTimeline momentum and grants", () => {
  it("shows momentum facts for an equity round", () => {
    render(
      <EventTimeline
        events={[
          {
            ...funding,
            momentum: {
              equityRoundNumber: 3,
              monthsSincePrevious: 7,
              stepUpRatio: 5.3,
              stepUpBasisOn: "2025-03-10",
            },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "Equity round 3 we have recorded, 7 months after the previous one, 5.3× the March 2025 round.",
      ),
    ).toBeInTheDocument();
  });

  it("says history starts in November 2026 for a first round", () => {
    render(
      <EventTimeline
        events={[
          {
            ...funding,
            momentum: {
              equityRoundNumber: 1,
              monthsSincePrevious: null,
              stepUpRatio: null,
              stepUpBasisOn: null,
            },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "First round we have recorded. History starts in November 2026.",
      ),
    ).toBeInTheDocument();
  });

  it("credits UKRI on a grant and shows no momentum", () => {
    render(
      <EventTimeline
        events={[{ ...funding, roundType: "grant", momentum: null }]}
      />,
    );
    expect(
      screen.getByText("Source: UKRI Gateway to Research"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/we have recorded/)).toBeNull();
  });
});
