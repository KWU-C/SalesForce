import { Header } from "@/components/Header";
import { DataFetchErrorState } from "@/components/DataFetchErrorState";
import { DashboardClient } from "@/features/dashboard/DashboardClient";
import {
  getActiveSalesDataSourceLabel,
  getSalesProgressDataSource,
} from "@/repositories/salesProgressRepository";
import { FISCAL_MONTH_ORDER, FISCAL_YEAR_END_MONTH, getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import type { CrProgress } from "@/domain/types";

// 営業データは毎リクエスト取得する（ビルド時に静的化しない）。
// 更新ボタン（router.refresh()）や将来のSalesforce/Sheets接続で
// 常に最新のデータ・取得日時を返すために必須。事業期・対象月も
// リクエストごとに現在時刻から算出するため、この設定と併せて必須。
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ term?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const dataSource = getSalesProgressDataSource();
  const { term: actualTerm, currentMonth: actualCurrentMonth } = getCurrentFiscalPeriod();

  // 期セレクターの選択肢。取得できなければ現在の事業期のみにフォールバック
  // （各DataSource実装が自分でこのフォールバックを持つため、ここでは待つだけ）
  const availableTerms = await dataSource.getAvailableTerms();

  const requestedTermRaw = (await searchParams).term;
  const requestedTerm = requestedTermRaw ? Number(requestedTermRaw) : actualTerm;
  // 不正な値やデータの無い期がURLに指定された場合は現在の事業期にフォールバックする
  const selectedTerm =
    Number.isInteger(requestedTerm) && availableTerms.includes(requestedTerm)
      ? requestedTerm
      : actualTerm;

  // 現在の期は今日時点の月、過去の期は決算済み(通期)として期末月、
  // 来期(まだ開始していない期)はまだ何も実績が無いため期首月を対象月とする
  const displayMonth =
    selectedTerm === actualTerm
      ? actualCurrentMonth
      : selectedTerm > actualTerm
        ? FISCAL_MONTH_ORDER[0]
        : FISCAL_YEAR_END_MONTH;

  let progressByCr: CrProgress[] | null = null;
  try {
    progressByCr = await dataSource.getCrProgress(selectedTerm);
  } catch {
    // 詳細（エラー種別・シート名）は各DataSource実装が既にサーバーへ
    // 出力済み（repositories/salesDataSourceError.ts）。画面には出さない。
    // モックへの自動フォールバックは行わない。
  }
  const fetchedAt = new Date();
  const dataSourceLabel = getActiveSalesDataSourceLabel();

  return (
    <>
      <Header
        fiscalPeriod={{ term: selectedTerm, currentMonth: displayMonth }}
        availableTerms={availableTerms}
        fetchedAt={progressByCr ? fetchedAt : null}
        dataSourceLabel={dataSourceLabel}
      />
      <main className="flex-1 bg-[var(--background)]">
        {progressByCr ? (
          <DashboardClient
            progressByCr={progressByCr}
            currentMonth={displayMonth}
            term={selectedTerm}
            fetchedAt={fetchedAt}
            dataSourceLabel={dataSourceLabel}
          />
        ) : (
          <DataFetchErrorState />
        )}
      </main>
    </>
  );
}
