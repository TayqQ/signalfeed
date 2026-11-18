import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompaniesHouseView,
  CompanyEvent,
  FundingRoundEvent,
} from "@/core/read-models";
import { ActionRow } from "./action-row";
import { companyInvestors, CompanyInvestors } from "./company-investors";
import { CompanyHeader } from "./company-header";
import { KeyFacts, keyFacts } from "./key-facts";
import { LatestRound } from "./latest-round";
import { OfficialRecords, registryStatusFact } from "./official-records";
import { companySignals, CompanySignals } from "./signals";
import { SimilarCompanies } from "./similar-companies";
import { companySources } from "@/components/source-list";

const NOW = new Date("2026-11-18T12:00:00Z");

function round(overrides: Partial<FundingRoundEvent> = {}): FundingRoundEvent {
  return {
    id: 1,
    type: "funding_round",
    announcedOn: "2026-11-10",
    datePrecision: "day",
    evidence: "reported",
    sourceCount: 1,
    sources: [],
    confirmations: [],
    roundType: "seed",
    roundLabel: null,
    amount: { amountMinor: 420_000_000, currency: "GBP" },
    amountUsdMinor: null,
    amountGbpMinor: 420_000_000,
    fxRateDate: null,
    includesIndividualAngels: false,
    investors: [],
    momentum: {
      equityRoundNumber: 1,
      monthsSincePrevious: null,
      stepUpRatio: null,
      stepUpBasisOn: null,
    },
    ...overrides,
  };
}

const SH01 =
  "Confirmed: shares allotted on 2 November 2026 (Companies House SH01)";

const ch: CompaniesHouseView = {
  companyNumber: "12345678",
  url: "https://find-and-update.company-information.service.gov.uk/company/12345678",
  name: "ACME LTD",
  statusLabel: "Active",
  typeLabel: "Private limited company",
  incorporatedOn: "2021-04-12",
  ceasedOn: null,
  sicCodes: [
    { code: "62012", label: "Business and domestic software development" },
    { code: "99999", label: null },
  ],
  sizeBand: "small",
  accountsMadeUpTo: "2025-03-31",
  officeOutcode: "LS1",
};

function texts(events: CompanyEvent[]): string[] {
  return companySignals(events, NOW).map((signal) => signal.text);
}

describe("companySignals", () => {
  it("gives nothing without a funding round", () => {
    expect(texts([])).toEqual([]);
  });

  it("words a confirmed, recent, first, well-sourced round", () => {
    const signals = companySignals(
      [
        round({
          sourceCount: 3,
          confirmations: [
            {
              kind: "ch_allotment",
              recordDate: "2026-11-02",
              confirmsAmount: true,
              text: SH01,
            },
          ],
        }),
      ],
      NOW,
    );
    expect(signals).toEqual([
      {
        id: "confirmed",
        text: "Confirmed by a Companies House filing",
        detail: "Shares allotted on 2 November 2026 (Companies House SH01)",
      },
      {
        id: "recent",
        text: "Raised in the last 30 days",
        detail: "8 days ago",
      },
      {
        id: "first",
        text: "First round we have recorded",
        detail: "History starts in November 2026",
      },
      { id: "sources", text: "Reported by 3 sources", detail: null },
    ]);
  });

  it("names the record that confirms the round", () => {
    const form = round({
      confirmations: [
        {
          kind: "sec_form_d",
          recordDate: "2026-11-01",
          confirmsAmount: false,
          text: "Confirmed: Form D first sale on 1 November 2026 (SEC)",
        },
      ],
    });
    expect(texts([form])[0]).toBe("Confirmed by an SEC Form D filing");
    const grant = round({ roundType: "grant", evidence: "confirmed" });
    expect(texts([grant])[0]).toBe("Confirmed by a UKRI grant record");
  });

  it("only counts an exact date within 30 days as recent", () => {
    expect(texts([round({ announcedOn: "2026-10-19" })])).toContain(
      "Raised in the last 30 days",
    );
    expect(texts([round({ announcedOn: "2026-10-18" })])).not.toContain(
      "Raised in the last 30 days",
    );
    expect(
      texts([round({ announcedOn: "2026-11-01", datePrecision: "month" })]),
    ).not.toContain("Raised in the last 30 days");
  });

  it("says raised again within 24 months for a quick repeat round", () => {
    const events = [
      round({
        id: 2,
        announcedOn: "2026-06-01",
        roundType: "series_a",
        momentum: {
          equityRoundNumber: 2,
          monthsSincePrevious: 14,
          stepUpRatio: null,
          stepUpBasisOn: null,
        },
      }),
      round({ id: 1, announcedOn: "2025-04-01" }),
    ];
    const signals = companySignals(events, NOW);
    expect(signals.map((s) => s.text)).toEqual([
      "Raised again within 24 months",
    ]);
    expect(signals[0]?.detail).toBe("14 months after the previous round");
  });

  it("leaves out a slow repeat, a single source and a gap it cannot measure", () => {
    const slow = round({
      announcedOn: "2026-06-01",
      momentum: {
        equityRoundNumber: 2,
        monthsSincePrevious: 30,
        stepUpRatio: null,
        stepUpBasisOn: null,
      },
    });
    const unknownGap = round({
      announcedOn: "2026-06-01",
      momentum: {
        equityRoundNumber: 3,
        monthsSincePrevious: null,
        stepUpRatio: null,
        stepUpBasisOn: null,
      },
    });
    const older = round({ id: 0, announcedOn: "2024-01-01" });
    expect(texts([slow, older])).toEqual([]);
    expect(texts([unknownGap, older])).toEqual([]);
  });

  it("renders an honest note when there is nothing to say", () => {
    render(<CompanySignals events={[]} now={NOW} headingId="s" />);
    expect(screen.getByRole("heading", { name: "Signals" })).toBeVisible();
    expect(screen.getByText(/No signals yet/)).toBeInTheDocument();
  });
});

