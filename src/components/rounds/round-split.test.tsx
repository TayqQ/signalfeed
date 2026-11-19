import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPreview, FundingRow } from "@/core/read-models";
import { previewFacts, previewSignals, RoundPreview } from "./round-preview";
import { nextSelection, RoundSplit, SKELETON_DELAY_MS } from "./round-split";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const NOW = new Date("2026-11-18T12:00:00Z");

function row(slug: string, name: string, eventId: number): FundingRow {
  return {
    eventId,
    companySlug: slug,
    companyName: name,
    countryCode: "GB",
    city: "Leeds",
    companyDescription: `${name} makes things`,
    mainSector: "software-ai",
    websiteDomain: null,
    roundType: "seed",
    roundLabel: null,
    amount: { amountMinor: 200_000_000, currency: "GBP" },
    amountGbpMinor: 200_000_000,
    amountUsdMinor: 250_000_000,
    announcedOn: "2026-11-10",
    leadInvestors: [],
    investorCount: 0,
    sourceCount: 1,
    tags: [],
  };
}

function preview(
  slug: string,
  name: string,
  overrides: Partial<CompanyPreview> = {},
): CompanyPreview {
  return {
    slug,
    name,
    description: `${name} makes things`,
    websiteDomain: `${slug}.example`,
    countryCode: "GB",
    city: "Leeds",
    mainSector: "software-ai",
    foundedYear: 2021,
    foundedYearSource: "news",
    status: "active",
    roundsInLast24Months: 1,
    redirectToSlug: null,
    latestRound: {
      eventId: 1,
      roundType: "seed",
      roundLabel: null,
      amount: { amountMinor: 200_000_000, currency: "GBP" },
      amountGbpMinor: 200_000_000,
      announcedOn: "2026-11-10",
      leadInvestors: [{ slug: "example", name: `${name} Lead Fund` }],
      investorCount: 2,
      sourceCount: 2,
      evidence: "reported",
      confirmation: null,
    },
    registry: null,
    signals: {
      confirmed: false,
      daysSinceLastRound: 8,
      firstRoundOn: "2026-11-10",
      sourceCount: 2,
    },
    ...overrides,
  };
}

const ROWS = [
  row("alpha", "Alpha", 1),
  row("bravo", "Bravo", 2),
  row("charlie", "Charlie", 3),
];
const PREVIEWS: Record<string, CompanyPreview> = {
  alpha: preview("alpha", "Alpha"),
  bravo: preview("bravo", "Bravo"),
  charlie: preview("charlie", "Charlie"),
};

