import { describe, expect, it } from "vitest";
import { addMonths, businessDaysBefore, businessDaysBetween, isBankHoliday, lastBusinessDayOfMonth, monthEndNext, nextBusinessDay, previousBusinessDay } from "./calendar";

describe("参考予測の日付計算", () => {
  it("土日・祝日・12/31〜1/3を銀行休業日とする", () => {
    expect(isBankHoliday("2026-11-23")).toBe(true); // 勤労感謝の日
    expect(isBankHoliday("2026-12-31")).toBe(true);
    expect(isBankHoliday("2027-01-04")).toBe(false);
    expect(isBankHoliday("2026-10-31")).toBe(true); // 土曜
  });

  it("月末が休業日の引落は翌営業日、振込は前の営業日", () => {
    expect(nextBusinessDay("2026-10-31")).toBe("2026-11-02");
    expect(nextBusinessDay("2026-12-31")).toBe("2027-01-04");
    expect(previousBusinessDay("2026-12-31")).toBe("2026-12-30");
    expect(lastBusinessDayOfMonth("2026-10")).toBe("2026-10-30");
  });

  it("給与の振込日: 支給日(休業日なら前の営業日)の3営業日前", () => {
    expect(businessDaysBefore("2026-11-25", 3)).toBe("2026-11-19"); // 11/23は祝日
    expect(businessDaysBetween("2026-10-20", previousBusinessDay("2026-10-25"))).toBe(3);
    expect(businessDaysBefore("2026-12-25", 3)).toBe("2026-12-22");
  });

  it("月の加減と翌月末", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -2)).toBe("2025-11");
    expect(monthEndNext("2026-11-30")).toBe("2026-12-31");
  });
});
