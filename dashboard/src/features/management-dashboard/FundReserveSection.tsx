import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { FundReserve } from "./fundReserve";

interface FundReserveSectionProps {
  fundReserve: FundReserve;
}

function Line({
  label,
  value,
  indent = false,
  note = false,
  bold = false,
}: {
  label: string;
  /** nullの場合「データ未設定」と表示する(推測値は出さない、ユーザー確定の方針) */
  value: number | null;
  indent?: boolean;
  /** 「うち…」の内訳行。indentより一段深く、文字を小さく弱くする */
  note?: boolean;
  bold?: boolean;
}) {
  const indentClass = note ? "pl-8" : indent ? "pl-4" : "";
  const labelClass = note
    ? "text-xs text-[var(--text-muted)]"
    : bold
      ? "font-bold text-[var(--text-primary)]"
      : "text-[var(--text-secondary)]";
  const valueClass = note
    ? "text-xs text-[var(--text-muted)]"
    : bold
      ? "font-semibold text-[var(--text-primary)]"
      : "text-[var(--text-primary)]";
  return (
    <div className={`flex items-center justify-between gap-3 py-1 text-sm ${indentClass}`}>
      <span className={labelClass}>{label}</span>
      <span className={`whitespace-nowrap tabular-nums ${valueClass}`}>{value === null ? "データ未設定" : formatYen(value)}</span>
    </div>
  );
}

/** セグメント見出し。借入状況の「借入残高」「今期の借入・返済」と同じ見出しスタイル
 * (ユーザー確定、2026-09-21)。背景は--surface-sunken、文字と背景の間に左右上下3px相当の
 * 余白(ユーザー確定、2026-09-22) */
function SegmentHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-[var(--surface-sunken)] py-[3px] pl-[3px] text-xs font-medium text-[var(--text-muted)]">
      {children}
    </p>
  );
}

/** そのセグメントの「合計」に相当する行。太字でメリハリを付ける。上の罫線は2px・
 * #c3c2b7(ユーザー確定、2026-09-22) */
function TotalLine({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="mt-1 border-t-[2px] border-[#c3c2b7] pt-1.5">
      <Line label={label} value={value} bold />
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-[var(--text-muted)]">{children}</p>;
}

/** 控除項目は引き算であることが見えるようマイナスで表示する。nullはnullのまま(データ未設定) */
function negate(value: number | null): number | null {
  return value === null ? null : -value;
}

/**
 * 資金の備え(ストック)。経理報告「残高表銀行」との照合に基づき、定義の違う4つを別ブロックに
 * 分けて並べる(ユーザー確定、2026-10-05)。各ブロックは見出し+太線の合計行で区切る
 * (借入状況と同じ様式、ユーザー確定 2026-09-21/22)。
 *
 * 1. 現預金の内訳: 現預金総額を口座の性格で分けた内訳(すべて口座の実残高)。合計は現預金総額
 * 2. 資金余力: 経理管理上の実質資金 = 現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備。
 *    当座貸越は枠ではなく実際の利用額(短期借入金の残高)を引く。消費税準備・賞与準備は経理の
 *    管理値(設定値)で、未設定の間は「データ未設定」。長期借入金は引かない
 * 3. 財務ポジション: ネットキャッシュ = 現預金総額 − 借入残高(短期+長期+役員)
 * 4. その他の備え(参考): 保険積立金。現預金ではないので2・3の計算には含めない
 *
 * 数字はすべてcomposeFundReserveの結果をそのまま表示し、ここでは計算しない。
 */
export function FundReserveSection({ fundReserve }: FundReserveSectionProps) {
  const { capacity } = fundReserve;

  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>資金の備え</SectionBanner>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <SegmentHeading>現預金の内訳</SegmentHeading>
        {fundReserve.cashEarmarkLines.map((line) => (
          <Line key={line.label} label={line.label} value={line.balance} indent />
        ))}
        <Line label="上記以外の口座・現金" value={fundReserve.unearmarkedCash} indent />
        <TotalLine label="現預金総額" value={fundReserve.cash} />

        <div className="mt-[20px]">
          <SegmentHeading>資金余力（経理管理上の実質資金）</SegmentHeading>
          <Line label="現預金総額" value={fundReserve.cash} indent />
          <Line label="当座貸越利用額" value={negate(capacity.overdraftUsed)} indent />
          <Line label="消費税準備" value={negate(capacity.consumptionTaxReserve)} indent />
          <Line label="賞与準備" value={negate(capacity.bonusReserve)} indent />
          <TotalLine label="資金余力" value={capacity.capacity} />
          <Caption>
            当座貸越利用額は短期借入金の残高、消費税準備・賞与準備は経理の管理値です
            {capacity.settingsAsOf && `（${capacity.settingsAsOf}時点${capacity.settingsSource ? `、${capacity.settingsSource}` : ""}）`}
            。賞与準備に専用口座はなく、会計上の賞与引当金とは別の金額です。長期借入金は差し引いていません。
          </Caption>
        </div>

        <div className="mt-[20px]">
          <SegmentHeading>財務ポジション</SegmentHeading>
          <Line label="現預金総額" value={fundReserve.cash} indent />
          <Line label="借入残高" value={negate(fundReserve.loanTotal)} indent />
          <TotalLine label="ネットキャッシュ" value={fundReserve.netCash} />
        </div>

        <div className="mt-[20px]">
          <SegmentHeading>その他の備え（参考）</SegmentHeading>
          <Line label="保険積立金" value={fundReserve.insuranceAssetReserve} bold />
          <Caption>現預金ではないため、資金余力・ネットキャッシュには含めていません。</Caption>
        </div>
      </div>
    </div>
  );
}
