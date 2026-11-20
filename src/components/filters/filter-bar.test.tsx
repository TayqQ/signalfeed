import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeRef } from "@/core/read-models";
import {
  parseFundingCriteria,
  parseFundingFilters,
} from "@/lib/funding-filters";
import { SECTORS, type Sector } from "@/core/sectors";
import { FilterBar } from "./filter-bar";
import { sectorButtonLabel } from "./sector-picker";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

const TODAY = "2026-11-18";
const THEMES: ThemeRef[] = [
  {
    slug: "ai-drug-discovery",
    name: "AI drug discovery",
    sector: "health-life-sciences",
  },
  { slug: "medtech", name: "Medical devices", sector: "health-life-sciences" },
  { slug: "generative-ai", name: "Generative AI", sector: "software-ai" },
];

/** Busiest first, as `getSectorCounts` returns them; the rest have none. */
const BUSY: ReadonlyArray<{ sector: Sector; count: number }> = [
  { sector: "software-ai", count: 40 },
  { sector: "health-life-sciences", count: 12 },
  { sector: "education", count: 3 },
];
const SECTOR_COUNTS = [
  ...BUSY,
  ...SECTORS.filter((s) => !BUSY.some((b) => b.sector === s)).map((sector) => ({
    sector,
    count: 0,
  })),
];

function bar(query: string, total = 12) {
  return (
    <FilterBar
      filters={parseFundingFilters(new URLSearchParams(query))}
      themes={THEMES}
      total={total}
      sectorCounts={SECTOR_COUNTS}
      today={TODAY}
    />
  );
}

/** Opens the bar's sector dropdown and returns its panel. */
function openSectors(name: string | RegExp = /^Sectors?\b/) {
  const [trigger] = screen.getAllByRole("button", { name });
  fireEvent.click(trigger as HTMLElement);
  return screen.getByRole("dialog", { name: "Sector" });
}

/** What a browser with JavaScript off sends when the form is submitted as is. */
function submittedQuery(html: string): URLSearchParams {
  document.body.innerHTML = html;
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data) {
    if (typeof value === "string") params.append(key, value);
  }
  return params;
}

beforeEach(() => {
  replace.mockClear();
  // The no-JavaScript tests write static HTML straight into the body.
  document.body.innerHTML = "";
});

