import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "営業進捗" },
  { href: "/management", label: "経営" },
  { href: "/resource", label: "リソース" },
] as const;

/** ナビのタブ非表示だけで守られているのではなく、常にこれと同じ許可リストで
 * ページ本文側(layout/page.tsx)も別途アクセス制御している(fail-closed) */
const RESTRICTED_HREFS: readonly (typeof NAV_ITEMS)[number]["href"][] = ["/management", "/resource"];

interface DashboardNavProps {
  active: (typeof NAV_ITEMS)[number]["href"];
  /** 経営・リソースタブを表示するか。IAP検証済みメールが許可リストに無い場合はfalseにする
   * (両タブとも同じ許可リストで判定、ユーザー確定、2026-09-14・2026-09-18) */
  showRestrictedTabs: boolean;
}

/**
 * 営業進捗(Salesforce)／経営(freee)／リソース(推定負荷率)の切替ナビ。全ページで共有する
 * （ユーザー確定、2026-09-14・2026-09-18)。既存Headerコンポーネントの中身(期セレクター等)は
 * 営業進捗専用のため変更せず、その上に独立した帯として重ねる構成にしている。
 */
export function DashboardNav({ active, showRestrictedTabs }: DashboardNavProps) {
  const items = NAV_ITEMS.filter((item) => !RESTRICTED_HREFS.includes(item.href) || showRestrictedTabs);
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
