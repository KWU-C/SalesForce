"use client";

import type { CrId } from "@/domain/types";

interface CrTabsProps {
  crList: { id: CrId; label: string }[];
  selected: CrId;
  onSelect: (crId: CrId) => void;
}

export function CrTabs({ crList, selected, onSelect }: CrTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="CR選択"
      className="flex flex-wrap gap-1 border-b border-[var(--border-hairline)]"
    >
      {crList.map(({ id, label }) => {
        const isActive = id === selected;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-b-2 border-[var(--series-1)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