describe("FilterBar without JavaScript", () => {
  const LINKS = [
    "",
    "q=Northwind&round=seed&round=series_a",
    "round=grant&evidence=confirmed",
    "sector=health-life-sciences&theme=ai-drug-discovery&size=1m-5m",
    "theme=generative-ai&tag=robotics&investor=northstar-capital",
    "ukregion=london&city=San+Francisco&country=US&region=Europe&near=Leeds&km=50",
    "min=250000&max=2000000&from=2026-06-01&to=2026-06-30&momentum=repeat",
    "cosize=micro&cosize=dormant&cosize=no-accounts-yet",
    "q=Bio&round=pre_seed&round=seed&round=grant&size=under-1m&min=100.5&from=2026-06-01&region=UK&country=GB&ukregion=north-west&city=leeds&near=leeds&km=100&sector=health-life-sciences&theme=ai-drug-discovery&tag=biotech&investor=x&momentum=first&evidence=confirmed&cosize=small",
  ];

  it.each(LINKS.map((link) => [link || "(empty)", link] as const))(
    "%s: submitting the form unchanged keeps the same filters",
    (_label, link) => {
      const html = renderToStaticMarkup(bar(link));
      const sent = submittedQuery(html);
      expect(parseFundingCriteria(sent)).toEqual(
        parseFundingCriteria(new URLSearchParams(link)),
      );
    },
  );

  it("keeps sort, direction and page size, and restarts paging", () => {
    const sent = submittedQuery(
      renderToStaticMarkup(
        bar("round=seed&sort=amount&dir=asc&page=3&pageSize=50"),
      ),
    );
    expect(sent.get("sort")).toBe("amount");
    expect(sent.get("dir")).toBe("asc");
    expect(sent.get("pageSize")).toBe("50");
    expect(sent.has("page")).toBe(false);
  });

  it("is a GET form with a submit button, ticked chips and preset links", () => {
    const html = renderToStaticMarkup(bar("size=1m-5m&sort=amount"));
    document.body.innerHTML = html;
    const form = document.querySelector("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/");
    expect(
      screen.getByRole("button", { name: "Apply filters" }),
    ).toHaveAttribute("type", "submit");
    expect(screen.getByRole("checkbox", { name: "£1m–£5m" })).toBeChecked();
    const stage = screen.getByRole("group", { name: "Stage" });
    expect(
      within(stage).getByRole("link", { name: "Series A" }),
    ).toHaveAttribute("href", "/?size=1m-5m&round=series_a&sort=amount");
    expect(
      within(stage).getByRole("link", { name: "All stages" }),
    ).toHaveAttribute("aria-current", "true");
    const date = screen.getByRole("group", { name: "Date" });
    expect(
      within(date).getByRole("link", { name: "Last 30 days" }),
    ).toHaveAttribute("href", "/?size=1m-5m&from=2026-10-19&sort=amount");
    // The sector dropdown is a <details> with the same checkbox list.
    const sector = Array.from(document.querySelectorAll("details")).find(
      (details) => details.querySelector("summary")?.textContent === "Sector",
    );
    expect(sector).toBeDefined();
    const boxes = sector?.querySelectorAll(
      'input[type="checkbox"][name="sector"]',
    );
    expect(boxes?.length).toBe(SECTORS.length);
    expect((boxes?.[0] as HTMLInputElement | undefined)?.value).toBe(
      "software-ai",
    );
    // Popovers fall back to <details>, so their fields are in the form.
    expect(document.querySelectorAll("details").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(document.querySelector('input[name="min"]')).not.toBeNull();
  });
});

describe("applied chips", () => {
  it("shows a removal link for every value, including URL-only ones", () => {
    render(
      bar(
        "region=Europe&country=US&tag=robotics&investor=northstar-capital&round=seed&sort=amount",
      ),
    );
    const links = screen.getAllByRole("link", { name: /^Remove filter/ });
    const byLabel: Record<string, string | null> = Object.fromEntries(
      links.map((link) => [
        link.getAttribute("aria-label") ?? "",
        link.getAttribute("href"),
      ]),
    );
    expect(byLabel).toEqual({
      "Remove filter: Seed":
        "/?region=Europe&country=US&tag=robotics&investor=northstar-capital&sort=amount",
      "Remove filter: United States":
        "/?round=seed&region=Europe&tag=robotics&investor=northstar-capital&sort=amount",
      "Remove filter: Europe":
        "/?round=seed&country=US&tag=robotics&investor=northstar-capital&sort=amount",
      "Remove filter: Investor: Northstar Capital":
        "/?round=seed&region=Europe&country=US&tag=robotics&sort=amount",
      "Remove filter: Tag: Robotics":
        "/?round=seed&region=Europe&country=US&investor=northstar-capital&sort=amount",
    });
    expect(screen.getByRole("link", { name: "Clear all" })).toHaveAttribute(
      "href",
      "/?sort=amount",
    );
  });

  it("shows Clear all only for two or more values", () => {
    render(bar("round=grant"));
    expect(
      screen.getByRole("link", { name: "Remove filter: Grants" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Clear all" })).toBeNull();
  });
});

describe("FilterBar with JavaScript", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a sector from the dropdown at once with router.replace", () => {
    render(bar(""));
    const panel = openSectors("Sector");
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: /^Education/ }),
    );
    expect(replace).toHaveBeenCalledWith("/?sector=education", {
      scroll: false,
    });
  });

  it("lists every sector busiest first, with counts and the ranking caption", () => {
    render(bar(""));
    const panel = openSectors("Sector");
    const names = within(panel)
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")?.textContent ?? "");
    expect(names).toHaveLength(SECTORS.length);
    expect(names.slice(0, 3)).toEqual([
      "Software, AI and data, 40 rounds",
      "Health and life sciences, 12 rounds",
      "Education, 3 rounds",
    ]);
    expect(names[3]).toMatch(/, 0 rounds$/);
    expect(
      within(panel).getByText("Ranked by rounds in the last 90 days"),
    ).toBeInTheDocument();
    fireEvent.change(
      within(panel).getByRole("searchbox", { name: "Find a sector or theme" }),
      { target: { value: "health" } },
    );
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("names the trigger after the choice", () => {
    render(bar("sector=education"));
    expect(
      screen.getAllByRole("button", { name: "Sector: Education" }).length,
    ).toBeGreaterThan(0);
  });

  it("moves the Stage control with the arrow keys", () => {
    render(bar("sort=amount"));
    const [stage] = screen.getAllByRole("radiogroup", { name: "Stage" });
    const all = within(stage as HTMLElement).getByRole("radio", {
      name: "All stages",
    });
    expect(all).toBeChecked();
    fireEvent.keyDown(all, { key: "ArrowRight" });
    expect(replace).toHaveBeenCalledWith(
      "/?round=pre_seed&round=seed&sort=amount",
      { scroll: false },
    );
  });

  it("keeps grants when the stage changes, and offers them in More", () => {
    render(bar("round=seed&round=pre_seed&round=grant"));
    const [stage] = screen.getAllByRole("radiogroup", { name: "Stage" });
    fireEvent.click(
      within(stage as HTMLElement).getByRole("radio", { name: "Series A" }),
    );
    expect(replace).toHaveBeenLastCalledWith("/?round=series_a&round=grant", {
      scroll: false,
    });
  });

  it("picks a place from the combobox", () => {
    render(bar(""));
    const [place] = screen.getAllByRole("button", { name: "Place" });
    fireEvent.click(place as HTMLElement);
    const box = screen.getByRole("combobox", {
      name: "Region, town or country",
    });
    fireEvent.change(box, { target: { value: "germ" } });
    expect(screen.getByRole("option", { name: /Germany/ })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(replace).toHaveBeenCalledWith("/?country=DE", { scroll: false });
  });

  it("opens the phone sheet, which traps focus and closes on Escape", () => {
    render(bar("sector=education&size=1m-5m"));
    const trigger = screen.getByRole("button", { name: "Filters (2)" });
    fireEvent.click(trigger);
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    expect(
      within(sheet).getByRole("button", { name: "Show 12 results" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes the sheet with Show N results, and clears with Clear", () => {
    render(bar("sector=education&sort=amount", 1));
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear" }));
    expect(replace).toHaveBeenCalledWith("/?sort=amount", { scroll: false });
    fireEvent.click(
      within(sheet).getByRole("button", { name: /^Show 1 result$|Updating/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the chosen sector's themes under it, in the same dropdown", () => {
    render(bar("sector=health-life-sciences"));
    const panel = openSectors("Sector: Health and life sciences");
    const themes = within(panel).getByRole("group", {
      name: "Themes in Health and life sciences",
    });
    expect(
      within(themes).getByRole("checkbox", { name: "AI drug discovery" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("checkbox", { name: "Generative AI" }),
    ).toBeNull();
    fireEvent.change(
      within(panel).getByRole("searchbox", { name: "Find a sector or theme" }),
      { target: { value: "medic" } },
    );
    expect(
      within(panel).queryByRole("checkbox", { name: "AI drug discovery" }),
    ).toBeNull();
    fireEvent.click(
      within(panel).getByRole("checkbox", { name: "Medical devices" }),
    );
    expect(replace).toHaveBeenCalledWith(
      "/?sector=health-life-sciences&theme=medtech",
      { scroll: false },
    );
  });

  it("drops a sector's themes when the sector is unticked", () => {
    render(bar("sector=health-life-sciences&sector=education&theme=medtech"));
    const panel = openSectors("Sectors (2)");
    fireEvent.click(
      within(panel).getByRole("checkbox", {
        name: /^Health and life sciences/,
      }),
    );
    expect(replace).toHaveBeenCalledWith("/?sector=education", {
      scroll: false,
    });
  });

  it("keeps a theme chosen by URL without its sector, so it can be unticked", () => {
    render(bar("theme=generative-ai"));
    const panel = openSectors("Sector");
    const theme = within(panel).getByRole("checkbox", {
      name: "Generative AI",
    });
    expect(theme).toBeChecked();
    fireEvent.click(theme);
    expect(replace).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("opens the sector list in place inside the phone sheet", () => {
    render(bar("sector=education"));
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }));
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    const trigger = within(sheet).getByRole("button", {
      name: "Sector: Education",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(
      within(sheet).getByRole("checkbox", { name: /^Software, AI and data/ }),
    );
    expect(replace).toHaveBeenCalledWith(
      "/?sector=education&sector=software-ai",
      { scroll: false },
    );
  });
});

describe("sectorButtonLabel", () => {
  const sectors = [
    { value: "education", label: "Education" },
    { value: "software-ai", label: "Software, AI and data" },
  ];

  it("says Sector, the one sector, or how many", () => {
    expect(sectorButtonLabel([], sectors)).toBe("Sector");
    expect(sectorButtonLabel(["education"], sectors)).toBe("Sector: Education");
    expect(sectorButtonLabel(["education", "software-ai"], sectors)).toBe(
      "Sectors (2)",
    );
  });
});
