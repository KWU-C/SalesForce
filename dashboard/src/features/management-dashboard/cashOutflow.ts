import type { ExpenseCategory } from "@/config/freeeExpenseClassification";

/** 未分類として残した出金の明細(金額・日付・借方科目のみ。摘要・取引先名は保存しない) */
export interface UnclassifiedOutflowItem {
  date: string;
  amount: number;
  /** 未分類にした理由 */
  reason: "payable_untraceable" | "balance_sheet_account" | "no_debit_account";
  /** 借方の科目名(債務の場合は債務科目名、取引先名は含めない) */
  account: string;
}

/**
 * 「給与・人件費」の内訳(参考表示。合計はCashOutflowBreakdown.laborと一致する)。
 * 「うち従業員給与計」＝employeeSalary＋employeeBonus＋指定業務委託の合計(contractors)。
 * 役員報酬・役員賞与(executive)、退職金(retirement)は含めない。
 */
export interface LaborDetail {
  employeeSalary: number;
  employeeBonus: number;
  /** 役員報酬・役員賞与 */
  executive: number;
  retirement: number;
  /** 指定業務委託(氏名→金額)。外注費から給与・人件費へ移した分 */
  contractors: Record<string, number>;
}

export const EMPTY_LABOR_DETAIL: LaborDetail = {
  employeeSalary: 0,
  employeeBonus: 0,
  executive: 0,
  retirement: 0,
  contractors: {},
};

/** うち従業員給与計 = 従業員給与 + 従業員賞与 + 指定業務委託 */
export function employeeSalarySubtotal(detail: LaborDetail): number {
  return (
    detail.employeeSalary +
    detail.employeeBonus +
    Object.values(detail.contractors).reduce((s, v) => s + v, 0)
  );
}

/**
 * 出金(キャッシュアウト)の区分別内訳。仕訳帳の「現金・預金(集計境界内)の貸方行」を、同じ伝票内の
 * 借方科目で分類した値。total(=外部支出)は9区分の合計。通期は12か月の単純合計
 * (通期専用の別計算は無い)。
 */
export interface CashOutflowBreakdown {
  /** 給与・人件費(旧称: 人件費)。内訳はlaborDetail */
  labor: number;
  outsourcing: number;
  taxSocial: number;
  otherOperating: number;
  other: number;
  financing: number;
  interest: number;
  assetTransfer: number;
  /** 仕訳科目でも摘要ルールでも判定できない出金(債務の原因科目が辿れない・立替金/仮払金等の残高科目) */
  unclassified: number;
  /** 上記9区分の合計。これが外部支出(キャッシュアウト合計) */
  total: number;
  /** 参考(totalに含めない): 自社の現金・預金口座間の資金移動(出金側の額。入金側の内部移動と同額) */
  internalTransfer: number;
  /** 参考(totalに含めない): 銀行明細にあるが帳簿に無い同日・同口座・同額の出金側(NET_ZERO_ROUND_TRIPS) */
  netZeroRoundTrip: number;
  /** 参考(totalから控除済み): 入金として記帳されているが実際は出金の訂正だった額(総額/純額差) */
  outflowCorrections: number;
  /** 参考(totalに含めない): 入金時差引として営業入金から純額化済みの現金貸方(入金側で控除するため出金に数えない) */
  atSourceDeductionsExcluded: number;
  /** 参考(totalの内数): 銀行明細フィードが無い期間・口座の外部支出(帳簿補完) */
  ledgerOnly: number;
  /** 参考: 債務(未払金・買掛金)の精算のうち、原因科目を辿って分類した額/摘要ルールで分類した額(補助判定) */
  payableTraced: number;
  payableByMemoRule: number;
  /** 給与・人件費の内訳(参考表示)。v3.1より前の保存分には無い */
  laborDetail: LaborDetail;
  unclassifiedItems: UnclassifiedOutflowItem[];
  appliedEvidenceIds: string[];
}

export const EMPTY_OUTFLOW: CashOutflowBreakdown = {
  labor: 0,
  outsourcing: 0,
  taxSocial: 0,
  otherOperating: 0,
  other: 0,
  financing: 0,
  interest: 0,
  assetTransfer: 0,
  unclassified: 0,
  total: 0,
  internalTransfer: 0,
  netZeroRoundTrip: 0,
  outflowCorrections: 0,
  atSourceDeductionsExcluded: 0,
  ledgerOnly: 0,
  payableTraced: 0,
  payableByMemoRule: 0,
  laborDetail: EMPTY_LABOR_DETAIL,
  unclassifiedItems: [],
  appliedEvidenceIds: [],
};

export type OutflowCategory = ExpenseCategory | "unclassified";
export const OUTFLOW_CATEGORIES: readonly OutflowCategory[] = [
  "labor",
  "outsourcing",
  "taxSocial",
  "otherOperating",
  "other",
  "financing",
  "interest",
  "assetTransfer",
  "unclassified",
];

/** 複数か月(または期)のCashOutflowBreakdownを単純合計する */
export function sumOutflows(outflows: CashOutflowBreakdown[]): CashOutflowBreakdown {
  const sum = (get: (o: CashOutflowBreakdown) => number) => outflows.reduce((t, o) => t + get(o), 0);
  return {
    labor: sum((o) => o.labor),
    outsourcing: sum((o) => o.outsourcing),
    taxSocial: sum((o) => o.taxSocial),
    otherOperating: sum((o) => o.otherOperating),
    other: sum((o) => o.other),
    financing: sum((o) => o.financing),
    interest: sum((o) => o.interest),
    assetTransfer: sum((o) => o.assetTransfer),
    unclassified: sum((o) => o.unclassified),
    total: sum((o) => o.total),
    internalTransfer: sum((o) => o.internalTransfer),
    netZeroRoundTrip: sum((o) => o.netZeroRoundTrip),
    outflowCorrections: sum((o) => o.outflowCorrections),
    atSourceDeductionsExcluded: sum((o) => o.atSourceDeductionsExcluded),
    ledgerOnly: sum((o) => o.ledgerOnly),
    payableTraced: sum((o) => o.payableTraced),
    payableByMemoRule: sum((o) => o.payableByMemoRule),
    laborDetail: sumLaborDetails(outflows.map((o) => o.laborDetail)),
    unclassifiedItems: outflows.flatMap((o) => o.unclassifiedItems),
    appliedEvidenceIds: outflows.flatMap((o) => o.appliedEvidenceIds),
  };
}

export function sumLaborDetails(details: (LaborDetail | undefined)[]): LaborDetail {
  const contractors: Record<string, number> = {};
  let employeeSalary = 0;
  let employeeBonus = 0;
  let executive = 0;
  let retirement = 0;
  for (const d of details) {
    if (!d) continue;
    employeeSalary += d.employeeSalary;
    employeeBonus += d.employeeBonus;
    executive += d.executive;
    retirement += d.retirement;
    for (const [name, amount] of Object.entries(d.contractors)) contractors[name] = (contractors[name] ?? 0) + amount;
  }
  return { employeeSalary, employeeBonus, executive, retirement, contractors };
}
