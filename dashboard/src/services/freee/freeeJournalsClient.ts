import { getValidFreeeAccessToken } from "@/repositories/freeeAuthRepository";

const BASE_URL = "https://api.freee.co.jp";

/** freeeの仕訳帳エクスポート(非同期ジョブ)のポーリング設定。実データで、ジョブ完了まで数秒〜数分、
 * ステータス取得自体が30秒でタイムアウトすることもあると確認済み(2026-09-19)ため、余裕を持たせる */
const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60_000;

/** 仕訳帳CSVに含める補助情報。この指定でCSVの16列目(摘要)に取引先・品目・部門・備考・銀行摘要が連結される */
const VISIBLE_TAGS = ["partner", "item", "tag", "section", "description", "wallet_txn_description"];

/** ジョブが完了しダウンロード可能になったことを示すステータス(実データでuploadedを確認済み) */
const READY_STATUSES = new Set(["uploaded", "completed"]);
const PENDING_STATUSES = new Set(["enqueued", "working"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freeeJournalsFetch(path: string, params: [string, string][], token: string): Promise<Response> {
  const query = new URLSearchParams(params);
  return fetch(`${BASE_URL}${path}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * 指定期間(取引日、両端含む)の仕訳帳CSV(Shift_JIS)を、非同期エクスポートジョブ経由で取得し、
 * UTF-8文字列として返す。CSVのパースは features/management-dashboard/journalCsv.ts。
 *
 * - ジョブ作成→ステータスのポーリング→ダウンロードの3段階。ダウンロードにもcompany_idが必須
 *   (付け忘れは400になることを実データで確認済み)。
 * - ステータス取得の一時的な失敗(タイムアウト等)は待って再試行する。ジョブ自体の失敗・未知のステータス・
 *   最大待ち時間超過は例外(fail-closed。中途半端なデータで入金分類をしない)。
 * - レスポンス本文には事業所の実データが含まれ得るため、ログにはステータスコード/ステータス名のみ出す。
 */
export async function getJournalsCsv(companyId: number, startDate: string, endDate: string): Promise<string> {
  const token = await getValidFreeeAccessToken();

  const createParams: [string, string][] = [
    ["company_id", String(companyId)],
    ["download_type", "csv"],
    ["start_date", startDate],
    ["end_date", endDate],
    ...VISIBLE_TAGS.map((tag): [string, string] => ["visible_tags[]", tag]),
  ];
  const created = await freeeJournalsFetch("/api/1/journals", createParams, token);
  if (!created.ok) {
    console.error(`[freeeJournalsClient] エクスポートジョブ作成に失敗しました(status=${created.status})`);
    throw new Error("freee_api_error");
  }
  const jobId = ((await created.json()) as { journals?: { id?: number } }).journals?.id;
  if (typeof jobId !== "number") throw new Error("freee_api_error");

  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      console.error("[freeeJournalsClient] エクスポートジョブの待機がタイムアウトしました");
      throw new Error("freee_journals_export_timeout");
    }
    let status: string | undefined;
    try {
      const res = await freeeJournalsFetch(
        `/api/1/journals/reports/${jobId}/status`,
        [["company_id", String(companyId)]],
        token
      );
      if (res.ok) status = ((await res.json()) as { journals?: { status?: string } }).journals?.status;
      else console.error(`[freeeJournalsClient] ステータス取得がエラーを返しました(status=${res.status})`);
    } catch {
      // ステータス取得の一時的なタイムアウト等。ジョブは進行中のため待って再試行する
      console.error("[freeeJournalsClient] ステータス取得が一時的に失敗しました。再試行します");
    }
    if (status !== undefined && READY_STATUSES.has(status)) break;
    if (status !== undefined && !PENDING_STATUSES.has(status)) {
      console.error(`[freeeJournalsClient] 想定外のジョブステータスです(${status})`);
      throw new Error("freee_journals_export_failed");
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const download = await freeeJournalsFetch(
    `/api/1/journals/reports/${jobId}/download`,
    [["company_id", String(companyId)]],
    token
  );
  if (!download.ok) {
    console.error(`[freeeJournalsClient] ダウンロードに失敗しました(status=${download.status})`);
    throw new Error("freee_api_error");
  }
  return new TextDecoder("shift_jis").decode(await download.arrayBuffer());
}
