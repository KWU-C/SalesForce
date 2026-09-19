"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useCssVar } from "@/utils/useCssVar";
import { formatPercent, formatYen } from "@/utils/format";
import { OPERATING_CATEGORIES, FINANCING_AND_RESERVE_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { SectionBanner } from "./SectionBanner";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  labor: "給与・人件費",
  outsourcing: "外注費",
  taxSocial: "税金・社会保険等",
  otherOperating: "諸経費",
  other: "その他",
  financing: "当月元本返済",
  interest: "支払利息",
  assetTransfer: "積立・資産移動",
};

interface ExpenseCompositionSectionProps {
  expenseByCategory: Record<ExpenseCategory, number>;
  /** 外部支出総額(振替除く)。比率の分母 */
  externalExpenseTotal: number;
  /** 未分類の出金(仕訳科目でも摘要ルールでも判定できないもの)。旧ロジックの保存分では未定義 */
  unclassified?: number;
}

interface PieTooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

function CompositionTooltip({ active, payload }: { active?: boolean; payload?: PieTooltipEntry[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
        <span className="text-[var(--text-secondary)]">{entry.name}</span>
      </div>
      <p className="mt-1 font-medium tabular-nums text-[var(--text-primary)]">
        {typeof entry.value === "number" ? formatYen(entry.value) : entry.value}
      </p>
    </div>
  );
}

function CategoryRow({
  category,
  amount,
  total,
  color,
}: {
  category: ExpenseCategory;
  amount: number;
  total: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[var(--text-secondary)]">{CATEGORY_LABEL[category]}</span>
      </div>
      <div className="text-right">
        <span className="font-medium tabular-nums text-[var(--text-primary)]">{formatYen(amount)}</span>
        <span className="ml-2 tabular-nums text-[var(--text-muted)]">
          {total > 0 ? formatPercent((amount / total) * 100) : "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * 支出構成セクション(補助情報)。その月に外部へ出ていった現金が何に使われたかを
 * 一目で把握できるようにする(ユーザー確定、2026-09-14)。8月検証で確立した分類
 * (config/freeeExpenseClassification)をそのまま使い、UI側で独自計算しない。
 *
 * 借入返済・積立資産移動は通常の営業コストと意味が異なるため、「財務・将来準備」として
 * 「通常運営」と見た目上も区別する(ユーザー確定)。
 */
export function ExpenseCompositionSection({
  expenseByCategory,
  externalExpenseTotal,
  unclassified,
}: ExpenseCompositionSectionProps) {
  const operatingColor1 = useCssVar("--series-category-1", "#00b5be");
  const operatingColor2 = useCssVar("--series-category-2", "#a892f4");
  const operatingColor3 = useCssVar("--series-category-3", "#416e29");
  const operatingColor4 = useCssVar("--series-category-4", "#c4606c");
  const operatingColor5 = useCssVar("--series-other", "#c9c7bf");
  const financingColor1 = useCssVar("--text-muted", "#8a8578");
  const financingColor2 = useCssVar("--series-category-5", "#c7ac41");
  const financingColor3 = useCssVar("--border-hairline", "#c9c4b8");
  const unclassifiedColor = useCssVar("--status-warning", "#d9822b");
  const surface = useCssVar("--surface-1", "#fcfcfb");

  const colorByCategory: Record<ExpenseCategory, string> = {
    labor: operatingColor1,
    outsourcing: operatingColor2,
    taxSocial: operatingColor3,
    otherOperating: operatingColor4,
    other: operatingColor5,
    financing: financingColor1,
    interest: financingColor2,
    assetTransfer: financingColor3,
  };

  const allCategories: ExpenseCategory[] = [...OPERATING_CATEGORIES, ...FINANCING_AND_RESERVE_CATEGORIES];
  const pieData = allCategories
    .map((c) => ({ name: CATEGORY_LABEL[c], value: expenseByCategory[c], color: colorByCategory[c] }))
    .concat(unclassified ? [{ name: "未分類", value: unclassified, color: unclassifiedColor }] : [])
    .filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>支出構成</SectionBanner>
      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex shrink-0 justify-center">
            {pieData.length === 0 ? (
              <div className="flex h-[180px] w-[180px] items-center justify-center text-xs text-[var(--text-muted)]">
                データなし
              </div>
            ) : (
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    startAngle={90}
                    endAngle={-270}
                    stroke={surface}
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {pieData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CompositionTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex-1">
            <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">通常運営</p>
            {OPERATING_CATEGORIES.map((c) => (
              <CategoryRow
                key={c}
                category={c}
                amount={expenseByCategory[c]}
                total={externalExpenseTotal}
                color={colorByCategory[c]}
              />
            ))}

            <p className="mb-1 mt-3 text-xs font-medium text-[var(--text-muted)]">財務・将来準備</p>
            {FINANCING_AND_RESERVE_CATEGORIES.map((c) => (
              <CategoryRow
                key={c}
                category={c}
                amount={expenseByCategory[c]}
                total={externalExpenseTotal}
                color={colorByCategory[c]}
              />
            ))}

            {unclassified !== undefined && (
              <>
                <p className="mb-1 mt-3 text-xs font-medium text-[var(--text-muted)]">未分類</p>
                <div className="flex items-center justify-between gap-3 py-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: unclassifiedColor }} />
                    <span className="text-[var(--text-secondary)]">判定できない出金</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium tabular-nums text-[var(--text-primary)]">{formatYen(unclassified)}</span>
                    <span className="ml-2 tabular-nums text-[var(--text-muted)]">
                      {externalExpenseTotal > 0 ? formatPercent((unclassified / externalExpenseTotal) * 100) : "—"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
