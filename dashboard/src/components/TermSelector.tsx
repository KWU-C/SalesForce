"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface TermSelectorProps {
  availableTerms: number[];
  selectedTerm: number;
}

/** ヘッダーの事業期セレクター。選択すると?term=Xでページ(Server Component)を再取得する */
export function TermSelector({ availableTerms, selectedTerm }: TermSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="事業期を選択"
      value={selectedTerm}
      disabled={isPending}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("term", e.target.value);
        startTransition(() => router.push(`?${params.toString()}`));
      }}
      className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm font-medium text-[var(--text-primary)] disabled:opacity-60"
    >
      {availableTerms.map((term) => (
        <option key={term} value={term}>
          第{term}期
        </option>
      ))}
    </select>
  );
}
