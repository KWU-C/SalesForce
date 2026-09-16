/**
 * ナビ(営業進捗｜経営)はlayout.tsx側にあり、このSuspense境界(page.tsx)の外なので
 * 読み込み中も常に表示され続ける。ここはナビの下の本文領域のみを覆う
 * (ユーザー確定、2026-09-16。fixed inset-0にしてナビごと覆わないこと)
 */
export default function Loading() {
  return (
    <div className="flex flex-1 justify-center bg-black/20 pt-16">
      <div
        role="status"
        aria-label="読み込み中"
        className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--text-primary)]/30 border-t-[var(--text-primary)]"
      />
    </div>
  );
}
