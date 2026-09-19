import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { ExternalCashFlowStatus } from "./externalCashFlow";
import type { CashInflowBreakdown } from "./cashInflow";
import type { CashOutflowBreakdown } from "./cashOutflow";

/**
 * 月次資金収支(会社版家計簿)のスナップショット。Firestore(monthlyCashFlowSnapshots)へ
 * 保存する集計値そのものの形。freeeの生レスポンスは保存しない(ユーザー確定、2026-09-14)。
 *
 * 会計上の売上・利益ではなく、実際の現金の動き(入金・支出)を主役とする
 * (ユーザー確定、2026-09-14)。
 */
export interface MonthlyCashFlow {
  /** freeeのfiscal_year(会計年度開始の西暦年) */
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;

  /** 月初現預金(trial_bsのopening_balance合算) */
  cashOpening: number | null;
  /** 月末現預金(trial_bsのclosing_balance合算) */
  cashClosing: number | null;
  /** 実績の当月現金増減(cashClosing - cashOpening、これが正) */
  cashChange: number | null;

  /**
   * 外部入金合計(キャッシュイン合計、自社口座間の資金移動を除く)。入金側v3(2026-09-19)以降は
   * inflow.total(仕訳帳の相手科目による5区分の合計)。v2以前のスナップショットは
   * 銀行明細ベースの値で、inflowを持たない
   */
  externalIncome: number;
  /**
   * 入金の区分別内訳(営業入金・借入・保険資産回収等・その他・未分類と、合計に含めない参考の
   * 内部移動・ネットゼロ往復)。v2以前に保存されたスナップショットには無い
   * (旧ロジックのまま=次の更新で再計算されるまで区分内訳は「未再計算」表示)
   */
  inflow?: CashInflowBreakdown;
  /** 外部支出合計(自社口座間振替を除く) */
  externalExpenseTotal: number;
  /**
   * 出金の区分別内訳(人件費・外注費・税金社保・諸経費・その他・借入元本・利息・積立資産移動・未分類と、
   * 合計に含めない参考の内部移動・ネットゼロ往復・出金訂正)。v2以前の保存分には無い
   */
  outflow?: CashOutflowBreakdown;

  /**
   * externalIncome/externalExpenseTotalを算出したロジックのバージョン
   * (externalCashFlow.ts の EXTERNAL_CASH_FLOW_CALCULATION_VERSION)。保存済みスナップショットの
   * この値が現在のバージョンと異なる場合は「旧ロジック」として表示し、更新操作で再計算する
   */
  calculationVersion: string;
  /**
   * "provisional": 49期固有の証拠付き補完・除外を適用した、または未分類が残る期間。
   * "final": 恒久ロジックだけで確定でき、未分類も無い期間。
   */
  status: ExternalCashFlowStatus;

  /** 区分別の支出内訳(二重計上なし、1取引=1区分で代表分類) */
  expenseByCategory: Record<ExpenseCategory, number>;

  /**
   * 営業キャッシュ収支 = 営業入金(inflow.operating) - 営業支出(人件費+外注費+税金社会保険等+諸経費+その他)。
   * 借入・保険資産回収等・その他入金、借入返済・利息・積立資産移動・未分類の出金は含めない
   * (ユーザー確定、2026-09-19)。v2以前の保存分は外部入金全体を起点にした値
   */
  operatingCashFlow: number;
  /**
   * 財務キャッシュ収支 = -(借入元本返済)。利息は含まない(ユーザー確定、2026-09-15。
   * 借入残高をどれだけ減らしたかと、借入コストをいくら払ったかを別々に見られるようにする)
   */
  financingCashFlow: number;
  /** 借入コストキャッシュ収支 = -(当月支払利息)。通常の諸経費とは別枠で扱う */
  interestCashFlow: number;
  /** 積立・資産移動によるキャッシュ収支 = -(積立・資産移動) */
  assetTransferCashFlow: number;

  fetchedAt: Date;
}
