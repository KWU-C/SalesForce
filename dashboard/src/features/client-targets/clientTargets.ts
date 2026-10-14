import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import type { ConcreteCrId, CrId } from "@/domain/types";

/** 目標・実績の明細1行(CR×クライアント×日付) */
export interface ClientAmountRow {
  crId: ConcreteCrId;
  /** null: 目標ではクライアント未指定(未配分目標)、実績ではクライアント名なし */
  clientName: string | null;
  /** YYYY-MM-DD */
  date: string;
  grossProfit: number | null;
}

/** 担当者判定用の案件1行(CR×クライアント×営業担当者) */
export interface ClientSalesRepRow {
  crId: ConcreteCrId;
  clientName: string | null;
  salesRepName: string;
  grossProfit: number | null;
}

export interface ClientTargetInput {
  crIds: readonly ConcreteCrId[];
  /** 当月(暦月)。当月までの累計と月次達成率の基準月 */
  currentMonth: number;
  targets: ClientAmountRow[];
  completed: ClientAmountRow[];
  orders: ClientAmountRow[];
  /** 担当者判定用の案件(前期期首〜当期末の受注日、失注以外) */
  salesReps: ClientSalesRepRow[];
  /** SalesTarget__cのCR別年間目標粗利(営業進捗タブと同じ値)。取得できなければnull */
  crAnnualTargets: Partial<Record<ConcreteCrId, number | null>>;
}

/**
 * 行の種類。
 * - client: クライアント指定済みの目標がある
 * - unallocated: クライアント未指定の目標(未配分目標)。実績は紐づかない
 * - untargeted: 実績はあるが同じCRに目標が無いクライアント(クライアント名なしの実績を含む)
 */
export type ClientRowKind = "client" | "unallocated" | "untargeted";

export interface ClientProgressRow {
  kind: ClientRowKind;
  crId: ConcreteCrId;
  clientName: string | null;
  /** 担当者表示(粗利最大の営業担当者。複数いれば「〇〇 他N名」)。該当案件が無ければnull */
  salesRep: string | null;
  annualTarget: number;
  /** 期首〜当月の完了粗利 */
  completedToDate: number;
  /** 当期全月の完了粗利(当月より先の請求予定分を含む) */
  completedFullYear: number;
  /** 期首〜当月の完了粗利 ÷ 年間目標(%)。目標0ならnull */
  annualRate: number | null;
  monthTarget: number;
  monthCompleted: number;
  /** 当月完了粗利 ÷ 当月目標(%)。目標0ならnull */
  monthRate: number | null;
  /** 当月の受注粗利 */
  monthOrder: number;
  /** 当月受注粗利 ÷ 当月目標(%)。目標0ならnull(ユーザー確定、2026-10-14) */
  monthOrderRate: number | null;
  /** 期首〜当月の受注粗利(先行指標) */
  orderToDate: number;
  /** 当期全月の受注粗利(当月より先の受注日を含む) */
  orderFullYear: number;
}

export interface MonthlyClientTargetPoint {
  month: number;
  /** 当月より先の月か(達成率を出さない) */
  isFuture: boolean;
  target: number;
  completed: number;
  order: number;
  cumulativeTarget: number;
  cumulativeCompleted: number;
}

export interface ClientTargetSummary {
  /** 年間目標 = クライアント指定済み目標 + 未配分目標 */
  annualTarget: number;
  clientTarget: number;
  unallocatedTarget: number;
  completedToDate: number;
  completedFullYear: number;
  /** 期首〜当月の完了粗利 ÷ 年間目標 */
  annualRate: number | null;
  monthTarget: number;
  monthCompleted: number;
  monthRate: number | null;
  orderToDate: number;
  orderFullYear: number;
  /** 目標未設定クライアント分(内数) */
  untargetedCompletedToDate: number;
  untargetedCompletedFullYear: number;
  untargetedOrderToDate: number;
  untargetedOrderFullYear: number;
  /** SalesTarget__cのCR年間目標(営業進捗タブの目標)。全社はCR合計。1つでも欠ければnull */
  crAnnualTarget: number | null;
  /** CR年間目標 − 年間目標(Profit__c目標レコードの合計)。crAnnualTargetがnullならnull */
  crTargetGap: number | null;
}

export interface ClientTargetScope {
  scopeId: CrId;
  summary: ClientTargetSummary;
  /** クライアント指定済みの目標。年間目標の降順(全社でもCRで区切らない、ユーザー確定、2026-10-14) */
  targetedClients: ClientProgressRow[];
  /** 未配分目標(CRごとに最大1行)。CR順 */
  unallocatedTargets: ClientProgressRow[];
  /** 目標未設定クライアントの実績。CR順・期首〜当月の完了粗利の降順 */
  untargetedClients: ClientProgressRow[];
  monthly: MonthlyClientTargetPoint[];
}

