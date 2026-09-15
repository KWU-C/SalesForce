import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialBs } from "@/services/freee/freeeAccountingClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";

/**
 * 借入状況(ストック)。月次資金収支(フロー)とは別枠で「今どれだけ借入残高があり、
 * 今期どれだけ純減できているか」を表す(ユーザー確定、2026-09-15)。
 * 同じ返済取引が月次資金収支の「借入返済」とここに両方出てよい(フローとストックで
 * 意味が異なるため二重計上ではない、ユーザー確定)。
 */
export type LoanKey = "shortTerm" | "longTerm" | "officer";

export interface LoanLine {
  key: LoanKey;
  label: string;
  openingBalance: number;
  currentBalance: number;
  newBorrowing: number;
  repayment: number;
}

export interface LoanStatus {
  lines: LoanLine[];
  totalOpening: number;
  totalCurrent: number;
  totalNewBorrowing: number;
  totalRepayment: number;
  /** 今期純増減 = totalCurrent - totalOpening(マイナスが「今期どれだけ減らせたか」) */
  netChange: number;
}

const LOAN_ACCOUNT_ITEMS: readonly { key: LoanKey; label: string }[] = [
  { key: "shortTerm", label: "短期借入金" },
  { key: "longTerm", label: "長期借入金" },
  { key: "officer", label: "役員借入金" },
];

function findRow(balances: FreeeTrialBalanceRow[], name: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.account_item_name === name) ?? null;
}

/**
 * trial_bsの通期(期首月〜対象月)レスポンスから借入状況を抽出する。
 *
 * 負債科目は恒等式「期首残高 - debit_amount(返済) + credit_amount(新規借入) = 現在残高」が
 * 成立することを実データで確認済み(2026-09-15、短期借入金・長期借入金で検証)。
 * 該当科目の行が丸ごと無い場合、freeeは期首・現在とも残高ゼロかつ期中の動きも無い科目の
 * 行を省略する(実データで確認済み)。よってこの場合は「データ未設定」ではなく
 * 確定した0円として扱う(役員借入金は今期ゼロ残高のため実データでもこのケースだった)。
 */
export function extractLoanStatus(trialBs: FreeeTrialBalanceResponse): LoanStatus {
  const lines: LoanLine[] = LOAN_ACCOUNT_ITEMS.map(({ key, label }) => {
    const row = findRow(trialBs.balances, label);
    return {
      key,
      label,
      openingBalance: row?.opening_balance ?? 0,
      currentBalance: row?.closing_balance ?? 0,
      newBorrowing: row?.credit_amount ?? 0,
      repayment: row?.debit_amount ?? 0,
    };
  });

  const totalOpening = lines.reduce((sum, l) => sum + l.openingBalance, 0);
  const totalCurrent = lines.reduce((sum, l) => sum + l.currentBalance, 0);
  const totalNewBorrowing = lines.reduce((sum, l) => sum + l.newBorrowing, 0);
  const totalRepayment = lines.reduce((sum, l) => sum + l.repayment, 0);

  return {
    lines,
    totalOpening,
    totalCurrent,
    totalNewBorrowing,
    totalRepayment,
    netChange: totalCurrent - totalOpening,
  };
}

/**
 * freee接続済みの事業所から、fiscalYearの期首月〜selectedMonthまでの通期試算表を取得し、
 * 借入状況を返す。company_id未確定(未接続)の場合はnull。
 */
export async function getLoanStatus(fiscalYear: number, selectedMonth: number): Promise<LoanStatus | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const trialBs = await getTrialBs(companyId, {
    fiscalYear,
    startMonth: FISCAL_MONTH_ORDER[0],
    endMonth: selectedMonth,
  });
  return extractLoanStatus(trialBs);
}
