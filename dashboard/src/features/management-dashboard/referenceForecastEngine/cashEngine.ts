import {
  addDays,
  addMonths,
  businessDaysBefore,
  businessDaysBetween,
  dayInMonth,
  daysBetween,
  lastBusinessDayOfMonth,
  lastDayOfMonth,
  monthEndNext,
  nextBusinessDay,
  previousBusinessDay,
  ym,
} from "./calendar";
import type { SfReceiptEvent } from "./salesMatching";
import type { RfDeal, RfInputs, RfPayrollMonth, RfWalletTxn } from "./types";
import { computeUnregisteredGaichu } from "./unregisteredGaichu";

/**
 * 資金の参考予測(当月の基準日の翌日〜翌月末、日別)。scripts/reference-forecast/engine.py(2026-11-18版)の移植で、
 * 手で置いていた仮定の金額をデータから毎回算出する(ユーザー確定、2026-11-18):
 * - 起点: 銀行明細の最終日を基準日とし、その日の試算表の現金・預金の残高
 * - 定例の出金: 直近3か月の銀行明細で、同じ摘要(摘要が番号だけのものは金額)が3か月中2か月以上ある出金の平均(慎重は最大)
 * - 月末一括振込: 直近3か月の月末(最終3営業日)の最大の振込。外注の支払と一般経費に分け、同じ分類の登録済み支払だけを差し引く
 * - 給与: 給与明細の振込額(経費精算を含む)＋振込と明細の差。振込日は過去の「支給日の何営業日前か」から推定
 * - 賞与: 当年の賞与明細が確定していればその額、無ければ前年の同じ月の支給実績(慎重は＋10%)
 * - 仮定: 請求日＝入金予定日のSalesforce追加分は翌月末、電子債権の取引先は約2か月後に現金化、慎重は遅延実績のある取引先の入金が遅れる
 * 出来事一覧1つから日別残高・根拠別・分類別を作り、内訳の合計＝残高の増減を検算する。
 */

export type CaseId = "standard" | "cautious" | "yearEndSlip" | "cautiousYearEndSlip";
type Assume = "標準" | "慎重";
type YearEnd = "to_12_30" | "receipts_to_next_year";
type Acct = "当座普通" | "定期";
type PayClass = "借入返済" | "税・社会保険" | "外注" | "一般経費";

const CASES: Record<CaseId, { label: string; assume: Assume; yearEnd: YearEnd }> = {
  standard: { label: "標準", assume: "標準", yearEnd: "to_12_30" },
  cautious: { label: "慎重", assume: "慎重", yearEnd: "to_12_30" },
  yearEndSlip: { label: "年末入金が翌年へずれる", assume: "標準", yearEnd: "receipts_to_next_year" },
  cautiousYearEndSlip: { label: "慎重＋年末入金が翌年へずれる", assume: "慎重", yearEnd: "receipts_to_next_year" },
};

interface Ev {
  date: string;
  amount: number;
  cat: string;
  group: string;
  basis: string;
  acct: Acct;
  pclass: PayClass | null;
}

const TAX_SOCIAL = ["法定福利費", "預り金", "租税公課", "未払法人税", "未払消費税", "未払費用"];

export function payClass(d: RfDeal): PayClass {
  const names = d.details.map((x) => x.accountName);
  if (names.some((n) => n.includes("借入"))) return "借入返済";
  if (names.length > 0 && names.every((n) => TAX_SOCIAL.some((k) => n.includes(k)))) return "税・社会保険";
  if (names.some((n) => n.includes("外注"))) return "外注";
  return "一般経費";
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));
const max = (xs: number[]) => (xs.length === 0 ? 0 : Math.max(...xs));
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const monthLabel = (m: string) => `${Number(m.slice(5, 7))}月`;

const isVendorTxn = (t: RfWalletTxn) => t.description.trim() === "ﾌﾘｺﾐ" || t.description.startsWith("W21");
const isTimeDepositDesc = (t: RfWalletTxn) => /ﾂﾐｷﾝ|ﾃｲｷ|定期/.test(t.description);

export interface CashEngineOutput {
  baseDate: string;
  months: [string, string];
  startBalances: { checking: number; timeDeposit: number; cash: number };
  cases: {
    id: CaseId;
    label: string;
    /** このケースに含めるべきだが、データを取得できず含められていない支出(無ければ省略) */
    missingOutflows?: string[];
    months: {
      month: string;
      start: number;
      end: number;
      minEndOfDay: { date: string | null; amount: number };
      minIntraday: number;
      byBasis: Record<string, number>;
      byCategory: Record<string, number>;
    }[];
  }[];
  dec31Receipts: { sfAdded: number; sfAddedStandardKinds: number; freeeUnsettled: number };
  checks: Record<string, unknown>;
  notes: { basis: string[]; estimates: string[]; limits: string[] };
  /** 日別の出来事(標準ケース)。記録には入れず、確認用 */
  dailyStandard: { date: string; amount: number; cat: string; group: string; basis: string; acct: Acct }[];
}

