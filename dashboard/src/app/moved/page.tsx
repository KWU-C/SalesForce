import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isRetiredDeployment, PRODUCTION_DASHBOARD_URL } from "@/config/deployEnvironment";

// K_SERVICEはCloud Runが実行時に設定するため、ビルド時に静的化しない
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "URLが変わりました",
};

/**
 * 廃止済みURL(旧dev環境)にアクセスした人へ、正式なURLを案内するページ。
 * proxy.tsが廃止済みURLへの全ページアクセスをここへ差し替える。
 * 本番・現行devでは存在しないページとして扱う。
 */
export default function MovedPage() {
  if (!isRetiredDeployment()) notFound();

  return (
    <main className="flex flex-1 items-center justify-center bg-[var(--background)] px-4 py-24">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-medium text-[var(--text-primary)]">このURLは使用できなくなりました</h1>
        <p className="text-sm text-[var(--text-muted)]">
          こちらは開発用の旧URLで、表示される数値が正式なダッシュボードと異なる場合がありました。
          <br />
          正式なURLは下記です。お手数ですが、ブックマークを登録し直してください。
        </p>
        <a
          href={PRODUCTION_DASHBOARD_URL}
          className="break-all text-base font-medium text-[var(--text-primary)] underline underline-offset-4"
        >
          {PRODUCTION_DASHBOARD_URL}
        </a>
      </div>
    </main>
  );
}
