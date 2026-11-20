import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryState } from "@/lib/view-preference";
import type {
  FundingFilters,
  FundingRow,
  FundingSummary as FundingSummaryData,
} from "@/core/read-models";
import {
  FundingSummary,
  describeChange,
  sectorBars,
  summaryWindow,
} from "./funding-summary";
import { QUICK_VIEWS, QuickViews, activeQuickView } from "./quick-views";
import { sectorBarItems } from "./sector-bars";
import {
  ShowSummaryButton,
  SummaryFrame,
  SummaryProvider,
} from "./summary-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

const TODAY = "2026-11-18";

function filters(overrides: Partial<FundingFilters> = {}): FundingFilters {
  return { page: 1, pageSize: 25, ...overrides };
}

function round(name: string, gbp: number): FundingRow {
  return {
    eventId: gbp,
    companySlug: name.toLowerCase().replace(/\s+/g, "-"),
    companyName: name,
    countryCode: "GB",
    city: "London",
    companyDescription: null,
    mainSector: "financial-services",
    websiteDomain: null,
    roundType: "series_b",
    roundLabel: null,
    amount: { amountMinor: gbp, currency: "GBP" },
    amountGbpMinor: gbp,
    amountUsdMinor: null,
    announcedOn: "2026-11-01",
    leadInvestors: [],
    investorCount: 0,
    sourceCount: 1,
    tags: [],
  };
}

function summary(
  overrides: Partial<FundingSummaryData> = {},
): FundingSummaryData {
  return {
    totalGbpMinor: 4_200_000_000,
    count: 12,
    medianGbpMinor: 150_000_000,
    previous: {
      totalGbpMinor: 3_000_000_000,
      count: 15,
      medianGbpMinor: 150_000_000,
    },
    sectors: [
      { sector: "financial-services", gbpMinor: 3_000_000_000, count: 4 },
      { sector: "health-life-sciences", gbpMinor: 1_200_000_000, count: 6 },
      { sector: null, gbpMinor: 0, count: 2 },
    ],
    biggest: [
      round("Ledger Bank", 2_000_000_000),
      round("Pay Kit", 600_000_000),
      round("Coin Co", 400_000_000),
    ],
    ...overrides,
  };
}

describe("summaryWindow", () => {
  it("covers every round without a date filter, with nothing to compare", () => {
    expect(summaryWindow({}, TODAY)).toEqual({
      label: "All rounds we hold",
      previous: null,
    });
  });

  it("names a preset and compares with the window before", () => {
    expect(summaryWindow({ from: "2026-10-19" }, TODAY)).toEqual({
      label: "Last 30 days, 19 Oct to 18 Nov 2026",
      previous: {
        from: "2026-09-18",
        to: "2026-10-18",
        label: "18 Sep to 18 Oct 2026",
      },
    });
  });

  it("uses both dates of a custom range", () => {
    const window = summaryWindow(
      { from: "2025-12-01", to: "2026-01-31" },
      TODAY,
    );
    expect(window.label).toBe("1 Dec 2025 to 31 Jan 2026");
    expect(window.previous?.from).toBe("2025-09-30");
  });

  it("makes no comparison for an end date alone", () => {
    expect(summaryWindow({ to: "2026-06-30" }, TODAY)).toEqual({
      label: "Up to 30 Jun 2026",
      previous: null,
    });
  });
});

describe("describeChange", () => {
  it("says the change in words", () => {
    expect(describeChange(4_200, 3_000)).toEqual({
      direction: "up",
      text: "Up 40%",
    });
    expect(describeChange(12, 15)).toEqual({
      direction: "down",
      text: "Down 20%",
    });
    expect(describeChange(5, 5).text).toBe("Level");
    expect(describeChange(5, 0).text).toBe("Up from none");
    expect(describeChange(null, 5).text).toBe("Nothing to compare");
    expect(describeChange(1001, 1000).text).toBe("Up less than 1%");
  });
});

