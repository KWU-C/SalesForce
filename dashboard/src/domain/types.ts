/**
 * ドメイン型定義
 *
 * 注意: シートの実セル位置など未確定情報はモックには含めない
 * （実データ接続時にユーザー確認の上で反映する。docs/sheet-mapping.md参照）。
 */

export type CrId = "ALL" | "CR1" | "CR2" | "CR3";

export const CR_LIST: { id: CrId; label: string }[] = [
  { id: "ALL", label: "全社" },
  { id: "CR1", label: "CR1" },
  { id: "CR2", label: "CR2" },
  { id: "CR3", label: "CR3" },
];

/** 受注 or 完了 */
export type ProgressKind = "order" | "completed";

/**
 * 月別の売上・粗利進捗（受注 or 完了、CRごと）。
 *
 * sales/grossProfit/achievementRateは「未入力」をnullで表す。0とは区別する
 * （シート上の空欄＝未入力であり、実績が0円だったことを意味しない。
 * ユーザー指定、2026-08-06）。
 */
export interface MonthlyProgress {
  crId: CrId;
  kind: ProgressKind;
  /** 対象月（暦月、1〜12） */
  month: number;
  /** 売上実績額。未入力ならnull */
  sales: number | null;
  /** 粗利実績額。未入力ならnull */
  grossProfit: number | null;
  /** 月間粗利目標額 */
  targetGrossProfit: number;
  /**
   * 月間売上目標額。取得元が売上目標を持たない場合（モック・Google Sheets等）は未設定。
   * Salesforce連携（SalesTarget__c）では設定される
   */
  targetSales?: number;
  /** 粗利目標達成率(%)。grossProfitが未入力の場合はnull */
  achievementRate: number | null;
}

/** 期間集計（四半期・上半期・通期など）。未入力月のみの場合はnull（0とは区別する） */
export interface PeriodSummary {
  label: string;
  /** 集計対象の暦月一覧 */
  months: number[];
  sales: number | null;
  grossProfit: number | null;
  targetGrossProfit: number;
  /** 期間内合計の売上目標額。取得元が売上目標を持たない場合は未設定 */
  targetSales?: number;
  /** 粗利目標達成率(%)。grossProfitがnullの場合はnull */
  achievementRate: number | null;
}

/** クライアント別の粗利ランキング1件分（当該事業期・CR内での合計） */
export interface ClientRanking {
  clientId: string;
  clientName: string;
  /** 今期(現在の事業期)が初取引のクライアントかどうか */
  isNewThisTerm: boolean;
  grossProfit: number;
}

/** CRごとの進捗まとめ（受注・完了の月別データ） */
export interface CrProgress {
  crId: CrId;
  order: MonthlyProgress[];
  completed: MonthlyProgress[];
  /**
   * 前期（1事業期前）の月別受注・完了。前期／今期比較チャート専用で、
   * targetGrossProfit/achievementRateは比較に使わないため意味を持たない（0扱い）。
   */
  previousOrder: MonthlyProgress[];
  previousCompleted: MonthlyProgress[];
  /** 受注／完了 粗利トップ20クライアント（当該事業期・当該crIdのみ。ALLは全CR横断で再集計） */
  topOrderClients: ClientRanking[];
  topCompletedClients: ClientRanking[];
}

/** 対象事業期・対象月の情報 */
export interface FiscalPeriod {
  /** 事業期数（例: 49期） */
  term: number;
  /** 対象月（暦月、1〜12） */
  currentMonth: number;
}
