import { formatManYen } from "@/utils/format";
import { ManagementTabLink } from "./ManagementTabs";
import type { ManagementTabId } from "./ManagementTabs";
import type { FundReserve } from "./fundReserve";

function manYen(value: number | null): string {
  if (value === null) return "データ未設定";
  return value < 0 ? `▲${formatManYen(Math.abs(value))}` : formatManYen(value);
}

/**
 * 概要タブの資金余力。値は資金の備え(FundReserveSection)と同じ composeFundReserve の結果
 * (capacity.capacity)をそのまま使い、ここでは計算しない。単位は隣の財務・資金の欄と同じ万円(小数第1位)で、
 * 円単位の値と内訳は「財務・資金繰り」タブの資金の備えで確認する。
 * 資金の備えが取得できていない場合(fundReserve=null)も「データ未設定」と出し、欄自体は消さない。
 */
export function CapacitySummary({ fundReserve }: { fundReserve: FundReserve | null }) {
  const capacity = fundReserve?.capacity ?? null;
  const value = capacity?.capacity ?? null;
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">資金余力（経理管理上の実質資金）</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span className="text-sm text-[var(--text-secondary)]">資金余力</span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              value !== null && value < 0 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]"
            }`}
          >
            {manYen(value)}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] sm:text-right">
          現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備
          {capacity?.settingsAsOf ? `（準備額は${capacity.settingsAsOf}時点の経理の管理値）` : "（準備額は経理の管理値）"}
        </p>
      </div>
    </div>
  );
}

/** 未取得・取得失敗の注意(概要に残す短い表示)。詳細は各タブの同じ表示で確認する */
export function OverviewNotice({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--status-serious)]">{children}</p>;
}

/** 概要の各ブロックの下に置く「〜を見る」の並び */
export function OverviewLinks({ links }: { links: { tab: ManagementTabId; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {links.map((link) => (
        <ManagementTabLink key={link.tab} tab={link.tab}>
          {link.label}
        </ManagementTabLink>
      ))}
    </div>
  );
}