/** A fake fetch: each slug answers after its own delay, and ignores aborts. */
function fakeFetch(delays: Record<string, number>) {
  const signals: Record<string, AbortSignal> = {};
  const calls: string[] = [];
  const fetch = vi.fn((input: string, init?: RequestInit) => {
    const slug = input.split("/").pop()!;
    calls.push(slug);
    if (init?.signal) signals[slug] = init.signal;
    const body = PREVIEWS[slug];
    return new Promise<Response>((resolve) => {
      setTimeout(
        () =>
          resolve(
            body
              ? Response.json(body)
              : Response.json({ error: "Company not found" }, { status: 404 }),
          ),
        delays[slug] ?? 0,
      );
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls, signals };
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function renderSplit(url = "/?view=split", serverSlug = "alpha") {
  window.history.replaceState(null, "", url);
  return render(
    <RoundSplit
      rows={ROWS}
      href="/?view=split"
      preview={PREVIEWS[serverSlug]}
      previewSlug={serverSlug}
      now={NOW}
    />,
  );
}

function rowLink(name: string) {
  const list = screen.getByRole("list", { name: "Funding rounds" });
  return within(list).getByRole("link", { name: new RegExp(`^${name}`) });
}

/** The company name: the preview's first heading. */
function previewName() {
  const region = screen.getByRole("region", { name: "Company preview" });
  return within(region).getAllByRole("heading", { level: 2 })[0]!;
}

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RoundSplit", () => {
  it("renders the server preview and plain ?open= links without fetching", () => {
    const { fetch } = fakeFetch({});
    renderSplit();
    expect(rowLink("Alpha")).toHaveAttribute("aria-current", "true");
    expect(rowLink("Bravo")).not.toHaveAttribute("aria-current");
    // Without JavaScript each row is a link the server renders.
    expect(rowLink("Bravo")).toHaveAttribute("href", "/?view=split&open=bravo");
    expect(previewName()).toHaveTextContent("Alpha");
    expect(previewName()).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Alpha Lead Fund")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open full page" }),
    ).toHaveAttribute("href", "/companies/alpha");
    expect(fetch).not.toHaveBeenCalled();
    // The first row on a plain URL leaves the URL alone.
    expect(window.location.search).toBe("?view=split");
  });

  it("selects ?open= when that row is on the page, else the first row", () => {
    fakeFetch({});
    renderSplit("/?view=split&open=charlie", "charlie");
    expect(rowLink("Charlie")).toHaveAttribute("aria-current", "true");
    expect(previewName()).toHaveTextContent("Charlie");
  });

  it("moves with j and k, syncs ?open= in place and keeps focus in the list", async () => {
    const { calls } = fakeFetch({ bravo: 5 });
    renderSplit();
    const historyLength = window.history.length;
    fireEvent.keyDown(document.body, { key: "j" });
    expect(rowLink("Bravo")).toHaveAttribute("aria-current", "true");
    expect(rowLink("Bravo")).toHaveFocus();
    expect(previewName()).toHaveTextContent("Bravo");
    expect(window.location.search).toBe("?view=split&open=bravo");
    expect(window.history.length).toBe(historyLength);
    await wait(20);
    expect(screen.getByText("Bravo Lead Fund")).toBeInTheDocument();
    expect(calls).toEqual(["bravo"]);

    // Back to a preview already loaded: no request.
    fireEvent.keyDown(document.activeElement!, { key: "k" });
    expect(rowLink("Alpha")).toHaveFocus();
    expect(screen.getByText("Alpha Lead Fund")).toBeInTheDocument();
    expect(calls).toEqual(["bravo"]);
    expect(window.location.search).toBe("?view=split&open=alpha");
  });

  it("uses the arrow keys inside the list and ignores keys in a text field", async () => {
    fakeFetch({ bravo: 0 });
    renderSplit();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(rowLink("Alpha")).toHaveAttribute("aria-current", "true");
    rowLink("Alpha").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(rowLink("Bravo")).toHaveAttribute("aria-current", "true");
    await wait(5);

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    expect(rowLink("Bravo")).toHaveAttribute("aria-current", "true");
    input.remove();
  });

  it("selects on click without leaving the page, and Enter opens the company", () => {
    fakeFetch({ charlie: 0 });
    renderSplit();
    const charlie = rowLink("Charlie");
    const notPrevented = fireEvent.click(charlie);
    expect(notPrevented).toBe(false);
    expect(charlie).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(charlie, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/companies/charlie");
  });

  it("never lets a stale response overwrite a newer selection", async () => {
    const { calls, signals } = fakeFetch({ bravo: 60, charlie: 10 });
    renderSplit();
    fireEvent.keyDown(document.body, { key: "j" }); // Bravo, slow
    fireEvent.keyDown(document.activeElement!, { key: "j" }); // Charlie, fast
    expect(calls).toEqual(["bravo", "charlie"]);
    expect(signals.bravo?.aborted).toBe(true);
    await wait(30);
    expect(screen.getByText("Charlie Lead Fund")).toBeInTheDocument();
    await wait(60);
    // Bravo's answer arrived later and was dropped.
    expect(previewName()).toHaveTextContent("Charlie");
    expect(screen.getByText("Charlie Lead Fund")).toBeInTheDocument();
    expect(screen.queryByText("Bravo Lead Fund")).toBeNull();
  });

  it("keeps the previous preview briefly, then shows the skeleton", async () => {
    fakeFetch({ bravo: 10_000 });
    renderSplit();
    fireEvent.keyDown(document.body, { key: "j" });
    // Under 150 ms: the old preview stays, dimmed, with no skeleton.
    expect(screen.queryByTestId("preview-skeleton")).toBeNull();
    expect(screen.getByText("Alpha Lead Fund")).toBeInTheDocument();
    await wait(SKELETON_DELAY_MS + 30);
    expect(screen.getByTestId("preview-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Lead Fund")).toBeNull();
    expect(previewName()).toHaveTextContent("Bravo");
  });

  it("offers a retry when the request fails", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          fail
            ? new Response("", { status: 500 })
            : Response.json(PREVIEWS.bravo),
        ),
      ),
    );
    renderSplit();
    fireEvent.keyDown(document.body, { key: "j" });
    await wait(5);
    expect(screen.getByText("The preview didn't load")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await wait(5);
    expect(screen.getByText("Bravo Lead Fund")).toBeInTheDocument();
  });

  it("keeps the selection across new rows only while it is on the page", () => {
    fakeFetch({});
    window.history.replaceState(null, "", "/?view=split&open=bravo");
    const { rerender } = render(
      <RoundSplit
        rows={ROWS}
        href="/?view=split"
        preview={PREVIEWS.bravo}
        previewSlug="bravo"
        now={NOW}
      />,
    );
    expect(rowLink("Bravo")).toHaveAttribute("aria-current", "true");

    // A sort link: same rows reordered, and the URL lost ?open=.
    window.history.replaceState(null, "", "/?view=split&sort=amount");
    const sorted = [ROWS[2]!, ROWS[0]!, ROWS[1]!];
    rerender(
      <RoundSplit
        rows={sorted}
        href="/?sort=amount&view=split"
        preview={PREVIEWS.charlie}
        previewSlug="charlie"
        now={NOW}
      />,
    );
    expect(rowLink("Bravo")).toHaveAttribute("aria-current", "true");
    expect(window.location.search).toBe("?view=split&sort=amount&open=bravo");

    // Page 2 without Bravo: the first row.
    window.history.replaceState(null, "", "/?view=split&page=2");
    const pageTwo = [row("delta", "Delta", 4), row("echo", "Echo", 5)];
    rerender(
      <RoundSplit
        rows={pageTwo}
        href="/?page=2&view=split"
        preview={null}
        previewSlug="delta"
        now={NOW}
      />,
    );
    expect(rowLink("Delta")).toHaveAttribute("aria-current", "true");
    expect(window.location.search).toBe("?view=split&page=2");
    expect(screen.getByText("No preview for this company")).toBeInTheDocument();
  });
});

