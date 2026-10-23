import { classifyExpenseAccountItem } from "@/config/freeeExpenseClassification";
import type { CashForecastSettings } from "@/config/cashForecastSettings";
import type {
  ForecastDeal,
  ForecastTransfer,
  ForecastWalletTxn,
  ForecastWalletable,
  PayrollMonth,
} from "@/services/freee/freeeForecastClient";

/**
 * 資金繰り予測(第2段階)の計算。入力はすべて取得済みのデータで、ここではfreee・Firestoreに
 * 触れず、保存もしない(ユーザー確定、2026-10-21)。
 *
 * 原則:
 * - 同じ月・同じ費目で出所を1つに決め、予定(未決済取引・給与明細など)と推計(過去実績)を
 *   足し合わせない。採用した額と、予定額・推計額・採用ルールを行ごとに残す
 * - 金額が分からない項目(賞与明細が無い賞与月、根拠の無い一時的な納付)は0円にせず「未反映」とし、
 *   その月以降の月末残高を「未反映支出を含まない参考値」として扱う
 * - 必要な取得元が1つでも失敗したら予測値を作らない(0円の予測を出さない)
 * - 帳簿未登録の銀行明細は、未登録というだけでは残高に足さない。予定取引と照合できたものだけを
 *   当月の入出金として扱い、照合できないものは警告にとどめる
 *
 * 位置付けと既知の課題(ユーザー確定、2026-10-21):
 * - 資金繰りの「保守的な参考予測」。本番での公開は別途判断する
 * - 【未解決】月末残高を系統的に低く見積もる。2026-02〜09を基準日にしたバックテストで、当月-6%、
 *   3か月後-28%前後。主因は営業入金の過小(伸び率の上限で売上の伸びに追いつかない)と、
 *   諸経費・税金のやや過大。数値は補正していない
 * - 参考変動幅(referenceRange)は月々のばらつきだけから計算しており、上記の偏りを含まない
 *   (バックテストで実際の誤差が幅に収まったのは各予測先で0〜2件)。十分な実績で誤差を検証するまで
 *   画面には表示せず、計算と記録だけを続ける
 */

/** YYYY-MM */
export type YearMonth = string;

/** 月次資金収支スナップショットから取り出した、1か月分の実績(費目別) */
export interface MonthActual {
  inflowOperating: number;
  labor: number;
  outsourcing: number;
  otherOperating: number;
  other: number;
  taxSocial: number;
  financing: number;
  interest: number;
  assetTransfer: number;
  cashOpening: number | null;
  cashClosing: number | null;
  /** 種類別の月末残高(項目追加前の保存分には無い) */
  timeDepositClosing?: number | null;
  cashOnHandClosing?: number | null;
}

export type ForecastSource =
  | "deals"
  | "salary_statements"
  | "bonus_statements"
  | "trial_bs"
  | "transfers"
  | "wallet_txns"
  | "walletables"
  | "account_items"
  | "monthly_cash_flow";

export interface SourceFailure {
  source: ForecastSource | string;
  kind: string;
}

export interface ForecastInputs {
  /** 予測の基準日(YYYY-MM-DD)。この日を含む月が「当月」 */
  baseDate: string;
  /**
   * live: 今の時点のデータで予測する(未決済取引はすべて既知)
   * backtest: 過去の基準日で予測する。基準日より前に発生した取引と、返済予定(発生日が未来でも
   *   一括登録されている)だけを既知とみなす(登録日時はfreeeから取れないため)
   */
  mode: "live" | "backtest";
  /** 完了した月の実績(基準月より前) */
  actuals: Record<YearMonth, MonthActual>;
  /** 当月の、基準日までの実績(liveのみ)。基準日が月初・backtestならnull */
  currentMonthToDate: MonthActual | null;
  deals: ForecastDeal[];
  /** キーは `${kind}-${YYYY-MM}`。明細が無い月はキー自体が無い */
  payroll: Record<string, PayrollMonth>;
  /** 一時的な納付の根拠にする負債科目の、直近の月末残高 */
  liabilities: { asOfMonth: YearMonth; balances: Record<string, number> } | null;
  /** 帳簿未登録の銀行明細(liveのみ) */
  unbookedBankTxns: ForecastWalletTxn[];
  walletables: ForecastWalletable[];
  /** 定期預金への振替の推計用(直近の期間) */
  transfers: ForecastTransfer[];
  timeDepositWalletableIds: number[];
  /** 取得に失敗した取得元(1つでもあれば予測しない) */
  failures: SourceFailure[];
}

export interface ScheduledPart {
  amount: number;
  count: number;
  source: "deals" | "salary_statements" | "bonus_statements" | "liability";
  /** 未確定の給与明細を、件数・金額が直近の確定済みの月と近いため採用した(確定扱いではない) */
  provisional?: boolean;
}

export interface EstimatedPart {
  amount: number;
  method: string;
  basisMonths: YearMonth[];
}

export type AdoptionRule =
  | "scheduled"
  | "estimated"
  | "max"
  | "scheduled+supplement"
  | "toDate+remaining"
  | "none";

export interface ForecastLine {
  key: string;
  label: string;
  direction: "in" | "out";
  scheduled: ScheduledPart | null;
  estimated: EstimatedPart | null;
  /** 当月の基準日までの実績(liveの当月のみ) */
  toDate: number | null;
  /** 予測に採用した額。根拠が無い(データ不足・未反映)場合はnull */
  adopted: number | null;
  rule: AdoptionRule;
  /** 参考変動幅の計算に使う、この行の推計部分の月あたりのばらつき(推計が無ければnull) */
  monthlyDispersion: number | null;
}

