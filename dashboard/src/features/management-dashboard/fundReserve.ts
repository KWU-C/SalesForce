import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow, FreeeWalletable } from "@/services/freee/freeeAccountingClient";
import { getTrialBs, getWalletables } from "@/services/freee/freeeAccountingClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { BONUS_RESERVE_CONFIGURED, WALLETABLE_PURPOSE_MAP } from "@/config/fundReserveClassification";
import type { FundReservePurpose } from "@/config/fundReserveClassification";

/**
 * 「資金の備え」(ストック)。借入状況と同じく月次資金収支(フロー)とは別枠で、
 * 「将来の支出に向けてどれだけ資金を準備しているか」を表す(ユーザー確定、2026-09-15)。
 *
 * 「賞与引当金」(会計上の発生主義の見積り計上)とは意味が異なるため、ここでは
 * 実キャッシュの準備額のみを扱う。対象口座・目標額が未確定の間は推測せず「未設定」とする。
 */
export interface OtherPurposeLine {
  label: string;
  /** 対象walletableがfreeeから見つからない場合はnull(0円と推測しない) */
  balance: number | null;
}

export interface FundReserve {
  /** WALLETABLE_PURPOSE_MAPに賞与用の口座が設定されているか。falseの間はUI側で常に「未設定」表示 */
  bonusReserveConfigured: boolean;
  bonusReserve: number;
  /** 保険積立金(freee勘定科目)の現在残高 + purpose="insurance"指定の口座残高 */
  insuranceReserve: number;
  /** purpose="other"の口座ごとの内訳 */
  otherPurposeLines: OtherPurposeLine[];
  /** 目的準備資金合計 = bonusReserve + insuranceReserve + otherPurposeLinesの合計 */
  purposeReserveTotal: number;
  /** 現預金(呼び出し側から渡される。月次資金収支の月末現預金と同じ値を使う想定) */
  cash: number | null;
  /** 自由資金 = 現預金 - 目的準備資金合計 */
  freeCash: number | null;
}

function findRow(balances: FreeeTrialBalanceRow[], name: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.account_item_name === name) ?? null;
}

/** 保険積立金の現在残高。科目の行が無ければ0(freeeは残高・動きゼロの科目行を省略するため) */
export function extractInsuranceAccountBalance(trialBs: FreeeTrialBalanceResponse): number {
  return findRow(trialBs.balances, "保険積立金")?.closing_balance ?? 0;
}

function walletableBalance(w: FreeeWalletable): number | null {
  return w.walletable_balance ?? w.last_balance ?? null;
}

function sumPurposeWalletables(
  walletables: FreeeWalletable[],
  purpose: FundReservePurpose
): { total: number; lines: OtherPurposeLine[] } {
  const lines = WALLETABLE_PURPOSE_MAP.filter((m) => m.purpose === purpose).map((m) => {
    const w = walletables.find((x) => x.id === m.walletableId);
    return { label: m.label, balance: w ? walletableBalance(w) : null };
  });
  const total = lines.reduce((sum, l) => sum + (l.balance ?? 0), 0);
  return { total, lines };
}

/**
 * trial_bs・walletablesの取得済みレスポンスから資金の備えを合成する。
 * WALLETABLE_PURPOSE_MAPの口座分類を変更しても、この関数やUI側の変更は不要
 * (purpose別に合算するだけの汎用ロジックのため、ユーザー確定の設計要件2026-09-15)。
 */
export function buildFundReserve(params: {
  trialBs: FreeeTrialBalanceResponse;
  walletables: FreeeWalletable[];
  cash: number | null;
}): FundReserve {
  const insuranceAccount = extractInsuranceAccountBalance(params.trialBs);
  const insurancePurpose = sumPurposeWalletables(params.walletables, "insurance");
  const bonusPurpose = sumPurposeWalletables(params.walletables, "bonus");
  const otherPurpose = sumPurposeWalletables(params.walletables, "other");

  const insuranceReserve = insuranceAccount + insurancePurpose.total;
  const purposeReserveTotal = bonusPurpose.total + insuranceReserve + otherPurpose.total;
  const freeCash = params.cash === null ? null : params.cash - purposeReserveTotal;

  return {
    bonusReserveConfigured: BONUS_RESERVE_CONFIGURED,
    bonusReserve: bonusPurpose.total,
    insuranceReserve,
    otherPurposeLines: otherPurpose.lines,
    purposeReserveTotal,
    cash: params.cash,
    freeCash,
  };
}

/**
 * freee接続済みの事業所から資金の備えを取得する。cashは呼び出し側(月次資金収支の
 * 月末現預金)から渡してもらう想定(同じ「選択月の現預金」を二重に取得しないため)。
 * company_id未確定(未接続)の場合はnull。
 */
export async function getFundReserve(
  fiscalYear: number,
  selectedMonth: number,
  cash: number | null
): Promise<FundReserve | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const [trialBs, walletables] = await Promise.all([
    getTrialBs(companyId, { fiscalYear, startMonth: FISCAL_MONTH_ORDER[0], endMonth: selectedMonth }),
    getWalletables(companyId),
  ]);
  return buildFundReserve({ trialBs, walletables, cash });
}