function rate(actual: number, target: number): number | null {
  if (target === 0) return null;
  return Math.round((actual / target) * 1000) / 10;
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

function clientKey(crId: ConcreteCrId, clientName: string | null): string {
  return `${crId}\u0000${clientName ?? ""}`;
}

/** 全社表示ではCR順にまとめる */
function byCr(a: ClientProgressRow, b: ClientProgressRow): number {
  return a.crId.localeCompare(b.crId);
}

interface Accumulator {
  /** 目標側のクライアント未指定行か(実績側のクライアント名なしとは別に扱う) */
  isUnallocatedSlot: boolean;
  crId: ConcreteCrId;
  clientName: string | null;
  targetByMonth: Map<number, number>;
  completedByMonth: Map<number, number>;
  orderByMonth: Map<number, number>;
}

function addTo(map: Map<number, number>, month: number, amount: number | null) {
  map.set(month, (map.get(month) ?? 0) + (amount ?? 0));
}

function sumMonths(map: Map<number, number>, months: readonly number[]): number {
  return months.reduce((total, m) => total + (map.get(m) ?? 0), 0);
}

function kindOf(acc: Accumulator): ClientRowKind {
  if (acc.isUnallocatedSlot) return "unallocated";
  return acc.targetByMonth.size > 0 ? "client" : "untargeted";
}

/**
 * 粗利最大の営業担当者を担当者とする。複数いれば「〇〇 他N名」。
 * 粗利が同額なら名前順で決める(表示が実行ごとに揺れないように)。
 */
export function formatSalesRep(grossProfitByRep: Map<string, number> | undefined): string | null {
  if (!grossProfitByRep || grossProfitByRep.size === 0) return null;
  const [top] = [...grossProfitByRep.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return grossProfitByRep.size === 1 ? top[0] : `${top[0]} 他${grossProfitByRep.size - 1}名`;
}

function toRow(
  acc: Accumulator,
  currentMonth: number,
  monthsToDate: readonly number[],
  salesRep: string | null
): ClientProgressRow {
  const annualTarget = sumMonths(acc.targetByMonth, FISCAL_MONTH_ORDER);
  const completedToDate = sumMonths(acc.completedByMonth, monthsToDate);
  const monthTarget = acc.targetByMonth.get(currentMonth) ?? 0;
  const monthCompleted = acc.completedByMonth.get(currentMonth) ?? 0;
  const monthOrder = acc.orderByMonth.get(currentMonth) ?? 0;
  return {
    kind: kindOf(acc),
    crId: acc.crId,
    clientName: acc.clientName,
    salesRep,
    annualTarget,
    completedToDate,
    completedFullYear: sumMonths(acc.completedByMonth, FISCAL_MONTH_ORDER),
    annualRate: rate(completedToDate, annualTarget),
    monthTarget,
    monthCompleted,
    monthRate: rate(monthCompleted, monthTarget),
    monthOrder,
    monthOrderRate: rate(monthOrder, monthTarget),
    orderToDate: sumMonths(acc.orderByMonth, monthsToDate),
    orderFullYear: sumMonths(acc.orderByMonth, FISCAL_MONTH_ORDER),
  };
}

function buildScope(
  scopeId: CrId,
  accumulators: Accumulator[],
  currentMonth: number,
  crAnnualTarget: number | null,
  salesRepByKey: Map<string, Map<string, number>>
): ClientTargetScope {
  const currentIndex = FISCAL_MONTH_ORDER.indexOf(currentMonth);
  const monthsToDate = FISCAL_MONTH_ORDER.slice(0, currentIndex + 1);
  const rows = accumulators.map((acc) =>
    toRow(acc, currentMonth, monthsToDate, acc.isUnallocatedSlot ? null : formatSalesRep(salesRepByKey.get(clientKey(acc.crId, acc.clientName))))
  );
  const ofKind = (kind: ClientRowKind) => rows.filter((r) => r.kind === kind);
  const sum = (items: ClientProgressRow[], pick: (r: ClientProgressRow) => number) =>
    items.reduce((total, r) => total + pick(r), 0);

  const untargeted = ofKind("untargeted");
  const annualTarget = sum(rows, (r) => r.annualTarget);
  const completedToDate = sum(rows, (r) => r.completedToDate);
  const monthTarget = sum(rows, (r) => r.monthTarget);
  const monthCompleted = sum(rows, (r) => r.monthCompleted);

  let cumulativeTarget = 0;
  let cumulativeCompleted = 0;
  const monthly = FISCAL_MONTH_ORDER.map((month, index) => {
    const target = accumulators.reduce((t, a) => t + (a.targetByMonth.get(month) ?? 0), 0);
    const completed = accumulators.reduce((t, a) => t + (a.completedByMonth.get(month) ?? 0), 0);
    const order = accumulators.reduce((t, a) => t + (a.orderByMonth.get(month) ?? 0), 0);
    cumulativeTarget += target;
    cumulativeCompleted += completed;
    return { month, isFuture: index > currentIndex, target, completed, order, cumulativeTarget, cumulativeCompleted };
  });

  return {
    scopeId,
    summary: {
      annualTarget,
      clientTarget: sum(ofKind("client"), (r) => r.annualTarget),
      unallocatedTarget: sum(ofKind("unallocated"), (r) => r.annualTarget),
      completedToDate,
      completedFullYear: sum(rows, (r) => r.completedFullYear),
      annualRate: rate(completedToDate, annualTarget),
      monthTarget,
      monthCompleted,
      monthRate: rate(monthCompleted, monthTarget),
      orderToDate: sum(rows, (r) => r.orderToDate),
      orderFullYear: sum(rows, (r) => r.orderFullYear),
      untargetedCompletedToDate: sum(untargeted, (r) => r.completedToDate),
      untargetedCompletedFullYear: sum(untargeted, (r) => r.completedFullYear),
      untargetedOrderToDate: sum(untargeted, (r) => r.orderToDate),
      untargetedOrderFullYear: sum(untargeted, (r) => r.orderFullYear),
      crAnnualTarget,
      crTargetGap: crAnnualTarget === null ? null : crAnnualTarget - annualTarget,
    },
    targetedClients: ofKind("client").sort((a, b) => b.annualTarget - a.annualTarget || byCr(a, b)),
    unallocatedTargets: ofKind("unallocated").sort(byCr),
    untargetedClients: untargeted.sort(
      (a, b) => byCr(a, b) || b.completedToDate - a.completedToDate || b.completedFullYear - a.completedFullYear
    ),
    monthly,
  };
}

/**
 * クライアント別目標の進捗を、全社とCRごとに集計する。
 *
 * 集計単位は「CR × クライアント名」で、既存のSalesforceレポート「クライアント別目標進捗」
 * (Profit__c.bumon__c × clientName__c でグルーピング)と同じ。Account Idは連携ユーザーが
 * 参照できないため使わない。親子会社などで目標と実績のクライアント名が異なる場合は、
 * 実績側が「目標未設定」に分かれる。按分や名寄せはしない(ユーザー確定、2026-10-14)。
 *
 * 完了粗利・受注粗利は「期首〜当月の累計」と「通年(当月より先の予定分を含む)」を
 * 分けて持つ。年間達成率は期首〜当月の累計完了粗利 ÷ 年間目標(ユーザー確定、2026-10-14)。
 * 年間目標はクライアント未指定の目標(未配分目標)を含む合計。
 */
export function computeClientTargetProgress(input: ClientTargetInput): ClientTargetScope[] {
  const byKey = new Map<string, Accumulator>();
  const get = (crId: ConcreteCrId, clientName: string | null, isUnallocatedSlot: boolean) => {
    const key = isUnallocatedSlot ? `${crId}\u0000\u0001` : clientKey(crId, clientName);
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        isUnallocatedSlot,
        crId,
        clientName,
        targetByMonth: new Map(),
        completedByMonth: new Map(),
        orderByMonth: new Map(),
      };
      byKey.set(key, acc);
    }
    return acc;
  };

  for (const row of input.targets) {
    addTo(get(row.crId, row.clientName, row.clientName === null).targetByMonth, monthOf(row.date), row.grossProfit);
  }
  for (const row of input.completed) {
    addTo(get(row.crId, row.clientName, false).completedByMonth, monthOf(row.date), row.grossProfit);
  }
  for (const row of input.orders) {
    addTo(get(row.crId, row.clientName, false).orderByMonth, monthOf(row.date), row.grossProfit);
  }

  const salesRepByKey = new Map<string, Map<string, number>>();
  for (const row of input.salesReps) {
    const key = clientKey(row.crId, row.clientName);
    const byRep = salesRepByKey.get(key) ?? new Map<string, number>();
    byRep.set(row.salesRepName, (byRep.get(row.salesRepName) ?? 0) + (row.grossProfit ?? 0));
    salesRepByKey.set(key, byRep);
  }

  const all = [...byKey.values()];
  const crTargets = input.crIds.map((crId) => input.crAnnualTargets[crId] ?? null);
  const companyCrTarget = crTargets.every((v) => v !== null)
    ? crTargets.reduce((total: number, v) => total + (v ?? 0), 0)
    : null;

  return [
    buildScope("ALL", all, input.currentMonth, companyCrTarget, salesRepByKey),
    ...input.crIds.map((crId) =>
      buildScope(
        crId,
        all.filter((acc) => acc.crId === crId),
        input.currentMonth,
        input.crAnnualTargets[crId] ?? null,
        salesRepByKey
      )
    ),
  ];
}
