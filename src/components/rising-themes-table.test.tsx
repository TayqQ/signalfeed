import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RisingThemeRow } from "@/core/read-models";
import { RisingThemesTable } from "./rising-themes-table";

function row(slug: string, score: number | null): RisingThemeRow {
  return {
    theme: { slug, name: `Theme ${slug}`, sector: "climate-energy" },
    recentRounds: 5,
    baselineRounds: 10,
    expected: 3,
    score,
    recentGbpMinor: 250_000_000,
    sparkline: [1, 2, 3],
  };
}

describe("RisingThemesTable", () => {
  it("keeps the order it is given and links to each theme", () => {
    render(
      <RisingThemesTable
        rows={[row("b", 0.8), row("a", 0.2)]}
        notEnoughHistory={false}
        firstWeek="2026-01-05"
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      "/themes/b",
    );
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
      "href",
      "/themes/a",
    );
  });

  it("gives every score a text label, not only a number", () => {
    render(
      <RisingThemesTable
        rows={[row("up", 0.7), row("down", -0.5), row("flat", 0)]}
        notEnoughHistory={false}
        firstWeek="2026-01-05"
      />,
    );
    expect(
      screen.getByText(/rising: about 2\.0× its usual share/),
    ).toBeVisible();
    expect(
      screen.getByText(/falling: about 0\.6× its usual share/),
    ).toBeVisible();
    expect(
      screen.getByText(/steady: about 1\.0× its usual share/),
    ).toBeVisible();
  });

  it("shows the not enough history state and still shows counts", () => {
    render(
      <RisingThemesTable
        rows={[row("a", null)]}
        notEnoughHistory
        firstWeek="2026-06-01"
      />,
    );
    expect(
      screen.getByText(/Trends need at least 16 weeks of data/),
    ).toHaveTextContent("Collection started on 1 Jun 2026");
    expect(screen.getByText("not enough history yet")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
