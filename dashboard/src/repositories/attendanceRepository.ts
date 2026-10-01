import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getHrEmployees, getWorkRecordSummary } from "@/services/freee/freeeHrClient";
import type { FreeeWorkRecord, FreeeWorkRecordSummary } from "@/services/freee/freeeHrClient";
import {
  buildAttendanceRow,
  buildAttendanceSection,
  classifyAttendanceMember,
  summarizeDailyWorkRecords,
} from "@/features/attendance/attendance";
import type {
  AttendanceCategory,
  AttendanceRow,
  AttendanceSectionData,
  DailyWorkRecord,
  WorkRecordInput,
} from "@/features/attendance/attendance";
import {
  closingMonthOf,
  nextClosingMonth,
  previousClosingMonth,
  rollingRange,
  todayInJapan,
} from "@/features/attendance/attendancePeriod";
import type { AttendancePeriod, DateRange } from "@/features/attendance/attendancePeriod";

interface CategorizedRow {
  category: AttendanceCategory;
  row: AttendanceRow;
}

function spanMins(spans: FreeeWorkRecord["work_record_segments"]): number {
  let total = 0;
  for (const span of spans ?? []) {
    if (!span.clock_in_at || !span.clock_out_at) continue; // 退勤未打刻は実働に数えない
    total += (new Date(span.clock_out_at).getTime() - new Date(span.clock_in_at).getTime()) / 60_000;
  }
  return total;
}

function toDailyWorkRecord(record: FreeeWorkRecord): DailyWorkRecord {
  const workedMins = spanMins(record.work_record_segments);
  return {
    date: record.date,
    normalWorkMins: record.normal_work_mins ?? 0,
    overtimeMins: record.total_overtime_work_mins ?? 0,
    actualWorkMins: workedMins > 0 ? workedMins - spanMins(record.break_records) : 0,
    leaveDays: (record.paid_holiday ?? 0) + (record.special_holiday ?? 0),
    partialLeaveMins:
      (record.half_paid_holiday_mins ?? 0) +
      (record.hourly_paid_holiday_mins ?? 0) +
      (record.half_special_holiday_mins ?? 0) +
      (record.hourly_special_holiday_mins ?? 0),
  };
}

type ClosingMonth = { year: number; month: number };

/**
 * 過去28日間を覆う日次の勤怠を集める。日次データは締め月度単位でしか取れないため、
 * 範囲の開始日・終了日が属する月度(1〜2ヶ月分)を取得する。締め日が標準と異なる従業員は
 * 返ってきた期間が範囲を覆い切らないことがあるので、その場合だけ前後の月度を追加で取る。
 */
async function getDailyWorkRecords(employeeId: number, companyId: number, range: DateRange): Promise<DailyWorkRecord[]> {
  const fetchMonth = (target: ClosingMonth) =>
    getWorkRecordSummary(employeeId, companyId, target.year, target.month, { includeWorkRecords: true });

  const first = closingMonthOf(range.start);
  const last = closingMonthOf(range.end);
  const sameMonth = first.year === last.year && first.month === last.month;
  const summaries: FreeeWorkRecordSummary[] = await Promise.all((sameMonth ? [first] : [first, last]).map(fetchMonth));

  if (summaries[0].start_date > range.start) {
    summaries.unshift(await fetchMonth(previousClosingMonth(first)));
  }
  if (summaries[summaries.length - 1].end_date < range.end) {
    summaries.push(await fetchMonth(nextClosingMonth(last)));
  }

  const byDate = new Map<string, DailyWorkRecord>();
  for (const summary of summaries) {
    for (const record of summary.work_records ?? []) byDate.set(record.date, toDailyWorkRecord(record));
  }
  return [...byDate.values()];
}

async function getWorkRecordInput(
  employee: { id: number; display_name: string },
  companyId: number,
  period: AttendancePeriod,
  today: string
): Promise<WorkRecordInput> {
  if (period.kind === "rolling") {
    const range = rollingRange(today);
    const records = await getDailyWorkRecords(employee.id, companyId, range);
    return summarizeDailyWorkRecords(employee.display_name, records, range);
  }
  const summary = await getWorkRecordSummary(employee.id, companyId, period.year, period.month);
  return {
    name: employee.display_name,
    workDays: summary.work_days,
    totalWorkMins: summary.total_work_mins,
    normalWorkMins: summary.total_normal_work_mins,
  };
}

/**
 * 勤怠状況(/resource下部)をfreee人事労務データから組み立てる。
 * 期間は「過去28日間」(デフォルト、日次の勤怠から集計)か、freeeの締め月度(月次サマリを
 * そのまま使う)のどちらか(ユーザー確定、2026-10-01。features/attendance/attendancePeriod.ts参照)。
 * 既存の会計用freee連携(company_id・トークン)をそのまま使う(別スコープ・別アプリ
 * 登録は不要、2026-09-18に実地確認済み)。Firestoreキャッシュは持たず、
 * resource-load(推定負荷率)と同じくアクセスごとにfreeeから取得する。
 * 取得に失敗した場合はnullを返す(呼び出し側でエラー表示にフォールバックする想定)。
 */
export async function getAttendanceSection(
  period: AttendancePeriod = { kind: "rolling" }
): Promise<AttendanceSectionData | null> {
  try {
    const companyId = await getFreeeCompanyId();
    if (companyId === null) return null;

    const employees = await getHrEmployees(companyId);
    const today = todayInJapan();

    const results = await Promise.all(
      employees.map(async (employee): Promise<CategorizedRow | null> => {
        if (employee.retire_date && employee.retire_date <= today) return null; // 退職済みは除外
        const category = classifyAttendanceMember(employee.display_name);
        if (category === "excluded") return null;

        try {
          const row = buildAttendanceRow(await getWorkRecordInput(employee, companyId, period, today));
          return row ? { category, row } : null;
        } catch {
          // 対象期間にまだ勤怠データが無い従業員(入社直後等)はスキップする(推測で埋めない)
          return null;
        }
      })
    );

    const categorizedRows = results.filter((r): r is CategorizedRow => r !== null);
    return buildAttendanceSection(categorizedRows);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[attendanceRepository] 勤怠状況の取得に失敗しました: ${detail}`);
    return null;
  }
}
