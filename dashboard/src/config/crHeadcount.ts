import type { ConcreteCrId } from "@/domain/types";

/**
 * CR別の人数（推定負荷率、/resource専用の設定値）。
 *
 * 調査の結果、CR別人数を保持する既存のマスタデータはコード内のどこにも存在しない
 * （Salesforceクエリ・Firestore・config配下のいずれにも無いことを確認済み、
 * 2026-09-18）。そのため`data/Member.xlsx`（属性列がCR1〜4のメンバー一覧、
 * ユーザー提供）を集計した値を、いったん定数として設定する
 * （ユーザー確定、2026-09-18。「新しい人数マスタは作らない」という指示のもと、
 * 人事異動があった場合はこの値を手動で更新する運用とする）。
 */
export const CR_HEADCOUNT: Record<ConcreteCrId, number> = {
  CR1: 11,
  CR2: 9,
  CR3: 13,
  CR4: 8,
};