describe("ActionRow", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows Companies House and Copy company number for a linked record", () => {
    render(
      <ActionRow
        companyName="Acme"
        websiteDomain="acme.test"
        companiesHouse={{ companyNumber: "12345678", url: ch.url }}
      />,
    );
    expect(screen.getByRole("link", { name: /Visit website/ })).toHaveAttribute(
      "href",
      "https://acme.test",
    );
    expect(
      screen.getByRole("link", { name: /Companies House/ }),
    ).toHaveAttribute("href", ch.url);
    expect(
      screen.getByRole("button", { name: "Copy company number" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.queryByText("Website not found yet")).toBeNull();
  });

  it("without a registry link or website: no Companies House, an inactive website button with a note", () => {
    render(
      <ActionRow
        companyName="Acme"
        websiteDomain={null}
        companiesHouse={null}
      />,
    );
    expect(screen.queryByRole("link", { name: /Companies House/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Copy company number/ }),
    ).toBeNull();
    const website = screen.getByRole("button", { name: "Visit website" });
    expect(website).toHaveAttribute("aria-disabled", "true");
    expect(website).not.toBeDisabled();
    expect(website).toHaveAccessibleDescription("Website not found yet");
  });

  it("copies the company number and confirms it", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <ActionRow
        companyName="Acme"
        websiteDomain={null}
        companiesHouse={{ companyNumber: "12345678", url: ch.url }}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy company number" }),
      );
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("12345678");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText("Company number 12345678 copied")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("button", { name: "Copy company number" }),
    ).toBeInTheDocument();
  });

  it("shares with the system sheet when there is one, else copies the link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      share,
      clipboard: { writeText },
    });
    const { unmount } = render(
      <ActionRow
        companyName="Acme"
        websiteDomain={null}
        companiesHouse={null}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await Promise.resolve();
    });
    expect(share).toHaveBeenCalledWith({
      title: "Acme",
      url: window.location.href,
    });
    expect(writeText).not.toHaveBeenCalled();
    unmount();

    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText },
    });
    render(
      <ActionRow
        companyName="Acme"
        websiteDomain={null}
        companiesHouse={null}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(
      screen.getByRole("button", { name: "Link copied" }),
    ).toBeInTheDocument();
  });
});

