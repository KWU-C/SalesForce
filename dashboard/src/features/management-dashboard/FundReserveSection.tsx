import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { FundReserve } from "./fundReserve";

interface FundReserveSectionProps {
  fundReserve: FundReserve;
  /** 借入状況セクションのtotalCurrentをそのまま渡す */
  loanTotalCurrent: number | null;
  /** ページ側で合成済みのネットキャッシュ(現預金－借入残高)。経営サマリーと同じ値を使う */
  netCash: number | null;
}

function Line({
  label,
  value,
  indent = false,
  bold = false,
}: {
  label: string;
  /** nullの場合「データ未設定」と表示する(推測値は出さない、ユーザー確定の方針) */
  value: number | null;
  indent?: boolean;
  bold?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {value === null ? "データ未設定" : formatYen(value)}
      </span>
    </div>
  );
}

/**
 * 資金の備え(ストック)。月次資金収支(フロー)とは別枠で、「将来の支出に向けて
 * どれだけ資金を準備しているか」を表す(ユーザー確定、2026-09-15)。
 *
 * 賞与準備は対象口座・目標額が確定するまで常に「未設定」(会計上の賞与引当金とは
 * 意味が異なるため推測しない)。自由資金・ネットキャッシュは意味が異なるため、
 * 単一の「資金余力」に統合せず別指標のまま表示する(ユーザー確定)。
 *
 * 保険積立金(投資その他の資産カテゴリ)はtrial_bsの「現金・預金」カテゴリに一切
 * 含まれないため、現預金から控除する「現預金内の目的準備資金」とは別枠の
 * 「資産としての備え」として表示する(二重控除防止、実データで検証済み、2026-09-15)。
 */
export function FundReserveSection({ fundReserve, loanTotalCurrent, netCash }: FundReserveSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>資金の備え</SectionBanner>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <p className="text-xs font-medium text-[var(--text-muted)]">現預金内の目的準備資金（自由資金の控除対象）</p>
        <Line
          label="賞与準備"
          value={fundReserve.bonusReserveConfigured ? fundReserve.bonusReserve : null}
          indent
        />
        {fundReserve.otherPurposeLines.map((line) => (
          <Line key={line.label} label={line.label} value={line.balance} indent />
        ))}
        <div className="mt-2 border-t border-[var(--gridline)] pt-2">
          <Line label="現預金内目的準備資金合計" value={fundReserve.cashRestrictedTotal} bold />
        </div>

        <div className="mt-3 border-t border-[var(--gridline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            資産としての備え（現預金の外。自由資金の控除対象外）
          </p>
          <Line label="保険積立金" value={fundReserve.insuranceAssetReserve} indent />
        </div>

        <div className="mt-3 border-t-2 border-[var(--baseline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">資金余力</p>
          <Line label="現預金" value={fundReserve.cash} indent />
          <Line label="現預金内目的準備資金" value={fundReserve.cashRestrictedTotal} indent />
          <Line
            label="自由に使える現預金（現預金－現預金内目的準備資金）"
            value={fundReserve.freeCash}
            indent
            bold
          />
          <Line label="借入残高" value={loanTotalCurrent} indent />
          <Line label="ネットキャッシュ（現預金－借入残高）" value={netCash} indent bold />
        </div>
      </div>
    </div>
  );
}