export interface UnreflectedItem {
  key: string;
  label: string;
  reason: string;
}

export interface ForecastMonth {
  month: YearMonth;
  /** 0=当月 */
  horizon: number;
  tier: "forecast" | "estimate";
  openingBalance: number;
  closingBalance: number;
  /** complete: 未反映項目なし / excludesUnreflected: その月以前に未反映支出があり、参考値 */
  closingBasis: "complete" | "excludesUnreflected";
  /** 参考変動幅(±、確率の意味は持たない)。計算できなければnull。誤差の検証が済むまで画面には出さない */
  referenceRange: number | null;
  timeDeposit: number | null;
  cashOnHand: number | null;
  checkingSavings: number | null;
  lines: ForecastLine[];
  unreflected: UnreflectedItem[];
}

export interface GrowthInfo {
  /** 切り詰め・上下限の前の値。計算できなければnull */
  raw: number | null;
  applied: number;
  clamped: boolean;
  winsorizedMonths: YearMonth[];
  /** 計算に使った月(直近6か月) */
  basisMonths: YearMonth[];
}

export type ForecastWarningCode =
  | "unreflected"
  | "loan_supplemented"
  | "unbooked_unmatched"
  | "unbooked_matched"
  | "sync_delay"
  | "growth_unavailable"
  | "insufficient_history"
  | "payroll_payment_unconfirmed"
  | "payroll_unfixed_adopted"
  | "payroll_incomplete"
  | "overdue_receivables"
  | "labor_ratio_unavailable"
  | "to_date_unavailable";

export interface ForecastWarning {
  code: ForecastWarningCode;
  message: string;
  /** 金額を伴う警告の合計額(件数だけの警告はnull) */
  amount: number | null;
  /** 画面に出す件数(借入の補完なら借入先の実数) */
  count: number | null;
  /** 内部集計用の延べ件数(借入の補完なら 月×借入先 ＋ 会社全体の下限で補った月)。画面には出さない */
  occurrences?: number;
}

export type CashForecastResult =
  | { status: "failed"; baseDate: string; failures: SourceFailure[] }
  | {
      status: "ok";
      baseDate: string;
      settings: CashForecastSettings;
      growth: GrowthInfo;
      months: ForecastMonth[];
      warnings: ForecastWarning[];
    };

// ---------------------------------------------------------------------------
// 日付・統計の小道具

