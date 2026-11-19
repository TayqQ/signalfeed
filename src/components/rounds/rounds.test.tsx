import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingFilters, FundingRow } from "@/core/read-models";
import { RoundCards } from "./round-cards";
import { RoundList } from "./round-list";
import { leadsLabel } from "./round-row-parts";
import { RoundViews } from "./round-views";
import { SortControl } from "./sort-control";
import { ViewSwitch } from "./view-switch";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const NOW = new Date("2026-11-18T12:00:00Z");

function row(overrides: Partial<FundingRow> = {}): FundingRow {
  return {
    eventId: 1,
    companySlug: "northwind-robotics",
    companyName: "Northwind Robotics",
    countryCode: "GB",
    city: "Leeds",
    companyDescription: "Warehouse robots that pick mixed orders",
    mainSector: "software-ai",
    websiteDomain: null,
    roundType: "series_a",
    roundLabel: null,
    amount: { amountMinor: 500_000_000, currency: "USD" },
    amountGbpMinor: 420_000_000,
    amountUsdMinor: 500_000_000,
    announcedOn: "2026-11-17",
    leadInvestors: [{ slug: "example", name: "Example Ventures" }],
    investorCount: 3,
    sourceCount: 2,
    tags: [],
    ...overrides,
  };
}

/** A row with every optional value missing. */
const BARE = row({
  eventId: 2,
  companySlug: "quiet-co",
  companyName: "Quiet Co",
  countryCode: null,
  city: null,
  companyDescription: null,
  mainSector: null,
  amount: null,
  amountGbpMinor: null,
  amountUsdMinor: null,
  announcedOn: "2026-06-01",
  leadInvestors: [],
  investorCount: 0,
});

const filters: FundingFilters = { page: 1, pageSize: 25, tag: "robotics" };

beforeEach(() => {
  replace.mockClear();
  document.cookie = "raisory_view=; Max-Age=0; Path=/";
});

describe("leadsLabel", () => {
  it("names one or two leads and counts the rest", () => {
    const lead = (n: number) => ({ slug: `l${n}`, name: `Lead ${n}` });
    expect(leadsLabel(row({ leadInvestors: [lead(1)] }))).toBe("Led by Lead 1");
    expect(leadsLabel(row({ leadInvestors: [lead(1), lead(2)] }))).toBe(
      "Led by Lead 1 and Lead 2",
    );
    expect(
      leadsLabel(row({ leadInvestors: [lead(1), lead(2), lead(3), lead(4)] })),
    ).toBe("Led by Lead 1, Lead 2 +2");
  });

  it("says when leads are not named, and nothing when no investor is known", () => {
    expect(leadsLabel(row({ leadInvestors: [], investorCount: 2 }))).toBe(
      "2 investors, lead not named",
    );
    expect(leadsLabel(BARE)).toBeNull();
  });
});

