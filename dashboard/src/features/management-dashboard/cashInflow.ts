/** 未分類として残した入金の明細(金額・日付・相手科目のみ。摘要・取引先名は保存しない) */
export interface UnclassifiedInflowItem {
  date: string;
  amount: number;
  accounts: string[];
}

/**
 * 入金(キャッシュイン)の区分別内訳。仕訳帳の「現金・預金(銀行口座)借方」を、同じ伝票内の
 * 相手科目で分類した値。total(=外部入金)は5区分の合計で、通期は12か月の単純合計になる
 * (通期専用の別計算は無い、ユーザー確定、2026-09-19)。
 */
export interface CashInflowBreakdown {
  /** 営業入金: P/L売上に対応する営業債権(売掛金・受取手形・電子債権)等の実際の現金回収額(差引手数料・源泉税控除後) */
  operating: number;
  /** operatingのうち、銀行明細フィードに存在せず帳簿(仕訳帳)で補完したもの(49期の移行期のみ。内数) */
  operatingLedgerOnly: number;
  /** 借入による入金(実着金額。保証料・利息等の差引後) */
  borrowing: number;
  /** 保険・資産回収等(保険解約返戻金、資産の売却・回収) */
  assetRecovery: number;
  /** その他(還付・補助金・利息・雑収入・立替返金等) */
  other: number;
  /** 未分類(仮受金・仮払金など、相手科目から性質を判定できないもの) */
  unclassified: number;
  /** 上記5区分の合計。これが外部入金(キャッシュイン合計) */
  total: number;
  /** 参考(totalに含めない): 自社の現金・預金口座間の資金移動(積金・定期預金の元本を含む) */
  internalTransfer: number;
  /** 参考(totalに含めない): 銀行明細にあるが帳簿に無い同日・同口座・同額の入金側(NET_ZERO_ROUND_TRIPS) */
  netZeroRoundTrip: number;
  /** 参考(operatingに反映済み): 入金時に相手方が差し引き銀行には純額しか現れない分 */
  atSourceDeductions: number;
  /** 参考(totalに含めない): 入金として記帳されているが実際は同日・同口座の出金の訂正だった額(出金側で純額化) */
  reclassifiedAsOutflowCorrection: number;
  unclassifiedItems: UnclassifiedInflowItem[];
  /** この期間に適用された証拠付き補完・除外の記録ID(監査用) */
  appliedEvidenceIds: string[];
}

export const EMPTY_INFLOW: CashInflowBreakdown = {
  operating: 0,
  operatingLedgerOnly: 0,
  borrowing: 0,
  assetRecovery: 0,
  other: 0,
  unclassified: 0,
  total: 0,
  internalTransfer: 0,
  netZeroRoundTrip: 0,
  atSourceDeductions: 0,
  reclassifiedAsOutflowCorrection: 0,
  unclassifiedItems: [],
  appliedEvidenceIds: [],
};

/** 複数か月(または期)のCashInflowBreakdownを単純合計する。通期=12か月合計をこの関数だけで作る */
export function sumInflows(inflows: CashInflowBreakdown[]): CashInflowBreakdown {
  const sum = (get: (i: CashInflowBreakdown) => number) => inflows.reduce((t, i) => t + get(i), 0);
  return {
    operating: sum((i) => i.operating),
    operatingLedgerOnly: sum((i) => i.operatingLedgerOnly),
    borrowing: sum((i) => i.borrowing),
    assetRecovery: sum((i) => i.assetRecovery),
    other: sum((i) => i.other),
    unclassified: sum((i) => i.unclassified),
    total: sum((i) => i.total),
    internalTransfer: sum((i) => i.internalTransfer),
    netZeroRoundTrip: sum((i) => i.netZeroRoundTrip),
    atSourceDeductions: sum((i) => i.atSourceDeductions),
    reclassifiedAsOutflowCorrection: sum((i) => i.reclassifiedAsOutflowCorrection),
    unclassifiedItems: inflows.flatMap((i) => i.unclassifiedItems),
    appliedEvidenceIds: inflows.flatMap((i) => i.appliedEvidenceIds),
  };
}