export function computeCash(inp: RfInputs, sfEvents: SfReceiptEvent[]): CashEngineOutput {
  const BASE = inp.bankSyncedThrough;
  const M = ym(BASE);
  const N = addMonths(M, 1);
  const H = [addMonths(M, -3), addMonths(M, -2), addMonths(M, -1)];
  const WIN: Record<string, [string, string]> = { [M]: [addDays(BASE, 1), lastDayOfMonth(M)], [N]: [`${N}-01`, lastDayOfMonth(N)] };
  const BANK = inp.walletTxns.filter((t) => t.walletableType === "bank_account" && t.date <= BASE);
  const BANK_OUT = BANK.filter((t) => t.entrySide === "expense");
  const walletName = new Map(inp.walletables.map((w) => [w.id, w.name]));
  const isTimeDepositWallet = (id: number) => (walletName.get(id) ?? "").startsWith("定期");
  const PAY = inp.payroll;

  const asof = (d: RfDeal) => d.dueAmount + d.payments.filter((p) => p.date > BASE).reduce((s, p) => s + p.amount, 0);

  // ---------- 自社振替 ----------
  const ownTransfer = (t: RfWalletTxn): "confirmed" | "pending" | null => {
    const pair = BANK.filter(
      (u) => u.id !== t.id && u.date === t.date && u.amount === t.amount && u.entrySide !== t.entrySide && u.walletableId !== t.walletableId
    );
    if (pair.length === 0) return null;
    for (const u of pair) {
      const [src, dst] = t.entrySide === "expense" ? [t, u] : [u, t];
      if (
        inp.transfers.some(
          (x) => x.date === t.date && x.amount === t.amount && x.fromWalletableId === src.walletableId && x.toWalletableId === dst.walletableId
        )
      )
        return "confirmed";
    }
    return "pending";
  };
  /** 振替記録(振替元が一致)のある出金。相手口座の明細が無くても振替として扱う */
  const hasTransferRecord = (t: RfWalletTxn) =>
    inp.transfers.some((x) => x.date === t.date && x.amount === t.amount && x.fromWalletableId === t.walletableId);

  // ---------- 過去の給与振込・月末一括振込 ----------
  /** 自社の口座間の振替(振替記録がある、または相手口座に同日同額の入金がある)。取引先への振込として数えない */
  const isOwnMove = (t: RfWalletTxn) => hasTransferRecord(t) || ownTransfer(t) !== null;
  const payrollTxn = (month: string, statement: RfPayrollMonth | null | undefined, tolerance = 0.05): RfWalletTxn | null => {
    if (!statement) return null;
    const cand = BANK_OUT.filter(
      (t) =>
        ym(t.date) === month &&
        Number(t.date.slice(8, 10)) >= 10 &&
        Number(t.date.slice(8, 10)) <= 28 &&
        t.description.trim() === "ﾌﾘｺﾐ" &&
        !isOwnMove(t) &&
        Math.abs(t.amount - statement.transfer) <= statement.transfer * tolerance
    );
    return cand.sort((a, b) => Math.abs(a.amount - statement.transfer) - Math.abs(b.amount - statement.transfer))[0] ?? null;
  };
  const payrollTxnIds = new Set<number>();
  const payrollHist = H.map((h) => {
    const t = payrollTxn(h, PAY[h]);
    if (t) payrollTxnIds.add(t.id);
    return { month: h, txn: t, statement: PAY[h] ?? null };
  });

  const bulkTxn = (month: string): RfWalletTxn | null => {
    const from = businessDaysBefore(lastBusinessDayOfMonth(month), 2);
    const cand = BANK_OUT.filter(
      (t) => t.date >= from && t.date <= lastDayOfMonth(month) && t.description.trim() === "ﾌﾘｺﾐ" && !payrollTxnIds.has(t.id) && !isOwnMove(t)
    );
    return cand.sort((a, b) => b.amount - a.amount)[0] ?? null;
  };
  const paidBy = (date: string, walletableId: number, cls: PayClass | null) =>
    inp.expenseDeals
      .filter((d) => cls === null || payClass(d) === cls)
      .flatMap((d) => d.payments)
      .filter((p) => p.date === date && p.walletableId === walletableId)
      .reduce((s, p) => s + p.amount, 0);
  const bulkTxnIds = new Set<number>();
  const bulkParts = H.map((h) => {
    const t = bulkTxn(h);
    if (!t) return null;
    bulkTxnIds.add(t.id);
    const gaichu = Math.min(t.amount, paidBy(t.date, t.walletableId, "外注"));
    return { date: t.date, bulk: t.amount, gaichu, general: t.amount - gaichu };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const prevYearN = addMonths(N, -12);
  const prevYearBulkTxn = bulkTxn(prevYearN);
  const monthEndGaichu = H.map((h) => {
    const last = lastDayOfMonth(h);
    const lo = addDays(last, -2);
    const amount = inp.expenseDeals
      .filter((d) => payClass(d) === "外注" && (d.dueDate ?? "") >= lo && (d.dueDate ?? "") <= last)
      .flatMap((d) => d.payments)
      .reduce((s, p) => s + p.amount, 0);
    return { month: h, amount };
  });

  // ---------- 給与の振込日・明細との差 ----------
  const offsets: number[] = [];
  const gaps = payrollHist
    .filter((p) => p.txn && p.statement)
    .map((p) => {
      const txn = p.txn as RfWalletTxn;
      const st = p.statement as RfPayrollMonth;
      offsets.push(businessDaysBetween(txn.date, previousBusinessDay(st.payDate || dayInMonth(p.month, 25))));
      return { month: p.month, bankDate: txn.date, bank: txn.amount, statement: st.transfer, gap: txn.amount - st.transfer };
    });
  const payOffset = offsets.length > 0 ? median(offsets) : 3;
  const prevYearGap = (() => {
    const st = PAY[prevYearN];
    // 前年同月(12月は年末調整などで明細との差が大きい)は、明細の±25%の振込を探す
    const t = payrollTxn(prevYearN, st, 0.25);
    return st && t ? { month: prevYearN, bank: t.amount, statement: st.transfer, gap: t.amount - st.transfer } : null;
  })();
  const recentExpense = mean(H.map((h) => PAY[h]?.expense ?? 0).filter((v) => v > 0));

  // ---------- 前月末期日の繰越(休日で翌月初に払ったもの) ----------
  const carryoverDay = (date: string, walletableId: number, month: string) => {
    const dayTotal = BANK_OUT.filter((t) => isVendorTxn(t) && !isOwnMove(t) && t.date === date && t.walletableId === walletableId).reduce((s, t) => s + t.amount, 0);
    const prev = addMonths(month, -1);
    const prevMe = inp.expenseDeals
      .filter((d) => (d.dueDate ?? "") >= addDays(lastDayOfMonth(prev), -3) && (d.dueDate ?? "") <= lastDayOfMonth(prev))
      .flatMap((d) => d.payments)
      .filter((p) => p.date === date && p.walletableId === walletableId)
      .reduce((s, p) => s + p.amount, 0);
    return dayTotal > 0 && prevMe >= dayTotal * 0.9;
  };
  const midMonths = Number(BASE.slice(8, 10)) >= 16 ? [H[1], H[2], M] : H;
  const vendorMid = midMonths.map((h) => {
    const txns = BANK_OUT.filter(
      (t) =>
        ym(t.date) === h &&
        Number(t.date.slice(8, 10)) <= 16 &&
        isVendorTxn(t) &&
        !isOwnMove(t) &&
        !payrollTxnIds.has(t.id) &&
        !bulkTxnIds.has(t.id) &&
        !carryoverDay(t.date, t.walletableId, h)
    );
    return { month: h, amount: txns.reduce((s, t) => s + t.amount, 0) };
  });

  // ---------- 定例の出金(摘要ごと) ----------
  const histFrom = `${H[0]}-01`;
  const histTo = addDays(lastDayOfMonth(H[2]), 3);
  const histOut = BANK_OUT.filter(
    (t) =>
      t.date >= histFrom &&
      t.date <= histTo &&
      !isVendorTxn(t) &&
      !payrollTxnIds.has(t.id) &&
      !bulkTxnIds.has(t.id) &&
      !hasTransferRecord(t) &&
      ownTransfer(t) !== "confirmed" &&
      !isTimeDepositDesc(t)
  );
  const descKey = (t: RfWalletTxn) => t.description.normalize("NFKC").replace(/[0-9\s()（）-]/g, "");
  const keyed: { t: RfWalletTxn; key: string }[] = [];
  const amountClusters: { center: number; key: string }[] = [];
  for (const t of histOut) {
    const k = descKey(t);
    if (k.length >= 2) {
      keyed.push({ t, key: `D:${k}` });
      continue;
    }
    let c = amountClusters.find((x) => Math.abs(x.center - t.amount) <= x.center * 0.03);
    if (!c) {
      c = { center: t.amount, key: `A:${t.amount}` };
      amountClusters.push(c);
    }
    keyed.push({ t, key: c.key });
  }
  const byKey = new Map<string, RfWalletTxn[]>();
  for (const { t, key } of keyed) byKey.set(key, [...(byKey.get(key) ?? []), t]);
  interface RecurringLine {
    key: string;
    label: string;
    bucket: "early" | "late";
    day: number;
    months: string[];
    meanAmount: number;
    maxAmount: number;
  }
  const recurring: RecurringLine[] = [];
  for (const [key, ts] of byKey) {
    const hasLate = ts.some((t) => Number(t.date.slice(8, 10)) >= 27);
    const assigned = ts.map((t) => {
      const day = Number(t.date.slice(8, 10));
      if (day <= 3 && hasLate) return { t, month: addMonths(ym(t.date), -1), day: 31 };
      return { t, month: ym(t.date), day };
    });
    for (const bucket of ["early", "late"] as const) {
      const xs = assigned.filter((a) => H.includes(a.month) && (bucket === "early" ? a.day <= 15 : a.day > 15));
      const byMonth = new Map<string, number>();
      for (const a of xs) byMonth.set(a.month, (byMonth.get(a.month) ?? 0) + a.t.amount);
      if (byMonth.size < 2) continue;
      const sums = [...byMonth.values()];
      const latest = byMonth.get([...byMonth.keys()].sort().at(-1) as string) ?? 0;
      recurring.push({
        key,
        label: key.startsWith("D:") ? key.slice(2, 14) : `摘要なし（${man(Number(key.slice(2)))}前後）`,
        bucket,
        day: median(xs.map((a) => a.day)),
        months: [...byMonth.keys()].sort(),
        // 標準は月ごとの合計の中央値(賞与月の社会保険料など一時的に大きい月に引っぱられない)。慎重は中央値と直近の月の大きい方
        meanAmount: median(sums),
        maxAmount: Math.max(median(sums), latest),
      });
    }
  }
  // 定期への積立(振替記録、または摘要が積金・定期の出金)
  const tdOut = BANK_OUT.filter((t) => t.date >= histFrom && t.date <= histTo && (isTimeDepositDesc(t) || (hasTransferRecord(t) && inp.transfers.some((x) => x.date === t.date && x.amount === t.amount && x.fromWalletableId === t.walletableId && isTimeDepositWallet(x.toWalletableId)))));
  const tdByKey = new Map<string, { amount: number; months: Set<string>; days: number[] }>();
  for (const t of tdOut) {
    const day = Number(t.date.slice(8, 10));
    const month = day <= 3 ? addMonths(ym(t.date), -1) : ym(t.date);
    if (!H.includes(month)) continue;
    const key = `${descKey(t)}\u0000${t.amount}`;
    const e = tdByKey.get(key) ?? { amount: t.amount, months: new Set<string>(), days: [] };
    e.months.add(month);
    e.days.push(day <= 3 ? 31 : day);
    tdByKey.set(key, e);
  }
  const timeDepositLines = [...tdByKey.values()].filter((v) => v.months.size >= 2).map((v) => ({ amount: v.amount, day: median(v.days) }));

  /** 口座振替(引落)の日: 休業日なら翌営業日(月末の引落は翌月にずれる。10/31→11/2、12/31→1/5)。
   *  慎重は、予測の最終月で翌月にずれる引落を月内(前の営業日)に置く */
  const debitDays = (month: string, day: number, cautious: boolean): string[] => {
    const out: string[] = [];
    for (const m of [addMonths(month, -1), month]) {
      const d = day >= 31 ? lastDayOfMonth(m) : dayInMonth(m, day);
      let nb = nextBusinessDay(d);
      if (cautious && m === month && month === N && ym(nb) !== month) nb = previousBusinessDay(d);
      if (ym(nb) === month) out.push(nb);
    }
    return out;
  };

  // ---------- 電子債権の取引先・入金が遅れる取引先 ----------
  const notesWallet = inp.walletables.find((w) => w.name === "受取手形・電子債権")?.id ?? null;
  const notesPartners = new Set<number>();
  {
    const by = new Map<number, boolean[]>();
    for (const d of inp.incomeDeals)
      for (const p of d.payments)
        if (p.date >= `${addMonths(M, -6)}-01` && d.partnerId !== null) by.set(d.partnerId, [...(by.get(d.partnerId) ?? []), p.walletableId === notesWallet]);
    for (const [pid, xs] of by) if (notesWallet !== null && xs.length >= 3 && xs.every(Boolean)) notesPartners.add(pid);
  }
  const lateLag = new Map<number, number>();
  {
    const overdue = new Set<number>();
    for (const d of inp.incomeDeals) {
      const dd = d.dueDate ?? "";
      if (dd >= `${addMonths(M, -5)}-01` && dd <= lastDayOfMonth(addMonths(M, -1)) && Number(dd.slice(8, 10)) >= 28) {
        for (const p of d.payments) {
          const lag = daysBetween(dd, p.date);
          if (lag >= 20 && d.partnerId !== null) lateLag.set(d.partnerId, Math.max(lateLag.get(d.partnerId) ?? 0, lag));
        }
      }
      if (d.issueDate <= BASE && asof(d) > 0 && dd && dd < WIN[M][0] && d.partnerId !== null) overdue.add(d.partnerId);
    }
    for (const pid of [...lateLag.keys()]) if (!overdue.has(pid)) lateLag.delete(pid);
  }

  // ---------- Salesforce原価でfreee未登録の外注(慎重の支払候補。同じ仕入月で照合し、支払日を推定) ----------
  const unregisteredGaichu = computeUnregisteredGaichu({
    month: addMonths(M, -1),
    baseDate: BASE,
    sfCosts: inp.sfCosts,
    termsReadable: inp.sfCostTermsReadable ?? false,
    expenseDeals: inp.expenseDeals,
    partners: inp.partners,
  });
  /** ケースごとに個別に置く未登録外注(標準は支払予定日・支払条件から支払月を推定できたものだけ、慎重はすべて) */
  const placedUnreg = (assume: Assume) => unregisteredGaichu.items.filter((x) => assume === "慎重" || x.inStandard);
  /** 個別に置いた未登録外注のうち、過去平均の推計と同じ支払枠(その月の lo〜hi)に入るもの。推計から同額を引いて重複させない */
  const placedIn = (assume: Assume, lo2: string, hi2: string) => placedUnreg(assume).filter((x) => x.payDate >= lo2 && x.payDate <= hi2);

  // ---------- 統計 ----------
  const generalStat = { mean: mean(bulkParts.map((b) => b.general)), max: max(bulkParts.map((b) => b.general)) };
  const gaichuMeMean = mean(monthEndGaichu.map((g) => g.amount));
  const gapStat = { mean: mean(gaps.map((g) => g.gap)), max: max(gaps.map((g) => g.gap)) };
  // 直近3回(当月の16日まで明細があれば当月を含む)の中央値
  const vendorMidMean = median(vendorMid.map((v) => v.amount));

  const checks = {
    ownTransfers: { confirmed: 0, pending: 0 } as Record<string, number>,
    excludedFromBulk: new Map<string, number>(),
    skippedRecurring: [] as { month: string; label: string; amount: number; reason: string }[],
  };
  const applied: Record<string, Record<string, unknown>> = {};
  for (const t of BANK_OUT.filter((t) => t.date >= `${M}-01` && t.date <= BASE)) {
    const ot = ownTransfer(t);
    if (ot) checks.ownTransfers[ot] += 1;
  }

  // ---------- 入金予定(ケースごとに日付を動かす) ----------
  const incomeEvents = (caseId: CaseId) => {
    const k = CASES[caseId].assume;
    const rec: Record<string, unknown[]> = { notes: [], lateSlip: [], sfMoved: [], sfExcluded: [] };
    const out: (Omit<Ev, "acct" | "pclass"> & { sfKind?: string })[] = [];
    for (const d of inp.incomeDeals) {
      const dd = d.dueDate ?? "";
      const due = asof(d);
      if (!(d.issueDate <= BASE && due > 0 && dd >= WIN[M][0] && dd <= WIN[N][1])) continue;
      if (d.partnerId !== null && notesPartners.has(d.partnerId)) {
        rec.notes.push({ due: dd, amount: due, assumedCashMonth: ym(monthEndNext(monthEndNext(dd))) });
        continue;
      }
      const lag = d.partnerId !== null ? lateLag.get(d.partnerId) : undefined;
      if (k === "慎重" && lag !== undefined && dd <= WIN[M][1]) {
        const slip = addDays(dd, lag) > WIN[N][1] ? WIN[N][1] : addDays(dd, lag);
        rec.lateSlip.push({ due: dd, amount: due, assumedDate: slip });
        out.push({
          date: slip,
          amount: due,
          cat: "入金:売掛(入金遅れの仮定)",
          group: "推計・仮定",
          basis: `仮定(慎重: ${dd}期日の売上が翌月へずれる。月末期日を${lag}日遅れて入金した実績と期日超過の未入金がある取引先)`,
        });
        continue;
      }
      out.push({ date: dd, amount: due, cat: "入金:売掛", group: "登録済み", basis: "登録済み(freeeの未決済の売上)" });
    }
    for (const e of sfEvents) {
      let { date } = e;
      let group = e.kind === "SF予定" ? "SF予定" : "SF補完";
      let basis: string = e.kind;
      let cat = "入金:売掛(SF追加)";
      if (e.kind === "SF予定" && date >= WIN[M][0] && date <= WIN[M][1] && e.billed === date) {
        if (e.freeeSameAmountLater) {
          rec.sfExcluded.push({ sfId: e.sfId, amount: e.amount, reason: "同じ取引先に同額のfreee取引が請求月以降にあるため加えない" });
          continue;
        }
        const to = monthEndNext(e.billed);
        rec.sfMoved.push({ sfId: e.sfId, amount: e.amount, from: date, to });
        date = to;
        group = "推計・仮定";
        basis = `仮定(Salesforceの入金予定日が請求日と同じ${mdLabel(e.billed)}のため、請求の翌月末に入金と仮定。確定情報ではない)`;
        cat = "入金:売掛(SF追加・入金月は仮定)";
      }
      out.push({ date, amount: e.amount, cat, group, basis, sfKind: e.kind });
    }
    // build() が同じオブジェクトに書き足すため、置き換えずに加える
    Object.assign((applied[caseId] ??= {}), rec);
    return out;
  };
  const incomeCache = new Map<CaseId, ReturnType<typeof incomeEvents>>();
  const incomeFor = (c: CaseId) => {
    if (!incomeCache.has(c)) incomeCache.set(c, incomeEvents(c));
    return incomeCache.get(c) as ReturnType<typeof incomeEvents>;
  };
  const includeSf: Record<Assume, Record<"M" | "N", string[]>> = {
    標準: { M: ["SF予定"], N: ["SF予定", "SF補完(空欄)", "SF補完(異常日付)"] },
    慎重: { M: [], N: ["SF予定"] },
  };

  const shiftDate = (date: string, sign: "in" | "out", mode: YearEnd): string | null => {
    if (date.slice(5) !== "12-31") return date;
    if (mode === "receipts_to_next_year" && sign === "in") return null;
    return previousBusinessDay(date);
  };

  const build = (month: string, caseId: CaseId): Ev[] => {
    const E: Ev[] = [];
    const { assume: k, yearEnd } = CASES[caseId];
    const [lo, hi] = WIN[month];
    const isM = month === M;
    const rec = (applied[caseId] ??= {});
    const ev = (date: string, amount: number, cat: string, group: string, basis: string, acct: Acct = "当座普通", pclass: PayClass | null = null) => {
      const d = shiftDate(date, amount > 0 ? "in" : "out", yearEnd);
      if (d === null || Math.round(amount) === 0) return;
      E.push({ date: d, amount: Math.round(amount), cat, group, basis, acct, pclass });
    };
    const inWin = (d: string) => d >= lo && d <= hi;

    for (const x of incomeFor(caseId)) {
      if (!inWin(x.date)) continue;
      if (x.sfKind && !includeSf[k][isM ? "M" : "N"].includes(x.sfKind)) continue;
      ev(x.date, x.amount, x.cat, x.group, x.basis);
    }

    // 給与明細の経費精算は給与振込に含まれる。支給日期日で登録済みの経費精算の支払は、明細の経費精算と同額なら数えない
    const st = PAY[month] ?? null;
    const payDate = st?.payDate || dayInMonth(month, 25);
    const reimb = inp.expenseDeals.filter(
      (d) => asof(d) > 0 && d.dueDate === payDate && (payClass(d) === "一般経費" || payClass(d) === "税・社会保険")
    );
    const reimbSum = reimb.reduce((s, d) => s + asof(d), 0);
    const reimbDedupe = !!st && st.expense > 0 && Math.abs(reimbSum - st.expense) <= Math.max(1000, st.expense * 0.01);
    rec[`reimbursement_${month}`] = { payDate, registered: reimbSum, statementExpense: st?.expense ?? 0, excluded: reimbDedupe };
    const reimbIds = new Set(reimbDedupe ? reimb.map((d) => d.id) : []);

    for (const d of inp.expenseDeals) {
      const dd = d.dueDate ?? "";
      const due = asof(d);
      // 支払は発生日が基準日より後でも、登録済み(借入返済の予定など)なら数える(2026-11-18、Python版は発生日で絞って12月の借入返済が漏れていた)
      if (due > 0 && inWin(dd) && !reimbIds.has(d.id)) {
        const c = payClass(d);
        const cat = { 借入返済: "出金:借入返済", "税・社会保険": "出金:税社保", 外注: "出金:外注", 一般経費: "出金:一般経費" }[c];
        ev(dd, -due, cat, "登録済み", "登録済み(freeeの未決済の支払)", "当座普通", c);
      }
    }
    const registered = (cls: PayClass, lo2: string, hi2: string) => {
      let s = 0;
      for (const e of E) {
        if (e.group !== "登録済み" || e.amount >= 0 || e.date < lo2 || e.date > hi2 || !e.pclass) continue;
        if (e.pclass === cls) s += -e.amount;
        else if (e.pclass !== "外注" && e.pclass !== "一般経費") {
          const key = `${caseId}\u0000${month}\u0000${e.pclass}`;
          checks.excludedFromBulk.set(key, (checks.excludedFromBulk.get(key) ?? 0) + -e.amount);
        }
      }
      return s;
    };
    const statLabel = k === "慎重" ? "最大" : "平均";

    // 給与
    const alreadyPaid = isM && !!st && BANK_OUT.some((t) => ym(t.date) === M && t.description.trim() === "ﾌﾘｺﾐ" && Math.abs(t.amount - st.transfer) <= st.transfer * 0.05);
    rec[`payroll_${month}`] = { alreadyPaid, offsetBusinessDays: payOffset };
    if (!alreadyPaid) {
      let bankDay = businessDaysBefore(previousBusinessDay(payDate), payOffset);
      if (bankDay < lo) bankDay = nextBusinessDay(lo);
      const fallback = st ?? PAY[addMonths(month, -1)] ?? null;
      if (fallback) {
        const fixed = !!st && st.fixed === st.count;
        const draft = !st || st.workedZero > st.count * 0.5 || st.expense === 0;
        const group = fixed || !draft ? "登録済み" : "推計・仮定";
        const basis = !st
          ? `推計(${monthLabel(month)}の給与明細が無いため前月の振込額)`
          : fixed
            ? `登録済み(給与明細の振込額・確定${st.count}件、経費精算を含む)`
            : draft
              ? `推計(給与明細の下書き${st.count}件・未確定。${st.calculatedAt}計算で勤怠と経費精算が未反映)`
              : `登録済み(給与明細の振込額・未確定${st.count - st.fixed}件、勤怠反映済み、経費精算を含む)`;
        ev(bankDay, -fallback.transfer, "出金:給与", group, `${basis}／振込日は支給日の${payOffset}営業日前(過去の振込から推定)`);
        // 慎重の翌月は、前年同月の差(12月は年末調整などで大きい)も含めた最大
        const usePrevYear = k === "慎重" && month === N && prevYearGap !== null;
        const gap = k === "慎重" ? Math.max(gapStat.max, usePrevYear ? (prevYearGap as NonNullable<typeof prevYearGap>).gap : 0) : gapStat.mean;
        ev(bankDay, -gap, "出金:給与(明細との差)", "推計・仮定", `推計(直近3か月の給与振込と明細の差の${statLabel}${usePrevYear ? `・前年${monthLabel(N)}の差を含む` : ""})`);
        if (draft) {
          const exp = Math.max(0, recentExpense - (reimbDedupe ? 0 : reimbSum));
          ev(bankDay, -exp, "出金:給与(経費精算の見込)", "推計・仮定", "推計(給与明細の下書きに経費精算が無いため、直近3か月の明細の経費精算の平均−支給日期日で登録済みの経費精算)");
        }
      }
    }

    // 賞与
    const hist = inp.bonusHistory[addMonths(month, -12)];
    const bonusSt = inp.bonus[month] ?? null;
    if (hist && hist.net > 0) {
      const paid = BANK_OUT.some((t) => ym(t.date) === month && t.date <= BASE && Math.abs(t.amount - hist.net) <= hist.net * 0.15);
      if (!paid) {
        const fixed = !!bonusSt && bonusSt.fixed === bonusSt.count;
        const up = !fixed && k === "慎重" ? 0.1 : 0;
        const amount = fixed ? (bonusSt as NonNullable<typeof bonusSt>).net : hist.net * (1 + up);
        let date = previousBusinessDay(dayInMonth(month, Number((bonusSt?.payDate || hist.payDate || `${month}-05`).slice(8, 10))));
        if (date < lo) date = nextBusinessDay(lo);
        ev(
          date,
          -amount,
          "出金:賞与",
          fixed ? "登録済み" : "推計・仮定",
          fixed
            ? `登録済み(賞与明細の振込額・確定${bonusSt?.count}件)`
            : `仮定(前年${monthLabel(month)}の賞与振込額${up ? "＋10%" : ""}。${monthLabel(month)}の賞与明細は${bonusSt ? "未確定" : "未作成"})`
        );
      }
    }

    // 定例の出金
    const regNear = (date: string) => E.filter((e) => e.group === "登録済み" && e.amount < 0 && Math.abs(daysBetween(e.date, date)) <= 3);
    for (const line of recurring) {
      for (const date of debitDays(month, line.day, k === "慎重")) {
        if (!inWin(date)) continue;
        const amount = k === "慎重" ? line.maxAmount : line.meanAmount;
        // 登録済みの支払と重ねない: 1件で同額に近い、または同じ分類の合計が同額に近い(借入返済の複数口など)
        const near = regNear(date);
        const single = near.some((e) => Math.abs(-e.amount - amount) <= amount * 0.02);
        // 分類の合計で重ねないのは借入返済・税社保だけ(外注・一般経費は月末一括振込・10日前後の推計の側で差し引く)
        const byClass = new Map<string, number>();
        for (const e of near) if (e.pclass === "借入返済" || e.pclass === "税・社会保険") byClass.set(e.pclass, (byClass.get(e.pclass) ?? 0) + -e.amount);
        const classSum = [...byClass.values()].some((v) => Math.abs(v - amount) <= amount * 0.03);
        if (single || classSum) {
          if (caseId === "standard") checks.skippedRecurring.push({ month, label: line.label, amount, reason: single ? "同額に近い登録済みの支払が近い日にあるため" : "同じ分類の登録済みの支払の合計が同額に近いため" });
          continue;
        }
        ev(date, -amount, "出金:定例(過去の銀行明細)", "過去明細(定例)", `過去明細(直近3か月のうち${line.months.length}か月にある出金の${k === "慎重" ? "中央値と直近の月の大きい方" : "中央値"}、${line.label})`);
      }
    }
    for (const td of timeDepositLines) {
      for (const date of debitDays(month, td.day, false)) {
        if (!inWin(date)) continue;
        ev(date, -td.amount, "振替:定期積立", "過去明細(定例)", "過去明細(定例。直近3か月の定期への積立)");
        ev(date, td.amount, "振替:定期積立", "過去明細(定例)", "過去明細(定例。直近3か月の定期への積立)", "定期");
      }
    }

    // 10日前後の取引先への振込(未登録分)
    const day10 = nextBusinessDay(dayInMonth(month, 10));
    if (inWin(day10)) {
      const reg = registered("外注", `${month}-01`, `${month}-16`) + registered("一般経費", `${month}-01`, `${month}-16`);
      const lessItems = placedIn(k, `${month}-01`, `${month}-16`);
      const less = lessItems.reduce((s2, x) => s2 + x.unregistered, 0);
      const amount = Math.max(0, vendorMidMean - reg - less);
      rec[`mid_${month}`] = { vendorMidMean, registered: reg, lessUnregisteredPlacedSamePeriod: less, lessVendors: lessItems.map((x) => x.vendor), amount };
      ev(day10, -amount, "出金:外注・一般(10日前後の振込の未登録分)", "推計・仮定",
        `推計(直近3回の1〜16日の取引先への振込(前月末分の繰越を除く)の中央値−同じ支払分類の登録済み${less ? `−同じ期間(1〜16日)に個別に置いた未登録外注(${lessItems.map((x) => x.vendor).join("・")})` : ""})`);
    }

    // 月末一括振込(一般経費と外注を分ける)
    const lb = lastBusinessDayOfMonth(month);
    if (inWin(lb)) {
      const wlo = businessDaysBefore(lb, 2);
      const whi = lastDayOfMonth(month);
      const regGen = registered("一般経費", wlo, whi);
      const regGai = registered("外注", wlo, whi);
      const general = k === "慎重" ? generalStat.max : generalStat.mean;
      ev(lb, -Math.max(0, general - regGen), "出金:一般経費(月末一括振込の未登録分)", "推計・仮定",
        `推計(直近3か月の月末一括振込のうち外注以外の${statLabel}−登録済みの一般経費)`);
      let gaiEst = 0;
      let gaiBasis = "";
      if (isM) {
        gaiEst = regGai;
        gaiBasis = "登録済みの外注のみ(未登録外注は支払日を推定して別に置く)";
      } else if (k === "慎重" && prevYearBulkTxn) {
        gaiEst = prevYearBulkTxn.amount - generalStat.max;
        gaiBasis = `推計(慎重: 前年${monthLabel(month)}の月末一括振込−一般経費の最大を外注分とし、登録済みの外注を差し引く)`;
      } else {
        gaiEst = k === "慎重" ? max(monthEndGaichu.map((g) => g.amount)) : gaichuMeMean;
        gaiBasis = `推計(直近3か月の月末期日の外注の支払の${statLabel}−登録済みの外注)`;
      }
      // 個別に置いた未登録外注のうち、同じ月末の支払枠(最終3営業日〜月末)に入るものは、過去平均の外注の推計から引く
      const meItems = isM ? [] : placedIn(k, wlo, whi);
      const meLess = meItems.reduce((s2, x) => s2 + x.unregistered, 0);
      const gaiUnreg = Math.max(0, gaiEst - regGai - meLess);
      if (meLess > 0) gaiBasis += `−同じ月末の支払枠に個別に置いた未登録外注(${meItems.map((x) => x.vendor).join("・")})`;
      ev(lb, -gaiUnreg, isM ? "出金:外注(未登録)" : "出金:外注(月末の未登録分)", "推計・仮定", gaiBasis);
      rec[`bulk_${month}`] = { general, registeredGeneral: regGen, gaichuEstimate: gaiEst, registeredGaichu: regGai, lessUnregisteredPlacedSamePeriod: meLess, unregisteredGaichu: gaiUnreg };
    }

    // Salesforceの原価でfreee未登録の外注を、推定した支払日に個別に置く(根拠は記録の unregisteredGaichu.items)。
    // 標準は支払予定日・支払条件から支払月を推定できたものだけ、慎重はすべて
    for (const x of placedUnreg(k)) {
      if (!inWin(x.payDate)) continue;
      ev(x.payDate, -x.unregistered, "出金:外注(未登録・支払日は推定)", "推計・仮定",
        `仮定(Salesforceの${monthLabel(unregisteredGaichu.month)}仕入の原価でfreee未登録${x.inStandard ? "" : `。慎重だけに置く理由: ${x.cautiousOnlyReason}`}。支払日の根拠: ${x.payDateBasis})`);
    }
    return E.sort((a, b) => (a.date === b.date ? b.amount - a.amount : a.date < b.date ? -1 : 1));
  };

  const run = (month: string, caseId: CaseId, start: Record<Acct, number>) => {
    const E = build(month, caseId);
    const bal = { ...start };
    const rows = E.map((e) => {
      bal[e.acct] += e.amount;
      return { ...e, checking: bal["当座普通"] };
    });
    const eod = new Map<string, number>();
    for (const r of rows) eod.set(r.date, r.checking);
    const low = [...eod.entries()].reduce<[string | null, number]>((m, [d, v]) => (m[0] === null || v < m[1] ? [d, v] : m), [null, start["当座普通"]]);
    let worst = start["当座普通"];
    let b = start["当座普通"];
    for (const d of [...eod.keys()].sort()) {
      const day = E.filter((e) => e.date === d && e.acct === "当座普通");
      worst = Math.min(worst, b + day.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0));
      b += day.reduce((s, e) => s + e.amount, 0);
    }
    const delta = E.filter((e) => e.acct === "当座普通").reduce((s, e) => s + e.amount, 0);
    if (start["当座普通"] + delta !== bal["当座普通"]) throw new Error("検算: 出来事の合計が残高の増減と一致しません");
    return { E, bal, low, worst };
  };

  const baseBal: Record<Acct, number> = { 当座普通: inp.baseBalances.checking, 定期: inp.baseBalances.timeDeposit };
  let dailyStandard: CashEngineOutput["dailyStandard"] = [];
  const cases = (Object.keys(CASES) as CaseId[]).map((caseId) => {
    let start = { ...baseBal };
    const months = [M, N].map((month) => {
      const { E, bal, low, worst } = run(month, caseId, start);
      const byBasis: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const e of E) {
        if (e.acct !== "当座普通") continue;
        byBasis[e.group] = (byBasis[e.group] ?? 0) + e.amount;
        byCategory[e.cat] = (byCategory[e.cat] ?? 0) + e.amount;
      }
      const sum = Object.values(byBasis).reduce((a, b) => a + b, 0);
      if (sum !== bal["当座普通"] - start["当座普通"]) throw new Error("検算: 根拠別の合計が残高の増減と一致しません");
      if (caseId === "standard") dailyStandard = [...dailyStandard, ...E.map(({ date, amount, cat, group, basis, acct }) => ({ date, amount, cat, group, basis, acct }))];
      const out = { month, start: start["当座普通"], end: bal["当座普通"], minEndOfDay: { date: low[0], amount: low[1] }, minIntraday: worst, byBasis, byCategory };
      start = bal;
      return out;
    });
    const missingOutflows =
      CASES[caseId].assume === "慎重" && unregisteredGaichu.status === "未取得"
        ? [`未登録外注（Salesforceの${monthLabel(unregisteredGaichu.month)}の仕入でfreee未登録の外注）：未取得のため含めていない`]
        : [];
    return { id: caseId, label: CASES[caseId].label, ...(missingOutflows.length > 0 ? { missingOutflows } : {}), months };
  });

  const stdIncome = incomeFor("standard");
  const yearEndDay = `${N.slice(0, 4)}-12-31`;
  const dec31Receipts = {
    sfAdded: stdIncome.filter((e) => e.date === yearEndDay && e.sfKind).reduce((s, e) => s + e.amount, 0),
    sfAddedStandardKinds: stdIncome.filter((e) => e.date === yearEndDay && e.sfKind && includeSf["標準"].N.includes(e.sfKind)).reduce((s, e) => s + e.amount, 0),
    freeeUnsettled: inp.incomeDeals.filter((d) => d.issueDate <= BASE && asof(d) > 0 && d.dueDate === yearEndDay).reduce((s, d) => s + asof(d), 0),
  };

  const std = applied.standard ?? {};
  const cau = applied.cautious ?? {};
  const sumOf = (xs: unknown) => (Array.isArray(xs) ? xs.reduce((s: number, x: { amount: number }) => s + x.amount, 0) : 0);
  const sfMoved = (std.sfMoved as { amount: number; from: string; to: string }[]) ?? [];
  const notesMoved = (std.notes as { amount: number; due: string; assumedCashMonth: string }[]) ?? [];
  const lateSlip = (cau.lateSlip as { amount: number; due: string; assumedDate: string }[]) ?? [];
  const yearEndRelevant = N.slice(5) === "12";

  const notes = {
    basis: [
      `起点（${BASE}）は銀行明細の最終日。当座・普通預金${man(inp.baseBalances.checking)}・定期預金${man(inp.baseBalances.timeDeposit)}・現金${man(inp.baseBalances.cash)}（freeeの試算表の基準日時点の現金・預金の残高）`,
      "登録済み：freeeの未決済の売上・支払（基準日時点。基準日より後の決済は戻して数えた）と、給与明細の振込額（経費精算を含む）",
      `SF予定：freeeに未登録で、Salesforceに入金予定日があるもの。SF補完：入金予定日が空欄・請求日より前のものを請求翌月末で補ったもの（標準の${monthLabel(N)}だけに含める）`,
      `過去明細（定例）：直近3か月（${H.map(monthLabel).join("・")}）の銀行明細で、同じ摘要（摘要が番号だけのものは金額）の出金が2か月以上あるものの月ごとの合計の中央値（慎重は中央値と直近の月の大きい方）。口座振替は休業日なら翌営業日（月末の引落は翌月にずれる。慎重は予測の最終月の月末分を月内に置く）。同額に近い登録済みの支払が近い日にあるものは数えない（${checks.skippedRecurring.length}件）`,
      `自社振替：同日・同額・入出金が逆・別口座で、freeeの振替記録があるものだけを除外。当月の基準日までは確認済み${checks.ownTransfers.confirmed}件・保留${checks.ownTransfers.pending}件`,
      `月末一括振込：直近3か月の月末（最終3営業日）の最大の振込を、同日の外注の支払と一般経費に分けて推計し、それぞれ同じ分類の登録済み支払だけを差し引く（${bulkParts
        .map((b) => `${mdLabel(b.date)} ${man(b.bulk)}＝外注${man(b.gaichu)}＋一般${man(b.general)}`)
        .join("、")}）`,
      "経費精算：給与明細の振込額に含まれる。支給日期日で登録済みの経費精算の支払が明細の経費精算と同額なら、給与と重複させない",
      `入金照合：Salesforce確定案件（確度A・前月以降の請求）をfreeeの売上取引と取引先・請求月・金額で照合。曖昧なものは「判定保留（曖昧）」として予測に加えない`,
    ],
    estimates: [
      `給与：振込日は支給日の${payOffset}営業日前（直近の振込から推定）。振込と明細の差は直近3か月の平均${man(gapStat.mean)}（慎重は最大${man(gapStat.max)}${prevYearGap ? `、前年${monthLabel(N)}の差${man(prevYearGap.gap)}を含む` : ""}）。下書きの明細には直近3か月の経費精算の平均${man(recentExpense)}を加える`,
      `一般経費（月末一括振込の未登録分）：外注以外の平均${man(generalStat.mean)}（慎重は最大${man(generalStat.max)}）−登録済みの一般経費`,
      `外注：${monthLabel(M)}末は登録済みのみ。Salesforceの${monthLabel(unregisteredGaichu.month)}仕入でfreee未登録の外注${unregisteredGaichu.status === "未取得" ? "は、Salesforceの原価を取得できず未取得（慎重ケースはこの支出を含めていない）" : `${man(unregisteredGaichu.amount ?? 0)}（${unregisteredGaichu.vendors}社・原価${unregisteredGaichu.lines}件。同じ仕入月で照合し、前後の月のfreee取引は同じ支払先・同額のものだけ同一の支払と推定して差し引く）は、支払予定日→支払先の支払条件→freeeの同じ支払先の支払実績→翌月末の順で推定した日に個別に置く。標準は支払予定日・支払条件から支払月を推定できたもの（${man(unregisteredGaichu.items.filter((x) => x.inStandard).reduce((s2, x) => s2 + x.unregistered, 0))}）、慎重はすべて${unregisteredGaichu.termsReadable ? "" : "（Salesforceの支払予定日・支払条件は読めないため、標準には置かない）"}`}。個別に置いた分は、同じ月の同じ支払枠（1〜16日、または月末の最終3営業日〜月末）の過去平均の推計から引く。${monthLabel(N)}末の外注は直近3か月の月末期日の外注の平均${man(gaichuMeMean)}−登録済み（慎重は${prevYearBulkTxn ? `前年${monthLabel(N)}の月末一括振込${man(prevYearBulkTxn.amount)}−一般経費の最大` : "最大"}）`,

      `10日前後の取引先への振込：直近3回の1〜16日の振込（前月末分の繰越を除く）の中央値${man(vendorMidMean)}−登録済み`,
      "賞与：賞与明細が確定していればその額、無ければ前年の同じ月の支給実績（慎重は＋10%）",
      ...(sfMoved.length > 0
        ? [`仮定（確定情報ではない）：Salesforceの追加分のうち、請求日と入金予定日が同じ${sfMoved.length}件（${sfMoved.map((x) => man(x.amount)).join("、")}）は、請求の翌月末に入金と置く。移動先の月に同じ取引先の同額のfreee取引が無いことを確認（二重に数えない）`]
        : []),
      ...(notesMoved.length > 0
        ? [`仮定（確定情報ではない）：電子債権で決済する取引先の売上（${notesMoved.map((x) => `${mdLabel(x.due)}期日 ${man(x.amount)}`).join("、")}）は、期日前後に電子債権で受け取り約2か月後に現金化すると置き、予測期間に入れない`]
        : []),
      ...(lateSlip.length > 0 ? [`慎重の仮定：月末期日の入金を大きく遅れた実績と期日超過の未入金がある取引先の${monthLabel(M)}期日分（${man(sumOf(lateSlip))}）を${mdLabel(lateSlip[0].assumedDate)}へずらす`] : []),
      ...(yearEndRelevant
        ? [`年末：標準・慎重は12/31予定の入出金を前の営業日に寄せる。「年末入金が翌年へずれる」は12/31予定の入金（Salesforce ${man(dec31Receipts.sfAddedStandardKinds)}・freee ${man(dec31Receipts.freeeUnsettled)}）を翌年に回す`]
        : []),
    ],
    limits: [
      "ケースの違いは、確認した条件を置き換えた比較であり、未把握の支出や入金の遅れを含む予測誤差の範囲ではない",
      "定例の出金は過去3か月の銀行明細の型から置いたもので、その月だけの支払（労働保険・税の納付など）は含まない",
      "同じ取引先・同じ月に同額の案件が複数あるとき、どのfreee取引と対応するかは件数で割り当てている（判定の合計額は変わらない）",
      "日末残高は同じ日の入金と出金の順序に依存しない。同じ日に出金が先に起きた場合の最低は詳細の数値を参照",
      "PDF（経理報告・資金繰り表）の数値は計算に使っていない",
    ],
  };

  return {
    baseDate: BASE,
    months: [M, N],
    startBalances: inp.baseBalances,
    cases,
    dec31Receipts,
    checks: {
      ownTransfers: checks.ownTransfers,
      excludedFromBulk: [...checks.excludedFromBulk.entries()].map(([key, amount]) => {
        const [c, m, cls] = key.split("\u0000");
        return { case: c, month: m, class: cls, amount };
      }),
      bulkReference: bulkParts.map((b) => ({ date: b.date, bulk: b.bulk, byClass: { 外注: b.gaichu, 一般経費: b.general }, bulkClassesTotal: b.bulk })),
      payrollDecember: PAY[N] ?? null,
      adjustments: {
        bulkParts,
        monthEndGaichu,
        payrollGaps: gaps,
        prevYearGap,
        payrollOffsetBusinessDays: payOffset,
        vendorMid,
        generalBulk: generalStat,
        gaichuMonthEndMean: gaichuMeMean,
        payrollGap: gapStat,
        recentExpense,
        prevYearBulk: prevYearBulkTxn ? { date: prevYearBulkTxn.date, amount: prevYearBulkTxn.amount } : null,
        recurring: recurring.map((r) => ({ label: r.label, bucket: r.bucket, day: r.day, months: r.months, meanAmount: r.meanAmount, maxAmount: r.maxAmount })),
        timeDeposit: timeDepositLines,
        skippedRecurring: checks.skippedRecurring,
        notesPartnerCount: notesPartners.size,
        latePartnerCount: lateLag.size,
        unregisteredGaichu,
        byCase: applied,
      },
    },
    notes,
    dailyStandard,
  };
}

