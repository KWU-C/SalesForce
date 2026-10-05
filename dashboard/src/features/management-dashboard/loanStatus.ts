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

/**
 * Firestoreへキャッシュする借入状況スナップショットの形(2026-09-15、過去月=Firestore/
 * 当月=freeeライブの切り替え対応)。月次資金収支のMonthlyCashFlowと同じ考え方で
 * fiscalYear/month/fetchedAtを付与する。
 */
export interface LoanStatusSnapshot extends LoanStatus {
  fiscalYear: number;
  month: number;
  fetchedAt: Date;
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

/**
 * 当座貸越の枠・利用額・空き枠。枠はTCD独自の設定値(freeeに枠の情報は無い)、利用額は
 * 短期借入金の現在残高。資金の備えの「資金余力」から引くのは枠ではなくこの利用額。
 *
 * 【前提】短期借入金の全額が当座貸越であること(2026-10-05時点の実データで、短期借入金の内訳が
 * すべて当座貸越であることを確認済み)。当座貸越以外の短期借入が入ると利用額が過大になるため、
 * UIにもこの前提を明記する。科目の内訳名(品目)の文字列で当座貸越かどうかを判定することはしない。
 */
export interface OverdraftStatus {
  /** 枠の合計。未設定ならnull */
  limitTotal: number | null;
  used: number;
  /** 空き枠 = 枠 − 利用額。枠が未設定ならnull */
  available: number | null;
}

export function computeOverdraftStatus(loanStatus: LoanStatus, limitTotal: number | null): OverdraftStatus {
  const used = loanStatus.lines.find((l) => l.key === "shortTerm")?.currentBalance ?? 0;
  return { limitTotal, used, available: limitTotal === null ? null : limitTotal - used };
}
