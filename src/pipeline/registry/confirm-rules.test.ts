import { describe, expect, it } from "vitest";
import type { CapitalFiling, FormDFacts } from "@/core/registry";
import {
  allotmentConfirms,
  amountGap,
  assignRecords,
  dayNumber,
  eventAnchor,
  formDConfirms,
  isConfirmable,
  type ConfirmableEvent,
} from "./confirm-rules";

function event(overrides: Partial<ConfirmableEvent> = {}): ConfirmableEvent {
  return {
    id: 1,
    type: "funding_round",
    roundType: "seed",
    announcedOn: "2026-03-10",
    datePrecision: "day",
    amountUsdMinor: null,
    ...overrides,
  };
}

function sh01(actionDate: string | null, type = "SH01"): CapitalFiling {
  return {
    transactionId: `t-${actionDate ?? "none"}`,
    type,
    filedOn: actionDate ?? "2026-01-01",
    actionDate,
    capital: null,
  };
}

function formD(overrides: Partial<FormDFacts> = {}): FormDFacts {
  return {
    accessionNumber: "0001999999-26-000001",
    cik: "1999999",
    issuerName: "Orbital Forge, Inc.",
    entityType: "Corporation",
    issuerState: "CA",
    issuerCity: null,
    yearOfInc: null,
    industryGroup: null,
    isAmendment: false,
    dateOfFirstSale: "2026-01-05",
    totalOfferingUsdMinor: null,
    totalSoldUsdMinor: null,
    filedOn: "2026-01-16",
    ...overrides,
  };
}

const usd = (dollars: number) => dollars * 100;

describe("dates", () => {
  it("rejects invalid dates", () => {
    expect(dayNumber("2026-02-30")).toBeNull();
    expect(dayNumber("2026-2-3")).toBeNull();
    expect(dayNumber("2026-01-02")).toBe(dayNumber("2026-01-01")! + 1);
  });

  it("anchors month events on the first and refuses year events", () => {
    expect(eventAnchor(event({ datePrecision: "day" }))).toBe("2026-03-10");
    expect(
      eventAnchor(event({ announcedOn: "2026-03-15", datePrecision: "month" })),
    ).toBe("2026-03-01");
    expect(eventAnchor(event({ datePrecision: "year" }))).toBeNull();
  });

  it("confirms equity rounds only", () => {
    expect(isConfirmable(event())).toBe(true);
    expect(isConfirmable(event({ roundType: "unknown" }))).toBe(true);
    expect(isConfirmable(event({ roundType: null }))).toBe(true);
    expect(isConfirmable(event({ roundType: "debt" }))).toBe(false);
    expect(isConfirmable(event({ roundType: "grant" }))).toBe(false);
    expect(isConfirmable(event({ type: "acquisition" }))).toBe(false);
    expect(isConfirmable(event({ datePrecision: "year" }))).toBe(false);
  });
});

describe("allotmentConfirms (spec-phase3 section 9.2)", () => {
  it("C1: an SH01 36 days before a seed confirms, amount not confirmed", () => {
    expect(allotmentConfirms(event(), sh01("2026-02-02"))).toEqual({
      confirms: true,
      confirmsAmount: false,
      daysFromEvent: -36,
    });
  });

  it("C2: an SH01 190 days before does not confirm", () => {
    expect(allotmentConfirms(event(), sh01("2025-09-01")).confirms).toBe(false);
  });

  it("C6: a month event is measured from the first of the month", () => {
    const march = event({ announcedOn: "2026-03-01", datePrecision: "month" });
    expect(allotmentConfirms(march, sh01("2026-01-20"))).toEqual({
      confirms: true,
      confirmsAmount: false,
      daysFromEvent: -40,
    });
  });

  it.each([
    ["2025-11-10", true, -120],
    ["2025-11-09", false, null],
    ["2026-04-09", true, 30],
    ["2026-04-10", false, null],
  ])("window edge %s", (date, confirms, days) => {
    const result = allotmentConfirms(event(), sh01(date));
    expect(result.confirms).toBe(confirms);
    expect(result.daysFromEvent).toBe(days);
  });

  it("needs an SH01 with an allotment date", () => {
    expect(
      allotmentConfirms(event(), sh01("2026-02-02", "SH02")).confirms,
    ).toBe(false);
    expect(allotmentConfirms(event(), sh01(null)).confirms).toBe(false);
  });

  it("ignores debt, grant and year-precision events", () => {
    for (const e of [
      event({ roundType: "debt" }),
      event({ roundType: "grant" }),
      event({ datePrecision: "year", announcedOn: "2026-01-01" }),
    ]) {
      expect(allotmentConfirms(e, sh01("2026-02-02")).confirms).toBe(false);
    }
  });
});

