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
