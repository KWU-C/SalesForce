// クライアントコンポーネント(AccountingConfirmationForm)からも読み込むため、Firestore等に依存するモジュールは
// importしない(型・検証・判定だけを置く)。
import { isTargetMonth, monthEndBoundary } from "./accountingReports";

/**
 * 経理確認の対象月(2026-11-16、ユーザー指定)。概要の上段「売上高累計・経常利益累計」をどの月まで集計するかを、
 * 経理の確認にもとづいて指定する。売上・利益の金額は入力しない(金額は常にfreeeの月次業績の合計)。
 * 指定が無い間は、仕掛品振替が確認できた月までを暫定で使う(latestAdjustedMonth)。
 */
export interface AccountingConfirmation {
  /** 経理確認済みの最終月(YYYY-MM)。null=指定を外した(暫定の仕掛品振替判定に戻す) */
  throughMonth: string | null;
  updatedBy: string;
  /** ISO文字列 */
  updatedAt: string;
  /** 上書き前の指定(古い順) */
  revisions: { throughMonth: string | null; updatedBy: string; updatedAt: string }[];
}

/**
 * 保存要求の検証。対象月はYYYY-MMで、月末を経過していること(月末前の月は経理確認の対象にできない)。
 * nullは指定の解除。それ以外は拒否(undefined)。
 */
export function parseConfirmationMonth(value: unknown, now: Date): string | null | undefined {
  if (value === null) return null;
  if (!isTargetMonth(value)) return undefined;
  if (now.getTime() < monthEndBoundary(value).getTime()) return undefined;
  return value;
}

/** Firestoreの値を読む。形が違えば指定なしとして扱う */
export function parseStoredConfirmation(data: unknown): AccountingConfirmation | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    !(d.throughMonth === null || isTargetMonth(d.throughMonth)) ||
    typeof d.updatedBy !== "string" ||
    typeof d.updatedAt !== "string" ||
    !Array.isArray(d.revisions)
  ) {
    return null;
  }
  return d as unknown as AccountingConfirmation;
}