export function addMonths(month: YearMonth, k: number): YearMonth {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function addDays(date: string, k: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 中央値からのばらつき(MAD×1.4826)。外れ値に強い月あたりのばらつきの目安 */
export function robustDispersion(values: number[]): number {
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}

/** 基準月の直前からn か月分の実績(古い順ではなく新しい順)。1か月でも欠けていればnull */
function recent(actuals: Record<YearMonth, MonthActual>, baseMonth: YearMonth, n: number): { month: YearMonth; actual: MonthActual }[] | null {
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const month = addMonths(baseMonth, -k);
    const actual = actuals[month];
    if (!actual) return null;
    rows.push({ month, actual });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 取引の扱い

const LOAN_CATEGORIES = new Set(["financing", "interest"]);

function isCashWallet(type: string | null): boolean {
  return type === "bank_account" || type === "wallet";
}

function detailCategory(deal: ForecastDeal, accountName: string, settings: CashForecastSettings): string {
  if (deal.type === "income") return settings.operatingIncomeAccounts.includes(accountName) ? "inflowOperating" : "inflowOther";
  return classifyExpenseAccountItem(accountName);
}

function isLoanSchedule(deal: ForecastDeal): boolean {
  return deal.type === "expense" && deal.details.length > 0 && deal.details.every((d) => LOAN_CATEGORIES.has(classifyExpenseAccountItem(d.accountName)));
}

/** 基準日時点で、その取引を知り得たか */
function isKnown(deal: ForecastDeal, inputs: ForecastInputs): boolean {
  return inputs.mode === "live" || deal.issueDate < inputs.baseDate || isLoanSchedule(deal);
}

/** 基準日時点の未決済額 */
function unpaidAt(deal: ForecastDeal, inputs: ForecastInputs): number {
  if (inputs.mode === "live") return deal.status === "unsettled" ? deal.dueAmount : 0;
  return deal.amount - deal.payments.filter((p) => p.date < inputs.baseDate).reduce((s, p) => s + p.amount, 0);
}

/** 取引の未決済額を明細の金額比で費目に配分する */
function allocate(deal: ForecastDeal, amount: number, settings: CashForecastSettings): Map<string, number> {
  const out = new Map<string, number>();
  const total = deal.details.reduce((s, d) => s + d.amount, 0);
  if (total === 0) return out;
  for (const d of deal.details) {
    const c = detailCategory(deal, d.accountName, settings);
    out.set(c, (out.get(c) ?? 0) + (amount * d.amount) / total);
  }
  return out;
}

interface ScheduledIndex {
  /** 月 → 費目 → {金額, 件数} */
  byMonth: Map<YearMonth, Map<string, { amount: number; count: number }>>;
  /** 月 → 借入先 → 金額(返済予定) */
  loansByMonth: Map<YearMonth, Map<string, number>>;
  overdueReceivables: { amount: number; count: number };
}

function lenderKey(deal: ForecastDeal): string {
  return deal.partnerId === null ? "partner:none" : `partner:${deal.partnerId}`;
}

function buildScheduledIndex(inputs: ForecastInputs, settings: CashForecastSettings, matchedDealIds: Set<number>): ScheduledIndex {
  const byMonth: ScheduledIndex["byMonth"] = new Map();
  const loansByMonth: ScheduledIndex["loansByMonth"] = new Map();
  const overdue = { amount: 0, count: 0 };
  const baseMonth = inputs.baseDate.slice(0, 7);
  for (const deal of inputs.deals) {
    if (!deal.dueDate || !isKnown(deal, inputs)) continue;
    const unpaid = unpaidAt(deal, inputs);
    if (unpaid <= 0) continue;
    // 期日が基準日より前の未決済は、帳簿未登録の銀行明細と照合できたものだけ当月に入れる。それ以外は期日超過
    let month = deal.dueDate.slice(0, 7);
    if (deal.dueDate < inputs.baseDate) {
      if (matchedDealIds.has(deal.id)) month = baseMonth;
      else {
        if (deal.type === "income") {
          overdue.amount += unpaid;
          overdue.count += 1;
        }
        continue;
      }
    }
    const cats = byMonth.get(month) ?? new Map();
    for (const [c, a] of allocate(deal, unpaid, settings)) {
      const cur = cats.get(c) ?? { amount: 0, count: 0 };
      cats.set(c, { amount: cur.amount + a, count: cur.count + 1 });
    }
    byMonth.set(month, cats);
    if (isLoanSchedule(deal)) {
      const lenders = loansByMonth.get(month) ?? new Map();
      lenders.set(lenderKey(deal), (lenders.get(lenderKey(deal)) ?? 0) + unpaid);
      loansByMonth.set(month, lenders);
    }
  }
  return { byMonth, loansByMonth, overdueReceivables: overdue };
}

function scheduledOf(index: ScheduledIndex, month: YearMonth, key: string): ScheduledPart | null {
  const v = index.byMonth.get(month)?.get(key);
  return v ? { amount: v.amount, count: v.count, source: "deals" } : null;
}

/** 借入先ごとの、直近の月ごとの返済額(現金口座からの支払、基準月の直前の期間) */
function loanHistory(inputs: ForecastInputs, baseMonth: YearMonth, window: number): Map<string, number[]> {
  const months = Array.from({ length: window }, (_, i) => addMonths(baseMonth, -(i + 1)));
  const out = new Map<string, number[]>();
  for (const deal of inputs.deals) {
    if (!isLoanSchedule(deal)) continue;
    for (const p of deal.payments) {
      if (!isCashWallet(p.walletableType) || p.date >= inputs.baseDate) continue;
      const idx = months.indexOf(p.date.slice(0, 7));
      if (idx < 0) continue;
      const row = out.get(lenderKey(deal)) ?? Array(window).fill(0);
      row[idx] += p.amount;
      out.set(lenderKey(deal), row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 帳簿未登録の銀行明細の照合

interface UnbookedMatch {
  matchedDealIds: Set<number>;
  matched: { amount: number; count: number };
  unmatched: { amount: number; count: number; oldest: string | null };
}

/**
 * 帳簿未登録の銀行明細を、未決済の予定取引と照合する。同じ入出金の向き・未決済額と完全一致・
 * 期日の前後N日以内で、1件の取引には1件の明細しか対応させない。照合できた取引は予定として
 * 当月に計上し(明細の額は別に足さない)、照合できない明細は残高に足さず警告だけ出す。
 */
function matchUnbooked(inputs: ForecastInputs, settings: CashForecastSettings): UnbookedMatch {
  const result: UnbookedMatch = { matchedDealIds: new Set(), matched: { amount: 0, count: 0 }, unmatched: { amount: 0, count: 0, oldest: null } };
  if (inputs.mode !== "live") return result;
  for (const txn of inputs.unbookedBankTxns) {
    if (txn.date > inputs.baseDate) continue;
    const amount = txn.dueAmount > 0 ? txn.dueAmount : txn.amount;
    const deal = inputs.deals.find(
      (d) =>
        !result.matchedDealIds.has(d.id) &&
        d.status === "unsettled" &&
        d.type === txn.entrySide &&
        d.dueAmount === amount &&
        d.dueDate !== null &&
        Math.abs(daysBetween(d.dueDate, txn.date)) <= settings.unbookedMatchDays
    );
    if (deal) {
      result.matchedDealIds.add(deal.id);
      result.matched.amount += amount;
      result.matched.count += 1;
    } else {
      result.unmatched.amount += amount;
      result.unmatched.count += 1;
      if (result.unmatched.oldest === null || txn.date < result.unmatched.oldest) result.unmatched.oldest = txn.date;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 費目ごとの推計

/** 営業入金の伸び率(直近3か月平均 ÷ その前の3か月平均、各月を中央値の範囲へ切り詰めてから) */
export function computeGrowth(inputs: ForecastInputs, settings: CashForecastSettings): GrowthInfo {
  const baseMonth = inputs.baseDate.slice(0, 7);
  const w = settings.averageWindowMonths;
  const rows = recent(inputs.actuals, baseMonth, w * 2);
  if (!rows) return { raw: null, applied: 1, clamped: false, winsorizedMonths: [], basisMonths: [] };
  const values = rows.map((r) => r.actual.inflowOperating);
  const med = median(values);
  const lo = med * settings.growthWinsorize.min;
  const hi = med * settings.growthWinsorize.max;
  const winsorizedMonths: YearMonth[] = [];
  const clipped = values.map((v, i) => {
    if (v < lo || v > hi) winsorizedMonths.push(rows[i].month);
    return Math.min(hi, Math.max(lo, v));
  });
  const prev = mean(clipped.slice(w));
  if (prev <= 0) return { raw: null, applied: 1, clamped: false, winsorizedMonths, basisMonths: rows.map((r) => r.month) };
  const raw = mean(clipped.slice(0, w)) / prev;
  const applied = Math.min(settings.growthClamp.max, Math.max(settings.growthClamp.min, raw));
  return { raw, applied, clamped: applied !== raw, winsorizedMonths, basisMonths: rows.map((r) => r.month) };
}

type ActualKey = "inflowOperating" | "labor" | "outsourcing" | "otherOperating" | "other" | "taxSocial" | "assetTransfer";

function averageOf(inputs: ForecastInputs, baseMonth: YearMonth, key: ActualKey, window: number): EstimatedPart | null {
  const rows = recent(inputs.actuals, baseMonth, window);
  if (!rows) return null;
  return { amount: mean(rows.map((r) => r.actual[key])), method: `直近${window}か月平均`, basisMonths: rows.map((r) => r.month) };
}

function dispersionOf(inputs: ForecastInputs, baseMonth: YearMonth, pick: (a: MonthActual) => number): number | null {
  const rows = recent(inputs.actuals, baseMonth, 6);
  return rows ? robustDispersion(rows.map((r) => pick(r.actual))) : null;
}

/** 税金・社会保険の月額(一時的な納付の月を外した中央値) */
function taxBase(inputs: ForecastInputs, baseMonth: YearMonth, settings: CashForecastSettings): EstimatedPart | null {
  const months: { month: YearMonth; v: number }[] = [];
  for (let k = 1; k <= settings.taxMedianWindowMonths; k++) {
    const month = addMonths(baseMonth, -k);
    const a = inputs.actuals[month];
    if (a) months.push({ month, v: a.taxSocial });
  }
  if (months.length < 3) return null;
  const med = median(months.map((m) => m.v));
  const kept = months.filter((m) => m.v <= med * settings.taxLumpThreshold);
  const use = kept.length >= 3 ? kept : months;
  return {
    amount: median(use.map((m) => m.v)),
    method: `直近${settings.taxMedianWindowMonths}か月の中央値(一時的な納付の月を除く)`,
    basisMonths: use.map((m) => m.month),
  };
}

/** freeeの確定フラグが、その月の明細の全件に立っているか */
function isFixed(p: PayrollMonth): boolean {
  return p.statementCount > 0 && p.fixedCount === p.statementCount;
}

type SalaryJudgement = { status: "fixed" | "provisional" | "incomplete"; reason: string };

/**
 * 給与明細をその月の予定として採用できるか(ユーザー確定、2026-10-23)。
 * - 全件確定: 採用する(freeeの確定状態を優先)
 * - 未確定: 直近の全件確定の月と件数・差引支給額の合計を比べ、件数が基準以上かつ金額が範囲内のときだけ
 *   「未確定のまま」採用する。件数だけでは採用しない
 * - それ以外(比べる月が無い場合を含む): 作成途中とみなし採用しない
 */
function judgeSalary(inputs: ForecastInputs, p: PayrollMonth, settings: CashForecastSettings): SalaryJudgement {
  if (isFixed(p)) return { status: "fixed", reason: "全件確定" };
  const ref = latestSalaryStatement(inputs, addMonths(p.month, -1));
  if (!ref) return { status: "incomplete", reason: "未確定で、比べられる確定済みの月がありません" };
  const { minCountRatio, amountRatio } = settings.payrollUnfixedAdoption;
  const countRatio = p.statementCount / ref.statementCount;
  const amount = ref.netTotal > 0 ? p.netTotal / ref.netTotal : null;
  const basis = `件数${p.statementCount}/${ref.statementCount}件・金額比${amount === null ? "—" : amount.toFixed(2)}(比較: ${ref.month})`;
  if (countRatio >= minCountRatio && amount !== null && amount >= amountRatio.min && amount <= amountRatio.max) {
    return { status: "provisional", reason: `未確定。${basis}` };
  }
  return { status: "incomplete", reason: `未確定で作成途中とみなしました。${basis}` };
}

/** 給与の実績比率(人件費の実績 ÷ 給与明細の差引支給額、賞与月を除く直近3か月の中央値) */
function laborRatio(inputs: ForecastInputs, baseMonth: YearMonth, settings: CashForecastSettings): number | null {
  const ratios: number[] = [];
  for (let k = 1; k <= 12 && ratios.length < 3; k++) {
    const month = addMonths(baseMonth, -k);
    if (settings.bonusMonths.includes(Number(month.slice(5)))) continue;
    const a = inputs.actuals[month];
    const p = inputs.payroll[`salary-${month}`];
    if (a && p && isFixed(p) && p.netTotal > 0) ratios.push(a.labor / p.netTotal);
  }
  return ratios.length === 3 ? median(ratios) : null;
}

/** 基準日に既にあった、最も新しい全件確定の給与明細(その月以前) */
function latestSalaryStatement(inputs: ForecastInputs, uptoMonth: YearMonth): PayrollMonth | null {
  for (let k = 0; k <= 12; k++) {
    const p = inputs.payroll[`salary-${addMonths(uptoMonth, -k)}`];
    if (p && isFixed(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 本体

const LABELS: Record<string, string> = {
  inflowOperating: "営業入金",
  inflowOther: "営業外の入金(予定のみ)",
  labor: "給与",
  bonus: "賞与",
  outsourcing: "外注",
  otherOperating: "諸経費",
  other: "その他の支出",
  taxSocial: "税金・社会保険",
  taxLump: "一時的な納付",
  loans: "借入返済・利息",
  assetTransfer: "積立・資産移動",
};

function line(key: string, direction: "in" | "out", part: Partial<ForecastLine>): ForecastLine {
  return {
    key,
    label: LABELS[key] ?? key,
    direction,
    scheduled: null,
    estimated: null,
    toDate: null,
    adopted: null,
    rule: "none",
    monthlyDispersion: null,
    ...part,
  };
}

/**
 * 当月(live)の採用額。基準日までの実績に、まだ払っていない分を足す。
 * - 取引ベースの費目: max(月の予測額, 実績＋基準日以降が期日の未決済取引)。月の予測額は予定と推計の
 *   大きい方(借入は予定＋補完)なので、予定を実績に足しても推計と二重にならない
 * - 明細ベースの費目(給与): max(明細の額, 実績)。明細は月全体の額なので実績に足さない
 */
function withToDate(l: ForecastLine, toDate: number | null, mode: "deals" | "statement" = "deals"): ForecastLine {
  if (toDate === null || l.adopted === null) return l;
  const adopted =
    mode === "statement" ? Math.max(l.adopted, toDate) : Math.max(l.adopted, toDate + (l.scheduled?.amount ?? 0));
  return { ...l, toDate, adopted, rule: "toDate+remaining" };
}

export function buildCashForecast(inputs: ForecastInputs, settings: CashForecastSettings): CashForecastResult {
  if (inputs.failures.length > 0) return { status: "failed", baseDate: inputs.baseDate, failures: inputs.failures };

  const baseMonth = inputs.baseDate.slice(0, 7);
  const warnings: ForecastWarning[] = [];
  const unbooked = matchUnbooked(inputs, settings);
  const index = buildScheduledIndex(inputs, settings, unbooked.matchedDealIds);
  const growth = computeGrowth(inputs, settings);
  if (growth.raw === null) warnings.push({ code: "growth_unavailable", message: "直近6か月の営業入金がそろっていないため、伸び率で補正していません", amount: null, count: null });

  const w = settings.averageWindowMonths;
  const ratio = laborRatio(inputs, baseMonth, settings);
  if (ratio === null) warnings.push({ code: "labor_ratio_unavailable", message: "給与明細と人件費の実績が3か月そろっていないため、給与明細の額をそのまま使っています", amount: null, count: null });
  const lenderHistory = loanHistory(inputs, baseMonth, w);
  const tax = taxBase(inputs, baseMonth, settings);

  const opening0 = inputs.actuals[addMonths(baseMonth, -1)]?.cashClosing ?? null;
  if (opening0 === null) {
    return { status: "failed", baseDate: inputs.baseDate, failures: [{ source: "monthly_cash_flow", kind: "missing_previous_month_closing" }] };
  }
  if (!recent(inputs.actuals, baseMonth, w)) {
    warnings.push({ code: "insufficient_history", message: `直近${w}か月の実績がそろっていないため、推計できない費目があります`, amount: null, count: null });
  }
  if (inputs.mode === "live" && inputs.baseDate.slice(8) !== "01" && inputs.currentMonthToDate === null) {
    warnings.push({ code: "to_date_unavailable", message: "当月の途中までの実績が無いため、当月分は月の予測額をそのまま使っています", amount: null, count: null });
  }

  const months: ForecastMonth[] = [];
  let opening = opening0;
  let unreflectedSoFar = false;
  let variance = 0;
  const loanLenders = new Set<string>();
  let loanOccurrences = 0;
  let loanFloorMonths = 0;
  const salaryProvisional: string[] = [];
  const salaryIncomplete: string[] = [];
  const td0 = inputs.actuals[addMonths(baseMonth, -1)]?.timeDepositClosing ?? null;
  const cash0 = inputs.actuals[addMonths(baseMonth, -1)]?.cashOnHandClosing ?? null;
  const tdMonthly = timeDepositMonthlyTransfer(inputs, baseMonth, w);
  let td = td0;

  for (let h = 0; h < settings.horizonMonths; h++) {
    const month = addMonths(baseMonth, h);
    const calMonth = Number(month.slice(5));
    const toDate = h === 0 && inputs.mode === "live" ? inputs.currentMonthToDate : null;
    const lines: ForecastLine[] = [];
    const unreflected: UnreflectedItem[] = [];

    // 営業入金: 当月は予定(未決済の売上)、翌月以降は「直近平均×伸び率」と予定の大きい方
    {
      const sched = scheduledOf(index, month, "inflowOperating");
      if (h === 0) {
        lines.push(withToDate(line("inflowOperating", "in", { scheduled: sched, adopted: sched?.amount ?? 0, rule: "scheduled" }), toDate?.inflowOperating ?? null));
      } else {
        const avg = averageOf(inputs, baseMonth, "inflowOperating", w);
        const est = avg ? { ...avg, amount: avg.amount * growth.applied, method: `${avg.method}×伸び率${growth.applied.toFixed(3)}` } : null;
        const adopted = est === null ? null : Math.max(est.amount, sched?.amount ?? 0);
        lines.push(line("inflowOperating", "in", {
          scheduled: sched,
          estimated: est,
          adopted,
          rule: est === null ? "none" : sched && sched.amount > est.amount ? "scheduled" : "estimated",
          monthlyDispersion: est && !(sched && sched.amount > est.amount) ? dispersionOf(inputs, baseMonth, (a) => a.inflowOperating) : null,
        }));
      }
    }
    // 営業外の入金(借入・保険の解約など): 予定だけ。推計はしない
    {
      const sched = scheduledOf(index, month, "inflowOther");
      lines.push(line("inflowOther", "in", { scheduled: sched, adopted: sched?.amount ?? 0, rule: "scheduled" }));
    }

    // 給与: 当月・以降とも、その月の給与明細を採用できればそれ、できなければ基準日にあった最新の確定済みの
    // 明細からの推計。実績比率をかける。作成途中の明細は予定にしない
    {
      const statement = inputs.payroll[`salary-${month}`] ?? null;
      const judged = statement ? judgeSalary(inputs, statement, settings) : null;
      const own = judged && judged.status !== "incomplete" ? statement : null;
      if (judged?.status === "provisional") salaryProvisional.push(`${month}(${judged.reason})`);
      if (judged?.status === "incomplete") salaryIncomplete.push(`${month}(${judged.reason})`);
      const latest = latestSalaryStatement(inputs, h === 0 ? month : baseMonth);
      const r = ratio ?? 1;
      const scheduled = own
        ? { amount: own.netTotal * r, count: own.statementCount, source: "salary_statements" as const, ...(judged?.status === "provisional" ? { provisional: true } : {}) }
        : null;
      const estimated =
        !own && latest
          ? {
              amount: latest.netTotal * r,
              method: `直近の確定済みの給与明細(${latest.month})×実績比率${r.toFixed(3)}${judged?.status === "incomplete" ? `(${month}の明細は作成途中のため不採用)` : ""}`,
              basisMonths: [latest.month],
            }
          : null;
      const adopted = scheduled?.amount ?? estimated?.amount ?? null;
      const l = line("labor", "out", {
        scheduled,
        estimated,
        adopted,
        rule: scheduled ? "scheduled" : estimated ? "estimated" : "none",
        monthlyDispersion: estimated ? dispersionOf(inputs, baseMonth, (a) => a.labor) : null,
      });
      lines.push(withToDate(l, toDate?.labor ?? null, "statement"));
      if (adopted === null) unreflected.push({ key: "labor", label: LABELS.labor, reason: "給与明細が無く推計できません" });
    }
    // 賞与: 賞与明細があれば予定。支給月で明細が無ければ未反映(0円にしない)
    {
      // 未確定の賞与明細は比べる月が無いため採用せず、未反映にする
      const bonus = inputs.payroll[`bonus-${month}`] ?? null;
      if (bonus && !isFixed(bonus)) {
        lines.push(line("bonus", "out", { adopted: null, rule: "none" }));
        unreflected.push({ key: "bonus", label: LABELS.bonus, reason: "賞与明細が未確定(作成途中の可能性)のため、支給額を反映していません" });
      } else if (bonus) {
        lines.push(line("bonus", "out", { scheduled: { amount: bonus.netTotal, count: bonus.statementCount, source: "bonus_statements" }, adopted: bonus.netTotal, rule: "scheduled" }));
      } else if (settings.bonusMonths.includes(calMonth)) {
        lines.push(line("bonus", "out", { adopted: null, rule: "none" }));
        unreflected.push({ key: "bonus", label: LABELS.bonus, reason: "賞与の支給月ですが賞与明細がまだ無いため、支給額を反映していません" });
      }
    }
    // 外注: 当月は予定(事前登録の中心)、翌月以降は直近平均と予定の大きい方
    {
      const sched = scheduledOf(index, month, "outsourcing");
      if (h === 0) {
        lines.push(withToDate(line("outsourcing", "out", { scheduled: sched, adopted: sched?.amount ?? 0, rule: "scheduled" }), toDate?.outsourcing ?? null));
      } else {
        lines.push(maxLine("outsourcing", sched, averageOf(inputs, baseMonth, "outsourcing", w), dispersionOf(inputs, baseMonth, (a) => a.outsourcing)));
      }
    }
    // 諸経費・その他・積立: 直近平均と予定の大きい方
    for (const key of ["otherOperating", "other", "assetTransfer"] as const) {
      const l = maxLine(key, scheduledOf(index, month, key), averageOf(inputs, baseMonth, key, w), dispersionOf(inputs, baseMonth, (a) => a[key]));
      lines.push(h === 0 ? withToDate(l, toDate?.[key] ?? null) : l);
    }
    // 税金・社会保険: 中央値と予定の大きい方。一時的な納付は別行で、根拠(負債残高)が無ければ未反映
    {
      const sched = scheduledOf(index, month, "taxSocial");
      const l = maxLine("taxSocial", sched, tax, dispersionOf(inputs, baseMonth, (a) => a.taxSocial));
      lines.push(h === 0 ? withToDate(l, toDate?.taxSocial ?? null) : l);
      for (const lump of settings.taxLumpSchedule.filter((s) => s.calendarMonth === calMonth)) {
        const amount = inputs.liabilities ? lump.liabilityAccounts.reduce((s, a) => s + (inputs.liabilities!.balances[a] ?? 0), 0) : 0;
        if (amount > 0) {
          // 予定取引として既に登録されている分(中央値を超える部分)とは二重に数えない
          const registered = Math.max(0, (sched?.amount ?? 0) - (tax?.amount ?? 0));
          const add = Math.max(0, amount - registered);
          lines.push(line("taxLump", "out", {
            label: lump.label,
            scheduled: { amount, count: lump.liabilityAccounts.length, source: "liability" },
            adopted: add,
            rule: "scheduled",
          }));
        } else {
          lines.push(line("taxLump", "out", { label: lump.label, adopted: null, rule: "none" }));
          unreflected.push({ key: "taxLump", label: lump.label, reason: "納付額の根拠(負債科目の残高)が無いため反映していません" });
        }
      }
    }
    // 借入返済・利息: 借入先ごとに、登録済みの予定が通常の月額に足りない分だけを推計で補う
    {
      const sched = index.loansByMonth.get(month) ?? new Map<string, number>();
      let scheduledTotal = 0;
      let supplement = 0;
      let supplementedLenders = 0;
      for (const amount of sched.values()) scheduledTotal += amount;
      for (const [lender, history] of lenderHistory) {
        const typical = median(history);
        const registered = sched.get(lender) ?? 0;
        if (typical > 0 && registered < typical * settings.loanScheduleCoverage) {
          supplement += typical - registered;
          supplementedLenders += 1;
          loanLenders.add(lender);
        }
      }
      // 会社全体の直近の返済実績(中央値)を下限にする。予定＋借入先別の補完がそれに届かない分だけ足す
      let floorAdded = 0;
      if (settings.loanAggregateFloor) {
        const rows = recent(inputs.actuals, baseMonth, w);
        if (rows) {
          const floor = median(rows.map((r) => r.actual.financing + r.actual.interest));
          floorAdded = Math.max(0, floor - (scheduledTotal + supplement));
          supplement += floorAdded;
        }
      }
      loanOccurrences += supplementedLenders + (floorAdded > 0 ? 1 : 0);
      if (floorAdded > 0) loanFloorMonths += 1;
      const count = [...sched.keys()].length;
      const l = line("loans", "out", {
        scheduled: count > 0 ? { amount: scheduledTotal, count, source: "deals" } : null,
        estimated:
          supplement > 0
            ? {
                amount: supplement,
                method: `借入先別の直近${w}か月中央値で補完(${supplementedLenders}先)${floorAdded > 0 ? "＋会社全体の返済実績の中央値に届かない分" : ""}`,
                basisMonths: Array.from({ length: w }, (_, i) => addMonths(baseMonth, -(i + 1))),
              }
            : null,
        adopted: scheduledTotal + supplement,
        rule: supplement > 0 ? "scheduled+supplement" : "scheduled",
        monthlyDispersion: supplement > 0 ? dispersionOf(inputs, baseMonth, (a) => a.financing + a.interest) : null,
      });
      lines.push(h === 0 ? withToDate(l, toDate === null ? null : toDate.financing + toDate.interest) : l);
    }

    // 採用額が無い行(データ不足など)も未反映として扱い、0円とみなさない
    for (const l of lines) {
      if (l.adopted === null && !unreflected.some((u) => u.key === l.key)) {
        unreflected.push({ key: l.key, label: l.label, reason: "実績が足りず推計できないため反映していません" });
      }
    }
    // 月末残高: 採用額があるものだけで計算する(未反映はnullのまま足さない)
    const inflow = lines.filter((l) => l.direction === "in").reduce((s, l) => s + (l.adopted ?? 0), 0);
    const outflow = lines.filter((l) => l.direction === "out").reduce((s, l) => s + (l.adopted ?? 0), 0);
    const closing = opening + inflow - outflow;
    for (const l of lines) if (l.monthlyDispersion !== null) variance += l.monthlyDispersion ** 2;
    if (unreflected.length > 0) unreflectedSoFar = true;
    if (td !== null && tdMonthly !== null) td += tdMonthly;
    const cashOnHand = cash0;
    months.push({
      month,
      horizon: h,
      tier: h < settings.forecastTierMonths ? "forecast" : "estimate",
      openingBalance: opening,
      closingBalance: closing,
      closingBasis: unreflectedSoFar ? "excludesUnreflected" : "complete",
      referenceRange: variance > 0 ? Math.sqrt(variance) : null,
      timeDeposit: tdMonthly === null ? null : td,
      cashOnHand,
      checkingSavings: td !== null && tdMonthly !== null && cashOnHand !== null && cashOnHand !== undefined ? closing - td - cashOnHand : null,
      lines,
      unreflected,
    });
    opening = closing;
  }

  const unreflectedCount = months.reduce((s, m) => s + m.unreflected.length, 0);
  if (unreflectedCount > 0) warnings.push({ code: "unreflected", message: "金額を反映できていない支出があります。該当月以降の月末残高は、未反映支出を含まない参考値です", amount: null, count: unreflectedCount });
  if (loanOccurrences > 0) {
    warnings.push({
      code: "loan_supplemented",
      message: `返済予定が未登録・一部登録の借入先(${loanLenders.size}先)があり、直近の返済実績で補完しています(推計)${loanFloorMonths > 0 ? `。会社全体の返済実績の下限で補った月もあります(${loanFloorMonths}か月)` : ""}`,
      amount: null,
      count: loanLenders.size,
      occurrences: loanOccurrences,
    });
  }
  if (salaryIncomplete.length > 0) {
    warnings.push({
      code: "payroll_incomplete",
      message: `作成途中とみなした給与明細は使わず、確定済みの明細からの推計にしています: ${salaryIncomplete.join(" / ")}`,
      amount: null,
      count: salaryIncomplete.length,
    });
  }
  if (salaryProvisional.length > 0) {
    warnings.push({
      code: "payroll_unfixed_adopted",
      message: `未確定の給与明細を、件数・金額が直近の確定済みの月と近いため予定として使っています(確定扱いではありません): ${salaryProvisional.join(" / ")}`,
      amount: null,
      count: salaryProvisional.length,
    });
  }
  if (unbooked.unmatched.count > 0) {
    warnings.push({
      code: "unbooked_unmatched",
      message: `帳簿に未登録の銀行明細があります(最も古い日付 ${unbooked.unmatched.oldest})。予定取引と照合できないため予測に含めていません`,
      amount: unbooked.unmatched.amount,
      count: unbooked.unmatched.count,
    });
  }
  if (unbooked.matched.count > 0) warnings.push({ code: "unbooked_matched", message: "帳簿未登録の銀行明細のうち、予定取引と照合できたものは当月の予定として計上しています", amount: unbooked.matched.amount, count: unbooked.matched.count });
  const stale = inputs.walletables.filter((wl) => wl.type === "bank_account" && (wl.lastSyncDate === null || daysBetween(wl.lastSyncDate, inputs.baseDate) > settings.syncDelayWarningDays));
  if (inputs.mode === "live" && stale.length > 0) warnings.push({ code: "sync_delay", message: `銀行との同期が${settings.syncDelayWarningDays}日以上前の口座があります`, amount: null, count: stale.length });
  if (index.overdueReceivables.count > 0) warnings.push({ code: "overdue_receivables", message: "期日を過ぎた未回収の売上は入金予測に含めていません", amount: index.overdueReceivables.amount, count: index.overdueReceivables.count });
  warnings.push(...payrollPaymentWarnings(inputs, settings));

  return { status: "ok", baseDate: inputs.baseDate, settings, growth, months, warnings };
}

function maxLine(key: string, sched: ScheduledPart | null, est: EstimatedPart | null, dispersion: number | null): ForecastLine {
  if (est === null) return line(key, "out", { scheduled: sched, adopted: sched?.amount ?? null, rule: sched ? "scheduled" : "none" });
  const useScheduled = sched !== null && sched.amount > est.amount;
  return line(key, "out", {
    scheduled: sched,
    estimated: est,
    adopted: useScheduled ? sched.amount : est.amount,
    rule: sched ? "max" : "estimated",
    monthlyDispersion: useScheduled ? null : dispersion,
  });
}

/** 定期預金への振替の月平均(定期への入り − 定期からの出) */
function timeDepositMonthlyTransfer(inputs: ForecastInputs, baseMonth: YearMonth, window: number): number | null {
  if (inputs.timeDepositWalletableIds.length === 0) return null;
  const from = `${addMonths(baseMonth, -window)}-01`;
  const to = `${baseMonth}-01`;
  const ids = new Set(inputs.timeDepositWalletableIds);
  let net = 0;
  for (const t of inputs.transfers) {
    if (t.date < from || t.date >= to) continue;
    if (ids.has(t.toWalletableId) && !ids.has(t.fromWalletableId)) net += t.amount;
    if (ids.has(t.fromWalletableId) && !ids.has(t.toWalletableId)) net -= t.amount;
  }
  return net / window;
}

const LABOR_ACCOUNT = /給料|役員報酬|賞与/;

/** 当月の給与・賞与について、支給日を過ぎても銀行出金を確認できない場合の警告(liveのみ) */
function payrollPaymentWarnings(inputs: ForecastInputs, settings: CashForecastSettings): ForecastWarning[] {
  if (inputs.mode !== "live") return [];
  const baseMonth = inputs.baseDate.slice(0, 7);
  const out: ForecastWarning[] = [];
  for (const kind of ["salary", "bonus"] as const) {
    const p = inputs.payroll[`${kind}-${baseMonth}`];
    if (!p || inputs.baseDate <= p.payDate) continue;
    const from = addDays(p.payDate, -settings.payrollPaymentWindowDays);
    const paid = inputs.deals.some(
      (d) =>
        d.type === "expense" &&
        d.details.some((x) => LABOR_ACCOUNT.test(x.accountName)) &&
        d.payments.some((pay) => pay.walletableType === "bank_account" && pay.date >= from && pay.date <= p.payDate && pay.amount >= p.netTotal)
    );
    if (!paid) {
      out.push({
        code: "payroll_payment_unconfirmed",
        message: `${kind === "salary" ? "給与" : "賞与"}の支給日(${p.payDate})を過ぎていますが、差引支給額以上の銀行出金を確認できません`,
        amount: p.netTotal,
        count: null,
      });
    }
  }
  return out;
}

/** 月末残高の予測に、その月以前の未反映支出が含まれていないか(画面で「参考値」と出すため) */
export function isReferenceOnly(month: ForecastMonth): boolean {
  return month.closingBasis === "excludesUnreflected";
}