describe("nextSelection", () => {
  it("prefers the URL, then the current row, then the first", () => {
    const slugs = ["a", "b", "c"];
    expect(nextSelection(slugs, "c", "b")).toBe("c");
    expect(nextSelection(slugs, "z", "b")).toBe("b");
    expect(nextSelection(slugs, null, "z")).toBe("a");
    expect(nextSelection([], "a", "a")).toBeNull();
  });
});

describe("RoundPreview", () => {
  const ALPHA = ROWS[0]!;

  it("shows the action row, key facts, the latest round and signals", () => {
    render(
      <RoundPreview
        row={ALPHA}
        state={{ kind: "ready", preview: PREVIEWS.alpha! }}
        nameId="name"
        now={NOW}
      />,
    );
    expect(screen.getByRole("link", { name: /Visit website/ })).toHaveAttribute(
      "href",
      "https://alpha.example",
    );
    const facts = screen.getByRole("region", { name: "Key facts" });
    expect(within(facts).getByText("£2.0m")).toBeInTheDocument();
    expect(within(facts).getByText("No match yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Latest round" })).toBeVisible();
    expect(screen.getByText("Raised in the last 30 days")).toBeInTheDocument();
    expect(
      screen.getByText("First round we have recorded"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("From news reports only · 2 sources"),
    ).toBeVisible();
  });

  it("links the full page to the surviving company after a merge", () => {
    render(
      <RoundPreview
        row={ALPHA}
        state={{
          kind: "ready",
          preview: preview("alpha", "Alpha", { redirectToSlug: "alpha-ltd" }),
        }}
        nameId="name"
        now={NOW}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open full page" }),
    ).toHaveAttribute("href", "/companies/alpha-ltd");
  });
});

describe("previewFacts and previewSignals", () => {
  it("says what is missing without guessing", () => {
    const bare = preview("x", "X", {
      countryCode: "US",
      foundedYear: null,
      latestRound: null,
      roundsInLast24Months: 0,
      signals: {
        confirmed: false,
        daysSinceLastRound: null,
        firstRoundOn: null,
        sourceCount: 0,
      },
    });
    const facts = previewFacts(bare, NOW);
    expect(facts.map((fact) => fact.value)).toEqual([
      null,
      null,
      null,
      "0",
      null,
      "UK companies only",
    ]);
    expect(previewSignals(bare, NOW)).toEqual([]);
  });

  it("names the record behind a confirmed round and the Companies House status", () => {
    const confirmed = preview("y", "Y", {
      roundsInLast24Months: 2,
      registry: {
        companyNumber: "12345678",
        url: "https://find-and-update.company-information.service.gov.uk/company/12345678",
        statusLabel: "Active",
        sizeBand: "micro",
        incorporatedOn: "2020-01-02",
      },
      signals: {
        confirmed: true,
        daysSinceLastRound: 8,
        firstRoundOn: "2024-01-01",
        sourceCount: 2,
      },
    });
    confirmed.latestRound!.confirmation = {
      kind: "ch_allotment",
      recordDate: "2026-11-01",
      confirmsAmount: false,
      text: "Confirmed: shares allotted on 1 November 2026",
    };
    const signals = previewSignals(confirmed, NOW);
    expect(signals.map((signal) => signal.id)).toEqual([
      "confirmed",
      "recent",
      "again",
      "sources",
      "registry",
    ]);
    expect(signals[0]).toMatchObject({
      text: "Confirmed by a Companies House filing",
      detail: "Shares allotted on 1 November 2026",
    });
    expect(previewFacts(confirmed, NOW)[5]).toMatchObject({
      value: "12345678",
      sub: "Active",
    });
  });
});