describe("keyFacts", () => {
  it("says Not known for every missing fact", () => {
    const facts = keyFacts({
      events: [],
      foundedYear: null,
      companiesHouse: null,
      now: NOW,
    });
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ["Stage", null],
      ["Total raised", null],
      ["Last round", null],
      ["Founded", null],
      ["Company size", null],
      ["Investors", null],
    ]);
    render(<KeyFacts facts={facts} />);
    expect(screen.getAllByText("Not known")).toHaveLength(6);
  });

  it("fills the facts from the rounds and the registry", () => {
    const events = [
      round({
        id: 2,
        announcedOn: "2026-09-05",
        roundType: "series_a",
        amountGbpMinor: 800_000_000,
        amount: { amountMinor: 800_000_000, currency: "GBP" },
        investors: [
          { slug: "a", name: "Alpha", role: "lead" },
          { slug: "b", name: "Beta", role: "participant" },
        ],
      }),
      round({
        id: 1,
        announcedOn: "2025-03-10",
        amountGbpMinor: null,
        amount: null,
        investors: [{ slug: "b", name: "Beta", role: "participant" }],
      }),
    ];
    const facts = keyFacts({
      events,
      foundedYear: 2021,
      companiesHouse: ch,
      now: NOW,
    });
    expect(facts).toEqual([
      { label: "Stage", value: "Series A", sub: null },
      { label: "Total raised", value: "£8.0m", sub: "2 rounds, 1 undisclosed" },
      { label: "Last round", value: "£8.0m", sub: "5 Sep 2026", quiet: false },
      { label: "Founded", value: "2021", sub: "5 years old" },
      {
        label: "Company size",
        value: "Small",
        sub: "Accounts to 31 Mar 2025",
        subWide: true,
      },
      { label: "Investors", value: "2", sub: "1 lead" },
    ]);
  });

  it("falls back to the incorporation year and says Undisclosed for a round with no amount", () => {
    const facts = keyFacts({
      events: [
        round({ roundType: "unknown", amount: null, amountGbpMinor: null }),
      ],
      foundedYear: null,
      companiesHouse: { ...ch, sizeBand: "full_accounts" },
      now: NOW,
    });
    const byLabel = new Map(facts.map((f) => [f.label, f]));
    expect(byLabel.get("Stage")?.value).toBeNull();
    expect(byLabel.get("Total raised")?.value).toBeNull();
    expect(byLabel.get("Last round")).toMatchObject({
      value: "Undisclosed",
      quiet: true,
    });
    expect(byLabel.get("Founded")).toMatchObject({
      value: "2021",
      sub: "Incorporated",
    });
    expect(byLabel.get("Company size")).toMatchObject({
      value: "Not stated",
      sub: "Files full accounts",
    });
  });
});

