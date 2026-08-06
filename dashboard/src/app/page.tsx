import { Header } from "@/components/Header";
import { DataFetchErrorState } from "@/components/DataFetchErrorState";
import { DashboardClient } from "@/features/dashboard/DashboardClient";
import {
  getActiveSalesDataSourceLabel,
  getSalesProgressDataSource,
} from "@/repositories/salesProgressRepository";
import { getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import type { CrProgress } from "@/domain/types";

// 営業データは毎リクエスト取得する（ビルド時に静的化しない）。
// 更新ボタン（router.refresh()）や将来のSalesforce/Sheets接続で
// 常に最新のデータ・取得日時を返すために必須。事業期・対象月も
// リクエストごとに現在時刻から算出するため、この設定と併せて必須。
export const dynamic = "force-dynamic";

export default async function Page() {
  const dataSource = getSalesProgressDataSource();
  const fiscalPeriod = getCurrentFiscalPeriod();

  let progressByCr: CrProgress[] | null = null;
  try {
    progressByCr = await dataSource.getCrProgress(fiscalPeriod.currentMonth);
  } catch {
    // 詳細（エラー種別・シート名）は各DataSource実装が既にサーバーログへ
    // 出力済み（repositories/salesDataSourceError.ts）。画面には出さない。
    // モックへの自動フォールバックは行わない。
  }

  return (
    <>
      <Header
        fiscalPeriod={fiscalPeriod}
        fetchedAt={progressByCr ? new Date() : null}
        dataSourceLabel={getActiveSalesDataSourceLabel()}
      />
      <main className="flex-1 bg-[var(--background)]">
        {progressByCr ? (
          <DashboardClient
            progressByCr={progressByCr}
            currentMonth={fiscalPeriod.currentMonth}
          />
        ) : (
          <DataFetchErrorState />
        )}
      </main>
    </>
  );
}
