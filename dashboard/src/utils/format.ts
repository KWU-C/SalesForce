export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

export function formatPercent(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

/** 一覧性を優先する表向け。千円単位、桁区切りのみ（¥記号なし） */
export function formatThousandYen(amount: number): string {
  return Math.round(amount / 1000).toLocaleString("ja-JP");
}

/** 万円単位、小数点1桁、桁区切り（符号なし。例: 10,599.0万円） */
export function formatManYen(amount: number): string {
  const man = (amount / 10000).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${man}万円`;
}

/** 万円単位、符号付き（経営サマリー用。例: ＋233.9万円 / ▲747.1万円） */
export function formatManYenSigned(amount: number): string {
  const sign = amount < 0 ? "▲" : "＋";
  return `${sign}${formatManYen(Math.abs(amount))}`;
}

/** 月次達成率用。小数点2桁（例: 115.98%） */
export function formatPercent2(rate: number): string {
  return `${rate.toFixed(2)}%`;
}

/** 累積達成率用。整数丸め（例: 116%） */
export function formatPercentInt(rate: number): string {
  return `${Math.round(rate)}%`;
}

/**
 * データ取得日時表示用（例: 08:45:43）。
 * timeZoneを明示しないとCloud Run実行環境のシステムタイムゾーン(通常UTC)が使われ、
 * ja-JPロケールの見た目のまま9時間ずれて表示されるため、常に日本時間(Asia/Tokyo)を指定する。
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}

/** 日付をまたぐ可能性がある更新日時表示用（例: 2026/09/11 08:45）。常に日本時間で表示する */
export function formatDateTime(date: Date): string {
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
}
