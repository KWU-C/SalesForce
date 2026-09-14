/**
 * freeeの勘定科目名 → TCD Dashboard独自のOUTPUT区分へのマッピング設定。
 * UIコンポーネントへ直書きせず、ここで一元管理する(ユーザー確定、2026-09-14)。
 *
 * TCDは実際には「労務費」「製造経費」という勘定科目区分を使っておらず、
 * 人件費・外注費相当もすべて「販売管理費」に計上されている(実データで確認済み)。
 * そのためfreeeの区分をそのまま使わず、Dashboard側で独自に再分類する。
 */
export const LABOR_COST_ACCOUNT_ITEMS: readonly string[] = [
  "役員報酬",
  "役員賞与",
  "給料手当",
  "賞与",
  "法定福利費",
  "福利厚生費",
];

// 「外注費」という勘定科目は今期使われておらず、実際の外注費相当の計上は
// 「業務委託費」で行われている(実データで確認済み、2026-09-14)
export const OUTSOURCING_COST_ACCOUNT_ITEMS: readonly string[] = ["業務委託費"];

export type OutputCostCategory = "labor" | "outsourcing" | "otherSga";

export function classifyOutputCostAccountItem(accountItemName: string): OutputCostCategory {
  if (LABOR_COST_ACCOUNT_ITEMS.includes(accountItemName)) return "labor";
  if (OUTSOURCING_COST_ACCOUNT_ITEMS.includes(accountItemName)) return "outsourcing";
  return "otherSga";
}
