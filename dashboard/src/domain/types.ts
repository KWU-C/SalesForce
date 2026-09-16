/**
 * ドメイン型定義
 *
 * 注意: シートの実セル位置など未確定情報はモックには含めない
 * （実データ接続時にユーザー確認の上で反映する。docs/sheet-mapping.md参照）。
 */

export type ConcreteCrId = "CR1" | "CR2" | "CR3" | "CR4";
export type CrId = "ALL" | ConcreteCrId;

/**
 * CR4が加わった事業期。ユーザー確定（2026-09-01）:
 * 48期・49期はCR1〜CR3の3部門構成、50期以降はCR1〜CR4の4部門構成。
 */
export const CR4_INTRODUCED_TERM = 50;

/** 事業期に応じた実在CR一覧（ALLを除く）。CR_LISTを直接使わず必ずこの関数経由で求める */
export function getConcreteCrIdsForTerm(term: number): ConcreteCrId[] {
  return term >= CR4_INTRODUCED_TERM ? ["CR1", "CR2", "CR3", "CR4"] : ["CR1", "CR2", "CR3"];
}

/** 事業期に応じたCRタブ一覧（先頭にALL=全社を含む） */
export function getCrListForTerm(term: number): { id: CrId; label: string }[] {
  return [
    { id: "ALL", label: "全社" },
    ...getConcreteCrIdsForTerm(term).map((id) => ({ id, label: id })),
  ];
}

const CONCRETE_CR_IDS: readonly ConcreteCrId[] = ["CR1", "CR2", "CR3", "CR4"];

/** 外部入力（APIリクエストボディ等）がConcreteCrIdかどうかを判定する */
export function isConcreteCrId(value: unknown): value is ConcreteCrId {
  return typeof value === "string" && (CONCRETE_CR_IDS as readonly string[]).includes(value);
}

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

/** リーダー別の粗利ランキング1件分（当該事業期・CR内での合計） */
export interface LeaderRanking {
  leaderId: string;
  leaderName: string;
  grossProfit: number;
}

/** 商品区分別の粗利内訳1件分（当該事業期・CR内での合計）。区分未設定は"未設定"としてまとめる */
export interface CategoryBreakdown {
  category: string;
  grossProfit: number;
}

/**
 * パイプライン案件1件分（Salesforceレポート WOM_CR1〜4 相当。
 * フェーズが「提案」「見積」の未受注案件一覧、期間フィルタは持たない現在時点のスナップショット）。
 */
export interface PipelineDeal {
  /** Process__cのSalesforce Id。ダッシュボード独自メモのキーにも使う */
  processId: string;
  /** 受注確度（juchukakudo__c）の生の値。例: "A (80～100%)" */
  confidence: string;
  clientName: string | null;
  dealName: string;
  grossProfit: number | null;
  /** 売上合計金額(uriagegoukei__c) */
  sales: number | null;
  /** Salesforce側の既存メモ(memo__c)。ダッシュボード独自メモとは別物 */
  salesforceMemo: string | null;
  /**
   * Process__cレコードの最終更新日時(ISO8601、LastModifiedDate)。
   * レポート上の「案件: 最終更新日」に相当し、memo__c欄限定の更新日ではない
   * （ユーザー確定、2026-09-16）。
   */
  salesforceMemoUpdatedAt: string;
}

/**
 * ダッシュボード独自メモ（Firestore `processMemos` コレクション1件分）。
 * Salesforceのmemo__cとは完全に分離した別データ（ユーザー確定）。
 */
export interface ProcessMemo {
  processId: string;
  crId: ConcreteCrId;
  memo: string;
  /** 行をハイライト表示するかどうか（クライアント名頭のチェックボックス、ユーザー確定） */
  highlighted: boolean;
  updatedBy: string;
  /** ISO8601文字列。メモ本文・highlightedいずれかの更新で更新される(共有フィールド) */
  updatedAt: string;
  /**
   * highlightedを最後に手動変更した日時(ISO8601)。一度も手動変更されていなければ
   * undefined。Salesforceメモの「●」による自動判定とダッシュボード側の手動チェックが
   * 競合した場合に、どちらが新しいかを比較するために使う(ユーザー確定、2026-09-16。
   * メモ本文の更新では変わらない、highlightedフィールド専用のタイムスタンプ)
   */
  highlightedUpdatedAt: string | undefined;
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
  /** 受注／完了 リーダー別粗利ランキング（当該事業期・当該crIdのみ。ALLは全CR横断で再集計） */
  topOrderLeaders: LeaderRanking[];
  topCompletedLeaders: LeaderRanking[];
  /** 受注 商品区分別粗利内訳（当該事業期・当該crIdのみ、粗利降順。ALLは全CR横断で再集計） */
  orderByCategory: CategoryBreakdown[];
  /**
   * パイプライン案件一覧（WOM_CR1〜4相当）。事業期・対象月に依存しない現在時点の
   * スナップショットのため、取得元がSalesforce以外（モック・Google Sheets）の場合は
   * 未設定のままにする。ALLタブでは表示しない（CR別タブ専用、ユーザー確定）
   */
  pipelineDeals?: PipelineDeal[];
}

/** 対象事業期・対象月の情報 */
export interface FiscalPeriod {
  /** 事業期数（例: 49期） */
  term: number;
  /** 対象月（暦月、1〜12） */
  currentMonth: number;
}