describe("FundingSummary", () => {
  const dated = filters({ from: "2026-10-19" });

  it("shows the headline against the previous window", () => {
    render(
      <FundingSummary summary={summary()} filters={dated} today={TODAY} />,
    );
    expect(
      screen.getByRole("heading", { name: "What's happening" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Last 30 days, 19 Oct to 18 Nov 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("£42.0m")).toBeInTheDocument();
    expect(screen.getByText("Up 40%")).toBeInTheDocument();
    expect(screen.getByText("Down 20%")).toBeInTheDocument();
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(screen.getByText(/Changes compare with 18 Sep/)).toBeInTheDocument();
  });

  it("covers all rounds with no comparison when there is no date filter", () => {
    render(
      <FundingSummary
        summary={summary({ previous: null })}
        filters={filters()}
        today={TODAY}
      />,
    );
    expect(screen.getByText("All rounds we hold")).toBeInTheDocument();
    expect(screen.queryByText(/Changes compare/)).toBeNull();
    expect(screen.queryByText(/^Up |^Down /)).toBeNull();
  });

  it("says so for an empty window", () => {
    render(
      <FundingSummary
        summary={summary({
          totalGbpMinor: 0,
          count: 0,
          medianGbpMinor: null,
          previous: { totalGbpMinor: 9, count: 3, medianGbpMinor: 3 },
          sectors: [],
          biggest: [],
        })}
        filters={dated}
        today={TODAY}
      />,
    );
    expect(screen.getByText("No rounds in this window")).toBeInTheDocument();
    expect(
      screen.getByText(
        /3 rounds in the window before \(18 Sep to 18 Oct 2026\)/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Biggest rounds")).toBeNull();
  });

  it("links each named sector bar to that sector filter", () => {
    render(
      <FundingSummary
        summary={summary()}
        filters={filters({
          ...dated,
          sectors: ["software-ai"],
          themes: ["generative-ai"],
          sort: "amount",
          page: 3,
        })}
        today={TODAY}
      />,
    );
    const link = screen.getByRole("link", { name: /Financial services/ });
    const params = new URLSearchParams(
      (link.getAttribute("href") ?? "").split("?")[1],
    );
    expect(params.getAll("sector")).toEqual(["financial-services"]);
    expect(params.get("theme")).toBeNull();
    expect(params.get("from")).toBe("2026-10-19");
    expect(params.get("sort")).toBe("amount");
    expect(params.get("page")).toBeNull();
    // "Sector pending" is not a filter, so it is not a link.
    expect(screen.queryByRole("link", { name: /Sector pending/ })).toBeNull();
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
  });

  it("lists the three biggest rounds", () => {
    render(
      <FundingSummary summary={summary()} filters={dated} today={TODAY} />,
    );
    const names = screen
      .getAllByRole("listitem")
      .map((item) => within(item).queryByRole("link")?.textContent)
      .filter((name) => name && !name.includes("£"));
    expect(names).toEqual(
      expect.arrayContaining(["Ledger Bank", "Pay Kit", "Coin Co"]),
    );
  });

  it("is a section of the page, not a card, with a close control", () => {
    render(
      <FundingSummary summary={summary()} filters={dated} today={TODAY} />,
    );
    const section = screen
      .getByRole("heading", { name: "What's happening" })
      .closest("section");
    expect(section?.className ?? "").not.toMatch(/border|rounded|bg-/);
    expect(
      screen.getByRole("button", { name: "Hide summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    ).not.toBeChecked();
  });
});

function readCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith("raisory_summary="))
    ?.slice("raisory_summary=".length);
}

describe("summary state", () => {
  beforeEach(() => {
    document.cookie = "raisory_summary=; Path=/; Max-Age=0";
  });

  function page(initial: SummaryState) {
    return render(
      <SummaryProvider initial={initial}>
        <SummaryFrame>
          <FundingSummary
            summary={summary()}
            filters={filters({ from: "2026-10-19" })}
            today={TODAY}
          />
        </SummaryFrame>
        <ShowSummaryButton />
      </SummaryProvider>,
    );
  }

  const heading = () =>
    screen.queryByRole("heading", { name: "What's happening" });
  const showButton = () =>
    screen.queryByRole("button", { name: "Show summary" });

  it("is open by default; close removes it and sets the session cookie", () => {
    page("open");
    expect(heading()).toBeInTheDocument();
    expect(showButton()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));
    // The whole section, header included, leaves the page.
    expect(heading()).toBeNull();
    expect(readCookie()).toBe("closed");
    expect(showButton()).toHaveFocus();
  });

  it("starts hidden when closed for the session; Show summary clears it", () => {
    page("closed");
    expect(heading()).toBeNull();
    fireEvent.click(showButton() as HTMLElement);
    expect(heading()).toBeInTheDocument();
    expect(showButton()).toBeNull();
    expect(readCookie()).toBeUndefined();
    expect(screen.getByRole("button", { name: "Hide summary" })).toHaveFocus();
  });

  it("keeps hidden by default with the one-year cookie", () => {
    page("open");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    );
    expect(readCookie()).toBe("hidden");
    // It stays on the page until the next load.
    expect(heading()).toBeInTheDocument();
  });

  it("opens for this visit when hidden by default, keeping the cookie", () => {
    document.cookie = "raisory_summary=hidden; Path=/";
    page("hidden");
    expect(heading()).toBeNull();
    fireEvent.click(showButton() as HTMLElement);
    expect(heading()).toBeInTheDocument();
    expect(readCookie()).toBe("hidden");
    const keep = screen.getByRole("checkbox", {
      name: "Keep hidden by default",
    });
    expect(keep).toBeChecked();
    // Closing again leaves the preference alone.
    fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));
    expect(readCookie()).toBe("hidden");
  });

  it("removes the persistent cookie when Keep hidden is unticked", () => {
    document.cookie = "raisory_summary=hidden; Path=/";
    page("hidden");
    fireEvent.click(showButton() as HTMLElement);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    );
    expect(readCookie()).toBeUndefined();
    expect(heading()).toBeInTheDocument();
  });
});

