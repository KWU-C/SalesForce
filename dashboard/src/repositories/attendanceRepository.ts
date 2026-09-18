import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getHrEmployees, getWorkRecordSummary } from "@/services/freee/freeeHrClient";
import {
  buildAttendanceRow,
  buildAttendanceSection,
  classifyAttendanceMember,
} from "@/features/attendance/attendance";
import type { AttendanceCategory, AttendanceRow, AttendanceSectionData } from "@/features/attendance/attendance";

interface CategorizedRow {
  category: AttendanceCategory;
  row: AttendanceRow;
}

/**
 * 勤怠状況(/resource下部)を当月分のfreee人事労務データから組み立てる。
 * 既存の会計用freee連携(company_id・トークン)をそのまま使う(別スコープ・別アプリ
 * 登録は不要、2026-09-18に実地確認済み)。Firestoreキャッシュは持たず、
 * resource-load(推定負荷率)と同じくアクセスごとにfreeeから取得する。
 * 取得に失敗した場合はnullを返す(呼び出し側でエラー表示にフォールバックする想定)。
 */
export async function getAttendanceSection(): Promise<AttendanceSectionData | null> {
  try {
    const companyId = await getFreeeCompanyId();
    if (companyId === null) return null;

    const employees = await getHrEmployees(companyId);
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const today = now.toISOString().slice(0, 10);

    const results = await Promise.all(
      employees.map(async (employee): Promise<CategorizedRow | null> => {
        if (employee.retire_date && employee.retire_date <= today) return null; // 退職済みは除外
        const category = classifyAttendanceMember(employee.display_name);
        if (category === "excluded") return null;

        try {
          const summary = await getWorkRecordSummary(employee.id, companyId, year, month);
          const row = buildAttendanceRow({
            name: employee.display_name,
            workDays: summary.work_days,
            totalWorkMins: summary.total_work_mins,
            normalWorkMins: summary.total_normal_work_mins,
          });
          return row ? { category, row } : null;
        } catch {
          // 当月まだ勤怠データが無い従業員(入社直後等)はスキップする(推測で埋めない)
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
