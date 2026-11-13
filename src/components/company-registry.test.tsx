import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CompaniesHouseView } from "@/core/read-models";
import { CompanyRegistry, registryStatusFact } from "./company-registry";

const ch: CompaniesHouseView = {
  companyNumber: "12345678",
  url: "https://find-and-update.company-information.service.gov.uk/company/12345678",
  name: "ACME LTD",
  statusLabel: "Active",
  typeLabel: "Private limited company",
  incorporatedOn: "2021-04-12",
  ceasedOn: null,
  sicCodes: [
    { code: "62012", label: "Business and domestic software development" },
    { code: "99999", label: null },
  ],
  sizeBand: "small",
  accountsMadeUpTo: "2025-03-31",
  officeOutcode: "LS1",
};

describe("CompanyRegistry", () => {
  it("renders every Companies House field", () => {
    render(<CompanyRegistry registry={{ companiesHouse: ch, sec: null }} />);
    expect(screen.getByRole("heading", { name: "Registry" })).toBeVisible();
    expect(screen.getByRole("link", { name: "12345678" })).toHaveAttribute(
      "href",
      ch.url,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Private limited company")).toBeInTheDocument();
    expect(screen.getByText("12 Apr 2021")).toBeInTheDocument();
    expect(
      screen.getByText("62012, Business and domestic software development"),
    ).toBeInTheDocument();
    expect(screen.getByText("99999")).toBeInTheDocument();
    expect(
      screen.getByText("Small (accounts made up to 31 Mar 2025)"),
    ).toBeInTheDocument();
    expect(screen.getByText("LS1")).toBeInTheDocument();
    expect(screen.getByText("Source: Companies House")).toBeInTheDocument();
    expect(screen.queryByText(/SEC EDGAR/)).toBeNull();
  });

  it("renders the SEC CIK linked to EDGAR", () => {
    render(
      <CompanyRegistry
        registry={{
          companiesHouse: null,
          sec: {
            cik: "1234567",
            url: "https://www.sec.gov/cgi-bin/browse-edgar?CIK=1234567",
          },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "1234567" })).toHaveAttribute(
      "href",
      "https://www.sec.gov/cgi-bin/browse-edgar?CIK=1234567",
    );
    expect(screen.getByText("Source: SEC EDGAR")).toBeInTheDocument();
    expect(screen.queryByText(/Companies House/)).toBeNull();
  });

  it("omits the office row without a district", () => {
    render(
      <CompanyRegistry
        registry={{
          companiesHouse: { ...ch, officeOutcode: null },
          sec: null,
        }}
      />,
    );
    expect(screen.queryByText("Registered office")).toBeNull();
  });

  it("renders nothing when there is no link", () => {
    const { container } = render(
      <CompanyRegistry registry={{ companiesHouse: null, sec: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
    const none = render(<CompanyRegistry registry={null} />);
    expect(none.container).toBeEmptyDOMElement();
  });
});

describe("registryStatusFact", () => {
  it("is null for active and missing records", () => {
    expect(registryStatusFact(null)).toBeNull();
    expect(registryStatusFact({ companiesHouse: ch, sec: null })).toBeNull();
  });

  it("gives the dissolved date", () => {
    expect(
      registryStatusFact({
        companiesHouse: {
          ...ch,
          statusLabel: "Dissolved",
          ceasedOn: "2026-05-03",
        },
        sec: null,
      }),
    ).toBe("Dissolved on 3 May 2026");
  });

  it("shows an insolvency status as given", () => {
    expect(
      registryStatusFact({
        companiesHouse: { ...ch, statusLabel: "In Administration" },
        sec: null,
      }),
    ).toBe("In Administration");
  });
});
