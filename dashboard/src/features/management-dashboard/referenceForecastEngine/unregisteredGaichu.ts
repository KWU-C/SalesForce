import { addDays, addMonths, dayInMonth, lastDayOfMonth, monthsBetween, nextBusinessDay, previousBusinessDay, ym } from "./calendar";
import { normalizeName } from "./salesMatching";
import type { RfDeal, RfSfCost } from "./types";

/**
 * Salesforceの原価でfreee未登録の外注(慎重ケースの支払候補)と、その支払日(2026-11-18 改訂、ユーザー指定)。
 *
 * 照合:
 * - 同じ仕入月が基本。Salesforceの仕入月(基準月の前月)の原価と、同じ支払先・同じ月が発生日のfreeeの原価の取引を突き合わせる
 * - 前後の月のfreee取引は、同一の支払と確認できた場合だけ差し引く。freeeに請求書番号・摘要が無く、タグもSalesforceの案件・
 *   管理Noと対応しないため、確認の手がかりは金額だけ。同じ支払先で、未照合の原価1件(またはその月の未照合の合計)と1円単位で一致し、
 *   かつその取引の発生月に同額の原価が無いものに限る。同じ支払先というだけでは差し引かない
 * 支払日(freeeに未登録のため推定。根拠を記録する):
 *   1. Salesforceの原価の支払予定日  2. Salesforceの支払先(取引先)の支払パターン・休日の取扱い
 *   3. freeeの同じ支払先の過去の取引の発生月→支払期日の型  4. 既定(翌月末。Salesforceの支払パターンで最も多い)
 *   推定した期日が基準日以前なら、まだ払っていないものとして基準日の翌営業日に置く
 */

export interface UnregisteredGaichuItem {
  /** 支払先の匿名コード(未登録額の大きい順) */
  vendor: string;
  lines: number;
  sfAmount: number;
  freeeSameMonth: number;
  /** 前後の月のfreee取引で同一の支払と確認して差し引いたもの */
  freeeAdjacentConfirmed: { issueDate: string; amount: number; how: string }[];
  /** 前後の月のfreee取引で、同一の支払と確認できず差し引かなかったもの */
  freeeAdjacentNotDeducted: { issueDate: string; amount: number }[];
  unregistered: number;
  payDate: string;
  payDateBasis: string;
}

export type UnregisteredGaichu =
  | { month: string; status: "未取得"; amount: null; vendors: null; lines: null; costLines: null; costTotal: null; termsReadable: boolean; items: [] }
  | {
      month: string;
      status: "取得";
      amount: number;
      vendors: number;
      lines: number;
      costLines: number;
      costTotal: number;
      /** 支払予定日・支払先の支払条件をSalesforceから読めたか(読めないときは freee の支払実績・既定で推定) */
      termsReadable: boolean;
      items: UnregisteredGaichuItem[];
    };

/** 原価の取引か(外注・製造原価・仕入・支払報酬)。福利厚生費などの一般経費は照合に使わない */
export function isCostDeal(d: RfDeal): boolean {
  return d.details.some((x) => x.accountName.includes("外注") || x.accountName.startsWith("[製]") || x.accountName.includes("仕入") || x.accountName.includes("支払報酬"));
}

const related = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

function adjustHoliday(date: string, holiday: string | null | undefined): string {
  return holiday?.includes("前営業日") ? previousBusinessDay(date) : nextBusinessDay(date);
}

/** Salesforceの支払パターン名から支払日を決める。分からないパターンは null */
function dateFromPattern(pattern: string, purchaseMonth: string, latestPurchase: string): string | null {
  if (pattern.includes("翌々月10日")) return dayInMonth(addMonths(purchaseMonth, 2), 10);
  if (pattern.includes("翌月末")) return lastDayOfMonth(addMonths(purchaseMonth, 1));
  if (pattern.includes("随時") && pattern.includes("10日")) return addDays(latestPurchase, 10);
  return null;
}

