import { RefreshButton } from "./RefreshButton";
import { TermSelector } from "./TermSelector";
import { formatTime } from "@/utils/format";

interface HeaderProps {
  fiscalPeriod: { term: number; currentMonth: number };
  /** 期セレクターの選択肢（データのある事業期一覧） */
  availableTerms: number[];
  /** データ取得時刻。取得に失敗した場合はnull */
  fetchedAt: Date | null;
  /** "モックデータ" 等、取得元を示す短いラベル */
  dataSourceLabel: string;
}

export function Header({ fiscalPeriod, availableTerms, fetchedAt, dataSourceLabel }: HeaderProps) {
  return (
    <header className="border-b border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-2 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
            月次営業進捗ダッシュボード
          </h1>
          <TermSelector availableTerms={availableTerms} selectedTerm={fiscalPeriod.term} />
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <span>
            第{fiscalPeriod.term}期 {fiscalPeriod.currentMonth}月時点
          </span>
          <span className="rounded bg-[var(--gridline)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
            {dataSourceLabel}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {fetchedAt ? `取得日時 ${formatTime(fetchedAt)}` : "未取得"}
          </span>
          <RefreshButton />
        </div>
      </div>
    </header>
  );
}
