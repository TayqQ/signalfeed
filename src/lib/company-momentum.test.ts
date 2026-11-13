import { describe, expect, it } from "vitest";
import {
  type MomentumRoundInput,
  computeRoundMomentum,
  isEquityRound,
  monthsBetween,
  roundsInLastMonths,
  subtractMonths,
} from "./company-momentum";

const MILLION_GBP = 100_000_000;

// The company in spec section 8.3.
const SPEC_ROUNDS: MomentumRoundInput[] = [
  {
    eventId: 11,
    announcedOn: "2025-03-10",
    datePrecision: "day",
    roundType: "seed",
    amountGbpMinor: 1.5 * MILLION_GBP,
  },
  {
    eventId: 12,
    announcedOn: "2026-01-20",
    datePrecision: "day",
    roundType: "seed",
    amountGbpMinor: null,
  },
  {
    eventId: 13,
    announcedOn: "2026-04-02",
    datePrecision: "day",
    roundType: "debt",
    amountGbpMinor: 2 * MILLION_GBP,
  },
  {
    eventId: 14,
    announcedOn: "2026-09-05",
    datePrecision: "day",
    roundType: "series_a",
    amountGbpMinor: 8 * MILLION_GBP,
  },
];

function round(
  eventId: number,
  announcedOn: string,
  amountGbpMinor: number | null = null,
  overrides: Partial<MomentumRoundInput> = {},
): MomentumRoundInput {
  return {
    eventId,
    announcedOn,
    datePrecision: "day",
    roundType: "seed",
    amountGbpMinor,
    ...overrides,
  };
}

describe("computeRoundMomentum: spec section 8.3", () => {
  const result = computeRoundMomentum(SPEC_ROUNDS);

  it("gives exactly the table's values and ignores the debt round", () => {
    expect(result).toEqual([
      {
        eventId: 11,
        equityRoundNumber: 1,
        previousEventId: null,
        monthsSincePrevious: null,
        stepUpRatio: null,
        stepUpBasisEventId: null,
        stepUpBasisOn: null,
        roundsIn24mToDate: 1,
      },
      {
        eventId: 12,
        equityRoundNumber: 2,
        previousEventId: 11,
        monthsSincePrevious: 10,
        stepUpRatio: null,
        stepUpBasisEventId: null,
        stepUpBasisOn: null,
        roundsIn24mToDate: 2,
      },
      {
        eventId: 14,
        equityRoundNumber: 3,
        previousEventId: 12,
        monthsSincePrevious: 7,
        stepUpRatio: 8 / 1.5,
        stepUpBasisEventId: 11,
        stepUpBasisOn: "2025-03-10",
        roundsIn24mToDate: 3,
      },
    ]);
  });

  it("shows the step-up as 5.3 to one decimal", () => {
    expect(result[2]?.stepUpRatio?.toFixed(1)).toBe("5.3");
  });

  it("gives the same output for shuffled input", () => {
    const orders = [
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2],
    ];
    for (const order of orders) {
      const shuffled = order.map((i) => SPEC_ROUNDS[i] as MomentumRoundInput);
      expect(computeRoundMomentum(shuffled)).toEqual(result);
    }
  });

  it("counts 3 equity rounds in the 24 months to 2026-11-11", () => {
    expect(roundsInLastMonths(SPEC_ROUNDS, "2026-11-11", 24)).toBe(3);
    expect(
      roundsInLastMonths(SPEC_ROUNDS, new Date("2026-11-11T09:00:00Z")),
    ).toBe(3);
  });
});

