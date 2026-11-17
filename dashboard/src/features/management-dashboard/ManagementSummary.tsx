import { calendarYearForTermMonth } from "@/config/fiscalPeriods";
import { formatDateTime, formatManYen, formatManYenSigned } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { MonthlyCashFlow } from "./types";
import type { LoanStatus } from "./loanStatus";

interface ManagementSummaryProps {
  term: number;
  month: number;
  cashFlow: MonthlyCashFlow | null;
  loanStatus: LoanStatus | null;
  /** 当月の月次資金収支の取得日時 */
  fetchedAt: Date | null;
}

function Row({
  label,
  value,
  signed = false,
  bold = false,
  emptyLabel = "データ未設定",
}: {
  label: string;
  value: number | null;
  signed?: boolean;
  bold?: boolean;
  emptyLabel?: string;
}) {
  const formatted = value === null ? emptyLabel : signed ? formatManYenSigned(value) : formatManYen(value);
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`whitespace-nowrap tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
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

function SummaryBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">{title}</p>
      {children}
    </div>
  );
}

/**
 * 資金収支・借入(当月末の帳簿)。2026-11-17に概要から財務・資金繰りタブへ移した(概要は月末残高の資金サマリーに統合)。
 * 旧: 資金サマリー(概要、2026-11-13にユーザー指定の構成へ整理、11-16更新)。当月末時点のfreee帳簿(取得時点までの登録分)の
 * 資金状態を3枠にまとめる: 手元資金/今月の資金収支/借入状況。資金余力は手入力の準備額に依存するため外した。
 * いずれも詳細タブ(入出金明細・財務・資金繰り)と同じデータ・同じ計算関数の結果をそのまま使い、ここでは別計算しない
 * (現預金と借入の差額 = 現預金 − 借入残高 のみ、ここで求める。使える資金の額ではない)。
 * 当月途中の残高を「月末現預金」とは呼ばない(月末の見通しと誤解されるため)。
 * 各ボックスは「タイトル→項目名+大きい文字の数字→hr→小さい文字で補足情報」(ユーザー確定、2026-09-16)。
 */
export function ManagementSummary({
  term,
  month,
  cashFlow,
  loanStatus,
  fetchedAt,
}: ManagementSummaryProps) {
  const calendarYear = calendarYearForTermMonth(term, month);
  // 現預金と借入の差額 = 現預金 − 借入残高(資金の備えと同じ向き)。使える資金の額ではない
  const loanTotal = loanStatus?.totalCurrent ?? null;
  const cashClosing = cashFlow?.cashClosing ?? null;
  const cashMinusLoans = loanTotal === null || cashClosing === null ? null : cashClosing - loanTotal;

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>資金収支・借入（当月末の帳簿）</SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        {calendarYear}年{month}月末時点のfreee帳簿の値（取得時点までに登録された取引。先日付の登録済み取引を含む）
        {fetchedAt ? `／freee取得: ${formatDateTime(fetchedAt)}` : ""}
        <span className="text-[var(--text-muted)]">（当日の口座残高・月末の見通しではありません）</span>
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryBox title="手元資金">
          {/* 前月末の残高は「資金残高（前月末実績）」欄に分けた(2026-11-16、同じ値を重ねない) */}
          <BigRow label="現預金残高（当月末の帳簿）" value={cashClosing} />
        </SummaryBox>

        <SummaryBox title="今月の資金収支">
          <BigRow label="当月現金増減" value={cashFlow?.cashChange ?? null} signed />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="うち営業収支" value={cashFlow?.operatingCashFlow ?? null} signed />
          </div>
        </SummaryBox>

        <SummaryBox title="借入状況">
          <BigRow label="借入残高" value={loanStatus?.totalCurrent ?? null} />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="今期借入純増減" value={loanStatus?.netChange ?? null} signed bold />
            <Row label="現預金と借入の差額（現預金−借入残高）" value={cashMinusLoans} signed />
          </div>
        </SummaryBox>

      </div>
    </div>
  );
}
