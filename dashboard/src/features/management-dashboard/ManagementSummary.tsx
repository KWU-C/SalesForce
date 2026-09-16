import { calendarYearForTermMonth } from "@/config/fiscalPeriods";
import { formatManYen, formatManYenSigned } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { MonthlyCashFlow } from "./types";
import type { LoanStatus } from "./loanStatus";

interface ManagementSummaryProps {
  term: number;
  month: number;
  cashFlow: MonthlyCashFlow | null;
  loanStatus: LoanStatus | null;
  /** 月末現預金の前月比(cashClosing - 前月のcashClosing)。ページ側で合成済み */
  cashClosingDiffFromPreviousMonth: number | null;
}

function Row({
  label,
  value,
  signed = false,
  bold = false,
}: {
  label: string;
  value: number | null;
  signed?: boolean;
  bold?: boolean;
}) {
  const formatted = value === null ? "データ未設定" : signed ? formatManYenSigned(value) : formatManYen(value);
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {formatted}
      </span>
    </div>
  );
}

/** 当期累計(KpiTile)と同じ大きさの見出し数字。ラベル左・金額右(ユーザー確定、2026-09-15) */
function BigRow({ label, value, signed = false }: { label: string; value: number | null; signed?: boolean }) {
  const formatted = value === null ? "データ未設定" : signed ? formatManYenSigned(value) : formatManYen(value);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{formatted}</span>
    </div>
  );
}

/** 前月比の小さい差額表示。マイナスの場合は赤字にする(ユーザー確定、2026-09-15) */
function DiffFromPreviousMonth({ value }: { value: number | null }) {
  const isNegative = value !== null && value < 0;
  return (
    <p
      className={`text-right text-xs ${isNegative ? "text-[var(--status-critical)]" : "text-[var(--text-muted)]"}`}
    >
      前月比 {value === null ? "データ未設定" : formatManYenSigned(value)}
    </p>
  );
}

function SummaryBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">{title}</p>
      {children}
    </div>
  );
}

/**
 * 経営サマリー。下の詳細セクション(月次資金収支・借入状況)のダイジェストを
 * 手元資金・今月の資金収支・借入状況の3ボックスに三等分して表示する
 * (ユーザー確定、2026-09-16)。各ボックスは
 * 「タイトル→項目名+大きい文字の数字→hr→小さい文字で補足情報」の同じ構造に揃える:
 * - 手元資金: 月末現預金(大) / 前月比(補足、マイナスは赤字)
 * - 今月の資金収支: 営業収支(大) / 当月現金増減(補足)
 * - 借入状況: 借入残高(大) / 今期借入純増減(補足)
 *
 * ここでの数字は下部の詳細セクションと必ず同じデータソース・同じ計算関数の結果を
 * そのまま使い、UI側で別計算はしない(ユーザー確定)。PL上の「利益」とキャッシュを
 * 混同しないよう、当期累計(売上・利益等)はここに含めない(ユーザー確定)。
 */
export function ManagementSummary({
  term,
  month,
  cashFlow,
  loanStatus,
  cashClosingDiffFromPreviousMonth,
}: ManagementSummaryProps) {
  const calendarYear = calendarYearForTermMonth(term, month);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        経営サマリー　{calendarYear}年{month}月
      </SectionBanner>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBox title="手元資金">
          <BigRow label="月末現預金" value={cashFlow?.cashClosing ?? null} />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <DiffFromPreviousMonth value={cashClosingDiffFromPreviousMonth} />
          </div>
        </SummaryBox>

        <SummaryBox title="今月の資金収支">
          <BigRow label="営業収支" value={cashFlow?.operatingCashFlow ?? null} signed />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="当月現金増減" value={cashFlow?.cashChange ?? null} signed />
          </div>
        </SummaryBox>

        <SummaryBox title="借入状況">
          <BigRow label="借入残高" value={loanStatus?.totalCurrent ?? null} />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="今期借入純増減" value={loanStatus?.netChange ?? null} signed bold />
          </div>
        </SummaryBox>
      </div>
    </div>
  );
}
