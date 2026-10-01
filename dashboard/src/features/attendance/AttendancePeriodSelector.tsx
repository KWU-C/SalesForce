"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface AttendancePeriodSelectorProps {
  /** 締め月度の選択肢(古い順) */
  options: { key: string; label: string }[];
  /** 表示中の締め月度のキー。過去28日間(デフォルト)を表示中はnull */
  selectedKey: string | null;
  /** デフォルト(過去28日間)へ戻す選択肢の表示名 */
  defaultLabel: string;
}

const DEFAULT_VALUE = "";

/**
 * 勤怠状況の「他を見る」プルダウン。選択すると?attendance=YYYY-MMでページ(Server Component)を
 * 再取得する(TermSelectorと同じ方式)。過去28日間へ戻す時はパラメータを外す。
 */
export function AttendancePeriodSelector({ options, selectedKey, defaultLabel }: AttendancePeriodSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="勤怠状況の表示期間を選択"
      value={selectedKey ?? DEFAULT_VALUE}
      disabled={isPending}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value === DEFAULT_VALUE) params.delete("attendance");
        else params.set("attendance", e.target.value);
        const query = params.toString();
        // 勤怠状況はページ下部にあるため、切替のたびに先頭へ戻らないようスクロール位置を保つ
        startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
      }}
      className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm font-medium text-[var(--text-primary)] disabled:opacity-60"
    >
      {/* デフォルト表示中は「他を見る」を見出しとして出し、締め月度を表示中は過去28日間へ戻れるようにする */}
      <option value={DEFAULT_VALUE}>{selectedKey === null ? "他を見る" : defaultLabel}</option>
      {options.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
