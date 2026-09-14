interface KpiTileProps {
  title: string;
  value: number | null;
  formatter: (v: number) => string;
  subLabel?: string;
}

/** 該当データが無い項目は必ず「データ未設定」と表示し、0円等の推測値は出さない(ユーザー確定の方針) */
export function KpiTile({ title, value, formatter, subLabel }: KpiTileProps) {
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
