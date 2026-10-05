import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialBs } from "@/services/freee/freeeAccountingClient";
import { getAccountItems } from "@/services/freee/freeeTransactionClient";
import type { FreeeAccountItem } from "@/services/freee/freeeTransactionClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { WALLETABLE_PURPOSE_MAP } from "@/config/fundReserveClassification";
import type { FundReservePurpose } from "@/config/fundReserveClassification";
import type { ManagementReserveSettings } from "./reserveSettings";

/**
 * 「資金の備え」(ストック)。借入状況と同じく月次資金収支(フロー)とは別枠で、手元資金のうち
 * どれだけが拘束・予定済みで、どれだけ余力があるかを表す。
 *
 * 経理報告「残高表銀行」との照合(2026-10-05)に基づき、次の4つを別々の指標として並べる
 * (ユーザー確定、2026-10-05。互いに定義が違うので1つの数字に統合しない):
 * 1. 現預金の内訳: 口座の性格(担保差入・納税用・その他目的・それ以外)による現預金総額の内訳
 * 2. 資金余力: 経理管理上の実質資金(経理報告の「担保及び消費税・賞与引当分除く実質残」に対応)
 * 3. 財務ポジション: 現預金総額 − 借入残高 = ネットキャッシュ
 * 4. その他の備え(参考): 保険積立金。現預金ではないので2・3の計算には含めない
 */

/** スナップショットの算出ロジックの版。保存済みの版が違えばキャッシュを使わず取り直す */
export const FUND_RESERVE_CALCULATION_VERSION = "fund-reserve-v2-2026-10-05";

export interface CashEarmarkLine {
  purpose: FundReservePurpose;
  label: string;
  /**
   * 対象walletableに対応するfreee勘定科目が見つからない場合はnull(0円と推測しない)。
   * 科目は見つかったがtrial_bs行が無い場合は、freeeが残高・動きゼロの科目行を省略する仕様
   * (実データ確認済み)に基づき0円として扱う。
   */
  balance: number | null;
}

/**
 * 資金の備えのうち、freeeから取得できる部分(現預金総額は含まない)。Firestoreスナップショットと
 * してキャッシュする対象はこちら。現預金総額は月次資金収支のスナップショットに既にあり、
 * 準備額・当座貸越枠はTCD独自の設定値のため、どちらもここには保存しない。
 */
export interface FundReserveCore {
  calculationVersion: string;
  /**
   * WALLETABLE_PURPOSE_MAPの口座ごとの、選択月末時点の残高。対象はすべてfreeeのwalletable
   * (銀行口座)であり、構造的に必ず「現金・預金」カテゴリ=現預金総額の内数になる。
   */
  cashEarmarkLines: CashEarmarkLine[];
  /**
   * 保険積立金(freee勘定科目「保険積立金」、account_category_name="投資その他の資産")の
   * 選択月末時点の残高。trial_bsの「現金・預金」カテゴリには一切含まれない(実データ確認済み)。
   */
  insuranceAssetReserve: number;
}

/**
 * 資金余力(経理管理上の実質資金) = 現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備。
 * 経理報告の「担保及び消費税・賞与引当分除く実質残」に対応する。長期借入金は引かない。
 *
 * 当座貸越は設定値の「枠」ではなく実際の利用額(freeeの短期借入金残高、loanStatus.tsの
 * computeOverdraftStatusのused)を引く。返済して利用額が減れば控除も減る(枠全額を引き続けない、
 * ユーザー確定 2026-10-05)。枠は借入状況の枠/利用額/空き枠の表示にだけ使う。
 * 消費税準備・賞与準備は設定値。控除項目が1つでも不明なら資金余力はnull(一部だけ引いた数字を出さない)。
 */
export interface FundCapacity {
  /** 当座貸越利用額。借入状況が取得できていなければnull */
  overdraftUsed: number | null;
  consumptionTaxReserve: number | null;
  bonusReserve: number | null;
  capacity: number | null;
  /** 適用した設定の基準日・出所。設定が無ければnull */
  settingsAsOf: string | null;
  settingsSource: string | null;
}

