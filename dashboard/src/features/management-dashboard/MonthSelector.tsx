"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FISCAL_MONTH_ORDER, calendarYearForTermMonth } from "@/config/fiscalPeriods";

interface MonthSelectorProps {
  term: number;
  selectedMonth: number;
  /** 今期の経過月(選択可能な範囲の終端)。将来月は選択させない(推測値を出さないため) */
  currentMonth: number;
}

/**
 * 月次ダッシュボードの月選択(前月／次月)。今期の期首月〜当月の範囲でのみ移動できる
 * (ユーザー確定、2026-09-14。今回は期をまたいだ過去期への移動は対象外)。
 */
export function MonthSelector({ term, selectedMonth, currentMonth }: MonthSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selectedIndex = FISCAL_MONTH_ORDER.indexOf(selectedMonth);
  const currentIndex = FISCAL_MONTH_ORDER.indexOf(currentMonth);
  const canGoPrev = selectedIndex > 0;
  const canGoNext = selectedIndex < currentIndex;

  function go(month: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", String(month));
    startTransition(() => router.push(`?${params.toString()}`));
  }

  const year = calendarYearForTermMonth(term, selectedMonth);

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        disabled={!canGoPrev || isPending}
        onClick={() => go(FISCAL_MONTH_ORDER[selectedIndex - 1])}
        className="rounded border border-[var(--border-hairline)] px-2 py-1 text-sm disabled:opacity-40"
        aria-label="前月"
      >
        ←
      </button>
      <span className="text-lg font-semibold text-[var(--text-primary)]">
        {year}年{selectedMonth}月
      </span>
      <button
        type="button"
        disabled={!canGoNext || isPending}
        onClick={() => go(FISCAL_MONTH_ORDER[selectedIndex + 1])}
        className="rounded border border-[var(--border-hairline)] px-2 py-1 text-sm disabled:opacity-40"
        aria-label="次月"
      >
        →
      </button>
    </div>
  );
}
