import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ThemeSummary, WeeklyPoint } from "@/core/read-models";
import { describeWeeklyChange, ThemeHeader } from "./theme-header";

const summary: ThemeSummary = {
  slug: "climate-fintech",
  name: "Climate fintech",
  sector: "financial-services",
  nameIsReviewed: false,
  companyCount: 4,
  tagCount: 2,
};

describe("ThemeHeader", () => {
  it("marks an unreviewed name as suggested", () => {
    render(<ThemeHeader summary={summary} tags={[]} />);
    expect(screen.getByText("Suggested name")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Climate fintech",
    );
    expect(screen.getByText("Financial services")).toBeInTheDocument();
  });

  it("does not mark a reviewed name", () => {
    render(
      <ThemeHeader summary={{ ...summary, nameIsReviewed: true }} tags={[]} />,
    );
    expect(screen.queryByText("Suggested name")).not.toBeInTheDocument();
  });
});

function weeks(counts: number[]): WeeklyPoint[] {
  return counts.map((rounds, i) => ({
    weekStart: `2026-01-${String(5 + i).padStart(2, "0")}`,
    rounds,
    earlyRounds: rounds,
    laterRounds: 0,
    unknownStageRounds: 0,
    totalGbpMinor: 0,
  }));
}

describe("describeWeeklyChange", () => {
  it("compares the last 13 weeks with the 13 before", () => {
    const counts: number[] = Array.from({ length: 26 }, () => 0);
    counts[0] = 1;
    counts[13] = 1;
    counts[14] = 1;
    expect(describeWeeklyChange("X", weeks(counts))).toBe(
      "Rounds in X: 2 rounds in the last 13 weeks, up from 1 round in the 13 weeks before.",
    );
  });

  it("says so when there are no rounds", () => {
    expect(describeWeeklyChange("X", weeks([0, 0]))).toContain("No rounds");
  });
});
