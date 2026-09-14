import { formatPercent, formatYen } from "@/utils/format";
import type { FinancialSummary } from "./financialSummary";

interface KpiTileProps {
  title: string;
  value: number | null;
  formatter: (v: number) => string;
  subLabel?: string;
}

function KpiTile({ title, value, formatter, subLabel }: KpiTileProps) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {value === null ? "データ未設定" : formatter(value)}
      </p>
      {subLabel && <p className="text-xs text-[var(--text-muted)]">{subLabel}</p>}
    </div>
  );
}

interface FinancialSummaryCardsProps {
  summary: FinancialSummary;
}

/**
 * freeeの経営サマリー。値が取得できない項目(該当勘定科目が無い等)は「データ未設定」と
 * 表示し、0円等の推測値は絶対に出さない(ユーザー確定の方針)。
 */
export function FinancialSummaryCards({ summary }: FinancialSummaryCardsProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">経営サマリー（当期累計）</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile title="売上高" value={summary.revenue} formatter={formatYen} />
          <KpiTile
            title="粗利益"
            value={summary.grossProfit}
            formatter={formatYen}
            subLabel={summary.grossProfitRate === null ? undefined : `粗利率 ${formatPercent(summary.grossProfitRate)}`}
          />
          <KpiTile
            title="営業利益"
            value={summary.operatingProfit}
            formatter={formatYen}
            subLabel={
              summary.operatingProfitRate === null
                ? undefined
                : `営業利益率 ${formatPercent(summary.operatingProfitRate)}`
            }
          />
          <KpiTile title="経常利益" value={summary.ordinaryProfit} formatter={formatYen} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">財務・キャッシュ（現時点）</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile title="現預金" value={summary.cashAndDeposits} formatter={formatYen} />
          <KpiTile title="売掛金" value={summary.accountsReceivable} formatter={formatYen} />
          <KpiTile title="買掛金・未払金" value={summary.accountsPayable} formatter={formatYen} />
          <KpiTile title="借入金" value={summary.borrowings} formatter={formatYen} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">採算性</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* 対象人数データソース未接続のため常に「データ未設定」。推測値は出さない(ユーザー確定) */}
          <KpiTile title="粗利パーヘッド（月額）" value={null} formatter={formatYen} subLabel="対象人数データ未接続" />
        </div>
      </div>
    </div>
  );
}
