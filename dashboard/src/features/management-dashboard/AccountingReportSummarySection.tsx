import { formatDateTime } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { crossCheck, formatOkuManYen } from "./accountingReportSummary";
import type { AccountingReportSummaryResult } from "./accountingReportSummary";
import type { PerformanceColumn } from "./overviewComparison";

function amountOrBlank(value: number | null): string {
  return value === null ? "記載なし" : formatOkuManYen(value);
}

function changeText(value: number): string {
  return `${formatOkuManYen(Math.abs(value))}${value < 0 ? "減少" : "増加"}`;
}

function Row({ label, main, mainTone, lines, check }: {
  label: string;
  main: string;
  mainTone: "primary" | "serious" | "muted";
  lines: string[];
  check?: string;
}) {
  const tone =
    mainTone === "serious" ? "text-[var(--status-serious)]" : mainTone === "muted" ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]";
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <p className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
        ■{label}
      </p>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[2fr_3fr]">
        <p className={`text-2xl font-semibold tabular-nums [overflow-wrap:anywhere] ${tone}`}>{main}</p>
        <div className="flex min-w-0 flex-col gap-0.5">
          {lines.map((line) => (
            <p key={line} className="text-sm text-[var(--text-primary)] [overflow-wrap:anywhere]">
              {line}
            </p>
          ))}
          {check && <p className="mt-1 text-xs text-[var(--text-muted)]">{check}</p>}
        </div>
      </div>
    </div>
  );
}

function checkLine(reported: number | null, freeeColumn: PerformanceColumn | null, field: "revenue" | "ordinaryProfit"): string | undefined {
  if (reported === null) return undefined;
  const c = crossCheck(reported, freeeColumn, field);
  if (c.freee === null) return "freee帳簿との照合: 月末後に取得した値が無いため未照合";
  if (c.difference === 0) return "freee帳簿の同じ期間の累計と一致";
  // 差の向きは freee − 経理(資金繰り見通しと同じ)
  return `freee帳簿の同じ期間の累計 ${formatOkuManYen(c.freee)}（経理報告との差 ${c.difference !== null && c.difference > 0 ? "＋" : ""}${formatOkuManYen(c.difference ?? 0)}）`;
}

/**
 * 概要の一番上「経理報告」(2026-11-16、ユーザー指定: 経理報告PDFの再現)。経理月次報告の登録値を、資料と同じ
 * 売上高累計 → 経常利益(累積) → 資金繰り(注視事項) の3段で出す。経理が報告した(確認済みの)月までの値で、
 * 帳簿上の進捗(未調整の月を含む)はこの下の段に分けて出す。freeeは照合の差だけ添え、金額は置き換えない。
 */
export function AccountingReportSummarySection({
  summary,
  freeeColumn,
  failed,
  form,
}: {
  summary: AccountingReportSummaryResult;
  /** 報告と同じ期間のfreee帳簿の累計(月末後に取得した値)。照合用 */
  freeeColumn: PerformanceColumn | null;
  failed: boolean;
  /** 登録・訂正フォーム */
  form?: React.ReactNode;
}) {
  const closed = summary.latestClosed;
  if (failed || summary.status === "none") {
    return (
      <div className="flex flex-col gap-2">
        <SectionBanner>損益計算書：経理報告</SectionBanner>
        <p className="text-sm text-[var(--status-serious)]">
          {failed ? "経理報告の読み込みに失敗しました。" : `${closed.term}期${closed.month}月までの経理報告が登録されていません。`}
        </p>
        {form}
      </div>
    );
  }

  const s = summary;
  const t = s.target;
  const revenueLines: string[] = [];
  if (s.previousRevenue !== null) revenueLines.push(`前期売上高累計：${formatOkuManYen(s.previousRevenue)}`);
  if (s.revenueChange !== null) revenueLines.push(`※${changeText(s.revenueChange)}`);
  if (s.monthlyRevenueTarget !== null && s.cumulativeRevenueTarget !== null && s.revenueTargetGap !== null) {
    revenueLines.push(
      `※月次目標：月${formatOkuManYen(s.monthlyRevenueTarget)}×${s.monthCount}ヶ月より${formatOkuManYen(Math.abs(s.revenueTargetGap))}${
        s.revenueTargetGap < 0 ? "下回る" : "上回る"
      }`
    );
  }
  if (s.annualRevenueTarget !== null) revenueLines.push(`※通期目標：${formatOkuManYen(s.annualRevenueTarget)}`);

  const ordinaryLines: string[] = [];
  if (s.previousOrdinaryProfit !== null) ordinaryLines.push(`前期同月累計：${formatOkuManYen(s.previousOrdinaryProfit)}`);
  if (s.ordinaryProfitChange !== null) ordinaryLines.push(changeText(s.ordinaryProfitChange));
  if (s.operatingProfit !== null) ordinaryLines.push(`※営業利益：${formatOkuManYen(s.operatingProfit)}`);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        損益計算書：{t.term}期経理報告（{s.basis.month}月{s.basis.day}日現在実績） {s.monthCount}ヶ月
      </SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        経理月次報告「{s.report.values.documentName}」の登録値（経理確認済み：{t.term}期{t.month}月まで）
        <span className="text-[var(--text-muted)]">
          ／登録 {formatDateTime(new Date(s.report.updatedAt))}
          {s.basis.fromDocument ? "" : "／集計基準日は資料に記載が無いため月末で表示"}
        </span>
      </p>
      {s.latestClosedMissing && (
        <p className="text-sm font-medium text-[var(--status-serious)]">
          ※ {closed.term}期{closed.month}月分の経理報告は未登録です。登録済みの最新（{t.term}期{t.month}月）を表示しています。
        </p>
      )}
      <Row
        label="売上高累計"
        main={amountOrBlank(s.revenue)}
        mainTone={s.revenue === null ? "muted" : "primary"}
        lines={revenueLines}
        check={checkLine(s.revenue, freeeColumn, "revenue")}
      />
      <Row
        label="経常利益（累積）"
        main={s.ordinaryProfit === null ? "記載なし" : `累計${formatOkuManYen(s.ordinaryProfit)}`}
        mainTone={s.ordinaryProfit === null ? "muted" : s.ordinaryProfit < 0 ? "serious" : "primary"}
        lines={ordinaryLines}
        check={checkLine(s.ordinaryProfit, freeeColumn, "ordinaryProfit")}
      />
      <Row
        label="資金繰り"
        main="注視事項"
        mainTone="primary"
        lines={s.cashWatchItems.length > 0 ? s.cashWatchItems : ["記載なし"]}
      />
      {form}
    </div>
  );
}
