import { describe, expect, it } from "vitest";
import {
  addWeeks,
  lastCompleteWeek,
  toIsoDate,
  weekRange,
  weekStart,
  weeksBetween,
} from "./weeks";

describe("weekStart", () => {
  it("returns the Monday of the week", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // Monday
  });

  it("puts a Sunday in the week that started six days before", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
  });

  it("handles year boundaries", () => {
    expect(weekStart("2026-12-31")).toBe("2026-12-28");
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
    expect(weekStart("2027-01-04")).toBe("2027-01-04");
  });

  it("uses the UTC day of a Date or timestamp", () => {
    expect(weekStart(new Date("2026-11-15T23:59:59Z"))).toBe("2026-11-09");
    expect(weekStart(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16");
    // 01:00 on Monday in UTC+02:00 is still Sunday in UTC.
    expect(weekStart("2026-11-16T01:00:00+02:00")).toBe("2026-11-09");
  });

  it("rejects invalid dates", () => {
    expect(() => weekStart("2026-02-30")).toThrow(RangeError);
    expect(() => weekStart("not a date")).toThrow(RangeError);
  });
});

describe("addWeeks", () => {
  it("moves whole weeks forwards and back across years", () => {
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
    expect(addWeeks("2027-01-04", -1)).toBe("2026-12-28");
    expect(addWeeks("2026-11-09", 0)).toBe("2026-11-09");
  });

  it("starts from the week of a mid-week date", () => {
    expect(addWeeks("2026-11-11", -2)).toBe("2026-10-26");
  });

  it("rejects fractional weeks", () => {
    expect(() => addWeeks("2026-11-09", 1.5)).toThrow(RangeError);
  });
});

describe("lastCompleteWeek", () => {
  it("is the week before the current one", () => {
    expect(lastCompleteWeek(new Date("2026-11-11T12:00:00Z"))).toBe(
      "2026-11-02",
    );
  });

  it("never uses the current week, even at the start of Monday", () => {
    expect(lastCompleteWeek(new Date("2026-11-16T00:00:00Z"))).toBe(
      "2026-11-09",
    );
    expect(lastCompleteWeek(new Date("2026-11-15T23:59:59Z"))).toBe(
      "2026-11-02",
    );
  });
});

describe("weekRange", () => {
  it("lists every week start inclusive, oldest first", () => {
    expect(weekRange("2026-12-21", "2027-01-04")).toEqual([
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
    ]);
  });

  it("normalises both ends to their week", () => {
    expect(weekRange("2026-12-24", "2026-12-31")).toEqual([
      "2026-12-21",
      "2026-12-28",
    ]);
  });

  it("is empty when the end is before the start", () => {
    expect(weekRange("2026-12-28", "2026-12-21")).toEqual([]);
  });
});

describe("weeksBetween and toIsoDate", () => {
  it("counts whole weeks", () => {
    expect(weeksBetween("2026-01-05", "2026-12-28")).toBe(51);
    expect(weeksBetween("2026-12-28", "2026-01-05")).toBe(-51);
  });

  it("formats the UTC day", () => {
    expect(toIsoDate(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-11");
  });
});
