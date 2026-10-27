import { BUILDING_CANDIDATE_ACCOUNTS, BUILDING_ITEM_PREFIX } from "@/config/performanceClassification";
import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { PerformanceTable } from "./PerformanceTable";
import type { PerformanceTableRow } from "./PerformanceTable";
import { amountRows, ratioRows } from "./MonthlyPerformanceSection";
import { changeRate, sumValues } from "./performanceView";
import type { PerformanceMonth } from "./performanceView";
import type { MonthlyPerformance, PerformanceLine } from "./monthlyPerformance";

function nonOperatingBalance(performance: MonthlyPerformance | null): number | null {
  if (performance === null || performance.nonOperatingIncome === null || performance.nonOperatingExpense === null) {
    return null;
  }
  return performance.nonOperatingIncome - performance.nonOperatingExpense;
}

/** 当期の内訳行を、同じ見出し(科目・品目)ごとに期首からの累計へまとめる。金額の大きい順 */
function totalsByLabel(months: PerformanceMonth[], pick: (p: MonthlyPerformance) => PerformanceLine[], label: (l: PerformanceLine) => string) {
  const totals = new Map<string, number>();
  for (const m of months) {
    if (m.current === null) continue;
    for (const line of pick(m.current)) totals.set(label(line), (totals.get(label(line)) ?? 0) + line.amount);
  }
  return [...totals.entries()].filter(([, amount]) => amount !== 0).sort((a, b) => b[1] - a[1]);
}

function signedYen(v: number): string {
  return v < 0 ? `▲${formatYen(Math.abs(v))}` : formatYen(v);
}

/**
 * ③ 採算・固定費(ユーザー確定、2026-10-27)。
 * - 製造労務費・外注加工費([製]外注加工費、決算書と同じ)・[製]業務委託費(別項目)は金額と対売上比率
 * - 販管費・建物関連費用・マザー関連支出は金額と前年同期比
 * - 営業外損益は月次と累計(営業利益には含めない)
 * 建物関連費用とマザー関連支出は一部重なる(芦屋オフィスの地代)ため、別の指標として並べ、合算しない。
 */
export function CostStructureSection({ months }: { months: PerformanceMonth[] }) {
  const balanceCurrent = months.map((m) => nonOperatingBalance(m.current));
  const balancePrevious = months.map((m) => nonOperatingBalance(m.previous));
  const balanceCumulative = sumValues(balanceCurrent);
  const balancePreviousCumulative = sumValues(balancePrevious);

  const rows: PerformanceTableRow[] = [
    ...amountRows(months, "laborCost", "製造労務費", true),
    ...ratioRows(months, "laborCost", "対売上比率"),
    ...amountRows(months, "outsourcingCost", "外注加工費", true),
    ...ratioRows(months, "outsourcingCost", "対売上比率"),
    ...amountRows(months, "manufacturingConsignmentCost", "[製]業務委託費", true),
    ...ratioRows(months, "manufacturingConsignmentCost", "対売上比率"),
    ...amountRows(months, "sga", "販管費", true),
    ...amountRows(months, "buildingCost", "建物関連費用", true),
    ...amountRows(months, "motherExpense", "マザー関連支出", true),
    ...amountRows(months, "nonOperatingIncome", "営業外収益"),
    ...amountRows(months, "nonOperatingExpense", "営業外費用"),
    {
      kind: "amount",
      label: "営業外損益",
      values: balanceCurrent,
      cumulative: balanceCumulative,
      previousCumulative: balancePreviousCumulative,
      changeRate: changeRate(balanceCumulative, balancePreviousCumulative),
      bold: true,
    },
    {
      kind: "amount",
      label: "前年同月",
      values: balancePrevious,
      cumulative: null,
      previousCumulative: null,
      sub: true,
    },
  ];

  const buildingItems = totalsByLabel(months, (p) => p.buildingLines, (l) => `${l.item ?? ""}（${l.account}）`);
  const motherAccounts = totalsByLabel(months, (p) => p.motherLines, (l) => l.account);
  const unassigned = sumValues(months.map((m) => m.current?.buildingCandidateUnassigned ?? null));

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>採算・固定費</SectionBanner>
      <PerformanceTable months={months.map((m) => m.month)} rows={rows} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-xs text-[var(--text-secondary)]">
          <p className="mb-1 font-medium text-[var(--text-muted)]">建物関連費用の範囲（当期累計の内訳）</p>
          <p className="mb-2 text-[var(--text-muted)]">
            {`${BUILDING_CANDIDATE_ACCOUNTS.join("・")}のうち、品目が「${BUILDING_ITEM_PREFIX}」のものだけ。[製]賃借料のリース料（複合機・PC等）や修繕費の設備保全費は含めない。`}
          </p>
          {buildingItems.length === 0 ? (
            <p className="text-[var(--text-muted)]">該当なし</p>
          ) : (
            buildingItems.map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-3 py-0.5">
                <span>{label}</span>
                <span className="tabular-nums">{signedYen(amount)}</span>
              </div>
            ))
          )}
          {unassigned !== null && unassigned !== 0 && (
            <p className="mt-2 text-[var(--text-muted)]">
              ※ 上記の科目で品目が未選択の {signedYen(unassigned)} は、用途を識別できないため含めていません。
            </p>
          )}
        </div>
        <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 text-xs text-[var(--text-secondary)]">
          <p className="mb-1 font-medium text-[var(--text-muted)]">マザー関連支出の範囲（当期累計の内訳）</p>
          <p className="mb-2 text-[var(--text-muted)]">
            取引先「有限会社ティーシーディマザー」の費用すべて（科目別）。マザーからの雑収入は相殺せず、営業外収益に含む。
          </p>
          {motherAccounts.length === 0 ? (
            <p className="text-[var(--text-muted)]">該当なし</p>
          ) : (
            motherAccounts.map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-3 py-0.5">
                <span>{label}</span>
                <span className="tabular-nums">{signedYen(amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {"※ 建物関連費用とマザー関連支出は芦屋オフィスの地代（マザー所有）が両方に入るため、合算しないでください。費用は発生額（製造原価の分は仕掛品へ振り替わる前の額）。資産計上した建物・設備は含めない。"}
      </p>
    </div>
  );
}
