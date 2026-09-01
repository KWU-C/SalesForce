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

/** 月次達成率用。小数点2桁（例: 115.98%） */
export function formatPercent2(rate: number): string {
  return `${rate.toFixed(2)}%`;
}

/** 累積達成率用。整数丸め（例: 116%） */
export function formatPercentInt(rate: number): string {
  return `${Math.round(rate)}%`;
}

/** データ取得日時表示用（例: 08:45:43） */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