export function computeUnregisteredGaichu(args: {
  /** 基準月の前月(仕入月) */
  month: string;
  baseDate: string;
  sfCosts: RfSfCost[] | null;
  termsReadable: boolean;
  expenseDeals: RfDeal[];
  partners: Map<number, string>;
}): UnregisteredGaichu {
  const { month, baseDate, sfCosts, termsReadable, expenseDeals, partners } = args;
  if (sfCosts === null) return { month, status: "未取得", amount: null, vendors: null, lines: null, costLines: null, costTotal: null, termsReadable, items: [] };
  const prevM = addMonths(month, -1);
  const nextM = addMonths(month, 1);
  const byVendorMonth = new Map<string, Map<string, RfSfCost[]>>();
  for (const c of sfCosts) {
    const m = (c.purchaseDate ?? "").slice(0, 7);
    if (m !== prevM && m !== month && m !== nextM) continue;
    const v = normalizeName(c.vendorName);
    const mm = byVendorMonth.get(v) ?? new Map<string, RfSfCost[]>();
    mm.set(m, [...(mm.get(m) ?? []), c]);
    byVendorMonth.set(v, mm);
  }
  const costDeals = expenseDeals.filter(isCostDeal).map((d) => ({ d, p: normalizeName(partners.get(d.partnerId ?? -1) ?? "") })).filter((x) => x.p);

  let costLines = 0;
  let costTotal = 0;
  const raw: Omit<UnregisteredGaichuItem, "vendor">[] = [];
  for (const [v, months] of byVendorMonth) {
    const lines = months.get(month) ?? [];
    if (lines.length === 0) continue;
    costLines += lines.length;
    const sfAmount = lines.reduce((s, c) => s + Math.round(c.amountTaxIncluded), 0);
    costTotal += sfAmount;
    const deals = costDeals.filter((x) => related(x.p, v)).map((x) => x.d);
    const sameMonth = deals.filter((d) => ym(d.issueDate) === month).reduce((s, d) => s + d.amount, 0);
    // 同じ月で照合できなかった原価(金額の大きい順に、同じ月の登録額で消し込む)
    let covered = sameMonth;
    const open: number[] = [];
    for (const c of [...lines].sort((a, b) => b.amountTaxIncluded - a.amountTaxIncluded)) {
      const a = Math.round(c.amountTaxIncluded);
      if (covered >= a) covered -= a;
      else {
        open.push(a - covered);
        covered = 0;
      }
    }
    const confirmed: UnregisteredGaichuItem["freeeAdjacentConfirmed"] = [];
    const notDeducted: UnregisteredGaichuItem["freeeAdjacentNotDeducted"] = [];
    for (const d of deals.filter((x) => ym(x.issueDate) === prevM || ym(x.issueDate) === nextM).sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1))) {
      const own = (months.get(ym(d.issueDate)) ?? []).some((c) => Math.round(c.amountTaxIncluded) === d.amount);
      const openTotal = open.reduce((s, x) => s + x, 0);
      const i = open.findIndex((x) => x === d.amount);
      if (!own && i >= 0) {
        open.splice(i, 1);
        confirmed.push({ issueDate: d.issueDate, amount: d.amount, how: "同じ支払先で未照合の原価1件と金額が一致（発生月に同額の原価なし）" });
      } else if (!own && openTotal > 0 && d.amount === openTotal) {
        open.length = 0;
        confirmed.push({ issueDate: d.issueDate, amount: d.amount, how: "同じ支払先で未照合の原価の合計と金額が一致（発生月に同額の原価なし）" });
      } else notDeducted.push({ issueDate: d.issueDate, amount: d.amount });
    }
    const unregistered = open.reduce((s, x) => s + x, 0);
    if (unregistered <= 0) continue;

    // 支払日
    const latestPurchase = lines.map((c) => c.purchaseDate ?? `${month}-01`).sort().at(-1) as string;
    const dated = lines.filter((c) => c.paymentDueDate).sort((a, b) => b.amountTaxIncluded - a.amountTaxIncluded);
    const terms = lines.find((c) => c.vendorTerms)?.vendorTerms ?? null;
    let payDate: string;
    let payDateBasis: string;
    const fromPattern = terms?.pattern ? dateFromPattern(terms.pattern, month, latestPurchase) : null;
    if (dated.length > 0) {
      payDate = adjustHoliday(dated[0].paymentDueDate as string, terms?.holiday);
      payDateBasis = `Salesforceの原価の支払予定日 ${dated[0].paymentDueDate}${payDate !== dated[0].paymentDueDate ? `（休業日のため${payDate}）` : ""}`;
    } else if (fromPattern) {
      payDate = adjustHoliday(fromPattern, terms?.holiday);
      payDateBasis = `Salesforceの支払先の支払パターン「${terms?.pattern}」${terms?.holiday ? `・休日は${terms.holiday}` : ""}`;
    } else {
      const hist = deals
        .filter((d) => d.dueDate && ym(d.issueDate) < month)
        .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0];
      if (hist?.dueDate) {
        const offset = monthsBetween(ym(hist.issueDate), ym(hist.dueDate)) - 1;
        const endOfMonth = hist.dueDate === lastDayOfMonth(ym(hist.dueDate));
        const target = addMonths(month, offset);
        const raw2 = endOfMonth ? lastDayOfMonth(target) : dayInMonth(target, Number(hist.dueDate.slice(8, 10)));
        payDate = nextBusinessDay(raw2);
        payDateBasis = `freeeの同じ支払先の直近の取引（発生${hist.issueDate}→期日${hist.dueDate}）と同じ型（発生月の${offset}か月後の${endOfMonth ? "月末" : `${Number(hist.dueDate.slice(8, 10))}日`}）`;
      } else {
        payDate = nextBusinessDay(lastDayOfMonth(addMonths(month, 1)));
        payDateBasis = "既定：支払予定日・支払条件・freeeの支払実績が無いため翌月末（Salesforceの支払パターンで最も多い）";
      }
    }
    if (payDate <= baseDate) {
      payDateBasis += `。推定の期日${payDate}が基準日以前でfreeeにも未登録のため、まだ払っていないものとして基準日の翌営業日に置く`;
      payDate = nextBusinessDay(addDays(baseDate, 1));
    }
    raw.push({
      lines: lines.length,
      sfAmount,
      freeeSameMonth: sameMonth,
      freeeAdjacentConfirmed: confirmed,
      freeeAdjacentNotDeducted: notDeducted,
      unregistered,
      payDate,
      payDateBasis,
    });
  }
  const items = raw
    .sort((a, b) => b.unregistered - a.unregistered)
    .map((x, i) => ({ vendor: `U${String(i + 1).padStart(2, "0")}`, ...x }));
  return {
    month,
    status: "取得",
    amount: items.reduce((s, x) => s + x.unregistered, 0),
    vendors: items.length,
    lines: items.reduce((s, x) => s + x.lines, 0),
    costLines,
    costTotal,
    termsReadable,
    items,
  };
}
