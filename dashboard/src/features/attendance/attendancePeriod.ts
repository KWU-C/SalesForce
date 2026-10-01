/**
 * 勤怠状況(/resource下部)の表示期間。
 *
 * デフォルトは「過去28日間」(前日までの28日間のローリング集計、ユーザー確定2026-10-01)。
 * freee人事労務の月次サマリは暦月ではなく締め期間(20日締め: 10月度=9/21〜10/20)で
 * 返るため、「当月」として出すと月初に数日分しか無く誤解を招いた(ユーザー指摘、2026-10-01)。
 * 締め期間どおりの数字は「他を見る」プルダウンから「◯月度」として選べるようにする。
 */

/** freee人事労務の勤怠締め日(実データで確認済み、2026-10-01: 10月度=9/21〜10/20)。
 * 締め日が異なる従業員が一部いる(15日締め)が、その人はfreeeが返す本人の締め期間で集計される */
export const ATTENDANCE_CLOSING_DAY = 20;

export const ROLLING_DAYS = 28;

export type AttendancePeriod =
  | { kind: "rolling" }
  /** freeeの「year年month月度」(締め期間) */
  | { kind: "closingMonth"; year: number; month: number };

/** 両端を含む日付範囲(YYYY-MM-DD) */
export interface DateRange {
  start: string;
  end: string;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

/** 日本時間での今日(YYYY-MM-DD)。Cloud RunはUTCで動くため明示的に+9hする */
export function todayInJapan(now: Date = new Date()): string {
  return toDateOnly(new Date(now.getTime() + 9 * 60 * 60 * 1000));
}

/**
 * 過去28日間の範囲。当日は退勤前で勤怠が未確定のため含めず、前日までの28日間とする。
 */
export function rollingRange(today: string): DateRange {
  const end = addDays(today, -1);
  return { start: addDays(end, -(ROLLING_DAYS - 1)), end };
}

/** 指定日が属する締め月度(締め日以前はその月、締め日より後は翌月) */
export function closingMonthOf(dateOnly: string): { year: number; month: number } {
  const year = Number(dateOnly.slice(0, 4));
  const month = Number(dateOnly.slice(5, 7));
  const day = Number(dateOnly.slice(8, 10));
  if (day <= ATTENDANCE_CLOSING_DAY) return { year, month };
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function previousClosingMonth(target: { year: number; month: number }): { year: number; month: number } {
  return target.month === 1 ? { year: target.year - 1, month: 12 } : { year: target.year, month: target.month - 1 };
}

export function nextClosingMonth(target: { year: number; month: number }): { year: number; month: number } {
  return target.month === 12 ? { year: target.year + 1, month: 1 } : { year: target.year, month: target.month + 1 };
}

/** 締め月度の対象期間(前月の締め日翌日〜当月の締め日) */
export function closingMonthRange(target: { year: number; month: number }): DateRange {
  const previous = previousClosingMonth(target);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${previous.year}-${pad(previous.month)}-${pad(ATTENDANCE_CLOSING_DAY + 1)}`,
    end: `${target.year}-${pad(target.month)}-${pad(ATTENDANCE_CLOSING_DAY)}`,
  };
}

function formatMonthDay(dateOnly: string): string {
  return `${Number(dateOnly.slice(5, 7))}/${Number(dateOnly.slice(8, 10))}`;
}

export function formatDateRange(range: DateRange): string {
  return `${formatMonthDay(range.start)}〜${formatMonthDay(range.end)}`;
}

/** URLパラメータ(?attendance=)用のキー。過去28日間はパラメータ無し(null) */
export function attendancePeriodKey(period: AttendancePeriod): string | null {
  if (period.kind === "rolling") return null;
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

export interface AttendancePeriodOption {
  key: string;
  /** 例: 「10月度（9/21〜10/20）」 */
  label: string;
  period: AttendancePeriod;
}

/**
 * 「他を見る」プルダウンの選択肢。前月度・当月度の2つを古い順に並べる
 * (ユーザー確定、2026-10-01)。
 */
export function selectableClosingMonths(today: string): AttendancePeriodOption[] {
  const current = closingMonthOf(today);
  return [previousClosingMonth(current), current].map((target) => {
    const period: AttendancePeriod = { kind: "closingMonth", ...target };
    return {
      key: attendancePeriodKey(period) as string,
      label: `${target.month}月度（${formatDateRange(closingMonthRange(target))}）`,
      period,
    };
  });
}

/**
 * URLパラメータから表示期間を決める。未指定・選択肢に無い値は過去28日間にフォールバックする
 * (任意の年月を指定してfreeeへ問い合わせさせない)。
 */
export function resolveAttendancePeriod(rawKey: string | undefined, today: string): AttendancePeriod {
  const option = selectableClosingMonths(today).find((o) => o.key === rawKey);
  return option?.period ?? { kind: "rolling" };
}

/** 見出し・説明文用の表示情報 */
export function describeAttendancePeriod(
  period: AttendancePeriod,
  today: string
): { title: string; rangeLabel: string } {
  if (period.kind === "rolling") {
    return { title: `過去${ROLLING_DAYS}日間`, rangeLabel: formatDateRange(rollingRange(today)) };
  }
  return { title: `${period.month}月度`, rangeLabel: formatDateRange(closingMonthRange(period)) };
}
