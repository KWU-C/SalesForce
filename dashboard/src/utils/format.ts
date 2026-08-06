export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

export function formatPercent(rate: number): string {
  return `${rate.toFixed(1)}%`;
}
