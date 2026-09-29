import Link from "next/link";

/** 並びは営業進捗→勤怠→経営(ユーザー確定、2026-09-29)。/resourceのラベルは「勤怠」 */
const NAV_ITEMS = [
  { href: "/", label: "営業進捗" },
  { href: "/resource", label: "勤怠" },
  { href: "/management", label: "経営" },
] as const;

interface DashboardNavProps {
  active: (typeof NAV_ITEMS)[number]["href"];
  /** 経営タブを表示するか(managementDashboardAccessの許可リストで判定) */
  showManagementTab: boolean;
  /** 勤怠タブを表示するか(resourceDashboardAccessの許可リストで判定、2026-09-29から経営とは別リスト) */
  showResourceTab: boolean;
}

/**
 * 営業進捗(Salesforce)／勤怠(推定負荷率・勤怠状況)／経営(freee)の切替ナビ。全ページで共有する
 * （ユーザー確定、2026-09-14・2026-09-18・2026-09-29)。既存Headerコンポーネントの中身(期セレクター等)は
 * 営業進捗専用のため変更せず、その上に独立した帯として重ねる構成にしている。
 * ナビのタブ非表示だけで守られているのではなく、常に同じ許可リストでページ本文側
 * (layout/page.tsx)も別途アクセス制御している(fail-closed)。
 */
export function DashboardNav({ active, showManagementTab, showResourceTab }: DashboardNavProps) {
  const items = NAV_ITEMS.filter((item) => {
    if (item.href === "/management") return showManagementTab;
    if (item.href === "/resource") return showResourceTab;
    return true;
  });
  return (
    <nav className="border-b border-[var(--border-hairline)] bg-[var(--surface-sunken)]">
      <div className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active === item.href ? "page" : undefined}
            className={`px-3 py-2 text-sm font-medium ${
              active === item.href
                ? "border-b-2 border-[var(--series-1)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
