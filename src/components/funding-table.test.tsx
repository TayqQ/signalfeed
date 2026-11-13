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

describe("FundingTable momentum, grants and sort links", () => {
  const momentum = (
    overrides: Partial<NonNullable<FundingRow["momentum"]>>,
  ): NonNullable<FundingRow["momentum"]> => ({
    equityRoundNumber: 3,
    monthsSincePrevious: 7,
    stepUpRatio: 5.3,
    stepUpBasisOn: "2025-03-10",
    ...overrides,
  });

  it("shows a first recorded round", () => {
    render(
      <FundingTable
        page={page([
          row({
            momentum: momentum({
              equityRoundNumber: 1,
              monthsSincePrevious: null,
              stepUpRatio: null,
              stepUpBasisOn: null,
            }),
          }),
        ])}
        filters={filters}
      />,
    );
    expect(screen.getByText("First recorded round")).toBeInTheDocument();
  });

  it("shows a repeat round with its gap and step-up", () => {
    render(
      <FundingTable
        page={page([row({ momentum: momentum({}) })])}
        filters={filters}
      />,
    );
    expect(
      screen.getByText("Round 3 · 7 months after the last · 5.3×"),
    ).toBeInTheDocument();
  });

  it("leaves out an unknown step-up", () => {
    render(
      <FundingTable
        page={page([row({ momentum: momentum({ stepUpRatio: null }) })])}
        filters={filters}
      />,
    );
    expect(
      screen.getByText("Round 3 · 7 months after the last"),
    ).toBeInTheDocument();
  });

  it("shows a grant badge and the UKRI source", () => {
    render(
      <FundingTable
        page={page([row({ roundType: "grant", momentum: null })])}
        filters={filters}
      />,
    );
    expect(screen.getByText("Grant")).toBeInTheDocument();
    expect(screen.getByText("Source: UKRI")).toBeInTheDocument();
    expect(screen.getByText("Not applicable to grants")).toBeInTheDocument();
  });

  it("keeps the targeting filters in sort links", () => {
    render(
      <FundingTable
        page={page([row()])}
        filters={{
          page: 1,
          pageSize: 25,
          near: { placeSlug: "leeds", km: 50 },
          sectors: ["health-life-sciences"],
          themes: ["ai-agents"],
          momentum: "first",
        }}
      />,
    );
    const href = screen
      .getByRole("link", { name: /Amount/ })
      .getAttribute("href");
    expect(href).toBeTruthy();
    const params = new URLSearchParams((href ?? "").split("?")[1]);
    expect(params.get("near")).toBe("leeds");
    expect(params.get("km")).toBe("50");
    expect(params.get("sector")).toBe("health-life-sciences");
    expect(params.get("theme")).toBe("ai-agents");
    expect(params.get("momentum")).toBe("first");
    expect(params.get("sort")).toBe("amount");
  });

  it("shows the Confirmed marker only on confirmed rows", () => {
    const text =
      "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)";
    render(
      <FundingTable
        page={page([
          row({
            eventId: 1,
            confirmation: {
              kind: "ch_allotment",
              recordDate: "2026-02-02",
              confirmsAmount: false,
              text,
            },
          }),
          row({ eventId: 2, companySlug: "beta", companyName: "Beta" }),
        ])}
        filters={filters}
      />,
    );
    expect(screen.getAllByRole("note")).toHaveLength(1);
    expect(screen.getByRole("note", { name: text })).toHaveTextContent(
      "Confirmed",
    );
  });
});
