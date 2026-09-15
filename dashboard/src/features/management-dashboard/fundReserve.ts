import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialBs } from "@/services/freee/freeeAccountingClient";
import { getAccountItems } from "@/services/freee/freeeTransactionClient";
import type { FreeeAccountItem } from "@/services/freee/freeeTransactionClient";
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
  /**
   * 対象walletableに対応するfreee勘定科目が見つからない場合、またはtrial_bs側に
   * その科目の情報が無い場合はnull(0円と推測しない)。科目は見つかったがtrial_bs行が
   * 無い場合は、freeeが残高・動きゼロの科目行を省略する仕様(実データ確認済み)に基づき
   * 0円として扱う(borrowedと同じ考え方)。
   */
  balance: number | null;
}

/**
 * 資金の備えのうち、freeeから取得できる部分(現預金は含まない)。
 * Firestoreスナップショットとしてキャッシュする対象はこちら(2026-09-15、
 * 過去月=Firestore/当月=freeeライブの切り替え対応)。現預金(cash)は月次資金収支の
 * スナップショットに既に含まれているため、ここでは二重に保存しない。
 */
export interface FundReserveCore {
  /** WALLETABLE_PURPOSE_MAPに賞与用の口座が設定されているか。falseの間はUI側で常に「未設定」表示 */
  bonusReserveConfigured: boolean;
  bonusReserve: number;
  /** purpose="other"の口座ごとの内訳(いずれも現金・預金カテゴリ内の、選択月末時点の残高) */
  otherPurposeLines: OtherPurposeLine[];
  /**
   * 現預金内の目的別拘束資金合計 = bonusReserve + otherPurposeLinesの合計
   * (将来purpose="insurance"の口座が追加されればそれも含む)。
   * WALLETABLE_PURPOSE_MAPの対象はすべてfreeeのwalletable(銀行口座等)であり、
   * 構造的に必ず「現金・預金」カテゴリに含まれるため、自由資金の控除対象にできる
   * (ユーザー確定、2026-09-15)。
   */
  cashRestrictedTotal: number;
  /**
   * 保険積立金(freee勘定科目「保険積立金」、account_category_name="投資その他の資産")の
   * 選択月末時点の残高。実データで確認済みの通り、trial_bsの「現金・預金」カテゴリには
   * 一切含まれないため、現預金からは控除しない「資産としての備え」として別表示する
   * (二重控除防止、ユーザー確定、2026-09-15)。
   */
  insuranceAssetReserve: number;
}

export interface FundReserve extends FundReserveCore {
  /** 現預金(呼び出し側から渡される。月次資金収支の月末現預金と同じ値を使う想定) */
  cash: number | null;
  /** 自由に使える現預金 = 現預金 - 現預金内の目的別拘束資金(保険積立金は含めない) */
  freeCash: number | null;
}

/**
 * Firestoreへキャッシュするスナップショットの形(2026-09-15、過去月=Firestore/当月=freee
 * ライブの切り替え対応)。cash/freeCashは現預金の取得元によって変わり得るためキャッシュ
 * せず、常にcomposeFundReserveでその場で合成する。
 */
export interface FundReserveCoreSnapshot extends FundReserveCore {
  fiscalYear: number;
  month: number;
  fetchedAt: Date;
}

function findRow(balances: FreeeTrialBalanceRow[], name: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.account_item_name === name) ?? null;
}

/** 保険積立金の選択月末時点の残高。科目の行が無ければ0(freeeは残高・動きゼロの科目行を省略するため) */
export function extractInsuranceAccountBalance(trialBs: FreeeTrialBalanceResponse): number {
  return findRow(trialBs.balances, "保険積立金")?.closing_balance ?? 0;
}

/**
 * purpose別の口座残高を、選択月末時点のtrial_bs closing_balanceから取得する。
 *
 * 【2026-09-15修正】以前はgetWalletables()のリアルタイム現在残高を使っていたため、
 * 過去月を表示していても常に「現在」の残高が出てしまう不整合があった(保険積立金は
 * trial_bs経由で正しく月次点だったのに対し、こちらだけ非対称だった)。
 * account_items(walletable_idを持つ)経由でwalletableに対応する勘定科目名を特定し、
 * 保険積立金と同じtrial_bsのclosing_balanceで選択月末時点の残高を取得するよう統一した。
 * これにより8月表示なら8月末残高、9月表示なら9月末残高になる(12か月横並び表示の前提条件)。
 */
