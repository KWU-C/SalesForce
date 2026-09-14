import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "営業進捗" },
  { href: "/management", label: "経営" },
] as const;

interface DashboardNavProps {
  active: (typeof NAV_ITEMS)[number]["href"];
}

/**
 * 営業進捗(Salesforce)／経営(freee)の切替ナビ。両ページで共有する
 * （ユーザー確定、2026-09-14）。既存Headerコンポーネントの中身(期セレクター等)は
 * 営業進捗専用のため変更せず、その上に独立した帯として重ねる構成にしている。
 */
export function DashboardNav({ active }: DashboardNavProps) {
  return (
    <nav className="border-b border-[var(--border-hairline)] bg-[var(--surface-sunken)]">
      <div className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6">
        {NAV_ITEMS.map((item) => (
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
