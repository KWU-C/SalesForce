import {
  ATTENDANCE_CLERICAL_NAMES,
  ATTENDANCE_EXCLUDED_NAMES,
  ATTENDANCE_SHORT_HOURS_NAMES,
} from "@/config/attendanceCategory";

/**
 * 勤怠状況(/resource下部)。既存の推定負荷率(resource-load)・営業進捗とは独立した
 * 参考指標で、freee人事労務の実勤怠データをそのまま使う(ユーザー確定、2026-09-18)。
 *
 * 「残業平均時間」は「時間外」÷「労働日数」を基準にする(ユーザー確定)。
 * 「時間外」はfreee画面の「時間外」列と実データで検算済みの定義
 * (総勤務時間 − 所定内労働時間)を使う(2026-09-18)。
 */

export type AttendanceCategory = "target" | "shortHours" | "clerical";

export interface AttendanceRow {
  name: string;
  /** 時間外(h) = (総勤務時間 − 所定内労働時間) / 60 */
  overtimeHours: number;
  /** 総勤務時間(h) */
  totalWorkHours: number;
  workDays: number;
  /** 残業平均時間 = overtimeHours / workDays */
  overtimeAvgPerDay: number;
}

export interface AttendanceSectionData {
  /** 対象(「正社員_所定8h_みなし32」相当)のうち、残業平均時間が多い順の半分 */
  targetLeft: AttendanceRow[];
  /** 対象のうち、残業平均時間が少ない順の残り半分 */
  targetRight: AttendanceRow[];
  /** 時短・事務をまとめた下段セクション */
  lower: AttendanceRow[];
}

function normalizeName(name: string): string {
  return name.replace(/[\s　]+/g, " ").trim();
}

function includesName(list: readonly string[], name: string): boolean {
  const normalized = normalizeName(name);
  return list.some((candidate) => normalizeName(candidate) === normalized);
}

/** data/Member.numbersの「リソース」列に基づく区分判定。「対象外」はnullを返す
 * (勤怠状況セクションに一切表示しない) */
export function classifyAttendanceMember(name: string): AttendanceCategory | "excluded" {
  if (includesName(ATTENDANCE_EXCLUDED_NAMES, name)) return "excluded";
  if (includesName(ATTENDANCE_SHORT_HOURS_NAMES, name)) return "shortHours";
  if (includesName(ATTENDANCE_CLERICAL_NAMES, name)) return "clerical";
  return "target";
}

export interface WorkRecordInput {
  name: string;
  workDays: number;
  totalWorkMins: number;
  normalWorkMins: number;
}

/** workDaysが0(当月まだ勤怠実績が無い等)の場合はnull(0除算・無意味な平均値を作らない) */
export function buildAttendanceRow(input: WorkRecordInput): AttendanceRow | null {
  if (input.workDays <= 0) return null;
  const overtimeHours = (input.totalWorkMins - input.normalWorkMins) / 60;
  return {
    name: input.name,
    overtimeHours,
    totalWorkHours: input.totalWorkMins / 60,
    workDays: input.workDays,
    overtimeAvgPerDay: overtimeHours / input.workDays,
  };
}

/** 日次の勤怠1日分(freee人事労務のwork_recordsから集計に必要な値だけ取り出したもの) */
export interface DailyWorkRecord {
  /** YYYY-MM-DD */
  date: string;
  /** 所定労働時間(分)。有給取得日は0 */
  normalWorkMins: number;
  /** 時間外(分) */
  overtimeMins: number;
  /** 実働(分) = 打刻の合計 − 休憩の合計。打刻が無い日は0 */
  actualWorkMins: number;
  /** 全休(有給・特別休暇)の日数。全休=1、半休=0.5 */
  leaveDays: number;
  /** 半休・時間休として取得した分(分) */
  partialLeaveMins: number;
}

/** その従業員の所定労働時間(分)。期間内の日次データで最も多い0以外の値を採る(全休の日は0で返るため) */
function standardWorkMins(records: DailyWorkRecord[]): number {
  const counts = new Map<number, number>();
  for (const record of records) {
    if (record.normalWorkMins > 0) counts.set(record.normalWorkMins, (counts.get(record.normalWorkMins) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [mins, count] of counts) {
    if (count > bestCount) {
      best = mins;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 日次の勤怠を範囲(両端含む)で絞り、月次サマリと同じ定義で合算する(過去28日間の集計用)。
 *
 * freeeの月次サマリ(work_days/total_work_mins/時間外)を日次から再現できる式として
 * 実データで検算済み(2026-10-01): 労働日数は出勤日+有給・特別休暇(全休1日、半休0.5日)、
 * 総勤務は実働+休暇分(全休は所定労働時間、半休・時間休は取得分)、時間外は日次の時間外の合計。
 * 所定労働時間はrecords全体(範囲外も含む)から求めるため、範囲で絞る前の配列を渡すこと。
 */
export function summarizeDailyWorkRecords(
  name: string,
  records: DailyWorkRecord[],
  range: { start: string; end: string }
): WorkRecordInput {
  const standardMins = standardWorkMins(records);
  let workDays = 0;
  let totalWorkMins = 0;
  let overtimeMins = 0;
  for (const record of records) {
    if (record.date < range.start || record.date > range.end) continue;
    const worked = record.actualWorkMins > 0;
    const fullLeave = record.leaveDays >= 1;
    workDays += worked || fullLeave ? 1 : record.leaveDays;
    totalWorkMins += record.actualWorkMins + (fullLeave ? standardMins : 0) + record.partialLeaveMins;
    overtimeMins += record.overtimeMins;
  }
  return { name, workDays, totalWorkMins, normalWorkMins: totalWorkMins - overtimeMins };
}

/**
 * 区分別に振り分けられた行から、表示用のセクションデータを組み立てる。
 * targetは残業平均時間の降順に並べ、前半を左(多い順のまま)・後半を右
 * (少ない順になるよう反転)に二分割する(ユーザー確定、2026-09-18)。
 */
export function buildAttendanceSection(
  rowsByCategory: { category: AttendanceCategory; row: AttendanceRow }[]
): AttendanceSectionData {
  const targetRows = rowsByCategory.filter((r) => r.category === "target").map((r) => r.row);
  const lowerRows = rowsByCategory
    .filter((r) => r.category === "shortHours" || r.category === "clerical")
    .map((r) => r.row)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const sortedDesc = [...targetRows].sort((a, b) => b.overtimeAvgPerDay - a.overtimeAvgPerDay);
  const mid = Math.ceil(sortedDesc.length / 2);
  const targetLeft = sortedDesc.slice(0, mid);
  const targetRight = sortedDesc.slice(mid).reverse();

  return { targetLeft, targetRight, lower: lowerRows };
}

/** 残業平均時間(時間/日)を赤文字にするしきい値(ユーザー確定、2026-09-19: 2.50h以上) */
export const OVERTIME_AVG_ALERT_THRESHOLD_HOURS = 2.5;

/**
 * 残業平均時間が警告(赤文字)対象か。画面には小数第2位まで表示するため、表示値(2.50h/日)と
 * 判定が食い違わないよう、小数第2位に丸めた値で2.50以上を判定する(2.496は表示が2.50でも対象外にならない
 * ように、丸めた値で判定して表示と一致させる)。
 */
export function isOvertimeAvgAlert(overtimeAvgPerDay: number): boolean {
  return Number(overtimeAvgPerDay.toFixed(2)) >= OVERTIME_AVG_ALERT_THRESHOLD_HOURS;
}
