import { FreeeLoadingIndicator } from "@/features/management-dashboard/RefreshOverlay";

/**
 * ナビ(営業進捗｜経営)はlayout.tsx側にあり、このSuspense境界(page.tsx)の外なので
 * 読み込み中も常に表示され続ける。ここはナビの下の本文領域のみを覆う
 * (ユーザー確定、2026-09-16。fixed inset-0にしてナビごと覆わないこと)
 */
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center gap-3 bg-black/20 pt-16">
      <FreeeLoadingIndicator />
    </div>
  );
}
