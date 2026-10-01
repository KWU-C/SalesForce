import { describe, expect, it } from "vitest";
import {
  closingMonthOf,
  closingMonthRange,
  describeAttendancePeriod,
  resolveAttendancePeriod,
  rollingRange,
  selectableClosingMonths,
  todayInJapan,
} from "./attendancePeriod";

describe("todayInJapan", () => {
  it("uses Japan time, not UTC (the date flips at 15:00 UTC)", () => {
    expect(todayInJapan(new Date("2026-09-30T14:59:00Z"))).toBe("2026-09-30");
    expect(todayInJapan(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10-01");
  });
});

describe("rollingRange", () => {
  it("covers the 28 days ending yesterday", () => {
    expect(rollingRange("2026-10-01")).toEqual({ start: "2026-09-03", end: "2026-09-30" });
  });
});

describe("closingMonthOf / closingMonthRange", () => {
  it("assigns days up to the 20th to that month and later days to the next month", () => {
    expect(closingMonthOf("2026-09-20")).toEqual({ year: 2026, month: 9 });
    expect(closingMonthOf("2026-09-21")).toEqual({ year: 2026, month: 10 });
    expect(closingMonthOf("2026-12-21")).toEqual({ year: 2027, month: 1 });
  });

  it("spans from the 21st of the previous month to the 20th", () => {
    expect(closingMonthRange({ year: 2026, month: 10 })).toEqual({ start: "2026-09-21", end: "2026-10-20" });
    expect(closingMonthRange({ year: 2027, month: 1 })).toEqual({ start: "2026-12-21", end: "2027-01-20" });
  });
});

describe("selectableClosingMonths", () => {
  it("offers the previous and current closing months, oldest first", () => {
    expect(selectableClosingMonths("2026-10-01").map((o) => [o.key, o.label])).toEqual([
      ["2026-09", "9月度（8/21〜9/20）"],
      ["2026-10", "10月度（9/21〜10/20）"],
    ]);
  });
});

describe("resolveAttendancePeriod", () => {
  it("falls back to the rolling period for a missing or non-selectable key", () => {
    expect(resolveAttendancePeriod(undefined, "2026-10-01")).toEqual({ kind: "rolling" });
    expect(resolveAttendancePeriod("2025-01", "2026-10-01")).toEqual({ kind: "rolling" });
    expect(resolveAttendancePeriod("abc", "2026-10-01")).toEqual({ kind: "rolling" });
  });

  it("resolves a selectable closing month", () => {
    expect(resolveAttendancePeriod("2026-09", "2026-10-01")).toEqual({ kind: "closingMonth", year: 2026, month: 9 });
  });
});

describe("describeAttendancePeriod", () => {
  it("labels the rolling period and closing months", () => {
    expect(describeAttendancePeriod({ kind: "rolling" }, "2026-10-01")).toEqual({
      title: "過去28日間",
      rangeLabel: "9/3〜9/30",
    });
    expect(describeAttendancePeriod({ kind: "closingMonth", year: 2026, month: 10 }, "2026-10-01")).toEqual({
      title: "10月度",
      rangeLabel: "9/21〜10/20",
    });
  });
});
