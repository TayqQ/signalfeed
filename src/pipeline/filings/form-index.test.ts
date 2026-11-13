import { describe, expect, it } from "vitest";
import { accessionFromFileName, formDRows, parseFormIndex } from "./form-index";
import { readEdgarFixture } from "./testing";

describe("parseFormIndex", () => {
  const rows = parseFormIndex(readEdgarFixture("form-index.idx"));

  it("skips the header block and reads every row", () => {
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({
      formType: "1-A/A",
      companyName: "Example Screen Works, Inc",
      cik: "1999101",
      dateFiled: "2026-11-10",
      fileName: "edgar/data/1999101/0001999101-26-000011.txt",
    });
  });

  it("keeps wide company names whole", () => {
    const wide = rows.find((row) => row.cik === "1999104");
    expect(wide?.companyName).toBe(
      "Example Cedar Series 7, a Series of Example Master LLC",
    );
  });

  it("keeps digits inside a company name", () => {
    const line = `D                Fund 20261110 Holdings 2                                       123456      20261110    edgar/data/123456/0000123456-26-000001.txt`;
    const text = `x\n${"-".repeat(40)}\n${line}\n`;
    expect(parseFormIndex(text)[0]).toMatchObject({
      companyName: "Fund 20261110 Holdings 2",
      cik: "123456",
    });
  });

  it("returns nothing when there is no dashed line", () => {
    expect(parseFormIndex("just text\n")).toEqual([]);
  });
});

describe("formDRows", () => {
  it("keeps D and D/A, and not look-alike types", () => {
    const kept = formDRows(parseFormIndex(readEdgarFixture("form-index.idx")));
    expect(kept.map((row) => row.formType)).toEqual([
      "D",
      "D",
      "D",
      "D/A",
      "D/A",
    ]);
  });
});

describe("accessionFromFileName", () => {
  it("reads the accession number", () => {
    expect(
      accessionFromFileName("edgar/data/1999001/0001999001-26-000001.txt"),
    ).toBe("0001999001-26-000001");
  });
  it("returns null for other shapes", () => {
    expect(accessionFromFileName("edgar/data/1/notes.txt")).toBeNull();
  });
});
