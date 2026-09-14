"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FISCAL_MONTH_ORDER, calendarYearForTermMonth } from "@/config/fiscalPeriods";

interface MonthSelectorProps {
  selectedTerm: number;
  selectedMonth: number;
  currentTerm: number;
  /** 今期の経過月(選択可能な範囲の終端)。将来月は選択させない(推測値を出さないため) */
  currentMonth: number;
  /** 選択可能な最も古い事業期(これより前へは戻れない) */
  minTerm: number;
}

/**
 * 月次ダッシュボードの月選択(前月／次月)。期をまたいだ移動にも対応する
 * (ユーザー確定、2026-09-14。当初は当期内のみだったが、期の変わり目直後は
 * 前期の直近月に一切アクセスできなくなるため拡張した)。
 * minTerm(既存のgetSelectableTerms()と同じ「現在・前期・前々期」の窓)より
 * 前や、当期の当月より先へは移動できない。
 */
export function MonthSelector({ selectedTerm, selectedMonth, currentTerm, currentMonth, minTerm }: MonthSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selectedIndex = FISCAL_MONTH_ORDER.indexOf(selectedMonth);
  const isAtLatest = selectedTerm === currentTerm && selectedMonth === currentMonth;
  const isAtEarliest = selectedTerm === minTerm && selectedIndex === 0;

  function go(term: number, month: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("term", String(term));
    params.set("month", String(month));
    startTransition(() => router.push(`?${params.toString()}`));
  }

  function goPrev() {
    if (selectedIndex > 0) {
      go(selectedTerm, FISCAL_MONTH_ORDER[selectedIndex - 1]);
    } else {
      go(selectedTerm - 1, FISCAL_MONTH_ORDER[FISCAL_MONTH_ORDER.length - 1]);
    }
  }

  function goNext() {
    if (selectedIndex < FISCAL_MONTH_ORDER.length - 1) {
      go(selectedTerm, FISCAL_MONTH_ORDER[selectedIndex + 1]);
    } else {
      go(selectedTerm + 1, FISCAL_MONTH_ORDER[0]);
    }
  }

  const year = calendarYearForTermMonth(selectedTerm, selectedMonth);

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        disabled={isAtEarliest || isPending}
        onClick={goPrev}
        className="rounded border border-[var(--border-hairline)] px-2 py-1 text-sm disabled:opacity-40"
        aria-label="前月"
      >
        ←
      </button>
      <span className="text-lg font-semibold text-[var(--text-primary)]">
        {year}年{selectedMonth}月
        <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">第{selectedTerm}期</span>
      </span>
      <button
        type="button"
        disabled={isAtLatest || isPending}
        onClick={goNext}
        className="rounded border border-[var(--border-hairline)] px-2 py-1 text-sm disabled:opacity-40"
        aria-label="次月"
      >
        →
      </button>
    </div>
  );
}
