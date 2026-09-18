import type { AttendanceRow, AttendanceSectionData } from "./attendance";

function formatHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function formatAvgPerDay(hours: number): string {
  return `${hours.toFixed(2)}h/日`;
}

function AttendanceTable({ title, rows }: { title: string; rows: AttendanceRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-[var(--text-muted)]">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-left text-xs font-medium text-[var(--text-muted)]">
              <th className="px-3 py-2">氏名</th>
              <th className="px-3 py-2 text-right">残業平均時間</th>
              <th className="px-3 py-2 text-right">総勤務</th>
              <th className="px-3 py-2 text-right">労働日数</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-center text-xs text-[var(--text-muted)]">
                  対象者がいません
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.name} className="border-t border-[var(--gridline)]">
                  <td className="px-3 py-2 text-[var(--text-primary)]">{row.name}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[var(--text-primary)]">
                    {formatAvgPerDay(row.overtimeAvgPerDay)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                    {formatHours(row.totalWorkHours)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{row.workDays}日</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 勤怠状況(/resource下部)。既存の推定負荷率(resource-load)・営業進捗とは独立した
 * freee人事労務の実勤怠データ(当月分)。「対象外」は非表示、「時短」「事務」は
 * 下段にまとめ、それ以外(対象)は残業平均時間の多い順(左)・少ない順(右)に
 * 二分割する(ユーザー確定、2026-09-18)。
 */
export function AttendanceSection({ data }: { data: AttendanceSectionData }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">勤怠状況</h2>
        <p className="text-xs text-[var(--text-muted)]">
          当月のfreee人事労務実績。残業平均時間＝時間外(総勤務−所定内)÷労働日数。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AttendanceTable title="残業平均時間が多い順" rows={data.targetLeft} />
        <AttendanceTable title="残業平均時間が少ない順" rows={data.targetRight} />
      </div>
      <AttendanceTable title="時短・事務" rows={data.lower} />
    </div>
  );
}
