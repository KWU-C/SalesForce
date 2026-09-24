/**
 * 営業進捗タブ("/")へ移動するときの読み込み表示。経営タブ(/management/loading.tsx)・
 * リソースタブ(/resource/loading.tsx)と同じ見た目・挙動にする(ユーザー確定、2026-09-24)。
 * ナビ(営業進捗｜経営｜リソース)はlayout.tsx側にあり、このSuspense境界(page.tsx)の外
 * なので読み込み中も常に表示され続ける。ここはナビの下の本文領域のみを覆う
 * (fixed inset-0にしてナビごと覆わないこと)。
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
