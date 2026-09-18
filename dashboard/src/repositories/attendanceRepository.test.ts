import { afterEach, describe, expect, it, vi } from "vitest";

const getFreeeCompanyIdMock = vi.fn();
const getHrEmployeesMock = vi.fn();
const getWorkRecordSummaryMock = vi.fn();

vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: getFreeeCompanyIdMock,
}));
vi.mock("@/services/freee/freeeHrClient", () => ({
  getHrEmployees: getHrEmployeesMock,
  getWorkRecordSummary: getWorkRecordSummaryMock,
}));
vi.mock("@/config/attendanceCategory", () => ({
  ATTENDANCE_EXCLUDED_NAMES: ["除外 太郎"],
  ATTENDANCE_SHORT_HOURS_NAMES: [],
  ATTENDANCE_CLERICAL_NAMES: [],
}));

const { getAttendanceSection } = await import("./attendanceRepository");

afterEach(() => {
  vi.restoreAllMocks();
  getFreeeCompanyIdMock.mockReset();
  getHrEmployeesMock.mockReset();
  getWorkRecordSummaryMock.mockReset();
  vi.useRealTimers();
});

describe("getAttendanceSection", () => {
  it("returns null without calling freee when company is not connected", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(null);

    const result = await getAttendanceSection();

    expect(result).toBeNull();
    expect(getHrEmployeesMock).not.toHaveBeenCalled();
  });

  it("excludes 対象外 members and never fetches their work record summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 18)));
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getHrEmployeesMock.mockResolvedValue([
      { id: 1, display_name: "除外 太郎", retire_date: null },
      { id: 2, display_name: "対象 花子", retire_date: null },
    ]);
    getWorkRecordSummaryMock.mockResolvedValue({ work_days: 20, total_work_mins: 12000, total_normal_work_mins: 9600 });

    const result = await getAttendanceSection();

    expect(getWorkRecordSummaryMock).toHaveBeenCalledTimes(1);
    expect(getWorkRecordSummaryMock).toHaveBeenCalledWith(2, 1, 2026, 9);
    expect(result!.targetLeft.map((r) => r.name)).toEqual(["対象 花子"]);
  });

  it("excludes employees whose retire_date is on/before today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 18)));
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getHrEmployeesMock.mockResolvedValue([
      { id: 3, display_name: "退職 次郎", retire_date: "2026-09-17" },
      { id: 4, display_name: "在籍 三郎", retire_date: "2026-12-31" },
    ]);
    getWorkRecordSummaryMock.mockResolvedValue({ work_days: 10, total_work_mins: 6000, total_normal_work_mins: 4800 });

    const result = await getAttendanceSection();

    expect(getWorkRecordSummaryMock).toHaveBeenCalledTimes(1);
    expect(result!.targetLeft.map((r) => r.name)).toEqual(["在籍 三郎"]);
  });

  it("skips an employee whose work_record_summary fetch fails, instead of fabricating a row", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getHrEmployeesMock.mockResolvedValue([{ id: 5, display_name: "対象 四郎", retire_date: null }]);
    getWorkRecordSummaryMock.mockRejectedValue(new Error("freee_hr_api_error"));

    const result = await getAttendanceSection();

    expect(result).toEqual({ targetLeft: [], targetRight: [], lower: [] });
  });

  it("returns null without leaking error details when getHrEmployees itself fails", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getHrEmployeesMock.mockRejectedValue(new Error("secret leak: token=abc"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getAttendanceSection();

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
