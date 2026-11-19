import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeRef } from "@/core/read-models";
import {
  parseFundingCriteria,
  parseFundingFilters,
} from "@/lib/funding-filters";
import { FilterBar } from "./filter-bar";

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

function bar(query: string, total = 12) {
  return (
    <FilterBar
      filters={parseFundingFilters(new URLSearchParams(query))}
      themes={THEMES}
      total={total}
      today={TODAY}
    />
  );
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

  it("applies a sector chip at once with router.replace", () => {
    render(bar(""));
    const [chip] = screen.getAllByRole("checkbox", { name: "Education" });
    fireEvent.click(chip as HTMLElement);
    expect(replace).toHaveBeenCalledWith("/?sector=education", {
      scroll: false,
    });
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

  it("lists the chosen sector's themes as a second level", () => {
    render(bar("sector=health-life-sciences"));
    const [themes] = screen.getAllByRole("button", { name: "Themes" });
    fireEvent.click(themes as HTMLElement);
    const panel = screen.getByRole("dialog", { name: "Themes" });
    expect(
      within(panel).getByRole("checkbox", { name: "AI drug discovery" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("checkbox", { name: "Generative AI" }),
    ).toBeNull();
    fireEvent.change(
      within(panel).getByRole("searchbox", { name: "Find a theme" }),
      {
        target: { value: "medic" },
      },
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
});