describe("computeRoundMomentum: rules", () => {
  it("orders rounds on the same date by event id", () => {
    const result = computeRoundMomentum([
      round(9, "2026-05-01", 4 * MILLION_GBP),
      round(3, "2026-05-01", 2 * MILLION_GBP),
    ]);
    expect(result.map((r) => [r.eventId, r.equityRoundNumber])).toEqual([
      [3, 1],
      [9, 2],
    ]);
    expect(result[1]?.monthsSincePrevious).toBe(0);
    expect(result[1]?.stepUpRatio).toBe(2);
  });

  it("skips grants and counts unknown round types as equity", () => {
    expect(isEquityRound("grant")).toBe(false);
    expect(isEquityRound("debt")).toBe(false);
    expect(isEquityRound("unknown")).toBe(true);
    const result = computeRoundMomentum([
      round(1, "2025-01-01", null, { roundType: "grant" }),
      round(2, "2025-06-01", null, { roundType: "unknown" }),
    ]);
    expect(result.map((r) => r.eventId)).toEqual([2]);
  });

  it("gives a null step-up for a zero or missing amount", () => {
    const missing = computeRoundMomentum([
      round(1, "2025-01-10", MILLION_GBP),
      round(2, "2025-06-10", null),
    ]);
    expect(missing[1]?.stepUpRatio).toBeNull();
    const zeroNow = computeRoundMomentum([
      round(1, "2025-01-10", MILLION_GBP),
      round(2, "2025-06-10", 0),
    ]);
    expect(zeroNow[1]?.stepUpRatio).toBeNull();
    const zeroBasis = computeRoundMomentum([
      round(1, "2025-01-10", 0),
      round(2, "2025-06-10", MILLION_GBP),
    ]);
    expect(zeroBasis[1]?.stepUpRatio).toBeNull();
    expect(zeroBasis[1]?.stepUpBasisEventId).toBeNull();
  });

  it("allows a basis exactly 36 months back but not older", () => {
    const within = computeRoundMomentum([
      round(1, "2023-09-05", MILLION_GBP),
      round(2, "2026-09-05", 3 * MILLION_GBP),
    ]);
    expect(within[1]?.stepUpRatio).toBe(3);
    const older = computeRoundMomentum([
      round(1, "2023-09-04", MILLION_GBP),
      round(2, "2026-09-05", 3 * MILLION_GBP),
    ]);
    expect(older[1]?.stepUpRatio).toBeNull();
    expect(older[1]?.stepUpBasisOn).toBeNull();
  });

  it("does not look past the latest earlier round with an amount", () => {
    // The latest round with an amount is too old, so an even older one is not used.
    const result = computeRoundMomentum([
      round(1, "2021-01-01", 5 * MILLION_GBP),
      round(2, "2022-01-01", MILLION_GBP),
      round(3, "2026-01-01", 2 * MILLION_GBP),
    ]);
    expect(result[2]?.stepUpRatio).toBeNull();
  });

  it("counts rounds in the 24 months up to and including this round", () => {
    const result = computeRoundMomentum([
      round(1, "2023-06-30"),
      round(2, "2023-07-01"),
      round(3, "2024-01-01"),
      round(4, "2025-07-01"),
    ]);
    expect(result.map((r) => r.roundsIn24mToDate)).toEqual([1, 2, 3, 3]);
  });
});

describe("monthsBetween", () => {
  const day = (announcedOn: string) =>
    ({ announcedOn, datePrecision: "day" }) as const;
  const month = (announcedOn: string) =>
    ({ announcedOn, datePrecision: "month" }) as const;
  const year = (announcedOn: string) =>
    ({ announcedOn, datePrecision: "year" }) as const;

  it("takes a month off when this round's day is earlier", () => {
    expect(monthsBetween(day("2026-01-20"), day("2026-09-05"))).toBe(7);
    expect(monthsBetween(day("2026-01-20"), day("2026-09-20"))).toBe(8);
  });

  it("ignores days when either date has month precision", () => {
    expect(monthsBetween(day("2026-01-20"), month("2026-09-01"))).toBe(8);
    expect(monthsBetween(month("2026-01-01"), day("2026-09-05"))).toBe(8);
  });

  it("is null when either date has year precision", () => {
    expect(monthsBetween(year("2025-01-01"), day("2026-09-05"))).toBeNull();
    expect(monthsBetween(day("2025-03-10"), year("2026-01-01"))).toBeNull();
  });

  it("is 0 for equal dates", () => {
    expect(monthsBetween(day("2026-09-05"), day("2026-09-05"))).toBe(0);
  });

  it("gives null months since previous for a year-precision round", () => {
    const result = computeRoundMomentum([
      round(1, "2025-03-10"),
      round(2, "2026-01-01", null, { datePrecision: "year" }),
    ]);
    expect(result[1]?.monthsSincePrevious).toBeNull();
    expect(result[1]?.equityRoundNumber).toBe(2);
  });
});

describe("subtractMonths", () => {
  it("keeps the day of the month", () => {
    expect(subtractMonths("2026-09-05", 36)).toBe("2023-09-05");
    expect(subtractMonths("2026-01-20", 1)).toBe("2025-12-20");
  });

  it("clamps to the end of a shorter month", () => {
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(subtractMonths("2028-03-31", 1)).toBe("2028-02-29");
  });
});

describe("roundsInLastMonths", () => {
  it("excludes rounds after the date, before the window, and debt or grants", () => {
    const rounds = [
      round(1, "2024-11-10"),
      round(2, "2024-11-11"),
      round(3, "2025-05-01", null, { roundType: "debt" }),
      round(4, "2025-06-01", null, { roundType: "grant" }),
      round(5, "2026-11-11"),
      round(6, "2026-11-12"),
    ];
    expect(roundsInLastMonths(rounds, "2026-11-11", 24)).toBe(2);
  });
});
