import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AcquisitionRow } from "@/core/read-models";
import {
  AcquisitionsSummary,
  AcquisitionsTable,
  describeTargetAge,
  summariseAcquisitions,
} from "./acquisitions-table";

function row(overrides: Partial<AcquisitionRow> = {}): AcquisitionRow {
  return {
    eventId: 1,
    target: { slug: "tiny-co", name: "Tiny Co" },
    acquirer: { slug: "big-corp", name: "Big Corp" },
    acquirerName: "Big Corp",
    price: null,
    priceGbpMinor: null,
    announcedOn: "2026-03-14",
    datePrecision: "day",
    targetAgeYears: 6,
    themes: [],
    ...overrides,
  };
}

describe("AcquisitionsTable", () => {
  it("writes 'Around' for month precision", () => {
    render(
      <AcquisitionsTable
        rows={[row({ announcedOn: "2026-03-01", datePrecision: "month" })]}
        filtered={false}
      />,
    );
    expect(screen.getByText("Around Mar 2026")).toBeInTheDocument();
  });

  it("shows a full date for day precision", () => {
    render(<AcquisitionsTable rows={[row()]} filtered={false} />);
    expect(screen.getByText("14 Mar 2026")).toBeInTheDocument();
  });

  it("says unknown when the age is not known", () => {
    render(
      <AcquisitionsTable
        rows={[row({ targetAgeYears: null })]}
        filtered={false}
      />,
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows the raw acquirer name without a link when unresolved", () => {
    render(
      <AcquisitionsTable
        rows={[row({ acquirer: null, acquirerName: "Mystery Holdings" })]}
        filtered={false}
      />,
    );
    expect(screen.getByText("Mystery Holdings")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mystery Holdings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tiny Co" })).toHaveAttribute(
      "href",
      "/companies/tiny-co",
    );
  });

  it("shows GBP price when known and says not disclosed otherwise", () => {
    render(
      <AcquisitionsTable
        rows={[
          row({ eventId: 1, priceGbpMinor: 1_200_000_000 }),
          row({ eventId: 2 }),
        ]}
        filtered={false}
      />,
    );
    expect(screen.getByText("£12M")).toBeInTheDocument();
    expect(screen.getByText("Not disclosed")).toBeInTheDocument();
  });

  it("shows the empty state, and a reset link when filtered", () => {
    const { rerender } = render(<AcquisitionsTable rows={[]} filtered />);
    expect(
      screen.getByText("No acquisitions match these filters"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "reset them" })).toHaveAttribute(
      "href",
      "/acquisitions",
    );
    rerender(<AcquisitionsTable rows={[]} filtered={false} />);
    expect(screen.getByText("No acquisitions yet")).toBeInTheDocument();
  });
});

describe("summary", () => {
  const rows = [
    row({ eventId: 1, targetAgeYears: 4 }),
    row({ eventId: 2, targetAgeYears: 6 }),
    row({ eventId: 3, targetAgeYears: 8 }),
    row({
      eventId: 4,
      targetAgeYears: null,
      acquirer: null,
      acquirerName: "Other Ltd",
    }),
  ];

  it("gives the median with coverage", () => {
    expect(describeTargetAge(summariseAcquisitions(rows))).toBe(
      "Median target age 6 years (age known for 3 of 4)",
    );
  });

  it("gives no median with fewer than 3 known ages", () => {
    expect(describeTargetAge(summariseAcquisitions(rows.slice(0, 2)))).toBe(
      "Too few known ages for a median (age known for 2 of 2)",
    );
  });

  it("counts top acquirers", () => {
    expect(summariseAcquisitions(rows).topAcquirers).toEqual([
      { name: "Big Corp", count: 3 },
      { name: "Other Ltd", count: 1 },
    ]);
  });

  it("renders the median line and price coverage", () => {
    render(<AcquisitionsSummary summary={summariseAcquisitions(rows)} />);
    expect(
      screen.getByText("Median target age 6 years (age known for 3 of 4)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Price known for 0 of 4/)).toBeInTheDocument();
  });
});
