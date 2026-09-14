import type { Metadata } from "next";
import { DashboardNav } from "@/components/DashboardNav";

export const metadata: Metadata = {
  title: "経営ダッシュボード",
  description: "TCD 経営ダッシュボード（freeeベース）",
};

/**
 * 経営ダッシュボード（freeeベース）のプレースホルダー。
 * freee OAuth認証基盤の実装、および実データでのKPIマッピング確定まで、
 * 推測値・仮のKPI表示は行わない（ユーザー確定、2026-09-14）。
 */
export default function ManagementPage() {
  return (
    <>
      <DashboardNav active="/management" />
      <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--background)] px-4 py-24 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">経営ダッシュボード</h1>
        <p className="max-w-md text-sm text-[var(--text-secondary)]">
          freee連携準備中です。認証基盤の実装とTCDの実データ（勘定科目・部門構成）の確認が
          完了次第、経営KPIを順次追加していきます。
        </p>
      </main>
    </>
  );
}
