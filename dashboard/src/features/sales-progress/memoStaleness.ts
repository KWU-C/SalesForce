const STALE_THRESHOLD_MONTHS = 2;

/**
 * 「案件: 最終更新日」が閾値(2ヶ月、ユーザー確定、2026-09-16)以上前かどうかを判定する。
 * 暦月ベースで比較する(例: 6/15の2ヶ月前は4/15。4/16時点ではまだ2ヶ月未満)。
 */
export function isMemoStale(lastModifiedIso: string, now: Date = new Date()): boolean {
  const threshold = new Date(now);
  threshold.setMonth(threshold.getMonth() - STALE_THRESHOLD_MONTHS);
  return new Date(lastModifiedIso).getTime() <= threshold.getTime();
}
