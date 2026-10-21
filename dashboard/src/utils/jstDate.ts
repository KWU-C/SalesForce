/** 日本時間(Asia/Tokyo)の日付(YYYY-MM-DD)。Cloud Run(UTC)上でも日本の日付で記録・判定するために使う */
export function jstDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
