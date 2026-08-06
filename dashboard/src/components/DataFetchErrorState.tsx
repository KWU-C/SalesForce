/**
 * データ取得失敗時の画面表示。内部情報（エラーの種類・シート名・原因等）は
 * 一切表示しない。詳細はサーバーログ側にのみ出力する
 * （repositories/salesDataSourceError.ts参照）。
 */
export function DataFetchErrorState() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-24 text-center">
      <p className="text-base font-medium text-[var(--text-primary)]">
        営業進捗データを取得できませんでした
      </p>
      <p className="text-sm text-[var(--text-muted)]">
        しばらくしてから再度お試しください。問題が続く場合は管理者にご連絡ください。
      </p>
    </div>
  );
}