describe("formDConfirms (spec-phase3 section 9.2)", () => {
  it("measures amounts as |a - b| / max(a, b)", () => {
    expect(amountGap(usd(4_500_000), usd(4_400_000))).toBeCloseTo(0.0222, 3);
    expect(amountGap(usd(20_000_000), usd(3_000_000))).toBeCloseTo(0.85, 3);
  });

  it("C3: first sale 44 days before, sold 2.2% apart: amount confirmed", () => {
    const result = formDConfirms(
      event({ announcedOn: "2026-02-18", amountUsdMinor: usd(4_500_000) }),
      formD({ totalSoldUsdMinor: usd(4_400_000) }),
    );
    expect(result).toEqual({
      confirms: true,
      confirmsAmount: true,
      daysFromEvent: -44,
    });
  });

  it("C4: amount agrees with the offering, not the amount sold", () => {
    const result = formDConfirms(
      event({
        roundType: "series_a",
        announcedOn: "2026-06-01",
        amountUsdMinor: usd(20_000_000),
      }),
      formD({
        dateOfFirstSale: "2026-05-10",
        totalOfferingUsdMinor: usd(20_000_000),
        totalSoldUsdMinor: usd(3_000_000),
      }),
    );
    expect(result).toEqual({
      confirms: true,
      confirmsAmount: true,
      daysFromEvent: -22,
    });
  });

  it("C5: a different offering, 85% apart, does not confirm", () => {
    const result = formDConfirms(
      event({
        roundType: "series_a",
        announcedOn: "2026-06-01",
        amountUsdMinor: usd(20_000_000),
      }),
      formD({
        dateOfFirstSale: "2026-05-10",
        totalOfferingUsdMinor: usd(3_000_000),
        totalSoldUsdMinor: usd(3_000_000),
      }),
    );
    expect(result.confirms).toBe(false);
  });

  it("confirms without the amount when 15-50% apart", () => {
    const result = formDConfirms(
      event({ announcedOn: "2026-02-18", amountUsdMinor: usd(4_000_000) }),
      formD({ totalSoldUsdMinor: usd(3_000_000) }),
    );
    expect(result).toMatchObject({ confirms: true, confirmsAmount: false });
  });

  it("confirms on the date alone when no amount is known", () => {
    expect(
      formDConfirms(event({ announcedOn: "2026-02-18" }), formD()),
    ).toMatchObject({ confirms: true, confirmsAmount: false });
    expect(
      formDConfirms(
        event({ announcedOn: "2026-02-18", amountUsdMinor: usd(1_000_000) }),
        formD(),
      ),
    ).toMatchObject({ confirms: true, confirmsAmount: false });
  });

  it.each([
    ["2025-08-22", true],
    ["2025-08-21", false],
    ["2026-04-04", true],
    ["2026-04-05", false],
  ])("window edge %s (180 before, 45 after)", (firstSale, confirms) => {
    expect(
      formDConfirms(
        event({ announcedOn: "2026-02-18" }),
        formD({ dateOfFirstSale: firstSale }),
      ).confirms,
    ).toBe(confirms);
  });

  it("needs a date of first sale", () => {
    expect(
      formDConfirms(
        event({ announcedOn: "2026-02-18" }),
        formD({ dateOfFirstSale: null }),
      ).confirms,
    ).toBe(false);
  });
});

describe("assignRecords", () => {
  it("gives each record to the nearest event only", () => {
    const seed = event({ id: 1, announcedOn: "2026-01-10" });
    const seriesA = event({
      id: 2,
      roundType: "series_a",
      announcedOn: "2026-03-10",
    });
    const result = assignRecords(
      [seed, seriesA],
      [{ kind: "ch_allotment", id: "a", filing: sh01("2026-02-25") }],
    );
    expect(result).toEqual([
      {
        eventId: 2,
        recordKind: "ch_allotment",
        recordId: "a",
        rule: "ch_allotment_window",
        recordDate: "2026-02-25",
        confirmsAmount: false,
        daysFromEvent: -13,
      },
    ]);
  });

  it("prefers the nearer event, then the lower event id", () => {
    const filing = sh01("2026-03-10");
    // 9 days after event 3 and 10 days before event 7: nearest wins.
    const nearest = assignRecords(
      [
        event({ id: 7, announcedOn: "2026-03-20" }),
        event({ id: 3, announcedOn: "2026-03-01" }),
      ],
      [{ kind: "ch_allotment", id: "x", filing }],
    );
    expect(nearest.map((a) => a.eventId)).toEqual([3]);
    // Same distance: the lower event id wins.
    const tied = assignRecords(
      [
        event({ id: 9, announcedOn: "2026-03-20" }),
        event({ id: 4, announcedOn: "2026-03-20" }),
      ],
      [{ kind: "ch_allotment", id: "y", filing }],
    );
    expect(tied.map((a) => a.eventId)).toEqual([4]);
  });

  it("lets one event take several records and skips records that fit none", () => {
    const seed = event({
      id: 1,
      announcedOn: "2026-02-18",
      amountUsdMinor: usd(4_500_000),
    });
    const result = assignRecords(
      [seed],
      [
        { kind: "ch_allotment", id: "a", filing: sh01("2026-02-02") },
        {
          kind: "sec_form_d",
          id: "d",
          filing: formD({ totalSoldUsdMinor: usd(4_400_000) }),
        },
        { kind: "ch_allotment", id: "old", filing: sh01("2024-01-01") },
      ],
    );
    expect(result.map((a) => [a.eventId, a.recordKind, a.recordId])).toEqual([
      [1, "ch_allotment", "a"],
      [1, "sec_form_d", "d"],
    ]);
    expect(result[1]).toMatchObject({
      rule: "sec_form_d_window",
      confirmsAmount: true,
      recordDate: "2026-01-05",
    });
  });
});
