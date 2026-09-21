import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { FundReserve } from "./fundReserve";

interface FundReserveSectionProps {
  fundReserve: FundReserve;
  /** 借入状況セクションのtotalCurrentをそのまま渡す */
  loanTotalCurrent: number | null;
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
  /** 「うち賞与準備」等の内訳行。indentより一段深く、文字を小さく弱くする */
  note?: boolean;
  bold?: boolean;
}) {
  const indentClass = note ? "pl-8" : indent ? "pl-4" : "";
  const labelClass = note
    ? "text-xs text-[var(--text-muted)]"
    : bold
      ? "font-medium text-[var(--text-primary)]"
      : "text-[var(--text-secondary)]";
  const valueClass = note
    ? "text-xs text-[var(--text-muted)]"
    : bold
      ? "font-semibold text-[var(--text-primary)]"
      : "text-[var(--text-primary)]";
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${indentClass}`}>
      <span className={labelClass}>{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value === null ? "データ未設定" : formatYen(value)}</span>
    </div>
  );
}

/** セグメント見出し。借入状況の「借入残高」「今期の借入・返済」と同じ見出しスタイル
 * (ユーザー確定、2026-09-21) */
function SegmentHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-[var(--text-muted)]">{children}</p>;
}

/** そのセグメントの「合計」に相当する行。太線+太字でメリハリを付ける
 * (借入状況の合計行と同じ考え方、ユーザー確定、2026-09-21) */
function TotalLine({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="mt-1 border-t-2 border-[var(--baseline)] pt-1.5">
      <Line label={label} value={value} bold />
    </div>
  );
}

/**
 * 資金の備え(ストック)。月次資金収支(フロー)とは別枠で、「将来の支出に向けて
 * どれだけ資金を準備しているか」を表す(ユーザー確定、2026-09-15)。
 *
 * 「現預金」「その他の資産」「資金ポジション」の3セグメントに分け、借入状況と同じく
 * 各セグメントを見出し+太線区切りで明確に分ける(ユーザー確定、2026-09-21)。
 * - 現預金: 現預金の下に「うち賞与準備」「うちその他目的資金」を内訳として一段深く
 *   インデントして示し、太線の下に「自由資金」(=現預金－目的別拘束資金)を合計行として置く。
 *   賞与準備は対象口座・目標額が確定するまで常に「未設定」(会計上の賞与引当金とは
 *   意味が異なるため推測しない、ユーザー確定)。その他目的資金は口座ごとの内訳を
 *   合算した1行で表示する。
 * - その他の資産: 保険積立金。trial_bsの「現金・預金」カテゴリには一切含まれないため、
 *   現預金からは控除しない別枠の「資産としての備え」(二重控除防止、実データで検証済み、
 *   2026-09-15)。
 * - 資金ポジション: 自由資金・借入残高(マイナス表示で引き算であることを視覚的に示す)から、
 *   太線の下に合計行として「ネット自由資金」(=自由資金－借入残高)を置く。
 */
export function FundReserveSection({ fundReserve, loanTotalCurrent }: FundReserveSectionProps) {
  const otherPurposeTotal = fundReserve.otherPurposeLines.reduce((sum, line) => sum + (line.balance ?? 0), 0);
  const netFreeCash =
    fundReserve.freeCash === null || loanTotalCurrent === null ? null : fundReserve.freeCash - loanTotalCurrent;

  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>資金の備え</SectionBanner>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <SegmentHeading>現預金</SegmentHeading>
        <Line label="現預金" value={fundReserve.cash} indent />
        <Line
          label="うち賞与準備"
          value={fundReserve.bonusReserveConfigured ? fundReserve.bonusReserve : null}
          note
        />
        <Line label="うちその他目的資金" value={otherPurposeTotal} note />
        <TotalLine label="自由資金" value={fundReserve.freeCash} />

        <div className="mt-3 border-t border-[var(--gridline)] pt-2">
          <SegmentHeading>その他の資産</SegmentHeading>
          <Line label="保険積立金" value={fundReserve.insuranceAssetReserve} indent />
        </div>

        <div className="mt-3 border-t border-[var(--gridline)] pt-2">
          <SegmentHeading>資金ポジション</SegmentHeading>
          <Line label="自由資金" value={fundReserve.freeCash} indent />
          <Line label="借入残高" value={loanTotalCurrent === null ? null : -loanTotalCurrent} indent />
          <TotalLine label="ネット自由資金" value={netFreeCash} />
        </div>
      </div>
    </div>
  );
}