export interface FundReserve extends FundReserveCore {
  /** 現預金総額(呼び出し側から渡される。月次資金収支の月末現預金と同じ値) */
  cash: number | null;
  /** 現預金総額 − cashEarmarkLinesの合計(通常の運転資金口座の残高) */
  unearmarkedCash: number | null;
  capacity: FundCapacity;
  /** 借入残高(借入状況セクションの合計と同じ値) */
  loanTotal: number | null;
  /** ネットキャッシュ = 現預金総額 − 借入残高 */
  netCash: number | null;
}

/**
 * Firestoreへキャッシュするスナップショットの形。cash以下の合成値は現預金・設定値・借入残高の
 * 取得元によって変わり得るためキャッシュせず、常にcomposeFundReserveでその場で合成する。
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
 * trial_bs・account_itemsの取得済みレスポンスから資金の備え(freee由来の部分)を合成する。
 *
 * 口座残高はgetWalletables()のリアルタイム残高ではなく、account_items(walletable_idを持つ)経由で
 * 勘定科目名を特定し、trial_bsのclosing_balance(選択月末時点)から取る。過去月を表示しても
 * 「現在」の残高が混ざらないようにするため(2026-09-15修正)。
 * WALLETABLE_PURPOSE_MAPの口座分類を変更しても、この関数やUI側の変更は不要。
 */
export function buildFundReserveCore(params: {
  trialBs: FreeeTrialBalanceResponse;
  accountItems: FreeeAccountItem[];
}): FundReserveCore {
  const cashEarmarkLines = WALLETABLE_PURPOSE_MAP.map((m) => {
    const accountItem = params.accountItems.find((i) => i.walletable_id === m.walletableId);
    const balance = accountItem ? (findRow(params.trialBs.balances, accountItem.name)?.closing_balance ?? 0) : null;
    return { purpose: m.purpose, label: m.label, balance };
  });

  return {
    calculationVersion: FUND_RESERVE_CALCULATION_VERSION,
    cashEarmarkLines,
    insuranceAssetReserve: extractInsuranceAccountBalance(params.trialBs),
  };
}

export function computeFundCapacity(
  cash: number | null,
  overdraftUsed: number | null,
  settings: ManagementReserveSettings | null
): FundCapacity {
  const consumptionTaxReserve = settings?.consumptionTaxReserve ?? null;
  const bonusReserve = settings?.bonusReserve ?? null;
  const capacity =
    cash === null || overdraftUsed === null || consumptionTaxReserve === null || bonusReserve === null
      ? null
      : cash - overdraftUsed - consumptionTaxReserve - bonusReserve;
  return {
    overdraftUsed,
    consumptionTaxReserve,
    bonusReserve,
    capacity,
    settingsAsOf: settings?.asOf ?? null,
    settingsSource: settings?.source ?? null,
  };
}

/**
 * FundReserveCore(freee由来、キャッシュ可能)に、現預金総額(月次資金収支の月末現預金)・
 * 設定値・借入残高・当座貸越利用額を合わせて表示用のFundReserveを合成する。UI側では計算しない。
 */
export function composeFundReserve(
  core: FundReserveCore,
  inputs: {
    cash: number | null;
    settings: ManagementReserveSettings | null;
    loanTotal: number | null;
    /** 当座貸越利用額(computeOverdraftStatusのused)。借入状況が取得できていなければnull */
    overdraftUsed: number | null;
  }
): FundReserve {
  const { cash, settings, loanTotal, overdraftUsed } = inputs;
  const earmarkedTotal = core.cashEarmarkLines.reduce((sum, l) => sum + (l.balance ?? 0), 0);
  return {
    ...core,
    cash,
    unearmarkedCash: cash === null ? null : cash - earmarkedTotal,
    capacity: computeFundCapacity(cash, overdraftUsed, settings),
    loanTotal,
    netCash: cash === null || loanTotal === null ? null : cash - loanTotal,
  };
}

/**
 * freee接続済みの事業所から資金の備え(freee由来の部分)を取得する。
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
