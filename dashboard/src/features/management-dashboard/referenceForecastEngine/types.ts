import type {
  RfBonusMonth,
  RfDeal,
  RfManualJournal,
  RfPayrollMonth,
  RfTransfer,
  RfTrialBsRow,
  RfWalletable,
  RfWalletTxn,
} from "@/services/freee/freeeReferenceForecastClient";

export type { RfBonusMonth, RfDeal, RfManualJournal, RfPayrollMonth, RfTransfer, RfTrialBsRow, RfWalletable, RfWalletTxn };

/** Salesforceの案件(Process__c)のうち、入金照合に使う項目 */
export interface RfSfProcess {
  id: string;
  phase: string;
  probability: string;
  billedDate: string | null;
  plannedReceiptDate: string | null;
  amountTaxIncluded: number;
  billToName: string;
}

/** Salesforceの原価(Cost__c)のうち、未登録の外注の確認に使う項目 */
export interface RfSfCost {
  purchaseDate: string | null;
  amountTaxIncluded: number;
  vendorName: string;
}

/** 参考予測の計算に使う入力(freee・Salesforceから集めたもの)。計算は純粋関数で行う */
export interface RfInputs {
  /** 計算した日時(ISO、日本時間) */
  computedAt: string;
  /** 銀行明細の最終日(連携口座の明細がある最後の日)。予測の基準日 */
  bankSyncedThrough: string;
  /** 口座ごとのfreeeの最終更新日の範囲(表示用) */
  walletableUpdateRange: { min: string | null; max: string | null };
  /** 基準日の口座残高(freeeの試算表、現金・預金の科目) */
  baseBalances: { checking: number; timeDeposit: number; cash: number };
  partners: Map<number, string>;
  walletables: RfWalletable[];
  /** 基準日の13か月前の月初〜基準日の翌月末 */
  walletTxns: RfWalletTxn[];
  transfers: RfTransfer[];
  incomeDeals: RfDeal[];
  expenseDeals: RfDeal[];
  /** 月(YYYY-MM)ごとの給与明細の合計。直近3か月・当月・翌月・翌月の前年同月 */
  payroll: Record<string, RfPayrollMonth | null>;
  /** 月ごとの賞与明細の合計(当月・翌月) */
  bonus: Record<string, RfBonusMonth | null>;
  /** 賞与の支給実績(前年の同じ月の振替伝票・取引から) */
  bonusHistory: Record<string, { payDate: string | null; gross: number; deductions: number; net: number }>;
  sfProcesses: RfSfProcess[];
  sfCosts: RfSfCost[];
  reserve: RfReserveInputs;
}

/** 準備額・支払見込額の計算に使う入力 */
export interface RfReserveInputs {
  /** 月(YYYY-MM)ごとの試算表(期首〜その月末、品目の内訳つき)。締まった直近2か月と基準日の月 */
  trialBsByMonth: Record<string, RfTrialBsRow[]>;
  /** 仮払税金の取引(前期の期首以降) */
  provisionalTaxDeals: RfDeal[];
  /** 未払消費税等の取引(前期の期首以降) */
  consumptionTaxPayableDeals: RfDeal[];
  /** 未払消費税等の振替伝票(前期の期首以降) */
  consumptionTaxPayableJournals: RfManualJournal[];
  /** 前期末の仮受消費税の振替伝票(決算振替) */
  closingJournals: RfManualJournal[];
}
