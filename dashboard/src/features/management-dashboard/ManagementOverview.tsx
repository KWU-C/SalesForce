import { ManagementTabLink } from "./ManagementTabs";
import type { ManagementTabId } from "./ManagementTabs";

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
