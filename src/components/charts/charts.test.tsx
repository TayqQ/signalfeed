import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./bar-chart";
import { ColumnChart } from "./column-chart";
import { Sparkline } from "./sparkline";

const categories = [
  { label: "Week of 6 Oct 2026", axisLabel: "6 Oct" },
  { label: "Week of 13 Oct 2026", axisLabel: "13 Oct" },
  { label: "Week of 20 Oct 2026", axisLabel: "20 Oct" },
  { label: "Week of 27 Oct 2026", axisLabel: "27 Oct" },
  { label: "Week of 3 Nov 2026", axisLabel: "3 Nov" },
];

const stackedSeries = [
  { key: "early", label: "Early stage", values: [1, 2, 0, 3, 2] },
  { key: "later", label: "Later stage", values: [0, 1, 2, 1, 4] },
  { key: "unknown", label: "Unknown stage", values: [1, 0, 0, 1, 1] },
];

describe("Sparkline", () => {
  it("has an accessible name that gives the range", () => {
    render(<Sparkline name="Weekly rounds" values={[2, 4, 3, 9]} />);
    expect(
      screen.getByRole("img", {
        name: "Weekly rounds over 4 weeks, from 2 to 9",
      }),
    ).toBeInTheDocument();
  });

  it("draws a flat line without dividing by zero", () => {
    const { container } = render(
      <Sparkline name="Weekly rounds" values={[0, 0, 0]} />,
    );
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("says there is no data instead of drawing an empty SVG", () => {
    const { container } = render(
      <Sparkline name="Weekly rounds" values={[]} />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("ColumnChart", () => {
  function renderStacked() {
    return render(
      <ColumnChart
        title="Rounds per week, by stage"
        summary="Rounds rose from 2 to 7 a week."
        categories={categories}
        series={stackedSeries}
        valueLabel="Rounds"
        labelEvery={2}
      />,
    );
  }

  it("has an accessible name and a caption", () => {
    renderStacked();
    expect(
      screen.getByRole("img", { name: "Rounds per week, by stage" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Rounds rose from 2 to 7 a week."),
    ).toBeInTheDocument();
  });

  it("has a data table whose rows match the input", () => {
    renderStacked();
    const table = screen.getByRole("table", { hidden: true });
    const headers = within(table)
      .getAllByRole("columnheader", { hidden: true })
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "Period",
      "Early stage",
      "Later stage",
      "Unknown stage",
      "Total",
    ]);
    const rows = within(table)
      .getAllByRole("row", { hidden: true })
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell", { hidden: true })
          .map((c) => c.textContent),
      );
    expect(rows).toEqual([
      ["1", "0", "1", "2"],
      ["2", "1", "0", "3"],
      ["0", "2", "0", "2"],
      ["3", "1", "1", "5"],
      ["2", "4", "1", "7"],
    ]);
    const rowHeaders = within(table)
      .getAllByRole("rowheader", { hidden: true })
      .map((h) => h.textContent);
    expect(rowHeaders).toEqual(categories.map((c) => c.label));
  });

  it("has a legend naming every stacked series", () => {
    renderStacked();
    const legend = screen.getByRole("list", { name: "Legend" });
    const items = within(legend)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["Early stage", "Later stage", "Unknown stage"]);
  });

  it("separates series by pattern as well as colour", () => {
    const { container } = renderStacked();
    const fills = new Set(
      Array.from(container.querySelectorAll("svg[role='img'] rect[fill]")).map(
        (rect) => rect.getAttribute("fill"),
      ),
    );
    expect(fills.size).toBe(3);
    const patterns = container.querySelectorAll("svg[role='img'] pattern");
    expect(patterns.length).toBe(4);
    expect(
      container.querySelectorAll(
        "svg[role='img'] pattern line, svg[role='img'] pattern circle",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows x labels only on every nth column", () => {
    renderStacked();
    expect(screen.getByText("6 Oct")).toBeInTheDocument();
    expect(screen.getByText("20 Oct")).toBeInTheDocument();
    expect(screen.queryByText("13 Oct")).toBeNull();
  });

  it("has no legend for a single series", () => {
    render(
      <ColumnChart
        title="Rounds per week"
        summary="Summary."
        categories={categories}
        series={[{ key: "all", label: "All rounds", values: [1, 2, 3, 4, 5] }]}
      />,
    );
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("shows an empty state for no data and for all zeros", () => {
    const { container, rerender } = render(
      <ColumnChart
        title="Rounds"
        summary="No rounds yet."
        categories={[]}
        series={[]}
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    rerender(
      <ColumnChart
        title="Rounds"
        summary="No rounds yet."
        categories={categories}
        series={[{ key: "a", label: "A", values: [0, 0, 0, 0, 0] }]}
      />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("never outputs NaN", () => {
    const { container } = renderStacked();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("BarChart", () => {
  const items = [
    { label: "Example Ventures", value: 12 },
    { label: "Sample Capital", value: 7 },
    { label: "No Deals Ltd", value: 0 },
  ];

  it("has an accessible name, caption and matching data table", () => {
    render(
      <BarChart
        title="Top investors by rounds led"
        summary="Example Ventures led the most rounds."
        items={items}
        valueLabel="Rounds led"
      />,
    );
    expect(
      screen.getByRole("img", { name: "Top investors by rounds led" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Example Ventures led the most rounds."),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { hidden: true });
    const rows = within(table)
      .getAllByRole("row", { hidden: true })
      .slice(1)
      .map((row) => [
        within(row).getByRole("rowheader", { hidden: true }).textContent,
        within(row).getByRole("cell", { hidden: true }).textContent,
      ]);
    expect(rows).toEqual([
      ["Example Ventures", "12"],
      ["Sample Capital", "7"],
      ["No Deals Ltd", "0"],
    ]);
  });

  it("shows an empty state instead of an empty SVG", () => {
    const { container } = render(
      <BarChart title="Investors" summary="None yet." items={[]} />,
    );
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not break when every value is zero", () => {
    const { container } = render(
      <BarChart
        title="Investors"
        summary="All zero."
        items={[{ label: "A", value: 0 }]}
      />,
    );
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("chart files", () => {
  it("contain no client component directive", () => {
    for (const file of [
      "chart-figure.tsx",
      "sparkline.tsx",
      "column-chart.tsx",
      "bar-chart.tsx",
    ]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/["']use client["']/);
    }
  });
});
