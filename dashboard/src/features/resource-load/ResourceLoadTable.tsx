import { formatPercent, formatYen } from "@/utils/format";
import type { CrResourceLoad } from "./resourceLoad";

const LOAD_RATE_TOOLTIP =
  "受注済み案件の粗利を受注月から完了月まで均等配分し、1人日100,000円として必要人日に換算。CR人数×月16人日の供給可能人日と比較した推定負荷率（実工数の実績ではなく参考指標）。";
const REFERENCE_VALUE_TOOLTIP = "受注済み案件の粗利を受注月〜完了月へ均等配分した、負荷計算用の参照額。";

/** 100%を跨ぐと読み間違えやすいため、しきい値で強調色を変える(参考指標であることは損なわない範囲での視認性配慮) */
function loadRateClassName(rate: number): string {
  if (rate >= 150) return "text-[var(--status-critical)] font-semibold";
  if (rate >= 100) return "text-[var(--status-warning)] font-semibold";
  return "text-[var(--text-primary)]";
}

/**
 * CR別推定負荷率テーブル(/resource)。既存の受注・完了・達成率・累計とは独立した
 * 参考指標であることが伝わるよう、ヘッダーに注記とツールチップを添える
 * (ユーザー確定、2026-09-18)。
 */
export function ResourceLoadTable({ crLoads, anomalyCount }: { crLoads: CrResourceLoad[]; anomalyCount: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--text-muted)]">
        推定負荷率は実工数の実績ではなく、受注済み案件の粗利から算出した参考指標です。既存の「受注」「完了」「達成率」とは独立しています。
      </p>
      {anomalyCount > 0 && (
        <p className="text-xs text-[var(--status-serious)]">
          受注日より完了日が前になっている等、配賦できない案件が{anomalyCount}件あり、計算から除外しています。
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-left text-xs font-medium text-[var(--text-muted)]">
              <th className="px-3 py-2">CR</th>
              <th className="px-3 py-2 text-right">人数</th>
              <th className="px-3 py-2 text-right" title={LOAD_RATE_TOOLTIP}>
                直近1か月負荷率
              </th>
              <th className="px-3 py-2 text-right" title={LOAD_RATE_TOOLTIP}>
                直近3か月負荷率
              </th>
              <th className="px-3 py-2 text-right" title={REFERENCE_VALUE_TOOLTIP}>
                完了参照値(1か月)
              </th>
              <th className="px-3 py-2 text-right" title={REFERENCE_VALUE_TOOLTIP}>
                完了参照値(3か月)
              </th>
            </tr>
          </thead>
          <tbody>
            {crLoads.map((row) => (
              <tr key={row.crId} className="border-t border-[var(--gridline)]">
                <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{row.crId}</td>
                <td className="px-3 py-2 text-right">{row.headcount}人</td>
                <td className={`px-3 py-2 text-right ${loadRateClassName(row.loadRate1m)}`}>
                  {formatPercent(row.loadRate1m)}
                </td>
                <td className={`px-3 py-2 text-right ${loadRateClassName(row.loadRate3m)}`}>
                  {formatPercent(row.loadRate3m)}
                </td>
                <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                  {formatYen(row.referenceGrossProfit1m)}
                </td>
                <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                  {formatYen(row.referenceGrossProfit3m)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
