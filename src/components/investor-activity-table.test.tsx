import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InvestorActivityRow } from "@/core/read-models";
import { InvestorActivityTable } from "./investor-activity-table";

function row(
  overrides: Partial<InvestorActivityRow> = {},
): InvestorActivityRow {
  return {
    investor: { slug: "example-vc", name: "Example VC" },
    led: 4,
    joined: 1,
    medianRoundGbpMinor: 200_000_000,
    roundsWithAmount: 3,
    rounds: 4,
    ...overrides,
  };
}

describe("InvestorActivityTable", () => {
  it("shows the median and its coverage", () => {
    render(<InvestorActivityTable rows={[row()]} filtered={false} />);
    expect(screen.getByText("£2M")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 with amounts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Example VC" })).toHaveAttribute(
      "href",
      "/investors/example-vc",
    );
  });

  it("says not reported when no round has an amount", () => {
    render(
      <InvestorActivityTable
        rows={[row({ medianRoundGbpMinor: null, roundsWithAmount: 0 })]}
        filtered={false}
      />,
    );
    expect(screen.getByText("Not reported")).toBeInTheDocument();
    expect(screen.getByText("0 of 4 with amounts")).toBeInTheDocument();
  });

  it("shows empty states", () => {
    const { rerender } = render(<InvestorActivityTable rows={[]} filtered />);
    expect(
      screen.getByText("No investors match these filters"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "reset the filters" }),
    ).toHaveAttribute("href", "/investors");
    rerender(<InvestorActivityTable rows={[]} filtered={false} />);
    expect(screen.getByText("No investor activity yet")).toBeInTheDocument();
  });
});