describe("RoundList", () => {
  it("shows the identity, stage, sector, place, amount and date", () => {
    render(<RoundList rows={[row()]} filters={filters} now={NOW} />);
    const link = screen.getByRole("link", { name: "Northwind Robotics" });
    expect(link).toHaveAttribute("href", "/companies/northwind-robotics");
    expect(
      screen.getByText("Warehouse robots that pick mixed orders"),
    ).toBeInTheDocument();
    expect(screen.getByText("Series A")).toBeInTheDocument();
    expect(screen.getByText("Software, AI and data")).toBeInTheDocument();
    expect(screen.getAllByText("Leeds").length).toBeGreaterThan(0);
    expect(screen.getByText("£4.2m")).toBeInTheDocument();
    expect(screen.getByText("US$5.0m")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByTestId("row-leads")).toHaveTextContent(
      "Led by Example Ventures",
    );
  });

  it("renders every fallback state", () => {
    render(<RoundList rows={[BARE]} filters={filters} now={NOW} />);
    expect(screen.getByText("Undisclosed")).toBeInTheDocument();
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
    expect(screen.getAllByText("Place not known").length).toBeGreaterThan(0);
    expect(screen.getByText("No description yet")).toBeInTheDocument();
    expect(screen.getByText("1 Jun 2026")).toBeInTheDocument();
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByTestId("row-leads")).toBeNull();
  });

  it("shows the Confirmed mark only on confirmed rows", () => {
    const text = "Confirmed: shares allotted on 2 February 2026";
    render(
      <RoundList
        rows={[
          row({
            confirmation: {
              kind: "ch_allotment",
              recordDate: "2026-02-02",
              confirmsAmount: false,
              text,
            },
          }),
          BARE,
        ]}
        filters={filters}
        now={NOW}
      />,
    );
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note", { name: text })).toHaveTextContent(
      "Confirmed",
    );
  });

  it("keeps the filters on sort headers and toggles the direction", () => {
    render(
      <RoundList
        rows={[row()]}
        filters={{ ...filters, sort: "amount", direction: "desc" }}
        now={NOW}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Amount/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    const href = within(header).getByRole("link").getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("tag")).toBe("robotics");
    expect(params.get("sort")).toBe("amount");
    expect(params.get("dir")).toBe("asc");
    expect(screen.getByRole("columnheader", { name: /Date/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });
});

describe("RoundList keys", () => {
  const rows = [
    row(),
    row({ eventId: 2, companySlug: "quiet-co", companyName: "Quiet Co" }),
    row({ eventId: 3, companySlug: "third-co", companyName: "Third Co" }),
  ];

  function rowLink(name: string) {
    return screen.getByRole("link", { name });
  }

  it("moves focus between row links with j and k", () => {
    render(<RoundList rows={rows} filters={filters} now={NOW} />);
    fireEvent.keyDown(document.body, { key: "j" });
    expect(rowLink("Northwind Robotics")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    expect(rowLink("Third Co")).toHaveFocus();
    // The last row stays put.
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    expect(rowLink("Third Co")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "k" });
    expect(rowLink("Quiet Co")).toHaveFocus();
    expect(rowLink("Quiet Co")).toHaveAttribute("href", "/companies/quiet-co");
  });

  it("uses the arrow keys only while focus is in the list", () => {
    render(<RoundList rows={rows} filters={filters} now={NOW} />);
    const down = fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(down).toBe(true); // not prevented: the page still scrolls
    expect(document.body).toHaveFocus();
    rowLink("Northwind Robotics").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(rowLink("Quiet Co")).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(rowLink("Northwind Robotics")).toHaveFocus();
  });

  it("ignores the keys in a text field and with modifiers", () => {
    render(
      <>
        <input aria-label="Search" />
        <RoundList rows={rows} filters={filters} now={NOW} />
      </>,
    );
    const search = screen.getByRole("textbox", { name: "Search" });
    search.focus();
    fireEvent.keyDown(search, { key: "j" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "j", metaKey: true });
    expect(search).toHaveFocus();
  });
});

describe("RoundCards", () => {
  it("shows identity, description, facts and the footer", () => {
    render(<RoundCards rows={[row()]} now={NOW} />);
    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("link", { name: "Northwind Robotics" }),
    ).toHaveAttribute("href", "/companies/northwind-robotics");
    expect(within(card).getByText("Leeds")).toBeInTheDocument();
    expect(within(card).getByText("£4.2m")).toBeInTheDocument();
    expect(within(card).getByText("Series A")).toBeInTheDocument();
    expect(within(card).getByText("Software, AI and data")).toBeInTheDocument();
    expect(within(card).getByText("Yesterday")).toBeInTheDocument();
    expect(
      within(card).getByText("Led by Example Ventures"),
    ).toBeInTheDocument();
  });

  it("renders every fallback state", () => {
    render(<RoundCards rows={[BARE]} now={NOW} />);
    expect(screen.getByText("Undisclosed")).toBeInTheDocument();
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
    expect(screen.getByText("Place not known")).toBeInTheDocument();
    expect(screen.getByText("No description yet")).toBeInTheDocument();
    expect(screen.getByText("Investors not reported")).toBeInTheDocument();
  });
});

