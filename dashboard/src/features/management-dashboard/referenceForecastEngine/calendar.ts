/**
 * 参考予測の日付計算(2026-11-18)。日付は "YYYY-MM-DD" の文字列で扱い、タイムゾーンに依存しない(UTCの日付として計算)。
 * 銀行休業日 = 土日・国民の祝日・12/31〜1/3。祝日は内閣府の公表(2025〜2027年)。範囲外の年は土日と年末年始だけで判定する。
 */

const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24", "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04",
  "2025-05-05", "2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23", "2025-10-13", "2025-11-03", "2025-11-23",
  "2025-11-24",
  // 2026
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  // 2027
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04",
  "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

export function isBankHoliday(date: string): boolean {
  const dow = toUtc(date).getUTCDay();
  if (dow === 0 || dow === 6) return true;
  const md = date.slice(5);
  if (md === "12-31" || md === "01-02" || md === "01-03") return true;
  return HOLIDAYS.has(date);
}

/** 当日が休業日なら前の営業日 */
export function previousBusinessDay(date: string): string {
  let d = date;
  while (isBankHoliday(d)) d = addDays(d, -1);
  return d;
}

/** 当日が休業日なら次の営業日 */
export function nextBusinessDay(date: string): string {
  let d = date;
  while (isBankHoliday(d)) d = addDays(d, 1);
  return d;
}

/** 営業日でn日前(n>=0)。当日が休業日のときは、まず前の営業日に寄せてから数える */
export function businessDaysBefore(date: string, n: number): string {
  let d = previousBusinessDay(date);
  for (let i = 0; i < n; i++) d = previousBusinessDay(addDays(d, -1));
  return d;
}

/** from(含まない)から to(含む)までの営業日数。to が from より前なら負 */
export function businessDaysBetween(from: string, to: string): number {
  if (to < from) return -businessDaysBetween(to, from);
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isBankHoliday(d)) n++;
  return n;
}

export function ym(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0));
  return fromUtc(d);
}

export function lastBusinessDayOfMonth(month: string): string {
  return previousBusinessDay(lastDayOfMonth(month));
}

/** 月内の日付(日が月の日数を超えるときは月末)。 */
export function dayInMonth(month: string, day: number): string {
  const last = Number(lastDayOfMonth(month).slice(8, 10));
  return `${month}-${String(Math.min(Math.max(day, 1), last)).padStart(2, "0")}`;
}

/** 翌月末(Salesforceの入金予定日の補完と同じ) */
export function monthEndNext(date: string): string {
  return lastDayOfMonth(addMonths(ym(date), 1));
}

/** freeeの会計年度(9月始まり、期首の西暦年) */
export function fiscalYearOf(month: string): number {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 9 ? y : y - 1;
}

/** 両端を含む月数 */
export function monthsBetween(a: string, b: string): number {
  return Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7)) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7))) + 1;
}
