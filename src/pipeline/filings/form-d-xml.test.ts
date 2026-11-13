import { describe, expect, it } from "vitest";
import { FormDParseError, parseFormD } from "./form-d-xml";
import { EDGAR_FIXTURE_FILINGS, readEdgarFixture } from "./testing";

const INVENTED_NAMES = [
  "Example Person One",
  "Example Person Two",
  "Example Person Three",
  "Example Person Four",
  "Example Person Five",
  "Person One",
  "Person Two",
  "Person Three",
  "Person Four",
  "Person Five",
];

function parse(
  file: string,
  key: keyof typeof EDGAR_FIXTURE_FILINGS,
  xml = readEdgarFixture(file),
) {
  return parseFormD(xml, {
    accessionNumber: EDGAR_FIXTURE_FILINGS[key].accession,
    filedOn: "2026-11-10",
  });
}

describe("parseFormD", () => {
  it("parses the company fixture", () => {
    const { facts, isFund, previousAccessionNumber } = parse(
      "form-d-company.xml",
      "company",
    );
    expect(isFund).toBe(false);
    expect(previousAccessionNumber).toBeNull();
    expect(facts).toEqual({
      accessionNumber: "0001999001-26-000001",
      cik: "1999001",
      issuerName: "Example Meridian Labs, Inc.",
      entityType: "Corporation",
      issuerState: "IL",
      issuerCity: "Chicago",
      yearOfInc: 2026,
      industryGroup: "Other Technology",
      isAmendment: false,
      dateOfFirstSale: null,
      totalOfferingUsdMinor: null,
      totalSoldUsdMinor: 0,
      filedOn: "2026-11-10",
      jurisdiction: "DELAWARE",
      incOverFiveYears: false,
      previousAccessionNumber: null,
      firstSaleYetToOccur: true,
      investorCount: 0,
      securities: ["other"],
      exemptions: ["06b"],
    });
  });

  it("parses the amendment fixture", () => {
    const { facts, previousAccessionNumber } = parse(
      "form-d-amendment.xml",
      "amendment",
    );
    expect(previousAccessionNumber).toBe("0001999002-25-000001");
    expect(facts).toMatchObject({
      isAmendment: true,
      previousAccessionNumber: "0001999002-25-000001",
      yearOfInc: null,
      incOverFiveYears: true,
      dateOfFirstSale: "2024-10-04",
      firstSaleYetToOccur: false,
      totalOfferingUsdMinor: null,
      totalSoldUsdMinor: 162338200,
      investorCount: 11,
      issuerState: "A1",
      securities: ["equity"],
    });
  });

  it("flags the pooled fund", () => {
    const { facts, isFund } = parse("form-d-fund.xml", "fund");
    expect(isFund).toBe(true);
    expect(facts.industryGroup).toBe("Pooled Investment Fund");
    expect(facts.securities).toEqual(["pooled_fund"]);
    expect(facts.exemptions).toEqual(["06c", "3C", "3C.1"]);
    expect(facts.yearOfInc).toBe(2025);
  });

  it("turns whole dollars into cents", () => {
    const xml = readEdgarFixture("form-d-company.xml").replace(
      "<totalOfferingAmount>Indefinite</totalOfferingAmount>",
      "<totalOfferingAmount>4500000</totalOfferingAmount>",
    );
    expect(
      parse("form-d-company.xml", "company", xml).facts.totalOfferingUsdMinor,
    ).toBe(450000000);
  });

  it("maps the other security flags and ignores unknown ones", () => {
    const xml = readEdgarFixture("form-d-company.xml").replace(
      "<isOtherType>true</isOtherType>",
      "<isDebtType>true</isDebtType><isOptionToAcquireType>true</isOptionToAcquireType><isSecurityToBeAcquiredType>true</isSecurityToBeAcquiredType><isMineralPropertyType>false</isMineralPropertyType><isFutureType>true</isFutureType>",
    );
    expect(
      parse("form-d-company.xml", "company", xml).facts.securities,
    ).toEqual(["debt", "option", "acquired_security"]);
  });

  it("copes with other yearOfInc shapes", () => {
    const base = readEdgarFixture("form-d-company.xml");
    const withYear = (inner: string) =>
      base.replace(
        /<yearOfInc>[\s\S]*?<\/yearOfInc>/,
        `<yearOfInc>${inner}</yearOfInc>`,
      );
    const facts = (xml: string) =>
      parse("form-d-company.xml", "company", xml).facts;
    expect(facts(withYear("2024")).yearOfInc).toBe(2024);
    expect(
      facts(withYear("<yetToBeFormed>true</yetToBeFormed>")),
    ).toMatchObject({ yearOfInc: null, incOverFiveYears: false });
    expect(facts(withYear("<value></value>")).yearOfInc).toBeNull();
    expect(
      facts(base.replace(/<yearOfInc>[\s\S]*?<\/yearOfInc>/, "")).yearOfInc,
    ).toBeNull();
  });

  it("rejects XML that is not a Form D", () => {
    expect(() =>
      parseFormD("<a><b/></a>", {
        accessionNumber: "x",
        filedOn: "2026-01-01",
      }),
    ).toThrow(FormDParseError);
  });

  it("never returns a person's name or address", () => {
    for (const [file, key] of [
      ["form-d-company.xml", "company"],
      ["form-d-amendment.xml", "amendment"],
      ["form-d-fund.xml", "fund"],
    ] as const) {
      const xml = readEdgarFixture(file);
      // The fixtures really do contain names, so the test can fail.
      expect(INVENTED_NAMES.some((name) => xml.includes(name))).toBe(true);
      const output = JSON.stringify(parse(file, key));
      for (const name of INVENTED_NAMES) {
        expect(output).not.toContain(name);
      }
      expect(output).not.toMatch(/Example Street|Example Ave|street1/i);
    }
  });
});
