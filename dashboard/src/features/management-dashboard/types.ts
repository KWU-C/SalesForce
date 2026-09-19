import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { ExternalCashFlowOverride, UnresolvedCashFlowItem } from "@/config/externalCashFlowOverrides";
import type { ExternalCashFlowStatus } from "./externalCashFlow";
import type { CashInflowBreakdown } from "./cashInflow";

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
   * externalIncome/externalExpenseTotalを算出した恒久ロジックのバージョン
   * (externalCashFlow.ts の EXTERNAL_CASH_FLOW_CALCULATION_VERSION)。保存済み
   * スナップショットのこの値が現在のバージョンと異なる場合はキャッシュミス扱いにし、
   * 次回の更新で自動的に再計算する(ユーザー確定、2026-09-18)。
   */
  calculationVersion: string;
  /**
   * "provisional": この期間に未解決明細・tentative候補・overrideのいずれかが
   * 適用されている(49期のようなfreee移行期はほぼ常にこれになる)。
   * "final": 恒久ロジック(口座境界+公式transfer実額照合)のみで機械的に確定できた
   * (50期以降、override無しで済む期間を想定)。
   */
  status: ExternalCashFlowStatus;
  /** この期間内で確定(confidence=confirmed)として適用されたoverrideのID一覧(監査用) */
  appliedOverrideIds: string[];
  /** この期間内で内部振替か外部入金か無理に分類していない未解決明細(控除していない) */
  unresolvedItems: UnresolvedCashFlowItem[];
  /** この期間内の、確定に至っていないoverride候補(参考情報。控除していない) */
  tentativeCandidates: ExternalCashFlowOverride[];

  /** 区分別の支出内訳(二重計上なし、1取引=1区分で代表分類) */
  expenseByCategory: Record<ExpenseCategory, number>;

  /** 営業キャッシュ収支 = externalIncome - (通常運営区分の支出合計) */
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