describe("LatestRound", () => {
  it("shows the proof box for a confirmed round", () => {
    render(
      <LatestRound
        companyName="Acme"
        round={round({
          investors: [{ slug: "a", name: "Alpha", role: "lead" }],
          confirmations: [
            {
              kind: "ch_allotment",
              recordDate: "2026-11-02",
              confirmsAmount: true,
              text: SH01,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("£4.2m")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/investors/a",
    );
    expect(screen.getByRole("note", { name: SH01 })).toBeInTheDocument();
    expect(
      screen.getByText(/The filed amount agrees with the reports\./),
    ).toBeInTheDocument();
  });

  it("says news only and names no lead when there is none", () => {
    render(
      <LatestRound companyName="Acme" round={round({ sourceCount: 2 })} />,
    );
    expect(screen.getByText("Not named in reports yet")).toBeInTheDocument();
    expect(
      screen.getByText("From news reports only · 2 sources"),
    ).toBeInTheDocument();
  });

  it("says so when no round is recorded", () => {
    render(<LatestRound companyName="Acme" round={null} />);
    expect(
      screen.getByText("No funding round recorded yet"),
    ).toBeInTheDocument();
  });
});

describe("CompanyHeader", () => {
  it("shows Sector pending and the place, with theme links", () => {
    render(
      <CompanyHeader
        name="Acme Robotics"
        description="Robots for warehouses"
        countryCode="GB"
        place="Leeds, Yorkshire and The Humber"
        mainSector={null}
        statuses={["Acquired"]}
        themes={[{ slug: "robotics", name: "Robotics", sector: null }]}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Robotics" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
    expect(screen.getByText("GB")).toBeInTheDocument();
    expect(screen.getByText("Acquired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Robotics" })).toHaveAttribute(
      "href",
      "/themes/robotics",
    );
  });

  it("links a known sector to the filtered list", () => {
    render(
      <CompanyHeader
        name="Acme"
        description={null}
        countryCode={null}
        place={null}
        mainSector="climate-energy"
        statuses={[]}
        themes={[]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Climate and energy" }),
    ).toHaveAttribute("href", "/?sector=climate-energy");
    expect(screen.getByText("Place not known")).toBeInTheDocument();
  });
});

describe("OfficialRecords", () => {
  it("renders every Companies House field", () => {
    render(
      <OfficialRecords
        registry={{ companiesHouse: ch, sec: null }}
        companyName="Acme"
        countryCode="GB"
        headingId="r"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "From official records" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "12345678" })).toHaveAttribute(
      "href",
      ch.url,
    );
    expect(screen.getByText("Private limited company")).toBeInTheDocument();
    expect(screen.getByText("12 Apr 2021")).toBeInTheDocument();
    expect(
      screen.getByText("Small (accounts made up to 31 Mar 2025)"),
    ).toBeInTheDocument();
    expect(screen.getByText("LS1")).toBeInTheDocument();
    expect(screen.getByText("Source: Companies House")).toBeInTheDocument();
    expect(screen.queryByText("No Companies House match yet")).toBeNull();
  });

  it("says there is no Companies House match yet", () => {
    render(
      <OfficialRecords
        registry={null}
        companyName="Acme"
        countryCode="GB"
        headingId="r"
      />,
    );
    expect(
      screen.getByText("No Companies House match yet"),
    ).toBeInTheDocument();
  });

  it("shows only the SEC record for a non-UK filer", () => {
    render(
      <OfficialRecords
        registry={{
          companiesHouse: null,
          sec: { cik: "1234567", url: "https://www.sec.gov/x?CIK=1234567" },
        }}
        companyName="Acme"
        countryCode="US"
        headingId="r"
      />,
    );
    expect(screen.getByRole("link", { name: "1234567" })).toBeInTheDocument();
    expect(screen.queryByText("No Companies House match yet")).toBeNull();
  });
});

describe("registryStatusFact", () => {
  it("is null for active and missing records", () => {
    expect(registryStatusFact(null)).toBeNull();
    expect(registryStatusFact({ companiesHouse: ch, sec: null })).toBeNull();
  });

  it("gives the dissolved date, or a non-active status as given", () => {
    expect(
      registryStatusFact({
        companiesHouse: {
          ...ch,
          statusLabel: "Dissolved",
          ceasedOn: "2026-05-03",
        },
        sec: null,
      }),
    ).toBe("Dissolved on 3 May 2026");
    expect(
      registryStatusFact({
        companiesHouse: { ...ch, statusLabel: "In Administration" },
        sec: null,
      }),
    ).toBe("In Administration");
  });
});

describe("investors and sources", () => {
  it("lists each investor once, leads first, with their rounds", () => {
    const events = [
      round({
        id: 2,
        announcedOn: "2026-09-01",
        roundType: "series_a",
        investors: [
          { slug: "b", name: "Beta", role: "lead" },
          { slug: "a", name: "Alpha", role: "participant" },
        ],
      }),
      round({
        id: 1,
        announcedOn: "2025-01-01",
        investors: [{ slug: "a", name: "Alpha", role: "participant" }],
      }),
    ];
    expect(companyInvestors(events)).toEqual([
      { slug: "b", name: "Beta", lead: true, rounds: ["Series A"] },
      { slug: "a", name: "Alpha", lead: false, rounds: ["Series A", "Seed"] },
    ]);
    render(<CompanyInvestors events={events} />);
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Participant")).toBeInTheDocument();
  });

  it("collects each source once, newest first", () => {
    const a = {
      title: "A",
      url: "https://a.test",
      sourceName: "Tech.eu",
      publishedAt: "2026-01-01T00:00:00.000Z",
    };
    const b = {
      ...a,
      title: "B",
      url: "https://b.test",
      publishedAt: "2026-02-01T00:00:00.000Z",
    };
    const events = [
      round({ id: 2, sources: [a, b] }),
      round({ id: 1, sources: [a] }),
    ];
    expect(companySources(events).map((s) => s.title)).toEqual(["B", "A"]);
  });
});

describe("SimilarCompanies", () => {
  it("links up to five companies", () => {
    render(
      <SimilarCompanies
        now={NOW}
        similar={{
          mainSector: "financial-services",
          roundType: "seed",
          items: [
            {
              slug: "beta-pay",
              name: "Beta Pay",
              countryCode: "GB",
              city: "Leeds",
              roundType: "seed",
              roundLabel: null,
              amount: { amountMinor: 150_000_000, currency: "GBP" },
              amountGbpMinor: 150_000_000,
              announcedOn: "2026-11-16",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /Beta Pay/ })).toHaveAttribute(
      "href",
      "/companies/beta-pay",
    );
    expect(screen.getByText("£1.5m")).toBeInTheDocument();
    expect(
      screen.getByText(/Same sector, Financial services/),
    ).toBeInTheDocument();
  });

  it("is honest when the sector is pending or nothing matches", () => {
    const { rerender } = render(
      <SimilarCompanies
        similar={{ mainSector: null, roundType: null, items: [] }}
      />,
    );
    expect(screen.getByText(/Sector pending/)).toBeInTheDocument();
    rerender(
      <SimilarCompanies
        similar={{ mainSector: "education", roundType: "seed", items: [] }}
      />,
    );
    expect(
      screen.getByText(
        "No other Education companies with a recorded round yet.",
      ),
    ).toBeInTheDocument();
  });
});
