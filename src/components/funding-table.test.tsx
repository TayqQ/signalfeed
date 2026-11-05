import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FundingFilters, FundingRow, Page } from "@/core/read-models";
import { FundingTable } from "./funding-table";
import { amountBarPercent } from "./round-amount";

function row(overrides: Partial<FundingRow> = {}): FundingRow {
  return {
    eventId: 1,
    companySlug: "acme",
    companyName: "Acme",
    countryCode: "GB",
    city: "Leeds",
    roundType: "seed",
    roundLabel: null,
    amount: { amountMinor: 500_000_000, currency: "USD" },
    amountGbpMinor: 400_000_000,
    amountUsdMinor: 500_000_000,
    announcedOn: "2026-06-01",
    leadInvestors: [{ slug: "example", name: "Example Ventures" }],
    investorCount: 1,
    sourceCount: 3,
    tags: [],
    ...overrides,
  };
}

const filters: FundingFilters = { page: 1, pageSize: 25, tag: "robotics" };

function page(items: FundingRow[]): Page<FundingRow> {
  return { items, total: items.length, page: 1, pageSize: 25 };
}

describe("FundingTable", () => {
  it("shows GBP with the original amount when they differ", () => {
    render(<FundingTable page={page([row()])} filters={filters} />);
    expect(screen.getByText("£4M")).toBeInTheDocument();
    expect(screen.getByText("US$5M")).toBeInTheDocument();
  });

  it("shows one figure when the round was reported in GBP", () => {
    render(
      <FundingTable
        page={page([
          row({
            amount: { amountMinor: 400_000_000, currency: "GBP" },
            amountGbpMinor: 400_000_000,
          }),
        ])}
        filters={filters}
      />,
    );
    expect(screen.getAllByText("£4M")).toHaveLength(1);
  });

  it("links to company and investor pages", () => {
    render(<FundingTable page={page([row()])} filters={filters} />);
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "/companies/acme",
    );
    expect(
      screen.getByRole("link", { name: "Example Ventures" }),
    ).toHaveAttribute("href", "/investors/example");
  });

  it("says when an amount and leads were not reported", () => {
    render(
      <FundingTable
        page={page([
          row({ amount: null, amountGbpMinor: null, leadInvestors: [] }),
        ])}
        filters={filters}
      />,
    );
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    expect(screen.queryByTestId("amount-bar")).toBeNull();
  });

  it("shows an empty state with a reset link", () => {
    render(<FundingTable page={page([])} filters={filters} />);
    expect(
      screen.getByText("No rounds match these filters"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "reset them" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("explains an empty database rather than blaming the filters", () => {
    render(
      <FundingTable page={page([])} filters={{ page: 1, pageSize: 25 }} />,
    );
    expect(screen.getByText("No funding rounds yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "status page" })).toHaveAttribute(
      "href",
      "/status",
    );
  });

  it("keeps the current filters on sort links and toggles direction", () => {
    render(
      <FundingTable
        page={page([row()])}
        filters={{ ...filters, sort: "amount", direction: "desc" }}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Amount/ });
    const href = within(header).getByRole("link").getAttribute("href") ?? "";
    expect(href).toContain("tag=robotics");
    expect(href).toContain("sort=amount");
    expect(href).toContain("dir=asc");
  });
});

describe("amountBarPercent", () => {
  it("is logarithmic and bounded", () => {
    expect(amountBarPercent(100_000_000_000)).toBe(100);
    expect(amountBarPercent(10_000_000)).toBe(33);
    expect(amountBarPercent(1)).toBe(3);
    expect(amountBarPercent(10 ** 15)).toBe(100);
  });
});