function sumPurposeWalletables(
  accountItems: FreeeAccountItem[],
  trialBs: FreeeTrialBalanceResponse,
  purpose: FundReservePurpose
): { total: number; lines: OtherPurposeLine[] } {
  const lines = WALLETABLE_PURPOSE_MAP.filter((m) => m.purpose === purpose).map((m) => {
    const accountItem = accountItems.find((i) => i.walletable_id === m.walletableId);
    const balance = accountItem ? (findRow(trialBs.balances, accountItem.name)?.closing_balance ?? 0) : null;
    return { label: m.label, balance };
  });
  const total = lines.reduce((sum, l) => sum + (l.balance ?? 0), 0);
  return { total, lines };
}

/**
 * trial_bs・account_itemsの取得済みレスポンスから資金の備え(現預金を除く、freee由来の部分)を
 * 合成する。WALLETABLE_PURPOSE_MAPの口座分類を変更しても、この関数やUI側の変更は不要
 * (purpose別に合算するだけの汎用ロジックのため、ユーザー確定の設計要件2026-09-15)。
 */
export function buildFundReserveCore(params: {
  trialBs: FreeeTrialBalanceResponse;
  accountItems: FreeeAccountItem[];
}): FundReserveCore {
  // 保険積立金は勘定科目(資産)であり現金・預金カテゴリには含まれないため、
  // 現預金内拘束資金(cashRestrictedTotal)には絶対に混ぜない(二重控除防止)
  const insuranceAssetReserve = extractInsuranceAccountBalance(params.trialBs);

  // WALLETABLE_PURPOSE_MAPの対象はすべてfreeeのwalletableであり、構造的に必ず
  // 現金・預金カテゴリに含まれるため、purposeを問わずまとめて現預金内拘束資金とする
  const bonusPurpose = sumPurposeWalletables(params.accountItems, params.trialBs, "bonus");
  const insurancePurposeWalletables = sumPurposeWalletables(params.accountItems, params.trialBs, "insurance");
  const otherPurpose = sumPurposeWalletables(params.accountItems, params.trialBs, "other");
  const cashRestrictedTotal = bonusPurpose.total + insurancePurposeWalletables.total + otherPurpose.total;

  return {
    bonusReserveConfigured: BONUS_RESERVE_CONFIGURED,
    bonusReserve: bonusPurpose.total,
    otherPurposeLines: otherPurpose.lines,
    cashRestrictedTotal,
    insuranceAssetReserve,
  };
}

/**
 * FundReserveCore(freee由来、キャッシュ可能)と現預金(呼び出し側から渡す。月次資金収支の
 * 月末現預金と同じ値を使う想定)から、表示用のFundReserveを合成する。cash/freeCashは
 * 現預金の取得元(月次資金収支のキャッシュ有無)に応じて変わり得るため、常にその場で
 * 計算し、FundReserveCoreの側には保存しない(2026-09-15、過去月=Firestore/当月=freee
 * ライブの切り替え対応)。
 */
export function composeFundReserve(core: FundReserveCore, cash: number | null): FundReserve {
  const freeCash = cash === null ? null : cash - core.cashRestrictedTotal;
  return { ...core, cash, freeCash };
}

/**
 * freee接続済みの事業所から資金の備え(現預金を除く部分)を取得する。
 * company_id未確定(未接続)の場合はnull。
 */
export async function getFundReserveCore(fiscalYear: number, selectedMonth: number): Promise<FundReserveCore | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const [trialBs, accountItems] = await Promise.all([
    getTrialBs(companyId, { fiscalYear, startMonth: FISCAL_MONTH_ORDER[0], endMonth: selectedMonth }),
    getAccountItems(companyId),
  ]);
  return buildFundReserveCore({ trialBs, accountItems });
}
