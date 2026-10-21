/**
 * 資金繰り予測(第2段階)の設定値。いずれも暫定値で、ここを変えるだけで計算に反映される
 * (ユーザー確定、2026-10-21)。根拠は2026-02〜09を基準日にしたバックテスト。
 */
export interface CashForecastSettings {
  /** 予測する月数(当月を含む) */
  horizonMonths: number;
  /** 「予測」として出す月数(当月から)。それより先は「推計」 */
  forecastTierMonths: number;
  /** 平均をとる直近の月数(営業入金・外注・諸経費など) */
  averageWindowMonths: number;
  /** 営業入金の伸び率の下限・上限 */
  growthClamp: { min: number; max: number };
  /** 伸び率の計算前に、各月の営業入金を6か月中央値の何倍の範囲へ切り詰めるか */
  growthWinsorize: { min: number; max: number };
  /** 税金・社会保険の中央値をとる月数 */
  taxMedianWindowMonths: number;
  /** 中央値の何倍を超える月を「一時的な納付の月」とみなして中央値の計算から外すか */
  taxLumpThreshold: number;
  /**
   * 一時的な納付(法人税・消費税の確定など)の月と、納付額の根拠にする負債科目。
   * 科目の残高が無い(0以下)場合は0円とせず「未反映」として警告する。
   */
  taxLumpSchedule: { calendarMonth: number; label: string; liabilityAccounts: string[] }[];
  /** 賞与の支給月(暦月)。賞与明細が無い場合は未反映として警告する */
  bonusMonths: number[];
  /** 借入先ごとの登録済み返済予定が、通常の月額のこの割合以上なら補完しない */
  loanScheduleCoverage: number;
  /**
   * 借入先別の補完後の合計が、会社全体の直近の返済実績(中央値)を下回る場合に、その差も推計で補うか。
   * 返済が不定期な借入先は借入先別の中央値が0になり補完されないため(バックテストで過小)
   */
  loanAggregateFloor: boolean;
  /** 銀行同期の遅れを警告する日数 */
  syncDelayWarningDays: number;
  /** 給与・賞与の銀行出金を探す期間(支給日の何日前から) */
  payrollPaymentWindowDays: number;
  /** 帳簿未登録の銀行明細を予定取引と照合するときの日付の許容差(日) */
  unbookedMatchDays: number;
  /** 営業入金として扱う売上取引の科目 */
  operatingIncomeAccounts: string[];
}

export const CASH_FORECAST_SETTINGS: CashForecastSettings = {
  horizonMonths: 6,
  forecastTierMonths: 2,
  averageWindowMonths: 3,
  growthClamp: { min: 0.85, max: 1.15 },
  growthWinsorize: { min: 0.5, max: 1.5 },
  taxMedianWindowMonths: 6,
  taxLumpThreshold: 1.5,
  // 49期は8月決算の確定申告分(未払法人税等・未払消費税等)を10月に納付した(freee実データ、2026-10-21)。
  // 中間納付の月・金額は経理に確認するまで設定しない(未確認のものを推測で入れない)
  taxLumpSchedule: [{ calendarMonth: 10, label: "法人税・消費税(確定申告分)", liabilityAccounts: ["未払法人税等", "未払消費税等"] }],
  // 49期の賞与は12月・7月(賞与引当金の取り崩しと賞与の計上、freee実データ)
  bonusMonths: [7, 12],
  loanScheduleCoverage: 0.9,
  loanAggregateFloor: true,
  syncDelayWarningDays: 7,
  payrollPaymentWindowDays: 10,
  unbookedMatchDays: 10,
  operatingIncomeAccounts: ["売上高", "売掛金"],
};