describe("RoundViews", () => {
  const empty = {
    rows: [],
    view: "list" as const,
    filters,
    clearHref: "/",
  };

  it("names the active filters and offers Clear all", () => {
    render(
      <RoundViews {...empty} appliedLabels={["Seed", "Last 30 days", "UK"]} />,
    );
    expect(
      screen.getByText("No rounds match these filters"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing matches Seed, Last 30 days and UK/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear all" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("explains an empty database rather than blaming the filters", () => {
    render(<RoundViews {...empty} appliedLabels={[]} />);
    expect(screen.getByText("No funding rounds yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "status page" })).toHaveAttribute(
      "href",
      "/status",
    );
  });

  it("renders the stacked list for phones alongside the cards", () => {
    render(
      <RoundViews
        rows={[row()]}
        view="cards"
        filters={filters}
        appliedLabels={[]}
        clearHref="/"
        now={NOW}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("renders the list for screens under 1100 px alongside Split", () => {
    window.history.replaceState(null, "", "/?view=split");
    render(
      <RoundViews
        rows={[row(), BARE]}
        view="split"
        filters={filters}
        appliedLabels={[]}
        clearHref="/"
        href="/?view=split"
        previewSlug="northwind-robotics"
        preview={null}
        now={NOW}
      />,
    );
    const table = screen.getByRole("table");
    expect(table.closest(".min-\\[1100px\\]\\:hidden")).not.toBeNull();
    const region = screen.getByRole("region", { name: "Company preview" });
    expect(region.closest(".max-\\[1100px\\]\\:hidden")).not.toBeNull();
    expect(table.closest(".max-\\[1100px\\]\\:hidden")).toBeNull();
  });

  it("renders only the list in List", () => {
    render(
      <RoundViews
        rows={[row()]}
        view="list"
        filters={filters}
        appliedLabels={[]}
        clearHref="/"
        now={NOW}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("SortControl", () => {
  it("links to each sort with the filters kept", () => {
    render(<SortControl filters={filters} />);
    const group = screen.getByRole("group", { name: "Sort" });
    expect(within(group).getByRole("link", { name: "Newest" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      within(group).getByRole("link", { name: "Largest" }),
    ).toHaveAttribute("href", "/?tag=robotics&sort=amount");
    expect(within(group).queryByText("Best match")).toBeNull();
  });

  it("offers Best match for a name search", () => {
    render(<SortControl filters={{ ...filters, q: "north" }} />);
    expect(screen.getByRole("link", { name: "Best match" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "Newest" })).toHaveAttribute(
      "href",
      "/?q=north&tag=robotics&sort=announced",
    );
  });
});

describe("ViewSwitch", () => {
  function stubWidth(narrow: boolean) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: narrow && query.includes("max-width"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers Split, untitled on a wide screen", () => {
    stubWidth(false);
    render(<ViewSwitch view="list" href="/" />);
    const split = screen.getByRole("radio", { name: "Split" });
    expect(split).toBeEnabled();
    expect(split).not.toHaveAttribute("title");
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("explains under 1100 px that Split needs a wider screen", () => {
    stubWidth(true);
    render(<ViewSwitch view="split" href="/?view=split" />);
    const split = screen.getByRole("radio", { name: "Split" });
    expect(split).toBeEnabled();
    expect(split).toHaveAttribute("title", "Needs a wider screen");
  });

  it("chooses Split like any other view", () => {
    stubWidth(false);
    window.history.replaceState(null, "", "/");
    render(<ViewSwitch view="list" href="/" />);
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Split" }));
    });
    expect(document.cookie).toContain("raisory_view=split");
    // Split is the default, so its URL stays plain.
    expect(replace).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("puts List in the URL, since Split is the default", () => {
    stubWidth(false);
    window.history.replaceState(null, "", "/");
    render(<ViewSwitch view="split" href="/" />);
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "List" }));
    });
    expect(document.cookie).toContain("raisory_view=list");
    expect(replace).toHaveBeenCalledWith("/?view=list", { scroll: false });
  });

  it("remembers the choice in the cookie and puts it in the URL", () => {
    window.history.replaceState(null, "", "/?sector=fintech");
    render(<ViewSwitch view="list" href="/?sector=fintech" />);
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Cards" }));
    });
    expect(document.cookie).toContain("raisory_view=cards");
    expect(replace).toHaveBeenCalledWith("/?sector=fintech&view=cards", {
      scroll: false,
    });
  });
});

describe("chipLabel", () => {
  it("keeps clean series labels and drops wordy ones", async () => {
    const { chipLabel } = await import("./round-row-parts");
    expect(chipLabel("Series F")).toBe("Series F");
    expect(chipLabel("series a")).toBe("Series A");
    expect(chipLabel("Series C financing round")).toBeUndefined();
    expect(chipLabel("seed funding")).toBeUndefined();
    expect(chipLabel(null)).toBeUndefined();
  });
});
