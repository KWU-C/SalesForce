import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/attendanceCategory", () => ({
  ATTENDANCE_EXCLUDED_NAMES: ["山田 崇雄"],
  ATTENDANCE_SHORT_HOURS_NAMES: ["能登 愛"],
  ATTENDANCE_CLERICAL_NAMES: ["牛尾 郁美"],
}));

const { classifyAttendanceMember, buildAttendanceRow, buildAttendanceSection, isOvertimeAvgAlert } = await import("./attendance");

describe("classifyAttendanceMember", () => {
  it("classifies excluded/shortHours/clerical members by exact name match", () => {
    expect(classifyAttendanceMember("山田 崇雄")).toBe("excluded");
    expect(classifyAttendanceMember("能登 愛")).toBe("shortHours");
    expect(classifyAttendanceMember("牛尾 郁美")).toBe("clerical");
  });

  it("classifies anyone not in the lists as target", () => {
    expect(classifyAttendanceMember("竹本 晃")).toBe("target");
  });

  it("normalizes whitespace differences (full-width space, extra spaces) before matching", () => {
    expect(classifyAttendanceMember("山田　崇雄")).toBe("excluded"); // 全角スペース
    expect(classifyAttendanceMember("  山田  崇雄  ")).toBe("excluded"); // 前後・連続半角スペース
  });
});

describe("buildAttendanceRow", () => {
  it("computes overtimeHours, totalWorkHours, and overtimeAvgPerDay from raw minutes", () => {
    const row = buildAttendanceRow({ name: "竹本 晃", workDays: 20, totalWorkMins: 191 * 60 + 43, normalWorkMins: 159 * 60 + 48 });
    expect(row).not.toBeNull();
    expect(row!.overtimeHours).toBeCloseTo(31 + 55 / 60, 2); // 191:43 - 159:48 = 31:55
    expect(row!.totalWorkHours).toBeCloseTo(191 + 43 / 60, 2);
    expect(row!.workDays).toBe(20);
    expect(row!.overtimeAvgPerDay).toBeCloseTo(row!.overtimeHours / 20, 5);
  });

  it("returns null (not a divide-by-zero) when workDays is 0", () => {
    const row = buildAttendanceRow({ name: "竹本 晃", workDays: 0, totalWorkMins: 0, normalWorkMins: 0 });
    expect(row).toBeNull();
  });
});

describe("buildAttendanceSection", () => {
  function row(name: string, overtimeAvgPerDay: number) {
    return { name, overtimeHours: overtimeAvgPerDay * 10, totalWorkHours: 160, workDays: 10, overtimeAvgPerDay };
  }

  it("sorts target members by descending overtimeAvgPerDay and splits into left (high half, desc) and right (low half, asc)", () => {
    const rowsByCategory = [
      { category: "target" as const, row: row("A", 1.0) },
      { category: "target" as const, row: row("B", 4.0) },
      { category: "target" as const, row: row("C", 2.0) },
      { category: "target" as const, row: row("D", 3.0) },
    ];

    const section = buildAttendanceSection(rowsByCategory);

    // desc: B(4), D(3), C(2), A(1) -> mid=2 -> left=[B,D] right=reverse([C,A])=[A,C]
    expect(section.targetLeft.map((r) => r.name)).toEqual(["B", "D"]);
    expect(section.targetRight.map((r) => r.name)).toEqual(["A", "C"]);
  });

  it("puts an odd member count's extra row on the left half", () => {
    const rowsByCategory = [
      { category: "target" as const, row: row("A", 1.0) },
      { category: "target" as const, row: row("B", 3.0) },
      { category: "target" as const, row: row("C", 2.0) },
    ];

    const section = buildAttendanceSection(rowsByCategory);

    expect(section.targetLeft.map((r) => r.name)).toEqual(["B", "C"]);
    expect(section.targetRight.map((r) => r.name)).toEqual(["A"]);
  });

  it("groups shortHours and clerical together into `lower`, sorted by name, excluded from target split", () => {
    const rowsByCategory = [
      { category: "target" as const, row: row("A", 1.0) },
      { category: "shortHours" as const, row: row("能登 愛", 0.5) },
      { category: "clerical" as const, row: row("牛尾 郁美", 0.2) },
    ];

    const section = buildAttendanceSection(rowsByCategory);

    expect(section.targetLeft.map((r) => r.name)).toEqual(["A"]);
    expect(section.targetRight).toEqual([]);
    expect(section.lower.map((r) => r.name).sort()).toEqual(["牛尾 郁美", "能登 愛"].sort());
  });
});

describe("isOvertimeAvgAlert(残業平均時間2.50h以上を赤文字)", () => {
  it("is true at exactly 2.50 and above, false below", () => {
    expect(isOvertimeAvgAlert(2.5)).toBe(true);
    expect(isOvertimeAvgAlert(3.1)).toBe(true);
    expect(isOvertimeAvgAlert(2.49)).toBe(false);
    expect(isOvertimeAvgAlert(0)).toBe(false);
  });

  it("matches the displayed value: 2.496 is displayed as 2.50h/日 so it is also flagged; 2.494 (displayed 2.49) is not", () => {
    expect(isOvertimeAvgAlert(2.496)).toBe(true);
    expect(isOvertimeAvgAlert(2.494)).toBe(false);
  });
});