describe("sectorBarItems", () => {
  const bars = sectorBars(summary(), filters());

  it("ranks by £ or by rounds, with Sector pending last", () => {
    expect(sectorBarItems(bars, "gbp").map((item) => item.label)).toEqual([
      "Financial services",
      "Health and life sciences",
      "Sector pending",
    ]);
    const byCount = sectorBarItems(bars, "count");
    expect(byCount.map((item) => item.label)).toEqual([
      "Health and life sciences",
      "Financial services",
      "Sector pending",
    ]);
    expect(byCount[0]?.valueLabel).toBe("6 rounds");
  });
});

describe("QuickViews", () => {
  const base = filters({ from: "2026-10-19" });

  function counts() {
    return Object.fromEntries(QUICK_VIEWS.map((view, i) => [view.id, i * 10]));
  }

  it("links each tab to its filters, keeping the others, with its count", () => {
    render(<QuickViews filters={base} base={base} counts={counts()} />);
    const uk = screen.getByRole("link", { name: /UK/ });
    expect(uk).toHaveAttribute("href", "/?from=2026-10-19&country=GB");
    expect(uk).toHaveTextContent("10");
    expect(screen.getByRole("link", { name: /10m\+/ })).toHaveAttribute(
      "href",
      "/?min=10000000&from=2026-10-19",
    );
    expect(
      screen.getByRole("link", { name: /Seed and Series A/ }),
    ).toHaveAttribute(
      "href",
      "/?round=pre_seed&round=seed&round=series_a&from=2026-10-19",
    );
    expect(screen.getByRole("link", { name: /All/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the tab whose filters match exactly", () => {
    const current = { ...base, evidence: "confirmed" as const };
    expect(activeQuickView(current, base)?.id).toBe("confirmed");
    expect(
      activeQuickView({ ...current, countryCodes: ["GB"] }, base),
    ).toBeUndefined();
  });
});
