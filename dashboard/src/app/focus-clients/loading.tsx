/**
 * 注力クライアント管理タブ(/focus-clients)へ移動するときの読み込み表示。営業進捗タブの
 * (home)/loading.tsxと同じ見た目・挙動。ナビはlayout.tsx側(Suspense境界の外)にあるため、
 * ここはナビの下の本文領域のみを覆う(fixed inset-0にしてナビごと覆わないこと)。
 */
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 bg-black/20 pt-16">
      <div
        role="status"
        aria-label="読み込み中"
        className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--text-primary)]/30 border-t-[var(--text-primary)]"
      />
      <p className="text-sm text-[var(--text-secondary)]">データを読み込んでいます...</p>
    </div>
  );
}
